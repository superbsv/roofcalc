<?php
// ============================================
// ABT Покрівля — api/super/SuperController.php
// Панель супер-адміна платформи: кабінети (тенанти), тарифи, ліміти, «Увійти як».
// Доступ — лише users.is_superadmin = 1. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Super;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Plans;

class SuperController
{

    private array $me;

    public function __construct()
    {
        Database::ensurePlatformSchema();
        \RoofCalc\Core\Catalog::ensureSchema();
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        if (empty($u['sa'])) $this->error('Доступ лише для супер-адміна платформи', 403);
        $this->me = $u;
    }

    // GET /super/stats
    public function stats(): void
    {
        $rows = Database::fetchAll('SELECT * FROM tenants');
        $s = ['tenants' => 0, 'active' => 0, 'trial' => 0, 'expired' => 0, 'blocked' => 0, 'by_plan' => []];
        foreach ($rows as $t) {
            if ((int)$t['is_internal'] === 1) continue;
            $s['tenants']++;
            $st = self::state($t);
            $s[$st] = ($s[$st] ?? 0) + 1;
            $s['by_plan'][$t['plan']] = ($s['by_plan'][$t['plan']] ?? 0) + 1;
        }
        $s['users'] = (int)Database::fetchOne('SELECT COUNT(*) c FROM users WHERE is_active = 1')['c'];
        $s['projects_30d'] = (int)Database::fetchOne('SELECT COUNT(*) c FROM projects WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)')['c'];
        $this->json(['stats' => $s, 'plans' => Plans::names(), 'plan_defs' => Plans::all()]);
    }

