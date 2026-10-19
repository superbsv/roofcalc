<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/projects/ProjectsController.php
// ============================================

namespace RoofCalc\Api\Projects;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Plans;

class ProjectsController
{
    public function __construct()
    {
        Database::ensureProjectSchema();
        Database::ensurePlatformSchema();
    }

    // settings: реквізити замовлення і параметри проєкту як у КП
    public static function decodeProject(?array $p): ?array
    {
        if (!$p) return $p;
        $s = isset($p['settings']) && is_string($p['settings']) ? json_decode($p['settings'], true) : null;
        $p['settings'] = is_array($s) ? $s : (object)[];
        return $p;
    }

    private static function cleanSettings($raw): string
    {
        if (!is_array($raw)) $raw = [];
        $out = [];
        foreach ($raw as $k => $v) {
            if (!is_string($k) || strlen($k) > 40) continue;
            if (is_array($v) || is_object($v)) continue;
            $out[$k] = is_string($v) ? mb_substr($v, 0, 255) : $v;
        }
        return json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    // GET /api/projects
    public function index(): void
    {
        $user = $this->requireAuth();

        // Лише проєкти свого кабінету; адмін і менеджер бачать усі проєкти кабінету, решта — свої
        $where  = 'p.tenant_id = ? AND p.user_id = ?';
        $params = [$user['tid'], $user['sub']];
        if (in_array($user['role'], ['admin', 'manager'])) {
            $where  = 'p.tenant_id = ?';
            $params = [$user['tid']];
        }

        // Пошук
        if (!empty($_GET['search'])) {
            $s = '%' . $_GET['search'] . '%';
            $where  .= ' AND (p.name LIKE ? OR p.client_name LIKE ?)';
            $params[] = $s;
            $params[] = $s;
        }

        // Фільтр по статусу
        if (!empty($_GET['status'])) {
            $where  .= ' AND p.status = ?';
            $params[] = $_GET['status'];
        }

        $page  = max(1, (int)($_GET['page'] ?? 1));
        $limit = min(50, (int)($_GET['limit'] ?? 20));
        $offset = ($page - 1) * $limit;

        $total = Database::fetchOne(
            "SELECT COUNT(*) as cnt FROM projects p WHERE $where",
            $params
        )['cnt'];

        $projects = Database::fetchAll(
            "SELECT p.id, p.name, p.client_name, p.object_address, p.roof_type, p.settings,
                    p.status, p.total_area, p.total_price, p.created_at, p.updated_at,
                    u.name as manager_name
             FROM projects p
             LEFT JOIN users u ON u.id = p.user_id
             WHERE $where
             ORDER BY p.updated_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );

        $this->json([
            'data'  => array_map([self::class, 'decodeProject'], $projects),
            'total' => (int)$total,
            'page'  => $page,
            'limit' => $limit,
        ]);
    }

    // POST /api/projects
    public function create(): void
    {
        $user = $this->requireAuth();
        $body = $this->body();

        if (empty($body['name'])) {
            $this->error('Назва проекту обов\'язкова', 400);
        }

        // Ліміт розрахунків тарифу на календарний місяць
        $tenant = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$user['tid']]);
        $lim = $tenant ? Plans::limits($tenant) : ['projects_month' => null];
        if (!empty($lim['projects_month'])) {
            $cnt = (int)Database::fetchOne(
                "SELECT COUNT(*) c FROM projects WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')", [$user['tid']]
            )['c'];
            if ($cnt >= (int)$lim['projects_month']) {
                $this->error('Вичерпано ліміт тарифу: ' . $lim['projects_month'] . ' розрахунків на місяць. Змініть тариф або зверніться до ABT', 402);
            }
        }

        // Номер замовлення — наскрізна нумерація кабінету
        $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
        if ($tenant && empty($settings['order_no'])) {
            $settings['order_no'] = (string)(int)$tenant['next_order_no'];
            Database::query('UPDATE tenants SET next_order_no = next_order_no + 1 WHERE id = ?', [$user['tid']]);
        }
        if ($tenant && empty($settings['company'])) $settings['company'] = $tenant['doc_company'] ?: $tenant['name'];
        $body['settings'] = $settings;

