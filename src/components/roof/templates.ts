// ============================================
// ABT Покрівля — шаблони скатів (ліва панель вікна ската, як у «Кровля Профи»)
// Розміри в метрах. Шаблони описані проти годинникової стрілки; buildTemplate переводить у порядок КП.
// ============================================

import { Point } from '../../api/client';

// auto — значення, коли поле порожнє (напр. відступ вершини для рівнобічної фігури); такий параметр може бути 0
export interface TplParam { key: string; label: string; default: number; auto?: (p: Record<string, number>) => number; }
// Розмірна лінія на схемі шаблону: вимірюється між двома точками по горизонталі ('h') або вертикалі ('v'),
// лінія проходить на рівні at (y для 'h', x для 'v'), від точок до неї — виносні лінії.
export interface Dim { k: string; dir: 'h' | 'v'; x1: number; y1: number; x2: number; y2: number; at: number; }
export interface Template {
  id: string;
  name: string;
  params: TplParam[];
  build: (p: Record<string, number>) => Point[];
  dims: (p: Record<string, number>, g: number) => Dim[];
}

const P = (key: string, label: string, def: number): TplParam => ({ key, label, default: def });
// Відступ верхньої точки / основи зліва: порожньо — фігура симетрична (рівнобічна)
const OFF = (key: string, label: string, auto: (p: Record<string, number>) => number): TplParam => ({ key, label, default: NaN, auto });
const H = (k: string, x1: number, y1: number, x2: number, y2: number, at: number): Dim => ({ k, dir: 'h', x1, y1, x2, y2, at });
const V = (k: string, x1: number, y1: number, x2: number, y2: number, at: number): Dim => ({ k, dir: 'v', x1, y1, x2, y2, at });

