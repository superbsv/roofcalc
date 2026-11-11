<?php
// ============================================
// ROOFKIT — core/CatalogHistory.php
// Історія дій з каталогом матеріалів і скасування (кнопка «Історія дій» у каталозі).
// Перед зміною запам'ятовуємо повні рядки material_profiles; скасування повертає їх як були
// (видалені — вставляються знову з тим самим id), а позиції, створені дією, прибирає. PHP 7.4.
// ============================================

namespace RoofCalc\Core;

class CatalogHistory
{
    private const KEEP = 100;   // скільки останніх дій зберігати на кабінет
    private static bool $ready = false;

    public static function ensure(): void
    {
        if (self::$ready) return;
        self::$ready = true;
        Database::connection()->exec("CREATE TABLE IF NOT EXISTS catalog_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NULL,
            user_id INT NULL,
            label VARCHAR(255) NOT NULL,
            snapshot LONGTEXT NULL,
            created_ids LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            undone_at DATETIME NULL,
            INDEX idx_ch_tenant (tenant_id, id)
        ) DEFAULT CHARSET=utf8mb4");
    }

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
        try {
            if (!$before && !$created) return;
            self::ensure();
            $u = Auth::currentUser() ?? [];
            $tid = isset($u['tid']) ? (int)$u['tid'] : null;
            Database::query(
                'INSERT INTO catalog_history (tenant_id, user_id, label, snapshot, created_ids, created_at) VALUES (?,?,?,?,?,NOW())',
                [$tid, $u['sub'] ?? null, mb_substr($label, 0, 255), json_encode($before, JSON_UNESCAPED_UNICODE), json_encode(array_values(array_map('intval', $created)))]
            );
            $old = Database::fetchOne('SELECT id FROM catalog_history WHERE tenant_id <=> ? ORDER BY id DESC LIMIT 1 OFFSET ' . self::KEEP, [$tid]);
            if ($old) Database::query('DELETE FROM catalog_history WHERE tenant_id <=> ? AND id <= ?', [$tid, $old['id']]);
        } catch (\Throwable $e) {
            error_log('ROOFKIT catalog history: ' . $e->getMessage());   // історія не має ламати саму дію
        }
    }

    public static function list(?int $tid): array
    {
        self::ensure();
        $rows = Database::fetchAll(
            'SELECT h.id, h.label, h.created_at, h.undone_at, u.name AS user_name, h.snapshot, h.created_ids
             FROM catalog_history h LEFT JOIN users u ON u.id = h.user_id
             WHERE h.tenant_id <=> ? ORDER BY h.id DESC LIMIT ' . self::KEEP, [$tid]
        );
        foreach ($rows as &$r) {
            $r['count'] = count(json_decode($r['snapshot'] ?? '[]', true) ?: []) + count(json_decode($r['created_ids'] ?? '[]', true) ?: []);
            unset($r['snapshot'], $r['created_ids']);
        }
        return $rows;
    }

    /** Скасувати дію: повернути рядки «до», прибрати створені. Повертає кількість змінених позицій */
    public static function undo(int $id, ?int $tid): int
    {
        self::ensure();
        $h = Database::fetchOne('SELECT * FROM catalog_history WHERE id = ? AND tenant_id <=> ?', [$id, $tid]);
        if (!$h) throw new \RuntimeException('Дію не знайдено');
        if ($h['undone_at']) throw new \RuntimeException('Цю дію вже скасовано');
        $cols = array_column(Database::fetchAll('SHOW COLUMNS FROM material_profiles'), 'Field');
        $n = 0;
        foreach (json_decode($h['snapshot'] ?? '[]', true) ?: [] as $row) {
            $row = array_intersect_key($row, array_flip($cols));
            $mid = (int)($row['id'] ?? 0);
            if (!$mid) continue;
            if (Database::fetchOne('SELECT id FROM material_profiles WHERE id = ?', [$mid])) {
                $set = $row; unset($set['id']);
                Database::query('UPDATE material_profiles SET ' . implode(', ', array_map(function ($k) { return "`$k` = ?"; }, array_keys($set))) . ' WHERE id = ?',
                    array_merge(array_values($set), [$mid]));
            } else {
                Database::query('INSERT INTO material_profiles (`' . implode('`,`', array_keys($row)) . '`) VALUES (' . implode(',', array_fill(0, count($row), '?')) . ')', array_values($row));
            }
            $n++;
        }
        foreach (json_decode($h['created_ids'] ?? '[]', true) ?: [] as $mid) {
            $mid = (int)$mid;
            $used = (int)(Database::fetchOne('SELECT COUNT(*) c FROM slopes WHERE material_profile_id = ?', [$mid])['c'] ?? 0);
            if ($used) Database::query('UPDATE material_profiles SET deleted = 1, published = 0, is_active = 0 WHERE id = ?', [$mid]);
            else Database::query('DELETE FROM material_profiles WHERE id = ?', [$mid]);
            $n++;
        }
        Database::query('UPDATE catalog_history SET undone_at = NOW() WHERE id = ?', [$id]);
        return $n;
    }
}
