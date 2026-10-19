<?php
// ============================================
// ArtBudTrading Roof Calculator
// exports/ExcelGenerator.php
// ============================================

namespace RoofCalc\Exports;

use RoofCalc\Core\Database;

class ExcelGenerator
{
    private array $project;
    private array $slopes;
    private array $specItems;
    private array $settings;

    public function __construct(int $projectId)
    {
        $this->project   = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$projectId]) ?? [];
        $this->slopes    = Database::fetchAll(
            'SELECT s.*, mp.name as material_name, mp.type as material_type
             FROM slopes s LEFT JOIN material_profiles mp ON mp.id = s.material_profile_id
             WHERE s.project_id = ? ORDER BY s.sort_order, s.id', [$projectId]
        );
        $this->specItems = Database::fetchAll(
            'SELECT * FROM specification_items WHERE project_id = ? ORDER BY sort_order, id',
            [$projectId]
        );
        $rows = Database::fetchAll('SELECT key_name, value FROM app_settings');
        $this->settings = [];
        foreach ($rows as $r) { $this->settings[$r['key_name']] = $r['value']; }
    }

    // Excel для менеджера (повна специфікація з цінами)
    public function generateManagerExcel(): string
    {
        if (!class_exists('\PhpOffice\PhpSpreadsheet\Spreadsheet')) {
            return $this->fallbackCsv();
        }

        $ss   = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
        $this->buildSpecSheet($ss->getActiveSheet());

        // Лист 2: Скати
        $ss->createSheet();
        $ss->setActiveSheetIndex(1);
        $this->buildSlopesSheet($ss->getActiveSheet());

        // Лист 3: Розкрій
        $ss->createSheet();
        $ss->setActiveSheetIndex(2);
        $this->buildCutSheet($ss->getActiveSheet());

        $ss->setActiveSheetIndex(0);

        $writer = new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($ss);
        ob_start();
        $writer->save('php://output');
        return ob_get_clean();
    }

    // ============================================
    // Лист 1: Специфікація
    // ============================================
    private function buildSpecSheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $ws): void
    {
        $ws->setTitle('Специфікація');

        // Стилі
        $headerStyle = [
            'font'      => ['bold' => true, 'color' => ['rgb' => 'FFFFFF'], 'size' => 10],
            'fill'      => ['fillType' => 'solid', 'startColor' => ['rgb' => '1B5E2E']],
            'alignment' => ['horizontal' => 'center', 'vertical' => 'center'],
            'borders'   => ['allBorders' => ['borderStyle' => 'thin', 'color' => ['rgb' => 'FFFFFF']]],
        ];
        $sectionStyle = [
            'font'  => ['bold' => true, 'color' => ['rgb' => '1B5E2E']],
            'fill'  => ['fillType' => 'solid', 'startColor' => ['rgb' => 'E8F5EC']],
        ];
        $totalStyle = [
            'font' => ['bold' => true, 'color' => ['rgb' => 'FFFFFF']],
            'fill' => ['fillType' => 'solid', 'startColor' => ['rgb' => '1B5E2E']],
        ];

        // Шапка
        $ws->setCellValue('A1', $this->settings['company_name'] ?? 'ArtBudTrading');
        $ws->getStyle('A1')->getFont()->setBold(true)->setSize(14)->getColor()->setRGB('1B5E2E');

        $ws->setCellValue('A2', 'Специфікація матеріалів');
        $ws->setCellValue('A3', 'Проект: ' . ($this->project['name'] ?? ''));
        $ws->setCellValue('A4', 'Клієнт: ' . ($this->project['client_name'] ?? ''));
        $ws->setCellValue('A5', 'Адреса: ' . ($this->project['object_address'] ?? ''));
        $ws->setCellValue('A6', 'Дата: ' . date('d.m.Y'));

        $row = 8;

        // Заголовки колонок
        $headers = ['№', 'Найменування', 'Од. вим.', 'К-сть', 'Ціна, грн', 'Сума, грн'];
        $colW    = [6, 60, 12, 12, 16, 18];
        $cols    = ['A','B','C','D','E','F'];

        foreach ($headers as $i => $h) {
            $ws->setCellValue($cols[$i] . $row, $h);
            $ws->getStyle($cols[$i] . $row)->applyFromArray($headerStyle);
            $ws->getColumnDimension($cols[$i])->setWidth($colW[$i]);
        }
        $row++;

        $types = [
            'sheet'     => 'Основне покриття',
            'accessory' => 'Доборні елементи',
            'fastener'  => 'Кріплення',
            'other'     => 'Інше',
        ];

        $num         = 1;
        $grandTotal  = 0;

        foreach ($types as $type => $title) {
            $items = array_values(array_filter($this->specItems, fn($i) => $i['type'] === $type));
            if (!$items) continue;

            // Заголовок розділу
            $ws->mergeCells("A{$row}:F{$row}");
            $ws->setCellValue("A{$row}", $title);
            $ws->getStyle("A{$row}")->applyFromArray($sectionStyle);
            $ws->getRowDimension($row)->setRowHeight(18);
            $row++;

            $sectionTotal = 0;
            foreach ($items as $item) {
                $ws->setCellValue("A{$row}", $num++);
                $ws->setCellValue("B{$row}", $item['name']);
                $ws->setCellValue("C{$row}", $item['unit']);
                $ws->setCellValue("D{$row}", $item['quantity']);
                $ws->setCellValue("E{$row}", $item['price']);
                $ws->setCellValue("F{$row}", $item['total']);

                // Формула для суми
                $ws->setCellValue("F{$row}", "=D{$row}*E{$row}");

                // Числовий формат
                $ws->getStyle("E{$row}:F{$row}")->getNumberFormat()
                   ->setFormatCode('#,##0.00');
                $ws->getStyle("D{$row}")->getNumberFormat()->setFormatCode('#,##0.000');

                // Alternating rows
                if ($num % 2 === 0) {
                    $ws->getStyle("A{$row}:F{$row}")->getFill()
                       ->setFillType('solid')->getStartColor()->setRGB('F5F8F5');
                }

                $sectionTotal += (float)$item['total'];
                $grandTotal   += (float)$item['total'];
                $row++;
            }

            // Підсумок розділу
            $ws->setCellValue("E{$row}", 'Підсумок:');
            $ws->setCellValue("F{$row}", $sectionTotal);
            $ws->getStyle("E{$row}:F{$row}")->getFont()->setBold(true);
            $ws->getStyle("F{$row}")->getNumberFormat()->setFormatCode('#,##0.00');
            $row += 2;
        }

        // Знижка
        $discountPct = (float)($this->project['discount_pct'] ?? 0);
        $discount    = $grandTotal * $discountPct / 100;
        if ($discount > 0) {
            $ws->setCellValue("E{$row}", "Знижка {$discountPct}%:");
            $ws->setCellValue("F{$row}", -$discount);
            $ws->getStyle("F{$row}")->getNumberFormat()->setFormatCode('#,##0.00');
            $ws->getStyle("E{$row}:F{$row}")->getFont()->setColor(
                (new \PhpOffice\PhpSpreadsheet\Style\Color())->setRGB('C62828')
            );
            $row++;
        }

        // ПДВ
        $vatPct   = (float)($this->project['vat_pct'] ?? 20);
        $total    = $grandTotal - $discount;
        $vatAmount = $total * $vatPct / (100 + $vatPct);
        $ws->setCellValue("E{$row}", "у т.ч. ПДВ {$vatPct}%:");
        $ws->setCellValue("F{$row}", $vatAmount);
        $ws->getStyle("F{$row}")->getNumberFormat()->setFormatCode('#,##0.00');
        $row++;

        // Загальна сума
        $ws->setCellValue("E{$row}", 'ЗАГАЛЬНА СУМА:');
        $ws->setCellValue("F{$row}", $total);
        $ws->getStyle("E{$row}:F{$row}")->applyFromArray($totalStyle);
        $ws->getStyle("F{$row}")->getNumberFormat()->setFormatCode('#,##0.00 "грн"');
    }

    // ============================================
    // Лист 2: Скати
    // ============================================
    private function buildSlopesSheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $ws): void
    {
        $ws->setTitle('Скати');
        $headers = ['Скат', 'Матеріал', 'Тип', 'Площа, м²', 'Листів', 'Довж. листа, мм', 'Відходи, %', 'Попередження'];
        foreach ($headers as $i => $h) {
            $ws->setCellValue(\PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex($i+1) . '1', $h);
        }
        $ws->getStyle('A1:H1')->getFont()->setBold(true);
        $ws->getStyle('A1:H1')->getFill()->setFillType('solid')->getStartColor()->setRGB('1B5E2E');
        $ws->getStyle('A1:H1')->getFont()->getColor()->setRGB('FFFFFF');

        $row = 2;
        foreach ($this->slopes as $s) {
            $cr = json_decode($s['calc_result'] ?? 'null', true);
            $ws->setCellValue("A{$row}", $s['name']);
            $ws->setCellValue("B{$row}", $s['material_name'] ?? '');
            $ws->setCellValue("C{$row}", $s['material_type'] ?? '');
            $ws->setCellValue("D{$row}", $cr['slope_area_m2'] ?? '');
            $ws->setCellValue("E{$row}", $cr['total_sheets'] ?? '');
            $ws->setCellValue("F{$row}", $cr['sheet_length_mm'] ?? '');
            $ws->setCellValue("G{$row}", $cr['waste_pct'] ?? '');
            $ws->setCellValue("H{$row}", implode('; ', $cr['warnings'] ?? []));
            $row++;
        }

        foreach (['A'=>30,'B'=>30,'C'=>14,'D'=>14,'E'=>12,'F'=>20,'G'=>14,'H'=>50] as $col => $w) {
            $ws->getColumnDimension($col)->setWidth($w);
        }
    }

    // ============================================
    // Лист 3: Карта розкрою
    // ============================================
    private function buildCutSheet(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $ws): void
    {
        $ws->setTitle('Карта розкрою');
        $ws->setCellValue('A1', 'КАРТА РОЗКРОЮ');
        $ws->getStyle('A1')->getFont()->setBold(true)->setSize(12)->getColor()->setRGB('1B5E2E');

        $row = 3;
        foreach ($this->slopes as $s) {
            $cr = json_decode($s['calc_result'] ?? 'null', true);
            if (!$cr || empty($cr['sheets_by_length'])) continue;

            $ws->setCellValue("A{$row}", $s['name']);
            $ws->getStyle("A{$row}")->getFont()->setBold(true)->getColor()->setRGB('1B5E2E');
            $row++;

            $ws->setCellValue("A{$row}", 'Довжина, мм');
            $ws->setCellValue("B{$row}", 'Ширина повна, мм');
            $ws->setCellValue("C{$row}", 'К-сть, шт');
            $ws->setCellValue("D{$row}", 'Площа замовл., м²');
            $ws->getStyle("A{$row}:D{$row}")->getFont()->setBold(true);
            $row++;

            foreach ($cr['sheets_by_length'] as $g) {
                $ws->setCellValue("A{$row}", $g['length_mm']);
                $ws->setCellValue("B{$row}", $g['full_width_mm']);
                $ws->setCellValue("C{$row}", $g['count']);
                $ws->setCellValue("D{$row}", $g['full_area_m2']);
                $row++;
            }
            $row++;
        }
    }

    private function fallbackCsv(): string
    {
        $lines = ["Найменування;Од.;К-сть;Ціна;Сума"];
        foreach ($this->specItems as $item) {
            $lines[] = implode(';', [
                $item['name'], $item['unit'],
                $item['quantity'], $item['price'], $item['total']
            ]);
        }
        return implode("\n", $lines);
    }
}
