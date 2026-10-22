<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/materials/MaterialsController.php
// ============================================

namespace RoofCalc\Api\Materials;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Core\Catalog;

class MaterialsController
{
    // GET /api/materials
    // Видимі матеріали: загальний каталог ABT (tenant_id IS NULL) + матеріали кабінету користувача
    // + опубліковані матеріали виробників (каталог виробників)
    private function scope(): array
    {
        Database::ensureTenantSchema();
        $u = Auth::currentUser();
        return $u ? Catalog::visibleSql((int)$u['tid'], 'm.') : ['m.tenant_id IS NULL', []];
    }

    // Власник матеріалу (для позначок «Каталог ABT» / «Виробник: …» / «Власний»)
    private const SELECT = 'SELECT m.*, t.name AS owner_name, t.is_manufacturer AS owner_mf FROM material_profiles m LEFT JOIN tenants t ON t.id = m.tenant_id';

    public function index(): void
    {
        [$w, $p] = $this->scope();
        $profiles = Database::fetchAll(
            self::SELECT . " WHERE m.is_active = 1 AND $w ORDER BY m.type, m.sort_order, m.name", $p
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
            self::SELECT . " WHERE m.type = ? AND m.is_active = 1 AND $w ORDER BY m.sort_order, m.name",
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

    // GET /api/materials/section/{id} — матеріали розділу каталогу (порядок: sort_order, назва)
    public function bySection(int $id): void
    {
        Catalog::ensureSchema();
        [$w, $p] = $this->scope();
        $profiles = Database::fetchAll(
            self::SELECT . " WHERE m.section_id = ? AND $w ORDER BY m.sort_order, m.name",
            array_merge([$id], $p)
        );
        $this->json(['profiles' => $this->decode($profiles)]);
    }

    // GET /api/materials/{id}
    public function show(int $id): void
    {
        [$w, $pp] = $this->scope();
        $p = Database::fetchOne(self::SELECT . " WHERE m.id = ? AND $w", array_merge([$id], $pp));
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
