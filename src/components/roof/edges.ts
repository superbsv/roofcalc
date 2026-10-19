// edges.ts — типи ребер ската (сопряження), як у «Кровля Профи»
import { EdgeType, Point } from '../../api/client';
import { Theme } from '../theme/theme';

export const EDGE_TYPES: { key: EdgeType; label: string; color: Record<Theme, string> }[] = [
  { key: 'eave',     label: 'Карниз',        color: { dark: '#6E9BD8', light: '#2F6BC2' } },
  { key: 'ridge',    label: 'Конек',         color: { dark: '#F5F7FA', light: '#151E29' } },
  { key: 'hip',      label: 'Хребет',        color: { dark: '#FF7A1A', light: '#C25E00' } },
  { key: 'valley',   label: 'Ендова',        color: { dark: '#5FD39A', light: '#1E7A46' } },
  { key: 'end',      label: 'Фронтон',       color: { dark: '#C3CBD5', light: '#64748B' } },
  { key: 'abutment', label: 'Примикання',    color: { dark: '#C79BFF', light: '#6B3FB5' } },
  { key: 'none',     label: 'Без доборних',  color: { dark: '#5A5E63', light: '#94A3B8' } },
];

export const edgeLabel = (t: EdgeType) => EDGE_TYPES.find(e => e.key === t)?.label ?? t;
export const edgeColor = (t: EdgeType, theme: Theme) => EDGE_TYPES.find(e => e.key === t)?.color[theme] ?? '#888';

// Автовизначення, як у бекенді: нижня горизонталь — карниз, верхня — конек, решта — фронтон
export function autoEdgeTypes(pts: Point[]): EdgeType[] {
  const n = pts.length;
  if (n < 3) return [];
  const ys = pts.map(p => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    if (a[1] === b[1] && a[1] === minY) return 'eave';
    if (a[1] === b[1] && a[1] === maxY) return 'ridge';
    if (a[0] === b[0]) return 'end';          // вертикальна сторона — фронтон
    if (a[1] !== b[1]) return 'hip';          // похила — хребет (ребро)
    return 'none';
  });
}

export function sideLengthMm(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Прямокутний виріз (мм): лівий нижній кут x,y + ширина, висота
export function rectHole(x: number, y: number, w: number, h: number): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

// Дзеркальне відображення елемента по горизонталі (як «зеркало» у КП).
// Контур розвертається, щоб обхід лишився тим самим; типи ребер переносяться на свої сторони.
export function mirrorElement(pts: Point[], edgeTypes: EdgeType[], holes: Point[][]) {
  const n = pts.length;
  if (n < 3) return { pts, edgeTypes, holes };
  const xs = pts.map(p => p[0]);
  const axis = Math.min(...xs) + Math.max(...xs);
  const m = ([x, y]: Point): Point => [axis - x, y];
  const newPts = pts.map(m).reverse();
  const newEdges: EdgeType[] = edgeTypes.length === n
    ? newPts.map((_, k) => edgeTypes[(n - 2 - k + n) % n])
    : [];
  const newHoles = holes.map(h => h.map(m).reverse());
  return { pts: newPts, edgeTypes: newEdges, holes: newHoles };
}

// Внутрішні кути контуру. Для кожної вершини: кут у градусах і сектор усередині площини
// (start — напрям у радіанах у світових координатах з віссю Y угору, sweep — розмах проти годинникової).
export function interiorAngles(pts: Point[]): { deg: number; start: number; sweep: number }[] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0;
  const TAU = Math.PI * 2;
  return pts.map((v, i) => {
    const p = pts[(i - 1 + n) % n], q = pts[(i + 1) % n];
    const au = Math.atan2(p[1] - v[1], p[0] - v[0]);   // на попередню вершину
    const aw = Math.atan2(q[1] - v[1], q[0] - v[0]);   // на наступну
    const start = ccw ? aw : au;
    const sweep = ((ccw ? au - aw : aw - au) % TAU + TAU) % TAU;
    return { deg: sweep * 180 / Math.PI, start, sweep };
  });
}

export const fmtAngle = (deg: number) => `${(Math.round(deg * 10) / 10).toString().replace('.', ',')}°`;

// ---------- Точне введення розмірів (клік по стороні / по куту) ----------
const EPS = 1e-6;

