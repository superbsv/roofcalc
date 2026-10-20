<?php
// ============================================
// ROOFKIT — api/widget/WidgetController.php
// Віджет калькулятора на сайті кабінету-клієнта: публічні конфіг, розрахунок, заявка;
// у кабінеті — налаштування віджета і список заявок. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Widget;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Catalog;
use RoofCalc\Core\Calculation\SheetLayoutEngine;

require_once __DIR__ . '/../../core/calculation/SheetLayoutEngine.php';

class WidgetController
{
    private static bool $ready = false;

    public static function ensureSchema(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        Database::ensurePlatformSchema();
        Catalog::ensureSchema();
        Database::ensureColumn('tenants', 'widget_key', 'VARCHAR(40) NULL');
        Database::ensureColumn('tenants', 'widget_enabled', 'TINYINT NOT NULL DEFAULT 0');
        Database::ensureColumn('tenants', 'widget_materials', 'TEXT NULL');
        Database::ensureColumn('tenants', 'widget_k', 'INT NULL');
        Database::query("CREATE TABLE IF NOT EXISTS leads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            name VARCHAR(120) NULL, phone VARCHAR(40) NULL, email VARCHAR(150) NULL, comment TEXT NULL,
            payload MEDIUMTEXT NULL, source_url VARCHAR(255) NULL, ip VARCHAR(45) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'new',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX (tenant_id, created_at)
        ) DEFAULT CHARSET=utf8mb4");
    }

    // ---------------- Публічна частина (без входу) ----------------

    private function tenantByKey(string $key): array
    {
        self::ensureSchema();
        $t = Database::fetchOne('SELECT * FROM tenants WHERE widget_key = ? AND widget_enabled = 1', [$key]);
        if (!$t || !Auth::tenantActive($t)) $this->error('Калькулятор тимчасово недоступний', 404);
        return $t;
    }

    private function widgetMaterials(array $t): array
    {
        [$w, $p] = Catalog::visibleSql((int)$t['id']);
        $ids = json_decode((string)($t['widget_materials'] ?? ''), true);
        $rows = Database::fetchAll("SELECT * FROM material_profiles WHERE is_active = 1 AND type IN ('tile','profile','falts') AND $w ORDER BY type, manufacturer, name", $p);
        if (is_array($ids) && $ids) {
            $ids = array_map('intval', $ids);
            $rows = array_values(array_filter($rows, function ($r) use ($ids) { return in_array((int)$r['id'], $ids, true); }));
        } else {
            // за замовчуванням — власні матеріали кабінету, а якщо їх немає — каталог ABT
            $own = array_values(array_filter($rows, function ($r) use ($t) { return (int)$r['tenant_id'] === (int)$t['id']; }));
            $rows = $own ?: array_values(array_filter($rows, function ($r) { return $r['tenant_id'] === null; }));
        }
        return $rows;
    }

    // GET /widget/{key}/config
    public function config(string $key): void
    {
        $t = $this->tenantByKey($key);
        $mats = array_map(function ($m) {
            return ['id' => (int)$m['id'], 'name' => $m['name'], 'manufacturer' => $m['manufacturer'], 'type' => $m['type']];
        }, $this->widgetMaterials($t));
        $this->json([
            'company' => $t['doc_company'] ?: $t['name'],
            'phone'   => $t['doc_phone'] ?? '',
            'site'    => $t['doc_site'] ?? '',
            'color'   => $t['brand_color'] ?: '#FF7A1A',
            'logo'    => $t['logo'] ?? '',
            'materials' => $mats,
        ]);
    }