        $id = Database::insert(
            'INSERT INTO projects (user_id, name, client_name, client_phone, client_email,
             object_address, roof_type, notes, discount_pct, vat_pct, status, settings, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $user['sub'],
                trim($body['name']),
                $body['client_name']    ?? null,
                $body['client_phone']   ?? null,
                $body['client_email']   ?? null,
                $body['object_address'] ?? null,
                $body['roof_type']      ?? null,
                $body['notes']          ?? null,
                $body['discount_pct']   ?? 0,
                $body['vat_pct']        ?? 20,
                'draft',
                self::cleanSettings($body['settings'] ?? []),
                $user['tid'],
            ]
        );

        $this->log($user['sub'], 'project.create', 'project', $id);
        $project = self::decodeProject(Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]));
        $this->json(['project' => $project], 201);
    }

    // GET /api/projects/{id}
    public function show(int $id): void
    {
        $user    = $this->requireAuth();
        $project = $this->findProject($id, $user);

        // Підвантажуємо скати
        $slopes = Database::fetchAll(
            'SELECT s.*, mp.name as material_name, mp.type as material_type
             FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.project_id = ?
             ORDER BY s.sort_order, s.id',
            [$id]
        );

        foreach ($slopes as &$slope) {
            $slope = \RoofCalc\Api\Slopes\SlopesController::decodeSlope($slope);
        }
        unset($slope);

        $this->json([
            'project' => self::decodeProject($project),
            'slopes'  => $slopes,
        ]);
    }

    // PUT /api/projects/{id}
    public function update(int $id): void
    {
        $user    = $this->requireAuth();
        $project = $this->findProject($id, $user);
        $body    = $this->body();

        $fields = [];
        $params = [];

        $allowed = ['name','client_name','client_phone','client_email',
                    'object_address','roof_type','notes','discount_pct','vat_pct','status','settings'];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'settings' ? self::cleanSettings($body[$f]) : $body[$f];
            }
        }

        if (!$fields) $this->error('Немає полів для оновлення', 400);

        $params[] = $id;
        Database::query("UPDATE projects SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        $this->log($user['sub'], 'project.update', 'project', $id);
        $this->json(['project' => self::decodeProject(Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]))]);
    }

    // DELETE /api/projects/{id}
    public function delete(int $id): void
    {
        $user = $this->requireAuth();
        $this->findProject($id, $user);

        Database::query('DELETE FROM projects WHERE id = ?', [$id]);
        $this->log($user['sub'], 'project.delete', 'project', $id);
        $this->json(['message' => 'Проект видалено']);
    }

    // GET /api/projects/share/{token}  — публічний доступ
    public function share(string $token): void
    {
        $project = Database::fetchOne(
            'SELECT id, name, client_name, object_address, roof_type,
                    total_area, total_price, status, updated_at
             FROM projects
             WHERE share_token = ? AND (share_expires_at IS NULL OR share_expires_at > NOW())',
            [$token]
        );

        if (!$project) $this->error('Посилання не дійсне або застаріло', 404);

        $slopes = Database::fetchAll(
            'SELECT id, name, polygon_points, slope_angle, calc_result
             FROM slopes WHERE project_id = ? ORDER BY sort_order, id',
            [$project['id']]
        );

        $spec = Database::fetchAll(
            'SELECT name, unit, quantity, price, total FROM specification_items WHERE project_id = ? ORDER BY sort_order',
            [$project['id']]
        );

        $this->json([
            'project'       => $project,
            'slopes'        => $slopes,
            'specification' => $spec,
        ]);
    }

    // POST /api/projects/{id}/calculate-all
    public function calculateAll(int $id): void
    {
        $user    = $this->requireAuth();
        $this->findProject($id, $user);

        $slopes = Database::fetchAll(
            'SELECT id, name, polygon_points, material_profile_id FROM slopes WHERE project_id = ?', [$id]
        );

        // Розраховуємо кожен елемент окремо: порожній або помилковий елемент не зупиняє весь проєкт
        $slopeCtrl = new \RoofCalc\Api\Slopes\SlopesController();
        $skipped = [];
        $area    = 0.0;
        foreach ($slopes as $s) {
            $pts = json_decode($s['polygon_points'] ?? '[]', true) ?: [];
            if (count($pts) < 3) { $skipped[] = $s['name'] . ': немає контуру'; continue; }
            if (empty($s['material_profile_id'])) { $skipped[] = $s['name'] . ': не обрано матеріал'; continue; }
            try {
                $r = $slopeCtrl->calculateById((int)$s['id']);
                if (!empty($r['errors'])) { $skipped[] = $s['name'] . ': ' . implode('; ', $r['errors']); continue; }
                $area += (float)($r['slope_area_m2'] ?? 0);
            } catch (\Throwable $e) {
                $skipped[] = $s['name'] . ': ' . $e->getMessage();
            }
        }

        // Підсумки проєкту (раніше тут була неіснуюча колонка useful_area → помилка 500)
        $totals = Database::fetchOne(
            'SELECT SUM(total) as total_price FROM specification_items WHERE project_id = ?',
            [$id]
        );

        Database::query(
            'UPDATE projects SET total_price = ?, total_area = ?, status = "calculated" WHERE id = ?',
            [$totals['total_price'] ?? 0, round($area, 3), $id]
        );

        $this->log($user['sub'], 'project.calculate', 'project', $id);
        $this->json(['message' => 'Проект перераховано', 'project_id' => $id, 'skipped' => $skipped]);
    }

    // ---- Helpers ----

    private function findProject(int $id, array $user): array
    {
        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]);
        if (!$project) $this->error('Проект не знайдено', 404);

        // Доступ: проєкт свого кабінету — свій або (для адміна/менеджера) будь-який
        if (!Auth::projectAllowed($user, $project)) {
            $this->error('Проект не знайдено', 404);
        }

        return $project;
    }

    private function requireAuth(): array
    {
        $user = Auth::currentUser();
        if (!$user) $this->error('Не авторизовано', 401);
        return $user;
    }

    private function body(): array
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }

    private function log(int $userId, string $action, string $type, int $entityId): void
    {
        Database::query(
            'INSERT INTO activity_log (user_id, tenant_id, action, entity_type, entity_id, ip_address)
             VALUES (?, (SELECT tenant_id FROM users WHERE id = ?), ?, ?, ?, ?)',
            [$userId, $userId, $action, $type, $entityId, $_SERVER['REMOTE_ADDR'] ?? null]
        );
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
