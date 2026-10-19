<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/specification/SpecController.php
// ============================================

namespace RoofCalc\Api\Specification;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class SpecController
{
    // GET /api/projects/{id}/specification
    public function index(int $projectId): void
    {
        $user = Auth::currentUser();
        if (!$user) $this->error('Не авторизовано', 401);

        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$projectId]);
        if (!$project) $this->error('Проект не знайдено', 404);

        if (!in_array($user['role'], ['admin','manager'])
            && (int)$project['user_id'] !== (int)$user['sub']) {
            $this->error('Доступ заборонено', 403);
        }

        $items = Database::fetchAll(
            'SELECT si.*, s.name as slope_name
             FROM specification_items si
             LEFT JOIN slopes s ON s.id = si.slope_id
             WHERE si.project_id = ?
             ORDER BY si.sort_order, si.id',
            [$projectId]
        );

        // Підсумки
        $total      = array_sum(array_column($items, 'total'));
        $vatTotal   = 0;
        $vatPct     = (float)$project['vat_pct'];
        foreach ($items as $item) {
            if ($item['vat_included']) {
                $vatTotal += $item['total'] * $vatPct / (100 + $vatPct);
            } else {
                $vatTotal += $item['total'] * $vatPct / 100;
            }
        }

        // Знижка
        $discountPct = (float)$project['discount_pct'];
        $discount    = $total * $discountPct / 100;
        $totalWithDiscount = $total - $discount;

        $this->json([
            'items'              => $items,
            'total'              => round($total, 2),
            'vat_amount'         => round($vatTotal, 2),
            'discount_pct'       => $discountPct,
            'discount_amount'    => round($discount, 2),
            'total_with_discount'=> round($totalWithDiscount, 2),
        ]);
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
