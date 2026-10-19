<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/calculation/FaltsCalculator.php
//
// Розрахунок клік-фальц / стоячий фальц
// Ключова особливість: шахматне розташування стиків
// ============================================

namespace RoofCalc\Core\Calculation;

use RoofCalc\Core\Geometry\GeometryEngine;

class FaltsCalculator
{
    private array $profile;
    private array $slope;
    private array $polygon;

    private int $fullWidth;
    private int $usefulWidth;
    private int $minLength;
    private int $maxLength;
    private int $joinOverlap;       // нахлест при нарощуванні (мм)
    private int $minJointDistance;  // мін. відстань між стиками сусідніх картин (мм)
    private string $lockType;       // click | standing

    private int $eaveOverhang;
    private int $ridgeGap;
    private string $layingDirection;

    public function __construct(array $profile, array $slope)
    {
        $this->profile  = $profile;
        $this->slope    = $slope;
        $this->polygon  = $slope['polygon_points'];

        $this->fullWidth        = (int)$profile['full_width'];
        $this->usefulWidth      = (int)$profile['useful_width'];
        $this->minLength        = (int)$profile['min_length'];
        $this->maxLength        = (int)$profile['max_length'];
        $this->joinOverlap      = (int)($profile['join_overlap']       ?? 100);
        $this->minJointDistance = (int)($profile['min_joint_distance'] ?? 500);
        $this->lockType         = $profile['lock_type'] ?? 'click';

        $this->eaveOverhang    = (int)$slope['eave_overhang'];
        $this->ridgeGap        = (int)$slope['ridge_gap'];
        $this->layingDirection = $slope['laying_direction'] ?? 'right_left';
    }

    public function calculate(): array
    {
        $warnings = [];

        $geoErrors = GeometryEngine::validate($this->polygon);
        if (!empty($geoErrors)) return ['errors' => $geoErrors];

        $bbox        = GeometryEngine::boundingBox($this->polygon);
        $slopeWidth  = $bbox['width'];
        $slopeHeight = $bbox['height'];

        // Кількість картин по ширині
        $pictureCount = (int)ceil($slopeWidth / $this->usefulWidth);

        // Загальна довжина картини (з урахуванням свесів)
        $totalPicLength = $slopeHeight + $this->eaveOverhang + $this->ridgeGap;

        // Розбивка картини на секції (якщо довша за макс)
        $sections = $this->splitIntoSections($totalPicLength);

        if (count($sections) > 1) {
            $warnings[] = sprintf(
                'Картина розбита на %d секції через максимальну довжину %d мм',
                count($sections), $this->maxLength
            );
        }

        // Шахматне розміщення стиків
        // Парні картини: стики на звичайних позиціях
        // Непарні картини: стики зміщені на пів-секції
        $jointWarnings = $this->validateCheckerboardJoints($sections, $pictureCount);
        $warnings      = array_merge($warnings, $jointWarnings);

        // Розкладка
        $placements    = $this->buildPlacements($bbox, $pictureCount, $sections);
        $usedPictures  = [];
        $totalFullArea = 0.0;
        $totalUsedArea = 0.0;

        foreach ($placements as &$pl) {
            $intersect = GeometryEngine::rectPolygonIntersectionArea(
                (int)$pl['x'], (int)$pl['y'],
                $this->usefulWidth, (int)$pl['section_length'],
                $this->polygon
            );
            $pl['intersect_area_m2'] = round($intersect / 1_000_000, 4);
            $fullArea = $this->fullWidth * $pl['section_length'];
            $pl['full_area_m2'] = round($fullArea / 1_000_000, 4);

            if ($intersect > 0) {
                $usedPictures[] = $pl;
                $totalFullArea += $fullArea;
                $totalUsedArea += $intersect;
            }
        }

        // Кляммери
        $clammers = $this->calcClammers($pictureCount, $totalPicLength);

        $slopeAreaM2 = GeometryEngine::polygonAreaM2($this->polygon);
        $orderAreaM2 = round($pictureCount * ($this->fullWidth / 1000) * ($totalPicLength / 1000), 3);

        return [
            'profile_name'       => $this->profile['name'],
            'lock_type'          => $this->lockType,
            'slope_area_m2'      => round($slopeAreaM2, 3),
            'slope_width_mm'     => $slopeWidth,
            'slope_height_mm'    => $slopeHeight,
            'picture_count'      => $pictureCount,
            'sections_per_pic'   => count($sections),
            'sections'           => $sections,
            'total_picture_length_mm' => $totalPicLength,
            'useful_width_mm'    => $this->usefulWidth,
            'full_width_mm'      => $this->fullWidth,
            'join_overlap_mm'    => $this->joinOverlap,
            'min_joint_dist_mm'  => $this->minJointDistance,
            'checkerboard'       => count($sections) > 1,
            'clammers'           => $clammers,
            'order_area_m2'      => $orderAreaM2,
            'useful_area_m2'     => round($totalUsedArea / 1_000_000, 3),
            'waste_pct'          => $totalFullArea > 0
                ? round(($totalFullArea - $totalUsedArea) / $totalFullArea * 100, 1) : 0,
            'placements'         => $usedPictures,
            'warnings'           => $warnings,
            'errors'             => [],
        ];
    }

