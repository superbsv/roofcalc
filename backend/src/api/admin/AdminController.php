<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/admin/AdminController.php
// ============================================

namespace RoofCalc\Api\Admin;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class AdminController
{
    // ============================================
    // USERS
    // ============================================

    // GET /api/admin/users
    public function users(): void
    {
        $this->requireAdmin();
        $users = Database::fetchAll(
            'SELECT id, name, email, login, role, company, phone, is_active,
                    last_login_at, created_at
             FROM users ORDER BY created_at DESC'
        );
        $this->json(['users' => $users]);
    }

    // POST /api/admin/users
    public function createUser(): void
    {
        $this->requireAdmin();
        $body = $this->body();

        $required = ['name','email','login','password','role'];
        foreach ($required as $f) {
            if (empty($body[$f])) $this->error("Поле «{$f}» обов'язкове", 400);
        }

        if (strlen($body['password']) < 8) {
            $this->error('Пароль має бути мінімум 8 символів', 400);
        }

        $exists = Database::fetchOne(
            'SELECT id FROM users WHERE login = ? OR email = ?',
            [$body['login'], $body['email']]
        );
        if ($exists) $this->error('Логін або email вже зайняті', 409);

        $id = Database::insert(
            'INSERT INTO users (name, email, login, password_hash, role, company, phone, is_active)
             VALUES (?,?,?,?,?,?,?,?)',
            [
                $body['name'],
                $body['email'],
                $body['login'],
                Auth::hashPassword($body['password']),
                $body['role'] ?? 'manager',
                $body['company'] ?? null,
                $body['phone']   ?? null,
                $body['is_active'] ?? 1,
            ]
        );

        $this->log('admin.user.create', 'user', $id);
        $user = Database::fetchOne('SELECT id,name,email,login,role,company,is_active FROM users WHERE id=?', [$id]);
        $this->json(['user' => $user], 201);
    }

