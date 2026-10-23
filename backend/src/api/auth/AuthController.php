<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/auth/AuthController.php
// ============================================

namespace RoofCalc\Api\Auth;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Plans;

class AuthController
{
    // POST /api/auth/login
    public function login(): void
    {
        $body  = json_decode(file_get_contents('php://input'), true) ?? [];
        $login = trim($body['login'] ?? '');
        $pass  = $body['password'] ?? '';

        if (!$login || !$pass) {
            $this->error('Введіть логін та пароль', 400);
        }

        $user = Database::fetchOne(
            'SELECT id, name, email, login, password_hash, role, company, is_active
             FROM users WHERE (login = ? OR email = ?) LIMIT 1',
            [$login, $login]
        );

        if (!$user || !$user['is_active']) {
            $this->error('Невірний логін або пароль', 401);
        }

        if (!Auth::verifyPassword($pass, $user['password_hash'])) {
            // Логуємо невдалий вхід
            Database::query(
                'INSERT INTO activity_log (action, details, ip_address) VALUES (?, ?, ?)',
                ['auth.fail', json_encode(['login' => $login]), $_SERVER['REMOTE_ADDR'] ?? null]
            );
            $this->error('Невірний логін або пароль', 401);
        }

        $cfg = require __DIR__ . '/../../config/app.php';
        $hours = $cfg['jwt']['expires_hours'];

        $token = Auth::generateToken([
            'sub'     => $user['id'],
            'name'    => $user['name'],
            'email'   => $user['email'],
            'role'    => $user['role'],
            'company' => $user['company'],
        ]);

        Auth::saveSession($user['id'], $token, $hours);

        // Лог успішного входу
        Database::query(
            'INSERT INTO activity_log (user_id, action, ip_address) VALUES (?, ?, ?)',
            [$user['id'], 'auth.login', $_SERVER['REMOTE_ADDR'] ?? null]
        );

        $this->json([
            'token' => $token,
            'expires_in' => $hours * 3600,
            'user' => [
                'id'      => $user['id'],
                'name'    => $user['name'],
                'email'   => $user['email'],
                'role'    => $user['role'],
                'company' => $user['company'],
            ],
        ]);
    }

    // POST /api/auth/logout
    // POST /auth/register — самостійна реєстрація компанії: новий кабінет з пробним періодом
    public function register(): void
    {
        Database::ensurePlatformSchema();
        $b = json_decode(file_get_contents('php://input'), true) ?? [];
        if (!empty($b['website'])) $this->error('Помилка реєстрації', 400);   // пастка для ботів

        $company = trim((string)($b['company'] ?? ''));
        $name    = trim((string)($b['name'] ?? ''));
        $email   = mb_strtolower(trim((string)($b['email'] ?? '')));
        $phone   = trim((string)($b['phone'] ?? ''));
        $pass    = (string)($b['password'] ?? '');
        if ($company === '' || mb_strlen($company) > 200) $this->error('Вкажіть назву компанії');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $this->error('Вкажіть коректний email');
        if (strlen($pass) < 8) $this->error('Пароль — мінімум 8 символів');

        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $recent = Database::fetchOne(
            "SELECT COUNT(*) c FROM tenants WHERE signup_ip = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)", [$ip]
        );
        if ((int)$recent['c'] >= 3) $this->error('Забагато реєстрацій з вашої адреси. Спробуйте пізніше', 429);
        if (Database::fetchOne('SELECT id FROM users WHERE email = ? OR login = ?', [$email, $email])) {
            $this->error('Цей email уже зареєстровано — увійдіть або відновіть пароль', 409);
        }

        $trial = Plans::get('trial');
        $days = max(1, (int)($trial['days'] ?? 14));
        $tid = Database::insert(
            "INSERT INTO tenants (name, plan, status, trial_until, contact_name, contact_email, contact_phone, doc_company, signup_ip)
             VALUES (?, 'trial', 'trial', ?, ?, ?, ?, ?, ?)",
            [$company, date('Y-m-d', strtotime("+$days days")), $name ?: null, $email, $phone ?: null, $company, $ip]
        );
        $uid = Database::insert(
            "INSERT INTO users (name, email, login, password_hash, role, company, phone, is_active, tenant_id)
             VALUES (?, ?, ?, ?, 'admin', ?, ?, 1, ?)",
            [$name ?: $company, $email, $email, Auth::hashPassword($pass), $company, $phone ?: null, $tid]
        );
        Database::query(
            'INSERT INTO activity_log (user_id, tenant_id, action, ip_address) VALUES (?, ?, ?, ?)',
            [$uid, $tid, 'auth.register', $ip]
        );
        // новий кабінет одразу отримує каталог ROOFKIT як особистий
        try { \RoofCalc\Core\Catalog::ensureSchema(); \RoofCalc\Core\Catalog::seedTenant((int)$tid); } catch (\Throwable $e) { error_log('seed: ' . $e->getMessage()); }

        $cfg = require __DIR__ . '/../../config/app.php';
        $hours = $cfg['jwt']['expires_hours'];
        $token = Auth::generateToken(['sub' => $uid, 'name' => $name ?: $company, 'email' => $email, 'role' => 'admin', 'company' => $company]);
        Auth::saveSession($uid, $token, $hours);
        $this->json([
            'token' => $token, 'expires_in' => $hours * 3600,
            'user' => ['id' => $uid, 'name' => $name ?: $company, 'email' => $email, 'login' => $email, 'role' => 'admin', 'company' => $company],
        ], 201);
    }

