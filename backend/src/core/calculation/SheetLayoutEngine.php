<?php
// ============================================
// ABT Покрівля — core/calculation/SheetLayoutEngine.php
//
// Розрахунок укладки листових і штучних матеріалів за правилами «Кровля Профи» 8.15
// (docs/TZ-analog-krovlya-profi.md, розділ 13).
//
// Позначення КП:  К  — карнизний звис (капельник) = slope.eave_overhang
//                 ПК — перекриття конькове: лист не доходить до конька на ПК = slope.ridge_gap
//                 ПЗ — перекриття замкове (нахлест рядів) = profile.length_overlap
// Потрібна довжина колонки = висота ската в колонці + К − ПК.
//
// Режими (slope.calc_mode):
//   order    «на замовлення»: металочерепиця, профнастил, фальц
//   stock1   «зі складу» цілими листами з дотриманням рядності (перебір сполучень, варіанти)
//   stock2   «зі складу» цілими листами з мінімізацією витрати (кожна колонка окремо)
//   stock3   «зі складу» розрахунковими листами з розкроєм складських (таблиця розкрою)
//   fixed    «Черепиця» (одномодульна, натуральна): цілі елементи, обрізки не використовуються
//   sheetcut «Листовий матеріал» (ондулін, шифер): лист фіксованої довжини, обрізки використовуються
// Усі розміри — цілі мм. PHP 7.4+.
// ============================================

namespace RoofCalc\Core\Calculation;

use RoofCalc\Core\Geometry\GeometryEngine;

class SheetLayoutEngine
{
    public const FIXED_TYPES = ['tile_module', 'natural_tile'];

    private array $profile;
    private array $slope;
    private array $polygon;
    private array $holes;
    private string $type;
    private string $mode;

    private int $fullWidth;
    private int $usefulWidth;
    private int $pz;            // ПЗ
    private int $k;             // К
    private int $pk;            // ПК
    private int $lmin;
    private int $lmax;          // максимальна реальна довжина
    private int $lmaxStd;       // максимальна стандартна довжина (МЧ: хвиля × n + ПЗ)
    private int $wave;
    private int $vShift = 0;    // фактичний зсув по вертикалі, мм
    private array $colStart = []; // низ першого листа колонки, якщо він відрізняється від низу колонки
    private int $rowsCount = 1;
    private int $rowLen = 0;
    private int $round;         // величина округлення
    private array $forbidden;   // [[min,max]] — межі виконувані
    private array $stock;       // [[len, qty|null]] за зростанням
    private string $direction;

    private array $warnings = [];
    private ?int $jointY = null;
    private ?array $jointRange = null;

    public function __construct(array $profile, array $slope, string $mode = 'order')
    {
        $this->profile = $profile;
        $this->slope   = $slope;
        $this->polygon = $slope['polygon_points'] ?? [];
        $this->holes   = $slope['holes'] ?? [];
        $this->type    = (string)($profile['type'] ?? 'tile');

        $this->fullWidth   = max(1, (int)$profile['full_width']);
        $this->usefulWidth = max(1, (int)$profile['useful_width']);
        $this->pz          = max(0, (int)$profile['length_overlap']);
        $this->k           = (int)($slope['eave_overhang'] ?? 0);
        $this->pk          = max(0, (int)($slope['ridge_gap'] ?? 0));
        $this->lmin        = max(1, (int)$profile['min_length']);
        $this->lmax        = max($this->lmin, (int)$profile['max_length']);
        $this->wave        = $this->type === 'tile' ? (int)($profile['wave_step'] ?? 0) : 0;
        $this->round       = (int)($profile['round_step'] ?? 0) ?: (int)($profile['cut_step'] ?? 0);
        if ($this->type === 'tile' && $this->round === $this->wave) $this->round = 10; // старі дані: крок різання = хвиля
        if ($this->round <= 0) $this->round = 1;
        $this->forbidden   = self::normalizeRanges($profile['forbidden_lengths'] ?? null);
        $this->stock       = self::normalizeStock($profile['stock_lengths'] ?? null);
        $this->direction   = (string)($slope['laying_direction'] ?? 'right_left');

        $std = (int)($profile['max_std_length'] ?? 0);
        if ($this->wave > 0) {
            $base = $std > 0 ? $std : $this->lmax;
            $n = (int)floor(($base - $this->pz) / $this->wave);
            $this->lmaxStd = max($this->lmin, $n * $this->wave + $this->pz);
        } else {
            $this->lmaxStd = $this->lmax;
        }

        if (in_array($this->type, self::FIXED_TYPES, true)) {
            $this->mode = 'fixed';
        } elseif ($this->type === 'sheet') {
            $this->mode = 'sheetcut';
        } elseif (in_array($mode, ['stock', 'stock1', 'stock2', 'stock3'], true)) {
            $this->mode = $mode === 'stock' ? 'stock2' : $mode;
            if (!$this->stock) {
                $this->mode = 'order';
                $this->warnings[] = 'Для матеріалу не задано складські довжини — розраховано «на замовлення»';
            }
        } else {
            $this->mode = 'order';
        }
    }

