<?php
// Автотести технологічного розкрою металочерепиці (ТЗ «технологічно коректний розкрій», розділ 11).
// Запуск: php backend/tests/run.php   (без БД і без сторонніх бібліотек)
declare(strict_types=1);

require_once __DIR__ . '/../src/core/geometry/GeometryEngine.php';
require_once __DIR__ . '/../src/core/calculation/SheetLayoutEngine.php';

use RoofCalc\Core\Calculation\MetalTileProfile as P;
use RoofCalc\Core\Calculation\SheetLayoutEngine as E;

$fail = 0; $n = 0;
function ok(bool $c, string $name) { global $fail, $n; $n++; if ($c) echo "  ✓ $name\n"; else { $fail++; echo "  ✗ $name\n"; } }
function eq($a, $b, string $name) { ok($a === $b, $name . ($a === $b ? '' : ' — отримано ' . json_encode($a) . ', очікувалось ' . json_encode($b))); }

// Профіль за правилом користувача: крок 350, ±50 мм від штампа різати не можна → зона 50…300
$p = new P(['moduleStepMm' => 350, 'moduleOriginMm' => 0, 'stampGapMm' => 50, 'minLengthMm' => 400, 'maxLengthMm' => 8000, 'lengthIncrementMm' => 10]);

echo "Модуль і залишок\n";
eq(P::positiveModulo(-10, 350), 340, 'positiveModulo(-10) = 340 (не −10)');
eq(P::positiveModulo(700, 350), 0, 'positiveModulo(700) = 0');
eq($p->cutZonesMm, [[50, 300]], 'зона різу 50…300 з правила ±50');

echo "Різ у зоні / на межі / поза зоною\n";
ok($p->isValid(2190), '2190 (r=90) — усередині зони');
ok($p->isValid(1450) && $p->isValid(1700), '1450 (r=50) і 1700 (r=300) — рівно на межах, допустимо');
ok(!$p->isValid(1440), '1440 (r=40) — поза зоною');
ok(!$p->isValid(1710), '1710 (r=310) — поза зоною');
$v = $p->validateFactoryLength(1440);
eq($v['errorCodes'], [P::ERR_STAMP_ZONE], 'код помилки STAMP_ZONE');
eq([$v['nearestValidShorterMm'], $v['nearestValidLongerMm']], [1350, 1450], 'найближчі допустимі: 1350 / 1450 (1400 — рівно на штампі)');

echo "Допуск різу звужує зону\n";
$pt = new P(['moduleStepMm' => 350, 'stampGapMm' => 50, 'cuttingToleranceMm' => 5, 'minLengthMm' => 400, 'maxLengthMm' => 8000]);
ok(!$pt->isValid(1450) && $pt->isValid(1455), 'з допуском 5 мм: 1450 ні, 1455 так');

echo "Кілька зон у модулі\n";
$pm = new P(['moduleStepMm' => 350, 'cutZonesMm' => [[60, 120], [200, 280]], 'minLengthMm' => 400, 'maxLengthMm' => 8000]);
ok($pm->isValid(1460) && $pm->isValid(1600), '1460 (r=60) і 1600 (r=200) — у різних зонах');
ok(!$pm->isValid(1550), '1550 (r=150) — між зонами, недопустимо');
eq($pm->ceilValid(1550), 1600, 'ceil(1550) → 1600 (початок наступної зони)');

echo "Мінімальна / максимальна довжина, дискретність\n";
eq($p->validateFactoryLength(395)['errorCodes'], [P::ERR_TOO_SHORT, P::ERR_INCREMENT, P::ERR_STAMP_ZONE], '395 — коротко, не кратно 10, біля штампа');
eq($p->validateFactoryLength(8100)['errorCodes'], [P::ERR_TOO_LONG], '8100 — лише довше максимальної');
$px = new P(['moduleStepMm' => 350, 'stampGapMm' => 50, 'minLengthMm' => 400, 'maxLengthMm' => 7740, 'lengthIncrementMm' => 10]);
eq($px->ceilValid(7710), null, 'Lmax 7740: допустимої ≥ 7710 немає (7750 > Lmax) → null');
eq($p->ceilValid(100), 400, 'ceil(100) → Lmin 400 (r=50)');
$f = $p->findValidFactoryLengths(2490);
eq([$f['factoryLengthMm'], $f['trimMm']], [2500, 10], 'потрібно 2490 → заводська 2500, підрізка 10');
ok($f['factoryLengthMm'] >= 2490, 'заводська довжина не коротша за потрібну');

echo "Приклад ската 7000×4000 (довжини з ТЗ)\n";
foreach ([2490 => false, 2190 => true, 1630 => true, 1550 => true, 1090 => false, 700 => false] as $L => $exp) {
    $v = $p->validateFactoryLength($L);
    ok($v['valid'] === $exp, sprintf('%d: r=%d — %s; найближчі %s / %s', $L, $v['modulePositionMm'], $exp ? 'допустимо' : 'недопустимо',
        $v['nearestValidShorterMm'] ?? '—', $v['nearestValidLongerMm'] ?? '—'));
}

// ---------- Движок укладки з технологічним рівнем ----------
$mat = ['type' => 'tile', 'name' => 'Модерн', 'full_width' => 1180, 'useful_width' => 1100, 'length_overlap' => 150,
        'wave_step' => 350, 'min_length' => 400, 'max_length' => 3000, 'round_step' => 10, 'stamp_gap' => 50];