    // ============================================
    // Розбивка картини на секції
    // ============================================
    private function splitIntoSections(int $totalLength): array
    {
        if ($totalLength <= $this->maxLength) {
            return [['length' => $totalLength, 'overlap' => 0]];
        }

        $sections   = [];
        $remaining  = $totalLength;
        $isFirst    = true;

        while ($remaining > 0) {
            $secLen = min($remaining, $this->maxLength);

            // Мінімальна довжина секції
            if ($secLen < $this->minLength && count($sections) > 0) {
                // Додаємо залишок до попередньої секції — або зменшуємо попередню
                $last = array_pop($sections);
                $last['length'] += $secLen;
                $sections[] = $last;
                break;
            }

            $overlap = $isFirst ? 0 : $this->joinOverlap;
            $sections[] = [
                'length'  => $secLen,
                'overlap' => $overlap, // нахлест з попередньою секцією
            ];
            $remaining -= ($secLen - $this->joinOverlap);
            $isFirst = false;

            if ($remaining <= 0) break;
        }

        return $sections;
    }

    // ============================================
    // Перевірка шахматного розташування стиків
    // ============================================
    private function validateCheckerboardJoints(array $sections, int $picCount): array
    {
        $warnings = [];

        if (count($sections) <= 1 || $picCount < 2) return $warnings;

        // Позиції стиків для парних картин (від карнизу)
        $evenJoints = $this->calcJointPositions($sections, false);
        // Позиції стиків для непарних (зміщено)
        $oddJoints  = $this->calcJointPositions($sections, true);

        // Перевіряємо мінімальну відстань між стиками сусідніх картин
        foreach ($evenJoints as $ej) {
            foreach ($oddJoints as $oj) {
                $dist = abs($ej - $oj);
                if ($dist < $this->minJointDistance) {
                    $warnings[] = sprintf(
                        'Стики картин на позиціях %d мм та %d мм занадто близько (%d мм < %d мм мін.)',
                        $ej, $oj, $dist, $this->minJointDistance
                    );
                }
            }
        }

        return $warnings;
    }

    private function calcJointPositions(array $sections, bool $offset): array
    {
        $positions = [];
        $pos       = 0;

        foreach ($sections as $i => $sec) {
            if ($i === 0) {
                $pos += $sec['length'];
                continue;
            }
            // Якщо непарна — зміщуємо стик на половину першої секції
            $jointPos = $offset
                ? (int)round($pos - $sections[0]['length'] / 2)
                : $pos;

            $positions[] = max(0, $jointPos);
            $pos += $sec['length'] - $sec['overlap'];
        }

        return $positions;
    }

    // ============================================
    // Розкладка картин
    // ============================================
    private function buildPlacements(array $bbox, int $picCount, array $sections): array
    {
        $placements = [];
        $picOrder   = $this->layingDirection === 'left_right'
            ? range(0, $picCount - 1)
            : array_reverse(range(0, $picCount - 1));

        foreach ($picOrder as $picIdx) {
            $x           = $bbox['minX'] + $picIdx * $this->usefulWidth;
            $isOdd       = ($picIdx % 2 === 1); // непарна картина — зміщення стиків
            $yPos        = $bbox['minY'];

            foreach ($sections as $secIdx => $sec) {
                // Для непарних картин зміщуємо стик на половину першої секції
                $sectionY = $yPos;
                if ($isOdd && $secIdx === 0 && count($sections) > 1) {
                    $shift    = (int)round($sections[0]['length'] / 2);
                    $sectionY = $bbox['minY'] - $shift;
                }

                $placements[] = [
                    'picture_index'  => $picIdx,
                    'section_index'  => $secIdx,
                    'x'              => $x,
                    'y'              => $sectionY,
                    'full_width'     => $this->fullWidth,
                    'useful_width'   => $this->usefulWidth,
                    'section_length' => $sec['length'],
                    'is_odd_col'     => $isOdd,
                    'joint_overlap'  => $sec['overlap'],
                ];

                $yPos += $sec['length'] - $sec['overlap'];
            }
        }

        return $placements;
    }

    // ============================================
    // Розрахунок кляммерів
    // ============================================
    private function calcClammers(int $picCount, int $totalLength): array
    {
        // Норма: кляммер на кожні 500 мм по довжині + по 2 на кожному краю картини
        $clammersPerPic = (int)ceil($totalLength / 500) + 2;
        $total          = $picCount * $clammersPerPic;

        return [
            'per_picture'   => $clammersPerPic,
            'total'         => $total,
            'with_reserve'  => (int)ceil($total * 1.05), // +5% запас
        ];
    }
}
