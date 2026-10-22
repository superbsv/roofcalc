<?php
// ============================================
// ArtBudTrading Roof Calculator
// exports/PdfGenerator.php
//
// Генерація PDF засобами TCPDF
// ============================================

namespace RoofCalc\Exports;

use RoofCalc\Core\Database;

// Власна копія класичного TCPDF 6.7.5 (backend/src/lib/tcpdf): версія з vendor/ на сервері
// (TCPDF 7 на tc-lib-pdf) не має файлів шрифтів і падає з «unable to read file: helvetica.json».
// Підключаємо свою до того, як автозавантажувач візьме клас з vendor/.
if (!class_exists('TCPDF', false)) {
    require_once __DIR__ . '/../lib/tcpdf/tcpdf.php';
}

class PdfGenerator
{
    private array  $project;
    private array  $slopes;
    private array  $specItems;
    private array  $settings;
    private string $logoPath;

    public function __construct(int $projectId)
    {
        $this->project  = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$projectId]) ?? [];
        $this->slopes   = Database::fetchAll(
            'SELECT s.*, mp.name as material_name, mp.manufacturer as mat_manufacturer, mp.type as mat_type,
                    mp.full_width as mat_full_width, mp.useful_width as mat_useful_width FROM slopes s
             LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.project_id = ? ORDER BY s.sort_order, s.id',
            [$projectId]
        );
        $this->specItems = Database::fetchAll(
            'SELECT * FROM specification_items WHERE project_id = ? ORDER BY sort_order, id',
            [$projectId]
        );
        $this->settings = $this->loadSettings();
        $this->logoPath = $this->settings['logo_path'] ?? '';

        // Реквізити кабінету, якому належить проєкт (логотип, назва, контакти, колір)
        Database::ensurePlatformSchema();
        $t = !empty($this->project['tenant_id'])
            ? Database::fetchOne('SELECT * FROM tenants WHERE id = ?', [$this->project['tenant_id']]) : null;
        if ($t) {
            $this->settings['company_name']    = $t['doc_company'] ?: $t['name'];
            $this->settings['company_phone']   = $t['doc_phone'] ?? '';
            $this->settings['company_email']   = $t['doc_email'] ?? '';
            $this->settings['company_address'] = trim(($t['doc_address'] ?? '') . (($t['doc_site'] ?? '') ? '  ' . $t['doc_site'] : ''));
            $this->settings['company_requisites'] = $t['doc_requisites'] ?? '';
            if (!empty($t['brand_color']) && preg_match('/^#([0-9A-Fa-f]{6})$/', $t['brand_color'], $m)) {
                $this->brand = [hexdec(substr($m[1], 0, 2)), hexdec(substr($m[1], 2, 2)), hexdec(substr($m[1], 4, 2))];
            }
            if (!empty($t['logo']) && preg_match('#^data:image/(png|jpeg);base64,(.+)$#', $t['logo'], $m)) {
                $this->logoData = base64_decode($m[2]) ?: '';
            }
        }
    }

    private array $brand = [255, 122, 0];
    private string $logoData = '';

    // ============================================
    // Комерційна пропозиція для клієнта: реквізити, об'єкт, матеріал, підсумки,
    // 2D-схема кожного ската з розкладкою листів і довжинами, специфікація (лише кількості), підписи
    // ============================================
    public function generateClientPdf(): string
    {
        if (!class_exists('\TCPDF')) {
            return $this->fallbackPdf('client');
        }
        [$br, $bg, $bb] = $this->brand;
        $ps = json_decode((string)($this->project['settings'] ?? ''), true);
        $ps = is_array($ps) ? $ps : [];
        $orderNo = !empty($ps['order_no']) ? $ps['order_no'] : $this->project['id'];
        $date = !empty($ps['order_date']) ? date('d.m.Y', strtotime($ps['order_date'])) : date('d.m.Y');
        // Нижній колонтитул з номером КП і сторінкою (TCPDF малює його сам на кожній сторінці)
        $pdf = new class('P', 'mm', 'A4', true, 'UTF-8') extends \TCPDF {
            public $footText = '';
            public function Footer() {
                $this->SetY(-12);
                $this->SetFont('dejavusans', '', 7); $this->SetTextColor(150, 160, 170);
                $this->Cell(90, 4, $this->footText, 0, 0, 'L');
                $this->Cell(0, 4, 'Сторінка ' . $this->getAliasNumPage() . ' з ' . $this->getAliasNbPages(), 0, 0, 'R');
            }
        };
        $pdf->footText = "КП № {$orderNo} від {$date}";
        $pdf->SetCreator('ROOFKIT'); $pdf->SetAuthor($this->settings['company_name'] ?? 'ROOFKIT'); $pdf->SetTitle('Комерційна пропозиція');
        $pdf->setPrintHeader(false); $pdf->setPrintFooter(true); $pdf->setFooterMargin(10);
        $pdf->SetMargins(15, 15, 15); $pdf->SetAutoPageBreak(true, 20);

        // ---------- Сторінка 1 ----------
        $pdf->AddPage();
        $this->addHeader($pdf);
        $pdf->SetFont('dejavusans', 'B', 18);
        $pdf->SetTextColor(11, 17, 25);
        $pdf->Cell(0, 10, 'Комерційна пропозиція', 0, 1, 'L');
        $pdf->SetFont('dejavusans', '', 10);
        $pdf->SetTextColor(100, 110, 125);
        $pdf->Cell(0, 6, "№ {$orderNo} від {$date}", 0, 1, 'L');
        $pdf->Ln(3);

        // Об'єкт і замовник
        $this->section($pdf, 'Замовник і об\'єкт');
        $rows = array_filter([
            ['Замовник', $this->project['client_name'] ?? ''],
            ['Телефон', $this->project['client_phone'] ?? ''],
            ['Email', $this->project['client_email'] ?? ''],
            ['Адреса об\'єкта', $this->project['object_address'] ?? ''],
            ['Розрахунок', $this->project['name'] ?? ''],
        ], function ($r) { return trim((string)$r[1]) !== ''; });
        $this->keyValues($pdf, $rows);

        // Матеріал і підсумки
        $calc = array_values(array_filter(array_map(function ($s) {
            $cr = json_decode($s['calc_result'] ?? 'null', true);
            return ($cr && empty($cr['errors'])) ? ['s' => $s, 'cr' => $cr] : null;
        }, $this->slopes)));
        $mat = $this->slopes[0] ?? [];
        $tot = ['area' => 0, 'useful' => 0, 'full' => 0, 'sheets' => 0, 'pm' => 0];
        foreach ($calc as $c) {
            $tot['area'] += (float)($c['cr']['slope_area_m2'] ?? 0);
            $tot['useful'] += (float)($c['cr']['useful_area_m2'] ?? 0);
            $tot['full'] += (float)($c['cr']['total_full_area_m2'] ?? $c['cr']['order_area_m2'] ?? 0);
            $tot['sheets'] += (int)($c['cr']['total_sheets'] ?? 0);
            $tot['pm'] += (float)($c['cr']['running_m'] ?? 0);
        }
        $this->section($pdf, 'Покрівельний матеріал');
        $this->keyValues($pdf, array_filter([
            ['Матеріал', trim(($mat['mat_manufacturer'] ?? '') . ' ' . ($mat['material_name'] ?? ''))],
            ['Ширина повна / корисна', !empty($mat['mat_full_width']) ? sprintf('%.3f / %.3f м', $mat['mat_full_width'] / 1000, $mat['mat_useful_width'] / 1000) : ''],
            ['Покриття, колір', trim(($ps['coating'] ?? '') . ' ' . ($ps['color'] ?? ''))],
        ], function ($r) { return trim((string)$r[1]) !== ''; }));

        // Плитки підсумків
        $pdf->Ln(2);
        $tiles = [
            ['Скатів', (string)count($calc)],
            ['Площа покрівлі', number_format($tot['area'], 2, ',', ' ') . ' м²'],
            ['Листів', $tot['sheets'] . ' шт'],
            ['Площа листів', number_format($tot['full'], 2, ',', ' ') . ' м²'],
        ];
        $x0 = 15; $w = 43.5; $y = $pdf->GetY();
        foreach ($tiles as $i => [$k, $v]) {
            $x = $x0 + $i * ($w + 2);
            $pdf->SetFillColor(245, 247, 250); $pdf->SetDrawColor(221, 227, 234);
            $pdf->RoundedRect($x, $y, $w, 18, 2, '1111', 'DF');
            $pdf->SetFillColor($br, $bg, $bb); $pdf->Rect($x, $y + 2, 1.2, 14, 'F');
            $pdf->SetXY($x + 4, $y + 2.5); $pdf->SetFont('dejavusans', '', 7.5); $pdf->SetTextColor(100, 110, 125);
            $pdf->Cell($w - 6, 4, $k, 0, 2);
            $pdf->SetX($x + 4); $pdf->SetFont('dejavusans', 'B', 12); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell($w - 6, 8, $v, 0, 0);
        }
        $pdf->SetY($y + 22);

        // Зведення по скатах
        if ($calc) {
            $this->section($pdf, 'Скати покрівлі');
            $this->drawTable($pdf, ['№', 'Скат', 'Площа, м²', 'Листів, шт', 'Погонні метри'],
                [12, 78, 30, 30, 30],
                array_map(function ($c, $i) {
                    return [$i + 1, $c['s']['name'], number_format((float)$c['cr']['slope_area_m2'], 2, ',', ' '),
                        (int)$c['cr']['total_sheets'], number_format((float)($c['cr']['running_m'] ?? 0), 2, ',', ' ')];
                }, $calc, array_keys($calc)));
        }

        // ---------- Схеми скатів ----------
        foreach ($calc as $i => $c) {
            $pdf->AddPage();
            $this->addHeader($pdf);
            $s = $c['s']; $cr = $c['cr'];
            $pdf->SetFont('dejavusans', 'B', 13); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell(0, 8, 'Скат ' . ($i + 1) . ' — ' . $s['name'], 0, 1);
            $pdf->SetFont('dejavusans', '', 8.5); $pdf->SetTextColor(100, 110, 125);
            $pdf->Cell(0, 5, sprintf('Площа %s м² · листів %d · укладка %s', number_format((float)$cr['slope_area_m2'], 2, ',', ' '),
                (int)$cr['total_sheets'], ($s['laying_direction'] ?? '') === 'left_right' ? 'зліва направо' : 'справа наліво'), 0, 1);
            $pdf->Ln(2);
            $yS = $pdf->GetY();
            $this->drawSlopeScheme($pdf, $s, $cr, 15, $yS, 180, 130);
            $pdf->SetY($yS + 134);

            // Сторони і довжини листів поруч
            $pts = json_decode($s['polygon_points'] ?? '[]', true) ?: [];
            $et = json_decode($s['edge_types'] ?? '[]', true) ?: [];
            $yT = $pdf->GetY();
            $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell(85, 6, 'Розміри ската, м', 0, 1);
            $pdf->SetFont('dejavusans', '', 8.5);
            foreach ($pts as $k => $p) {
                $q = $pts[($k + 1) % count($pts)];
                $len = hypot($q[0] - $p[0], $q[1] - $p[1]) / 1000;
                $pdf->SetTextColor($br, $bg, $bb); $pdf->Cell(8, 5, self::letter($k), 0, 0);
                $pdf->SetTextColor(30, 40, 55); $pdf->Cell(22, 5, '= ' . number_format($len, 3, '.', ''), 0, 0);
                $pdf->SetTextColor(100, 110, 125); $pdf->Cell(55, 5, self::edgeLabel($et[$k] ?? ''), 0, 1);
            }
            $pdf->SetXY(110, $yT);
            $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell(85, 6, 'Листи на скат', 0, 1);
            $pdf->SetX(110);
            $groups = $cr['laid_by_length'] ?? $cr['sheets_by_length'] ?? [];
            usort($groups, function ($a, $b) { return $b['length_mm'] <=> $a['length_mm']; });
            $this->drawTableAt($pdf, 110, ['Довжина, м', 'К-сть, шт'], [45, 40], array_map(function ($g) {
                return [number_format($g['length_mm'] / 1000, 3, '.', ''), (int)$g['count']];
            }, $groups));
        }

        // ---------- Специфікація ----------
        $pdf->AddPage();
        $this->addHeader($pdf);
        $this->section($pdf, 'Специфікація матеріалів');
        $types = ['sheet' => 'Покрівельне покриття', 'accessory' => 'Доборні елементи', 'fastener' => 'Кріплення', 'other' => 'Інше'];
        $n = 1;
        foreach ($types as $type => $title) {
            $items = array_values(array_filter($this->specItems, function ($it) use ($type) { return $it['type'] === $type; }));
            if (!$items) continue;
            $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetFillColor(255, 241, 229); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell(180, 6, $title, 0, 1, 'L', true);
            $rowsT = [];
            foreach ($items as $it) {
                $rowsT[] = [$n++, $it['name'], $it['unit'], rtrim(rtrim(number_format((float)$it['quantity'], 3, '.', ''), '0'), '.')];
            }
            $this->drawTable($pdf, ['№', 'Найменування', 'Од.', 'К-сть'], [12, 128, 18, 22], $rowsT);
            $pdf->Ln(2);
        }
        if (!empty($this->project['notes'])) {
            $pdf->Ln(3);
            $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25); $pdf->Cell(0, 6, 'Примітки', 0, 1);
            $pdf->SetFont('dejavusans', '', 9); $pdf->SetTextColor(50, 60, 75); $pdf->MultiCell(0, 5, $this->project['notes'], 0, 'L');
        }

        // Менеджер, умови, підписи
        $mgr = !empty($this->project['user_id']) ? Database::fetchOne('SELECT name, email, phone FROM users WHERE id = ?', [(int)$this->project['user_id']]) : null;
        $pdf->Ln(6);
        if ($pdf->GetY() > 235) { $pdf->AddPage(); $this->addHeader($pdf); }
        $pdf->SetFont('dejavusans', '', 8.5); $pdf->SetTextColor(100, 110, 125);
        $pdf->MultiCell(0, 4.5, 'Кількість розраховано за наданими розмірами покрівлі. Перед виготовленням рекомендуємо підтвердити розміри контрольним заміром.', 0, 'L');
        $pdf->Ln(4);
        $y = $pdf->GetY();
        $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25);
        $pdf->SetXY(15, $y); $pdf->Cell(85, 5, 'Виконавець', 0, 2);
        $pdf->SetFont('dejavusans', '', 8.5); $pdf->SetTextColor(50, 60, 75);
        $pdf->Cell(85, 5, $this->settings['company_name'] ?? '', 0, 2);
        if ($mgr) $pdf->Cell(85, 5, trim(($mgr['name'] ?? '') . '  ' . ($mgr['phone'] ?? '')), 0, 2);
        $pdf->Ln(6); $pdf->SetX(15); $pdf->Cell(85, 5, '__________________ / підпис', 0, 0);
        $pdf->SetXY(110, $y); $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25);
        $pdf->Cell(85, 5, 'Замовник', 0, 2);
        $pdf->SetFont('dejavusans', '', 8.5); $pdf->SetTextColor(50, 60, 75);
        $pdf->Cell(85, 5, $this->project['client_name'] ?? '', 0, 2);
        $pdf->Ln($mgr ? 11 : 6); $pdf->SetX(110); $pdf->Cell(85, 5, '__________________ / підпис', 0, 1);

        return $pdf->Output('', 'S');
    }

    // Схема ската: контур, листи з довжинами (колір — повний / підрізаний / великий відхід), сторони a, b, c…
    private function drawSlopeScheme(\TCPDF $pdf, array $s, array $cr, float $bx, float $by, float $bw, float $bh): void
    {
        $pts = json_decode($s['polygon_points'] ?? '[]', true) ?: [];
        if (count($pts) < 3) return;
        $holes = json_decode($s['holes'] ?? '[]', true) ?: [];
        $pl = $cr['placements'] ?? [];
        $xs = array_column($pts, 0); $ys = array_column($pts, 1);
        $minX = min($xs); $maxX = max($xs); $minY = min($ys); $maxY = max($ys);
        foreach ($pl as $p) {
            $fx = $p['x'] - (($p['lap'] ?? '') === 'left' ? ($p['full_width'] - $p['useful_width']) : 0);
            $minX = min($minX, $fx); $maxX = max($maxX, $fx + $p['full_width']);
            $minY = min($minY, $p['y']); $maxY = max($maxY, $p['y'] + $p['length']);
        }
        $pad = 9;
        $k = min(($bw - 2 * $pad) / max(1, $maxX - $minX), ($bh - 2 * $pad) / max(1, $maxY - $minY));
        $ox = $bx + $pad + (($bw - 2 * $pad) - ($maxX - $minX) * $k) / 2;
        $oy = $by + $pad + (($bh - 2 * $pad) - ($maxY - $minY) * $k) / 2;
        $X = function ($x) use ($ox, $minX, $k) { return $ox + ($x - $minX) * $k; };
        $Y = function ($y) use ($oy, $maxY, $k) { return $oy + ($maxY - $y) * $k; };

        $pdf->SetDrawColor(221, 227, 234); $pdf->SetFillColor(251, 252, 253);
        $pdf->RoundedRect($bx, $by, $bw, $bh, 2, '1111', 'DF');
        // сітка 1 м
        $pdf->SetLineStyle(['width' => 0.1, 'color' => [230, 234, 240]]);
        for ($gx = ceil($minX / 1000) * 1000; $gx <= $maxX; $gx += 1000) $pdf->Line($X($gx), $by + 2, $X($gx), $by + $bh - 2);
        for ($gy = ceil($minY / 1000) * 1000; $gy <= $maxY; $gy += 1000) $pdf->Line($bx + 2, $Y($gy), $bx + $bw - 2, $Y($gy));

        // листи
        foreach ($pl as $p) {
            $fx = $p['x'] - (($p['lap'] ?? '') === 'left' ? ($p['full_width'] - $p['useful_width']) : 0);
            $usefulArea = ($p['useful_width'] ?? $p['full_width']) * $p['length'] / 1e6;   // покриття рахується корисною шириною
            $ratio = $usefulArea > 0 ? ($p['intersect_area_m2'] ?? 0) / $usefulArea : 1;
            if ($ratio >= 0.97)    { $fill = [208, 214, 222]; $line = [124, 138, 156]; }
            elseif ($ratio >= 0.5) { $fill = [207, 223, 245]; $line = [47, 107, 194]; }
            else                   { $fill = [248, 214, 214]; $line = [200, 50, 47]; }
            $x1 = $X($fx); $y1 = $Y($p['y'] + $p['length']); $w = $p['full_width'] * $k; $h = $p['length'] * $k;
            $pdf->SetLineStyle(['width' => 0.2, 'color' => $line]); $pdf->SetFillColor($fill[0], $fill[1], $fill[2]);
            $pdf->Rect($x1, $y1, $w, $h, 'DF');
            if ($h > 4 && $w > 5) {
                $fs = max(4.5, min(8, $w * 0.9));
                $pdf->SetFont('dejavusans', 'B', $fs); $pdf->SetTextColor(11, 17, 25);
                $pdf->SetXY($x1, $y1 + $h / 2 - 2);
                $pdf->Cell($w, 4, number_format($p['length'] / 1000, 3, '.', ''), 0, 0, 'C');
            }
        }
        // контур і вирізи
        $poly = function (array $pp) use ($X, $Y) { $o = []; foreach ($pp as $p) { $o[] = $X($p[0]); $o[] = $Y($p[1]); } return $o; };
        $pdf->SetLineStyle(['width' => 0.6, 'color' => [11, 17, 25]]);
        $pdf->Polygon($poly($pts), 'D');
        foreach ($holes as $hpts) if (is_array($hpts) && count($hpts) >= 3) {
            $pdf->SetFillColor(255, 255, 255); $pdf->Polygon($poly($hpts), 'DF');
        }
        // сторони
        $cx = array_sum(array_column($pts, 0)) / count($pts); $cy = array_sum(array_column($pts, 1)) / count($pts);
        $pdf->SetFont('dejavusans', 'B', 7.5);
        foreach ($pts as $i => $p) {
            $q = $pts[($i + 1) % count($pts)];
            $mx = ($p[0] + $q[0]) / 2; $my = ($p[1] + $q[1]) / 2;
            $dx = $mx - $cx; $dy = $my - $cy; $d = max(1e-6, hypot($dx, $dy));
            $lx = $X($mx) + $dx / $d * 5; $ly = $Y($my) - $dy / $d * 5;
            $txt = self::letter($i) . ' ' . number_format(hypot($q[0] - $p[0], $q[1] - $p[1]) / 1000, 2, '.', '');
            $pdf->SetFillColor(255, 255, 255); $pdf->SetTextColor($this->brand[0], $this->brand[1], $this->brand[2]);
            $pdf->SetXY($lx - 10, $ly - 2); $pdf->Cell(20, 4, $txt, 0, 0, 'C', true);
        }
        $pdf->SetLineStyle(['width' => 0.2, 'color' => [200, 200, 200]]);
        // легенда
        $pdf->SetFont('dejavusans', '', 6.5); $pdf->SetTextColor(100, 110, 125);
        $lx = $bx + 4; $ly = $by + $bh - 5;
        foreach ([[[208, 214, 222], 'Повний лист'], [[207, 223, 245], 'Підрізаний'], [[248, 214, 214], 'Великий відхід']] as [$c, $t]) {
            $pdf->SetFillColor($c[0], $c[1], $c[2]); $pdf->Rect($lx, $ly + 0.8, 3, 2.4, 'F');
            $pdf->SetXY($lx + 4, $ly); $pdf->Cell(24, 4, $t, 0, 0); $lx += 28;
        }
    }

    private function section(\TCPDF $pdf, string $title): void
    {
        $pdf->Ln(1);
        $pdf->SetFont('dejavusans', 'B', 10.5);
        $pdf->SetTextColor(11, 17, 25);
        $pdf->Cell(0, 7, $title, 0, 1);
        $pdf->SetDrawColor($this->brand[0], $this->brand[1], $this->brand[2]);
        $pdf->SetLineWidth(0.5); $pdf->Line(15, $pdf->GetY(), 45, $pdf->GetY()); $pdf->SetLineWidth(0.2);
        $pdf->Ln(2.5);
    }

    private function keyValues(\TCPDF $pdf, array $rows): void
    {
        foreach ($rows as [$k, $v]) {
            $pdf->SetFont('dejavusans', '', 9); $pdf->SetTextColor(100, 110, 125);
            $pdf->Cell(48, 5.5, $k, 0, 0);
            $pdf->SetFont('dejavusans', 'B', 9); $pdf->SetTextColor(11, 17, 25);
            $pdf->Cell(0, 5.5, (string)$v, 0, 1);
        }
        $pdf->Ln(2);
    }

    private function drawTableAt(\TCPDF $pdf, float $x, array $headers, array $widths, array $rows): void
    {
        $pdf->SetFont('dejavusans', 'B', 8); $pdf->SetFillColor(11, 17, 25); $pdf->SetTextColor(255, 255, 255); $pdf->SetDrawColor(210, 216, 224);
        $pdf->SetX($x);
        foreach ($headers as $i => $h) $pdf->Cell($widths[$i], 6, $h, 1, 0, 'C', true);
        $pdf->Ln(); $pdf->SetFont('dejavusans', '', 8.5); $pdf->SetTextColor(30, 40, 55);
        foreach ($rows as $r) {
            $pdf->SetX($x);
            foreach ($r as $i => $c) $pdf->Cell($widths[$i], 5.5, (string)$c, 1, 0, 'C');
            $pdf->Ln();
        }
    }

    private static function letter(int $i): string
    {
        return chr(97 + ($i % 26)) . ($i >= 26 ? (string)intdiv($i, 26) : '');
    }

    private static function edgeLabel(string $t): string
    {
        $m = ['eave' => 'Карниз', 'ridge' => 'Конек', 'hip' => 'Хребет', 'valley' => 'Ендова', 'end' => 'Фронтон', 'abutment' => 'Примикання'];
        return isset($m[$t]) ? '<' . $m[$t] . '>' : '';
    }

    // ============================================
    // Виробничий PDF (карта розкрою)
    // ============================================
    public function generateProductionPdf(): string
    {
        if (!class_exists('\TCPDF')) {
            return $this->fallbackPdf('production');
        }

        $pdf = $this->createPdf('Карта розкрою');
        $pdf->AddPage('L'); // Landscape для карти

        $this->addHeader($pdf, true);

        $pdf->SetFont('dejavusans', 'B', 12);
        $pdf->SetTextColor(26, 26, 26);
        $pdf->Cell(0, 8, 'КАРТА РОЗКРОЮ — ' . strtoupper($this->project['name'] ?? ''), 0, 1, 'C');
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->Cell(0, 5, 'Дата: ' . date('d.m.Y H:i'), 0, 1, 'C');
        $pdf->Ln(4);

        foreach ($this->slopes as $slope) {
            $cr = json_decode($slope['calc_result'] ?? 'null', true);
            if (!$cr || !empty($cr['errors'])) continue;

            $pdf->SetFont('dejavusans', 'B', 10);
            $pdf->SetTextColor(26, 26, 26);
            $pdf->SetFillColor(244, 244, 242);
            $pdf->Cell(0, 7, $slope['name'] . ' — ' . ($slope['material_name'] ?? ''), 0, 1, 'L', true);
            $pdf->SetTextColor(30, 30, 30);
            $pdf->SetFont('dejavusans', '', 8);

            // Параметри ската
            $pdf->Cell(60, 5, 'Площа: ' . $cr['slope_area_m2'] . ' м²', 0, 0);
            $pdf->Cell(60, 5, 'Листів: ' . $cr['total_sheets'] . ' шт', 0, 0);
            $pdf->Cell(60, 5, 'Відходи: ' . $cr['waste_pct'] . '%', 0, 1);
            $pdf->Ln(2);

            // Таблиця листів по довжинах
            if (!empty($cr['sheets_by_length'])) {
                $this->drawTable($pdf,
                    ['Довжина, мм', 'Ширина повна, мм', 'К-сть, шт', 'Площа замовл., м²'],
                    [40, 45, 30, 40],
                    array_map(fn($g) => [
                        $g['length_mm'], $g['full_width_mm'],
                        $g['count'],
                        number_format($g['full_area_m2'], 3),
                    ], $cr['sheets_by_length'])
                );
            }

            // Попередження
            foreach ($cr['warnings'] ?? [] as $w) {
                $pdf->SetTextColor(180, 60, 0);
                $pdf->SetFont('dejavusans', '', 7);
                $pdf->Cell(0, 4, '⚠ ' . $w, 0, 1);
            }

            $pdf->SetTextColor(30, 30, 30);
            $pdf->Ln(4);
        }

        return $pdf->Output('', 'S');
    }

    // ---- Helpers ----

    private function createPdf(string $title): \TCPDF
    {
        $pdf = new \TCPDF('P', 'mm', 'A4', true, 'UTF-8');
        $pdf->SetCreator('ROOFKIT');
        $pdf->SetAuthor($this->settings['company_name'] ?? 'ROOFKIT');
        $pdf->SetTitle($title);
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->SetMargins(15, 15, 15);
        $pdf->SetAutoPageBreak(true, 20);
        return $pdf;
    }

    private function addHeader(\TCPDF $pdf, bool $landscape = false): void
    {
        $pageW = $landscape ? 297 : 210;

        if ($this->logoData !== '') {
            $pdf->Image('@' . $this->logoData, 15, 8, 0, 14, '', '', 'T', false, 300);   // висота 14 мм, ширина за пропорцією
        } elseif ($this->logoPath && file_exists($this->logoPath)) {
            $pdf->Image($this->logoPath, 15, 10, 40, 0, '', '', 'T', false, 300);
        }

        $pdf->SetFont('dejavusans', 'B', 11);
        $pdf->SetTextColor(26, 26, 26);
        $pdf->SetXY($landscape ? 120 : 60, 10);
        $pdf->Cell($pageW - 75, 6, $this->settings['company_name'] ?? 'ROOFKIT', 0, 1, 'R');
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->SetX($landscape ? 120 : 60);
        $contacts = implode(' | ', array_filter([$this->settings['company_phone'] ?? '', $this->settings['company_email'] ?? '']));
        if ($contacts !== '') $pdf->Cell($pageW - 75, 4, $contacts, 0, 1, 'R');
        if (!empty($this->settings['company_address'])) {
            $pdf->SetX($landscape ? 120 : 60);
            $pdf->Cell($pageW - 75, 4, $this->settings['company_address'], 0, 1, 'R');
        }

        if (!empty($this->settings['company_requisites'])) {
            $pdf->SetX($landscape ? 120 : 60);
            $pdf->Cell($pageW - 75, 4, str_replace(["\r", "\n"], ['', ' · '], mb_substr($this->settings['company_requisites'], 0, 160)), 0, 1, 'R');
        }
        $pdf->SetDrawColor($this->brand[0], $this->brand[1], $this->brand[2]);
        $ly = max(25, $pdf->GetY() + 1);
        $pdf->Line(15, $ly, $pageW - 15, $ly);
        $pdf->SetY($ly + 5);
    }

    private function drawTable(\TCPDF $pdf, array $headers, array $widths, array $rows): void
    {
        // Header row
        $pdf->SetFont('dejavusans', 'B', 8);
        $pdf->SetFillColor(11, 17, 25);
        $pdf->SetTextColor(255, 255, 255);
        $pdf->SetDrawColor(210, 216, 224);
        foreach ($headers as $i => $h) {
            $pdf->Cell($widths[$i], 6, $h, 1, 0, 'C', true);
        }
        $pdf->Ln();

        // Data rows
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(30, 30, 30);
        $fill = false;
        foreach ($rows as $row) {
            $pdf->SetFillColor($fill ? 245 : 255, $fill ? 247 : 255, $fill ? 250 : 255);
            foreach ($row as $i => $cell) {
                $pdf->Cell($widths[$i], 5, (string)$cell, 1, 0, 'L', $fill);
            }
            $pdf->Ln();
            $fill = !$fill;
        }
    }

    private function loadSettings(): array
    {
        $rows = Database::fetchAll('SELECT key_name, value FROM app_settings');
        $result = [];
        foreach ($rows as $r) { $result[$r['key_name']] = $r['value']; }
        return $result;
    }

    private function roofTypeLabel(string $type): string
    {
        return [
            'gable'   => 'Двосхилий',
            'hip'     => 'Вальмовий',
            'mansard' => 'Мансардний',
            'shed'    => 'Односхилий',
            'complex' => 'Складний',
        ][$type] ?? $type;
    }

    // Fallback якщо TCPDF не встановлено
    private function fallbackPdf(string $type): string
    {
        return "TCPDF не встановлено. Виконайте: composer install\n" .
               "Тип документу: $type\nПроект: " . ($this->project['name'] ?? '');
    }
}
