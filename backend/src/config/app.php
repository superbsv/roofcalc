<?php
$envFile = __DIR__ . '/../../../.env';
if (!file_exists($envFile)) {
    $envFile = __DIR__ . '/../../.env';
}
if (!file_exists($envFile)) {
    $envFile = __DIR__ . '/../.env';
}
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
        list($key, $val) = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($val);
        putenv(trim($key) . '=' . trim($val));
    }
}

// Корінь сайту (там, де index.html, api/, src/, vendor/). Конфіг підключається кілька разів — константу задаємо один раз
if (!defined('APP_BASE')) {
    $base = realpath(__DIR__ . '/../..');
    define('APP_BASE', $base ?: __DIR__ . '/../..');
}

return [
    'db' => [
        'host'     => isset($_ENV['DB_HOST'])   ? $_ENV['DB_HOST']   : 'localhost',
        'port'     => (int)(isset($_ENV['DB_PORT'])   ? $_ENV['DB_PORT']   : 3306),
        'name'     => isset($_ENV['DB_NAME'])   ? $_ENV['DB_NAME']   : '',
        'user'     => isset($_ENV['DB_USER'])   ? $_ENV['DB_USER']   : '',
        'password' => isset($_ENV['DB_PASS'])   ? $_ENV['DB_PASS']   : '',
        'charset'  => 'utf8mb4',
    ],
    'jwt' => [
        'secret'        => isset($_ENV['JWT_SECRET'])    ? $_ENV['JWT_SECRET']    : 'CHANGE_ME',
        'algo'          => 'HS256',
        'expires_hours' => (int)(isset($_ENV['SESSION_HOURS']) ? $_ENV['SESSION_HOURS'] : 10),
    ],
    'app' => [
        'env'      => isset($_ENV['APP_ENV'])   ? $_ENV['APP_ENV']   : 'production',
        'debug'    => (isset($_ENV['APP_DEBUG']) ? $_ENV['APP_DEBUG'] : 'true') === 'true',
        'url'      => isset($_ENV['APP_URL'])   ? $_ENV['APP_URL']   : '',
        'timezone' => 'Europe/Kyiv',
    ],
    'cors' => [
        'allowed_origins' => array_values(array_filter([
            'https://roofkit.com.ua',
            'https://www.roofkit.com.ua',
            'https://artbudtrading.com.ua',
            isset($_ENV['DEV_ORIGIN']) ? $_ENV['DEV_ORIGIN'] : null,
        ])),
    ],
    'export' => [
        'path' => APP_BASE . '/storage/exports/',
        'logo' => APP_BASE . '/assets/logo.png',
    ],
    'upload' => [
        'path'     => APP_BASE . '/storage/uploads/',
        'max_size' => 5 * 1024 * 1024,
    ],
];