    // GET /super/tenants?search=
    public function tenants(): void
    {
        $where = '1=1'; $params = [];
        if (!empty($_GET['search'])) {
            $q = '%' . $_GET['search'] . '%';
            $where = '(t.name LIKE ? OR t.contact_email LIKE ? OR t.contact_phone LIKE ? OR t.city LIKE ?)';
            $params = [$q, $q, $q, $q];
        }
        $rows = Database::fetchAll(
            "SELECT t.*,
                (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active = 1) AS users_count,
                (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at,
                (SELECT COUNT(*) FROM projects p WHERE p.tenant_id = t.id) AS projects_count,
                (SELECT COUNT(*) FROM projects p WHERE p.tenant_id = t.id AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS projects_30d
             FROM tenants t WHERE $where ORDER BY t.is_internal DESC, t.created_at DESC",
            $params
        );
        foreach ($rows as &$t) { $t['state'] = self::state($t); unset($t['logo']); }
        unset($t);
        $this->json(['tenants' => $rows, 'plans' => Plans::names()]);
    }

    // GET /super/tenants/{id}
    public function tenant(int $id): void
    {
        $t = $this->find($id);
        $t['state'] = self::state($t);
        $users = Database::fetchAll(
            'SELECT id, name, email, login, role, is_active, last_login_at, created_at FROM users WHERE tenant_id = ? ORDER BY id',
            [$id]
        );
        $stats = [
            'projects'     => (int)Database::fetchOne('SELECT COUNT(*) c FROM projects WHERE tenant_id = ?', [$id])['c'],
            'projects_30d' => (int)Database::fetchOne('SELECT COUNT(*) c FROM projects WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)', [$id])['c'],
            'materials'    => (int)Database::fetchOne('SELECT COUNT(*) c FROM material_profiles WHERE tenant_id = ?', [$id])['c'],
        ];
        $log = Database::fetchAll(
            'SELECT a.action, a.created_at, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.tenant_id = ? ORDER BY a.id DESC LIMIT 20',
            [$id]
        );
        unset($t['logo']);
        $this->json(['tenant' => $t, 'users' => $users, 'stats' => $stats, 'log' => $log, 'plans' => Plans::names(),
            'limits' => Plans::limits($t), 'plan_defs' => Plans::all()]);
    }

    // POST /super/tenants — новий кабінет разом із власником
    public function createTenant(): void
    {
        $b = $this->body();
        $name = trim($b['name'] ?? '');
        $ownerLogin = trim($b['owner_login'] ?? '');
        $ownerEmail = trim($b['owner_email'] ?? '');
        $ownerPass  = (string)($b['owner_password'] ?? '');
        if ($name === '') $this->error('Вкажіть назву компанії');
        if ($ownerLogin === '' && $ownerEmail === '') $this->error('Вкажіть логін або email власника кабінету');
        if (strlen($ownerPass) < 8) $this->error('Пароль власника — мінімум 8 символів');
        $this->assertLoginFree($ownerLogin, $ownerEmail);

        $plan = isset(Plans::names()[$b['plan'] ?? '']) ? $b['plan'] : 'trial';
        if ($plan === 'internal') $plan = 'custom';
        $status = $plan === 'trial' ? 'trial' : 'active';
        $trialDays = max(1, (int)($b['trial_days'] ?? 14));

        $id = Database::insert(
            'INSERT INTO tenants (name, plan, status, trial_until, paid_until, max_users, max_projects_month,
                contact_name, contact_email, contact_phone, city, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [
                $name, $plan, $status,
                $status === 'trial' ? date('Y-m-d', strtotime("+$trialDays days")) : null,
                $this->dateOrNull($b['paid_until'] ?? null),
                $this->intOrNull($b['max_users'] ?? null),
                $this->intOrNull($b['max_projects_month'] ?? null),
                trim($b['owner_name'] ?? '') ?: null,
                $ownerEmail ?: null,
                trim($b['contact_phone'] ?? '') ?: null,
                trim($b['city'] ?? '') ?: null,
                trim($b['notes'] ?? '') ?: null,
            ]
        );
        $this->insertUser($id, [
            'name' => trim($b['owner_name'] ?? '') ?: $name, 'login' => $ownerLogin ?: $ownerEmail,
            'email' => $ownerEmail ?: null, 'password' => $ownerPass, 'role' => 'admin',
        ]);
        $this->log('super.tenant.create', $id);
        $this->tenant($id);
    }

    // PUT /super/tenants/{id}
    public function updateTenant(int $id): void
    {
        $t = $this->find($id);
        $b = $this->body();
        $fields = []; $params = [];
        $map = [
            'name' => 'str', 'plan' => 'plan', 'status' => 'status', 'trial_until' => 'date', 'paid_until' => 'date',
            'max_users' => 'int', 'max_projects_month' => 'int', 'contact_name' => 'str', 'contact_email' => 'str',
            'contact_phone' => 'str', 'city' => 'str', 'notes' => 'str', 'is_manufacturer' => 'bool',
        ];
        foreach ($map as $f => $kind) {
            if (!array_key_exists($f, $b)) continue;
            $v = $b[$f];
            if ($kind === 'date') $v = $this->dateOrNull($v);
            elseif ($kind === 'int') $v = $this->intOrNull($v);
            elseif ($kind === 'plan') { if (!isset(Plans::names()[$v]) || ($v === 'internal') !== ((int)$t['is_internal'] === 1)) continue; }
            elseif ($kind === 'status') { if (!in_array($v, ['active', 'trial', 'blocked'], true)) continue; }
            elseif ($kind === 'bool') $v = !empty($v) ? 1 : 0;
            else $v = trim((string)$v) === '' ? null : trim((string)$v);
            if ($f === 'name' && !$v) continue;
            if ((int)$t['is_internal'] === 1 && in_array($f, ['status', 'plan'], true)) continue;  // внутрішній кабінет ABT не блокується
            $fields[] = "$f = ?"; $params[] = $v;
        }
        if ($fields) {
            $params[] = $id;
            Database::query('UPDATE tenants SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
            $this->log('super.tenant.update', $id, array_keys(array_intersect_key($b, $map)));
        }
        $this->tenant($id);
    }

    // DELETE /super/tenants/{id}  {confirm: "<назва кабінету>"} — повне видалення кабінету з усіма даними
    public function deleteTenant(int $id): void
    {
        $t = $this->find($id);
        if ((int)$t['is_internal'] === 1) $this->error('Внутрішній кабінет платформи видаляти не можна', 403);
        if ((int)($this->me['tid'] ?? 0) === $id) $this->error('Не можна видалити кабінет, у якому ви зараз працюєте', 403);
        if (Database::fetchOne('SELECT id FROM users WHERE tenant_id = ? AND is_superadmin = 1 LIMIT 1', [$id])) {
            $this->error('У кабінеті є супер-адмін платформи — його видаляти не можна', 403);
        }
        $b = $this->body();
        if (trim((string)($b['confirm'] ?? '')) !== trim((string)$t['name'])) $this->error('Для підтвердження введіть точну назву кабінету');

        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $pids = 'SELECT id FROM projects WHERE tenant_id = ?';
            Database::query("DELETE FROM specification_items WHERE project_id IN ($pids)", [$id]);
            Database::query("DELETE FROM slopes WHERE project_id IN ($pids)", [$id]);
            Database::query('DELETE FROM projects WHERE tenant_id = ?', [$id]);
            Database::query('DELETE FROM leads WHERE tenant_id = ?', [$id]);
            // Матеріали виробника, які вже використані в розрахунках інших кабінетів, переходять у загальний каталог
            $kept = Database::query(
                'UPDATE material_profiles SET tenant_id = NULL WHERE tenant_id = ? AND id IN (SELECT s.material_profile_id FROM slopes s)',
                [$id]
            )->rowCount();
            Database::query('DELETE FROM material_profiles WHERE tenant_id = ?', [$id]);
            Database::query('DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)', [$id]);
            Database::query('UPDATE activity_log SET tenant_id = NULL WHERE tenant_id = ?', [$id]);
            $users = Database::query('DELETE FROM users WHERE tenant_id = ?', [$id])->rowCount();
            Database::query('DELETE FROM tenants WHERE id = ?', [$id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            $this->error('Не вдалося видалити кабінет: ' . $e->getMessage(), 500);
        }
        $this->log('super.tenant.delete', $id, ['name' => $t['name'], 'users' => $users, 'materials_to_catalog' => $kept]);
        $this->json(['deleted' => $id, 'materials_to_catalog' => $kept]);
    }

    // POST /super/tenants/{id}/extend  {months} — продовжити оплату вручну
    public function extend(int $id): void
    {
        $t = $this->find($id);
        $b = $this->body();
        $months = max(1, min(36, (int)($b['months'] ?? 1)));
        $from = (!empty($t['paid_until']) && $t['paid_until'] >= date('Y-m-d')) ? $t['paid_until'] : date('Y-m-d');
        $until = date('Y-m-d', strtotime("$from +$months months"));
        $plan = $t['plan'] === 'trial' ? (isset(Plans::names()[$b['plan'] ?? '']) && $b['plan'] !== 'trial' && $b['plan'] !== 'internal' ? $b['plan'] : 'start') : $t['plan'];
        Database::query("UPDATE tenants SET paid_until = ?, status = 'active', plan = ? WHERE id = ?", [$until, $plan, $id]);
        $this->log('super.tenant.extend', $id, ['months' => $months, 'until' => $until]);
        $this->tenant($id);
    }

    // POST /super/tenants/{id}/users — додати користувача в кабінет
    public function addUser(int $id): void
    {
        $this->find($id);
        $b = $this->body();
        $login = trim($b['login'] ?? ''); $email = trim($b['email'] ?? '');
        if ($login === '' && $email === '') $this->error('Вкажіть логін або email');
        if (strlen((string)($b['password'] ?? '')) < 8) $this->error('Пароль — мінімум 8 символів');
        $this->assertLoginFree($login, $email);
        $role = in_array($b['role'] ?? '', ['admin', 'manager', 'dealer', 'production', 'viewer'], true) ? $b['role'] : 'manager';
        $this->insertUser($id, ['name' => trim($b['name'] ?? '') ?: ($login ?: $email), 'login' => $login ?: $email,
            'email' => $email ?: null, 'password' => (string)$b['password'], 'role' => $role]);
        $this->log('super.user.create', $id);
        $this->tenant($id);
    }

    // PUT /super/plans — тарифи платформи (назва, ціна, ліміти, можливості)
    public function savePlans(): void
    {
        $b = $this->body();
        $plans = Plans::save(is_array($b['plans'] ?? null) ? $b['plans'] : []);
        $this->log('super.plans.update', 0);
        $this->json(['plans' => $plans]);
    }

    // GET /super/stats повертає і визначення тарифів
    // POST /super/tenants/{id}/impersonate — «Увійти як»: окремий токен з кабінетом клієнта
    public function impersonate(int $id): void
    {
        $t = $this->find($id);
        $hours = 4;
        $token = Auth::generateToken([
            'sub' => $this->me['sub'], 'name' => $this->me['name'] ?? '', 'email' => $this->me['email'] ?? '',
            'role' => 'admin', 'company' => $t['name'], 'imp_tid' => (int)$t['id'],
        ]);
        Auth::saveSession((int)$this->me['sub'], $token, $hours);
        // запис у журнал самого кабінету — клієнт бачить, коли заходила підтримка
        Database::query(
            'INSERT INTO activity_log (user_id, tenant_id, action, entity_type, entity_id, ip_address) VALUES (?,?,?,?,?,?)',
            [$this->me['sub'], $id, 'support.login_as', 'tenant', $id, $_SERVER['REMOTE_ADDR'] ?? null]
        );
        $this->json(['token' => $token, 'tenant' => ['id' => (int)$t['id'], 'name' => $t['name']]]);
    }

    // POST /super/leave — завершити «Увійти як» (токен кабінету відкликається)
    public function leave(): void
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!empty($this->me['imp']) && preg_match('/Bearer\s+(.+)/i', $header, $m)) Auth::revokeToken(trim($m[1]));
        $this->json(['message' => 'ok']);
    }

    // ---------- helpers ----------

    // Стан кабінету для списку: internal / active / trial / expired / blocked
    public static function state(array $t): string
    {
        if ((int)$t['is_internal'] === 1) return 'internal';
        if ($t['status'] === 'blocked') return 'blocked';
        return Auth::tenantActive($t) ? ($t['status'] === 'trial' ? 'trial' : 'active') : 'expired';
    }

    private function find(int $id): array
    {
        $t = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$id]);
        if (!$t) $this->error('Кабінет не знайдено', 404);
        return $t;
    }

