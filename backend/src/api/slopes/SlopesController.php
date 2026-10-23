<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/slopes/SlopesController.php
// ============================================

namespace RoofCalc\Api\Slopes;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Geometry\GeometryEngine;
use RoofCalc\Core\Calculation\TileCalculator;
use RoofCalc\Core\Calculation\ProfileCalculator;
use RoofCalc\Core\Calculation\FaltsCalculator;
use RoofCalc\Core\Calculation\AccessoryCalc;
use RoofCalc\Core\Calculation\SheetLayoutEngine;

// Новий клас підключаємо явно: classmap Composer на сервері його ще не знає
require_once __DIR__ . '/../../core/calculation/SheetLayoutEngine.php';

class SlopesController
{
    // Типи ребер ската (індекс = сторона полігону i → i+1)
    public const EDGE_TYPES = ['eave','ridge','hip','valley','end','abutment','none'];

    public function __construct()
    {
        Database::ensureColumn('slopes', 'edge_types', 'TEXT NULL');
        // Елемент покрівлі (скат) або фасад — як у провіднику «Кровля Профи»
        Database::ensureColumn('slopes', 'element_kind', "VARCHAR(16) NOT NULL DEFAULT 'roof'");
        Database::ensureMaterialSchema();
    }

    // Розпаковка JSON-полів ската для відповіді API
    public static function decodeSlope(array $s): array
    {
        $s['polygon_points'] = json_decode($s['polygon_points'] ?? 'null', true) ?? [];
        $s['holes']          = json_decode($s['holes'] ?? 'null', true) ?? [];
        $s['edge_types']     = json_decode($s['edge_types'] ?? 'null', true) ?? [];
        if (array_key_exists('sheet_edits', $s)) $s['sheet_edits'] = self::cleanSheetEdits(json_decode($s['sheet_edits'] ?? 'null', true));
        if (array_key_exists('calc_result', $s) && is_string($s['calc_result'])) {
            $s['calc_result'] = json_decode($s['calc_result'], true);
        }
        return $s;
    }

    // Ручні правки листів: {"кол:ряд": {len?: мм, y?: мм, del?: true}}
    public static function cleanSheetEdits($e): array
    {
        if (!is_array($e)) return [];
        $out = [];
        foreach ($e as $k => $v) {
            if (!preg_match('/^-?\d+:-?\d+$/', (string)$k) || !is_array($v)) continue;
            $o = [];
            if (!empty($v['del'])) $o['del'] = true;
            if (isset($v['len']) && is_numeric($v['len'])) $o['len'] = max(50, min(100000, (int)round($v['len'])));
            if (isset($v['y']) && is_numeric($v['y'])) $o['y'] = max(-100000, min(100000, (int)round($v['y'])));
            if ($o) $out[(string)$k] = $o;
            if (count($out) >= 2000) break;
        }
        return $out;
    }

    // Застосувати ручні правки до результату і перерахувати підсумки (листи, п.м., площі, відходи)
    private static function applySheetEdits(array $r, array $edits): array
    {
        if (!$edits || empty($r['placements'])) return $r;
        $fw = (int)($r['sheet_full_width'] ?? ($r['placements'][0]['full_width'] ?? 0));
        $out = [];
        foreach ($r['placements'] as $p) {
            $k = ($p['col_index'] ?? 0) . ':' . ($p['row_index'] ?? 0);
            $e = $edits[$k] ?? null;
            if ($e) {
                if (!empty($e['del'])) continue;
                if (isset($e['len'])) $p['length'] = $e['len'];
                if (isset($e['y'])) $p['y'] = $e['y'];
                $p['full_area_m2'] = round(($p['full_width'] ?? $fw) * $p['length'] / 1e6, 4);
                $p['edited'] = true;
            }
            $out[] = $p;
        }
        $r = self::recalcTotals($r, $out);
        $r['sheet_edits_count'] = count($edits);
        return $r;
    }

