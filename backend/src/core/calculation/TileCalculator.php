<?php
namespace RoofCalc\Core\Calculation;
use RoofCalc\Core\Geometry\GeometryEngine;

class TileCalculator
{
    private array  $profile;
    private array  $slope;
    private array  $polygon;
    private int $fullWidth;
    private int $usefulWidth;
    private int $sideOverlap;
    private int $lengthOverlap;
    private int $waveStep;
    private int $minLength;
    private int $maxLength;
    private int $cutStep;
    private array $forbiddenLengths;
    private array $stockLengths;
    private int $eaveOverhang;
    private int $ridgeGap;
    private string $layingDirection;
    private string $mode;

    public function __construct(array $profile, array $slope, string $mode = 'order')
    {
        $this->profile = $profile;
        $this->slope   = $slope;
        $this->polygon = $slope['polygon_points'];
        $this->mode    = $mode;
        $this->fullWidth        = (int)$profile['full_width'];
        $this->usefulWidth      = (int)$profile['useful_width'];
        $this->sideOverlap      = (int)$profile['side_overlap'];
        $this->lengthOverlap    = (int)$profile['length_overlap'];
        $this->waveStep         = (int)($profile['wave_step'] ?? 0);
        $this->minLength        = (int)$profile['min_length'];
        $this->maxLength        = (int)$profile['max_length'];
        $this->cutStep          = (int)($profile['cut_step'] ?? $this->waveStep);
        $this->forbiddenLengths = json_decode($profile['forbidden_lengths'] ?? '[]', true) ?? [];
        $this->stockLengths     = json_decode($profile['stock_lengths'] ?? '[]', true) ?? [];
        $this->eaveOverhang   = (int)$slope['eave_overhang'];
        $this->ridgeGap       = (int)$slope['ridge_gap'];
        $this->layingDirection = $slope['laying_direction'] ?? 'right_left';
    }

    public function calculate(): array
    {
        $geoErrors = GeometryEngine::validate($this->polygon);
        if (!empty($geoErrors)) return ['errors' => $geoErrors];

        $bbox        = GeometryEngine::boundingBox($this->polygon);
        $slopeWidth  = $bbox['width'];
        $slopeHeight = $bbox['height'];
        $colsCount   = (int)ceil($slopeWidth / $this->usefulWidth);

        $sheetLengthResult = $this->calcSheetLength($slopeHeight);
        $rowsCount = $this->calcRowsCount($slopeHeight, $sheetLengthResult['length']);
        $placements = $this->buildPlacements($bbox, $colsCount, $rowsCount, $sheetLengthResult['length']);

        $usedSheets = []; $partialSheets = []; $wasteSheets = [];
        $totalUsedArea = 0.0; $totalWasteArea = 0.0;

        foreach ($placements as &$pl) {
            $intersectArea = GeometryEngine::rectPolygonIntersectionArea(
                (int)$pl['x'], (int)$pl['y'],
                $this->usefulWidth, (int)$pl['length'],
                $this->polygon
            );
            $pl['intersect_area_mm2'] = $intersectArea;
            $pl['intersect_area_m2']  = round($intersectArea / 1_000_000, 4);
            $fullArea = $this->fullWidth * $pl['length'];
            $pl['full_area_m2']  = round($fullArea / 1_000_000, 4);
            $pl['waste_area_m2'] = round(($fullArea - $intersectArea) / 1_000_000, 4);

            if ($intersectArea > 0) {
                $coveragePct = $intersectArea / ($this->usefulWidth * $pl['length']);
                if ($coveragePct > 0.5) $usedSheets[] = $pl;
                else $partialSheets[] = $pl;
                $totalUsedArea  += $fullArea;
                $totalWasteArea += ($fullArea - $intersectArea);
            } else {
                $wasteSheets[] = $pl;
            }
        }

        $slopeAreaM2    = GeometryEngine::polygonAreaM2($this->polygon);
        $totalSheets    = count($usedSheets) + count($partialSheets);
        $sheetsByLength = $this->groupByLength(array_merge($usedSheets, $partialSheets));

        $warnings = $sheetLengthResult['warnings'];
        if ($sheetLengthResult['adjusted']) {
            $warnings[] = sprintf('Довжину листа скориговано з %d до %d мм (крок хвилі %d мм)',
                $sheetLengthResult['original'], $sheetLengthResult['length'], $this->waveStep);
        }

        return [
            'profile_name'        => $this->profile['name'],
            'slope_area_m2'       => round($slopeAreaM2, 3),
            'slope_width_mm'      => $slopeWidth,
            'slope_height_mm'     => $slopeHeight,
            'cols_count'          => $colsCount,
            'rows_count'          => $rowsCount,
            'total_sheets'        => $totalSheets,
            'sheet_length_mm'     => $sheetLengthResult['length'],
            'sheet_full_width'    => $this->fullWidth,
            'sheets_by_length'    => $sheetsByLength,
            'placements'          => array_merge($usedSheets, $partialSheets),
            'total_full_area_m2'  => round($totalUsedArea / 1_000_000, 3),
            'total_waste_area_m2' => round($totalWasteArea / 1_000_000, 3),
            'waste_pct'           => $totalUsedArea > 0 ? round($totalWasteArea / $totalUsedArea * 100, 1) : 0,
            'mode'     => $this->mode,
            'warnings' => $warnings,
            'errors'   => [],
        ];
    }

