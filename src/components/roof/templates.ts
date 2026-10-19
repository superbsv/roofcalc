// ============================================
// ABT Покрівля — шаблони скатів (ліва панель вікна ската, як у «Кровля Профи»)
// Розміри в метрах. Шаблони описані проти годинникової стрілки; buildTemplate переводить у порядок КП.
// ============================================

import { Point } from '../../api/client';

export interface TplParam { key: string; label: string; default: number; }
export interface Template {
  id: string;
  name: string;
  params: TplParam[];
  build: (p: Record<string, number>) => Point[];
}

const P = (key: string, label: string, def: number): TplParam => ({ key, label, default: def });

export const TEMPLATES: Template[] = [
  { id: 'itri', name: 'Трикутник рівнобедрений', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [a / 2, h]] },
  { id: 'rect', name: 'Прямокутник', params: [P('a', 'a — ширина', 6), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [a, h], [0, h]] },
  { id: 'trap', name: 'Трапеція рівнобічна', params: [P('a', 'a — нижня основа', 10), P('c', 'c — верхня основа', 4), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [(a + c) / 2, h], [(a - c) / 2, h]] },
  { id: 'trapg', name: 'Трапеція довільна', params: [P('a', 'a — нижня основа', 10), P('c', 'c — верхня основа', 5), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення верху', 2)],
    build: ({ a, c, h, a1 }) => [[0, 0], [a, 0], [a1 + c, h], [a1, h]] },
  { id: 'rtril', name: 'Прямокутний трикутник (лівий)', params: [P('a', 'a — основа', 5), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [0, h]] },
  { id: 'rtrir', name: 'Прямокутний трикутник (правий)', params: [P('a', 'a — основа', 5), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [a, h]] },
  { id: 'tri', name: 'Трикутник довільний', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — проекція вершини', 2)],
    build: ({ a, h, a1 }) => [[0, 0], [a, 0], [a1, h]] },
  { id: 'rtrapl', name: 'Прямокутна трапеція (ліва)', params: [P('a', 'a — нижня основа', 7), P('c', 'c — верхня основа', 3), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [c, h], [0, h]] },
  { id: 'rtrapr', name: 'Прямокутна трапеція (права)', params: [P('a', 'a — нижня основа', 7), P('c', 'c — верхня основа', 3), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [a, h], [a - c, h]] },
  { id: 'parar', name: 'Паралелограм (вправо)', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення', 2)],
    build: ({ a, h, a1 }) => [[0, 0], [a, 0], [a + a1, h], [a1, h]] },
  { id: 'paral', name: 'Паралелограм (вліво)', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення', 2)],
    build: ({ a, h, a1 }) => [[a1, 0], [a + a1, 0], [a, h], [0, h]] },
  { id: 'itrap', name: 'Трапеція обернена', params: [P('a', 'a — нижня основа', 4), P('c', 'c — верхня основа', 8), P('h', 'h — висота', 3)],
    build: ({ a, c, h }) => [[(c - a) / 2, 0], [(c + a) / 2, 0], [c, h], [0, h]] },
  { id: 'gable', name: 'Фронтон з карнизом (п’ятикутник)', params: [P('a', 'a — ширина', 6), P('h', 'h — повна висота', 5), P('h1', 'h1 — висота стін', 2)],
    build: ({ a, h, h1 }) => [[0, 0], [a, 0], [a, h1], [a / 2, h], [0, h1]] },
  { id: 'hexv', name: 'Шестикутник (зламаний фронтон)', params: [P('a', 'a — ширина', 8), P('c', 'c — верх', 2), P('h', 'h — повна висота', 5), P('h1', 'h1 — висота зламу', 3)],
    build: ({ a, c, h, h1 }) => [[0, 0], [a, 0], [a, h1], [(a + c) / 2, h], [(a - c) / 2, h], [0, h1]] },
  { id: 'mans', name: 'Мансардний (ламаний) скат', params: [P('a', 'a — ширина', 8), P('c', 'c — верх', 4), P('h', 'h — висота', 5), P('a1', 'a1 — винос зламу', 0.8), P('h1', 'h1 — висота зламу', 2.5)],
    build: ({ a, c, h, a1, h1 }) => [[0, 0], [a, 0], [a - a1, h1], [(a + c) / 2, h], [(a - c) / 2, h], [a1, h1]] },
  { id: 'lshp', name: 'Г-подібний', params: [P('a', 'a — повна ширина', 6), P('b', 'b — повна висота', 4), P('c', 'c — ширина вирізу', 2), P('d', 'd — висота вирізу', 2)],
    build: ({ a, b, c, d }) => [[0, 0], [a, 0], [a, b - d], [a - c, b - d], [a - c, b], [0, b]] },
  { id: 'step', name: 'Ступінчастий', params: [P('a', 'a — повна ширина', 6), P('b', 'b — повна висота', 4), P('c', 'c — ширина ступеня', 3), P('d', 'd — висота ступеня', 2)],
    build: ({ a, b, c, d }) => [[0, 0], [c, 0], [c, d], [a, d], [a, b], [0, b]] },
  { id: 'trapcut', name: 'Трапеція з підрізкою карниза', params: [P('a', 'a — карниз', 8), P('c', 'c — конек', 4), P('h', 'h — висота', 4), P('h1', 'h1 — підрізка', 1)],
    build: ({ a, c, h, h1 }) => { const k = ((a - c) / 2) * (h1 / h); return [[0, h1], [k, 0], [a - k, 0], [a, h1], [(a + c) / 2, h], [(a - c) / 2, h]] as Point[]; } },
  { id: 'dormer', name: 'Прямокутник з вирізом під слухове вікно', params: [P('a', 'a — ширина', 8), P('h', 'h — висота', 4), P('c', 'c — ширина вирізу', 2), P('d', 'd — глибина вирізу', 1.5), P('a1', 'a1 — відступ вирізу', 3)],
    build: ({ a, h, c, d, a1 }) => [[0, 0], [a, 0], [a, h], [a1 + c, h], [a1 + c, h - d], [a1, h - d], [a1, h], [0, h]] },
  { id: 'trinotch', name: 'Трикутник з підрізаною вершиною', params: [P('a', 'a — основа', 6), P('c', 'c — верх', 1), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [(a + c) / 2, h], [(a - c) / 2, h]] },
];

