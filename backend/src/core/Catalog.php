<?php
// ============================================
// ROOFKIT — core/Catalog.php
// Каталог виробників: кабінет з позначкою «виробник» публікує свої матеріали (published = 1),
// і їх бачать (і можуть використовувати / копіювати) усі кабінети платформи. PHP 7.4.
// ============================================

namespace RoofCalc\Core;

class Catalog
{
    private static bool $ready = false;

    public static function ensureSchema(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        Database::ensureTenantSchema();
        Database::ensureColumn('tenants', 'is_manufacturer', 'TINYINT NOT NULL DEFAULT 0');
        Database::ensureColumn('material_profiles', 'published', 'TINYINT NOT NULL DEFAULT 0');
    }

    // Умова видимості матеріалів для кабінету: каталог ABT + власні + опубліковані виробниками.
    // $a — псевдонім таблиці material_profiles ('' або 'm.')
    public static function visibleSql(int $tid, string $a = ''): array
    {
        self::ensureSchema();
        return [
            "({$a}tenant_id IS NULL OR {$a}tenant_id = ? OR ({$a}published = 1 AND {$a}tenant_id IN "
            . "(SELECT id FROM tenants WHERE is_manufacturer = 1 AND status <> 'blocked')))",
            [$tid],
        ];
    }

    public static function isVisible(int $materialId, int $tid): bool
    {
        [$w, $p] = self::visibleSql($tid);
        return (bool)Database::fetchOne("SELECT id FROM material_profiles WHERE id = ? AND $w", array_merge([$materialId], $p));
    }

    public static function isManufacturer(int $tid): bool
    {
        self::ensureSchema();
        $t = Database::fetchOne('SELECT is_manufacturer FROM tenants WHERE id = ?', [$tid]);
        return $t && (int)$t['is_manufacturer'] === 1;
    }
}
