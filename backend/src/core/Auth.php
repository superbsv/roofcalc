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

    // ---- Поточний користувач з заголовка ----
    public static function currentUser(): ?array
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) return null;

        $payload = self::validateToken(trim($m[1]));
        if (!$payload) return null;

        // Перевіряємо що сесія не відкликана
        $hash = hash('sha256', trim($m[1]));
        $session = Database::fetchOne(
            'SELECT id FROM auth_sessions WHERE token_hash = ? AND expires_at > NOW()',
            [$hash]
        );
        if (!$session) return null;

        return $payload;
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
