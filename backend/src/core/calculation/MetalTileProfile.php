<?php
// ============================================
// MetalTileProfile — ТЕХНОЛОГІЧНИЙ рівень розрахунку металочерепиці.
// Знає лише заводські обмеження: крок штампа, зони дозволеного поперечного різу, Lmin/Lmax, дискретність.
// Геометрію ската не знає: SheetLayoutEngine питає тут, чи можна виготовити лист довжиною L, і яка найближча
// допустима довжина. Діагональна підрізка на об'єкті цими правилами не обмежується (вона робиться при монтажі).
//
// Положення кінця листа в модулі: r = posMod(L − moduleOrigin, moduleStep).
// moduleOrigin — відстань від нижнього (карнизного) краю листа до першої лінії штампа, мм.
// cutZones — дозволені інтервали r усередині модуля, [[від, до]] (межі включно, звужуються на допуск).
// ============================================
namespace RoofCalc\Core\Calculation;

final class MetalTileProfile
{
    public const ERR_TOO_SHORT  = 'TOO_SHORT';
    public const ERR_TOO_LONG   = 'TOO_LONG';
    public const ERR_INCREMENT  = 'INCREMENT';
    public const ERR_STAMP_ZONE = 'STAMP_ZONE';

    public int $moduleStepMm;
    public int $moduleOriginMm;
    /** @var array<int, array{0:int,1:int}> */
    public array $cutZonesMm;
    public int $minLengthMm;
    public int $maxLengthMm;
    public int $lengthIncrementMm;
    public int $cuttingToleranceMm;
    public int $stampGapMm;          // заборона різу ± від лінії штампа (з неї будується зона, якщо зони не задано явно)
    public int $workingWidthMm;
    public int $totalWidthMm;

    public function __construct(array $cfg)
    {
        $this->moduleStepMm       = max(1, (int)($cfg['moduleStepMm'] ?? 350));
        $this->moduleOriginMm     = (int)($cfg['moduleOriginMm'] ?? 0);
        $this->minLengthMm        = max(1, (int)($cfg['minLengthMm'] ?? 1));
        $this->maxLengthMm        = max($this->minLengthMm, (int)($cfg['maxLengthMm'] ?? 100000));
        $this->lengthIncrementMm  = max(1, (int)($cfg['lengthIncrementMm'] ?? 1));
        $this->cuttingToleranceMm = max(0, (int)($cfg['cuttingToleranceMm'] ?? 0));
        $this->stampGapMm         = max(0, (int)($cfg['stampGapMm'] ?? 0));
        $this->workingWidthMm     = (int)($cfg['workingWidthMm'] ?? 0);
        $this->totalWidthMm       = (int)($cfg['totalWidthMm'] ?? 0);
        $zones = [];
        foreach (($cfg['cutZonesMm'] ?? []) as $z) {
            if (!is_array($z) || count($z) < 2) continue;
            $a = (int)min($z[0], $z[1]); $b = (int)max($z[0], $z[1]);
            $a = max(0, $a); $b = min($this->moduleStepMm, $b);
            if ($a <= $b) $zones[] = [$a, $b];
        }
        if (!$zones && $this->stampGapMm > 0 && 2 * $this->stampGapMm < $this->moduleStepMm) {
            $zones[] = [$this->stampGapMm, $this->moduleStepMm - $this->stampGapMm];
        }
        $this->cutZonesMm = $zones;
    }

    /**
     * Профіль з картки матеріалу. null — для матеріалу правила штампа не діють
     * (не металочерепиця, немає кроку хвилі або в картці вимкнено: «заборона різу біля штампа» = 0).
     * Правило за замовчуванням (від користувача): ±50 мм від лінії штампа різати не можна.
     */
    public static function fromMaterial(array $p, int $increment = 1): ?self
    {
        if (($p['type'] ?? '') !== 'tile') return null;
        $step = (int)($p['wave_step'] ?? 0);
        if ($step <= 0) return null;
        $gap = $p['stamp_gap'] ?? null;
        $gap = ($gap === null || $gap === '') ? 50 : (int)$gap;
        $zones = $p['cut_zones'] ?? null;
        if (is_string($zones)) $zones = json_decode($zones, true);
        if ($gap <= 0 && !$zones) return null;
        return new self([
            'moduleStepMm'       => $step,
            'moduleOriginMm'     => (int)($p['module_origin'] ?? 0),
            'cutZonesMm'         => is_array($zones) ? $zones : [],
            'stampGapMm'         => $gap,
            'minLengthMm'        => (int)($p['min_length'] ?? 1),
            'maxLengthMm'        => (int)($p['max_length'] ?? 100000),
            'lengthIncrementMm'  => $increment,
            'cuttingToleranceMm' => (int)($p['cut_tolerance'] ?? 0),
            'workingWidthMm'     => (int)($p['useful_width'] ?? 0),
            'totalWidthMm'       => (int)($p['full_width'] ?? 0),
        ]);
    }

    // Невідʼємний залишок (на відміну від %, коректний для відʼємних чисел)
    public static function positiveModulo(int $a, int $m): int
    {
        $r = $a % $m;
        return $r < 0 ? $r + $m : $r;
    }

    public function modulePosition(int $lengthMm): int
    {
        return self::positiveModulo($lengthMm - $this->moduleOriginMm, $this->moduleStepMm);
    }

    /** Зона, в яку потрапляє r (з урахуванням допуску), або null */
    public function matchZone(int $r): ?array
    {
        $t = $this->cuttingToleranceMm;
        foreach ($this->cutZonesMm as $z) {
            if ($r >= $z[0] + $t && $r <= $z[1] - $t) return $z;
        }
        return null;
    }