    // GET /plans — публічні тарифи для сторінки реєстрації
    public function plans(): void
    {
        $out = [];
        foreach (Plans::all() as $k => $p) {
            if ($k === 'trial' || !empty($p['public'])) $out[$k] = $p;
        }
        $this->json(['plans' => $out]);
    }

    public function logout(): void
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(.+)/i', $header, $m)) {
            Auth::revokeToken(trim($m[1]));
        }
        $this->json(['message' => 'Вихід виконано']);
    }

    // GET /api/auth/me
    public function me(): void
    {
        $payload = Auth::currentUser();
        if (!$payload) {
            $this->error('Не авторизовано', 401);
        }

        $user = Database::fetchOne(
            'SELECT id, name, email, login, role, company, phone, last_login_at FROM users WHERE id = ?',
            [$payload['sub']]
        );

        if (!$user) {
            $this->error('Користувача не знайдено', 404);
        }

        // Кабінет і права платформи
        Database::ensurePlatformSchema();
        \RoofCalc\Core\Catalog::ensureSchema();
        $t = Database::fetchOne('SELECT id, name, plan, status, is_internal, is_manufacturer, trial_until, paid_until, doc_company FROM tenants WHERE id = ?', [$payload['tid']]);
        $user['role']          = $payload['role'];
        $user['is_superadmin'] = !empty($payload['sa']);
        $user['impersonating'] = !empty($payload['imp']);
        $user['tenant']        = $t ? $t + ['active' => $payload['tenant_active']] : null;

        $this->json(['user' => $user]);
    }

    // POST /api/auth/change-password
    public function changePassword(): void
    {
        $payload = Auth::currentUser();
        if (!$payload) $this->error('Не авторизовано', 401);

        $body    = json_decode(file_get_contents('php://input'), true) ?? [];
        $current = $body['current_password'] ?? '';
        $new     = $body['new_password'] ?? '';

        if (strlen($new) < 8) {
            $this->error('Новий пароль має бути мінімум 8 символів', 400);
        }

        $user = Database::fetchOne(
            'SELECT password_hash FROM users WHERE id = ?',
            [$payload['sub']]
        );

        if (!Auth::verifyPassword($current, $user['password_hash'])) {
            $this->error('Невірний поточний пароль', 400);
        }

        Database::query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [Auth::hashPassword($new), $payload['sub']]
        );

        $this->json(['message' => 'Пароль змінено']);
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
