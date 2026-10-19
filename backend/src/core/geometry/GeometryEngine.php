<?php
// ============================================
// ArtBudTrading Roof Calculator
// core/geometry/GeometryEngine.php
//
// ВАЖЛИВО: всі координати в міліметрах (цілі числа)
// Це усуває floating point помилки при розрахунках
// ============================================

namespace RoofCalc\Core\Geometry;

class GeometryEngine
{
    // ---- Площа полігону (формула Гаусса / Shoelace) ----
    // Повертає площу в мм², ділити на 1_000_000 щоб отримати м²
    public static function polygonArea(array $points): float
    {
        $n = count($points);
        if ($n < 3) return 0.0;

        $area = 0;
        for ($i = 0; $i < $n; $i++) {
            $j = ($i + 1) % $n;
            $area += $points[$i][0] * $points[$j][1];
            $area -= $points[$j][0] * $points[$i][1];
        }
        return abs($area) / 2.0;
    }

    // Площа в м²
    public static function polygonAreaM2(array $points): float
    {
        return self::polygonArea($points) / 1_000_000.0;
    }

    // ---- Перевірка: точка всередині полігону (Ray casting) ----
    public static function pointInPolygon(int $px, int $py, array $polygon): bool
    {
        $n       = count($polygon);
        $inside  = false;

        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            $xi = $polygon[$i][0]; $yi = $polygon[$i][1];
            $xj = $polygon[$j][0]; $yj = $polygon[$j][1];

            if ((($yi > $py) !== ($yj > $py))
                && ($px < ($xj - $xi) * ($py - $yi) / ($yj - $yi) + $xi)) {
                $inside = !$inside;
            }
        }
        return $inside;
    }

    // ---- Bounding box полігону ----
    public static function boundingBox(array $points): array
    {
        $xs = array_column($points, 0);
        $ys = array_column($points, 1);
        return [
            'minX' => min($xs),
            'minY' => min($ys),
            'maxX' => max($xs),
            'maxY' => max($ys),
            'width'  => max($xs) - min($xs),
            'height' => max($ys) - min($ys),
        ];
    }

    // ---- Перетин двох відрізків ----
    // Повертає точку перетину або null
    public static function segmentIntersect(
        int $x1, int $y1, int $x2, int $y2,
        int $x3, int $y3, int $x4, int $y4
    ): ?array {
        $denom = ($x1 - $x2) * ($y3 - $y4) - ($y1 - $y2) * ($x3 - $x4);
        if ($denom === 0) return null; // паралельні

        $t = (($x1 - $x3) * ($y3 - $y4) - ($y1 - $y3) * ($x3 - $x4)) / $denom;
        $u = -(($x1 - $x2) * ($y1 - $y3) - ($y1 - $y2) * ($x1 - $x3)) / $denom;

        if ($t >= 0 && $t <= 1 && $u >= 0 && $u <= 1) {
            return [
                (int)round($x1 + $t * ($x2 - $x1)),
                (int)round($y1 + $t * ($y2 - $y1)),
            ];
        }
        return null;
    }

    // ---- Перевірка самоперетину полігону ----
    public static function hasSelfIntersection(array $points): bool
    {
        $n = count($points);
        for ($i = 0; $i < $n; $i++) {
            $i2 = ($i + 1) % $n;
            for ($j = $i + 2; $j < $n; $j++) {
                $j2 = ($j + 1) % $n;
                if ($j2 === $i) continue; // суміжні сторони

                $pt = self::segmentIntersect(
                    $points[$i][0],  $points[$i][1],
                    $points[$i2][0], $points[$i2][1],
                    $points[$j][0],  $points[$j][1],
                    $points[$j2][0], $points[$j2][1]
                );
                if ($pt !== null) return true;
            }
        }
        return false;
    }

    // ---- Площа перетину прямокутника з полігоном ----
    // Метод Сазерленда-Ходгмана (Sutherland-Hodgman clipping)
    // Повертає площу перетину в мм²
    public static function rectPolygonIntersectionArea(
        int $rx, int $ry, int $rw, int $rh,
        array $polygon
    ): float {
        // Прямокутник як полігон (проти годинникової стрілки)
        $rect = [
            [$rx,      $ry],
            [$rx + $rw, $ry],
            [$rx + $rw, $ry + $rh],
            [$rx,       $ry + $rh],
        ];

        $clipped = self::sutherlandHodgman($polygon, $rect);
        if (empty($clipped)) return 0.0;

        return self::polygonArea($clipped);
    }

    // Алгоритм Сазерленда-Ходгмана
    private static function sutherlandHodgman(array $subject, array $clip): array
    {
        $output = $subject;
        $n = count($clip);

        for ($i = 0; $i < $n; $i++) {
            if (empty($output)) return [];
            $input = $output;
            $output = [];
            $edgeA = $clip[$i];
            $edgeB = $clip[($i + 1) % $n];

            foreach ($input as $k => $current) {
                $previous = $input[($k + count($input) - 1) % count($input)];

                $currInside = self::isInsideEdge($current,  $edgeA, $edgeB);
                $prevInside = self::isInsideEdge($previous, $edgeA, $edgeB);

                if ($currInside) {
                    if (!$prevInside) {
                        $pt = self::edgeIntersect($previous, $current, $edgeA, $edgeB);
                        if ($pt) $output[] = $pt;
                    }
                    $output[] = $current;
                } elseif ($prevInside) {
                    $pt = self::edgeIntersect($previous, $current, $edgeA, $edgeB);
                    if ($pt) $output[] = $pt;
                }
            }
        }
        return $output;
    }

    private static function isInsideEdge(array $p, array $a, array $b): bool
    {
        return ($b[0] - $a[0]) * ($p[1] - $a[1]) - ($b[1] - $a[1]) * ($p[0] - $a[0]) >= 0;
    }

    private static function edgeIntersect(array $p1, array $p2, array $p3, array $p4): ?array
    {
        $x1=$p1[0]; $y1=$p1[1]; $x2=$p2[0]; $y2=$p2[1];
        $x3=$p3[0]; $y3=$p3[1]; $x4=$p4[0]; $y4=$p4[1];

        $denom = ($x1-$x2)*($y3-$y4) - ($y1-$y2)*($x3-$x4);
        if (abs($denom) < 1e-10) return null;

        $t = (($x1-$x3)*($y3-$y4) - ($y1-$y3)*($x3-$x4)) / $denom;

        return [
            (int)round($x1 + $t * ($x2-$x1)),
            (int)round($y1 + $t * ($y2-$y1)),
        ];
    }

    // ---- Валідація полігону ----
    public static function validate(array $points): array
    {
        $errors = [];

        if (count($points) < 3) {
            $errors[] = 'Скат повинен мати мінімум 3 точки';
            return $errors;
        }

        $area = self::polygonAreaM2($points);
        if ($area < 0.01) {
            $errors[] = 'Площа ската занадто мала (менше 0.01 м²)';
        }

        if (self::hasSelfIntersection($points)) {
            $errors[] = 'Контур ската має самоперетин';
        }

        return $errors;
    }

    // ---- Розрахунок довжини периметра і сторін ----
    public static function sideLength(array $p1, array $p2): float
    {
        $dx = $p2[0] - $p1[0];
        $dy = $p2[1] - $p1[1];
        return sqrt($dx*$dx + $dy*$dy);
    }

    public static function perimeter(array $points): float
    {
        $n = count($points);
        $p = 0;
        for ($i = 0; $i < $n; $i++) {
            $p += self::sideLength($points[$i], $points[($i+1) % $n]);
        }
        return $p;
    }
}
