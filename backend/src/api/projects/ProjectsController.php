<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/projects/ProjectsController.php
// ============================================

namespace RoofCalc\Api\Projects;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class ProjectsController
{
    // GET /api/projects
    public function index(): void
    {
        $user = $this->requireAuth();

        $where  = 'p.user_id = ?';
        $params = [$user['sub']];

        // Адмін бачить всі проекти
        if (in_array($user['role'], ['admin', 'manager'])) {
            $where  = '1=1';
            $params = [];
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
            "SELECT p.id, p.name, p.client_name, p.object_address, p.roof_type,
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
            'data'  => $projects,
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

        $id = Database::insert(
            'INSERT INTO projects (user_id, name, client_name, client_phone, client_email,
             object_address, roof_type, notes, discount_pct, vat_pct, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
            ]
        );

        $this->log($user['sub'], 'project.create', 'project', $id);
        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]);
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
            'project' => $project,
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
                    'object_address','roof_type','notes','discount_pct','vat_pct','status'];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $fields[] = "$f = ?";
                $params[] = $body[$f];
            }
        }

        if (!$fields) $this->error('Немає полів для оновлення', 400);

        $params[] = $id;
        Database::query("UPDATE projects SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        $this->log($user['sub'], 'project.update', 'project', $id);
        $this->json(['project' => Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id])]);
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
            'SELECT id FROM slopes WHERE project_id = ?', [$id]
        );

        $slopeCtrl = new \RoofCalc\Api\Slopes\SlopesController();
        foreach ($slopes as $s) {
            $slopeCtrl->calculateById((int)$s['id']);
        }

        // Оновлюємо підсумки проекту
        $totals = Database::fetchOne(
            'SELECT SUM(total) as total_price FROM specification_items WHERE project_id = ?',
            [$id]
        );
        $area = Database::fetchOne(
            'SELECT SUM(useful_area) as total_area FROM specification_items
             WHERE project_id = ? AND type = "sheet"',
            [$id]
        );

        Database::query(
            'UPDATE projects SET total_price = ?, total_area = ?, status = "calculated" WHERE id = ?',
            [$totals['total_price'], $area['total_area'], $id]
        );

        $this->log($user['sub'], 'project.calculate', 'project', $id);
        $this->json(['message' => 'Проект перераховано', 'project_id' => $id]);
    }

    // ---- Helpers ----

    private function findProject(int $id, array $user): array
    {
        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]);
        if (!$project) $this->error('Проект не знайдено', 404);

        // Доступ: свій проект або адмін/менеджер
        if (!in_array($user['role'], ['admin', 'manager'])
            && (int)$project['user_id'] !== (int)$user['sub']) {
            $this->error('Доступ заборонено', 403);
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
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, ip_address)
             VALUES (?, ?, ?, ?, ?)',
            [$userId, $action, $type, $entityId, $_SERVER['REMOTE_ADDR'] ?? null]
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
