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

    // Додає колонку, якщо її ще немає (легка самоміграція для shared-хостингу без CLI).
    // $table і $column — лише з коду, не від користувача.
    private static array $checkedColumns = [];
    public static function ensureColumn(string $table, string $column, string $definition): void
    {
        $key = $table . '.' . $column;
        if (isset(self::$checkedColumns[$key])) return;
        $exists = self::fetchOne("SHOW COLUMNS FROM `$table` LIKE ?", [$column]);
        if (!$exists) {
            self::connection()->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
        }
        self::$checkedColumns[$key] = true;
    }
}
