<?php
// ============================================
// ArtBudTrading Roof Calculator
// utils/set_admin_password.php
//
// Запуск: php utils/set_admin_password.php "НовийПароль123!"
// Або через браузер: /utils/set_admin_password.php?p=...&secret=...
// ============================================

define('BASE_PATH', dirname(__DIR__));
require_once BASE_PATH . '/vendor/autoload.php';

// Завантажуємо .env
if (file_exists(BASE_PATH . '/.env')) {
    $dotenv = \Dotenv\Dotenv::createImmutable(BASE_PATH);
    $dotenv->safeLoad();
}

use RoofCalc\Core\Database;
use RoofCalc\Core\Auth;

// Захист від випадкового відкриття у браузері
if (PHP_SAPI === 'cli') {
    $password = $argv[1] ?? null;
    $login    = $argv[2] ?? 'admin';
} else {
    // Через браузер — потрібен секретний ключ
    $secret   = getenv('SETUP_SECRET') ?: 'CHANGE_THIS_SECRET';
    if (($_GET['secret'] ?? '') !== $secret) {
        http_response_code(403);
        die('Доступ заборонено. Встановіть SETUP_SECRET в .env');
    }
    $password = $_GET['p'] ?? null;
    $login    = $_GET['login'] ?? 'admin';
}

if (!$password) {
    die("Використання:\n  php utils/set_admin_password.php \"НовийПароль123!\" [логін]\n");
}

if (strlen($password) < 8) {
    die("Помилка: пароль має бути мінімум 8 символів\n");
}

$hash = Auth::hashPassword($password);

$user = Database::fetchOne('SELECT id, name, role FROM users WHERE login = ?', [$login]);

if (!$user) {
    // Створюємо адміна якщо не існує
    Database::insert(
        'INSERT INTO users (name, email, login, password_hash, role, is_active) VALUES (?,?,?,?,?,?)',
        ['Адміністратор', 'admin@artbudtrading.com.ua', $login, $hash, 'admin', 1]
    );
    echo "✓ Створено адміністратора '{$login}' з новим паролем\n";
} else {
    Database::query('UPDATE users SET password_hash = ? WHERE login = ?', [$hash, $login]);
    echo "✓ Пароль для '{$login}' ({$user['name']}) оновлено\n";
}

echo "Тепер можете входити:\n";
echo "  Логін: {$login}\n";
echo "  Пароль: {$password}\n";
echo "\nВИДАЛІТЬ АБО ЗАБЛОКУЙТЕ ЦЕЙ ФАЙЛ ПІСЛЯ ВИКОРИСТАННЯ!\n";
