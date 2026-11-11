<?php
// ============================================
// ROOFKIT — api/history/HistoryController.php
// GET  /history[?kind=]        — останні дії (адміністратор бачить дії всього кабінету, інші — свої)
// POST /history/{id}/undo      — скасувати дію. PHP 7.4.
// ============================================

namespace RoofCalc\Api\History;

use RoofCalc\Core\Auth;
use RoofCalc\Core\History;

class HistoryController
{
    private array $me;

    public function __construct()
    {
        $u = Auth::currentUser();
        if (!$u) $this->json(['error' => 'Не авторизовано'], 401);
        $this->me = $u;
    }

    public function index(): void
    {
        $this->json(['items' => History::list($this->me, (string)($_GET['kind'] ?? ''))]);
    }

    public function undo(int $id): void
    {
        if (($this->me['role'] ?? '') === 'viewer') $this->json(['error' => 'Недостатньо прав'], 403);
        try {
            $n = History::undo($id, $this->me);
        } catch (\RuntimeException $e) {
            $this->json(['error' => $e->getMessage()], 400);
        }
        $this->json(['restored' => $n, 'items' => History::list($this->me, (string)($_GET['kind'] ?? ''))]);
    }

    private function json(array $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
        exit;
    }
}
