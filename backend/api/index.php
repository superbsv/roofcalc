<?php
if (function_exists('opcache_reset')) opcache_reset();
// api/index.php — ADM.TOOLS версія
// Розташування: calculator/api/index.php
// PHP шукає src/ і vendor/ на рівень вище: calculator/

define('BASE_PATH', dirname(__DIR__));
define('SRC_PATH',  BASE_PATH . '/src');

$autoload = BASE_PATH . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    http_response_code(503);
    die(json_encode(['error' => 'Виконайте composer install у папці calculator/']));
}
require_once $autoload;

spl_autoload_register(function (string $class) {
    $prefix = 'RoofCalc\\';
    if (!str_starts_with($class, $prefix)) return;
    $file = SRC_PATH . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (file_exists($file)) require_once $file;
});

use RoofCalc\Core\Auth;
use RoofCalc\Api\Auth\AuthController;
use RoofCalc\Api\Projects\ProjectsController;
use RoofCalc\Api\Slopes\SlopesController;
use RoofCalc\Api\Materials\MaterialsController;
use RoofCalc\Api\Specification\SpecController;
use RoofCalc\Api\Export\ExportController;
use RoofCalc\Api\Admin\AdminController;

date_default_timezone_set('Europe/Kiev');

$cfg    = require SRC_PATH . '/config/app.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $cfg['cors']['allowed_origins'], true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri    = preg_replace('#^/[^/]+/api#', '', $uri) ?: '/';

