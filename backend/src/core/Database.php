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
    }
}
