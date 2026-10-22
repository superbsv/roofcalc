<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/projects/ProjectsController.php
// ============================================

namespace RoofCalc\Api\Projects;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Plans;

class ProjectsController
{
    public function __construct()
    {
        Database::ensureProjectSchema();
        Database::ensurePlatformSchema();
    }

    // settings: реквізити замовлення і параметри проєкту як у КП
    public static function decodeProject(?array $p): ?array
    {
        if (!$p) return $p;
        $s = isset($p['settings']) && is_string($p['settings']) ? json_decode($p['settings'], true) : null;
        $p['settings'] = is_array($s) ? $s : (object)[];
        return $p;
    }

    private static function cleanSettings($raw): string
    {
        if (!is_array($raw)) $raw = [];
        $out = [];
        foreach ($raw as $k => $v) {
            if (!is_string($k) || strlen($k) > 40) continue;
            if (is_array($v) || is_object($v)) continue;
            $out[$k] = is_string($v) ? mb_substr($v, 0, 255) : $v;
        }
        return json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    // GET /api/projects
    public function index(): void
    {
        $user = $this->requireAuth();

        // Лише проєкти свого кабінету; адміністратор бачить усі проєкти кабінету, менеджер і решта — лише свої
        $where  = 'p.tenant_id = ? AND p.user_id = ?';
        $params = [$user['tid'], $user['sub']];
        if ($user['role'] === 'admin') {
            $where  = 'p.tenant_id = ?';
            $params = [$user['tid']];
        }

        // Пошук
        if (!empty($_GET['search'])) {
            $s = '%' . $_GET['search'] . '%';
            $where  .= ' AND (p.name LIKE ? OR p.client_name LIKE ?)';
            $params[] = $s;
            $params[] = $s;
        }

        // Фільтр по статусу
        if (!empty($_GET['status'])) {
            $where  .= ' AND p.status = ?';
            $params[] = $_GET['status'];
        }

        $page  = max(1, (int)($_GET['page'] ?? 1));
        $limit = min(50, (int)($_GET['limit'] ?? 20));
        $offset = ($page - 1) * $limit;

        $total = Database::fetchOne(
            "SELECT COUNT(*) as cnt FROM projects p WHERE $where",
            $params
        )['cnt'];

        $projects = Database::fetchAll(
            "SELECT p.id, p.name, p.client_name, p.object_address, p.roof_type, p.settings,
                    p.status, p.total_area, p.total_price, p.created_at, p.updated_at,
                    u.name as manager_name
             FROM projects p
             LEFT JOIN users u ON u.id = p.user_id
             WHERE $where
             ORDER BY p.updated_at DESC
             LIMIT $limit OFFSET $offset",
            $params
        );

        $this->json([
            'data'  => array_map([self::class, 'decodeProject'], $projects),
            'total' => (int)$total,
            'page'  => $page,
            'limit' => $limit,
        ]);
    }

    // POST /api/projects
    public function create(): void
    {
        $user = $this->requireAuth();
        $body = $this->body();

        if (empty($body['name'])) {
            $this->error('Назва проекту обов\'язкова', 400);
        }

        // Ліміт розрахунків тарифу на календарний місяць
        $tenant = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$user['tid']]);
        $lim = $tenant ? Plans::limits($tenant) : ['projects_month' => null];
        if (!empty($lim['projects_month'])) {
            $cnt = (int)Database::fetchOne(
                "SELECT COUNT(*) c FROM projects WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')", [$user['tid']]
            )['c'];
            if ($cnt >= (int)$lim['projects_month']) {
                $this->error('Вичерпано ліміт тарифу: ' . $lim['projects_month'] . ' розрахунків на місяць. Змініть тариф або зверніться в підтримку ROOFKIT', 402);
            }
        }

        // Номер замовлення — наскрізна нумерація кабінету
        $settings = is_array($body['settings'] ?? null) ? $body['settings'] : [];
        if ($tenant && empty($settings['order_no'])) {
            $settings['order_no'] = (string)(int)$tenant['next_order_no'];
            Database::query('UPDATE tenants SET next_order_no = next_order_no + 1 WHERE id = ?', [$user['tid']]);
        }
        if ($tenant && empty($settings['company'])) $settings['company'] = $tenant['doc_company'] ?: $tenant['name'];
        $body['settings'] = $settings;

