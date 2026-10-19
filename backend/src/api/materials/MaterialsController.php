<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/materials/MaterialsController.php
// ============================================

namespace RoofCalc\Api\Materials;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;

class MaterialsController
{
    // GET /api/materials
    public function index(): void
    {
        $profiles = Database::fetchAll(
            'SELECT * FROM material_profiles WHERE is_active = 1 ORDER BY type, sort_order, name'
        );
        $this->json(['profiles' => $this->decode($profiles)]);
    }

    // GET /api/materials/{type}
    public function byType(string $type): void
    {
        if (!in_array($type, ['tile','profile','falts','tile_module','sheet','natural_tile'])) {
            $this->error('Невідомий тип матеріалу', 400);
        }
        $profiles = Database::fetchAll(
            'SELECT * FROM material_profiles WHERE type = ? AND is_active = 1 ORDER BY sort_order, name',
            [$type]
        );
        $this->json(['profiles' => $this->decode($profiles)]);
    }

    // GET /api/materials/{id}
    public function show(int $id): void
    {
        $p = Database::fetchOne('SELECT * FROM material_profiles WHERE id = ?', [$id]);
        if (!$p) $this->error('Профіль не знайдено', 404);
        $this->json(['profile' => $this->decodeOne($p)]);
    }

    private function decode(array $rows): array
    {
        return array_map([$this, 'decodeOne'], $rows);
    }

    private function decodeOne(array $p): array
    {
        foreach (['forbidden_lengths','stock_lengths','color_options','coating_options','thickness_options'] as $f) {
            if (isset($p[$f])) {
                $p[$f] = json_decode($p[$f], true);
            }
        }
        return $p;
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