    // POST /widget/{key}/calc  {material_id, slopes: [{points: [[x,y]...] (мм), count}]}
    public function calc(string $key): void
    {
        $t = $this->tenantByKey($key);
        $b = $this->body();
        $mid = (int)($b['material_id'] ?? 0);
        $mat = null;
        foreach ($this->widgetMaterials($t) as $m) if ((int)$m['id'] === $mid) $mat = $m;
        if (!$mat) $this->error('Оберіть матеріал');
        $slopes = is_array($b['slopes'] ?? null) ? array_slice($b['slopes'], 0, 8) : [];
        if (!$slopes) $this->error('Вкажіть розміри даху');

        $profile = $mat;
        $profile['type'] = $mat['type'];
        $k = $t['widget_k'] !== null ? (int)$t['widget_k'] : 50;
        $tot = ['area' => 0.0, 'sheets' => 0, 'running_m' => 0.0, 'full_area' => 0.0, 'lengths' => []];
        foreach ($slopes as $s) {
            $pts = [];
            foreach ((array)($s['points'] ?? []) as $p) {
                if (!is_array($p) || count($p) < 2) continue;
                $x = (int)round((float)$p[0]); $y = (int)round((float)$p[1]);
                if ($x < 0 || $y < 0 || $x > 60000 || $y > 30000) $this->error('Розміри даху поза межами (до 60 × 30 м)');
                $pts[] = [$x, $y];
            }
            if (count($pts) < 3 || count($pts) > 12) $this->error('Невірна форма ската');
            $cnt = max(1, min(4, (int)($s['count'] ?? 1)));
            $slope = ['polygon_points' => $pts, 'holes' => [], 'eave_overhang' => $k, 'ridge_gap' => 0, 'laying_direction' => 'right_left'];
            $r = (new SheetLayoutEngine($profile, $slope, 'order'))->calculate();
            if (!empty($r['errors'])) $this->error('Не вдалося розрахувати: ' . implode('; ', $r['errors']));
            $tot['area']      += $cnt * (float)$r['slope_area_m2'];
            $tot['sheets']    += $cnt * (int)$r['total_sheets'];
            $tot['running_m'] += $cnt * (float)$r['running_m'];
            $tot['full_area'] += $cnt * (float)($r['total_full_area_m2'] ?? 0);
            foreach (($r['sheets_by_length'] ?? []) as $g) {
                $L = (int)$g['length_mm'];
                $tot['lengths'][$L] = ($tot['lengths'][$L] ?? 0) + $cnt * (int)$g['count'];
            }
        }
        krsort($tot['lengths']);
        $lengths = [];
        foreach ($tot['lengths'] as $L => $c) $lengths[] = ['length_mm' => $L, 'count' => $c];
        $this->json([
            'material'  => trim(($mat['manufacturer'] ?? '') . ' ' . $mat['name']),
            'area_m2'   => round($tot['area'], 2),
            'sheets'    => $tot['sheets'],
            'running_m' => round($tot['running_m'], 2),
            'full_area_m2' => round($tot['full_area'], 2),
            'lengths'   => $lengths,
        ]);
    }

    // POST /widget/{key}/lead {name, phone, email?, comment?, website (пастка), calc: {...}, roof: {...}}
    public function lead(string $key): void
    {
        $t = $this->tenantByKey($key);
        $b = $this->body();
        if (!empty($b['website'])) $this->json(['ok' => true]);   // бот
        $name  = mb_substr(trim((string)($b['name'] ?? '')), 0, 120);
        $phone = mb_substr(trim((string)($b['phone'] ?? '')), 0, 40);
        $email = mb_substr(trim((string)($b['email'] ?? '')), 0, 150);
        if (preg_replace('/\D/', '', $phone) === '' || strlen(preg_replace('/\D/', '', $phone)) < 9) $this->error('Вкажіть номер телефону');
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $recent = (int)Database::fetchOne('SELECT COUNT(*) c FROM leads WHERE ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)', [$ip])['c'];
        if ($recent >= 5) $this->error('Забагато заявок з вашої адреси — спробуйте пізніше або зателефонуйте', 429);
        $payload = json_encode(['roof' => $b['roof'] ?? null, 'calc' => $b['calc'] ?? null], JSON_UNESCAPED_UNICODE);
        if (strlen($payload) > 60000) $payload = substr($payload, 0, 60000);
        $src = mb_substr((string)($b['source_url'] ?? ($_SERVER['HTTP_REFERER'] ?? '')), 0, 255);
        Database::insert('INSERT INTO leads (tenant_id, name, phone, email, comment, payload, source_url, ip) VALUES (?,?,?,?,?,?,?,?)',
            [(int)$t['id'], $name ?: null, $phone, $email ?: null, mb_substr(trim((string)($b['comment'] ?? '')), 0, 2000) ?: null, $payload, $src ?: null, $ip]);
        $this->json(['ok' => true, 'message' => 'Дякуємо! Ми зателефонуємо вам найближчим часом.'], 201);
    }

