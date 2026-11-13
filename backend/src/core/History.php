<?php
// ============================================
// ROOFKIT — core/History.php
// «Історія дій» усього калькулятора з кнопкою «Скасувати»: проекти, скати, клієнти, каталог,
// налаштування кабінету і віджета, статуси заявок.
//
// Як працює: роутер (api/index.php) перед виконанням запиту, що змінює дані, викликає capture():
// запамʼятовуються рядки, які запит може змінити (стан «до»), і найбільші id таблиць кабінету.
// Після відповіді (shutdown) finish() перевіряє, що реально змінилось, знаходить нові рядки (створені
// запитом) і пише запис історії. Часті правки того самого ската / проекту за 5 хв зливаються в один запис.
// Скасування повертає рядки «до» (видалені вставляються знову з тим самим id), а створені — прибирає.
// Знімок: [{t: таблиця, r: рядок, p?: 1 — лише ці колонки}, {t: 'spec', slope: id, rows: [...]}]. PHP 7.4.
// ============================================

namespace RoofCalc\Core;

class History
{
    private const KEEP = 150;           // записів на кабінет
    private const MERGE_SEC = 300;      // правки того самого обʼєкта за 5 хв — один запис
    private static bool $ready = false;
    private static ?array $ctx = null;

    // Колонки кабінету, які змінює користувач (номер замовлення, ключ віджета, тариф — не відкочуємо)
    private const TENANT_COLS = ['name', 'doc_company', 'doc_address', 'doc_phone', 'doc_email', 'doc_site', 'doc_requisites',
        'brand_color', 'logo', 'widget_enabled', 'widget_materials', 'widget_k'];
    private const CLIENT_PROJECT_COLS = ['client_id', 'client_name', 'client_phone'];
    private const ORDER = ['tenants' => 0, 'clients' => 1, 'material_profiles' => 2, 'projects' => 3, 'slopes' => 4, 'spec' => 5, 'leads' => 6, 'flashings' => 7];

    public static function ensure(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        $db = Database::connection();
        $db->exec("CREATE TABLE IF NOT EXISTS app_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NULL,
            user_id INT NULL,
            kind VARCHAR(20) NOT NULL DEFAULT '',
            merge_key VARCHAR(60) NULL,
            label VARCHAR(255) NOT NULL,
            snapshot LONGTEXT NULL,
            created_ids LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            undone_at DATETIME NULL,
            INDEX idx_ah_tenant (tenant_id, id)
        ) DEFAULT CHARSET=utf8mb4");
        // Записи з першої версії (лише каталог) — переносимо
        try {
            if (!Database::fetchOne("SELECT key_name FROM app_settings WHERE key_name = 'history_v2'")) {
                if (Database::fetchOne("SHOW TABLES LIKE 'catalog_history'")) {
                    foreach (Database::fetchAll('SELECT * FROM catalog_history ORDER BY id') as $h) {
                        $snap = array_map(function ($r) { return ['t' => 'material_profiles', 'r' => $r]; }, json_decode($h['snapshot'] ?? '[]', true) ?: []);
                        $cr = array_map(function ($id) { return ['material_profiles', (int)$id]; }, json_decode($h['created_ids'] ?? '[]', true) ?: []);
                        Database::query('INSERT INTO app_history (tenant_id, user_id, kind, label, snapshot, created_ids, created_at, updated_at, undone_at) VALUES (?,?,?,?,?,?,?,?,?)',
                            [$h['tenant_id'], $h['user_id'], 'catalog', $h['label'], self::pack($snap), json_encode($cr), $h['created_at'], $h['created_at'], $h['undone_at']]);
                    }
                }
                Database::query("INSERT INTO app_settings (key_name, value, type, description, updated_at) VALUES ('history_v2', '1', 'string', 'Історія дій усього калькулятора', NOW())");
            }
        } catch (\Throwable $e) {
            error_log('ROOFKIT history migrate: ' . $e->getMessage());
        }
    }

