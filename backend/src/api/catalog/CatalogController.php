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
        \RoofCalc\Core\Database::ensureMaterialSchema();
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
        [$w, $p] = $this->platform() ? Catalog::librarySql('m.') : Catalog::visibleSql((int)$this->me['tid'], 'm.');
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
        $mf = array_key_exists('manufacturer', $b) ? (string)(Catalog::canonicalManufacturer($b['manufacturer'], $this->platform() ? null : (int)$this->me['tid']) ?? '') : null;
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

    // GET /catalog/manufacturers — список виробників для випадаючого списку
    public function manufacturers(): void
    {
        $this->json(['manufacturers' => Catalog::manufacturers($this->platform() ? null : (int)$this->me['tid'])]);
    }

    // ---------- Каталог ROOFKIT → особистий каталог ----------
    // GET /catalog/library?section=ID — позиції каталогу ROOFKIT (з позначкою «уже у вас»)
    public function library(): void
    {
        [$w, $p] = Catalog::librarySql('m.');
        if (!empty($_GET['section'])) { $w .= ' AND m.section_id = ?'; $p[] = (int)$_GET['section']; }
        $rows = Database::fetchAll(
            "SELECT m.id, m.name, m.manufacturer, m.type, m.section_id, m.full_width, m.useful_width, m.max_length, m.tenant_id, t.name AS owner_name,
                    (SELECT COUNT(*) FROM material_profiles x WHERE x.tenant_id = ? AND x.source_id = m.id AND x.deleted = 0) AS in_my
             FROM material_profiles m LEFT JOIN tenants t ON t.id = m.tenant_id
             WHERE m.is_active = 1 AND $w ORDER BY m.sort_order, m.manufacturer, m.name LIMIT 2000",
            array_merge([(int)$this->me['tid']], $p)
        );
        $this->json(['items' => $rows]);
    }

    // POST /catalog/copy {ids:[...]} — скопіювати позиції каталогу ROOFKIT у свій каталог
    public function copy(): void
    {
        if ($this->platform()) $this->error('Каталог ROOFKIT — це і є основний каталог; копіювання — для кабінетів клієнтів');
        $this->requireAdmin();
        $ids = array_slice(array_map('intval', (array)($this->body()['ids'] ?? [])), 0, 500);
        [$w, $p] = Catalog::librarySql();
        $copied = 0; $skipped = 0;
        foreach ($ids as $id) {
            if (!Database::fetchOne("SELECT id FROM material_profiles WHERE id = ? AND $w", array_merge([$id], $p))) { $skipped++; continue; }
            if (Database::fetchOne('SELECT id FROM material_profiles WHERE tenant_id = ? AND source_id = ? AND deleted = 0', [$this->me['tid'], $id])) { $skipped++; continue; }
            Catalog::copyMaterial($id, (int)$this->me['tid']);
            $copied++;
        }
        $this->json(['copied' => $copied, 'skipped' => $skipped]);
    }

    // ---------- Імпорт / експорт ----------
    public const IO_FIELDS = [
        'full_width', 'useful_width', 'min_length', 'max_length', 'max_std_length', 'module_origin', 'stamp_gap', 'wave_step', 'round_step', 'cut_step',
        'length_overlap', 'min_slope_angle', 'lock_type', 'min_joint_distance', 'join_overlap', 'price_per_m2', 'is_active',
    ];

    // GET /catalog/export — усі позиції каталогу (кабінет — свій, панель платформи — каталог ROOFKIT)
    public function export(): void
    {
        [$w, $p] = $this->platform() ? ['m.deleted = 0 AND m.tenant_id IS NULL', []] : Catalog::visibleSql((int)$this->me['tid'], 'm.');
        $rows = Database::fetchAll(
            'SELECT m.id, s.name AS section, m.manufacturer, m.name, m.forbidden_lengths, m.' . implode(', m.', self::IO_FIELDS) . "
             FROM material_profiles m LEFT JOIN catalog_sections s ON s.id = m.section_id
             WHERE $w ORDER BY s.sort_order, m.sort_order, m.manufacturer, m.name", $p
        );
        foreach ($rows as &$r) {
            $f = json_decode($r['forbidden_lengths'] ?? 'null', true);
            $r['forbidden_lengths'] = is_array($f) ? implode('; ', array_map(function ($x) { return is_array($x) ? ((int)$x[0] . '-' . (int)$x[1]) : ''; }, $f)) : '';
        }
        $this->json(['rows' => $rows]);
    }

    // POST /catalog/import {rows:[{id?, section, manufacturer, name, ...}]} — створити або оновити позиції
    public function import(): void
    {
        $this->requireAdmin();
        $rows = (array)($this->body()['rows'] ?? []);
        if (count($rows) > 3000) $this->error('Забагато рядків (максимум 3000 за один раз)');
        $tid = $this->platform() ? null : (int)$this->me['tid'];
        $sections = Database::fetchAll('SELECT * FROM catalog_sections');
        $secByName = [];
        foreach ($sections as $sc) $secByName[mb_strtolower(trim($sc['name']))] = $sc;
        $created = 0; $updated = 0; $errors = [];
        foreach ($rows as $i => $r) {
            $line = $i + 2;
            if (!is_array($r)) continue;
            $name = trim((string)($r['name'] ?? ''));
            if ($name === '') { if (array_filter($r, function ($v) { return trim((string)$v) !== ''; })) $errors[] = "Рядок {$line}: немає назви"; continue; }
            $sec = $secByName[mb_strtolower(trim((string)($r['section'] ?? '')))] ?? null;
            $existing = null;
            if (!empty($r['id'])) {
                $existing = Database::fetchOne('SELECT * FROM material_profiles WHERE id = ? AND deleted = 0', [(int)$r['id']]);
                if ($existing && !$this->canEdit($existing)) $existing = null;   // чужа позиція — створюємо свою
            }
            $mf = (string)(Catalog::canonicalManufacturer($r['manufacturer'] ?? '', $tid) ?? '');
            if (!$existing) {
                $existing = Database::fetchOne(
                    'SELECT * FROM material_profiles WHERE deleted = 0 AND tenant_id <=> ? AND name = ? AND COALESCE(manufacturer, \'\') = ?' . ($sec ? ' AND section_id = ?' : ''),
                    array_merge([$tid, $name, $mf], $sec ? [$sec['id']] : [])
                );
            }
            if (!$existing && !$sec) { $errors[] = "Рядок {$line} «{$name}»: невідомий розділ «" . ($r['section'] ?? '') . '»'; continue; }
            $vals = ['name' => mb_substr($name, 0, 150), 'manufacturer' => $mf === '' ? null : mb_substr($mf, 0, 100)];
            foreach (self::IO_FIELDS as $f) {
                if (!array_key_exists($f, $r) || trim((string)$r[$f]) === '') continue;
                $v = str_replace([',', ' '], ['.', ''], trim((string)$r[$f]));
                if ($f === 'lock_type') { $vals[$f] = mb_substr(trim((string)$r[$f]), 0, 30); continue; }
                if (!is_numeric($v)) { $errors[] = "Рядок {$line} «{$name}»: «{$f}» має бути числом"; continue 2; }
                $vals[$f] = in_array($f, ['min_slope_angle', 'price_per_m2'], true) ? (float)$v : (int)round((float)$v);
            }
            if (array_key_exists('forbidden_lengths', $r) && trim((string)$r['forbidden_lengths']) !== '') {
                $ranges = [];
                foreach (preg_split('/[;\n]+/', (string)$r['forbidden_lengths']) as $part) {
                    if (preg_match('/(\d+)\s*[-–]\s*(\d+)/', $part, $m) && (int)$m[2] > (int)$m[1]) $ranges[] = [(int)$m[1], (int)$m[2]];
                }
                $vals['forbidden_lengths'] = json_encode($ranges);
            }
            if (isset($vals['full_width'], $vals['useful_width'])) $vals['side_overlap'] = max(0, $vals['full_width'] - $vals['useful_width']);
            if ($existing) {
                if ($sec && (int)$existing['section_id'] !== (int)$sec['id'] && $sec['calc_type'] === $existing['type']) $vals['section_id'] = $sec['id'];
                $set = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($vals)));
                Database::query("UPDATE material_profiles SET $set WHERE id = ?", array_merge(array_values($vals), [$existing['id']]));
                $updated++;
            } else {
                $vals += ['full_width' => 1180, 'useful_width' => 1100, 'min_length' => 400, 'max_length' => 8000, 'is_active' => 1];
                $vals['side_overlap'] = max(0, $vals['full_width'] - $vals['useful_width']);
                $vals['type'] = $sec['calc_type']; $vals['section_id'] = $sec['id']; $vals['tenant_id'] = $tid;
                $vals['sort_order'] = (int)(Database::fetchOne('SELECT MAX(sort_order) m FROM material_profiles WHERE section_id = ?', [$sec['id']])['m'] ?? 0) + 10;
                $newId = Database::insert('INSERT INTO material_profiles (' . implode(',', array_keys($vals)) . ') VALUES (' . implode(',', array_fill(0, count($vals), '?')) . ')', array_values($vals));
                if ($tid === null) Catalog::propagateNew((int)$newId);   // імпорт у каталог ROOFKIT — копії всім кабінетам
                $created++;
            }
        }
        $this->json(['created' => $created, 'updated' => $updated, 'errors' => array_slice($errors, 0, 50), 'errors_count' => count($errors)]);
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
