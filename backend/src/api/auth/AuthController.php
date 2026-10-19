<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/auth/AuthController.php
// ============================================

namespace RoofCalc\Api\Auth;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

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