    // Підсумки ската (довжини, погонні метри, площі, відхід) за фактичними листами
    private static function recalcTotals(array $r, array $out): array
    {
        $fw = (int)($r['sheet_full_width'] ?? ($out[0]['full_width'] ?? 0));
        $uw = (int)($r['sheet_useful_width'] ?? ($out[0]['useful_width'] ?? 0));
        $lens = array_map(function ($p) { return (int)$p['length']; }, $out);
        $sUsefulOld = (float)($r['useful_area_m2'] ?? 0);
        $net = $sUsefulOld > 0 ? $sUsefulOld * (1 - (float)($r['waste_pct'] ?? 0) / 100) : (float)($r['slope_area_m2'] ?? 0);
        $running = array_sum($lens) / 1000;
        $sUseful = $uw / 1000 * $running;
        $sFull = $fw / 1000 * $running;
        $r['placements'] = $out;
        $r['sheets_by_length'] = SheetLayoutEngine::groupLengths($lens, $fw);
        $r['laid_by_length'] = $r['sheets_by_length'];
        $r['total_sheets'] = count($lens);
        $r['laid_sheets'] = count($lens);
        $r['sheet_length_mm'] = $lens ? max($lens) : 0;
        $r['running_m'] = round($running, 3);
        $r['useful_area_m2'] = round($sUseful, 3);
        $r['total_full_area_m2'] = round($sFull, 3);
        $r['order_area_m2'] = round($sFull, 3);
        $r['waste_pct'] = round($sUseful > 0 ? max(0, ($sUseful - $net) * 100 / $sUseful) : 0, 1);
        return $r;
    }

    // Нормалізація вирізів: масив полігонів, кожен ≥3 точок [x,y] у мм (цілі)
    private static function cleanHoles($holes): array
    {
        if (!is_array($holes)) return [];
        $out = [];
        foreach ($holes as $h) {
            if (!is_array($h) || count($h) < 3) continue;
            $poly = [];
            foreach ($h as $pt) {
                if (!is_array($pt) || count($pt) < 2) continue 2;
                $poly[] = [(int)round($pt[0]), (int)round($pt[1])];
            }
            $out[] = $poly;
        }
        return $out;
    }

    private static function cleanEdgeTypes($types): array
    {
        if (!is_array($types)) return [];
        $out = [];
        foreach (array_values($types) as $t) {
            $out[] = in_array($t, self::EDGE_TYPES, true) ? $t : 'none';
        }
        return $out;
    }
    // GET /api/projects/{projectId}/slopes
    public function index(int $projectId): void
    {
        $user = $this->requireAuth();
        $this->checkProjectAccess($projectId, $user);

        $slopes = Database::fetchAll(
            'SELECT s.*, mp.name as material_name, mp.type as material_type,
                    mp.useful_width, mp.full_width
             FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.project_id = ?
             ORDER BY s.sort_order, s.id',
            [$projectId]
        );

        foreach ($slopes as &$s) {
            $s = self::decodeSlope($s);
        }
        unset($s);

        $this->json(['slopes' => $slopes]);
    }

    // Режим розрахунку КП: order | stock1 | stock2 | stock3 (старе 'stock' = stock2)
    public static function cleanMode($m): string
    {
        $m = (string)$m;
        if ($m === 'stock') return 'stock2';
        return in_array($m, ['order', 'stock1', 'stock2', 'stock3'], true) ? $m : 'order';
    }

