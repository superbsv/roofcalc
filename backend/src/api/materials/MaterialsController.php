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
    // Видимі матеріали: загальний каталог ABT (tenant_id IS NULL) + матеріали кабінету користувача
    private function scope(): array
    {
        Database::ensureTenantSchema();
        $u = Auth::currentUser();
        return $u ? ['(tenant_id IS NULL OR tenant_id = ?)', [(int)$u['tid']]] : ['tenant_id IS NULL', []];
    }

    public function index(): void
    {
        [$w, $p] = $this->scope();
        $profiles = Database::fetchAll(
            "SELECT * FROM material_profiles WHERE is_active = 1 AND $w ORDER BY type, sort_order, name", $p
        );
        $this->json(['profiles' => $this->decode($profiles)]);
    }

    // GET /api/materials/{type}
    public function byType(string $type): void
    {
        if (!in_array($type, ['tile','profile','falts','tile_module','sheet','natural_tile'])) {
            $this->error('Невідомий тип матеріалу', 400);
        }
        [$w, $p] = $this->scope();
        $profiles = Database::fetchAll(
            "SELECT * FROM material_profiles WHERE type = ? AND is_active = 1 AND $w ORDER BY sort_order, name",
            array_merge([$type], $p)
        );
        $this->json(['profiles' => $this->decode($profiles)]);
    }

    // GET /api/accessories — перелік доборних елементів (вікно матеріалу, права частина як у КП)
    public function accessories(): void
    {
        $rows = Database::fetchAll(
            'SELECT id, code, name_uk AS name, unit, working_length, default_overlap, price, calc_rule
             FROM accessory_types WHERE is_active = 1 ORDER BY id'
        );
        $this->json(['accessories' => $rows]);
    }

    // GET /api/materials/{id}
    public function show(int $id): void
    {
        [$w, $pp] = $this->scope();
        $p = Database::fetchOne("SELECT * FROM material_profiles WHERE id = ? AND $w", array_merge([$id], $pp));
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
