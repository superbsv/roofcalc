<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/Database.php
// ============================================

namespace RoofCalc\Core;

use PDO;
use PDOException;

class Database
{
    private static ?PDO $instance = null;

    public static function connection(): PDO
    {
        if (self::$instance !== null) {
            return self::$instance;
        }

        $cfg = require __DIR__ . '/../config/app.php';
        $db  = $cfg['db'];

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $db['host'], $db['port'], $db['name'], $db['charset']
        );

        try {
            self::$instance = new PDO($dsn, $db['user'], $db['password'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4, time_zone='+03:00'",
            ]);
        } catch (PDOException $e) {
            http_response_code(503);
            echo json_encode(['error' => 'Помилка підключення до бази даних']);
            exit;
        }

        return self::$instance;
    }

    // Shortcut для підготовленого запиту
    public static function query(string $sql, array $params = []): \PDOStatement
    {
        $stmt = self::connection()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function fetchOne(string $sql, array $params = []): ?array
    {
        $row = self::query($sql, $params)->fetch();
        return $row ?: null;
    }

    public static function fetchAll(string $sql, array $params = []): array
    {
        return self::query($sql, $params)->fetchAll();
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::query($sql, $params);
        return (int) self::connection()->lastInsertId();
    }

    public static function lastId(): int
    {
        return (int) self::connection()->lastInsertId();
    }

    // SHOW COLUMNS не підтримує плейсхолдери (?) у справжніх prepared statements MySQL —
    // тому назву колонки підставляємо через PDO::quote
    private static function columnInfo(string $table, string $column): ?array
    {
        $row = self::connection()
            ->query("SHOW COLUMNS FROM `$table` LIKE " . self::connection()->quote($column))
            ->fetch(\PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    // Додає колонку, якщо її ще немає (легка самоміграція для shared-хостингу без CLI).
    // $table і $column — лише з коду, не від користувача.
    private static array $checkedColumns = [];
    public static function ensureColumn(string $table, string $column, string $definition): void
    {
        $key = $table . '.' . $column;
        if (isset(self::$checkedColumns[$key])) return;
        $exists = self::columnInfo($table, $column);
        if (!$exists) {
            self::connection()->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
        }
        self::$checkedColumns[$key] = true;
    }

    // Перетворює ENUM-колонку на VARCHAR, щоб можна було додавати нові значення (типи матеріалів)
    public static function ensureVarchar(string $table, string $column, int $len = 32): void
    {
        $key = $table . '.' . $column . ':varchar';
        if (isset(self::$checkedColumns[$key])) return;
        $col = self::columnInfo($table, $column);
        if ($col && stripos((string)($col['Type'] ?? ''), 'enum') === 0) {
            $null = (($col['Null'] ?? 'YES') === 'NO') ? 'NOT NULL' : 'NULL';
            self::connection()->exec("ALTER TABLE `$table` MODIFY `$column` VARCHAR($len) $null");
        }
        self::$checkedColumns[$key] = true;
    }

    // Схема для етапу 2 (режими матеріалів) — викликається з контролерів матеріалів і скатів
    public static function ensureMaterialSchema(): void
    {
        self::ensureVarchar('material_profiles', 'type', 32);
        self::ensureColumn('slopes', 'calc_mode', "VARCHAR(8) NOT NULL DEFAULT 'order'");
        // Етап 3 (КП 8.15): величина округлення і максимальна стандартна довжина
        self::ensureColumn('material_profiles', 'round_step', 'INT NULL');
        self::ensureColumn('material_profiles', 'max_std_length', 'INT NULL');
        // Лінія стику рядів на скаті (висота верхнього краю нижнього листа, мм); NULL — посередині
        self::ensureColumn('slopes', 'joint_y', 'INT NULL');
        self::ensureColumn('slopes', 'round_step', 'INT NULL');
        self::ensureColumn('slopes', 'layout_shift', 'INT NULL'); // зсув сітки колонок по горизонталі, мм
        self::ensureColumn('slopes', 'v_shift', 'INT NULL'); // зсув листів по вертикалі (↑/↓), мм
        self::ensureColumn('slopes', 'split_forced', 'TINYINT NULL'); // стик рядів навіть коли скат вкривається одним листом // округлення довжин для ската (NULL — з матеріалу)
    }

    // Реквізити замовлення і параметри проєкту як у КП (тип розрахунку, матеріал, К, ПК, валюта…)
    public static function ensureProjectSchema(): void
    {
        self::ensureColumn('projects', 'settings', 'TEXT NULL');
    }

    // ============================================
    // Кабінети (тенанти). Міграція одноразова й ідемпотентна:
    // усі наявні користувачі та проєкти переходять у внутрішній кабінет «ABT»,
    // наявні адміністратори стають супер-адмінами платформи. Колонка projects.tenant_id
    // додається останньою — її наявність означає, що міграцію завершено.
    // ============================================
    private static bool $tenantsReady = false;
    public static function ensureTenantSchema(): void
    {
        if (self::$tenantsReady) return;
        self::$tenantsReady = true;
        if (self::columnInfo('projects', 'tenant_id') && self::columnInfo('activity_log', 'tenant_id')) return;

        $db = self::connection();
        $db->exec("CREATE TABLE IF NOT EXISTS tenants (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            plan VARCHAR(32) NOT NULL DEFAULT 'trial',
            status VARCHAR(16) NOT NULL DEFAULT 'trial',
            is_internal TINYINT NOT NULL DEFAULT 0,
            trial_until DATE NULL,
            paid_until DATE NULL,
            max_users INT NULL,
            max_projects_month INT NULL,
            contact_name VARCHAR(150) NULL,
            contact_email VARCHAR(150) NULL,
            contact_phone VARCHAR(50) NULL,
            city VARCHAR(100) NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) DEFAULT CHARSET=utf8mb4");

        self::ensureColumn('users', 'tenant_id', 'INT NULL');
        self::ensureColumn('users', 'is_superadmin', 'TINYINT NOT NULL DEFAULT 0');
        self::ensureColumn('material_profiles', 'tenant_id', 'INT NULL');   // NULL — загальний каталог ABT

        $abt = self::fetchOne('SELECT id FROM tenants WHERE is_internal = 1 ORDER BY id LIMIT 1');
        $abtId = $abt ? (int)$abt['id'] : self::insert(
            "INSERT INTO tenants (name, plan, status, is_internal) VALUES ('ABT', 'internal', 'active', 1)"
        );
        self::query('UPDATE users SET tenant_id = ? WHERE tenant_id IS NULL', [$abtId]);
        $sa = self::fetchOne('SELECT COUNT(*) c FROM users WHERE is_superadmin = 1');
        if (!(int)$sa['c']) self::query("UPDATE users SET is_superadmin = 1 WHERE role = 'admin'");

        self::ensureColumn('activity_log', 'tenant_id', 'INT NULL');
        self::query('UPDATE activity_log a JOIN users u ON u.id = a.user_id SET a.tenant_id = u.tenant_id WHERE a.tenant_id IS NULL');

        if (!self::columnInfo('projects', 'tenant_id')) {
            $db->exec('ALTER TABLE projects ADD COLUMN tenant_id INT NULL');
            self::query('UPDATE projects p JOIN users u ON u.id = p.user_id SET p.tenant_id = u.tenant_id WHERE p.tenant_id IS NULL');
            self::query('UPDATE projects SET tenant_id = ? WHERE tenant_id IS NULL', [$abtId]);
            try { $db->exec('ALTER TABLE projects ADD INDEX idx_projects_tenant (tenant_id)'); } catch (\Throwable $e) {}
        }
    }

    // Етап 3–4: реквізити кабінету для документів, логотип, колір, нумерація замовлень
    private static bool $platformReady = false;
    public static function ensurePlatformSchema(): void
    {
        if (self::$platformReady) return;
        self::$platformReady = true;
        self::ensureTenantSchema();
        if (self::columnInfo('tenants', 'next_order_no')) return;
        self::ensureColumn('tenants', 'doc_company', 'VARCHAR(200) NULL');
        self::ensureColumn('tenants', 'doc_requisites', 'TEXT NULL');
        self::ensureColumn('tenants', 'doc_address', 'VARCHAR(255) NULL');
        self::ensureColumn('tenants', 'doc_phone', 'VARCHAR(80) NULL');
        self::ensureColumn('tenants', 'doc_email', 'VARCHAR(150) NULL');
        self::ensureColumn('tenants', 'doc_site', 'VARCHAR(150) NULL');
        self::ensureColumn('tenants', 'brand_color', 'VARCHAR(7) NULL');
        self::ensureColumn('tenants', 'logo', 'MEDIUMTEXT NULL');
        self::ensureColumn('tenants', 'signup_ip', 'VARCHAR(45) NULL');
        self::connection()->exec('ALTER TABLE tenants ADD COLUMN next_order_no INT NOT NULL DEFAULT 1');
        // нумерація продовжує наявні номери (раніше № замовлення = id проєкту)
        self::query('UPDATE tenants t SET next_order_no = COALESCE((SELECT MAX(p.id) FROM projects p WHERE p.tenant_id = t.id), 0) + 1');
    }
}