    // ---------- Знімки ----------
    private static function pack(array $snap): string
    {
        $j = json_encode($snap, JSON_UNESCAPED_UNICODE);
        return strlen($j) > 20000 ? 'z:' . base64_encode(gzdeflate($j, 6)) : $j;
    }
    private static function unpack(?string $s): array
    {
        if ($s === null || $s === '') return [];
        if (strncmp($s, 'z:', 2) === 0) $s = (string)gzinflate(base64_decode(substr($s, 2)));
        return json_decode($s, true) ?: [];
    }

    /** Рядки таблиці за id → елементи знімка */
    public static function rows(string $t, array $ids, ?array $cols = null): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if (!$ids) return [];
        $sel = $cols ? 'id, `' . implode('`, `', $cols) . '`' : '*';
        $out = [];
        foreach (Database::fetchAll("SELECT $sel FROM `$t` WHERE id IN (" . implode(',', array_fill(0, count($ids), '?')) . ')', $ids) as $r) {
            $out[] = $cols ? ['t' => $t, 'r' => $r, 'p' => 1] : ['t' => $t, 'r' => $r];
        }
        return $out;
    }

    /** Скат з його рядками специфікації */
    private static function slopeItems(array $ids): array
    {
        $out = self::rows('slopes', $ids);
        foreach ($ids as $sid) {
            $out[] = ['t' => 'spec', 'slope' => (int)$sid, 'rows' => Database::fetchAll('SELECT * FROM specification_items WHERE slope_id = ?', [(int)$sid])];
        }
        return $out;
    }

    /** Проект повністю: рядок, скати, специфікація (зокрема рядки без ската) */
    private static function projectItems(array $pids): array
    {
        $out = self::rows('projects', $pids);
        foreach ($pids as $pid) {
            $sids = array_column(Database::fetchAll('SELECT id FROM slopes WHERE project_id = ?', [(int)$pid]), 'id');
            $out = array_merge($out, self::slopeItems($sids));
        }
        return $out;
    }

    private static function itemKey(array $it): string
    {
        return $it['t'] === 'spec' ? 'spec:' . $it['slope'] : $it['t'] . ':' . ($it['r']['id'] ?? 0);
    }

    /** Поточний стан того самого елемента (для перевірки «чи щось змінилось») */
    private static function current(array $it): ?array
    {
        if ($it['t'] === 'spec') return ['t' => 'spec', 'slope' => $it['slope'], 'rows' => Database::fetchAll('SELECT * FROM specification_items WHERE slope_id = ?', [$it['slope']])];
        $cols = !empty($it['p']) ? array_keys($it['r']) : null;
        $r = self::rows($it['t'], [(int)$it['r']['id']], $cols ? array_values(array_diff($cols, ['id'])) : null);
        return $r[0] ?? null;
    }

    private static function strip($v)
    {
        if (!is_array($v)) return $v;
        $o = [];
        foreach ($v as $k => $x) {
            if (is_string($k) && preg_match('/_at$/', $k)) continue;   // службові дати не рахуються як зміна
            $o[$k] = self::strip($x);
        }
        return $o;
    }
    private static function same(array $a, ?array $b): bool
    {
        if ($b === null) return false;
        if ($a['t'] === 'spec') {
            $f = function ($rows) { return array_map(function ($r) { unset($r['id']); return self::strip($r); }, $rows); };
            return $f($a['rows']) == $f($b['rows']);
        }
        return self::strip($a['r']) == self::strip($b['r']);
    }

    // ---------- Перехоплення запитів у роутері ----------
    private static function maxIds(int $tid): array
    {
        return [
            'projects' => (int)(Database::fetchOne('SELECT MAX(id) m FROM projects WHERE tenant_id = ?', [$tid])['m'] ?? 0),
            'slopes'   => (int)(Database::fetchOne('SELECT MAX(s.id) m FROM slopes s JOIN projects p ON p.id = s.project_id WHERE p.tenant_id = ?', [$tid])['m'] ?? 0),
            'clients'  => (int)(Database::fetchOne('SELECT MAX(id) m FROM clients WHERE tenant_id = ?', [$tid])['m'] ?? 0),
            'material_profiles' => (int)(Database::fetchOne('SELECT MAX(id) m FROM material_profiles WHERE tenant_id = ?', [$tid])['m'] ?? 0),
            'flashings' => self::maxFlashing($tid),
        ];
    }
    private static function maxFlashing(int $tid): int
    {
        try { return (int)(Database::fetchOne('SELECT MAX(id) m FROM flashings WHERE tenant_id = ?', [$tid])['m'] ?? 0); }
        catch (\Throwable $e) { return 0; }   // таблиця ще не створена
    }

    private static function newIds(int $tid, array $max): array
    {
        $out = [];
        foreach (Database::fetchAll('SELECT id FROM projects WHERE tenant_id = ? AND id > ?', [$tid, $max['projects']]) as $r) $out[] = ['projects', (int)$r['id']];
        foreach (Database::fetchAll('SELECT s.id FROM slopes s JOIN projects p ON p.id = s.project_id WHERE p.tenant_id = ? AND s.id > ?', [$tid, $max['slopes']]) as $r) $out[] = ['slopes', (int)$r['id']];
        foreach (Database::fetchAll('SELECT id FROM clients WHERE tenant_id = ? AND id > ?', [$tid, $max['clients']]) as $r) $out[] = ['clients', (int)$r['id']];
        foreach (Database::fetchAll('SELECT id FROM material_profiles WHERE tenant_id = ? AND id > ?', [$tid, $max['material_profiles']]) as $r) $out[] = ['material_profiles', (int)$r['id']];
        try {
            foreach (Database::fetchAll('SELECT id FROM flashings WHERE tenant_id = ? AND id > ?', [$tid, $max['flashings'] ?? 0]) as $r) $out[] = ['flashings', (int)$r['id']];
        } catch (\Throwable $e) {}
        return $out;
    }

    private static function nameOf(string $t, int $id): string
    {
        $r = Database::fetchOne("SELECT name FROM `$t` WHERE id = ?", [$id]);
        return (string)($r['name'] ?? '');
    }

    /** Викликається роутером перед виконанням запиту. Каталог пише історію сам (CatalogHistory) */
    public static function capture(string $method, string $uri, ?array $user): void
    {
        try {
            if (!$user || empty($user['tid']) || $method === 'GET') return;
            $tid = (int)$user['tid'];
            $before = []; $kind = ''; $label = null; $merge = null; $proj = null; $slope = null;
            if ($method === 'POST' && $uri === '/projects') { $kind = 'project'; $label = 'new_project'; }
            elseif ($method === 'POST' && $uri === '/projects/import') { $kind = 'project'; $label = 'import'; }
            elseif ($method === 'POST' && preg_match('#^/projects/(\d+)/copy$#', $uri)) { $kind = 'project'; $label = 'copy_project'; }
            elseif (preg_match('#^/projects/(\d+)$#', $uri, $m) && $method === 'PUT') {
                $proj = (int)$m[1]; $kind = 'project'; $label = 'edit_project'; $merge = "p$proj";
                $before = self::rows('projects', [$proj]);
            } elseif (preg_match('#^/projects/(\d+)$#', $uri, $m) && $method === 'DELETE') {
                $proj = (int)$m[1]; $kind = 'project'; $label = 'del_project';
                $before = self::projectItems([$proj]);
            } elseif (preg_match('#^/projects/(\d+)/calculate-all$#', $uri, $m)) {
                $proj = (int)$m[1]; $kind = 'project'; $label = 'edit_project'; $merge = "p$proj";
                $sids = array_column(Database::fetchAll('SELECT id FROM slopes WHERE project_id = ?', [$proj]), 'id');
                $before = array_merge(self::rows('projects', [$proj]), self::slopeItems($sids));
            } elseif (preg_match('#^/projects/(\d+)/slopes$#', $uri, $m) && $method === 'POST') {
                $proj = (int)$m[1]; $kind = 'project'; $label = 'new_slope';
            } elseif (preg_match('#^/slopes/(\d+)(/calculate|/optimize)?$#', $uri, $m)) {
                $slope = (int)$m[1]; $kind = 'project';
                $s = Database::fetchOne('SELECT project_id FROM slopes WHERE id = ?', [$slope]);
                $proj = $s ? (int)$s['project_id'] : null;
                $label = $method === 'DELETE' ? 'del_slope' : 'edit_slope';
                $merge = $method === 'DELETE' ? null : "s$slope";
                $before = array_merge($proj ? self::rows('projects', [$proj]) : [], self::slopeItems([$slope]));
            } elseif (preg_match('#^/clients(?:/(\d+))?$#', $uri, $m)) {
                $kind = 'client'; $cid = (int)($m[1] ?? 0);
                $label = $method === 'POST' ? 'new_client' : ($method === 'DELETE' ? 'del_client' : 'edit_client');
                if ($cid) {
                    $pids = array_column(Database::fetchAll('SELECT id FROM projects WHERE client_id = ? AND tenant_id = ?', [$cid, $tid]), 'id');
                    $before = self::rows('clients', [$cid]);
                    $before = array_merge($before, $method === 'DELETE' && !empty($_GET['projects'])
                        ? self::projectItems($pids)
                        : self::rows('projects', $pids, self::CLIENT_PROJECT_COLS));
                    $merge = $method === 'PUT' ? "c$cid" : null;
                    $slope = $cid;   // id клієнта — для назви
                }
            } elseif (preg_match('#^/flashings(?:/(\d+))?(?:/link)?$#', $uri, $m)) {
                $kind = 'flashing'; $fid = (int)($m[1] ?? 0); $slope = $fid;
                $label = $method === 'POST' ? 'new_flashing' : ($method === 'DELETE' ? 'del_flashing' : 'edit_flashing');
                if ($fid) $before = self::rows('flashings', [$fid]);
                $merge = $method === 'PUT' ? "f$fid" : null;
            } elseif ($method === 'PUT' && ($uri === '/tenant' || $uri === '/tenant/widget')) {
                $kind = 'settings'; $label = $uri === '/tenant' ? 'tenant' : 'widget'; $merge = $label;
                $before = self::rows('tenants', [$tid], self::TENANT_COLS);
            } elseif ($method === 'PUT' && preg_match('#^/leads/(\d+)$#', $uri, $m)) {
                $kind = 'lead'; $label = 'lead'; $slope = (int)$m[1];
                $before = self::rows('leads', [(int)$m[1]], ['status']);
            } elseif ($method === 'PUT' && $uri === '/catalog/materials-order') {
                $kind = 'catalog'; $label = 'mat_order'; $merge = 'mat_order';
                $b = json_decode((string)file_get_contents('php://input'), true);
                $before = self::rows('material_profiles', (array)($b['ids'] ?? []), ['sort_order']);
            } else {
                return;
            }
            self::$ctx = compact('tid', 'before', 'kind', 'label', 'merge', 'proj', 'slope') + ['user' => (int)($user['sub'] ?? 0), 'max' => self::maxIds($tid)];
            register_shutdown_function([self::class, 'finish']);
        } catch (\Throwable $e) {
            error_log('ROOFKIT history capture: ' . $e->getMessage());
            self::$ctx = null;
        }
    }

    public static function finish(): void
    {
        $c = self::$ctx; self::$ctx = null;
        if (!$c) return;
        try {
            $code = http_response_code();
            if ($code !== false && $code >= 400) return;
            $created = self::newIds($c['tid'], $c['max']);
            $before = array_values(array_filter($c['before'], function ($it) { return !self::same($it, self::current($it)); }));
            if (!$before && !$created) return;
            $pn = $c['proj'] ? self::nameOf('projects', $c['proj']) : '';
            if ($pn === '' && $c['proj']) foreach ($c['before'] as $it) if ($it['t'] === 'projects') $pn = (string)($it['r']['name'] ?? '');
            $sn = '';
            foreach (array_merge($c['before'], []) as $it) if ($it['t'] === 'slopes') $sn = (string)($it['r']['name'] ?? '');
            $firstNew = function (string $t) use ($created) { foreach ($created as [$tt, $id]) if ($tt === $t) return $id; return 0; };
            switch ($c['label']) {
                case 'new_project': $n = self::nameOf('projects', $firstNew('projects')); $l = "Створено проект «{$n}»"; break;
                case 'copy_project': $n = self::nameOf('projects', $firstNew('projects')); $l = "Скопійовано проект «{$n}»"; break;
                case 'import':      $n = self::nameOf('projects', $firstNew('projects')); $l = "Відкрито файл: проект «{$n}»"; break;
                case 'edit_project': $l = "Змінено проект «{$pn}»"; break;
                case 'del_project': $l = "Видалено проект «{$pn}»"; break;
                case 'new_slope':   $n = self::nameOf('slopes', $firstNew('slopes')); $l = "Додано «{$n}» — проект «{$pn}»"; break;
                case 'edit_slope':  $l = "Змінено «{$sn}» — проект «{$pn}»"; break;
                case 'del_slope':   $l = "Видалено «{$sn}» — проект «{$pn}»"; break;
                case 'new_client':  $n = self::nameOf('clients', $firstNew('clients')); $l = "Додано клієнта «{$n}»"; break;
                case 'edit_client': $n = self::nameOf('clients', (int)$c['slope']); $l = "Змінено клієнта «{$n}»"; break;
                case 'del_client':
                    $cn = ''; foreach ($c['before'] as $it) if ($it['t'] === 'clients') $cn = (string)($it['r']['name'] ?? '');
                    $l = "Видалено клієнта «{$cn}»"; break;
                case 'new_flashing': $n = self::nameOf('flashings', $firstNew('flashings')); $l = "Створено креслення «{$n}»"; break;
                case 'edit_flashing': $n = self::nameOf('flashings', (int)$c['slope']); $l = "Змінено креслення «{$n}»"; break;
                case 'del_flashing':
                    $n = ''; foreach ($c['before'] as $it) if ($it['t'] === 'flashings') $n = (string)($it['r']['name'] ?? '');
                    $l = "Видалено креслення «{$n}»"; break;
                case 'tenant':      $l = 'Змінено налаштування кабінету'; break;
                case 'widget':      $l = 'Змінено налаштування віджета'; break;
                case 'lead':        $n = self::nameOf('leads', (int)$c['slope']); $l = "Змінено статус заявки «{$n}»"; break;
                case 'mat_order':   $l = 'Змінено порядок матеріалів у каталозі'; break;
                default:            $l = 'Зміна';
            }
            self::record($c['kind'], $l, $before, $created, $c['merge'], $c['tid'], $c['user']);
        } catch (\Throwable $e) {
            error_log('ROOFKIT history finish: ' . $e->getMessage());
        }
    }

    /** Записати дію (або злити з попередньою правкою того самого обʼєкта) */
    public static function record(string $kind, string $label, array $before, array $created = [], ?string $merge = null, ?int $tid = null, ?int $uid = null): void
    {
        try {
            if (!$before && !$created) return;
            self::ensure();
            if ($tid === null || $uid === null) {
                $u = Auth::currentUser() ?? [];
                $tid = $tid ?? (isset($u['tid']) ? (int)$u['tid'] : null);
                $uid = $uid ?? (isset($u['sub']) ? (int)$u['sub'] : null);
            }
            if ($merge) {
                $last = Database::fetchOne(
                    'SELECT * FROM app_history WHERE tenant_id <=> ? ORDER BY id DESC LIMIT 1', [$tid]);
                if ($last && $last['merge_key'] === $merge && (int)$last['user_id'] === (int)$uid && !$last['undone_at']
                    && strtotime($last['updated_at']) >= time() - self::MERGE_SEC) {
                    $snap = self::unpack($last['snapshot']);
                    $have = array_flip(array_map([self::class, 'itemKey'], $snap));
                    foreach ($before as $it) if (!isset($have[self::itemKey($it)])) $snap[] = $it;   // найраніший стан лишається
                    $cr = array_merge(json_decode($last['created_ids'] ?? '[]', true) ?: [], $created);
                    Database::query('UPDATE app_history SET label = ?, snapshot = ?, created_ids = ?, updated_at = NOW() WHERE id = ?',
                        [mb_substr($label, 0, 255), self::pack($snap), json_encode($cr), $last['id']]);
                    return;
                }
            }
            Database::query(
                'INSERT INTO app_history (tenant_id, user_id, kind, merge_key, label, snapshot, created_ids, created_at, updated_at) VALUES (?,?,?,?,?,?,?,NOW(),NOW())',
                [$tid, $uid, $kind, $merge, mb_substr($label, 0, 255), self::pack($before), json_encode($created)]
            );
            $old = Database::fetchOne('SELECT id FROM app_history WHERE tenant_id <=> ? ORDER BY id DESC LIMIT 1 OFFSET ' . self::KEEP, [$tid]);
            if ($old) Database::query('DELETE FROM app_history WHERE tenant_id <=> ? AND id <= ?', [$tid, $old['id']]);
        } catch (\Throwable $e) {
            error_log('ROOFKIT history: ' . $e->getMessage());   // історія не має ламати саму дію
        }
    }

    // ---------- Перегляд і скасування ----------
    private static function canSee(array $h, array $me): bool
    {
        if ((int)($h['tenant_id'] ?? 0) !== (int)($me['tid'] ?? -1)) return false;
        return ($me['role'] ?? '') === 'admin' || (int)$h['user_id'] === (int)($me['sub'] ?? 0);
    }

    public static function list(array $me, string $kind = ''): array
    {
        self::ensure();
        $w = 'h.tenant_id = ?'; $p = [(int)$me['tid']];
        if (($me['role'] ?? '') !== 'admin') { $w .= ' AND h.user_id = ?'; $p[] = (int)($me['sub'] ?? 0); }
        if ($kind !== '') { $w .= ' AND h.kind = ?'; $p[] = $kind; }
        $rows = Database::fetchAll(
            "SELECT h.id, h.kind, h.label, h.created_at, h.updated_at, h.undone_at, u.name AS user_name
             FROM app_history h LEFT JOIN users u ON u.id = h.user_id WHERE $w ORDER BY h.id DESC LIMIT " . self::KEEP, $p);
        return $rows;
    }

    private static function restoreRow(string $t, array $r, bool $partial, array $cols): void
    {
        $r = array_intersect_key($r, array_flip($cols));
        $id = (int)($r['id'] ?? 0);
        if (!$id) return;
        $exists = (bool)Database::fetchOne("SELECT id FROM `$t` WHERE id = ?", [$id]);
        if ($exists) {
            $set = $r; unset($set['id']);
            if (!$set) return;
            Database::query("UPDATE `$t` SET " . implode(', ', array_map(function ($k) { return "`$k` = ?"; }, array_keys($set))) . ' WHERE id = ?',
                array_merge(array_values($set), [$id]));
        } elseif (!$partial) {
            Database::query("INSERT INTO `$t` (`" . implode('`,`', array_keys($r)) . '`) VALUES (' . implode(',', array_fill(0, count($r), '?')) . ')', array_values($r));
        }
    }

    private static function dropCreated(string $t, int $id, array &$projects): void
    {
        if ($t === 'projects') {
            Database::query('DELETE FROM specification_items WHERE project_id = ?', [$id]);
            Database::query('DELETE FROM slopes WHERE project_id = ?', [$id]);
            Database::query('DELETE FROM projects WHERE id = ?', [$id]);
            unset($projects[$id]);
        } elseif ($t === 'slopes') {
            $s = Database::fetchOne('SELECT project_id FROM slopes WHERE id = ?', [$id]);
            if ($s) $projects[(int)$s['project_id']] = true;
            Database::query('DELETE FROM specification_items WHERE slope_id = ?', [$id]);
            Database::query('DELETE FROM slopes WHERE id = ?', [$id]);
        } elseif ($t === 'clients') {
            Database::query('UPDATE projects SET client_id = NULL WHERE client_id = ?', [$id]);
            Database::query('DELETE FROM clients WHERE id = ?', [$id]);
        } elseif ($t === 'flashings') {
            Database::query('DELETE FROM flashings WHERE id = ?', [$id]);
        } elseif ($t === 'material_profiles') {
            $used = (int)(Database::fetchOne('SELECT COUNT(*) c FROM slopes WHERE material_profile_id = ?', [$id])['c'] ?? 0);
            if ($used) Database::query('UPDATE material_profiles SET deleted = 1, published = 0, is_active = 0 WHERE id = ?', [$id]);
            else Database::query('DELETE FROM material_profiles WHERE id = ?', [$id]);
        }
    }

    /** Підсумки проекту після скасування правок скатів (як у «Перерахувати все») */
    private static function retotal(int $pid): void
    {
        if (!Database::fetchOne('SELECT id FROM projects WHERE id = ?', [$pid])) return;
        $area = 0.0;
        foreach (Database::fetchAll('SELECT calc_result FROM slopes WHERE project_id = ?', [$pid]) as $s) {
            $r = json_decode((string)$s['calc_result'], true);
            $area += (float)($r['slope_area_m2'] ?? 0);
        }
        $t = Database::fetchOne('SELECT SUM(total) s FROM specification_items WHERE project_id = ?', [$pid]);
        Database::query('UPDATE projects SET total_price = ?, total_area = ? WHERE id = ?', [$t['s'] ?? 0, round($area, 3), $pid]);
    }

    public static function undo(int $id, array $me): int
    {
        self::ensure();
        $h = Database::fetchOne('SELECT * FROM app_history WHERE id = ?', [$id]);
        if (!$h || !self::canSee($h, $me)) throw new \RuntimeException('Дію не знайдено');
        if ($h['undone_at']) throw new \RuntimeException('Цю дію вже скасовано');
        $snap = self::unpack($h['snapshot']);
        usort($snap, function ($a, $b) { return (self::ORDER[$a['t']] ?? 9) <=> (self::ORDER[$b['t']] ?? 9); });
        $cols = []; $n = 0; $projects = [];
        $db = Database::connection();
        $db->beginTransaction();
        try {
            foreach ($snap as $it) {
                if ($it['t'] === 'spec') {
                    $sid = (int)$it['slope'];
                    Database::query('DELETE FROM specification_items WHERE slope_id = ?', [$sid]);
                    $c = $cols['specification_items'] ?? ($cols['specification_items'] = array_column(Database::fetchAll('SHOW COLUMNS FROM specification_items'), 'Field'));
                    foreach ($it['rows'] as $r) {
                        $r = array_intersect_key($r, array_flip($c)); unset($r['id']);
                        if (!empty($r['project_id'])) $projects[(int)$r['project_id']] = true;
                        Database::query('INSERT INTO specification_items (`' . implode('`,`', array_keys($r)) . '`) VALUES (' . implode(',', array_fill(0, count($r), '?')) . ')', array_values($r));
                    }
                    continue;
                }
                $t = $it['t'];
                if (!isset(self::ORDER[$t])) continue;
                $c = $cols[$t] ?? ($cols[$t] = array_column(Database::fetchAll("SHOW COLUMNS FROM `$t`"), 'Field'));
                self::restoreRow($t, $it['r'], !empty($it['p']), $c);
                if ($t === 'slopes' && !empty($it['r']['project_id'])) $projects[(int)$it['r']['project_id']] = true;
                $n++;
            }
            $created = json_decode($h['created_ids'] ?? '[]', true) ?: [];
            usort($created, function ($a, $b) { return (self::ORDER[$b[0]] ?? 9) <=> (self::ORDER[$a[0]] ?? 9); });   // спершу дочірні
            foreach ($created as [$t, $cid]) { self::dropCreated((string)$t, (int)$cid, $projects); $n++; }
            foreach (array_keys($projects) as $pid) self::retotal((int)$pid);
            Database::query('UPDATE app_history SET undone_at = NOW() WHERE id = ?', [$id]);
            $db->commit();
        } catch (\Throwable $e) {
            $db->rollBack();
            $em = $e->getMessage();
            throw new \RuntimeException("Не вдалося скасувати: {$em}");
        }
        return $n;
    }
}
