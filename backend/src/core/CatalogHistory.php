<?php
// ============================================
// ROOFKIT — core/CatalogHistory.php
// Записи історії для дій з каталогом матеріалів (власні підписи: «Видалено виробника…», «Переміщено…»).
// Сама історія і скасування — core/History.php (спільна для всього калькулятора). PHP 7.4.
// ============================================

namespace RoofCalc\Core;

class CatalogHistory
{
    /** Повні рядки матеріалів (стан «до» дії) */
    public static function snap(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if (!$ids) return [];
        return Database::fetchAll('SELECT * FROM material_profiles WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids);
    }

    /** Записати дію. $before — snap() до зміни, $created — id позицій, створених дією */
    public static function record(string $label, array $before, array $created = []): void
    {
        History::record('catalog', $label,
            array_map(function ($r) { return ['t' => 'material_profiles', 'r' => $r]; }, $before),
            array_map(function ($id) { return ['material_profiles', (int)$id]; }, $created));
    }
}
