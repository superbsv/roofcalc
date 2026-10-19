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

class SlopesController
{
    // Типи ребер ската (індекс = сторона полігону i → i+1)
    public const EDGE_TYPES = ['eave','ridge','hip','valley','end','abutment','none'];

    public function __construct()
    {
        Database::ensureColumn('slopes', 'edge_types', 'TEXT NULL');
        // Елемент покрівлі (скат) або фасад — як у провіднику «Кровля Профи»
        Database::ensureColumn('slopes', 'element_kind', "VARCHAR(16) NOT NULL DEFAULT 'roof'");
    }

    // Розпаковка JSON-полів ската для відповіді API
    public static function decodeSlope(array $s): array
    {
        $s['polygon_points'] = json_decode($s['polygon_points'] ?? 'null', true) ?? [];
        $s['holes']          = json_decode($s['holes'] ?? 'null', true) ?? [];
        $s['edge_types']     = json_decode($s['edge_types'] ?? 'null', true) ?? [];
        if (array_key_exists('calc_result', $s) && is_string($s['calc_result'])) {
            $s['calc_result'] = json_decode($s['calc_result'], true);
        }
        return $s;
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
             material_profile_id, material_color, material_coating, material_thickness, edge_types, element_kind)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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

        $allowed = ['name','polygon_points','holes','edge_types','element_kind','slope_angle','eave_side','ridge_side',
                    'laying_direction','eave_overhang','ridge_gap',
                    'material_profile_id','material_color','material_coating','material_thickness'];

        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            if ($f === 'holes') {
                $fields[] = "$f = ?";
                $params[] = json_encode(self::cleanHoles($body[$f]));
            } elseif ($f === 'edge_types') {
                $fields[] = "$f = ?";
                $params[] = json_encode(self::cleanEdgeTypes($body[$f]));
            } elseif ($f === 'element_kind') {
                $fields[] = "$f = ?";
                $params[] = $body[$f] === 'facade' ? 'facade' : 'roof';
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
        $fields[] = 'calc_result = NULL';
        $fields[] = 'calc_at = NULL';

        $params[] = $id;
        Database::query('UPDATE slopes SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);

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
    public function calculateById(int $id): array
    {
        $slope = Database::fetchOne(
            'SELECT s.*, mp.*,
                    mp.id as profile_id, mp.name as profile_name
             FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.id = ?',
            [$id]
        );

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

        switch ($slope['type']) {
            case 'tile':
                $calc = new TileCalculator($profile, $slope);
                break;
            case 'profile':
                $calc = new ProfileCalculator($profile, $slope);
                break;
            case 'falts':
                $calc = new FaltsCalculator($profile, $slope);
                break;
            default:
                return ['errors' => ['Невідомий тип матеріалу: ' . $slope['type']]];
        }

        $calcResult = $calc->calculate();

        if (!empty($calcResult['errors'])) {
            return $calcResult;
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
                    $profile['name'] . ' L=' . ($group['length_mm'] ?? 0) . ' мм',
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
                    strpos($acc['code'] ?? '', 'screw') !== false ? 'fastener' : 'accessory',
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

        $project = Database::fetchOne('SELECT user_id FROM projects WHERE id = ?', [$slope['project_id']]);
        if (!in_array($user['role'], ['admin','manager'])
            && (int)$project['user_id'] !== (int)$user['sub']) {
            $this->error('Доступ заборонено', 403);
        }
        return $slope;
    }

    private function checkProjectAccess(int $projectId, array $user): void
    {
        $p = Database::fetchOne('SELECT user_id FROM projects WHERE id = ?', [$projectId]);
        if (!$p) $this->error('Проект не знайдено', 404);
        if (!in_array($user['role'], ['admin','manager'])
            && (int)$p['user_id'] !== (int)$user['sub']) {
            $this->error('Доступ заборонено', 403);
        }
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
