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
    public function __construct()
    {
        Database::ensureTenantSchema();
    }

    // ============================================
    // USERS
    // ============================================

    // GET /api/admin/users
    public function users(): void
    {
        $me = $this->requireAdmin();
        // лише користувачі свого кабінету
        $users = Database::fetchAll(
            'SELECT id, name, email, login, role, company, phone, is_active,
                    last_login_at, created_at
             FROM users WHERE tenant_id = ? ORDER BY created_at DESC',
            [$me['tid']]
        );
        $this->json(['users' => $users]);
    }

    // POST /api/admin/users
    public function createUser(): void
    {
        $me = $this->requireAdmin();
        $body = $this->body();
        // ліміт користувачів тарифу (або індивідуальний ліміт кабінету)
        $t = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$me['tid']]);
        $lim = $t ? \RoofCalc\Core\Plans::limits($t) : ['users' => null];
        if (!empty($lim['users'])) {
            $cnt = (int)Database::fetchOne('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND is_active = 1', [$me['tid']])['c'];
            if ($cnt >= (int)$lim['users']) $this->error('Досягнуто ліміту користувачів вашого тарифу (' . $lim['users'] . ')', 402);
        }

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
            'INSERT INTO users (name, email, login, password_hash, role, company, phone, is_active, tenant_id)
             VALUES (?,?,?,?,?,?,?,?,?)',
            [
                $body['name'],
                $body['email'],
                $body['login'],
                Auth::hashPassword($body['password']),
                $body['role'] ?? 'manager',
                $body['company'] ?? null,
                $body['phone']   ?? null,
                $body['is_active'] ?? 1,
                $me['tid'],
            ]
        );

        $this->log('admin.user.create', 'user', $id);
        $user = Database::fetchOne('SELECT id,name,email,login,role,company,is_active FROM users WHERE id=?', [$id]);
        $this->json(['user' => $user], 201);
    }

    // PUT /api/admin/users/{id}
    public function updateUser(int $id): void
    {
        $me = $this->requireAdmin();
        $target = Database::fetchOne('SELECT tenant_id FROM users WHERE id = ?', [$id]);
        if (!$target || (int)$target['tenant_id'] !== (int)$me['tid']) $this->error('Користувача не знайдено', 404);
        $b0 = $this->body();
        if ((int)$id === (int)$me['sub'] && ((isset($b0['is_active']) && !$b0['is_active']) || (isset($b0['role']) && $b0['role'] !== 'admin'))) {
            $this->error('Не можна вимкнути себе або зняти з себе роль адміністратора', 400);
        }
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
        $me = $this->requireAdmin();
        \RoofCalc\Core\Catalog::ensureSchema();
        // загальний каталог + матеріали свого кабінету
        $profiles = Database::fetchAll(
            'SELECT * FROM material_profiles WHERE deleted = 0 AND (tenant_id IS NULL OR tenant_id = ?) ORDER BY type, sort_order, name',
            [$me['tid']]
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
        $me = $this->requireMaterialEditor();
        Database::ensureMaterialSchema();
        \RoofCalc\Core\Catalog::ensureSchema();
        $body = $this->body();
        $sec = \RoofCalc\Core\Catalog::sectionFor(isset($body['section_id']) ? (int)$body['section_id'] : null, (string)($body['type'] ?? ''));
        $body['manufacturer'] = \RoofCalc\Core\Catalog::canonicalManufacturer($body['manufacturer'] ?? '', (!empty($me['sa']) && empty($me['imp'])) ? null : (int)$me['tid']);
        if ($sec) $body['type'] = $sec['calc_type'];

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
                $body['sort_order']         ?? ((int)(Database::fetchOne('SELECT MAX(sort_order) m FROM material_profiles WHERE section_id <=> ?', [$sec['id'] ?? null])['m'] ?? 0) + 10),
            ]
        );

        // Поля етапу 3 (КП): величина округлення і стандартна довжина
        $extra = []; $vals = [];
        foreach (['round_step', 'max_std_length'] as $f) {
            if (array_key_exists($f, $body)) { $extra[] = "$f = ?"; $vals[] = $body[$f] === '' ? null : $body[$f]; }
        }
        if (!empty($body['published']) && !(!empty($me['sa']) && empty($me['imp'])) && \RoofCalc\Core\Catalog::isManufacturer((int)$me['tid'])) {
            $extra[] = 'published = 1';
        }
        if ($sec) { $extra[] = 'section_id = ?'; $vals[] = $sec['id']; }
        // Супер-адмін у своєму кабінеті поповнює загальний каталог; решта — каталог свого кабінету
        $extra[] = 'tenant_id = ?'; $vals[] = (!empty($me['sa']) && empty($me['imp'])) ? null : $me['tid'];
        $vals[] = $id; Database::query('UPDATE material_profiles SET ' . implode(', ', $extra) . ' WHERE id = ?', $vals);

        $this->log('admin.material.create', 'material', $id);
        $this->json(['id' => $id, 'message' => 'Профіль створено'], 201);
    }

    // PUT /api/admin/materials/{id}
    // Чи може користувач змінювати/видаляти матеріал: власний кабінету або (супер-адмін платформи) каталог ABT
    private function canEditMaterial(array $me, array $mat): bool
    {
        if ($mat['tenant_id'] === null) return !empty($me['sa']) && empty($me['imp']);
        return (int)$mat['tenant_id'] === (int)$me['tid'];
    }

    // Видалити один матеріал: якщо він уже є в розрахунках — ховаємо з каталогу (проекти не ламаються)
    private function removeMaterial(int $id): string
    {
        $used = Database::fetchOne('SELECT COUNT(*) c FROM slopes WHERE material_profile_id = ?', [$id]);
        if ((int)($used['c'] ?? 0) > 0) {
            Database::query('UPDATE material_profiles SET deleted = 1, published = 0, is_active = 0 WHERE id = ?', [$id]);
            return 'hidden';
        }
        Database::query('DELETE FROM material_profiles WHERE id = ?', [$id]);
        return 'deleted';
    }

    // DELETE /api/admin/materials/{id}
    public function deleteMaterial(int $id): void
    {
        $me = $this->requireAdmin();
        \RoofCalc\Core\Catalog::ensureSchema();
        $mat = Database::fetchOne('SELECT id, name, tenant_id FROM material_profiles WHERE id = ? AND deleted = 0', [$id]);
        if (!$mat) $this->error('Матеріал не знайдено', 404);
        if (!$this->canEditMaterial($me, $mat)) $this->error('Видаляти можна лише власні матеріали кабінету', 403);
        $r = $this->removeMaterial($id);
        $this->log('material.delete', 'material', $id, ['name' => $mat['name'], 'result' => $r]);
        $this->json(['result' => $r]);
    }

    // POST /api/admin/materials/delete-group  {type, manufacturer} — видалити виробника (усі його форми цього виду)
    public function deleteMaterialGroup(): void
    {
        $me = $this->requireAdmin();
        \RoofCalc\Core\Catalog::ensureSchema();
        $b = $this->body();
        $type = (string)($b['type'] ?? '');
        $mf = trim((string)($b['manufacturer'] ?? ''));
        $ids = array_map('intval', (array)($b['ids'] ?? []));
        if ($type === '' || !$ids) $this->error('Не вказано матеріали');
        $done = 0; $hidden = 0; $skipped = 0;
        foreach ($ids as $id) {
            $mat = Database::fetchOne('SELECT id, tenant_id FROM material_profiles WHERE id = ? AND type = ? AND deleted = 0', [$id, $type]);
            if (!$mat || !$this->canEditMaterial($me, $mat)) { $skipped++; continue; }
            $this->removeMaterial($id) === 'hidden' ? $hidden++ : $done++;
        }
        $this->log('material.delete_group', 'material', 0, ['manufacturer' => $mf, 'type' => $type, 'deleted' => $done, 'hidden' => $hidden, 'skipped' => $skipped]);
        $this->json(['deleted' => $done, 'hidden' => $hidden, 'skipped' => $skipped]);
    }

    public function updateMaterial(int $id): void
    {
        $me = $this->requireMaterialEditor();
        $mat = Database::fetchOne('SELECT tenant_id FROM material_profiles WHERE id = ?', [$id]);
        if (!$mat) $this->error('Матеріал не знайдено', 404);
        if ($mat['tenant_id'] === null) {
            if (empty($me['sa']) || !empty($me['imp'])) $this->error('Це матеріал каталогу ROOFKIT — скопіюйте його у свій каталог', 403);
        } elseif ((int)$mat['tenant_id'] !== (int)$me['tid']) {
            $this->error('Це матеріал каталогу виробника — створіть копію для свого кабінету', 403);
        }
        Database::ensureMaterialSchema();
        $body = $this->body();
        $mfTid = (!empty($me['sa']) && empty($me['imp'])) ? null : (int)$me['tid'];
        if (array_key_exists('manufacturer', $body)) $body['manufacturer'] = \RoofCalc\Core\Catalog::canonicalManufacturer($body['manufacturer'], $mfTid);

        $jsonFields = ['forbidden_lengths','stock_lengths','color_options','coating_options','thickness_options'];
        $allowed    = ['name','manufacturer','full_width','useful_width','side_overlap','length_overlap',
                       'wave_step','wave_height','min_length','max_length','cut_step','lock_type',
                       'min_joint_distance','join_overlap','min_slope_angle','price_per_m2','is_active','sort_order','type',
                       'round_step','max_std_length',
                       ...$jsonFields];
        // Публікувати в каталозі виробників може лише кабінет-виробник (свій матеріал)
        if (array_key_exists('published', $body) && $mat['tenant_id'] !== null && \RoofCalc\Core\Catalog::isManufacturer((int)$me['tid'])) {
            $allowed[] = 'published';
            $body['published'] = !empty($body['published']) ? 1 : 0;
        }

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
        $me = $this->requireAdmin();
        if (empty($me['sa']) || !empty($me['imp'])) $this->error('Загальні налаштування змінює лише супер-адмін платформи', 403);
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
        $me = $this->requireAdmin();

        $page   = max(1, (int)($_GET['page'] ?? 1));
        $limit  = min(100, (int)($_GET['limit'] ?? 50));
        $offset = ($page - 1) * $limit;

        $where  = 'l.tenant_id = ?';
        $params = [$me['tid']];

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

    // Матеріали може редагувати адміністратор і менеджер (кнопка «Дозволити редагування» у вікні матеріалу)
    private function requireMaterialEditor(): array
    {
        $user = Auth::currentUser();
        if (!$user) $this->error('Не авторизовано', 401);
        Auth::requireRole($user, ['admin', 'manager']);
        return $user;
    }

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
            'INSERT INTO activity_log (user_id, tenant_id, action, entity_type, entity_id, details, ip_address)
             VALUES (?,?,?,?,?,?,?)',
            [
                $user['sub'] ?? null, $user['tid'] ?? null, $action, $type, $entityId,
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
