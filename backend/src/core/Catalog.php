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
        // Видалений матеріал, що вже є в розрахунках: прихований з каталогу, але старі проекти рахуються
        Database::ensureColumn('material_profiles', 'deleted', 'TINYINT NOT NULL DEFAULT 0');
        self::ensureSections();
    }

    public const CALC_TYPES = ['tile', 'profile', 'falts', 'siding', 'sandwich'];
    private const DEFAULT_SECTIONS = [
        'tile' => 'Металочерепиця', 'profile' => 'Профнастил', 'falts' => 'Клік-фальц',
        'siding' => 'Металевий сайдинг', 'sandwich' => 'Сендвіч-панелі',
    ];

    // Розділи каталогу (структура «Каталогу продукції»): назва, порядок і тип розрахунку
    private static function ensureSections(): void
    {
        try {
            $db = Database::connection();
            // Колація як у material_profiles — інакше MySQL падає на порівнянні «Illegal mix of collations»
            $col = Database::fetchOne(
                "SELECT COLLATION_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'material_profiles' AND COLUMN_NAME = 'type'"
            )['c'] ?? 'utf8mb4_unicode_ci';
            if (!preg_match('/^[a-z0-9_]+$/', $col)) $col = 'utf8mb4_unicode_ci';
            $cs = explode('_', $col)[0];
            $db->exec("CREATE TABLE IF NOT EXISTS catalog_sections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                calc_type VARCHAR(32) NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
            ) DEFAULT CHARSET=$cs COLLATE=$col");
            $cur = Database::fetchOne(
                "SELECT COLLATION_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_sections' AND COLUMN_NAME = 'calc_type'"
            )['c'] ?? $col;
            if ($cur !== $col) $db->exec("ALTER TABLE catalog_sections CONVERT TO CHARACTER SET $cs COLLATE $col");

            Database::ensureColumn('material_profiles', 'section_id', 'INT NULL');
            if (!Database::fetchOne('SELECT id FROM catalog_sections LIMIT 1')) {
                $i = 0;
                foreach (self::DEFAULT_SECTIONS as $t => $n) {
                    Database::query('INSERT INTO catalog_sections (name, calc_type, sort_order) VALUES (?,?,?)', [$n, $t, ++$i * 10]);
                }
            }
            // v2: основні продукти — металочерепиця, профнастил, клік-фальц, сайдинг, сендвіч-панелі.
            // Інші розділи прибираємо; їх матеріали ховаються з каталогу (старі розрахунки працюють)
            if (!Database::fetchOne("SELECT id FROM catalog_sections WHERE calc_type = 'siding' LIMIT 1")) {
                $old = ['tile_module', 'sheet', 'natural_tile'];
                $in = "'" . implode("','", $old) . "'";
                Database::query("UPDATE material_profiles SET deleted = 1, published = 0 WHERE type IN ($in)");
                Database::query("DELETE FROM catalog_sections WHERE calc_type IN ($in)");
                Database::query("UPDATE catalog_sections SET name = 'Клік-фальц' WHERE calc_type = 'falts' AND name = 'Фальцева покрівля'");
                $max = (int)(Database::fetchOne('SELECT MAX(sort_order) m FROM catalog_sections')['m'] ?? 0);
                Database::query("INSERT INTO catalog_sections (name, calc_type, sort_order) VALUES ('Металевий сайдинг', 'siding', ?), ('Сендвіч-панелі', 'sandwich', ?)", [$max + 10, $max + 20]);
            }
            // матеріали без розділу — у перший розділ свого типу розрахунку
            if (Database::fetchOne('SELECT id FROM material_profiles WHERE section_id IS NULL LIMIT 1')) {
                foreach (Database::fetchAll('SELECT id, calc_type FROM catalog_sections ORDER BY sort_order, id') as $sec) {
                    Database::query('UPDATE material_profiles SET section_id = ? WHERE section_id IS NULL AND type = ?', [$sec['id'], $sec['calc_type']]);
                }
            }
        } catch (\Throwable $e) {
            error_log('ROOFKIT catalog sections: ' . $e->getMessage());   // не ламаємо вхід і решту сайту
        }
    }

    public static function sectionFor(?int $sectionId, string $type): ?array
    {
        self::ensureSchema();
        if ($sectionId) {
            $s = Database::fetchOne('SELECT * FROM catalog_sections WHERE id = ?', [$sectionId]);
            if ($s) return $s;
        }
        return Database::fetchOne('SELECT * FROM catalog_sections WHERE calc_type = ? ORDER BY sort_order, id LIMIT 1', [$type]);
    }

    // Умова видимості матеріалів для кабінету: каталог ABT + власні + опубліковані виробниками.
    // $a — псевдонім таблиці material_profiles ('' або 'm.')
    public static function visibleSql(int $tid, string $a = ''): array
    {
        self::ensureSchema();
        return [
            "{$a}deleted = 0 AND ({$a}tenant_id IS NULL OR {$a}tenant_id = ? OR ({$a}published = 1 AND {$a}tenant_id IN "
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