$poly = [[0, 0], [7000, 0], [3000, 4000], [0, 4000]];   // фронтон 4, конек 3, хребет 5.657, карниз 7 м
$calc = function (array $slopeExtra = [], array $matExtra = []) use ($mat, $poly) {
    $s = array_merge(['polygon_points' => $poly, 'holes' => [], 'eave_overhang' => 50, 'ridge_gap' => 0, 'laying_direction' => 'right_left'], $slopeExtra);
    return (new E(array_merge($mat, $matExtra), $s))->calculate();
};
// Покриття без зазорів: у кожній колонці низ першого листа ≤ низу колонки, кожен наступний починається не вище
// кінця попереднього, верх останнього ≥ верху ската в колонці.
$covered = function (array $r) use ($poly) {
    $by = [];
    foreach ($r['placements'] as $q) $by[$q['col_index']][] = $q;
    foreach ($by as $col => $ps) {
        usort($ps, function ($a, $b) { return $a['y'] <=> $b['y']; });
        $x0 = max(0, $ps[0]['x']); $x1 = min(7000, $ps[0]['x'] + 1100);
        $top = 0; for ($x = $x0; $x <= $x1; $x += 10) $top = max($top, $x <= 3000 ? 4000 : (int)floor(4000 * (7000 - $x) / 4000));
        if ($ps[0]['y'] > -50) return "колонка $col: низ {$ps[0]['y']} вище карниза";
        for ($i = 1; $i < count($ps); $i++) if ($ps[$i]['y'] > $ps[$i - 1]['y'] + $ps[$i - 1]['length']) return "колонка $col: зазор між рядами";
        $end = end($ps); if ($end['y'] + $end['length'] < $top) return "колонка $col: верх " . ($end['y'] + $end['length']) . " < $top";
    }
    return null;
};

echo "Діагональний скат, Snap увімкнено\n";
$r = $calc();
ok(!empty($r['tech_ok']), 'усі заводські заготовки проходять перевірку');
$bad = array_filter($r['placements'], function ($q) { return !empty($q['tech_err']); });
eq(count($bad), 0, 'немає листів з технологічною помилкою');
eq($covered($r), null, 'скат покритий без зазорів');
ok($r['joint_y_mm'] !== null, 'скат довший за лист — є лінія стику (горизонтальний нахлест рядів)');

echo "Snap вимкнено — помилки показуються, довжини не підганяються\n";
$off = $calc(['snap_off' => 1, 'joint_y' => 2060]);
$on  = $calc(['joint_y' => 2060]);
ok(!empty($on['tech_ok']), 'Snap увімкнено: лінія 2.060 — верхні листи подовжено до допустимих');
ok(empty($off['tech_ok']) && count($off['tech_errors']) > 0, 'Snap вимкнено: є технологічні помилки з причиною');
ok(strpos($off['tech_errors'][0] ?? '', 'від лінії штампа') !== false, 'причина: «рез за N мм від лінії штампа»');
eq($covered($off), null, 'без Snap геометрія та сама — покриття без зазорів');

echo "Переміщення лінії стику в обидва боки, сусідні листи\n";
foreach ([1800, 1950, 2400, 2600] as $j) {
    $q = $calc(['joint_y' => $j]);
    ok(!empty($q['tech_ok']) && $covered($q) === null, "лінія {$j}: усі листи допустимі, покриття без зазорів");
}
$allOk = true; $cnt = 0;
foreach ([[], ['laying_direction' => 'left_right'], ['layout_shift' => 370], ['v_shift' => 120]] as $ex) {
    for ($j = 1500; $j <= 2900; $j += 10) { $q = $calc(array_merge($ex, ['joint_y' => $j])); $cnt++; if (empty($q['tech_ok']) || $covered($q) !== null) { $allOk = false; echo "    збій: " . json_encode($ex) . " лінія $j\n"; break 2; } }
}
ok($allOk, "перебір {$cnt} положень лінії (крок 10 мм, напрямок, зсуви): усі листи допустимі, без зазорів");
$a = $calc(['joint_y' => 2000]); $b = $calc(['joint_y' => 2300]);
ok(json_encode(array_column($a['placements'], 'length')) !== json_encode(array_column($b['placements'], 'length')), 'зсув лінії перераховує довжини сусідніх листів');

echo "Відсутність числового дрейфу (багаторазове перетягування туди-назад)\n";
$ref = json_encode(array_column($calc(['joint_y' => 2190])['placements'], 'length'));
$same = true;
for ($i = 0; $i < 20; $i++) { $calc(['joint_y' => 2190 + ($i % 2 ? 37 : -53)]); if (json_encode(array_column($calc(['joint_y' => 2190])['placements'], 'length')) !== $ref) $same = false; }
ok($same, 'після 20 переміщень і повернення — ті самі довжини (відновлення стану після відміни)');

echo "Правило вимкнено в картці (0) — розрахунок як раніше\n";
$plain = $calc(['joint_y' => 2190], ['stamp_gap' => 0]);
ok(!isset($plain['tech']), 'без правила штампа результат без технологічного блоку');

echo "Немає допустимого рішення\n";
$tight = $calc([], ['max_length' => 440, 'min_length' => 400]);   // допустимі лише 400…440 (r 50…90)
ok(isset($tight['tech_ok']), 'розрахунок не падає');

echo "\n" . ($fail ? "ПРОВАЛЕНО: $fail з $n\n" : "Усі тести пройдено: $n\n");
exit($fail ? 1 : 0);