    // PUT /api/admin/users/{id}
    public function updateUser(int $id): void
    {
        $this->requireAdmin();
        $body   = $this->body();
        $fields = []; $params = [];

        $allowed = ['name','email','role','company','phone','is_active'];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $fields[] = "$f = ?";
                $params[] = $body[$f];
            }
        }

        if (!empty($body['password'])) {
            if (strlen($body['password']) < 8) $this->error('Пароль занадто короткий', 400);
            $fields[] = 'password_hash = ?';
            $params[] = Auth::hashPassword($body['password']);
        }

        if (!$fields) $this->error('Немає полів для оновлення', 400);
        $params[] = $id;
        Database::query('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);

        $this->log('admin.user.update', 'user', $id, ['fields' => array_keys($body)]);
        $user = Database::fetchOne('SELECT id,name,email,login,role,company,phone,is_active FROM users WHERE id=?', [$id]);
        $this->json(['user' => $user]);
    }

    // ============================================
    // MATERIALS
    // ============================================

    // GET /api/admin/materials
    public function materials(): void
    {
        $this->requireAdmin();
        $profiles = Database::fetchAll(
            'SELECT * FROM material_profiles ORDER BY type, sort_order, name'
        );
        foreach ($profiles as &$p) {
            foreach (['forbidden_lengths','stock_lengths','color_options','coating_options','thickness_options'] as $f) {
                $p[$f] = json_decode($p[$f] ?? 'null', true);
            }
        }
        $this->json(['profiles' => $profiles]);
    }

    // POST /api/admin/materials
    public function createMaterial(): void
    {
        $this->requireAdmin();
        Database::ensureMaterialSchema();
        $body = $this->body();

        if (empty($body['type']) || empty($body['name'])) {
            $this->error('Тип та назва обов\'язкові', 400);
        }

        $id = Database::insert(
            'INSERT INTO material_profiles
             (type, name, manufacturer, full_width, useful_width, side_overlap, length_overlap,
              wave_step, wave_height, min_length, max_length, cut_step,
              forbidden_lengths, stock_lengths, lock_type, min_joint_distance, join_overlap,
              min_slope_angle, price_per_m2, color_options, coating_options, thickness_options,
              is_active, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $body['type'],
                $body['name'],
                $body['manufacturer']       ?? null,
                $body['full_width']         ?? 1180,
                $body['useful_width']       ?? 1100,
                $body['side_overlap']       ?? 80,
                $body['length_overlap']     ?? 150,
                $body['wave_step']          ?? null,
                $body['wave_height']        ?? null,
                $body['min_length']         ?? 400,
                $body['max_length']         ?? 8000,
                $body['cut_step']           ?? null,
                json_encode($body['forbidden_lengths'] ?? null),
                json_encode($body['stock_lengths']     ?? null),
                $body['lock_type']          ?? null,
                $body['min_joint_distance'] ?? 500,
                $body['join_overlap']       ?? 100,
                $body['min_slope_angle']    ?? 0,
                $body['price_per_m2']       ?? 0,
                json_encode($body['color_options']     ?? null),
                json_encode($body['coating_options']   ?? null),
                json_encode($body['thickness_options'] ?? null),
                $body['is_active']          ?? 1,
                $body['sort_order']         ?? 0,
            ]
        );

        $this->log('admin.material.create', 'material', $id);
        $this->json(['id' => $id, 'message' => 'Профіль створено'], 201);
    }

    // PUT /api/admin/materials/{id}
    public function updateMaterial(int $id): void
    {
        $this->requireAdmin();
        Database::ensureMaterialSchema();
        $body = $this->body();

        $jsonFields = ['forbidden_lengths','stock_lengths','color_options','coating_options','thickness_options'];
        $allowed    = ['name','manufacturer','full_width','useful_width','side_overlap','length_overlap',
                       'wave_step','wave_height','min_length','max_length','cut_step','lock_type',
                       'min_joint_distance','join_overlap','min_slope_angle','price_per_m2','is_active','sort_order','type',
                       'round_step','max_std_length',
                       ...$jsonFields];

        $fields = []; $params = [];
        foreach ($allowed as $f) {
            if (!array_key_exists($f, $body)) continue;
            $fields[] = "$f = ?";
            $params[] = in_array($f, $jsonFields) ? json_encode($body[$f]) : $body[$f];
        }

        if (!$fields) $this->error('Немає полів для оновлення', 400);
        $params[] = $id;
        Database::query('UPDATE material_profiles SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);

        $this->log('admin.material.update', 'material', $id);
        $this->json(['message' => 'Профіль оновлено']);
    }

    // ============================================
    // SETTINGS
    // ============================================

    // GET /api/admin/settings
    public function settings(): void
    {
        $this->requireAdmin();
        $rows = Database::fetchAll('SELECT key_name, value, type, description FROM app_settings ORDER BY key_name');
        $this->json(['settings' => $rows]);
    }

    // PUT /api/admin/settings
    public function updateSettings(): void
    {
        $this->requireAdmin();
        $body = $this->body(); // ['key'=>'val',...]

        foreach ($body as $key => $value) {
            Database::query(
                'UPDATE app_settings SET value = ?, updated_at = NOW() WHERE key_name = ?',
                [(string)$value, $key]
            );
        }

        $this->log('admin.settings.update', 'settings', 0, array_keys($body));
        $this->json(['message' => 'Налаштування збережено']);
    }

    // ============================================
    // LOGS
    // ============================================

    // GET /api/admin/logs
    public function logs(): void
    {
        $this->requireAdmin();

        $page   = max(1, (int)($_GET['page'] ?? 1));
        $limit  = min(100, (int)($_GET['limit'] ?? 50));
        $offset = ($page - 1) * $limit;

        $where  = '1=1';
        $params = [];

        if (!empty($_GET['user_id'])) {
            $where .= ' AND l.user_id = ?';
            $params[] = $_GET['user_id'];
        }
        if (!empty($_GET['action'])) {
            $where .= ' AND l.action LIKE ?';
            $params[] = '%' . $_GET['action'] . '%';
        }

        $logs = Database::fetchAll(
            "SELECT l.id, l.action, l.entity_type, l.entity_id,
                    l.ip_address, l.created_at, l.details,
                    u.name as user_name, u.email as user_email
             FROM activity_log l
             LEFT JOIN users u ON u.id = l.user_id
             WHERE $where
             ORDER BY l.created_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );

        $total = Database::fetchOne(
            "SELECT COUNT(*) as cnt FROM activity_log l WHERE $where", $params
        )['cnt'];

        $this->json(['logs' => $logs, 'total' => (int)$total, 'page' => $page]);
    }

    // ---- Helpers ----

    private function requireAdmin(): array
    {
        $user = Auth::currentUser();
        if (!$user) $this->error('Не авторизовано', 401);
        Auth::requireRole($user, ['admin']);
        return $user;
    }

    private function log(string $action, string $type, int $entityId, $details = null): void
    {
        $user = Auth::currentUser();
        Database::query(
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
             VALUES (?,?,?,?,?,?)',
            [
                $user['sub'] ?? null, $action, $type, $entityId,
                $details ? json_encode($details) : null,
                $_SERVER['REMOTE_ADDR'] ?? null,
            ]
        );
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
