<?php
// ============================================
// ABT Покрівля — core/calculation/SheetLayoutEngine.php
//
// Єдиний розрахунок укладки листових і штучних матеріалів, як у «Кровля Профи»:
//   tile          металочерепиця         — «на замовлення» (крок хвилі, заборонені довжини)
//                                           або «зі складу» (лише складський типоряд довжин)
//   profile       профнастил             — «на замовлення» (округлення) або «зі складу»
//   tile_module   одномодульна (Метробонд) — модуль фіксованої довжини, не ріжеться
//   sheet         листові (ондулін, шифер) — лист фіксованого розміру, нахлести в обидва боки
//   natural_tile  натуральна черепиця    — штучний розрахунок, ряди × штуки
//
// Усі розміри — цілі мм. Площі — м². PHP 7.4+.
// ============================================

namespace RoofCalc\Core\Calculation;

use RoofCalc\Core\Geometry\GeometryEngine;

class SheetLayoutEngine
{
    public const FIXED_TYPES = ['tile_module', 'sheet', 'natural_tile'];

    private array $profile;
    private array $slope;
    private array $polygon;
    private array $holes;
    private string $type;
    private string $mode;        // order | stock | fixed

    private int $fullWidth;
    private int $usefulWidth;
    private int $lengthOverlap;
    private int $minLength;
    private int $maxLength;
    private int $waveStep;
    private int $roundStep;
    private array $forbidden;    // [[min,max], ...]
    private array $stock;        // [len, ...] за зростанням
    private int $eaveOverhang;
    private int $ridgeGap;
    private string $direction;

    private array $warnings = [];

    public function __construct(array $profile, array $slope, string $mode = 'order')
    {
        $this->profile = $profile;
        $this->slope   = $slope;
        $this->polygon = $slope['polygon_points'] ?? [];
        $this->holes   = $slope['holes'] ?? [];
        $this->type    = (string)($profile['type'] ?? 'tile');

        $this->fullWidth     = max(1, (int)$profile['full_width']);
        $this->usefulWidth   = max(1, (int)$profile['useful_width']);
        $this->lengthOverlap = max(0, (int)$profile['length_overlap']);
        $this->minLength     = max(1, (int)$profile['min_length']);
        $this->maxLength     = max($this->minLength, (int)$profile['max_length']);
        // Крок хвилі — лише для металочерепиці; профнастил округлюється кроком різання
        $this->waveStep      = ($profile['type'] ?? '') === 'tile' ? (int)($profile['wave_step'] ?? 0) : 0;
        // Крок округлення довжини: «Крок різання» з довідника матеріалів (cut_step)
        $this->roundStep     = (int)($profile['round_step'] ?? 0) ?: (int)($profile['cut_step'] ?? 0);
        $this->forbidden     = self::normalizeRanges($profile['forbidden_lengths'] ?? null);
        $this->stock         = self::normalizeStock($profile['stock_lengths'] ?? null);
        $this->eaveOverhang  = (int)($slope['eave_overhang'] ?? 0);
        $this->ridgeGap      = (int)($slope['ridge_gap'] ?? 0);
        $this->direction     = (string)($slope['laying_direction'] ?? 'right_left');

        if (in_array($this->type, self::FIXED_TYPES, true)) {
            $this->mode = 'fixed';
        } elseif ($mode === 'stock') {
            $this->mode = 'stock';
            if (!$this->stock) {
                $this->mode = 'order';
                $this->warnings[] = 'Для матеріалу не задано складський типоряд довжин — розраховано «на замовлення»';
            }
        } else {
            $this->mode = 'order';
        }
    }