export const TEMPLATES: Template[] = [
  { id: 'itri', name: 'Трикутник рівнобедрений', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), OFF('a1', 'a1 — від лівого кута до вершини', ({ a }) => a / 2)],
    build: ({ a, h, a1 }) => [[0, 0], [a, 0], [a1, h]] ,
    dims: ({ a, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('a1', 0, 0, a1, h, h + g), V('h', a, 0, a1, h, Math.max(a, a1) + g)] },
  { id: 'rect', name: 'Прямокутник', params: [P('a', 'a — ширина', 6), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [a, h], [0, h]] ,
    dims: ({ a, h }, g) => [H('a', 0, 0, a, 0, -g), V('h', a, 0, a, h, a + g)] },
  { id: 'trap', name: 'Трапеція рівнобічна', params: [P('a', 'a — нижня основа', 10), P('c', 'c — верхня основа', 4), P('h', 'h — висота', 4), OFF('a1', 'a1 — відступ верху зліва', ({ a, c }) => (a - c) / 2)],
    build: ({ a, c, h, a1 }) => [[0, 0], [a, 0], [a1 + c, h], [a1, h]] ,
    dims: ({ a, c, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('c', a1, h, a1 + c, h, h + g), H('a1', 0, 0, a1, h, h + 2.2 * g), V('h', a, 0, a1 + c, h, Math.max(a, a1 + c) + g)] },
  { id: 'trapg', name: 'Трапеція довільна', params: [P('a', 'a — нижня основа', 10), P('c', 'c — верхня основа', 5), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення верху', 2)],
    build: ({ a, c, h, a1 }) => [[0, 0], [a, 0], [a1 + c, h], [a1, h]] ,
    dims: ({ a, c, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('c', a1, h, a1 + c, h, h + g), H('a1', 0, 0, a1, h, h + 2.2 * g), V('h', a, 0, a1 + c, h, Math.max(a, a1 + c) + g)] },
  { id: 'rtril', name: 'Прямокутний трикутник (лівий)', params: [P('a', 'a — основа', 5), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [0, h]] ,
    dims: ({ a, h }, g) => [H('a', 0, 0, a, 0, -g), V('h', 0, 0, 0, h, -g)] },
  { id: 'rtrir', name: 'Прямокутний трикутник (правий)', params: [P('a', 'a — основа', 5), P('h', 'h — висота', 4)],
    build: ({ a, h }) => [[0, 0], [a, 0], [a, h]] ,
    dims: ({ a, h }, g) => [H('a', 0, 0, a, 0, -g), V('h', a, 0, a, h, a + g)] },
  { id: 'tri', name: 'Трикутник довільний', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — проекція вершини', 2)],
    build: ({ a, h, a1 }) => [[0, 0], [a, 0], [a1, h]] ,
    dims: ({ a, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('a1', 0, 0, a1, h, h + g), V('h', a, 0, a1, h, Math.max(a, a1) + g)] },
  { id: 'rtrapl', name: 'Прямокутна трапеція (ліва)', params: [P('a', 'a — нижня основа', 7), P('c', 'c — верхня основа', 3), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [c, h], [0, h]] ,
    dims: ({ a, c, h }, g) => [H('a', 0, 0, a, 0, -g), H('c', 0, h, c, h, h + g), V('h', 0, 0, 0, h, -g)] },
  { id: 'rtrapr', name: 'Прямокутна трапеція (права)', params: [P('a', 'a — нижня основа', 7), P('c', 'c — верхня основа', 3), P('h', 'h — висота', 4)],
    build: ({ a, c, h }) => [[0, 0], [a, 0], [a, h], [a - c, h]] ,
    dims: ({ a, c, h }, g) => [H('a', 0, 0, a, 0, -g), H('c', a - c, h, a, h, h + g), V('h', a, 0, a, h, a + g)] },
  { id: 'parar', name: 'Паралелограм (вправо)', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення', 2)],
    build: ({ a, h, a1 }) => [[0, 0], [a, 0], [a + a1, h], [a1, h]] ,
    dims: ({ a, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('a1', 0, 0, a1, h, h + g), V('h', a, 0, a + a1, h, a + a1 + g)] },
  { id: 'paral', name: 'Паралелограм (вліво)', params: [P('a', 'a — основа', 6), P('h', 'h — висота', 4), P('a1', 'a1 — зміщення', 2)],
    build: ({ a, h, a1 }) => [[a1, 0], [a + a1, 0], [a, h], [0, h]] ,
    dims: ({ a, h, a1 }, g) => [H('a', a1, 0, a + a1, 0, -g), H('a1', 0, h, a1, 0, h + g), V('h', a + a1, 0, a, h, a + a1 + g)] },
  { id: 'itrap', name: 'Трапеція обернена', params: [P('a', 'a — нижня основа', 4), P('c', 'c — верхня основа', 8), P('h', 'h — висота', 3), OFF('a1', 'a1 — відступ низу зліва', ({ a, c }) => (c - a) / 2)],
    build: ({ a, c, h, a1 }) => [[a1, 0], [a1 + a, 0], [c, h], [0, h]] ,
    dims: ({ a, c, h, a1 }, g) => [H('a', a1, 0, a1 + a, 0, -g), H('a1', 0, h, a1, 0, -2.2 * g), H('c', 0, h, c, h, h + g), V('h', a1 + a, 0, c, h, Math.max(c, a1 + a) + g)] },
  { id: 'gable', name: 'Фронтон з карнизом (п’ятикутник)', params: [P('a', 'a — ширина', 6), P('h', 'h — повна висота', 5), P('h1', 'h1 — висота стін', 2), OFF('a1', 'a1 — від лівого краю до вершини', ({ a }) => a / 2)],
    build: ({ a, h, h1, a1 }) => [[0, 0], [a, 0], [a, h1], [a1, h], [0, h1]] ,
    dims: ({ a, h, h1, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('a1', 0, h1, a1, h, h + g), V('h1', a, 0, a, h1, a + g), V('h', a, 0, a1, h, a + 2.2 * g)] },
  { id: 'hexv', name: 'Шестикутник (зламаний фронтон)', params: [P('a', 'a — ширина', 8), P('c', 'c — верх', 2), P('h', 'h — повна висота', 5), P('h1', 'h1 — висота зламу', 3), OFF('a1', 'a1 — відступ верху зліва', ({ a, c }) => (a - c) / 2)],
    build: ({ a, c, h, h1, a1 }) => [[0, 0], [a, 0], [a, h1], [a1 + c, h], [a1, h], [0, h1]] ,
    dims: ({ a, c, h, h1, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('c', a1, h, a1 + c, h, h + g), H('a1', 0, h1, a1, h, h + 2.2 * g), V('h1', a, 0, a, h1, a + g), V('h', a, 0, a1 + c, h, a + 2.2 * g)] },
  { id: 'mans', name: 'Мансардний (ламаний) скат', params: [P('a', 'a — ширина', 8), P('c', 'c — верх', 4), P('h', 'h — висота', 5), P('a1', 'a1 — винос зламу', 0.8), P('h1', 'h1 — висота зламу', 2.5), OFF('a2', 'a2 — відступ верху зліва', ({ a, c }) => (a - c) / 2)],
    build: ({ a, c, h, a1, h1, a2 }) => [[0, 0], [a, 0], [a - a1, h1], [a2 + c, h], [a2, h], [a1, h1]] ,
    dims: ({ a, c, h, a1, h1, a2 }, g) => [H('a', 0, 0, a, 0, -g), H('a1', a - a1, h1, a, 0, -2.2 * g), H('c', a2, h, a2 + c, h, h + g), H('a2', 0, 0, a2, h, h + 2.2 * g), V('h1', a, 0, a - a1, h1, a + g), V('h', a, 0, a2 + c, h, a + 2.2 * g)] },
  { id: 'lshp', name: 'Г-подібний', params: [P('a', 'a — повна ширина', 6), P('b', 'b — повна висота', 4), P('c', 'c — ширина вирізу', 2), P('d', 'd — висота вирізу', 2)],
    build: ({ a, b, c, d }) => [[0, 0], [a, 0], [a, b - d], [a - c, b - d], [a - c, b], [0, b]] ,
    dims: ({ a, b, c, d }, g) => [H('a', 0, 0, a, 0, -g), V('b', 0, 0, 0, b, -g), H('c', a - c, b, a, b - d, b + g), V('d', a, b - d, a - c, b, a + g)] },
  { id: 'step', name: 'Ступінчастий', params: [P('a', 'a — повна ширина', 6), P('b', 'b — повна висота', 4), P('c', 'c — ширина ступеня', 3), P('d', 'd — висота ступеня', 2)],
    build: ({ a, b, c, d }) => [[0, 0], [c, 0], [c, d], [a, d], [a, b], [0, b]] ,
    dims: ({ a, b, c, d }, g) => [H('c', 0, 0, c, 0, -g), H('a', 0, b, a, b, b + g), V('b', 0, 0, 0, b, -g), V('d', c, 0, a, d, a + g)] },
  { id: 'trapcut', name: 'Трапеція з підрізкою карниза', params: [P('a', 'a — карниз', 8), P('c', 'c — конек', 4), P('h', 'h — висота', 4), P('h1', 'h1 — підрізка', 1), OFF('a1', 'a1 — відступ конька зліва', ({ a, c }) => (a - c) / 2)],
    build: ({ a, c, h, h1, a1 }) => { const kl = a1 * (h1 / h), kr = (a - c - a1) * (h1 / h); return [[0, h1], [kl, 0], [a - kr, 0], [a, h1], [a1 + c, h], [a1, h]] as Point[]; } ,
    dims: ({ a, c, h, h1, a1 }, g) => { const kr = (a - c - a1) * (h1 / h); return [H('a', 0, h1, a, h1, -g), H('c', a1, h, a1 + c, h, h + g), H('a1', 0, h1, a1, h, h + 2.2 * g), V('h1', a - kr, 0, a, h1, a + g), V('h', a - kr, 0, a1 + c, h, a + 2.2 * g)]; } },
  { id: 'dormer', name: 'Прямокутник з вирізом під слухове вікно', params: [P('a', 'a — ширина', 8), P('h', 'h — висота', 4), P('c', 'c — ширина вирізу', 2), P('d', 'd — глибина вирізу', 1.5), P('a1', 'a1 — відступ вирізу', 3)],
    build: ({ a, h, c, d, a1 }) => [[0, 0], [a, 0], [a, h], [a1 + c, h], [a1 + c, h - d], [a1, h - d], [a1, h], [0, h]] ,
    dims: ({ a, h, c, d, a1 }, g) => [H('a', 0, 0, a, 0, -g), V('h', a, 0, a, h, a + g), H('a1', 0, h, a1, h, h + g), H('c', a1, h, a1 + c, h, h + g), V('d', a1, h - d, a1, h, a1 + c / 2)] },
  { id: 'trinotch', name: 'Трикутник з підрізаною вершиною', params: [P('a', 'a — основа', 6), P('c', 'c — верх', 1), P('h', 'h — висота', 4), OFF('a1', 'a1 — відступ верху зліва', ({ a, c }) => (a - c) / 2)],
    build: ({ a, c, h, a1 }) => [[0, 0], [a, 0], [a1 + c, h], [a1, h]] ,
    dims: ({ a, c, h, a1 }, g) => [H('a', 0, 0, a, 0, -g), H('c', a1, h, a1 + c, h, h + g), H('a1', 0, 0, a1, h, h + 2.2 * g), V('h', a, 0, a1 + c, h, Math.max(a, a1 + c) + g)] },
];

// Числові значення параметрів: порожнє / невірне — за замовчуванням; «авто»-параметр (відступ) — симетрія, може бути 0
export function templateNums(t: Template, values: Record<string, string | number>, defaultsOnly = false): Record<string, number> {
  const nums: Record<string, number> = {};
  t.params.filter(p => !p.auto).forEach(p => {
    const v = defaultsOnly ? NaN : parseFloat(String(values[p.key] ?? '').replace(',', '.'));
    nums[p.key] = Number.isFinite(v) && v > 0 ? v : p.default;
  });
  t.params.filter(p => p.auto).forEach(p => {
    const raw = defaultsOnly ? '' : String(values[p.key] ?? '').trim();
    const v = parseFloat(raw.replace(',', '.'));
    nums[p.key] = raw !== '' && Number.isFinite(v) && v >= 0 ? v : p.auto!(nums);
  });
  return nums;
}

export function buildTemplate(t: Template, values: Record<string, string | number>): Point[] {
  return toKpOrder(t.build(templateNums(t, values)));
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
  const pts = t.build(templateNums(t, {}, true));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((w - pad * 2) / Math.max(0.001, maxX - minX), (h - pad * 2) / Math.max(0.001, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  return pts.map(([x, y]) => `${(ox + (x - minX) * k).toFixed(1)},${(h - oy - (y - minY) * k).toFixed(1)}`).join(' ');
}

// Буквені позначення сторін: a, b, c … z, a1, b1 …
export const sideLetter = (i: number) => String.fromCharCode(97 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');
