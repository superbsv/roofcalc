<?php
// ============================================
// ABT Покрівля — api/tenant/TenantController.php
// Налаштування власного кабінету: реквізити і логотип для документів, колір, нумерація,
// тариф і використання лімітів. Змінює власник/адміністратор кабінету. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Tenant;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Plans;

class TenantController
{
    private array $me;

    public function __construct()
    {
        Database::ensurePlatformSchema();
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        $this->me = $u;
    }

    // GET /tenant
    public function show(): void
    {
        $this->json(self::payload((int)$this->me['tid']));
    }

    // PUT /tenant
    public function update(): void
    {
        if ($this->me['role'] !== 'admin') $this->error('Налаштування кабінету змінює власник або адміністратор', 403);
        $b = json_decode(file_get_contents('php://input'), true) ?? [];
        $fields = []; $params = [];

        foreach (['name' => 200, 'doc_company' => 200, 'doc_address' => 255, 'doc_phone' => 80, 'doc_email' => 150, 'doc_site' => 150, 'doc_requisites' => 2000] as $f => $len) {
            if (!array_key_exists($f, $b)) continue;
            $v = trim((string)$b[$f]);
            if ($f === 'name' && $v === '') continue;
            $fields[] = "$f = ?"; $params[] = $v === '' ? null : mb_substr($v, 0, $len);
        }
        if (array_key_exists('brand_color', $b)) {
            $c = (string)$b['brand_color'];
            $fields[] = 'brand_color = ?'; $params[] = preg_match('/^#[0-9a-fA-F]{6}$/', $c) ? strtoupper($c) : null;
        }
        if (array_key_exists('next_order_no', $b)) {
            $n = (int)$b['next_order_no'];
            if ($n > 0) { $fields[] = 'next_order_no = ?'; $params[] = $n; }
        }
        if (array_key_exists('logo', $b)) {
            $logo = $b['logo'];
            if ($logo === null || $logo === '') { $fields[] = 'logo = NULL'; }
            else {
                if (!preg_match('#^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$#', (string)$logo, $m)) $this->error('Логотип — файл PNG або JPG');
                $bin = base64_decode($m[2], true);
                if ($bin === false || strlen($bin) > 400 * 1024) $this->error('Логотип завеликий — до 400 КБ');
                if (!@getimagesizefromstring($bin)) $this->error('Файл логотипу пошкоджений');
                $fields[] = 'logo = ?'; $params[] = $logo;
            }
        }
        if ($fields) {
            $params[] = $this->me['tid'];
            Database::query('UPDATE tenants SET ' . implode(', ', $fields) . ' WHERE id = ?', $params);
            Database::query(
                'INSERT INTO activity_log (user_id, tenant_id, action, entity_type, entity_id, ip_address) VALUES (?,?,?,?,?,?)',
                [$this->me['sub'], $this->me['tid'], 'tenant.settings.update', 'tenant', $this->me['tid'], $_SERVER['REMOTE_ADDR'] ?? null]
            );
        }
        $this->json(self::payload((int)$this->me['tid']));
    }

    // Дані кабінету для сторінки налаштувань (і для /auth/me — без логотипу)
    public static function payload(int $tid, bool $withLogo = true): array
    {
        $t = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$tid]);
        if (!$t) return ['tenant' => null];
        if (!$withLogo) unset($t['logo']);
        unset($t['notes'], $t['signup_ip']);   // службове ABT
        $plan = Plans::get((string)$t['plan']);
        $limits = Plans::limits($t);
        $usage = [
            'users' => (int)Database::fetchOne('SELECT COUNT(*) c FROM users WHERE tenant_id = ? AND is_active = 1', [$tid])['c'],
            'projects_month' => (int)Database::fetchOne(
                "SELECT COUNT(*) c FROM projects WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')", [$tid]
            )['c'],
        ];
        $t['active'] = Auth::tenantActive($t);
        return ['tenant' => $t, 'plan' => ['key' => $t['plan'], 'name' => $plan['name']], 'limits' => $limits, 'usage' => $usage];
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