export function buildTemplate(t: Template, values: Record<string, string | number>): Point[] {
  const nums: Record<string, number> = {};
  t.params.forEach(p => {
    const v = parseFloat(String(values[p.key] ?? '').replace(',', '.'));
    nums[p.key] = Number.isFinite(v) && v > 0 ? v : p.default;
  });
  return toKpOrder(t.build(nums));
}

// Порядок обходу як у КП: від лівої нижньої вершини за годинниковою стрілкою,
// тож сторона a — ліва, далі верх, права, низ (карниз).
export function toKpOrder(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  let out = area > 0 ? [pts[0], ...pts.slice(1).reverse()] : [...pts];
  // старт — найнижча з найлівіших вершин
  let s = 0;
  out.forEach((p, i) => { const q = out[s]; if (p[1] < q[1] - 1e-9 || (Math.abs(p[1] - q[1]) < 1e-9 && p[0] < q[0])) s = i; });
  out = [...out.slice(s), ...out.slice(0, s)];
  return out;
}

// Іконка шаблону: SVG-полігон, побудований з розмірів за замовчуванням
export function templateIconPoints(t: Template, w = 40, h = 28, pad = 3): string {
  const defaults: Record<string, number> = {};
  t.params.forEach(p => { defaults[p.key] = p.default; });
  const pts = t.build(defaults);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((w - pad * 2) / Math.max(0.001, maxX - minX), (h - pad * 2) / Math.max(0.001, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  return pts.map(([x, y]) => `${(ox + (x - minX) * k).toFixed(1)},${(h - oy - (y - minY) * k).toFixed(1)}`).join(' ');
}

// Буквені позначення сторін: a, b, c … z, a1, b1 …
export const sideLetter = (i: number) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
