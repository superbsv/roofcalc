<?php
// ============================================
// ArtBudTrading Roof Calculator
// exports/PdfGenerator.php
//
// Генерація PDF засобами TCPDF
// ============================================

namespace RoofCalc\Exports;

use RoofCalc\Core\Database;

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
            'SELECT s.*, mp.name as material_name FROM slopes s
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
    }

    // ============================================
    // PDF для клієнта (КП)
    // ============================================
    public function generateClientPdf(): string
    {
        if (!class_exists('\TCPDF')) {
            return $this->fallbackPdf('client');
        }

        $pdf = $this->createPdf('Комерційна пропозиція');

        // --- Сторінка 1: Шапка + дані об'єкта ---
        $pdf->AddPage();

        // Логотип
        $this->addHeader($pdf);

        // Заголовок
        $pdf->SetFont('dejavusans', 'B', 16);
        $pdf->SetTextColor(27, 94, 46);
        $pdf->Cell(0, 10, 'КОМЕРЦІЙНА ПРОПОЗИЦІЯ', 0, 1, 'C');
        $pdf->SetFont('dejavusans', '', 9);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->Cell(0, 6, '№ ' . str_pad($this->project['id'], 6, '0', STR_PAD_LEFT) .
            ' від ' . date('d.m.Y'), 0, 1, 'C');
        $pdf->Ln(4);

        // Дані клієнта та об'єкта
        $pdf->SetFont('dejavusans', 'B', 10);
        $pdf->SetTextColor(27, 94, 46);
        $pdf->Cell(0, 7, 'ДАНІ ОБ\'ЄКТА', 0, 1);
        $pdf->SetDrawColor(27, 94, 46);
        $pdf->Line(15, $pdf->GetY(), 195, $pdf->GetY());
        $pdf->Ln(2);

        $pdf->SetFont('dejavusans', '', 9);
        $pdf->SetTextColor(30, 30, 30);

        $rows = [
            ['Клієнт',   $this->project['client_name']    ?? '—'],
            ['Телефон',  $this->project['client_phone']   ?? '—'],
            ['Email',    $this->project['client_email']   ?? '—'],
            ['Адреса',   $this->project['object_address'] ?? '—'],
            ['Тип даху', $this->roofTypeLabel($this->project['roof_type'] ?? '')],
        ];

        foreach ($rows as [$label, $value]) {
            $pdf->SetFont('dejavusans', 'B', 9);
            $pdf->Cell(40, 6, $label . ':', 0, 0);
            $pdf->SetFont('dejavusans', '', 9);
            $pdf->Cell(0, 6, $value, 0, 1);
        }

        $pdf->Ln(4);

        // --- Схеми скатів ---
        if (!empty($this->slopes)) {
            $pdf->SetFont('dejavusans', 'B', 10);
            $pdf->SetTextColor(27, 94, 46);
            $pdf->Cell(0, 7, 'СКАТИ ПОКРІВЛІ', 0, 1);
            $pdf->SetDrawColor(27, 94, 46);
            $pdf->Line(15, $pdf->GetY(), 195, $pdf->GetY());
            $pdf->Ln(3);

            $pdf->SetFont('dejavusans', '', 9);
            $pdf->SetTextColor(30, 30, 30);

            // Таблиця скатів
            $this->drawTable($pdf,
                ['Скат', 'Матеріал', 'Площа, м²', 'Листів', 'Довжина листа, мм'],
                [50, 60, 25, 20, 35],
                array_map(function($s) {
                    $cr = json_decode($s['calc_result'] ?? 'null', true);
                    return [
                        $s['name'],
                        $s['material_name'] ?? '—',
                        $cr ? number_format($cr['slope_area_m2'], 2) : '—',
                        $cr ? $cr['total_sheets'] : '—',
                        $cr ? $cr['sheet_length_mm'] : '—',
                    ];
                }, $this->slopes)
            );
        }

        // --- Специфікація ---
        $pdf->AddPage();
        $this->addHeader($pdf);

        $pdf->SetFont('dejavusans', 'B', 10);
        $pdf->SetTextColor(27, 94, 46);
        $pdf->Cell(0, 7, 'СПЕЦИФІКАЦІЯ МАТЕРІАЛІВ', 0, 1);
        $pdf->SetDrawColor(27, 94, 46);
        $pdf->Line(15, $pdf->GetY(), 195, $pdf->GetY());
        $pdf->Ln(3);

        $types = [
            'sheet'    => 'Основне покриття',
            'accessory'=> 'Доборні елементи',
            'fastener' => 'Кріплення',
        ];

        foreach ($types as $type => $title) {
            $items = array_filter($this->specItems, fn($i) => $i['type'] === $type);
            if (empty($items)) continue;

            $pdf->SetFont('dejavusans', 'B', 9);
            $pdf->SetFillColor(232, 245, 236);
            $pdf->SetTextColor(27, 94, 46);
            $pdf->Cell(0, 6, $title, 0, 1, 'L', true);
            $pdf->SetTextColor(30, 30, 30);

            $this->drawTable($pdf,
                ['Найменування', 'Од.', 'К-сть'],
                [130, 20, 30],
                array_values(array_map(fn($i) => [
                    $i['name'],
                    $i['unit'],
                    rtrim(rtrim(number_format((float)$i['quantity'], 3, '.', ''), '0'), '.'),
                ], $items))
            );
            $pdf->Ln(2);
        }


        // Нотатки
        if (!empty($this->project['notes'])) {
            $pdf->Ln(6);
            $pdf->SetFont('dejavusans', 'B', 9);
            $pdf->SetTextColor(60, 60, 60);
            $pdf->Cell(0, 6, 'Примітки:', 0, 1);
            $pdf->SetFont('dejavusans', '', 9);
            $pdf->MultiCell(0, 5, $this->project['notes'], 0, 'L');
        }

        // Підпис і контакти
        $pdf->Ln(8);
        $pdf->SetDrawColor(200, 200, 200);
        $pdf->Line(15, $pdf->GetY(), 195, $pdf->GetY());
        $pdf->Ln(4);
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->Cell(0, 5, $this->settings['company_name'] ?? 'ArtBudTrading', 0, 1, 'C');
        $pdf->Cell(0, 4, $this->settings['company_phone'] ?? '', 0, 1, 'C');
        $pdf->Cell(0, 4, $this->settings['company_email'] ?? '', 0, 1, 'C');

        return $pdf->Output('', 'S');
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
        $pdf->SetTextColor(27, 94, 46);
        $pdf->Cell(0, 8, 'КАРТА РОЗКРОЮ — ' . strtoupper($this->project['name'] ?? ''), 0, 1, 'C');
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->Cell(0, 5, 'Дата: ' . date('d.m.Y H:i'), 0, 1, 'C');
        $pdf->Ln(4);

        foreach ($this->slopes as $slope) {
            $cr = json_decode($slope['calc_result'] ?? 'null', true);
            if (!$cr || !empty($cr['errors'])) continue;

            $pdf->SetFont('dejavusans', 'B', 10);
            $pdf->SetTextColor(27, 94, 46);
            $pdf->SetFillColor(232, 245, 236);
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
        $pdf->SetCreator('ArtBudTrading Roof Calculator');
        $pdf->SetAuthor($this->settings['company_name'] ?? 'ArtBudTrading');
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

        if ($this->logoPath && file_exists($this->logoPath)) {
            $pdf->Image($this->logoPath, 15, 10, 40, 0, '', '', 'T', false, 300);
        }

        $pdf->SetFont('dejavusans', 'B', 11);
        $pdf->SetTextColor(27, 94, 46);
        $pdf->SetXY($landscape ? 120 : 60, 10);
        $pdf->Cell($pageW - 75, 6, $this->settings['company_name'] ?? 'ArtBudTrading', 0, 1, 'R');
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(100, 100, 100);
        $pdf->SetX($landscape ? 120 : 60);
        $pdf->Cell($pageW - 75, 4, ($this->settings['company_phone'] ?? '') .
            ' | ' . ($this->settings['company_email'] ?? ''), 0, 1, 'R');
        $pdf->SetX($landscape ? 120 : 60);
        $pdf->Cell($pageW - 75, 4, $this->settings['company_address'] ?? 'Україна', 0, 1, 'R');

        $pdf->SetDrawColor(27, 94, 46);
        $pdf->Line(15, 25, $pageW - 15, 25);
        $pdf->Ln(6);
    }

    private function drawTable(\TCPDF $pdf, array $headers, array $widths, array $rows): void
    {
        // Header row
        $pdf->SetFont('dejavusans', 'B', 8);
        $pdf->SetFillColor(27, 94, 46);
        $pdf->SetTextColor(255, 255, 255);
        $pdf->SetDrawColor(200, 200, 200);
        foreach ($headers as $i => $h) {
            $pdf->Cell($widths[$i], 6, $h, 1, 0, 'C', true);
        }
        $pdf->Ln();

        // Data rows
        $pdf->SetFont('dejavusans', '', 8);
        $pdf->SetTextColor(30, 30, 30);
        $fill = false;
        foreach ($rows as $row) {
            $pdf->SetFillColor($fill ? 245 : 255, $fill ? 248 : 255, $fill ? 246 : 255);
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