    private function assertLoginFree(string $login, string $email): void
    {
        if ($login !== '' && Database::fetchOne('SELECT id FROM users WHERE login = ? OR email = ?', [$login, $login])) {
            $this->error('Логін «' . $login . '» уже зайнятий');
        }
        if ($email !== '' && Database::fetchOne('SELECT id FROM users WHERE email = ? OR login = ?', [$email, $email])) {
            $this->error('Email «' . $email . '» уже використовується');
        }
    }

    private function insertUser(int $tenantId, array $u): int
    {
        return Database::insert(
            'INSERT INTO users (name, email, login, password_hash, role, company, is_active, tenant_id) VALUES (?,?,?,?,?,?,1,?)',
            [$u['name'], $u['email'], $u['login'], Auth::hashPassword($u['password']), $u['role'],
             (Database::fetchOne('SELECT name FROM tenants WHERE id = ?', [$tenantId])['name'] ?? null), $tenantId]
        );
    }

    private function dateOrNull($v): ?string
    {
        $v = trim((string)$v);
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    }

    private function intOrNull($v): ?int
    {
        if ($v === null || $v === '' || $v === '∞') return null;
        $i = (int)$v;
        return $i > 0 ? $i : null;
    }

    private function log(string $action, int $tenantId, $details = null): void
    {
        Database::query(
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?,?,?,?,?,?)',
            [$this->me['sub'], $action, 'tenant', $tenantId, $details === null ? null : json_encode($details, JSON_UNESCAPED_UNICODE), $_SERVER['REMOTE_ADDR'] ?? null]
        );
    }

    private function body(): array
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }

    private function json(array $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    private function error(string $msg, int $code = 400): void
    {
        $this->json(['error' => $msg], $code);
    }
}
