<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/calculation/ProfileCalculator.php
//
// Розрахунок профнастилу
// Всі розміри в мм
// ============================================

namespace RoofCalc\Core\Calculation;

use RoofCalc\Core\Geometry\GeometryEngine;

class ProfileCalculator
{
    private array $profile;
    private array $slope;
    private array $polygon;

    private int $fullWidth;
    private int $usefulWidth;
    private int $sideOverlap;
    private int $lengthOverlap;
    private int $minLength;
    private int $maxLength;
    private float $minSlopeAngle;

    private int $eaveOverhang;
    private int $ridgeGap;
    private string $layingDirection;

    public function __construct(array $profile, array $slope)
    {
        $this->profile  = $profile;
        $this->slope    = $slope;
        $this->polygon  = $slope['polygon_points'];

        $this->fullWidth      = (int)$profile['full_width'];
        $this->usefulWidth    = (int)$profile['useful_width'];
        $this->sideOverlap    = (int)$profile['side_overlap'];
        $this->lengthOverlap  = (int)$profile['length_overlap'];
        $this->minLength      = (int)$profile['min_length'];
        $this->maxLength      = (int)$profile['max_length'];
        $this->minSlopeAngle  = (float)($profile['min_slope_angle'] ?? 0);

        $this->eaveOverhang    = (int)$slope['eave_overhang'];
        $this->ridgeGap        = (int)$slope['ridge_gap'];
        $this->layingDirection = $slope['laying_direction'] ?? 'right_left';
    }

    public function calculate(): array
    {
        $errors   = [];
        $warnings = [];

        // Перевірка геометрії
        $geoErrors = GeometryEngine::validate($this->polygon);
        if (!empty($geoErrors)) return ['errors' => $geoErrors];

        // Перевірка кута нахилу
        $slopeAngle = (float)($this->slope['slope_angle'] ?? 0);
        if ($slopeAngle < $this->minSlopeAngle) {
            $warnings[] = sprintf(
                'Кут нахилу %.1f° менше мінімального для цього профілю (%.1f°)',
                $slopeAngle, $this->minSlopeAngle
            );
        }

        $bbox        = GeometryEngine::boundingBox($this->polygon);
        $slopeWidth  = $bbox['width'];
        $slopeHeight = $bbox['height'];

        // Кількість листів по ширині (по КОРИСНІЙ ширині)
        $colsCount = (int)ceil($slopeWidth / $this->usefulWidth);

        // Довжина листа
        $rawLength    = $slopeHeight + $this->eaveOverhang + $this->ridgeGap;
        $sheetLength  = max($this->minLength, min($rawLength, $this->maxLength));
        $rowsCount    = 1;

        if ($rawLength > $this->maxLength) {
            $rowsCount   = (int)ceil($rawLength / ($this->maxLength - $this->lengthOverlap));
            // Рівномірний розподіл — ділимо приблизно порівну
            $sheetLength = (int)ceil($rawLength / $rowsCount);
            $sheetLength = min($sheetLength, $this->maxLength);
            $sheetLength = max($sheetLength, $this->minLength);
            $warnings[]  = "Довжина ската перевищує максимальну — буде {$rowsCount} рядів з нахлестом {$this->lengthOverlap} мм";
        }
        // Розкладка
        $placements    = $this->buildPlacements($bbox, $colsCount, $rowsCount, $sheetLength);
        $usedSheets    = [];
        $partialSheets = [];
        $totalFullArea = 0.0;
        $totalUsedArea = 0.0;

        foreach ($placements as &$pl) {
           $plLength = (int)$pl['length'];
            $intersect = GeometryEngine::rectPolygonIntersectionArea(
                (int)$pl['x'], (int)$pl['y'],
                $this->usefulWidth, $plLength,
                $this->polygon
            );
            $pl['intersect_area_m2'] = round($intersect / 1_000_000, 4);

            $fullArea = $this->fullWidth * $plLength;
            $pl['full_area_m2']  = round($fullArea / 1_000_000, 4);
            $pl['waste_area_m2'] = round(($fullArea - $intersect) / 1_000_000, 4);

            if ($intersect > 0) {
                $pct = $intersect / ($this->usefulWidth * $sheetLength);
                if ($pct > 0.5) $usedSheets[] = $pl;
                else $partialSheets[] = $pl;
                $totalFullArea += $fullArea;
                $totalUsedArea += $intersect;
            }
        }

        $totalSheets = count($usedSheets) + count($partialSheets);
        $slopeAreaM2 = GeometryEngine::polygonAreaM2($this->polygon);

        // Площа замовлення — по ПОВНІЙ ширині
        $orderAreaM2 = round($totalSheets * ($this->fullWidth / 1000) * ($sheetLength / 1000), 3);

        return [
            'profile_name'      => $this->profile['name'],
            'slope_area_m2'     => round($slopeAreaM2, 3),
            'slope_width_mm'    => $slopeWidth,
            'slope_height_mm'   => $slopeHeight,
            'cols_count'        => $colsCount,
            'rows_count'        => $rowsCount,
            'total_sheets'      => $totalSheets,
            'sheet_length_mm'   => $sheetLength,
            'sheet_full_width'  => $this->fullWidth,
            'sheet_useful_width'=> $this->usefulWidth,
            'sheets_by_length'  => [[
                'length_mm'    => $sheetLength,
                'full_width_mm'=> $this->fullWidth,
                'count'        => $totalSheets,
                'full_area_m2' => $orderAreaM2,
            ]],
            'order_area_m2'     => $orderAreaM2,   // по повній ширині
            'useful_area_m2'    => round($totalUsedArea / 1_000_000, 3), // по корисній
            'waste_pct'         => $totalFullArea > 0
                ? round(($totalFullArea - $totalUsedArea) / $totalFullArea * 100, 1) : 0,
            'placements'        => array_merge($usedSheets, $partialSheets),
            'warnings'          => $warnings,
            'errors'            => $errors,
        ];
    }

