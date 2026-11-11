<?php
// ============================================
// ROOFKIT — api/flashings/FlashingsController.php
// «Креслення добірних елементів»: збережені креслення (замовлення на гнуття) кабінету.
// Документ: назва, клієнт, колір / покриття / товщина, ширина листа металу і список елементів
// (профіль — відрізки з довжинами й кутами, довжина виробу, кількість) — усе в полі data (JSON).
// Адміністратор бачить усі креслення кабінету, інші — свої. PHP 7.4.
// ============================================

namespace RoofCalc\Api\Flashings;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class FlashingsController
{
    private static bool $ready = false;
    private array $me;

    public function __construct()
    {
        $u = Auth::currentUser();
        if (!$u) $this->json(['error' => 'Не авторизовано'], 401);
        if (!empty($u['sa']) && empty($u['imp'])) $this->json(['error' => 'Креслення ведуться всередині кабінету — увійдіть під користувачем кабінету'], 403);
        $this->me = $u;
        self::ensureSchema();
    }

    public static function ensureSchema(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        Database::connection()->exec("CREATE TABLE IF NOT EXISTS flashings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            user_id INT NULL,
            name VARCHAR(190) NOT NULL,
            client_name VARCHAR(190) NULL,
            data LONGTEXT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_fl_tenant (tenant_id, id)
        ) DEFAULT CHARSET=utf8mb4");
    }

    private function scope(): array
    {
        $w = 'f.tenant_id = ?'; $p = [(int)$this->me['tid']];
        if (($this->me['role'] ?? '') !== 'admin') { $w .= ' AND f.user_id = ?'; $p[] = (int)$this->me['sub']; }
        return [$w, $p];
    }

    private function find(int $id): array
    {
        [$w, $p] = $this->scope();
        $r = Database::fetchOne("SELECT f.*, u.name AS user_name FROM flashings f LEFT JOIN users u ON u.id = f.user_id WHERE f.id = ? AND $w", array_merge([$id], $p));
        if (!$r) $this->json(['error' => 'Креслення не знайдено'], 404);
        $r['data'] = json_decode($r['data'] ?? '{}', true) ?: new \stdClass();
        return $r;
    }

    public function index(): void
    {
        [$w, $p] = $this->scope();
        $rows = Database::fetchAll(
            "SELECT f.id, f.name, f.client_name, f.created_at, f.updated_at, u.name AS user_name, f.data
             FROM flashings f LEFT JOIN users u ON u.id = f.user_id WHERE $w ORDER BY f.updated_at DESC, f.id DESC LIMIT 500", $p);
        foreach ($rows as &$r) {
            $d = json_decode($r['data'] ?? '{}', true) ?: [];
            $r['items_count'] = count($d['items'] ?? []);
            unset($r['data']);
        }
        $this->json(['items' => $rows]);
    }

    public function show(int $id): void
    {
        $this->json(['flashing' => $this->find($id)]);
    }

    private function clean(array $b): array
    {
        $name = trim((string)($b['name'] ?? ''));
        if ($name === '') $name = 'Креслення';
        $data = $b['data'] ?? [];
        if (!is_array($data)) $data = [];
        $j = json_encode($data, JSON_UNESCAPED_UNICODE);
        if (strlen($j) > 2000000) $this->json(['error' => 'Креслення завелике'], 400);
        return [mb_substr($name, 0, 190), mb_substr(trim((string)($b['client_name'] ?? '')), 0, 190) ?: null, $j];
    }

    public function create(): void
    {
        if (($this->me['role'] ?? '') === 'viewer') $this->json(['error' => 'Недостатньо прав'], 403);
        [$name, $client, $data] = $this->clean($this->body());
        $id = Database::insert('INSERT INTO flashings (tenant_id, user_id, name, client_name, data) VALUES (?,?,?,?,?)',
            [(int)$this->me['tid'], (int)$this->me['sub'], $name, $client, $data]);
        $this->json(['flashing' => $this->find((int)$id)], 201);
    }

    public function update(int $id): void
    {
        if (($this->me['role'] ?? '') === 'viewer') $this->json(['error' => 'Недостатньо прав'], 403);
        $this->find($id);
        [$name, $client, $data] = $this->clean($this->body());
        Database::query('UPDATE flashings SET name = ?, client_name = ?, data = ? WHERE id = ?', [$name, $client, $data, $id]);
        $this->json(['flashing' => $this->find($id)]);
    }

    public function delete(int $id): void
    {
        if (($this->me['role'] ?? '') === 'viewer') $this->json(['error' => 'Недостатньо прав'], 403);
        $this->find($id);
        Database::query('DELETE FROM flashings WHERE id = ?', [$id]);
        $this->json(['message' => 'Креслення видалено']);
    }

    // POST /api/flashings/recognize  { image: base64, media: image/jpeg }
    public function recognize(): void
    {
        if (($this->me['role'] ?? '') === 'viewer') $this->json(['error' => 'Недостатньо прав'], 403);
        $b = $this->body();
        $img = (string)($b['image'] ?? '');
        if (strpos($img, ',') !== false && strpos($img, 'data:') === 0) $img = substr($img, strpos($img, ',') + 1);
        $media = (string)($b['media'] ?? 'image/jpeg');
        if (!in_array($media, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) $this->json(['error' => 'Непідтримуваний формат зображення'], 400);
        if ($img === '' || strlen($img) > 7 * 1024 * 1024 || base64_decode($img, true) === false) $this->json(['error' => 'Фото не отримано або воно завелике'], 400);
        @set_time_limit(150);
        try {
            $r = FlashingRecognizer::recognize($img, $media);
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'NO_KEY') $this->json(['error' => 'Розпізнавання фото ще не налаштоване: супер-адмін має вказати ключ Claude API у налаштуваннях платформи'], 503);
            error_log('flashings.recognize: ' . $e->getMessage());
            $this->json(['error' => 'Не вдалося розпізнати фото: ' . $e->getMessage()], 502);
        }
        $this->json($r);
    }

    private function body(): array { return json_decode((string)file_get_contents('php://input'), true) ?: []; }

    private function json(array $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }
}