    // POST /api/projects/{projectId}/slopes
    public function create(int $projectId): void
    {
        $user = $this->requireAuth();
        $this->checkProjectAccess($projectId, $user);
        $body = $this->body();

        // polygon_points можуть бути порожніми при створенні

        // Рахуємо порядковий номер
        $maxOrder = Database::fetchOne(
            'SELECT MAX(sort_order) as mx FROM slopes WHERE project_id = ?', [$projectId]
        )['mx'] ?? 0;

        $id = Database::insert(
            'INSERT INTO slopes (project_id, name, sort_order, polygon_points, holes,
             slope_angle, eave_side, ridge_side, laying_direction, eave_overhang, ridge_gap,
             material_profile_id, material_color, material_coating, material_thickness, edge_types, element_kind, calc_mode)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $projectId,
                $body['name']          ?? 'Скат ' . ($maxOrder + 1),
                $maxOrder + 1,
                json_encode($body['polygon_points']),
                json_encode(self::cleanHoles($body['holes'] ?? [])),
                $body['slope_angle']   ?? 30,
                $body['eave_side']     ?? null,
                $body['ridge_side']    ?? null,
                $body['laying_direction'] ?? 'right_left',
                $body['eave_overhang'] ?? 50,
                $body['ridge_gap']     ?? 50,
                $body['material_profile_id'] ?? null,
                $body['material_color']      ?? null,
                $body['material_coating']    ?? null,
                $body['material_thickness']  ?? null,
                json_encode(self::cleanEdgeTypes($body['edge_types'] ?? [])),
                (($body['element_kind'] ?? 'roof') === 'facade') ? 'facade' : 'roof',
                self::cleanMode($body['calc_mode'] ?? 'order'),
            ]
        );

        $slope = self::decodeSlope(Database::fetchOne('SELECT * FROM slopes WHERE id = ?', [$id]));

        $this->json(['slope' => $slope], 201);
    }

    // PUT /api/slopes/{id}
    public function update(int $id): void
    {
        $user  = $this->requireAuth();
        $slope = $this->findSlope($id, $user);
        $body  = $this->body();

        $fields = [];
        $params = [];

        // матеріал — лише з загального каталогу або свого кабінету
        if (!empty($body['material_profile_id'])) {
            if (!\RoofCalc\Core\Catalog::isVisible((int)$body['material_profile_id'], (int)$user['tid'])) $this->error('Матеріал не знайдено', 404);
        }

        $allowed = ['name','polygon_points','holes','edge_types','element_kind','calc_mode','slope_angle','eave_side','ridge_side',
                    'laying_direction','eave_overhang','ridge_gap','sort_order','joint_y','round_step','layout_shift','split_forced','v_shift','rows_count',
                    'material_profile_id','material_color','material_coating','material_thickness','sheet_edits','snap_off'];

        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            if ($f === 'holes') {
                $fields[] = "$f = ?";
                $params[] = json_encode(self::cleanHoles($body[$f]));
            } elseif ($f === 'edge_types') {
                $fields[] = "$f = ?";
                $params[] = json_encode(self::cleanEdgeTypes($body[$f]));
            } elseif ($f === 'calc_mode') {
                $fields[] = "$f = ?";
                $params[] = self::cleanMode($body[$f]);
            } elseif ($f === 'rows_count') {
                $fields[] = "$f = ?";
                $v = (int)($body[$f] ?? 0);
                $params[] = $v <= 1 ? null : min(20, $v);
            } elseif ($f === 'v_shift') {
                $fields[] = "$f = ?";
                $v = ($body[$f] === null || $body[$f] === '') ? 0 : (int)$body[$f];
                $params[] = $v === 0 ? null : max(-100000, min(100000, $v));
            } elseif ($f === 'snap_off') {
                $fields[] = "$f = ?";
                $params[] = !empty($body[$f]) ? 1 : null;
            } elseif ($f === 'split_forced') {
                $fields[] = "$f = ?";
                $params[] = !empty($body[$f]) ? 1 : null;
            } elseif ($f === 'layout_shift') {
                $fields[] = "$f = ?";
                $v = ($body[$f] === null || $body[$f] === '') ? 0 : (int)$body[$f];
                $params[] = $v === 0 ? null : max(-100000, min(100000, $v));
            } elseif ($f === 'round_step') {
                $fields[] = "$f = ?";
                $v = ($body[$f] === null || $body[$f] === '') ? null : (int)$body[$f];
                $params[] = ($v === null || $v <= 0) ? null : min(1000, $v);
            } elseif ($f === 'joint_y') {
                $fields[] = "$f = ?";
                $params[] = ($body[$f] === null || $body[$f] === '') ? null : (int)$body[$f];
            } elseif ($f === 'element_kind') {
                $fields[] = "$f = ?";
                $params[] = $body[$f] === 'facade' ? 'facade' : 'roof';
            } elseif ($f === 'sheet_edits') {
                $fields[] = "$f = ?";
                $e = self::cleanSheetEdits($body[$f]);
                $params[] = $e ? json_encode($e) : null;
            } elseif ($f === 'polygon_points') {
                $fields[] = "$f = ?";
                $params[] = json_encode($body[$f]);
            } else {
                $fields[] = "$f = ?";
                $params[] = $body[$f];
            }
        }

        if (!$fields) $this->error('Немає полів для оновлення', 400);

        // Скидаємо кешований результат при зміні геометрії або матеріалу
        // (назва, порядок і кут нахилу — «лише для специфікації» — укладку не змінюють)
        $changed = array_diff(array_keys(array_intersect_key($body, array_flip($allowed))), ['name', 'sort_order', 'slope_angle', 'sheet_edits']);
        if ($changed) {
            $fields[] = 'calc_result = NULL';
            $fields[] = 'calc_at = NULL';
            // зсув / ряди / контур / матеріал перебудовують укладку — ручні правки листів скидаються
            if (!array_key_exists('sheet_edits', $body)) $fields[] = 'sheet_edits = NULL';
        }

        $params[] = $id;
        Database::query('UPDATE slopes SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);

        // ручні правки листів — одразу перераховуємо, щоб специфікація і підсумки їх враховували
        if (array_key_exists('sheet_edits', $body) && !$changed) $this->calculateById($id);

        $slope = self::decodeSlope(Database::fetchOne('SELECT * FROM slopes WHERE id = ?', [$id]));

        $this->json(['slope' => $slope]);
    }

    // DELETE /api/slopes/{id}
    public function delete(int $id): void
    {
        $user = $this->requireAuth();
        $this->findSlope($id, $user);
        Database::query('DELETE FROM slopes WHERE id = ?', [$id]);
        $this->json(['message' => 'Скат видалено']);
    }

    // POST /api/slopes/{id}/optimize — підбір зсуву сітки листів з найменшою витратою матеріалу
    // (з урахуванням вирізів: колонки, що повністю потрапляють у виріз, розриваються навколо нього)
    public function optimize(int $id): void
    {
        $user = $this->requireAuth();
        $slope = $this->findSlope($id, $user);
        $mp = Database::fetchOne('SELECT useful_width FROM material_profiles WHERE id = ?', [(int)$slope['material_profile_id']]);
        if (!$mp) $this->error('Не вибрано матеріал для ската');
        $uw = max(100, (int)$mp['useful_width']);
        $cur = (int)($slope['layout_shift'] ?? 0);
        $best = null;
        $score = function (array $r) { return [(float)($r['running_m'] ?? 1e9), (int)($r['total_sheets'] ?? 1e6)]; };
        $base = $this->calculateById($id, ['layout_shift' => $cur], true);
        if (!empty($base['errors'])) $this->error(implode('; ', $base['errors']));
        [$m0, $n0] = $score($base);
        $step = $uw > 400 ? 10 : 5;
        for ($sh = -intdiv($uw, 2); $sh <= intdiv($uw, 2); $sh += $step) {
            $r = $this->calculateById($id, ['layout_shift' => $sh, 'joint_y' => $slope['joint_y']], true);
            if (!empty($r['errors'])) continue;
            if (isset($r['tech_ok']) && !$r['tech_ok'] && !empty($base['tech_ok'])) continue; // не погіршуємо технологію
            [$m, $n] = $score($r);
            if ($best === null || $m < $best[1] - 0.0005 || (abs($m - $best[1]) <= 0.0005 && ($n < $best[2] || ($n === $best[2] && abs($sh) < abs($best[0]))))) $best = [$sh, $m, $n];
        }
        if ($best === null) $this->error('Не вдалося підібрати укладку');
        $improved = $best[1] < $m0 - 0.0005 || ($best[1] <= $m0 + 0.0005 && $best[2] < $n0);
        if ($improved) {
            Database::query('UPDATE slopes SET layout_shift = ?, sheet_edits = NULL WHERE id = ?', [$best[0] === 0 ? null : $best[0], $id]);
        }
        $result = $this->calculateById($id);
        $this->json(['result' => $result, 'improved' => $improved, 'before_m' => round($m0, 3), 'after_m' => round($improved ? $best[1] : $m0, 3),
            'before_sheets' => $n0, 'after_sheets' => $improved ? $best[2] : $n0, 'layout_shift' => $improved ? $best[0] : $cur]);
    }

    // Snap: кандидати лінії стику навколо позиції користувача (±крок, обидва напрямки), перевірка всіх листів ската.
    // Відкидаємо варіанти з невиконуваними листами; беремо мінімальне зміщення, при рівному — менший відхід.
    private function snapJoint(int $id, int $user, ?array $range, int $step, int $inc = 5): ?array
    {
        $lo = $range ? (int)$range[0] : PHP_INT_MIN; $hi = $range ? (int)$range[1] : PHP_INT_MAX;
        $inc = max(1, $inc);
        for ($d = $inc; $d <= 2 * $step; $d += $inc) {
            $best = null;
            foreach ([$user - $d, $user + $d] as $j) {
                if ($j < $lo || $j > $hi) continue;
                $r = $this->calculateById($id, ['joint_y' => $j], true);
                if (!empty($r['errors']) || empty($r['tech_ok']) || (int)$r['joint_y_mm'] !== $j) continue;
                if ($best === null || (float)$r['running_m'] < (float)$best['running_m']) $best = $r;
            }
            if ($best) return $best;
        }
        return null;
    }

    // POST /api/slopes/{id}/calculate
    public function calculate(int $id): void
    {
        $user = $this->requireAuth();
        $this->findSlope($id, $user);
        $result = $this->calculateById($id);
        $this->json(['result' => $result]);
    }

    // ============================================
    // Внутрішній метод розрахунку (викликається і з ProjectsController)
    // ============================================
    public function calculateById(int $id, array $override = [], bool $dryRun = false): array
    {
        $slope = Database::fetchOne(
            'SELECT s.*, mp.*,
                    mp.id as profile_id, mp.name as profile_name
             FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.id = ?',
            [$id]
        );
        if ($slope && $override) $slope = array_merge($slope, $override);

        if (!$slope) return ['errors' => ['Скат не знайдено']];

        $slope['polygon_points'] = json_decode($slope['polygon_points'], true) ?? [];
        $slope['holes']          = self::cleanHoles(json_decode($slope['holes'] ?? 'null', true));
        $slope['edge_types']     = self::cleanEdgeTypes(json_decode($slope['edge_types'] ?? 'null', true));
        $slope['forbidden_lengths'] = $slope['forbidden_lengths'] ?? '[]';
        $slope['stock_lengths']     = $slope['stock_lengths']     ?? '[]';

        if (!$slope['material_profile_id']) {
            return ['errors' => ['Не вибрано матеріал для ската']];
        }

        // Диспетчер по типу матеріалу
        $profile = [
            'id'                 => $slope['profile_id'],
            'type'               => $slope['type'],
            'name'               => $slope['profile_name'],
            'full_width'         => $slope['full_width'],
            'useful_width'       => $slope['useful_width'],
            'side_overlap'       => $slope['side_overlap'],
            'length_overlap'     => $slope['length_overlap'],
            'wave_step'          => $slope['wave_step'],
            'wave_height'        => $slope['wave_height'],
            'min_length'         => $slope['min_length'],
            'max_length'         => $slope['max_length'],
            'cut_step'           => $slope['cut_step'],
            'forbidden_lengths'  => $slope['forbidden_lengths'],
            'stock_lengths'      => $slope['stock_lengths'],
            'lock_type'          => $slope['lock_type'],
            'min_joint_distance' => $slope['min_joint_distance'],
            'join_overlap'       => $slope['join_overlap'],
            'min_slope_angle'    => $slope['min_slope_angle'],
            'price_per_m2'       => $slope['price_per_m2'],
        ];
        $profile['round_step']     = $slope['round_step'] ?? null; // (mp.* перекриває s.round_step — це значення матеріалу)
        // Округлення довжин, задане на вкладці «Матеріал» для всього розрахунку, має пріоритет над довідником
        $proj = Database::fetchOne('SELECT settings FROM projects WHERE id = ?', [(int)$slope['project_id']]);
        $ps = $proj && $proj['settings'] ? json_decode($proj['settings'], true) : null;
        $pr = is_array($ps) ? (int)($ps['round_step'] ?? 0) : 0;
        if ($pr > 0) $profile['round_step'] = min(1000, $pr);
        $profile['max_std_length'] = $slope['max_std_length'] ?? null;
        $profile['module_origin']  = $slope['module_origin'] ?? null;
        $profile['stamp_gap']      = $slope['stamp_gap'] ?? null;
        $profile['type']           = $slope['type'];
        // Розрахунок лише «на замовлення» (режими «зі складу» прибрано з програми)
        $mode = 'order';

        switch ($slope['type']) {
            // Листові та штучні матеріали — єдиний движок укладки (режими як у «Кровля Профи»)
            case 'tile':
            case 'profile':
            case 'tile_module':
            case 'sheet':
            case 'natural_tile':
            case 'siding':      // сайдинг і сендвіч-панелі: панелі під розмір з округленням (як профнастил)
            case 'sandwich':
                $calc = new SheetLayoutEngine($profile, $slope, $mode);
                break;
            case 'falts':   // клік-фальц — той самий движок (колонки під форму ската, округлення, зсуви, вирізи)
                $profile['join_overlap'] = $slope['join_overlap'] ?? null;
                $calc = new SheetLayoutEngine($profile, $slope, $mode);
                break;
            default:
                return ['errors' => ['Невідомий тип матеріалу: ' . $slope['type']]];
        }

        $calcResult = $calc->calculate();

        if (!empty($calcResult['errors'])) {
            return $calcResult;
        }
        if ($dryRun) return $calcResult;   // пробний розрахунок (оптимізація) — без збереження

        // Snap лінії стику: якщо при положенні, заданому користувачем, якийсь лист технологічно не виконати,
        // шукаємо найближче допустиме положення лінії (перераховуються одразу всі листи ската). Збережене положення
        // користувача не змінюється — немає дрейфу; вимкнув Snap — бачить своє положення з помилками.
        $tech = $calc->tech();
        if ($tech && !empty($calcResult['snap']) && empty($calcResult['tech_ok']) && $calcResult['joint_y_mm'] !== null) {
            $snapped = $this->snapJoint($id, (int)$calcResult['joint_y_mm'], $calcResult['joint_range_mm'] ?? null, $tech->moduleStepMm, max(5, $tech->lengthIncrementMm));
            if ($snapped) {
                $snapped['snap_from_mm'] = (int)$calcResult['joint_y_mm'];
                $snapped['warnings'][] = sprintf('Лінію стику зміщено з %.3f до %.3f м — у заданому положенні листи не виготовити', $snapped['snap_from_mm'] / 1000, $snapped['joint_y_mm'] / 1000);
                $calcResult = $snapped;
            } else {
                $calcResult['warnings'][] = 'Допустимого положення лінії стику не знайдено — див. технологічні помилки';
            }
        }

        // Ручні правки листів з «Укладки» (довжина / положення / видалення)
        $calcResult = self::applySheetEdits($calcResult, self::cleanSheetEdits(json_decode($slope['sheet_edits'] ?? 'null', true)));
        if ($tech) {
            // правлені вручну листи теж автоматично подовжуються до найближчої допустимої заводської довжини
            $changed = false;
            foreach ($calcResult['placements'] ?? [] as $i => $pl) {
                if (empty($pl['edited']) || $tech->isValid((int)$pl['length'])) continue;
                $L = $tech->ceilValid((int)$pl['length']);
                if ($L === null) continue;
                $calcResult['placements'][$i]['length'] = $L;
                $calcResult['placements'][$i]['full_area_m2'] = round(($pl['full_width'] ?? 0) * $L / 1e6, 4);
                $changed = true;
            }
            if ($changed) $calcResult = self::recalcTotals($calcResult, $calcResult['placements']);
            $calcResult = $tech->annotate($calcResult);
        }

        // Вирізи (труби, вікна): віднімаємо їх площу від площі ската
        if (!empty($slope['holes'])) {
            $holesArea = 0.0;
            foreach ($slope['holes'] as $h) $holesArea += GeometryEngine::polygonAreaM2($h);
            $calcResult['holes_area_m2'] = round($holesArea, 3);
            if (isset($calcResult['slope_area_m2'])) {
                $calcResult['slope_area_m2'] = round(max(0, $calcResult['slope_area_m2'] - $holesArea), 3);
            }
        }

        // Доборні елементи
        $accessoryCalc = new AccessoryCalc($slope, $calcResult);
        $accessories   = $accessoryCalc->calculate();
        $calcResult['accessories'] = $accessories;

        // Зберігаємо результат у БД
        Database::query(
            'UPDATE slopes SET calc_result = ?, calc_at = NOW() WHERE id = ?',
            [json_encode($calcResult, JSON_UNESCAPED_UNICODE), $id]
        );

        // Оновлюємо специфікацію
        $this->saveSpecification($id, $slope['project_id'], $profile, $calcResult);

        return $calcResult;
    }

    // ============================================
    // Збереження специфікації
    // ============================================
    private function saveSpecification(int $slopeId, int $projectId, array $profile, array $result): void
    {
        // Видаляємо стару специфікацію цього ската
        Database::query(
            'DELETE FROM specification_items WHERE slope_id = ?', [$slopeId]
        );

        $order = 0;

        // Листи/картини по довжинах
        foreach ($result['sheets_by_length'] ?? [[$result]] as $group) {
            if (empty($group['count'])) continue;
            $pricePerSheet = ($profile['price_per_m2'] ?? 0)
                * ($group['full_width_mm'] / 1000)
                * ($group['length_mm'] / 1000);
            $total = round($pricePerSheet * $group['count'], 2);

            Database::insert(
                'INSERT INTO specification_items
                 (project_id, slope_id, type, name, unit, quantity, length_mm,
                  full_area_m2, useful_area_m2, price, total, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                [
                    $projectId, $slopeId, 'sheet',
                    in_array($profile['type'], ['natural_tile', 'tile_module', 'sheet'], true)
                        ? $profile['name']
                        : $profile['name'] . ' L=' . ($group['length_mm'] ?? 0) . ' мм',
                    'шт',
                    $group['count'] ?? 0,
                    $group['length_mm'] ?? 0,
                    $group['full_area_m2'] ?? 0,
                    round(($result['useful_area_m2'] ?? $result['slope_area_m2'] ?? 0), 3),
                    round($pricePerSheet, 2),
                    $total,
                    $order++,
                ]
            );
        }

        // Доборні елементи
        foreach ($result['accessories']['items'] ?? [] as $acc) {
            Database::insert(
                'INSERT INTO specification_items
                 (project_id, slope_id, type, name, unit, quantity, price, total, sort_order)
                 VALUES (?,?,?,?,?,?,?,?,?)',
                [
                    $projectId, $slopeId,
                    in_array($acc['code'] ?? '', ['screw_4x35','nail_ondulin','clamp_tile'], true) || strpos($acc['code'] ?? '', 'screw') !== false ? 'fastener' : 'accessory',
                    $acc['name'],
                    $acc['unit'],
                    $acc['quantity'],
                    $acc['price'],
                    $acc['total'],
                    $order++,
                ]
            );
        }
    }

    // GET /api/slopes/{id}/layout
    public function layout(int $id): void
    {
        $user  = $this->requireAuth();
        $slope = $this->findSlope($id, $user);
        $result = json_decode($slope['calc_result'] ?? 'null', true);

        if (!$result) {
            $this->error('Розрахунок не виконано. Спочатку натисніть "Розрахувати"', 400);
        }

        $this->json([
            'slope_id'   => $id,
            'placements' => $result['placements'] ?? [],
            'summary'    => [
                'total_sheets'   => $result['total_sheets'],
                'slope_area_m2'  => $result['slope_area_m2'],
                'waste_pct'      => $result['waste_pct'],
                'warnings'       => $result['warnings'],
            ],
        ]);
    }

    // ---- Helpers ----

    private function findSlope(int $id, array $user): array
    {
        $slope = Database::fetchOne('SELECT * FROM slopes WHERE id = ?', [$id]);
        if (!$slope) $this->error('Скат не знайдено', 404);

        $project = Database::fetchOne('SELECT user_id, tenant_id FROM projects WHERE id = ?', [$slope['project_id']]);
        if (!Auth::projectAllowed($user, $project)) {
            $this->error('Скат не знайдено', 404);
        }
        return $slope;
    }

    private function checkProjectAccess(int $projectId, array $user): void
    {
        $p = Database::fetchOne('SELECT user_id, tenant_id FROM projects WHERE id = ?', [$projectId]);
        if (!Auth::projectAllowed($user, $p)) $this->error('Проект не знайдено', 404);
    }

    private function requireAuth(): array
    {
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        return $u;
    }

    private function body(): array
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }

    private function json(array $data, int $code = 200): void
    {
        http_response_code($code);
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    private function error(string $msg, int $code = 400): void
    {
        $this->json(['error' => $msg], $code);
    }
}