    // Заборонені довжини приходять у двох форматах: [{min,max}] (старий) і [[min,max]] (адмінка)
    public static function normalizeRanges($raw): array
    {
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $r) {
            if (!is_array($r)) continue;
            $min = $r['min'] ?? ($r[0] ?? null);
            $max = $r['max'] ?? ($r[1] ?? null);
            if ($min === null || $max === null) continue;
            $out[] = [(int)min($min, $max), (int)max($min, $max)];
        }
        return $out;
    }

    public static function normalizeStock($raw): array
    {
        if (is_string($raw)) $raw = json_decode($raw, true);
        if (!is_array($raw)) return [];
        $out = array_values(array_unique(array_filter(array_map('intval', $raw), function ($v) { return $v > 0; })));
        sort($out);
        return $out;
    }

    // ============================================
    // ГОЛОВНИЙ МЕТОД
    // ============================================
    public function calculate(): array
    {
        $geoErrors = GeometryEngine::validate($this->polygon);
        if (!empty($geoErrors)) return ['errors' => $geoErrors, 'warnings' => []];

        $angle    = (float)($this->slope['slope_angle'] ?? 0);
        $minAngle = (float)($this->profile['min_slope_angle'] ?? 0);
        if ($minAngle > 0 && $angle > 0 && $angle < $minAngle) {
            $this->warnings[] = sprintf('Кут нахилу %.1f° менше мінімального для матеріалу (%.1f°)', $angle, $minAngle);
        }

        $bbox = GeometryEngine::boundingBox($this->polygon);
        $cols = (int)ceil($bbox['width'] / $this->usefulWidth);
        $colOrder = range(0, max(0, $cols - 1));
        if ($this->direction !== 'left_right') $colOrder = array_reverse($colOrder);

        $placements = [];
        $num = 1;
        $maxRows = 0;
        $usefulPieceArea = 0.0;   // корисна площа, що лягла на скат (мм²)
        $fullArea = 0.0;          // площа замовлених листів по повній ширині (мм²)

        foreach ($colOrder as $col) {
            $x  = $bbox['minX'] + $col * $this->usefulWidth;
            $yr = $this->columnRange($x, $x + $this->usefulWidth);
            if ($yr === null) continue;
            [$yBottom, $yTop] = $yr;

            $need    = ($yTop - $yBottom) + $this->eaveOverhang + $this->ridgeGap;
            $lengths = $this->splitColumn($need);
            $maxRows = max($maxRows, count($lengths));

            $y = $yBottom - $this->eaveOverhang;
            foreach ($lengths as $row => $len) {
                $cover = $this->coveredArea($x, $y, $this->usefulWidth, $len);
                if ($cover > 1.0) {
                    $placements[] = [
                        'sheet_number'      => $num++,
                        'col_index'         => $col,
                        'row_index'         => $row,
                        'x'                 => (int)$x,
                        'y'                 => (int)$y,
                        'full_width'        => $this->fullWidth,
                        'useful_width'      => $this->usefulWidth,
                        'length'            => $len,
                        'intersect_area_m2' => round($cover / 1e6, 4),
                        'full_area_m2'      => round($this->fullWidth * $len / 1e6, 4),
                        'waste_area_m2'     => round(max(0, $this->fullWidth * $len - $cover) / 1e6, 4),
                    ];
                    $usefulPieceArea += $cover;
                    $fullArea        += $this->fullWidth * $len;
                }
                $y += $len - $this->lengthOverlap;
            }
        }

        $slopeArea = GeometryEngine::polygonAreaM2($this->polygon);
        $groups    = $this->groupByLength($placements);
        $total     = count($placements);
        $longest   = $groups ? max(array_column($groups, 'length_mm')) : 0;

        if ($this->mode === 'stock') {
            $this->warnings[] = 'Режим «зі складу»: довжини з типоряду ' . implode(', ', $this->stock) . ' мм';
        }

        return [
            'profile_name'        => $this->profile['name'] ?? '',
            'material_type'       => $this->type,
            'mode'                => $this->mode,
            'slope_area_m2'       => round($slopeArea, 3),
            'slope_width_mm'      => (int)$bbox['width'],
            'slope_height_mm'     => (int)$bbox['height'],
            'cols_count'          => $cols,
            'rows_count'          => $maxRows,
            'total_sheets'        => $total,
            'sheet_length_mm'     => $longest,
            'sheet_full_width'    => $this->fullWidth,
            'sheet_useful_width'  => $this->usefulWidth,
            'sheets_by_length'    => $groups,
            'placements'          => $placements,
            'total_full_area_m2'  => round($fullArea / 1e6, 3),
            'order_area_m2'       => round($fullArea / 1e6, 3),
            'useful_area_m2'      => round($usefulPieceArea / 1e6, 3),
            'total_waste_area_m2' => round(max(0, $fullArea - $usefulPieceArea) / 1e6, 3),
            'waste_pct'           => $fullArea > 0 ? round(max(0, $fullArea - $usefulPieceArea) / $fullArea * 100, 1) : 0,
            'warnings'            => array_values(array_unique($this->warnings)),
            'errors'              => [],
        ];
    }

    // ============================================
    // Довжини листів у колонці (знизу вгору)
    // ============================================
    public function splitColumn(int $need): array
    {
        if ($need <= 0) return [];
        switch ($this->mode) {
            case 'fixed': return $this->splitFixed($need);
            case 'stock': return $this->splitStock($need);
            default:      return $this->splitOrder($need);
        }
    }

    // «На замовлення»: якщо вміщується — один лист; інакше кілька рядів рівної довжини з нахлестом
    private function splitOrder(int $need): array
    {
        $max = $this->maxAllowedLength();
        if ($need <= $max) return [$this->fitOrderLength($need)];

        $step = max(1, $max - $this->lengthOverlap);
        $rows = (int)ceil(($need - $this->lengthOverlap) / $step);
        $rows = max(2, $rows);
        $each = (int)ceil(($need + ($rows - 1) * $this->lengthOverlap) / $rows);
        $this->warnings[] = "Скат довший за максимальний лист ({$this->maxLength} мм) — {$rows} ряди з нахлестом {$this->lengthOverlap} мм";

        $out = [];
        $left = $need;
        for ($r = 0; $r < $rows; $r++) {
            $isLast = ($r === $rows - 1);
            $len = $isLast ? $this->fitOrderLength($left) : $this->fitOrderLength($each);
            $out[] = $len;
            $left -= ($len - $this->lengthOverlap);
            if ($left <= $this->lengthOverlap && !$isLast) break;
        }
        return $out;
    }

    // Найбільша довжина, яку реально можна замовити (з урахуванням кроку хвилі і заборонених діапазонів)
    private function maxAllowedLength(): int
    {
        $len = $this->maxLength;
        if ($this->waveStep > 0) $len = (int)(floor($len / $this->waveStep) * $this->waveStep);
        for ($i = 0; $i < 200 && $this->isForbidden($len); $i++) $len -= max(1, $this->waveStep ?: $this->roundStep ?: 10);
        return max($this->minLength, $len);
    }

    // Довжина «на замовлення»: крок хвилі / округлення → мінімум → обхід заборонених довжин
    public function fitOrderLength(int $len): int
    {
        $step = $this->waveStep > 0 ? $this->waveStep : $this->roundStep;
        if ($step > 0) $len = (int)(ceil($len / $step) * $step);
        if ($len < $this->minLength) {
            $len = $this->minLength;
            if ($step > 0) $len = (int)(ceil($len / $step) * $step);
        }
        $range = $this->forbiddenRange($len);
        if ($range) {
            $orig = $len;
            $up = $range[1] + 1;
            if ($step > 0) $up = (int)(ceil($up / $step) * $step);
            $tries = 0;
            while ($this->isForbidden($up) && $tries++ < 50) $up += max(1, $step ?: 10);
            if ($up <= $this->maxLength) {
                $len = $up;
            } else {
                $down = $range[0] - 1;
                if ($step > 0) $down = (int)(floor($down / $step) * $step);
                $len = max($this->minLength, $down);
            }
            $this->warnings[] = sprintf('Довжина %d мм у забороненому діапазоні %d–%d мм — скориговано до %d мм', $orig, $range[0], $range[1], $len);
        }
        return min($len, max($this->maxLength, $this->minLength));
    }

    private function forbiddenRange(int $len): ?array
    {
        foreach ($this->forbidden as $r) if ($len >= $r[0] && $len <= $r[1]) return $r;
        return null;
    }
    private function isForbidden(int $len): bool { return $this->forbiddenRange($len) !== null; }

    // «Зі складу»: найменша складська довжина, що перекриває залишок; інакше найдовша і наступний ряд
    private function splitStock(int $need): array
    {
        $maxStock = end($this->stock);
        $out = [];
        $left = $need;
        for ($i = 0; $i < 50 && $left > 0; $i++) {
            $pick = null;
            foreach ($this->stock as $s) { if ($s >= $left) { $pick = $s; break; } }
            if ($pick === null) $pick = $maxStock;
            $out[] = $pick;
            if ($pick >= $left) break;
            $left -= ($pick - $this->lengthOverlap);
        }
        return $out;
    }

    // Фіксований лист / модуль / черепиця: ряди однакових елементів
    private function splitFixed(int $need): array
    {
        $len  = $this->maxLength;
        $step = max(1, $len - $this->lengthOverlap);
        $rows = $need <= $len ? 1 : (int)ceil(($need - $len) / $step) + 1;
        return array_fill(0, $rows, $len);
    }

    // ============================================
    // Геометрія колонки
    // ============================================

    // Мін. і макс. Y полігону в смузі x0..x1 (вершини всередині смуги + перетини з її краями та серединою)
    private function columnRange(float $x0, float $x1): ?array
    {
        $ys = [];
        $n = count($this->polygon);
        foreach ([$x0 + 1, ($x0 + $x1) / 2, $x1 - 1] as $x) {
            for ($i = 0; $i < $n; $i++) {
                [$ax, $ay] = $this->polygon[$i];
                [$bx, $by] = $this->polygon[($i + 1) % $n];
                if ($ax == $bx) continue;
                if ($x < min($ax, $bx) || $x > max($ax, $bx)) continue;
                $t = ($x - $ax) / ($bx - $ax);
                $ys[] = $ay + $t * ($by - $ay);
            }
        }
        foreach ($this->polygon as [$px, $py]) {
            if ($px >= $x0 && $px <= $x1) $ys[] = $py;
        }
        if (count($ys) < 2) return null;
        $lo = (int)floor(min($ys));
        $hi = (int)ceil(max($ys));
        return $hi - $lo > 0 ? [$lo, $hi] : null;
    }

    // Площа корисної частини листа, що лягає на скат, без вирізів (мм²)
    private function coveredArea(float $x, float $y, int $w, int $h): float
    {
        $a = GeometryEngine::rectPolygonIntersectionArea((int)$x, (int)$y, $w, $h, $this->polygon);
        foreach ($this->holes as $hole) {
            if (is_array($hole) && count($hole) >= 3) {
                $a -= GeometryEngine::rectPolygonIntersectionArea((int)$x, (int)$y, $w, $h, $hole);
            }
        }
        return max(0.0, $a);
    }

    private function groupByLength(array $placements): array
    {
        $g = [];
        foreach ($placements as $p) {
            $L = $p['length'];
            if (!isset($g[$L])) $g[$L] = ['length_mm' => $L, 'full_width_mm' => $this->fullWidth, 'count' => 0, 'full_area_m2' => 0.0];
            $g[$L]['count']++;
            $g[$L]['full_area_m2'] = round($g[$L]['full_area_m2'] + $this->fullWidth * $L / 1e6, 4);
        }
        krsort($g);
        return array_values($g);
    }
}