    private function buildPlacements(array $bbox, int $cols, int $rows, int $sheetLength): array
    {
        $placements = [];
        $sheetNum   = 1;
        $colOrder   = $this->layingDirection === 'left_right'
            ? range(0, $cols - 1)
            : array_reverse(range(0, $cols - 1));

        $effectiveLength = $sheetLength - $this->lengthOverlap;
        if ($effectiveLength <= 0) $effectiveLength = $sheetLength;

        for ($row = 0; $row < $rows; $row++) {
            $rowY = $row * $effectiveLength;

            foreach ($colOrder as $col) {
                $x = $bbox['minX'] + $col * $this->usefulWidth;
                $y = $bbox['minY'] + $rowY;

                $hLeft  = $this->getPolygonHeightAtX((int)$x);
                $hMid   = $this->getPolygonHeightAtX((int)($x + $this->usefulWidth / 2));
                $hRight = $this->getPolygonHeightAtX((int)($x + $this->usefulWidth));
                $colH   = max($hLeft, $hMid, $hRight);

                if ($colH <= 0) $colH = (int)$bbox['height'];

                $totalNeeded = $colH + $this->eaveOverhang + $this->ridgeGap;
                $remaining   = $totalNeeded - $rowY;

                if ($remaining <= 0) continue;

                $rowLength = min($sheetLength, $remaining);

                $placements[] = [
                    'sheet_number' => $sheetNum++,
                    'col_index'    => $col,
                    'row_index'    => $row,
                    'x'            => $x,
                    'y'            => $y,
                    'full_width'   => $this->fullWidth,
                    'useful_width' => $this->usefulWidth,
                    'length'       => $rowLength,
                ];
            }
        }
        return $placements;
    }

    private function getPolygonHeightAtX(int $x): int
    {
        $ys = [];
        $n  = count($this->polygon);
        for ($i = 0; $i < $n; $i++) {
            $p1 = $this->polygon[$i];
            $p2 = $this->polygon[($i + 1) % $n];
            $x1 = (int)$p1[0]; $y1 = (int)$p1[1];
            $x2 = (int)$p2[0]; $y2 = (int)$p2[1];
            if ($x1 === $x2) {
                if (abs($x1 - $x) < 2) { $ys[] = $y1; $ys[] = $y2; }
                continue;
            }
            $xMin = min($x1, $x2); $xMax = max($x1, $x2);
            if ($x >= $xMin && $x <= $xMax) {
                $t = (float)($x - $x1) / (float)($x2 - $x1);
                $ys[] = (int)round($y1 + $t * ($y2 - $y1));
            }
        }
        if (count($ys) < 2) return 0;
        return max($ys) - min($ys);
    }
}