// edges.ts — типи ребер ската (сопряження), як у «Кровля Профи»
import { EdgeType, Point } from '../../api/client';
import { Theme } from '../theme/theme';

export const EDGE_TYPES: { key: EdgeType; label: string; color: Record<Theme, string> }[] = [
  { key: 'eave',     label: 'Карниз',        color: { dark: '#6E9BD8', light: '#2F6BC2' } },
  { key: 'ridge',    label: 'Конек',         color: { dark: '#F4F4F2', light: '#1A1A1A' } },
  { key: 'hip',      label: 'Хребет',        color: { dark: '#FF7A00', light: '#C25E00' } },
  { key: 'valley',   label: 'Ендова',        color: { dark: '#5FD39A', light: '#1E7A46' } },
  { key: 'end',      label: 'Фронтон',       color: { dark: '#BFC3C7', light: '#63676C' } },
  { key: 'abutment', label: 'Примикання',    color: { dark: '#C79BFF', light: '#6B3FB5' } },
  { key: 'none',     label: 'Без доборних',  color: { dark: '#5A5E63', light: '#A3A8AD' } },
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
