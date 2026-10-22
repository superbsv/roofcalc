<?php
// ============================================
// ROOFKIT — api/clients/ClientsController.php
// Клієнти кабінету: картка (контакти, статус, нотатки) і всі розрахунки клієнта.
// Адміністратор бачить усіх клієнтів кабінету, менеджер — своїх. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Clients;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class ClientsController
{
    public const STATUSES = ['new', 'work', 'regular', 'archive'];
    private static bool $ready = false;
    private array $me;

    public function __construct()
    {
        $u = Auth::currentUser();
        if (!$u) $this->error('Не авторизовано', 401);
        if (!empty($u['sa']) && empty($u['imp'])) $this->error('Клієнти ведуться всередині кабінету — увійдіть під користувачем кабінету', 403);
        $this->me = $u;
        self::ensureSchema();
    }

    public static function ensureSchema(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        try {
            $col = Database::fetchOne(
                "SELECT COLLATION_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'client_name'"
            )['c'] ?? 'utf8mb4_unicode_ci';
            if (!preg_match('/^[a-z0-9_]+$/', $col)) $col = 'utf8mb4_unicode_ci';
            $cs = explode('_', $col)[0];
            Database::connection()->exec("CREATE TABLE IF NOT EXISTS clients (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                user_id INT NULL,
                name VARCHAR(190) NOT NULL,
                phone VARCHAR(50) NULL,
                email VARCHAR(190) NULL,
                address VARCHAR(255) NULL,
                source VARCHAR(50) NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'new',
                notes TEXT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_tenant (tenant_id)
            ) DEFAULT CHARSET=$cs COLLATE=$col");
            Database::ensureColumn('projects', 'client_id', 'INT NULL');
            // Перший запуск: клієнти з уже збережених розрахунків (за назвою + телефоном у межах кабінету)
            $rows = Database::fetchAll(
                "SELECT id, tenant_id, user_id, TRIM(client_name) n, TRIM(COALESCE(client_phone,'')) ph, client_email, object_address
                 FROM projects WHERE client_id IS NULL AND tenant_id IS NOT NULL AND client_name IS NOT NULL AND TRIM(client_name) <> '' ORDER BY id"
            );
            foreach ($rows as $r) {
                $cid = self::findOrCreate((int)$r['tenant_id'], (int)$r['user_id'], $r['n'], $r['ph'], $r['client_email'], $r['object_address']);
                Database::query('UPDATE projects SET client_id = ? WHERE id = ?', [$cid, $r['id']]);
            }
        } catch (\Throwable $e) {
            error_log('ROOFKIT clients schema: ' . $e->getMessage());
        }
    }

    private static function findOrCreate(int $tid, int $uid, string $name, string $phone, $email = null, $address = null): int
    {
        $digits = preg_replace('/\D+/', '', $phone);
        $c = null;
        if ($digits !== '') {
            foreach (Database::fetchAll('SELECT id, phone FROM clients WHERE tenant_id = ? AND phone IS NOT NULL', [$tid]) as $x) {
                $d = preg_replace('/\D+/', '', $x['phone']);
                if ($d !== '' && substr($d, -9) === substr($digits, -9)) { $c = $x; break; }
            }
        }
        if (!$c) $c = Database::fetchOne('SELECT id FROM clients WHERE tenant_id = ? AND LOWER(name) = LOWER(?) AND (phone IS NULL OR phone = \'\') LIMIT 1', [$tid, $name]);
        if ($c) return (int)$c['id'];
        return Database::insert(
            'INSERT INTO clients (tenant_id, user_id, name, phone, email, address, status) VALUES (?,?,?,?,?,?,?)',
            [$tid, $uid ?: null, mb_substr($name, 0, 190), $phone !== '' ? mb_substr($phone, 0, 50) : null, $email ?: null, $address ? mb_substr($address, 0, 255) : null, 'work']
        );
    }

    // Прив'язати розрахунок до клієнта (викликається з ProjectsController після створення / зміни)
    public static function linkProject(int $projectId, array $user, array $body): void
    {
        try {
            self::ensureSchema();
            $tid = (int)$user['tid'];
            if (array_key_exists('client_id', $body) && $body['client_id']) {
                $c = Database::fetchOne('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [(int)$body['client_id'], $tid]);
                if ($c) {
                    Database::query('UPDATE projects SET client_id = ?, client_name = ?, client_phone = COALESCE(NULLIF(?, \'\'), client_phone) WHERE id = ?',
                        [$c['id'], $c['name'], (string)$c['phone'], $projectId]);
                    return;
                }
            }
            if (!array_key_exists('client_name', $body)) return;
            $name = trim((string)$body['client_name']);
            if ($name === '') { Database::query('UPDATE projects SET client_id = NULL WHERE id = ?', [$projectId]); return; }
            $cid = self::findOrCreate($tid, (int)$user['sub'], $name, trim((string)($body['client_phone'] ?? '')), $body['client_email'] ?? null, $body['object_address'] ?? null);
            Database::query('UPDATE projects SET client_id = ? WHERE id = ?', [$cid, $projectId]);
        } catch (\Throwable $e) {
            error_log('ROOFKIT link client: ' . $e->getMessage());
        }
    }

    private function scope(string $a = 'c.'): array
    {
        if (($this->me['role'] ?? '') === 'admin') return ["{$a}tenant_id = ?", [$this->me['tid']]];
        return ["{$a}tenant_id = ? AND ({$a}user_id = ? OR EXISTS (SELECT 1 FROM projects px WHERE px.client_id = {$a}id AND px.user_id = ?))",
            [$this->me['tid'], $this->me['sub'], $this->me['sub']]];
    }

    private function find(int $id): array
    {
        [$w, $p] = $this->scope();
        $c = Database::fetchOne("SELECT c.* FROM clients c WHERE c.id = ? AND $w", array_merge([$id], $p));
        if (!$c) $this->error('Клієнта не знайдено', 404);
        return $c;
    }

    // GET /clients?search=&status=
    public function index(): void
    {
        [$w, $p] = $this->scope();
        if (!empty($_GET['search'])) {
            $s = '%' . trim((string)$_GET['search']) . '%';
            $w .= ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.address LIKE ?)';
            array_push($p, $s, $s, $s, $s);
        }
        if (!empty($_GET['status']) && in_array($_GET['status'], self::STATUSES, true)) { $w .= ' AND c.status = ?'; $p[] = $_GET['status']; }
        $own = ($this->me['role'] ?? '') === 'admin' ? '' : ' AND pr.user_id = ' . (int)$this->me['sub'];
        $rows = Database::fetchAll(
            "SELECT c.*, u.name AS manager_name,
                    (SELECT COUNT(*) FROM projects pr WHERE pr.client_id = c.id$own) AS projects_count,
                    (SELECT COALESCE(SUM(pr.total_area),0) FROM projects pr WHERE pr.client_id = c.id$own) AS total_area,
                    (SELECT MAX(pr.updated_at) FROM projects pr WHERE pr.client_id = c.id$own) AS last_project_at
             FROM clients c LEFT JOIN users u ON u.id = c.user_id
             WHERE $w ORDER BY COALESCE((SELECT MAX(pr.updated_at) FROM projects pr WHERE pr.client_id = c.id), c.updated_at) DESC, c.id DESC LIMIT 500",
            $p
        );
        $cnt = Database::fetchAll("SELECT c.status, COUNT(*) n FROM clients c WHERE " . $this->scope()[0] . " GROUP BY c.status", $this->scope()[1]);
        $this->json(['clients' => $rows, 'counts' => (object)array_column($cnt, 'n', 'status')]);
    }

    // GET /clients/{id} — картка і розрахунки
    public function show(int $id): void
    {
        $c = $this->find($id);
        $w = 'p.client_id = ?'; $p = [$id];
        if (($this->me['role'] ?? '') !== 'admin') { $w .= ' AND p.user_id = ?'; $p[] = $this->me['sub']; }
        $projects = Database::fetchAll(
            "SELECT p.id, p.name, p.object_address, p.status, p.total_area, p.total_price, p.settings, p.created_at, p.updated_at, u.name AS manager_name
             FROM projects p LEFT JOIN users u ON u.id = p.user_id WHERE $w ORDER BY p.updated_at DESC", $p
        );
        foreach ($projects as &$pr) {
            $s = json_decode($pr['settings'] ?? 'null', true);
            $pr['order_no'] = $s['order_no'] ?? null;
            $pr['calc_type'] = $s['calc_type'] ?? null;
            unset($pr['settings']);
        }
        $m = $c['user_id'] ? Database::fetchOne('SELECT name FROM users WHERE id = ?', [$c['user_id']]) : null;
        $c['manager_name'] = $m['name'] ?? null;
        $this->json(['client' => $c, 'projects' => $projects]);
    }

    // POST /clients
    public function create(): void
    {
        $b = $this->body();
        $name = trim((string)($b['name'] ?? ''));
        if ($name === '') $this->error('Вкажіть ім\'я або назву клієнта');
        $digits = preg_replace('/\D+/', '', (string)($b['phone'] ?? ''));
        if (strlen($digits) >= 9) {
            foreach (Database::fetchAll('SELECT name, phone FROM clients WHERE tenant_id = ? AND phone IS NOT NULL', [$this->me['tid']]) as $x) {
                if (substr(preg_replace('/\D+/', '', $x['phone']), -9) === substr($digits, -9)) $this->error('Клієнт з таким телефоном уже є: ' . $x['name']);
            }
        }
        $id = Database::insert(
            'INSERT INTO clients (tenant_id, user_id, name, phone, email, address, source, status, notes) VALUES (?,?,?,?,?,?,?,?,?)',
            [$this->me['tid'], $this->me['sub'], mb_substr($name, 0, 190), $this->str($b, 'phone', 50), $this->str($b, 'email', 190),
             $this->str($b, 'address', 255), $this->str($b, 'source', 50),
             in_array($b['status'] ?? '', self::STATUSES, true) ? $b['status'] : 'new', $this->str($b, 'notes', 5000)]
        );
        $this->show($id);
    }

    // PUT /clients/{id}
    public function update(int $id): void
    {
        $c = $this->find($id);
        $b = $this->body();
        $set = []; $vals = [];
        foreach (['name' => 190, 'phone' => 50, 'email' => 190, 'address' => 255, 'source' => 50, 'notes' => 5000] as $f => $len) {
            if (!array_key_exists($f, $b)) continue;
            $v = $this->str($b, $f, $len);
            if ($f === 'name' && !$v) $this->error('Вкажіть ім\'я або назву клієнта');
            $set[] = "$f = ?"; $vals[] = $v;
        }
        if (array_key_exists('status', $b) && in_array($b['status'], self::STATUSES, true)) { $set[] = 'status = ?'; $vals[] = $b['status']; }
        if (array_key_exists('user_id', $b) && ($this->me['role'] ?? '') === 'admin') {
            $u = Database::fetchOne('SELECT id FROM users WHERE id = ? AND tenant_id = ?', [(int)$b['user_id'], $this->me['tid']]);
            if ($u) { $set[] = 'user_id = ?'; $vals[] = $u['id']; }
        }
        if ($set) {
            $vals[] = $id;
            Database::query('UPDATE clients SET ' . implode(', ', $set) . ' WHERE id = ?', $vals);
            // ім'я і телефон — і в розрахунках клієнта (для документів)
            if (array_key_exists('name', $b) || array_key_exists('phone', $b)) {
                $n = Database::fetchOne('SELECT name, phone FROM clients WHERE id = ?', [$id]);
                Database::query('UPDATE projects SET client_name = ?, client_phone = ? WHERE client_id = ?', [$n['name'], $n['phone'], $id]);
            }
        }
        $this->show($id);
    }

    // DELETE /clients/{id}?projects=1 — видалити клієнта (розрахунки залишаються без клієнта або видаляються)
    public function delete(int $id): void
    {
        $this->find($id);
        $withProjects = !empty($_GET['projects']) && ($this->me['role'] ?? '') === 'admin';
        if ($withProjects) {
            $pids = 'SELECT id FROM projects WHERE client_id = ? AND tenant_id = ?';
            Database::query("DELETE FROM specification_items WHERE project_id IN ($pids)", [$id, $this->me['tid']]);
            Database::query("DELETE FROM slopes WHERE project_id IN ($pids)", [$id, $this->me['tid']]);
            Database::query('DELETE FROM projects WHERE client_id = ? AND tenant_id = ?', [$id, $this->me['tid']]);
        } else {
            Database::query('UPDATE projects SET client_id = NULL WHERE client_id = ?', [$id]);
        }
        Database::query('DELETE FROM clients WHERE id = ?', [$id]);
        $this->json(['deleted' => $id]);
    }

    private function str(array $b, string $k, int $len): ?string
    {
        $v = trim((string)($b[$k] ?? ''));
        return $v === '' ? null : mb_substr($v, 0, $len);
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