    // ---------- Нормалізація довідникових даних ----------

    // Діапазони невиконуваних розмірів: [{min,max}] або [[min,max]]
    public static function normalizeRanges($raw): array
    {
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $r) {
            if (!is_array($r)) continue;
            $a = $r['min'] ?? ($r[0] ?? null);
            $b = $r['max'] ?? ($r[1] ?? null);
            if ($a === null || $b === null) continue;
            $out[] = [(int)min($a, $b), (int)max($a, $b)];
        }
        return $out;
    }

    // Складські довжини: [len, ...] або [[len, qty], ...] або [{length, qty}]
    public static function normalizeStock($raw): array
    {
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw)) return [];
        $map = [];
        foreach ($raw as $r) {
            if (is_array($r)) {
                $len = (int)($r['length'] ?? ($r[0] ?? 0));
                $qty = $r['qty'] ?? ($r[1] ?? null);
            } else {
                $len = (int)$r; $qty = null;
            }
            if ($len <= 0) continue;
            $qty = ($qty === null || $qty === '') ? null : max(0, (int)$qty);
            if (!array_key_exists($len, $map)) $map[$len] = $qty;
            elseif ($map[$len] !== null && $qty !== null) $map[$len] += $qty;
            else $map[$len] = null;
        }
        ksort($map);
        $out = [];
        foreach ($map as $len => $qty) $out[] = [$len, $qty];
        return $out;
    }

    // ============================================
    // ГОЛОВНИЙ МЕТОД
    // ============================================
    public function calculate(): array
    {
        $geoErrors = GeometryEngine::validate($this->polygon);
        if (!empty($geoErrors)) return ['errors' => $geoErrors, 'warnings' => []];


        // 1. Колонки і потрібні довжини
        $bbox = GeometryEngine::boundingBox($this->polygon);
        // Укладка справа наліво: перша колонка прилягає до правого краю ската, неповна — зліва
        // (і навпаки для «зліва направо"). Нумерація листів — у напрямку укладки.
        // Зсув сітки колонок (кнопки ←/→ на схемі): + вправо, − вліво, мм
        $rtl = $this->direction !== 'left_right';
        $shift = (int)($this->slope['layout_shift'] ?? 0);
        $uw = $this->usefulWidth;
        $extra = (int)ceil(abs($shift) / $uw) + 1;
        $cols = (int)ceil($bbox['width'] / $uw) + $extra;

        // Зсув по вертикалі (кнопки ↑/↓, як у КП): низ листів опускається на vshift, довжини перераховуються.
        // Для металочерепиці зсув береться за модулем кроку хвилі (зсув на цілу хвилю = вихідне положення).
        $vshift = (int)($this->slope['v_shift'] ?? 0);
        if ($this->wave > 0) $vshift = (($vshift % $this->wave) + $this->wave) % $this->wave;
        else $vshift = max(-2000, min(2000, $vshift));
        $this->vShift = $vshift;

        $columns = [];
        for ($c = -$extra; $c <= $cols; $c++) {
            $x = $rtl
                ? $bbox['maxX'] + $shift - ($c + 1) * $uw
                : $bbox['minX'] + $shift + $c * $uw;
            if ($x >= $bbox['maxX'] || $x + $uw <= $bbox['minX']) continue;
            $r = $this->columnRange($x, $x + $this->usefulWidth);
            if ($r === null) continue;
            $need = ($r[1] - $r[0]) + $this->k - $this->pk + $vshift;
            if ($need <= 0) continue;
            $columns[] = ['col' => $c, 'x' => $x, 'bottom' => $r[0] - $this->k - $vshift, 'need' => $need];
        }

        // 2. Довжини листів у кожній колонці (знизу вгору)
        $alternatives = [];
        switch ($this->mode) {
            case 'stock1': $lens = $this->planStockRows($columns, $alternatives); break;
            case 'stock2': $lens = $this->planStockColumns($columns); break;
            case 'fixed':  $lens = $this->planFixed($columns); break;
            default:       $lens = $this->planOrder($columns); break; // order, stock3, sheetcut
        }

        // 3. Розміщення листів і площі
        $placements = [];
        $num = 1;
        $maxRows = 0;
        foreach ($columns as $i => $col) {
            $y = $this->colStart[$i] ?? $col['bottom'];
            $maxRows = max($maxRows, count($lens[$i]));
            foreach ($lens[$i] as $row => $len) {
                $cover = $this->coveredArea($col['x'], $y, $this->usefulWidth, $len);
                if ($cover > 1.0) {
                    $placements[] = [
                        'sheet_number' => $num++, 'col_index' => $col['col'], 'row_index' => $row,
                        'x' => (int)$col['x'], 'y' => (int)$y,
                        'full_width' => $this->fullWidth, 'useful_width' => $this->usefulWidth, 'length' => $len,
                        'lap' => $rtl ? 'left' : 'right', // бік, куди виходить нахлест (повна ширина − корисна)
                        'intersect_area_m2' => round($cover / 1e6, 4),
                        'full_area_m2'      => round($this->fullWidth * $len / 1e6, 4),
                        'waste_area_m2'     => round(max(0, $this->fullWidth * $len - $cover) / 1e6, 4),
                    ];
                }
                $y += $len - $this->pz;
            }
        }

        // 4. Що купувати: листи укладки або складські / цілі листи після розкрою
        $laid = array_column($placements, 'length');
        $cutting = [];
        $purchase = $laid;
        if ($this->mode === 'stock3') {
            $purchase = $this->cutFromStock($laid, $cutting);
        } elseif ($this->mode === 'sheetcut') {
            $purchase = $this->cutFromSheets($laid, $cutting);
        } elseif (in_array($this->mode, ['stock1', 'stock2', 'fixed'], true)) {
            $this->checkStockQty($laid);
        }

        // 5. Показники за формулами КП (розділ 13.10 ТЗ)
        $slopeArea = GeometryEngine::polygonAreaM2($this->polygon);
        $holesArea = 0.0;
        foreach ($this->holes as $h) if (is_array($h) && count($h) >= 3) $holesArea += GeometryEngine::polygonAreaM2($h);
        $netArea  = max(0.0, $slopeArea - $holesArea);
        $running  = array_sum($purchase) / 1000;               // погонні метри
        $sUseful  = $this->usefulWidth / 1000 * $running;
        $sFull    = $this->fullWidth / 1000 * $running;
        $wastePct = $sUseful > 0 ? max(0, ($sUseful - $netArea) * 100 / $sUseful) : 0;

        if (in_array($this->mode, ['stock1', 'stock2', 'stock3'], true)) {
            $this->warnings[] = 'Режим «зі складу» ' . substr($this->mode, -1) . ': ' . self::modeLabel($this->mode);
        }

        return [
            'profile_name'       => $this->profile['name'] ?? '',
            'material_type'      => $this->type,
            'mode'               => $this->mode,
            'slope_area_m2'      => round($slopeArea, 3),
            'slope_width_mm'     => (int)$bbox['width'],
            'slope_height_mm'    => (int)$bbox['height'],
            'cols_count'         => $cols,
            'rows_count'         => $maxRows,
            'total_sheets'       => count($purchase),
            'laid_sheets'        => count($laid),
            'sheet_length_mm'    => $purchase ? max($purchase) : 0,
            'sheet_full_width'   => $this->fullWidth,
            'sheet_useful_width' => $this->usefulWidth,
            'sheets_by_length'   => self::groupLengths($purchase, $this->fullWidth),
            'laid_by_length'     => self::groupLengths($laid, $this->fullWidth),
            'cutting'            => $cutting,
            'stock_usage'        => $this->stockUsage($purchase),
            'alternatives'       => $alternatives,
            'placements'         => $placements,
            'running_m'          => round($running, 3),
            'useful_area_m2'     => round($sUseful, 3),
            'total_full_area_m2' => round($sFull, 3),
            'order_area_m2'      => round($sFull, 3),
            'waste_pct'          => round($wastePct, 1),
            'max_real_length_mm' => $this->lmax,
            'max_std_length_mm'  => $this->lmaxStd,
            'rounding_mm'        => $this->round,
            'joint_y_mm'         => $this->jointY,
            'joint_range_mm'     => $this->jointRange,
            'v_shift_mm'         => $this->vShift,
            'wave_step_mm'       => $this->wave,
            'split_forced'       => !empty($this->slope['split_forced']),
            'rows_user'          => (int)($this->slope['rows_count'] ?? 0),
            'row_len_mm'         => $this->rowLen,
            'layout_shift_mm'    => (int)($this->slope['layout_shift'] ?? 0),
            'joint_custom'       => isset($this->slope['joint_y']) && $this->slope['joint_y'] !== null && $this->slope['joint_y'] !== '',
            'warnings'           => array_values(array_unique($this->warnings)),
            'errors'             => [],
        ];
    }

    public static function modeLabel(string $m): string
    {
        $labels = [
            'order'    => 'на замовлення',
            'stock1'   => 'цілими складськими листами з дотриманням рядності',
            'stock2'   => 'цілими складськими листами з мінімізацією витрати',
            'stock3'   => 'розрахунковими листами з розкроєм складських',
            'fixed'    => 'цілими елементами',
            'sheetcut' => 'з розкроєм листів і використанням обрізків',
        ];
        return $labels[$m] ?? $m;
    }

    // ============================================
    // «На замовлення» (і основа для stock3 / sheetcut)
    // ============================================
    private function planOrder(array $columns): array
    {
        $max = $this->lmax;
        $maxLower = $this->lmaxStd;
        if ($this->mode === 'stock3')   { $max = $maxLower = $this->stockMax(); }
        if ($this->mode === 'sheetcut') { $max = $maxLower = $this->lmax; }

        // Лінія стику (КП: «висота ряду»): якщо скат не вкривається одним листом, усі колонки ділимо
        // ОДНІЄЮ горизонталлю. За замовчуванням — посередині найвищої частини ската, користувач може її зсунути
        // (slope.joint_y — абсолютна висота верхнього краю нижнього листа, мм).
        $split = [];
        foreach ($columns as $i => $col) if ($this->mode !== 'sheetcut' && $col['need'] > $max) $split[] = $i;
        // Висота ряду, задана кнопкою ⇕ (як у КП): rows_count = d — ряд стає в d разів коротшим за Lmax станд.
        // (L = хвиля × ⌈n/d⌉ + ПЗ). 0/1 — автоматично (ряд = Lmax станд., ділимо лише коли лист не вміщається).
        $div = (int)($this->slope['rows_count'] ?? 0);
        if ($div <= 1 && !empty($this->slope['split_forced'])) $div = 2;
        if ($this->mode === 'sheetcut') $div = 0;
        $rowLen = $maxLower;
        if ($div >= 2) {
            $rowLen = max($this->lmin, min($maxLower, $this->stdLen((int)ceil(($maxLower - $this->pz) / $div) + $this->pz, $maxLower)));
            foreach ($columns as $i => $col) if (!in_array($i, $split, true) && $col['need'] > $rowLen) $split[] = $i;
        }
        $byRequest = $div >= 2;

        $out = [];
        if (!$split) {
            foreach ($columns as $col) {
                $left = $col['need'];
                $lens = [];
                for ($i = 0; $i < 50 && $left > $max; $i++) { $lens[] = $maxLower; $left -= ($maxLower - $this->pz); }
                if ($left > 0) {
                    if (count($lens)) $left += $this->pz;
                    $lens[] = $this->mode === 'sheetcut' ? min($left, $this->lmax) : $this->fit($left, $max);
                }
                $out[] = $lens;
            }
            if ($this->mode === 'sheetcut' && array_filter($out, function ($l) { return count($l) > 1; })) {
                $this->warnings[] = sprintf('Скат довший за лист — укладка в кілька рядів, нахлест %d мм', $this->pz);
            }
            return $out;
        }

        $minBottom = PHP_INT_MAX; $maxTop = PHP_INT_MIN;
        foreach ($split as $i) {
            $minBottom = min($minBottom, $columns[$i]['bottom']);
            $maxTop = max($maxTop, $columns[$i]['bottom'] + $columns[$i]['need']);
        }
        $span = $maxTop - $minBottom;
        // Допустимий діапазон першої лінії: нижній лист від Lmin до Lmax станд. (від найнижчого карниза)
        $lo = $minBottom + $this->lmin; $hi = $minBottom + $maxLower;
        $user = isset($this->slope['joint_y']) && $this->slope['joint_y'] !== null && $this->slope['joint_y'] !== '' ? (int)$this->slope['joint_y'] : null;
        if ($user !== null) {
            // як у КП: ↑/↓ рухають сітку рядів точно на крок; нижній лист — стандартної довжини
            // (за потреби звисає нижче карниза), верхній ряд коротшає/довшає на той самий крок
            $joint = max($lo, min($hi, $user));
            if ($joint !== $user) $this->warnings[] = sprintf('Лінію стику обмежено довжиною листа: допустимо від %.3f до %.3f м', $lo / 1000, $hi / 1000);
        } else {
            $joint = $minBottom + $rowLen;   // як у КП: перший ряд — повна висота ряду
        }
        $rows = 1 + (int)ceil(max(0, $maxTop - $joint) / max(1, $rowLen - $this->pz));

        // Сітка ліній стику на весь скат: J0 = $joint, далі через (висота ряду − нахлест).
        // Кожна колонка ділиться саме цими лініями — і та, що починається вище першої лінії (над вирізом/уступом).
        $step = max(1, $rowLen - $this->pz);
        $lines = [];
        for ($y = $joint; $y < $maxTop && count($lines) < 60; $y += $step) $lines[] = $y;

        foreach ($columns as $i => $col) {
            $need = $col['need'];
            $bot = $col['bottom'];
            $top = $bot + $need;
            // перша лінія, вище низу колонки щонайменше на Lmin
            $first = null;
            foreach ($lines as $ly) { if ($ly > $bot + $this->lmin - 1 && $ly < $top) { $first = $ly; break; } }
            if ($first === null) {   // жодна лінія стику не перетинає колонку — одним листом
                if ($first === null && $need > $max) {
                    // лінії не перетинають колонку, але лист не вміщається — ряди знизу
                    $lens = []; $left = $need;
                    for ($k = 0; $k < 50 && $left > $max; $k++) { $lens[] = $rowLen; $left -= ($rowLen - $this->pz); }
                    if ($left > 0) $lens[] = $this->fit($left + $this->pz, $max);
                    $out[] = $lens; continue;
                }
                $out[] = [$this->fit($need, $max)]; continue;
            }
            // нижній лист — до першої лінії: від найнижчого карниза стандартна довжина (хвиля × n + ПЗ),
            // у колонках з вищим низом — рівно до лінії
            $len0 = ($bot <= $minBottom && $first === $joint)
                ? max($this->lmin, min($maxLower, $this->stdLen($first - $bot, $maxLower)))
                : max($this->lmin, min($maxLower, $this->fit($first - $bot, $maxLower)));
            $this->colStart[$i] = $first - $len0;   // низ першого листа (може бути нижче карниза)
            $lens = [$len0];
            $cur = $first;
            for ($k = 0; $k < 50; $k++) {
                $remain = $top - $cur + $this->pz;   // скільки ще вкрити (з нахлестом)
                if ($remain <= $this->pz) break;
                if ($remain <= $rowLen || ($div < 2 && $remain <= $max)) { $lens[] = $this->fit($remain, $max); break; }
                $lens[] = $rowLen; $cur += $step;
            }
            $out[] = $lens;
        }
        $this->jointY = $joint;
        $this->jointRange = [$lo, $hi];
        $this->rowsCount = $rows;
        $this->rowLen = $rowLen;
        $this->warnings[] = $byRequest
            ? sprintf('Висота ряду %.3f м — укладка у %d ряди, перша лінія стику на висоті %.3f м, нахлест %d мм', $rowLen / 1000, $rows, $joint / 1000, $this->pz)
            : sprintf('Скат довший за лист — укладка у %d ряди, лінія стику на висоті %.3f м, нахлест %d мм', $rows, $joint / 1000, $this->pz);
        return $out;
    }

    // Найближча стандартна довжина (для лінії стику, яку рухає користувач)
    private function nearestStd(int $len, int $max): int
    {
        $step = $this->wave > 0 ? $this->wave : $this->round;
        $base = $this->wave > 0 ? $this->pz : 0;
        $l = (int)(round(($len - $base) / $step) * $step + $base);
        return min(max($l, $this->lmin), $max);
    }

    // Стандартна довжина: металочерепиця — хвиля × n + ПЗ (малюнок суміщається), інші — округлення
    private function stdLen(int $len, int $max): int
    {
        if ($this->wave > 0) {
            $l = (int)(ceil(($len - $this->pz) / $this->wave) * $this->wave + $this->pz);
            return min($l, $max);
        }
        return $this->fit($len, $max);
    }

    // Довжина «на замовлення»: округлення → Lmin → невиконувані діапазони (межі виконувані)
    public function fit(int $len, ?int $max = null): int
    {
        $max = $max ?? $this->lmax;
        $need = $len;
        $len = (int)(ceil($len / $this->round) * $this->round);
        if ($len < $this->lmin) $len = $this->lmin;
        $r = $this->forbiddenRange($len);
        if ($r) {
            $orig = $len;
            // як у КП: беремо нижню межу діапазону, якщо вона ще покриває потрібну довжину, інакше — верхню
            if ($r[0] >= $need && $r[0] >= $this->lmin) $len = $r[0];
            else $len = $r[1] <= $max ? $r[1] : max($this->lmin, $r[0]);
            $this->warnings[] = sprintf('Довжина %d мм у діапазоні невиконуваних розмірів %d–%d мм — взято %d мм', $orig, $r[0], $r[1], $len);
        }
        return min($len, $max);
    }

    private function forbiddenRange(int $len): ?array
    {
        foreach ($this->forbidden as $r) if ($len > $r[0] && $len < $r[1]) return $r;
        return null;
    }

    // ============================================
    // «Зі складу» 2: кожна колонка — мінімальна сумарна довжина цілих складських листів
    // ============================================
    private function planStockColumns(array $columns): array
    {
        $lengths = array_column($this->stock, 0);
        $out = [];
        foreach ($columns as $col) $out[] = $this->bestStack($col['need'], $lengths);
        return $out;
    }

    private function bestStack(int $need, array $lengths, int $maxRows = 4): array
    {
        $best = null; $bestSum = PHP_INT_MAX;
        $pz = $this->pz;
        $search = function (array $seq, int $covered) use (&$search, &$best, &$bestSum, $need, $lengths, $maxRows, $pz) {
            if ($covered >= $need) {
                $sum = array_sum($seq);
                if ($sum < $bestSum || ($sum === $bestSum && count($seq) < count($best))) { $best = $seq; $bestSum = $sum; }
                return;
            }
            if (count($seq) >= $maxRows) return;
            foreach ($lengths as $l) {
                $add = count($seq) ? $l - $pz : $l;
                if ($add <= 0) continue;
                $search(array_merge($seq, [$l]), $covered + $add);
            }
        };
        $search([], 0);
        if ($best === null) {
            $this->warnings[] = 'На складі недостатньо довгих листів! Спробуйте знизити висоту ряду або збільште кількість довгих листів';
            return [(int)end($lengths)];
        }
        return $best;
    }

    // ============================================
    // «Зі складу» 1: однакові нижні ряди на весь скат, верхній лист колонки — найменший достатній.
    // Повний перебір сполучень; найкращий за витратою + перелік варіантів (як у КП «9-й з 15»).
    // ============================================
    private function planStockRows(array $columns, array &$alternatives): array
    {
        $lengths = array_column($this->stock, 0);

        $cands = [[]];
        $frontier = [[]];
        for ($d = 1; $d <= 3; $d++) {
            $next = [];
            foreach ($frontier as $seq) foreach ($lengths as $l) $next[] = array_merge($seq, [$l]);
            $cands = array_merge($cands, $next);
            $frontier = $next;
        }

        $results = [];
        foreach ($cands as $lower) {
            $plan = []; $total = 0; $ok = true; $usedLower = false;
            foreach ($columns as $col) {
                $lens = []; $covered = 0;
                foreach ($lower as $i => $l) {
                    if ($covered >= $col['need']) break;
                    $rest = $col['need'] - $covered + ($i ? $this->pz : 0);
                    if ($rest <= $l && $i === count($lower) - 1) break; // останній нижній ряд не потрібен — піде верхній лист
                    $lens[] = $l;
                    $covered += $i ? $l - $this->pz : $l;
                    $usedLower = true;
                }
                if ($covered < $col['need']) {
                    $rem = $col['need'] - $covered + ($lens ? $this->pz : 0);
                    $top = null;
                    foreach ($lengths as $l) if ($l >= $rem) { $top = $l; break; }
                    if ($top === null) { $ok = false; break; }
                    $lens[] = $top;
                }
                $plan[] = $lens;
                $total += array_sum($lens);
            }
            if (!$ok || ($lower && !$usedLower)) continue;
            $key = implode('+', $lower);
            if (!isset($results[$key])) $results[$key] = ['lower' => $lower, 'plan' => $plan, 'total' => $total];
        }
        if (!$results) {
            $this->warnings[] = 'На складі недостатньо довгих листів! Спробуйте знизити висоту ряду або збільште кількість довгих листів';
            return $this->planStockColumns($columns);
        }
        uasort($results, function ($a, $b) {
            return ($a['total'] <=> $b['total']) ?: (count($a['lower']) <=> count($b['lower']));
        });
        $i = 0;
        foreach ($results as $r) {
            if ($i++ >= 15) break;
            $alternatives[] = ['rows' => $r['lower'], 'running_m' => round($r['total'] / 1000, 3)];
        }
        $first = reset($results);
        return $first['plan'];
    }

    // ============================================
    // «Черепиця»: фіксований елемент, обрізки не використовуються
    // ============================================
    private function planFixed(array $columns): array
    {
        $L = $this->lmax;
        $step = max(1, $L - $this->pz);
        $out = [];
        foreach ($columns as $col) {
            $n = $col['need'] <= $L ? 1 : (int)ceil(($col['need'] - $L) / $step) + 1;
            $out[] = array_fill(0, $n, $L);
        }
        return $out;
    }

    // ============================================
    // Розкрій
    // ============================================

    // stock3: розрахункові листи кроїмо зі складських (найкраще входження, далі — найменший достатній лист)
    private function cutFromStock(array $pieces, array &$cutting): array
    {
        $avail = [];
        foreach ($this->stock as $s) $avail[$s[0]] = $s[1]; // null = без обмеження
        $need = array_sum($pieces);
        $have = 0; $unlimited = false;
        foreach ($avail as $len => $q) { if ($q === null) $unlimited = true; else $have += $len * $q; }
        if (!$unlimited && $have < $need) $this->warnings[] = 'На складі недостатньо матеріалу!';

        $minRemainder = $this->wave > 0 ? $this->wave + $this->pz : 1;
        rsort($pieces);
        $sheets = [];
        foreach ($pieces as $p) {
            $bi = -1; $bestRest = PHP_INT_MAX;
            foreach ($sheets as $i => $s) {
                if ($s['rest'] >= $p && $s['rest'] - $p < $bestRest) { $bi = $i; $bestRest = $s['rest'] - $p; }
            }
            if ($bi < 0) {
                $pick = null;
                foreach ($avail as $len => $q) if ($len >= $p && ($q === null || $q > 0)) { $pick = $len; break; }
                if ($pick === null) {
                    $this->warnings[] = 'На складі недостатньо довгих листів! Спробуйте знизити висоту ряду або збільште кількість довгих листів';
                    $sheets[] = ['len' => $p, 'rest' => 0, 'cuts' => [$p], 'missing' => true];
                    continue;
                }
                if ($avail[$pick] !== null) $avail[$pick]--;
                $sheets[] = ['len' => $pick, 'rest' => $pick, 'cuts' => []];
                $bi = count($sheets) - 1;
            }
            $sheets[$bi]['cuts'][] = $p;
            $sheets[$bi]['rest'] -= $p;
        }
        $cutting = self::groupCutting($sheets, $minRemainder);
        return array_column($sheets, 'len');
    }

    // sheetcut: листи фіксованої довжини, обрізки йдуть у справу
    private function cutFromSheets(array $pieces, array &$cutting): array
    {
        $L = $this->lmax;
        rsort($pieces);
        $sheets = [];
        foreach ($pieces as $p) {
            $p = min($p, $L);
            $bi = -1; $bestRest = PHP_INT_MAX;
            foreach ($sheets as $i => $s) {
                if ($s['rest'] >= $p && $s['rest'] - $p < $bestRest) { $bi = $i; $bestRest = $s['rest'] - $p; }
            }
            if ($bi < 0) { $sheets[] = ['len' => $L, 'rest' => $L, 'cuts' => []]; $bi = count($sheets) - 1; }
            $sheets[$bi]['cuts'][] = $p;
            $sheets[$bi]['rest'] -= $p;
        }
        $cutting = self::groupCutting($sheets, 1);
        return array_column($sheets, 'len');
    }

    // Однакові схеми розкрою групуються: «1–10  2600 → 2561  залишок»
    private static function groupCutting(array $sheets, int $minRemainder): array
    {
        $groups = []; $n = 0;
        foreach ($sheets as $s) {
            $n++;
            $cuts = $s['cuts']; rsort($cuts);
            $rest = $s['rest'] >= $minRemainder ? $s['rest'] : 0;
            $key = $s['len'] . ':' . implode(',', $cuts) . ':' . $rest . ':' . (empty($s['missing']) ? 0 : 1);
            if (!isset($groups[$key])) {
                $groups[$key] = ['from' => $n, 'to' => $n, 'count' => 0, 'sheet_length' => $s['len'], 'cuts' => $cuts, 'remainder' => $rest, 'missing' => !empty($s['missing'])];
            }
            $groups[$key]['count']++;
            $groups[$key]['to'] = $n;
        }
        return array_values($groups);
    }

    // ============================================
    // Склад: перевірка наявності
    // ============================================
    private function checkStockQty(array $used): void
    {
        $limited = false;
        foreach ($this->stock as $s) if ($s[1] !== null) $limited = true;
        if (!$limited) return;
        $cnt = array_count_values($used);
        $short = [];
        foreach ($this->stock as $s) {
            if ($s[1] === null) continue;
            $u = $cnt[$s[0]] ?? 0;
            if ($u > $s[1]) $short[] = sprintf('%d мм: потрібно %d, є %d', $s[0], $u, $s[1]);
        }
        if ($short) $this->warnings[] = 'На складі недостатньо листів — ' . implode('; ', $short);
    }

    private function stockUsage(array $purchase): array
    {
        if (!$this->stock || in_array($this->mode, ['order', 'sheetcut'], true)) return [];
        $cnt = array_count_values($purchase);
        $out = [];
        foreach ($this->stock as $s) $out[] = ['length' => $s[0], 'used' => $cnt[$s[0]] ?? 0, 'available' => $s[1]];
        return $out;
    }

    private function stockMax(): int
    {
        return $this->stock ? (int)$this->stock[count($this->stock) - 1][0] : $this->lmax;
    }

    // ============================================
    // Геометрія
    // ============================================
    private function columnRange(float $x0, float $x1): ?array
    {
        $ys = [];
        $n = count($this->polygon);
        // колонка може частково виходити за скат (зсув сітки) — пробні точки беремо в межах ската
        $pxs = array_column($this->polygon, 0);
        $x0 = max($x0, (float)min($pxs)); $x1 = min($x1, (float)max($pxs));
        if ($x1 - $x0 < 1) return null;
        foreach ([$x0 + 0.5, ($x0 + $x1) / 2, $x1 - 0.5] as $x) {
            for ($i = 0; $i < $n; $i++) {
                [$ax, $ay] = $this->polygon[$i];
                [$bx, $by] = $this->polygon[($i + 1) % $n];
                if ($ax == $bx) continue;
                if ($x < min($ax, $bx) || $x > max($ax, $bx)) continue;
                $t = ($x - $ax) / ($bx - $ax);
                $ys[] = $ay + $t * ($by - $ay);
            }
        }
        foreach ($this->polygon as [$px, $py]) if ($px >= $x0 && $px <= $x1) $ys[] = $py;
        if (count($ys) < 2) return null;
        $lo = (int)floor(min($ys)); $hi = (int)ceil(max($ys));
        return $hi - $lo > 0 ? [$lo, $hi] : null;
    }

    private function coveredArea(float $x, float $y, int $w, int $h): float
    {
        $a = GeometryEngine::rectPolygonIntersectionArea((int)$x, (int)$y, $w, $h, $this->polygon);
        foreach ($this->holes as $hole) {
            if (is_array($hole) && count($hole) >= 3) $a -= GeometryEngine::rectPolygonIntersectionArea((int)$x, (int)$y, $w, $h, $hole);
        }
        return max(0.0, $a);
    }

    public static function groupLengths(array $lens, int $fullWidth): array
    {
        $g = [];
        foreach ($lens as $L) {
            if (!isset($g[$L])) $g[$L] = ['length_mm' => $L, 'full_width_mm' => $fullWidth, 'count' => 0, 'full_area_m2' => 0.0];
            $g[$L]['count']++;
            $g[$L]['full_area_m2'] = round($g[$L]['full_area_m2'] + $fullWidth * $L / 1e6, 4);
        }
        krsort($g);
        return array_values($g);
    }
}
