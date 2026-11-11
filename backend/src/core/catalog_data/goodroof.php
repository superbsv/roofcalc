<?php
// Металочерепиця заводу Good Roof — за «Таблицею технологічних діапазонів» виробника.
// Стандартний лист = 350 × n + база; рекомендовані розміри — від стандарту до верхньої межі;
// недопустимі — від неї до наступного стандарту (межі в таблиці — перший / останній недопустимий розмір).
// Retro-Roof: у таблиці 730–840 при рекомендованих до 720 і наступному стандарті 850 — проміжки 721–729
// і 841–849 теж не рекомендовані, тож діапазон записано як 721–849.
// Maxi-Roof, 19 тайлів: у таблиці «6756–4084» — помилка друку, має бути 7084.
$mk = function (int $base, int $rec, int $rows): array {
    $r = [];
    for ($n = 1; $n <= $rows; $n++) { $s = 350 * $n + $base; $r[] = [$s + $rec + 1, $s + 349]; }
    return $r;
};
return [
    ['name' => 'Classic-Roof 350/15', 'full_width' => 1200, 'useful_width' => 1110, 'wave_height' => 15, 'length_overlap' => 130,
     'min_length' => 480, 'max_length' => 7700, 'forbidden_lengths' => $mk(130, 220, 21)],
    ['name' => 'Maxi-Roof 350/20', 'full_width' => 1195, 'useful_width' => 1145, 'wave_height' => 20, 'length_overlap' => 130,
     'min_length' => 456, 'max_length' => 7434, 'forbidden_lengths' => $mk(106, 328, 20)],
    ['name' => 'Premium-Roof 350/30', 'full_width' => 1116, 'useful_width' => 1000, 'wave_height' => 30, 'length_overlap' => 120,
     'min_length' => 450, 'max_length' => 7695, 'forbidden_lengths' => $mk(100, 245, 21)],
    ['name' => 'Retro-Roof 350/20', 'full_width' => 1195, 'useful_width' => 1105, 'wave_height' => 20, 'length_overlap' => 130,
     'min_length' => 500, 'max_length' => 7720, 'forbidden_lengths' => $mk(150, 220, 21)],
];
