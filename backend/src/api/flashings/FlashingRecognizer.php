<?php
// ============================================
// ROOFKIT — api/flashings/FlashingRecognizer.php
// Розпізнавання ескізу добору з фото (малюнок від руки) через Claude API (Anthropic).
// Ключ API зберігає супер-адмін у налаштуваннях платформи (app_settings.anthropic_api_key) —
// він ніколи не віддається на фронтенд і не лежить у репозиторії. PHP 7.4.
// Відповідь моделі — структурований виклик інструмента: елементи зі сторонами (довжина + напрям на малюнку),
// підписаними кутами, закатками і фарбованим боком; у профіль (сторони + кути загинів) перетворює фронтенд.
// ============================================

namespace RoofCalc\Api\Flashings;

use RoofCalc\Core\Database;

class FlashingRecognizer
{
    public const KEY = 'anthropic_api_key';
    public const MODEL_KEY = 'anthropic_model';
    public const DEFAULT_MODEL = 'claude-sonnet-5-5';

    /** Рядки налаштувань для ключа і моделі (якщо їх ще немає) */
    public static function ensureSettings(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;
        foreach ([
            [self::KEY, '', 'Claude API key (Anthropic): flashing sketch photo recognition'],
            [self::MODEL_KEY, self::DEFAULT_MODEL, 'Claude model for photo recognition'],
        ] as [$k, $v, $d]) {
            if (!Database::fetchOne('SELECT key_name FROM app_settings WHERE key_name = ?', [$k])) {
                Database::query("INSERT INTO app_settings (key_name, value, type, description, updated_at) VALUES (?, ?, 'string', ?, NOW())", [$k, $v, $d]);
            }
        }
    }

    public static function apiKey(): string
    {
        self::ensureSettings();
        $r = Database::fetchOne('SELECT value FROM app_settings WHERE key_name = ?', [self::KEY]);
        return trim((string)($r['value'] ?? ''));
    }

    private static function model(): string
    {
        $r = Database::fetchOne('SELECT value FROM app_settings WHERE key_name = ?', [self::MODEL_KEY]);
        $m = trim((string)($r['value'] ?? ''));
        return $m !== '' ? $m : self::DEFAULT_MODEL;
    }

    /** Схема відповіді (англійською — це текст для моделі, не інтерфейс) */
    public static function tool(): array
    {
        $hem = [
            'type' => 'object',
            'description' => 'Hem (edge folded back 180 degrees; drawn as a small hook or loop at the end of the line).',
            'properties' => [
                'present' => ['type' => 'boolean', 'description' => 'true if this end has a hem'],
                'len' => ['type' => 'number', 'description' => 'Hem length in mm; 10 if not written; 0 if no hem'],
                'side' => ['type' => 'string', 'enum' => ['left', 'right', 'unknown'], 'description' => 'Side the hem is folded to, relative to travelling along the profile from the first point to the last'],
            ],
            'required' => ['present', 'len', 'side'],
        ];
        return [
            'name' => 'flashing_sketches',
            'description' => 'Record every sheet-metal flashing element recognised in the sketch photo.',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'elements' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'name' => ['type' => 'string', 'description' => 'Name written on the sketch, in Ukrainian; otherwise a short Ukrainian name by shape'],
                                'qty' => ['type' => 'integer', 'description' => 'Quantity (pcs) if written; 0 if not'],
                                'length_mm' => ['type' => 'number', 'description' => 'Product length in mm if written (e.g. L=2000, 2 m); 0 if not'],
                                'sides' => [
                                    'type' => 'array',
                                    'description' => 'Profile sides in order from one end to the other, WITHOUT hems.',
                                    'items' => [
                                        'type' => 'object',
                                        'properties' => [
                                            'len' => ['type' => 'number', 'description' => 'Side length in mm (the number written next to it)'],
                                            'dir_deg' => ['type' => 'number', 'description' => 'Direction of the side as drawn, degrees: 0 right, 90 up, 180 left, 270 down (5 degree steps)'],
                                        ],
                                        'required' => ['len', 'dir_deg'],
                                    ],
                                ],
                                'angles' => [
                                    'type' => 'array',
                                    'description' => 'Written inner bend angles between neighbouring sides (count = sides - 1); 0 if the angle is not written.',
                                    'items' => ['type' => 'number'],
                                ],
                                'hem_start' => $hem,
                                'hem_end' => $hem,
                                'paint_side' => ['type' => 'string', 'enum' => ['left', 'right', 'unknown'], 'description' => 'Painted (face) side relative to travelling from the first point to the last, if marked (hatching, double line, or a word meaning colour or paint)'],
                                'unclear' => ['type' => 'string', 'description' => 'What was illegible or guessed, briefly, in Ukrainian; empty if all clear'],
                            ],
                            'required' => ['name', 'qty', 'length_mm', 'sides', 'angles', 'hem_start', 'hem_end', 'paint_side'],
                        ],
                    ],
                ],
                'required' => ['elements'],
            ],
        ];
    }

    private const PROMPT = "The photo shows hand-drawn sketches of sheet-metal flashings (trims) to be bent on a folding machine: eave, gable/rake, wall abutment, ridge, valley, drip and similar trims. "
        . "Each profile is a polyline; side lengths in mm are written next to the sides, bend angles may be written at the bends. Labels may be in Ukrainian or Russian. "
        . "Recognise every element and call the flashing_sketches tool.\n"
        . "Rules:\n"
        . "- List sides in order from one end of the profile to the other; dir_deg is the direction as drawn (0 right, 90 up).\n"
        . "- Take lengths from the written numbers; if a side has no number, estimate it proportionally and say so in unclear.\n"
        . "- A hem is a short 180-degree fold at an end (hook, loop, words like завальцовка, закатка, завал). Do NOT include it in sides; set hem_start / hem_end present=true. Without a hem: present=false, len=0, side=unknown.\n"
        . "- Right angles are often not written: then 0. A written angle is the inner angle between the sides.\n"
        . "- Quantity (шт) and product length (L, m or mm) if written next to the element.\n"
        . "- If there is no flashing sketch in the photo, return an empty elements list.";

    /** @return array{elements: array} */
    public static function recognize(string $base64, string $media): array
    {
        $key = self::apiKey();
        if ($key === '') throw new \RuntimeException('NO_KEY');
        $payload = [
            'model' => self::model(),
            'max_tokens' => 4000,
            'tools' => [self::tool()],
            'tool_choice' => ['type' => 'tool', 'name' => 'flashing_sketches'],
            'messages' => [[
                'role' => 'user',
                'content' => [
                    ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $media, 'data' => $base64]],
                    ['type' => 'text', 'text' => self::PROMPT],
                ],
            ]],
        ];
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'content-type: application/json',
                'x-api-key: ' . $key,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) throw new \RuntimeException('NET: ' . $err);
        $res = json_decode((string)$raw, true);
        if ($code !== 200) {
            $msg = $res['error']['message'] ?? ('HTTP ' . $code);
            throw new \RuntimeException('API ' . $code . ': ' . $msg);
        }
        foreach ($res['content'] ?? [] as $c) {
            if (($c['type'] ?? '') === 'tool_use' && ($c['name'] ?? '') === 'flashing_sketches') {
                $els = $c['input']['elements'] ?? [];
                return ['elements' => is_array($els) ? array_values($els) : []];
            }
        }
        return ['elements' => []];
    }
}
