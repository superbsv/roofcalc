<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/Auth.php
// ============================================

namespace RoofCalc\Core;

class Auth
{
    // ---- Генерація JWT ----
    public static function generateToken(array $payload): string
    {
        $cfg = require __DIR__ . '/../config/app.php';
        $secret = $cfg['jwt']['secret'];
        $hours  = $cfg['jwt']['expires_hours'];

        $header  = self::base64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload['iat'] = time();
        $payload['exp'] = time() + $hours * 3600;
        $body    = self::base64url(json_encode($payload));
        $sig     = self::base64url(hash_hmac('sha256', "$header.$body", $secret, true));

        return "$header.$body.$sig";
    }

    // ---- Перевірка JWT ----
    public static function validateToken(string $token): ?array
    {
        $cfg    = require __DIR__ . '/../config/app.php';
        $secret = $cfg['jwt']['secret'];

        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        [$header, $body, $sig] = $parts;
        $expected = self::base64url(hash_hmac('sha256', "$header.$body", $secret, true));
        if (!hash_equals($expected, $sig)) return null;

        $payload = json_decode(base64_decode(strtr($body, '-_', '+/')), true);
        if (!$payload || $payload['exp'] < time()) return null;

        return $payload;
    }

    // ---- Поточний користувач з заголовка (або з ?token= для посилань на файли) ----
    // До даних JWT додаються свіжі дані з БД:
    //   tid — кабінет, у якому працює користувач (для супер-адміна під час «Увійти як» — чужий кабінет)
    //   sa  — супер-адмін платформи; imp — зараз у чужому кабінеті; tenant_active — кабінет оплачено/активний
    public static function currentUser(?string $token = null): ?array
    {
        if ($token === null) {
            $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) return null;
            $token = trim($m[1]);
        }

        $payload = self::validateToken($token);
        if (!$payload) return null;

        // Перевіряємо що сесія не відкликана
        $hash = hash('sha256', $token);
        $session = Database::fetchOne(
            'SELECT id FROM auth_sessions WHERE token_hash = ? AND expires_at > NOW()',
            [$hash]
        );
        if (!$session) return null;

        Database::ensureTenantSchema();
        $u = Database::fetchOne(
            'SELECT id, role, is_active, tenant_id, is_superadmin FROM users WHERE id = ?',
            [$payload['sub']]
        );
        if (!$u || !(int)$u['is_active']) return null;

        $sa  = (int)$u['is_superadmin'] === 1;
        $tid = (int)$u['tenant_id'];
        $imp = false;
        if ($sa && !empty($payload['imp_tid'])) { $tid = (int)$payload['imp_tid']; $imp = true; }

        $t = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$tid]);
        $payload['role']          = $imp ? 'admin' : $u['role'];
        $payload['tid']           = $tid;
        $payload['sa']            = $sa;
        $payload['imp']           = $imp;
        $payload['tenant_name']   = $t['name'] ?? '';
        $payload['tenant_active'] = self::tenantActive($t);
        return $payload;
    }

    // Кабінет активний: не заблоковано і оплачено (або пробний період не закінчився); внутрішній — завжди
    public static function tenantActive(?array $t): bool
    {
        if (!$t) return false;
        if ((int)($t['is_internal'] ?? 0) === 1) return true;
        if (($t['status'] ?? '') === 'blocked') return false;
        $today = date('Y-m-d');
        if (($t['status'] ?? '') === 'trial') return empty($t['trial_until']) || $t['trial_until'] >= $today;
        return empty($t['paid_until']) || $t['paid_until'] >= $today;
    }

    // Доступ до проєкту: той самий кабінет і (своя робота або роль з доступом до всіх проєктів кабінету)
    // Доступ до розрахунку: лише свій кабінет; адміністратор кабінету бачить усі розрахунки кабінету,
    // менеджер та інші ролі — тільки власні. Панель платформи (супер-адмін поза кабінетом) розрахунків не має.
    public static function projectAllowed(array $user, ?array $project, array $roles = ['admin']): bool
    {
        if (!$project) return false;
        if (!empty($user['sa']) && empty($user['imp'])) return false;
        if ((int)($project['tenant_id'] ?? 0) !== (int)($user['tid'] ?? -1)) return false;
        return in_array($user['role'] ?? '', $roles, true) || (int)$project['user_id'] === (int)$user['sub'];
    }

    // ---- Хешування пароля ----
    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    public static function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    // ---- Збереження сесії в БД ----
    public static function saveSession(int $userId, string $token, int $hours): void
    {
        $hash    = hash('sha256', $token);
        $expires = date('Y-m-d H:i:s', time() + $hours * 3600);
        $ip      = $_SERVER['REMOTE_ADDR'] ?? null;
        $ua      = substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255);

        Database::query(
            'INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?)',
            [$userId, $hash, $expires, $ip, $ua]
        );

        // Оновлюємо last_login_at
        Database::query(
            'UPDATE users SET last_login_at = NOW() WHERE id = ?',
            [$userId]
        );
    }

    // ---- Відкликати сесію ----
    public static function revokeToken(string $token): void
    {
        $hash = hash('sha256', $token);
        Database::query('DELETE FROM auth_sessions WHERE token_hash = ?', [$hash]);
    }

    // ---- Очистка старих сесій ----
    public static function cleanExpiredSessions(): void
    {
        Database::query('DELETE FROM auth_sessions WHERE expires_at < NOW()');
    }

    // ---- Перевірка ролі ----
    public static function requireRole(array $payload, array $roles): void
    {
        if (!in_array($payload['role'] ?? '', $roles, true)) {
            http_response_code(403);
            echo json_encode(['error' => 'Доступ заборонено']);
            exit;
        }
    }

    private static function base64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
