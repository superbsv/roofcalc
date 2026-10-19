<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/calculation/AccessoryCalc.php
//
// Розрахунок доборних елементів і кріплення
// ============================================

namespace RoofCalc\Core\Calculation;

use RoofCalc\Core\Database;
use RoofCalc\Core\Geometry\GeometryEngine;

class AccessoryCalc
{
    private array $slope;
    private array $polygon;
    private array $calcResult; // результат TileCalculator/ProfileCalculator
    private array $accessoryTypes; // з БД

    // Лінії ската (мм)
    private float $ridgeLength;    // конек
    private float $eaveLength;     // карниз
    private float $endLength;      // торці (бокові)
    private float $valleyLength;   // ендова (якщо є)
    private float $hipLength = 0.0;      // хребет (похиле ребро вальмового даху)
    private float $abutmentLength = 0.0; // примикання (стіни, труби, вирізи)
    private float $slopeAreaM2;

    public function __construct(array $slope, array $calcResult)
    {
        $this->slope      = $slope;
        $this->polygon    = $slope['polygon_points'];
        $this->calcResult = $calcResult;

        // Завантажуємо типи доборних з БД
        $this->accessoryTypes = Database::fetchAll(
            'SELECT * FROM accessory_types WHERE is_active = 1 ORDER BY id'
        );

        $this->analyzeSlope();
    }

    // ============================================
    // Аналіз ліній ската
    // ============================================
    private function analyzeSlope(): void
    {
        $bbox = GeometryEngine::boundingBox($this->polygon);
        $this->slopeAreaM2 = GeometryEngine::polygonAreaM2($this->polygon);

        // Вирізи: площа віднімається, периметр іде у примикання
        foreach ($this->slope['holes'] ?? [] as $hole) {
            if (!is_array($hole) || count($hole) < 3) continue;
            $this->slopeAreaM2    -= GeometryEngine::polygonAreaM2($hole);
            $this->abutmentLength += GeometryEngine::perimeter($hole) / 1000;
        }
        $this->slopeAreaM2 = max(0.0, $this->slopeAreaM2);

        // Якщо користувач задав тип кожного ребра — рахуємо точно по ребрах
        $edgeTypes = $this->slope['edge_types'] ?? [];
        $n = count($this->polygon);
        if (is_array($edgeTypes) && $n >= 3 && count($edgeTypes) === $n) {
            $sum = ['eave' => 0.0, 'ridge' => 0.0, 'hip' => 0.0, 'valley' => 0.0, 'end' => 0.0, 'abutment' => 0.0];
            for ($i = 0; $i < $n; $i++) {
                $t = $edgeTypes[$i];
                if (!isset($sum[$t])) continue; // 'none' — без доборних
                $sum[$t] += GeometryEngine::sideLength($this->polygon[$i], $this->polygon[($i + 1) % $n]);
            }
            $this->eaveLength      = $sum['eave'] / 1000;
            $this->ridgeLength     = $sum['ridge'] / 1000;
            $this->hipLength       = $sum['hip'] / 1000;
            $this->valleyLength    = $sum['valley'] / 1000;
            $this->endLength       = $sum['end'] / 1000;
            $this->abutmentLength += $sum['abutment'] / 1000;
            return;
        }

        // Знаходимо карнизну і коньову лінії по індексах
        $n        = count($this->polygon);
        $eaveIdx  = $this->slope['eave_side']  ?? null;
        $ridgeIdx = $this->slope['ridge_side'] ?? null;

        $sides = [];
        for ($i = 0; $i < $n; $i++) {
            $j       = ($i + 1) % $n;
            $sides[] = [
                'index'  => $i,
                'length' => GeometryEngine::sideLength($this->polygon[$i], $this->polygon[$j]),
            ];
        }

        // Якщо сторони не задані — визначаємо автоматично:
        // Карниз = нижня сторона (мінімальний Y)
        // Конек  = верхня сторона (максимальний Y)
        if ($eaveIdx === null) {
            // Нижня горизонтальна сторона
            $minY = $bbox['minY'];
            foreach ($sides as $s) {
                $i = $s['index'];
                $j = ($i + 1) % $n;
                if ($this->polygon[$i][1] === $minY && $this->polygon[$j][1] === $minY) {
                    $eaveIdx = $i;
                    break;
                }
            }
            $eaveIdx = $eaveIdx ?? 0;
        }

        if ($ridgeIdx === null) {
            $maxY = $bbox['maxY'];
            foreach ($sides as $s) {
                $i = $s['index'];
                $j = ($i + 1) % $n;
                if ($this->polygon[$i][1] === $maxY && $this->polygon[$j][1] === $maxY) {
                    $ridgeIdx = $i;
                    break;
                }
            }
        }

        // Довжини ліній (мм → м)
        $this->eaveLength  = isset($eaveIdx) ? $sides[$eaveIdx]['length'] / 1000 : $bbox['width'] / 1000;
        $this->ridgeLength = isset($ridgeIdx) ? $sides[$ridgeIdx]['length'] / 1000 : $bbox['width'] / 1000;

        // Торці = всі сторони крім карнизу і конька
        $endLen = 0;
        foreach ($sides as $s) {
            if ($s['index'] === $eaveIdx || $s['index'] === $ridgeIdx) continue;
            $endLen += $s['length'];
        }
        $this->endLength    = $endLen / 1000;
        $this->valleyLength = 0; // ендова задається окремо при складній крівлі
    }