// Змінити довжину сторони i (від вершини i до i+1). Нерухомою лишається ліва/нижня вершина сторони,
// друга зсувається вздовж сторони разом із вершинами на тій самій вертикалі (для горизонтальної сторони)
// або горизонталі (для решти) — так прямокутник лишається прямокутником, а верх трапеції — горизонтальним.
export function setSideLength(pts: Point[], i: number, len: number): Point[] {
  const n = pts.length;
  if (n < 3 || !(len > 0)) return pts;
  const a = pts[i], b = pts[(i + 1) % n];
  const cur = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (cur < EPS) return pts;
  const horiz = Math.abs(b[1] - a[1]) < EPS * Math.max(1, cur);
  const moveB = horiz ? b[0] >= a[0] : (b[1] > a[1] || (Math.abs(b[1] - a[1]) < EPS && b[0] > a[0]));
  const fixed = moveB ? a : b, mv = moveB ? b : a;
  const ux = (mv[0] - fixed[0]) / cur, uy = (mv[1] - fixed[1]) / cur;
  const d = len - cur;
  const tol = Math.max(1e-6, cur * 1e-6);
  return pts.map(p => {
    if (p === fixed) return p;
    const inGroup = p === mv || (horiz ? Math.abs(p[0] - mv[0]) < tol : Math.abs(p[1] - mv[1]) < tol);
    return inGroup ? [p[0] + ux * d, p[1] + uy * d] as Point : p;
  });
}

// Задати внутрішній кут у вершині i. Сторона до нижчої сусідньої вершини лишається, вища сусідня вершина
// ковзає по своїй горизонталі (висота ската і горизонтальність конька зберігаються).
// Якщо обидві сусідні вершини на рівні вершини — повертається сторона до наступної вершини зі збереженням довжини.
export function setVertexAngle(pts: Point[], i: number, deg: number): Point[] {
  const n = pts.length;
  if (n < 3 || !(deg > 0 && deg < 360)) return pts;
  const angs = interiorAngles(pts);
  const { start, sweep } = angs[i];
  let area = 0;
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0;
  const v = pts[i];
  const pi = (i - 1 + n) % n, ni = (i + 1) % n;
  const startIdx = ccw ? ni : pi, endIdx = ccw ? pi : ni;   // сектор кута: від start-сусіда проти год. стрілки до end-сусіда
  const t = deg * Math.PI / 180;
  // Вершина на горизонтальній стороні (конек / карниз): сама вершина ковзає по цій горизонталі,
  // інша сусідня вершина нерухома — висота і горизонтальність сторони зберігаються.
  const flatP = Math.abs(pts[pi][1] - v[1]) < EPS, flatN = Math.abs(pts[ni][1] - v[1]) < EPS;
  if (flatP !== flatN) {
    const oIdx = flatP ? ni : pi, hIdx = flatP ? pi : ni;
    const o = pts[oIdx], h = pts[hIdx];
    const hdx = Math.sign(h[0] - v[0]) || 1;               // напрям горизонтальної сторони від вершини
    const dy = Math.abs(o[1] - v[1]);
    const phi = Math.atan2(dy, (o[0] - v[0]) * hdx) * 180 / Math.PI;   // нерефлексний кут між сторонами
    const reflex = Math.abs(angs[i].deg - phi) > 1e-3 && Math.abs(angs[i].deg - (360 - phi)) < Math.abs(angs[i].deg - phi);
    const target = reflex ? 360 - deg : deg;
    if (!(target > 0.01 && target < 179.99)) return pts;
    const nx = o[0] - hdx * dy / Math.tan(target * Math.PI / 180);
    const out = pts.map(p => [p[0], p[1]] as Point);
    out[i] = [nx, v[1]];
    return out;
  }
  if (flatP && flatN) return pts;
  // рухаємо вищу сусідню вершину
  const mvIdx = pts[startIdx][1] > pts[endIdx][1] ? startIdx : endIdx;
  const dir = mvIdx === endIdx ? start + t : start + sweep - t;
  const m = pts[mvIdx];
  const out = pts.map(p => [p[0], p[1]] as Point);
  const s = Math.sin(dir), c = Math.cos(dir);
  if (Math.abs(m[1] - v[1]) > EPS && Math.abs(s) > 1e-9 && Math.sign(s) === Math.sign(m[1] - v[1])) {
    const k = (m[1] - v[1]) / s;                 // перетин променя з горизонталлю вершини
    const nx = v[0] + c * k;
    const dx = nx - m[0];
    // вершини на тій самій горизонталі, що утворюють з нею одну сторону, теж не рухаємо — лише цю вершину
    out[mvIdx] = [m[0] + dx, m[1]];
  } else {
    const L = Math.hypot(m[0] - v[0], m[1] - v[1]);
    out[mvIdx] = [v[0] + c * L, v[1] + s * L];
  }
  return out;
}
