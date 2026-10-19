<?php
// ============================================
// ArtBudTrading Roof Calculator
// api/export/ExportController.php
// ============================================

namespace RoofCalc\Api\Export;

use RoofCalc\Core\Auth;
use RoofCalc\Core\Database;
use RoofCalc\Exports\PdfGenerator;
use RoofCalc\Exports\ExcelGenerator;

class ExportController
{
    // GET /api/projects/{id}/export/pdf
    public function pdf(int $id): void
    {
        $this->checkAccess($id);
        $gen  = new PdfGenerator($id);
        $data = $gen->generateClientPdf();

        $filename = $this->filename($id, 'КП') . '.pdf';
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($data));
        echo $data;

        $this->log($id, 'project.export_pdf');
        exit;
    }

    // GET /api/projects/{id}/export/excel
    public function excel(int $id): void
    {
        $this->checkAccess($id);
        $gen  = new ExcelGenerator($id);
        $data = $gen->generateManagerExcel();

        $isXlsx    = class_exists('\PhpOffice\PhpSpreadsheet\Spreadsheet');
        $ext       = $isXlsx ? 'xlsx' : 'csv';
        $mime      = $isXlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv; charset=utf-8';

        $filename = $this->filename($id, 'Специфікація') . '.' . $ext;
        header("Content-Type: $mime");
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($data));
        echo $data;

        $this->log($id, 'project.export_excel');
        exit;
    }

    // GET /api/projects/{id}/export/production-pdf
    public function productionPdf(int $id): void
    {
        // Посилання відкривається в новій вкладці — токен приходить у ?token=, як для КП/Excel
        $user = Auth::currentUser();
        if (!$user && !empty($_GET['token'])) {
            $user = Auth::validateToken($_GET['token']);
        }
        if (!$user) { $this->authError(); return; }

        // Виробництво бачить тільки свій PDF без цін
        $project = Database::fetchOne('SELECT user_id FROM projects WHERE id = ?', [$id]);
        if (!$project) { http_response_code(404); exit; }
        if (!in_array($user['role'], ['admin','manager','production'])) {
            http_response_code(403); exit;
        }

        $gen  = new PdfGenerator($id);
        $data = $gen->generateProductionPdf();

        $filename = $this->filename($id, 'Розкрій') . '.pdf';
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        echo $data;
        exit;
    }

    // GET /api/projects/{id}/export/json
    public function projectJson(int $id): void
    {
        $this->checkAccess($id);

        $project = Database::fetchOne('SELECT * FROM projects WHERE id = ?', [$id]);
        $slopes  = Database::fetchAll(
            'SELECT * FROM slopes WHERE project_id = ? ORDER BY sort_order, id', [$id]
        );
        $spec    = Database::fetchAll(
            'SELECT * FROM specification_items WHERE project_id = ? ORDER BY sort_order', [$id]
        );

        foreach ($slopes as &$s) {
            $s['polygon_points'] = json_decode($s['polygon_points'] ?? '[]', true);
            $s['holes']          = json_decode($s['holes'] ?? '[]', true);
            $s['calc_result']    = json_decode($s['calc_result'] ?? 'null', true);
        }

        $export = [
            'version'   => '1.0',
            'exported_at'=> date('c'),
            'project'   => $project,
            'slopes'    => $slopes,
            'specification' => $spec,
        ];

        $filename = $this->filename($id, 'project') . '.json';
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        echo json_encode($export, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    // ---- Helpers ----

    private function checkAccess(int $projectId): void
    {
        // Підтримка токену в query string для прямих посилань
        $token = $_GET['token'] ?? null;
        if ($token) {
            $payload = \RoofCalc\Core\Auth::validateToken($token);
            if (!$payload) { http_response_code(401); exit; }
            return;
        }

        $user = Auth::currentUser();
        if (!$user) { $this->authError(); exit; }

        $project = Database::fetchOne('SELECT user_id FROM projects WHERE id = ?', [$projectId]);
        if (!$project) { http_response_code(404); exit; }
        if (!in_array($user['role'], ['admin','manager'])
            && (int)$project['user_id'] !== (int)$user['sub']) {
            http_response_code(403); exit;
        }
    }

    private function filename(int $id, string $type): string
    {
        $project = Database::fetchOne('SELECT name FROM projects WHERE id = ?', [$id]);
        $name    = preg_replace('/[^а-яА-ЯёЁa-zA-Z0-9\s\-]/u', '', $project['name'] ?? 'project');
        $name    = trim(str_replace(' ', '_', $name));
        return "ABT_{$type}_{$name}_" . date('Ymd');
    }

    private function log(int $projectId, string $action): void
    {
        $user = Auth::currentUser();
        if (!$user) return;
        Database::query(
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?,?,?,?,?)',
            [$user['sub'], $action, 'project', $projectId, $_SERVER['REMOTE_ADDR'] ?? null]
        );
    }

    private function authError(): void
    {
        http_response_code(401);
        echo json_encode(['error' => 'Не авторизовано'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}
