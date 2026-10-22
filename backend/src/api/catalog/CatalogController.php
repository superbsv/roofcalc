<?php
// ============================================
// ROOFKIT — api/catalog/CatalogController.php
// Структура «Каталогу продукції»: розділи (додати / перейменувати / видалити / перетягнути),
// порядок і переміщення матеріалів, перейменування виробника. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Catalog;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Catalog;
use RoofCalc\Core\Database;

class CatalogController
{
    private array $me;

    public function __construct()
    {
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        $this->me = $u;
        Catalog::ensureSchema();
    }

    private function platform(): bool { return !empty($this->me['sa']) && empty($this->me['imp']); }
    private function requirePlatform(): void { if (!$this->platform()) $this->error('Структуру каталогу змінює лише адміністратор платформи', 403); }
    private function requireAdmin(): void { if (($this->me['role'] ?? '') !== 'admin') $this->error('Недостатньо прав', 403); }

    private function canEdit(array $m): bool
    {
        if ($m['tenant_id'] === null) return $this->platform();
        return (int)$m['tenant_id'] === (int)$this->me['tid'];
    }

    // GET /catalog/sections — розділи з кількістю видимих матеріалів
    public function sections(): void
    {
        [$w, $p] = Catalog::visibleSql((int)$this->me['tid'], 'm.');
        $rows = Database::fetchAll(
            "SELECT s.id, s.name, s.calc_type, s.sort_order,
                    (SELECT COUNT(*) FROM material_profiles m WHERE m.section_id = s.id AND $w) AS cnt
             FROM catalog_sections s ORDER BY s.sort_order, s.id", $p
        );
        $this->json(['sections' => $rows, 'can_edit' => $this->platform()]);
    }

    // POST /catalog/sections {name, calc_type}
    public function create(): void
    {
        $this->requirePlatform();
        $b = $this->body();
        $name = trim((string)($b['name'] ?? ''));
        $type = (string)($b['calc_type'] ?? '');
        if ($name === '') $this->error('Вкажіть назву розділу');
        if (!in_array($type, Catalog::CALC_TYPES, true)) $this->error('Оберіть тип розрахунку');
        $max = (int)(Database::fetchOne('SELECT MAX(sort_order) m FROM catalog_sections')['m'] ?? 0);
        $id = Database::insert('INSERT INTO catalog_sections (name, calc_type, sort_order) VALUES (?,?,?)', [mb_substr($name, 0, 120), $type, $max + 10]);
        $this->sections();
    }

    // PUT /catalog/sections/{id} {name}
    public function update(int $id): void
    {
        $this->requirePlatform();
        $b = $this->body();
        $name = trim((string)($b['name'] ?? ''));
        if ($name === '') $this->error('Вкажіть назву розділу');
        Database::query('UPDATE catalog_sections SET name = ? WHERE id = ?', [mb_substr($name, 0, 120), $id]);
        $this->sections();
    }

    // DELETE /catalog/sections/{id} — лише порожній розділ
    public function delete(int $id): void
    {
        $this->requirePlatform();
        $s = Database::fetchOne('SELECT * FROM catalog_sections WHERE id = ?', [$id]);
        if (!$s) $this->error('Розділ не знайдено', 404);
        $cnt = (int)Database::fetchOne('SELECT COUNT(*) c FROM material_profiles WHERE section_id = ? AND deleted = 0', [$id])['c'];
        if ($cnt > 0) $this->error("У розділі є матеріали ($cnt). Спочатку перетягніть їх в інший розділ або видаліть.");
        $same = (int)Database::fetchOne('SELECT COUNT(*) c FROM catalog_sections WHERE calc_type = ? AND id <> ?', [$s['calc_type'], $id])['c'];
        if ($same === 0) $this->error('Це останній розділ з таким типом розрахунку — його не можна видалити');
        // приховані (видалені) матеріали з розрахунків — в інший розділ того ж типу
        $to = Database::fetchOne('SELECT id FROM catalog_sections WHERE calc_type = ? AND id <> ? ORDER BY sort_order, id LIMIT 1', [$s['calc_type'], $id]);
        Database::query('UPDATE material_profiles SET section_id = ? WHERE section_id = ?', [$to['id'], $id]);
        Database::query('DELETE FROM catalog_sections WHERE id = ?', [$id]);
        $this->sections();
    }

    // PUT /catalog/sections-order {ids:[...]}
    public function order(): void
    {
        $this->requirePlatform();
        $ids = array_map('intval', (array)($this->body()['ids'] ?? []));
        foreach ($ids as $i => $id) Database::query('UPDATE catalog_sections SET sort_order = ? WHERE id = ?', [($i + 1) * 10, $id]);
        $this->sections();
    }

    // PUT /catalog/materials-order {ids:[...]} — порядок матеріалів (лише ті, які користувач може змінювати)
    public function materialsOrder(): void
    {
        $this->requireAdmin();
        $ids = array_map('intval', (array)($this->body()['ids'] ?? []));
        $n = 0;
        foreach ($ids as $i => $id) {
            $m = Database::fetchOne('SELECT id, tenant_id FROM material_profiles WHERE id = ?', [$id]);
            if (!$m || !$this->canEdit($m)) continue;
            Database::query('UPDATE material_profiles SET sort_order = ? WHERE id = ?', [($i + 1) * 10, $id]);
            $n++;
        }
        $this->json(['updated' => $n]);
    }

    // POST /catalog/move {ids:[...], section_id?, manufacturer?} — перетягнути в інший розділ / до іншого виробника
    public function move(): void
    {
        $this->requireAdmin();
        $b = $this->body();
        $ids = array_map('intval', (array)($b['ids'] ?? []));
        $sec = null;
        if (isset($b['section_id'])) {
            $sec = Database::fetchOne('SELECT * FROM catalog_sections WHERE id = ?', [(int)$b['section_id']]);
            if (!$sec) $this->error('Розділ не знайдено', 404);
        }
        $mf = array_key_exists('manufacturer', $b) ? trim((string)$b['manufacturer']) : null;
        $moved = 0; $skipped = 0; $wrongType = 0;
        foreach ($ids as $id) {
            $m = Database::fetchOne('SELECT id, tenant_id, type FROM material_profiles WHERE id = ? AND deleted = 0', [$id]);
            if (!$m || !$this->canEdit($m)) { $skipped++; continue; }
            if ($sec && $sec['calc_type'] !== $m['type']) { $wrongType++; continue; }
            $set = []; $vals = [];
            if ($sec) { $set[] = 'section_id = ?'; $vals[] = $sec['id']; }
            if ($mf !== null) { $set[] = 'manufacturer = ?'; $vals[] = $mf === '' ? null : mb_substr($mf, 0, 100); }
            if (!$set) continue;
            $vals[] = $id;
            Database::query('UPDATE material_profiles SET ' . implode(', ', $set) . ' WHERE id = ?', $vals);
            $moved++;
        }
        if ($wrongType && !$moved) $this->error('Цей розділ має інший тип розрахунку — перетягувати можна лише в розділи того ж типу');
        $this->json(['moved' => $moved, 'skipped' => $skipped, 'wrong_type' => $wrongType]);
    }

    private function body(): array { return json_decode(file_get_contents('php://input'), true) ?? []; }

    private function json(array $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }

    private function error(string $msg, int $code = 400): void { $this->json(['error' => $msg], $code); }
}
