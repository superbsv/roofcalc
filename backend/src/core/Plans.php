<?php
// ============================================
// ABT Покрівля — core/Plans.php
// Тарифи платформи: назва, ціна, ліміти, перелік можливостей.
// Зберігаються в app_settings (key_name = 'platform_plans', JSON) — супер-адмін змінює їх у панелі.
// PHP 7.4.
// ============================================

namespace RoofCalc\Core;

class Plans
{
    // null у лімітах — без обмеження
    public const DEFAULTS = [
        'trial' => ['name' => 'Пробний', 'price' => 0, 'users' => 2, 'projects_month' => 20, 'days' => 14, 'public' => false,
                    'features' => ['Усі можливості калькулятора', 'До 2 користувачів', 'До 20 розрахунків']],
        'start' => ['name' => 'Старт', 'price' => 490, 'price_year' => 4900, 'users' => 1, 'projects_month' => 30, 'public' => true,
                    'features' => ['1 користувач', '30 розрахунків на місяць', 'Каталог ROOFKIT', 'PDF-специфікація']],
        'pro' => ['name' => 'Профі', 'price' => 1290, 'price_year' => 12900, 'users' => 5, 'projects_month' => null, 'public' => true, 'popular' => true,
                    'features' => ['До 5 користувачів', 'Без ліміту розрахунків', 'Власні матеріали', 'Логотип і реквізити в PDF', 'Excel і карта розкрою']],
        'business' => ['name' => 'Бізнес', 'price' => 2990, 'price_from' => true, 'users' => null, 'projects_month' => null, 'public' => true,
                    'features' => ['Без ліміту користувачів', 'Без ліміту розрахунків', 'Пріоритетна підтримка', 'Індивідуальні налаштування']],
        'custom' => ['name' => 'Індивідуальний', 'price' => 0, 'users' => null, 'projects_month' => null, 'public' => false, 'features' => []],
        'internal' => ['name' => 'Внутрішній', 'price' => 0, 'users' => null, 'projects_month' => null, 'public' => false, 'features' => []],
    ];

    private static ?array $cache = null;

    public static function all(): array
    {
        if (self::$cache !== null) return self::$cache;
        $plans = self::DEFAULTS;
        try {
            $row = Database::fetchOne("SELECT value FROM app_settings WHERE key_name = 'platform_plans'");
            $saved = $row ? json_decode((string)$row['value'], true) : null;
            if (is_array($saved)) {
                foreach ($saved as $k => $p) {
                    if (isset($plans[$k]) && is_array($p)) $plans[$k] = array_merge($plans[$k], self::clean($p));
                }
            }
            // Разово (2026-10): ціни тарифів, погоджені власником (далі змінюються в панелі «Тарифи»)
            $mark = Database::fetchOne("SELECT key_name FROM app_settings WHERE key_name = 'platform_plans_prices_v2'");
            if (!$mark) {
                foreach (['start', 'pro', 'business'] as $k) {
                    $plans[$k]['price'] = self::DEFAULTS[$k]['price'];
                    foreach (['price_year', 'price_from'] as $f) {
                        if (!isset($plans[$k][$f]) && isset(self::DEFAULTS[$k][$f])) $plans[$k][$f] = self::DEFAULTS[$k][$f];
                    }
                }
                if (is_array($saved)) {
                    $json = json_encode($plans, JSON_UNESCAPED_UNICODE);
                    Database::query("UPDATE app_settings SET value = ?, updated_at = NOW() WHERE key_name = 'platform_plans'", [$json]);
                }
                Database::query("INSERT INTO app_settings (key_name, value, type, description, updated_at) VALUES ('platform_plans_prices_v2', '1', 'string', 'Ціни тарифів 2026-10 застосовано', NOW())");
            }
        } catch (\Throwable $e) {}
        // назва каталогу в описах тарифів (раніше — «Каталог матеріалів ABT»)
        foreach ($plans as &$pl) {
            if (!empty($pl['features'])) $pl['features'] = array_map(function ($f) { return $f === 'Каталог матеріалів ABT' ? 'Каталог ROOFKIT' : $f; }, $pl['features']);
        }
        unset($pl);
        return self::$cache = $plans;
    }

    public static function get(string $key): array
    {
        $all = self::all();
        return $all[$key] ?? $all['custom'];
    }

    public static function names(): array
    {
        $out = [];
        foreach (self::all() as $k => $p) $out[$k] = $p['name'];
        return $out;
    }

    public static function save(array $plans): array
    {
        $cur = self::all();
        foreach ($plans as $k => $p) {
            if (isset($cur[$k]) && is_array($p)) $cur[$k] = array_merge($cur[$k], self::clean($p));
        }
        $json = json_encode($cur, JSON_UNESCAPED_UNICODE);
        $exists = Database::fetchOne("SELECT key_name FROM app_settings WHERE key_name = 'platform_plans'");
        if ($exists) Database::query("UPDATE app_settings SET value = ?, updated_at = NOW() WHERE key_name = 'platform_plans'", [$json]);
        else Database::query("INSERT INTO app_settings (key_name, value, type, description, updated_at) VALUES ('platform_plans', ?, 'json', 'Тарифи платформи', NOW())", [$json]);
        self::$cache = null;
        return self::all();
    }

    // Фактичні ліміти кабінету: індивідуальні значення кабінету важливіші за тарифні
    public static function limits(array $t): array
    {
        if ((int)($t['is_internal'] ?? 0) === 1) return ['users' => null, 'projects_month' => null];
        $p = self::get((string)($t['plan'] ?? 'custom'));
        return [
            'users'          => !empty($t['max_users']) ? (int)$t['max_users'] : ($p['users'] ?? null),
            'projects_month' => !empty($t['max_projects_month']) ? (int)$t['max_projects_month'] : ($p['projects_month'] ?? null),
        ];
    }

    private static function clean(array $p): array
    {
        $o = [];
        if (isset($p['name']) && trim((string)$p['name']) !== '') $o['name'] = mb_substr(trim((string)$p['name']), 0, 40);
        if (array_key_exists('price', $p)) $o['price'] = max(0, (float)$p['price']);
        if (array_key_exists('price_year', $p)) $o['price_year'] = ($p['price_year'] === null || $p['price_year'] === '') ? null : max(0, (float)$p['price_year']);
        foreach (['users', 'projects_month', 'days'] as $f) {
            if (array_key_exists($f, $p)) $o[$f] = ($p[$f] === null || $p[$f] === '' || (int)$p[$f] <= 0) ? null : (int)$p[$f];
        }
        foreach (['public', 'popular', 'price_from'] as $f) if (array_key_exists($f, $p)) $o[$f] = (bool)$p[$f];
        if (isset($p['features']) && is_array($p['features'])) {
            $o['features'] = array_values(array_filter(array_map(function ($x) { return mb_substr(trim((string)$x), 0, 80); }, $p['features']), 'strlen'));
        }
        return $o;
    }
}