    private function calcSheetLength(int $slopeHeight): array
    {
        $warnings = []; $adjusted = false;
        $rawLength = $slopeHeight + $this->eaveOverhang + $this->ridgeGap;
        $stepped   = $this->roundToWaveStep($rawLength);
        if ($stepped !== $rawLength) $adjusted = true;

        if ($stepped < $this->minLength) {
            $stepped = $this->minLength;
            $warnings[] = "Довжина листа менше мінімальної ({$this->minLength} мм), встановлено мінімум";
        }
        if ($stepped > $this->maxLength) {
            $warnings[] = "Довжина ската перевищує максимальну довжину листа ({$this->maxLength} мм) — буде кілька рядів";
            $stepped = $this->maxLength;
        }
        $forbidden = $this->checkForbiddenLength($stepped);
        if ($forbidden) {
            $nearest = $this->nearestAllowedLength($stepped);
            $warnings[] = sprintf('Довжина %d мм потрапляє в заборонений діапазон (%d–%d мм). Скориговано до %d мм',
                $stepped, $forbidden['min'], $forbidden['max'], $nearest);
            $stepped = $nearest; $adjusted = true;
        }
        return ['length' => $stepped, 'original' => $rawLength, 'adjusted' => $adjusted, 'warnings' => $warnings];
    }

    private function roundToWaveStep(int $length): int
    {
        if ($this->waveStep <= 0) return $length;
        return (int)(ceil($length / $this->waveStep) * $this->waveStep);
    }

    private function checkForbiddenLength(int $length): ?array
    {
        foreach ($this->forbiddenLengths as $range) {
            if ($length >= $range['min'] && $length <= $range['max']) return $range;
        }
        return null;
    }

    private function nearestAllowedLength(int $length): int
    {
        $candidate = $length; $maxTries = 100; $i = 0;
        while ($i++ < $maxTries) {
            $candidate += max(1, $this->waveStep);
            if ($candidate > $this->maxLength) {
                $candidate = $length;
                while ($candidate > $this->minLength) {
                    $candidate -= max(1, $this->waveStep);
                    if (!$this->checkForbiddenLength($candidate) && $candidate >= $this->minLength) return $candidate;
                }
                return $this->minLength;
            }
            if (!$this->checkForbiddenLength($candidate)) return $candidate;
        }
        return $length + max(1, $this->waveStep);
    }

    private function calcRowsCount(int $slopeHeight, int $sheetLength): int
    {
        $effectiveLength = $sheetLength - $this->lengthOverlap;
        if ($effectiveLength <= 0) $effectiveLength = $sheetLength;
        $totalNeeded = $slopeHeight + $this->eaveOverhang + $this->ridgeGap;
        if ($totalNeeded <= $sheetLength) return 1;
        return (int)ceil($totalNeeded / $effectiveLength);
    }

    private function buildPlacements(
        array $bbox,
        int $cols,
        int $rows,
        int $sheetLength
    ): array {
        $placements = [];
        $startX = $bbox['minX'];
        $startY = $bbox['minY'];

        $effectiveLength = $sheetLength - $this->lengthOverlap;
        if ($effectiveLength <= 0) $effectiveLength = $sheetLength;

        $colIndices = range(0, $cols - 1);
        if ($this->layingDirection !== 'left_right') {
            $colIndices = array_reverse($colIndices);
        }

        $sheetNum = 1;
        for ($row = 0; $row < $rows; $row++) {
            $rowY = $row * $effectiveLength;

            foreach ($colIndices as $col) {
                $x = $startX + $col * $this->usefulWidth;
                $y = $startY + $rowY;

                $hLeft  = $this->getPolygonHeightAtX((int)$x, $bbox);
                $hMid   = $this->getPolygonHeightAtX((int)($x + $this->usefulWidth / 2), $bbox);
                $hRight = $this->getPolygonHeightAtX((int)($x + $this->usefulWidth), $bbox);
                $colMaxHeight = max($hLeft, $hMid, $hRight);

                if ($colMaxHeight <= 0) {
                    $colMaxHeight = (int)$bbox['height'];
                }

                $totalNeeded = $colMaxHeight + $this->eaveOverhang + $this->ridgeGap;
                $remaining = $totalNeeded - $rowY;

                if ($remaining <= 0) {
                    continue;
                }

                $rowLength = min($sheetLength, $remaining);
                $rowLength = $this->roundToWaveStep((int)$rowLength);
                $rowLength = max($rowLength, $this->minLength);

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

    private function getPolygonHeightAtX(int $x, array $bbox): int
    {
        $polygon = $this->polygon;
        $ys = [];
        $n = count($polygon);

        for ($i = 0; $i < $n; $i++) {
            $p1 = $polygon[$i];
            $p2 = $polygon[($i + 1) % $n];
            $x1 = (int)$p1[0]; $y1 = (int)$p1[1];
            $x2 = (int)$p2[0]; $y2 = (int)$p2[1];

            if ($x1 === $x2) {
                if (abs($x1 - $x) < 2) { $ys[] = $y1; $ys[] = $y2; }
                continue;
            }

            $xMin = min($x1, $x2);
            $xMax = max($x1, $x2);
            if ($x >= $xMin && $x <= $xMax) {
                $t = (float)($x - $x1) / (float)($x2 - $x1);
                $ys[] = (int)round($y1 + $t * ($y2 - $y1));
            }
        }

        if (count($ys) < 2) return 0;
        return max($ys) - min($ys);
    }

    private function groupByLength(array $sheets): array
    {
        $groups = [];
        foreach ($sheets as $s) {
            $len = $s['length'];
            if (!isset($groups[$len])) {
                $groups[$len] = ['length_mm' => $len, 'full_width_mm' => $this->fullWidth, 'count' => 0, 'full_area_m2' => 0.0];
            }
            $groups[$len]['count']++;
            $groups[$len]['full_area_m2'] = round($groups[$len]['full_area_m2'] + ($s['full_area_m2'] ?? 0), 4);
        }
        usort($groups, fn($a, $b) => $a['length_mm'] <=> $b['length_mm']);
        return array_values($groups);
    }
}