        $id = Database::insert(
            'INSERT INTO projects (user_id, name, client_name, client_phone, client_email,
             object_address, roof_type, notes, discount_pct, vat_pct, status, settings, tenant_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $user['sub'],
                trim($body['name']),
                $body['client_name']    ?? null,
                $body['client_phone']   ?? null,
                $body['client_email']   ?? null,
                $body['object_address'] ?? null,
                $body['roof_type']      ?? null,
                $body['notes']          ?? null,
                $body['discount_pct']   ?? 0,
                $body['vat_pct']        ?? 20,
                'draft',
                self::cleanSettings($body['settings'] ?? []),
                $user['tid'],
            ]
        );

        \RoofCalc\Api\Clients\ClientsController::linkProject($id, $user, $body);
        $this->log($user['sub'], 'project.create', 'project', $id);
        $project = self::decodeProject(Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]));
        $this->json(['project' => $project], 201);
    }

    // GET /api/projects/{id}
    public function show(int $id): void
    {
        $user    = $this->requireAuth();
        $project = $this->findProject($id, $user);

        // Підвантажуємо скати
        $slopes = Database::fetchAll(
            'SELECT s.*, mp.name as material_name, mp.type as material_type
             FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.project_id = ?
             ORDER BY s.sort_order, s.id',
            [$id]
        );

        foreach ($slopes as &$slope) {
            $slope = \RoofCalc\Api\Slopes\SlopesController::decodeSlope($slope);
        }
        unset($slope);

        $this->json([
            'project' => self::decodeProject($project),
            'slopes'  => $slopes,
        ]);
    }

    // PUT /api/projects/{id}
    public function update(int $id): void
    {
        $user    = $this->requireAuth();
        $project = $this->findProject($id, $user);
        $body    = $this->body();

        $fields = [];
        $params = [];

        $allowed = ['name','client_name','client_phone','client_email',
                    'object_address','roof_type','notes','discount_pct','vat_pct','status','settings'];

        foreach ($allowed as $f) {
            if (array_key_exists($f, $body)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'settings' ? self::cleanSettings($body[$f]) : $body[$f];
            }
        }

        if (!$fields && !array_key_exists('client_id', $body)) $this->error('Немає полів для оновлення', 400);
        if (!$fields) { $fields[] = 'updated_at = updated_at'; }

        $params[] = $id;
        Database::query("UPDATE projects SET " . implode(', ', $fields) . " WHERE id = ?", $params);

        \RoofCalc\Api\Clients\ClientsController::linkProject($id, $user, $body);
        $this->log($user['sub'], 'project.update', 'project', $id);
        $this->json(['project' => self::decodeProject(Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]))]);
    }

    // DELETE /api/projects/{id}
    public function delete(int $id): void
    {
        $user = $this->requireAuth();
        $this->findProject($id, $user);

        Database::query('DELETE FROM projects WHERE id = ?', [$id]);
        $this->log($user['sub'], 'project.delete', 'project', $id);
        $this->json(['message' => 'Проект видалено']);
    }

    // GET /api/projects/share/{token}  — публічний доступ
    public function share(string $token): void
    {
        $project = Database::fetchOne(
            'SELECT id, name, client_name, object_address, roof_type,
                    total_area, total_price, status, updated_at
             FROM projects
             WHERE share_token = ? AND (share_expires_at IS NULL OR share_expires_at > NOW())',
            [$token]
        );

        if (!$project) $this->error('Посилання не дійсне або застаріло', 404);

        $slopes = Database::fetchAll(
            'SELECT id, name, polygon_points, slope_angle, calc_result
             FROM slopes WHERE project_id = ? ORDER BY sort_order, id',
            [$project['id']]
        );

        $spec = Database::fetchAll(
            'SELECT name, unit, quantity, price, total FROM specification_items WHERE project_id = ? ORDER BY sort_order',
            [$project['id']]
        );

        $this->json([
            'project'       => $project,
            'slopes'        => $slopes,
            'specification' => $spec,
        ]);
    }

    // POST /api/projects/{id}/calculate-all
    public function calculateAll(int $id): void
    {
        $user    = $this->requireAuth();
        $this->findProject($id, $user);

        $slopes = Database::fetchAll(
            'SELECT id, name, polygon_points, material_profile_id FROM slopes WHERE project_id = ?', [$id]
        );

        // Розраховуємо кожен елемент окремо: порожній або помилковий елемент не зупиняє весь проєкт
        $slopeCtrl = new \RoofCalc\Api\Slopes\SlopesController();
        $skipped = [];
        $area    = 0.0;
        foreach ($slopes as $s) {
            $pts = json_decode($s['polygon_points'] ?? '[]', true) ?: [];
            if (count($pts) < 3) { $skipped[] = $s['name'] . ': немає контуру'; continue; }
            if (empty($s['material_profile_id'])) { $skipped[] = $s['name'] . ': не обрано матеріал'; continue; }
            try {
                $r = $slopeCtrl->calculateById((int)$s['id']);
                if (!empty($r['errors'])) { $skipped[] = $s['name'] . ': ' . implode('; ', $r['errors']); continue; }
                $area += (float)($r['slope_area_m2'] ?? 0);
            } catch (\Throwable $e) {
                $skipped[] = $s['name'] . ': ' . $e->getMessage();
            }
        }

        // Підсумки проєкту (раніше тут була неіснуюча колонка useful_area → помилка 500)
        $totals = Database::fetchOne(
            'SELECT SUM(total) as total_price FROM specification_items WHERE project_id = ?',
            [$id]
        );

        Database::query(
            'UPDATE projects SET total_price = ?, total_area = ?, status = "calculated" WHERE id = ?',
            [$totals['total_price'] ?? 0, round($area, 3), $id]
        );

        $this->log($user['sub'], 'project.calculate', 'project', $id);
        $this->json(['message' => 'Проект перераховано', 'project_id' => $id, 'skipped' => $skipped]);
    }

    // ---- Helpers ----

    // ============================================
    // Файл проекту (.roofkit): збереження на комп'ютер і відкриття в будь-якому кабінеті
    // ============================================
    private const FILE_SLOPE_FIELDS = ['name', 'sort_order', 'polygon_points', 'holes', 'slope_angle', 'eave_side', 'ridge_side',
        'laying_direction', 'eave_overhang', 'ridge_gap', 'material_color', 'material_coating', 'material_thickness', 'edge_types',
        'element_kind', 'calc_mode', 'joint_y', 'round_step', 'layout_shift', 'split_forced', 'v_shift', 'rows_count', 'sheet_edits'];
    private const FILE_MAT_SKIP = ['id', 'tenant_id', 'published', 'deleted', 'source_id', 'section_id', 'sort_order'];

    // GET /projects/{id}/file
    public function fileExport(int $id): void
    {
        $user = $this->requireAuth();
        $p = $this->findProject($id, $user);
        $slopes = Database::fetchAll('SELECT * FROM slopes WHERE project_id = ? ORDER BY sort_order, id', [$id]);
        $matIds = [];
        $st = json_decode($p['settings'] ?? 'null', true) ?: [];
        if (!empty($st['material_id'])) $matIds[(int)$st['material_id']] = true;
        $outSlopes = [];
        foreach ($slopes as $s) {
            $o = [];
            foreach (self::FILE_SLOPE_FIELDS as $f) {
                $v = $s[$f] ?? null;
                if (in_array($f, ['polygon_points', 'holes', 'edge_types', 'sheet_edits'], true)) $v = json_decode($v ?? 'null', true);
                $o[$f] = $v;
            }
            $o['material_ref'] = $s['material_profile_id'] ? (int)$s['material_profile_id'] : null;
            if ($s['material_profile_id']) $matIds[(int)$s['material_profile_id']] = true;
            $outSlopes[] = $o;
        }
        $materials = [];
        foreach (array_keys($matIds) as $mid) {
            $m = Database::fetchOne('SELECT m.*, s.name AS section_name FROM material_profiles m LEFT JOIN catalog_sections s ON s.id = m.section_id WHERE m.id = ?', [$mid]);
            if (!$m) continue;
            foreach (self::FILE_MAT_SKIP as $k) if ($k !== 'id') unset($m[$k]);
            foreach (['forbidden_lengths', 'stock_lengths', 'color_options', 'coating_options', 'thickness_options'] as $k) $m[$k] = json_decode($m[$k] ?? 'null', true);
            $materials[] = $m;
        }
        $this->json(['roofkit_project' => 1, 'saved_at' => date('c'), 'project' => [
            'name' => $p['name'], 'client_name' => $p['client_name'], 'client_phone' => $p['client_phone'], 'client_email' => $p['client_email'],
            'object_address' => $p['object_address'], 'roof_type' => $p['roof_type'], 'notes' => $p['notes'],
            'discount_pct' => $p['discount_pct'], 'vat_pct' => $p['vat_pct'], 'settings' => $st,
        ], 'materials' => $materials, 'slopes' => $outSlopes]);
    }

    // POST /projects/import — відкрити файл проекту: новий розрахунок у кабінеті, матеріали — у свій каталог
    public function fileImport(): void
    {
        $user = $this->requireAuth();
        if (($user['role'] ?? '') === 'viewer') $this->error('Недостатньо прав', 403);
        $b = $this->body();
        if (empty($b['roofkit_project']) || !is_array($b['project'] ?? null) || !is_array($b['slopes'] ?? null)) $this->error('Це не файл проекту ROOFKIT');
        \RoofCalc\Core\Catalog::ensureSchema();
        $tid = (int)$user['tid'];
        $tn = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$tid]);
        $lim = $tn ? Plans::limits($tn) : ['projects_month' => null];
        if (!empty($lim['projects_month'])) {
            $cnt = (int)Database::fetchOne("SELECT COUNT(*) c FROM projects WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')", [$tid])['c'];
            if ($cnt >= (int)$lim['projects_month']) $this->error('Вичерпано ліміт тарифу: ' . $lim['projects_month'] . ' розрахунків на місяць. Змініть тариф або зверніться в підтримку ROOFKIT', 402);
        }

        // 1. Матеріали: знаходимо такий самий у своєму каталозі або додаємо
        $map = [];
        foreach ((array)($b['materials'] ?? []) as $m) {
            if (!is_array($m) || empty($m['id']) || empty($m['name']) || empty($m['type'])) continue;
            $fid = (int)$m['id'];
            $same = Database::fetchOne(
                'SELECT id FROM material_profiles WHERE tenant_id = ? AND deleted = 0 AND type = ? AND name = ? AND COALESCE(manufacturer, \'\') = ? AND full_width = ? AND useful_width = ? LIMIT 1',
                [$tid, $m['type'], $m['name'], (string)($m['manufacturer'] ?? ''), (int)($m['full_width'] ?? 0), (int)($m['useful_width'] ?? 0)]
            );
            if ($same) { $map[$fid] = (int)$same['id']; continue; }
            $sec = \RoofCalc\Core\Catalog::sectionFor(null, (string)$m['type']);
            if (!empty($m['section_name'])) {
                $byName = Database::fetchOne('SELECT * FROM catalog_sections WHERE name = ? AND calc_type = ?', [$m['section_name'], $m['type']]);
                if ($byName) $sec = $byName;
            }
            $cols = Database::fetchAll('SHOW COLUMNS FROM material_profiles');
            $allowed = array_diff(array_column($cols, 'Field'), self::FILE_MAT_SKIP);
            $vals = [];
            foreach ($allowed as $c) {
                if (!array_key_exists($c, $m)) continue;
                $v = $m[$c];
                $vals[$c] = is_array($v) ? json_encode($v) : $v;
            }
            $vals['manufacturer'] = \RoofCalc\Core\Catalog::canonicalManufacturer($m['manufacturer'] ?? '', $tid);
            $vals['tenant_id'] = $tid; $vals['section_id'] = $sec['id'] ?? null; $vals['is_active'] = 1;
            $map[$fid] = Database::insert('INSERT INTO material_profiles (' . implode(',', array_keys($vals)) . ') VALUES (' . implode(',', array_fill(0, count($vals), '?')) . ')', array_values($vals));
        }

        // 2. Проект (з новим номером замовлення кабінету)
        $pr = $b['project'];
        $st = is_array($pr['settings'] ?? null) ? $pr['settings'] : [];
        if (!empty($st['material_id'])) $st['material_id'] = $map[(int)$st['material_id']] ?? null;
        $tenant = Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$tid]);
        if ($tenant) {
            $st['order_no'] = (string)(int)$tenant['next_order_no'];
            Database::query('UPDATE tenants SET next_order_no = next_order_no + 1 WHERE id = ?', [$tid]);
            $st['company'] = $tenant['doc_company'] ?: $tenant['name'];
        }
        $name = trim((string)($pr['name'] ?? '')) ?: 'Розрахунок з файлу';
        $pid = Database::insert(
            'INSERT INTO projects (user_id, name, client_name, client_phone, client_email, object_address, roof_type, notes, discount_pct, vat_pct, status, settings, tenant_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$user['sub'], mb_substr($name, 0, 190), $pr['client_name'] ?? null, $pr['client_phone'] ?? null, $pr['client_email'] ?? null,
             $pr['object_address'] ?? null, $pr['roof_type'] ?? null, $pr['notes'] ?? null, $pr['discount_pct'] ?? 0, $pr['vat_pct'] ?? 20,
             'draft', self::cleanSettings($st), $tid]
        );

        // 3. Скати
        $slopeCols = array_column(Database::fetchAll('SHOW COLUMNS FROM slopes'), 'Field');
        foreach (array_slice($b['slopes'], 0, 200) as $i => $s) {
            if (!is_array($s)) continue;
            $vals = ['project_id' => $pid];
            foreach (self::FILE_SLOPE_FIELDS as $f) {
                if (!array_key_exists($f, $s) || !in_array($f, $slopeCols, true)) continue;
                $v = $s[$f];
                $vals[$f] = in_array($f, ['polygon_points', 'holes', 'edge_types', 'sheet_edits'], true) ? ($v === null ? null : json_encode($v)) : $v;
            }
            if (empty($vals['name'])) $vals['name'] = 'Скат ' . ($i + 1);
            if (!isset($vals['polygon_points'])) $vals['polygon_points'] = '[]';
            $vals['material_profile_id'] = !empty($s['material_ref']) ? ($map[(int)$s['material_ref']] ?? null) : null;
            Database::insert('INSERT INTO slopes (' . implode(',', array_keys($vals)) . ') VALUES (' . implode(',', array_fill(0, count($vals), '?')) . ')', array_values($vals));
        }

        \RoofCalc\Api\Clients\ClientsController::linkProject($pid, $user, $pr);
        // одразу перераховуємо скати, щоб були укладка і специфікація
        $sc = new \RoofCalc\Api\Slopes\SlopesController();
        foreach (Database::fetchAll('SELECT id FROM slopes WHERE project_id = ? AND material_profile_id IS NOT NULL', [$pid]) as $sl) {
            try { $sc->calculateById((int)$sl['id']); } catch (\Throwable $e) { /* скат без контуру — пропускаємо */ }
        }
        $this->log($user['sub'], 'project.import', 'project', $pid);
        $this->json(['project' => self::decodeProject(Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$pid]))], 201);
    }

    private function findProject(int $id, array $user): array
    {
        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]);
        if (!$project) $this->error('Проект не знайдено', 404);

        // Доступ: проєкт свого кабінету — свій або (для адміна/менеджера) будь-який
        if (!Auth::projectAllowed($user, $project)) {
            $this->error('Проект не знайдено', 404);
        }

        return $project;
    }

    private function requireAuth(): array
    {
        $user = Auth::currentUser();
        if (!$user) $this->error('Не авторизовано', 401);
        if (!empty($user['sa']) && empty($user['imp'])) {
            $this->error('Панель платформи не працює з розрахунками — увійдіть під користувачем кабінету або відкрийте кабінет клієнта', 403);
        }
        return $user;
    }

    private function body(): array
    {
        return json_decode(file_get_contents('php://input'), true) ?? [];
    }

    private function log(int $userId, string $action, string $type, int $entityId): void
    {
        Database::query(
            'INSERT INTO activity_log (user_id, tenant_id, action, entity_type, entity_id, ip_address)
             VALUES (?, (SELECT tenant_id FROM users WHERE id = ?), ?, ?, ?, ?)',
            [$userId, $userId, $action, $type, $entityId, $_SERVER['REMOTE_ADDR'] ?? null]
        );
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