try {
    if (mt_rand(1,100)===1) Auth::cleanExpiredSessions();

    switch (true) {
        case $method==='POST'&&$uri==='/auth/login':           (new AuthController)->login(); break;
        case $method==='POST'&&$uri==='/auth/logout':          (new AuthController)->logout(); break;
        case $method==='GET' &&$uri==='/auth/me':              (new AuthController)->me(); break;
        case $method==='POST'&&$uri==='/auth/change-password': (new AuthController)->changePassword(); break;
        case $method==='GET' &&$uri==='/projects':             (new ProjectsController)->index(); break;
        case $method==='POST'&&$uri==='/projects':             (new ProjectsController)->create(); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)$#',$uri,$m): (new ProjectsController)->show((int)$m[1]); break;
        case $method==='PUT' &&preg_match('#^/projects/(\d+)$#',$uri,$m): (new ProjectsController)->update((int)$m[1]); break;
        case $method==='DELETE'&&preg_match('#^/projects/(\d+)$#',$uri,$m): (new ProjectsController)->delete((int)$m[1]); break;
        case $method==='POST'&&preg_match('#^/projects/(\d+)/calculate-all$#',$uri,$m): (new ProjectsController)->calculateAll((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/share/([a-zA-Z0-9_-]+)$#',$uri,$m): (new ProjectsController)->share($m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/slopes$#',$uri,$m): (new SlopesController)->index((int)$m[1]); break;
        case $method==='POST'&&preg_match('#^/projects/(\d+)/slopes$#',$uri,$m): (new SlopesController)->create((int)$m[1]); break;
        case $method==='PUT' &&preg_match('#^/slopes/(\d+)$#',$uri,$m): (new SlopesController)->update((int)$m[1]); break;
        case $method==='DELETE'&&preg_match('#^/slopes/(\d+)$#',$uri,$m): (new SlopesController)->delete((int)$m[1]); break;
        case $method==='POST'&&preg_match('#^/slopes/(\d+)/calculate$#',$uri,$m): (new SlopesController)->calculate((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/slopes/(\d+)/layout$#',$uri,$m): (new SlopesController)->layout((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/specification$#',$uri,$m): (new SpecController)->index((int)$m[1]); break;
        case $method==='GET' &&$uri==='/materials':            (new MaterialsController)->index(); break;
        case $method==='GET' &&preg_match('#^/materials/(tile|profile|falts)$#',$uri,$m): (new MaterialsController)->byType($m[1]); break;
        case $method==='GET' &&preg_match('#^/materials/(\d+)$#',$uri,$m): (new MaterialsController)->show((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/export/pdf$#',$uri,$m): (new ExportController)->pdf((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/export/excel$#',$uri,$m): (new ExportController)->excel((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/export/production-pdf$#',$uri,$m): (new ExportController)->productionPdf((int)$m[1]); break;
        case $method==='GET' &&preg_match('#^/projects/(\d+)/export/json$#',$uri,$m): (new ExportController)->projectJson((int)$m[1]); break;
        case $method==='GET' &&$uri==='/admin/users':          (new AdminController)->users(); break;
        case $method==='POST'&&$uri==='/admin/users':          (new AdminController)->createUser(); break;
        case $method==='PUT' &&preg_match('#^/admin/users/(\d+)$#',$uri,$m): (new AdminController)->updateUser((int)$m[1]); break;
        case $method==='GET' &&$uri==='/admin/logs':           (new AdminController)->logs(); break;
        case $method==='GET' &&$uri==='/admin/materials':      (new AdminController)->materials(); break;
        case $method==='POST'&&$uri==='/admin/materials':      (new AdminController)->createMaterial(); break;
        case $method==='PUT' &&preg_match('#^/admin/materials/(\d+)$#',$uri,$m): (new AdminController)->updateMaterial((int)$m[1]); break;
        case $method==='GET' &&$uri==='/admin/settings':       (new AdminController)->settings(); break;
        case $method==='PUT' &&$uri==='/admin/settings':       (new AdminController)->updateSettings(); break;
       case $uri==='/debug-calc':
    $slope_id = (int)($_GET['id'] ?? 0);
    $pdo = new PDO(
        'mysql:host=' . $cfg['db']['host'] . ';dbname=' . $cfg['db']['name'] . ';charset=utf8mb4',
        $cfg['db']['user'],
        $cfg['db']['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $stmt = $pdo->prepare("SELECT polygon_points FROM slopes WHERE id=?");
    $stmt->execute([$slope_id]);
    $slope = $stmt->fetch(PDO::FETCH_ASSOC);
    $pts = json_decode($slope['polygon_points'], true);
    $results = ['points' => $pts, 'heights' => []];
    for ($x = 0; $x <= 6000; $x += 575) {
        $ys = [];
        $n = count($pts);
        for ($i = 0; $i < $n; $i++) {
            $p1 = $pts[$i]; $p2 = $pts[($i+1)%$n];
            $x1=(int)$p1[0]; $y1=(int)$p1[1]; $x2=(int)$p2[0]; $y2=(int)$p2[1];
            if ($x1===$x2) { if(abs($x1-$x)<2){$ys[]=$y1;$ys[]=$y2;} continue; }
            if ($x>=min($x1,$x2)&&$x<=max($x1,$x2)) {
                $t=(float)($x-$x1)/(float)($x2-$x1); $ys[]=(int)round($y1+$t*($y2-$y1));
            }
        }
        $results['heights']["x=$x"] = ['ys'=>$ys, 'height'=>count($ys)>=2?max($ys)-min($ys):0];
    }
    echo json_encode($results);
    break;
        case $uri==='/ping':
            echo json_encode(['status'=>'ok','php'=>PHP_VERSION,'time'=>date('c')]); break;
        default:
            http_response_code(404);
            echo json_encode(['error'=>'Не знайдено: '.$method.' '.$uri], JSON_UNESCAPED_UNICODE);
    }
} catch (\Throwable $e) {
    http_response_code(500);
    $debug = $cfg['app']['debug'] ?? false;
    echo json_encode([
        'error'  => 'Внутрішня помилка сервера',
        'detail' => $debug ? $e->getMessage() : null,
        'trace'  => $debug ? substr($e->getTraceAsString(),0,500) : null,
    ], JSON_UNESCAPED_UNICODE);
}