    // ---------------- Кабінет ----------------

    private function me(bool $admin = false): array
    {
        self::ensureSchema();
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        if ($admin && ($u['role'] ?? '') !== 'admin') $this->error('Лише адміністратор кабінету', 403);
        return $u;
    }

    // GET /tenant/widget
    public function settings(): void
    {
        $u = $this->me(true);
        $t = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [(int)$u['tid']]);
        if (empty($t['widget_key'])) {
            $t['widget_key'] = bin2hex(random_bytes(12));
            Database::query('UPDATE tenants SET widget_key = ? WHERE id = ?', [$t['widget_key'], (int)$t['id']]);
        }
        [$w, $p] = Catalog::visibleSql((int)$t['id']);
        $all = Database::fetchAll("SELECT id, name, manufacturer, type, tenant_id FROM material_profiles WHERE is_active = 1 AND type IN ('tile','profile','falts') AND $w ORDER BY type, manufacturer, name", $p);
        $sel = json_decode((string)($t['widget_materials'] ?? ''), true);
        $this->json([
            'key' => $t['widget_key'], 'enabled' => (int)$t['widget_enabled'] === 1,
            'materials' => is_array($sel) ? array_map('intval', $sel) : [],
            'eave_overhang' => $t['widget_k'] !== null ? (int)$t['widget_k'] : 50,
            'available' => $all,
        ]);
    }

    // PUT /tenant/widget {enabled, materials: [id], eave_overhang, regenerate}
    public function saveSettings(): void
    {
        $u = $this->me(true);
        $b = $this->body();
        $f = []; $p = [];
        if (array_key_exists('enabled', $b)) { $f[] = 'widget_enabled = ?'; $p[] = !empty($b['enabled']) ? 1 : 0; }
        if (array_key_exists('materials', $b)) {
            $ids = array_values(array_unique(array_filter(array_map('intval', (array)$b['materials']))));
            $ids = array_values(array_filter($ids, function ($id) use ($u) { return Catalog::isVisible($id, (int)$u['tid']); }));
            $f[] = 'widget_materials = ?'; $p[] = $ids ? json_encode($ids) : null;
        }
        if (array_key_exists('eave_overhang', $b)) { $f[] = 'widget_k = ?'; $p[] = max(0, min(500, (int)$b['eave_overhang'])); }
        if (!empty($b['regenerate'])) { $f[] = 'widget_key = ?'; $p[] = bin2hex(random_bytes(12)); }
        if ($f) { $p[] = (int)$u['tid']; Database::query('UPDATE tenants SET ' . implode(', ', $f) . ' WHERE id = ?', $p); }
        $this->settings();
    }

    // GET /leads?status=
    public function leads(): void
    {
        $u = $this->me();
        $where = 'tenant_id = ?'; $p = [(int)$u['tid']];
        if (!empty($_GET['status']) && in_array($_GET['status'], ['new', 'work', 'done', 'spam'], true)) { $where .= ' AND status = ?'; $p[] = $_GET['status']; }
        $rows = Database::fetchAll("SELECT id, name, phone, email, comment, payload, source_url, status, created_at FROM leads WHERE $where ORDER BY created_at DESC LIMIT 300", $p);
        foreach ($rows as &$r) $r['payload'] = json_decode((string)$r['payload'], true);
        $new = (int)Database::fetchOne("SELECT COUNT(*) c FROM leads WHERE tenant_id = ? AND status = 'new'", [(int)$u['tid']])['c'];
        $this->json(['leads' => $rows, 'new_count' => $new]);
    }

    // PUT /leads/{id} {status}
    public function updateLead(int $id): void
    {
        $u = $this->me();
        $b = $this->body();
        $st = (string)($b['status'] ?? '');
        if (!in_array($st, ['new', 'work', 'done', 'spam'], true)) $this->error('Невідомий статус');
        Database::query('UPDATE leads SET status = ? WHERE id = ? AND tenant_id = ?', [$st, $id, (int)$u['tid']]);
        $this->json(['ok' => true]);
    }

    private function body(): array
    {
        $b = json_decode((string)file_get_contents('php://input'), true);
        return is_array($b) ? $b : [];
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