    /** Лише вимоги до самого розміру (без пошуку найближчих) */
    private function codes(int $L): array
    {
        $e = [];
        if ($L < $this->minLengthMm) $e[] = self::ERR_TOO_SHORT;
        if ($L > $this->maxLengthMm) $e[] = self::ERR_TOO_LONG;
        if ($L % $this->lengthIncrementMm !== 0) $e[] = self::ERR_INCREMENT;
        if ($this->matchZone($this->modulePosition($L)) === null) $e[] = self::ERR_STAMP_ZONE;
        return $e;
    }

    public function isValid(int $L): bool
    {
        return !$this->codes($L);
    }

    /** validateFactoryLength(lengthMm, profile) з ТЗ */
    public function validateFactoryLength(int $lengthMm): array
    {
        $codes = $this->codes($lengthMm);
        $r = $this->modulePosition($lengthMm);
        return [
            'valid'                => !$codes,
            'requestedLengthMm'    => $lengthMm,
            'modulePositionMm'     => $r,
            'matchedCutZone'       => $this->matchZone($r),
            'errorCodes'           => $codes,
            'nearestValidShorterMm'=> $this->floorValid($lengthMm - 1),
            'nearestValidLongerMm' => $this->ceilValid($lengthMm + 1),
        ];
    }

    /** Найменша допустима заводська довжина ≥ L (null — такої немає до Lmax) */
    public function ceilValid(int $L, ?int $max = null): ?int
    {
        $max = min($max ?? $this->maxLengthMm, $this->maxLengthMm);
        $inc = $this->lengthIncrementMm;
        $x = max($L, $this->minLengthMm);
        $x = (int)(ceil($x / $inc) * $inc);
        $limit = $x + 2 * $this->moduleStepMm + $inc;
        for (; $x <= $max && $x <= $limit; $x += $inc) if ($this->isValid($x)) return $x;
        return null;
    }

    /** Найбільша допустима заводська довжина ≤ L (null — такої немає від Lmin) */
    public function floorValid(int $L): ?int
    {
        $inc = $this->lengthIncrementMm;
        $x = min($L, $this->maxLengthMm);
        $x = (int)(floor($x / $inc) * $inc);
        $limit = $x - 2 * $this->moduleStepMm - $inc;
        for (; $x >= $this->minLengthMm && $x >= $limit; $x -= $inc) if ($this->isValid($x)) return $x;
        return null;
    }

    /**
     * findValidFactoryLengths(requiredLengthMm, profile) з ТЗ.
     * Для листа, що закриває скат: заводська довжина ≥ потрібної, надлишок — підрізка на об'єкті.
     */
    public function findValidFactoryLengths(int $requiredLengthMm): array
    {
        $len = $this->ceilValid($requiredLengthMm);
        return [
            'requiredLengthMm' => $requiredLengthMm,
            'factoryLengthMm'  => $len,
            'trimMm'           => $len === null ? null : $len - $requiredLengthMm,
            'shorterMm'        => $this->floorValid($requiredLengthMm - 1), // лише довідково: коротший лист НЕ закриває скат
            'longerMm'         => $len === null ? null : $this->ceilValid($len + 1),
            'possible'         => $len !== null,
        ];
    }

    /** Людський опис для інтерфейсу */
    public function describe(): array
    {
        return [
            'step_mm'      => $this->moduleStepMm,
            'origin_mm'    => $this->moduleOriginMm,
            'zones_mm'     => $this->cutZonesMm,
            'gap_mm'       => $this->stampGapMm,
            'tolerance_mm' => $this->cuttingToleranceMm,
        ];
    }

    public function reason(array $v): string
    {
        $L = $v['requestedLengthMm'];
        $parts = [];
        foreach ($v['errorCodes'] as $c) {
            if ($c === self::ERR_STAMP_ZONE) {
                $r = $v['modulePositionMm'];
                $d = min($r, $this->moduleStepMm - $r);
                $parts[] = sprintf('рез за %d мм від лінії штампа', $d);
            } elseif ($c === self::ERR_TOO_SHORT) $parts[] = sprintf('коротше мінімальної %d мм', $this->minLengthMm);
            elseif ($c === self::ERR_TOO_LONG)   $parts[] = sprintf('довше максимальної %d мм', $this->maxLengthMm);
            elseif ($c === self::ERR_INCREMENT)  $parts[] = sprintf('не кратно %d мм', $this->lengthIncrementMm);
        }
        $alt = [];
        if ($v['nearestValidShorterMm']) $alt[] = $v['nearestValidShorterMm'];
        if ($v['nearestValidLongerMm'])  $alt[] = $v['nearestValidLongerMm'];
        return sprintf('%d мм — %s', $L, implode(', ', $parts)) . ($alt ? '; допустимо: ' . implode(' / ', $alt) . ' мм' : '');
    }

    /**
     * Технологічна перевірка готової укладки: кожна заводська заготовка. Позначає листи і повертає результат з
     * полями tech, tech_errors (людські причини), tech_ok.
     */
    public function annotate(array $r): array
    {
        $errs = [];
        foreach ($r['placements'] ?? [] as $i => $p) {
            $L = (int)$p['length'];
            $v = $this->validateFactoryLength($L);
            unset($r['placements'][$i]['tech_err']);
            $r['placements'][$i]['module_pos'] = $v['modulePositionMm'];
            if (!$v['valid']) {
                $why = $this->reason($v);
                $r['placements'][$i]['tech_err'] = $why;
                $errs[] = sprintf('Лист №%d: %s', $p['sheet_number'] ?? ($i + 1), $why);
            }
        }
        $r['tech'] = $this->describe();
        $r['tech_errors'] = $errs;
        $r['tech_ok'] = !$errs;
        return $r;
    }
}