    // ============================================
    // ГОЛОВНИЙ МЕТОД
    // ============================================
    public function calculate(): array
    {
        $items = [];

        foreach ($this->accessoryTypes as $type) {
            // Визначаємо чи потрібен цей тип для даного ската
            $qty = $this->calcQuantity($type);
            if ($qty <= 0) continue;

            $items[] = [
                'code'            => $type['code'],
                'name'            => $type['name_uk'],
                'unit'            => $type['unit'],
                'quantity'        => $qty,
                'working_length'  => $type['working_length'],
                'price'           => $type['price'],
                'total'           => round($qty * $type['price'], 2),
                'calc_rule'       => $type['calc_rule'],
            ];
        }

        // Основне кріплення для листів
        $screws = $this->calcSheetScrews();
        if ($screws) $items[] = $screws;

        return [
            'items'        => $items,
            'eave_length_m'  => round($this->eaveLength, 2),
            'ridge_length_m' => round($this->ridgeLength, 2),
            'end_length_m'   => round($this->endLength, 2),
            'valley_length_m'=> round($this->valleyLength, 2),
            'hip_length_m'     => round($this->hipLength, 2),
            'abutment_length_m'=> round($this->abutmentLength, 2),
            'edges_by_type'    => !empty($this->slope['edge_types']) && count($this->slope['edge_types']) === count($this->polygon),
            'slope_area_m2'  => round($this->slopeAreaM2, 3),
        ];
    }

    // ============================================
    // Розрахунок кількості по правилу
    // ============================================
    private function calcQuantity(array $type): float
    {
        $workingM  = $type['working_length'] / 1000; // мм → м
        $overlap   = $type['default_overlap'] / 1000;
        $effective = max(0.001, $workingM - $overlap);

        switch ($type['calc_rule']) {
            case 'ridge':
                // Напівкруглий/фігурний конек ставиться і на хребти, якщо окремого типу 'hip' немає
                return $this->calcLinear($this->ridgeLength + ($this->hasRule('hip') ? 0 : $this->hipLength), $effective);

            case 'hip':
                return $this->calcLinear($this->hipLength, $effective);

            case 'abutment':
                return $this->calcLinear($this->abutmentLength, $effective);

            case 'eave':
                return $this->calcLinear($this->eaveLength, $effective);

            case 'end':
                return $this->calcLinear($this->endLength, $effective);

            case 'valley':
                if ($this->valleyLength <= 0) return 0;
                return $this->calcLinear($this->valleyLength, $effective);

            case 'perimeter':
                $total = $this->eaveLength + $this->ridgeLength + $this->endLength + $this->hipLength;
                return $this->calcLinear($total, $effective);

            case 'area':
                // Для прохідок — 1 шт на X м²
                if ($type['unit'] === 'шт') return 0; // задається вручну
                return 0;

            default:
                return 0;
        }
    }

    private function hasRule(string $rule): bool
    {
        foreach ($this->accessoryTypes as $t) {
            if (($t['calc_rule'] ?? '') === $rule) return true;
        }
        return false;
    }

    // Кількість планок (округлення вгору)
    private function calcLinear(float $totalM, float $effectiveM): float
    {
        if ($totalM <= 0 || $effectiveM <= 0) return 0;
        return (float)ceil($totalM / $effectiveM);
    }

    // ============================================
    // Кріплення для листів
    // ============================================
    private function calcSheetScrews(): ?array
    {
        $totalSheets = $this->calcResult['total_sheets'] ?? 0;
        if ($totalSheets <= 0) return null;

        // Норма: 7–8 саморізів на лист металочерепиці / профнастилу
        $norm    = 7;
        $total   = (int)ceil($totalSheets * $norm);
        $reserve = (int)ceil($total * 1.05);

        return [
            'code'     => 'screw_4x35',
            'name'     => 'Саморіз 4.8×35 (для покриття)',
            'unit'     => 'шт',
            'quantity' => $reserve,
            'price'    => 2.50,
            'total'    => round($reserve * 2.50, 2),
            'calc_rule'=> 'area',
            'note'     => "{$norm} шт/лист × {$totalSheets} листів + 5% запас",
        ];
    }
}
