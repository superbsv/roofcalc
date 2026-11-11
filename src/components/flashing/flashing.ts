// ============================================
// Креслення добірних елементів (планки, коньки, відливи…): геометрія профілю і розрахунок заготовки.
// Профіль — ламана з відрізків: довжина сторони (мм) і внутрішній кут загину ПІСЛЯ неї (°, як на кресленнях
// гнучки: 90° — прямий кут, 135° — тупий, 0° — закатка / загин 180°), напрям загину — вліво чи вправо.
// Розгортка (ширина заготовки) = сума сторін. З листа металу шириною W виходить ⌊W / розгортка⌋ смуг.
// ============================================

export interface FSeg { len: number; ang: number; dir: 1 | -1 }
export interface FElem {
  id: string;
  name: string;
  segs: FSeg[];
  start: number;          // напрям першої сторони, ° (0 — вправо, 90 — вгору)
  paint: 1 | -1;          // фарбована сторона: 1 — ліворуч по ходу креслення, -1 — праворуч
  length: number;         // довжина виробу, мм
  qty: number;            // кількість, шт
  note?: string;
}
export interface FDoc {
  client?: string; color?: string; coating?: string; thickness?: string;
  sheet_width: number;    // ширина листа / рулону металу, мм
  sheet_length?: number;  // довжина листа, мм (стандарт 2000 — виріб завжди на всю довжину листа)
  nest?: boolean;         // оптимальний розкрій: змішувати заготовки різних елементів на одному листі
  note?: string;
  items: FElem[];
}

export const newId = () => Math.random().toString(36).slice(2, 9);

export interface SegGeo { a: [number, number]; b: [number, number]; h: number }   // h — напрям, рад
export interface BendGeo { at: [number, number]; h1: number; h2: number; ang: number; hem: boolean; dir: 1 | -1 }

/** Геометрія профілю у мм (вісь Y — вгору). Закатка (кут < 8°) розводить сторони на hemGap, щоб загин було видно */
export function profileGeo(e: FElem, hemGap = 0): { segs: SegGeo[]; bends: BendGeo[] } {
  let x = 0, y = 0, h = (e.start * Math.PI) / 180;
  const segs: SegGeo[] = [], bnds: BendGeo[] = [];
  e.segs.forEach((s, i) => {
    const a: [number, number] = [x, y];
    x += (Number(s.len) || 0) * Math.cos(h); y += (Number(s.len) || 0) * Math.sin(h);
    segs.push({ a, b: [x, y], h });
    if (i < e.segs.length - 1) {
      const ang = Math.max(0, Math.min(180, Number(s.ang) || 0));
      const h2 = h + (s.dir * (180 - ang) * Math.PI) / 180;
      const hem = ang < 8;
      const at: [number, number] = [x, y];
      if (hem && hemGap > 0) { x += -Math.sin(h) * s.dir * hemGap; y += Math.cos(h) * s.dir * hemGap; }
      bnds.push({ at, h1: h, h2, ang, hem, dir: s.dir });
      h = h2;
    }
  });
  return { segs, bends: bnds };
}

export const girth = (e: FElem) => e.segs.reduce((a, s) => a + (Number(s.len) || 0), 0);
export const bends = (e: FElem) => Math.max(0, e.segs.length - 1);

export function blankCalc(e: FElem, sheetW: number, sheetL = 2000) {
  const g = girth(e);
  const strips = g > 0 ? Math.floor((sheetW + 1e-9) / g) : 0;
  const need = stripsNeeded(e, sheetL);
  const sheets = strips > 0 ? Math.ceil(need / strips) : 0;
  return {
    girth: g,
    bends: bends(e),
    strips,                                                   // заготовок з одного листа
    need,                                                     // смуг (заготовок) потрібно
    sheets,                                                   // листів, якщо кроїти лише цей елемент
    area: (g * (e.length || 0) * (e.qty || 0)) / 1e6,         // м² у виробах (за розгорткою)
    metal: (sheets * sheetW * sheetL) / 1e6,                  // м² металу з урахуванням обрізків
    runM: ((e.length || 0) * (e.qty || 0)) / 1000,            // погонних метрів виробів
  };
}

const S = (len: number, ang = 90, dir: 1 | -1 = 1): FSeg => ({ len, ang, dir });
const E = (name: string, start: number, segs: FSeg[], paint: 1 | -1 = 1): Omit<FElem, 'id'> =>
  ({ name, start, segs, paint, length: 2000, qty: 1 });

// Шаблони — типові форми (розміри примірні, їх змінюють під об'єкт)
export const FLASH_TEMPLATES: Omit<FElem, 'id'>[] = [
  E('Кутова планка', 270, [S(100, 90, 1), S(100)], -1),
  E('Конек плоский', 90, [S(15, 120, -1), S(150, 120, -1), S(150, 120, -1), S(15)], 1),
  E('Карнизна планка', 180, [S(10, 0, -1), S(100, 105, -1), S(70, 135, 1), S(20)], 1),
  E('Вітрова (торцева) планка', 0, [S(10, 0, 1), S(100, 90, 1), S(120, 90, 1), S(20)], -1),
  E('Ендова нижня', 270, [S(20, 120, 1), S(300, 120, 1), S(300, 120, 1), S(20)], 1),
  E('Ендова верхня', 270, [S(15, 135, 1), S(120, 90, 1), S(120, 135, 1), S(15)], 1),
  E('Примикання верхнє', 0, [S(20, 90, -1), S(150, 120, -1), S(150, 0, 1), S(10)], -1),
  E('Примикання бокове', 0, [S(20, 90, -1), S(150, 90, -1), S(150, 90, 1), S(20)], -1),
  E('Відлив віконний', 270, [S(20, 95, 1), S(200, 95, -1), S(40, 135, 1), S(15)], 1),
  E('Парапетна (П-подібна) планка', 90, [S(50, 90, -1), S(300, 90, -1), S(50)], 1),
  E('Порожній профіль', 0, [S(100, 90, 1), S(100)], 1),
];

export const newElem = (tpl: Omit<FElem, 'id'>): FElem => ({ ...JSON.parse(JSON.stringify(tpl)), id: newId() });
export const emptyDoc = (): FDoc => ({ sheet_width: 1250, sheet_length: 2000, nest: true, items: [newElem(FLASH_TEMPLATES[1])] });

// ============================================
// Малювання мишкою: профіль = «основна» ламана (точки) + закатки на кінцях.
// Закатка на початку: перший загин 0° (сторона 0 — закатка); у кінці: останній загин 0° (остання сторона — закатка).
// ============================================
export type Pt = [number, number];
export const HEM_LEN = 10;   // стандартна закатка, мм
export interface Hem { len: number; dir: 1 | -1 }
export interface Core { start: number; segs: FSeg[]; hemS: Hem | null; hemE: Hem | null }

const norm360 = (a: number) => ((a % 360) + 360) % 360;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function splitCore(e: FElem): Core {
  let segs = e.segs.map(s => ({ ...s }));
  let start = e.start, hemS: Hem | null = null, hemE: Hem | null = null;
  if (segs.length >= 2 && (Number(segs[0].ang) || 0) < 8) {
    hemS = { len: segs[0].len, dir: segs[0].dir };
    start = norm360(start + segs[0].dir * 180);
    segs = segs.slice(1);
  }
  if (segs.length >= 2 && (Number(segs[segs.length - 2].ang) || 0) < 8) {
    const pre = segs[segs.length - 2];
    hemE = { len: segs[segs.length - 1].len, dir: pre.dir };
    segs = segs.slice(0, -1);
    segs[segs.length - 1] = { ...segs[segs.length - 1], ang: 90, dir: 1 };
  }
  return { start, segs, hemS, hemE };
}

export function joinCore(c: Core): Pick<FElem, 'segs' | 'start'> {
  let segs = c.segs.map(s => ({ ...s })), start = c.start;
  if (!segs.length) return { segs: [], start };
  if (c.hemE) {
    segs[segs.length - 1] = { ...segs[segs.length - 1], ang: 0, dir: c.hemE.dir };
    segs.push({ len: c.hemE.len, ang: 90, dir: 1 });
  }
  if (c.hemS) {
    segs = [{ len: c.hemS.len, ang: 0, dir: c.hemS.dir }, ...segs];
    start = norm360(start - c.hemS.dir * 180);
  }
  return { segs, start };
}

/** Точки основної ламаної (мм, Y — вгору), перша — у (0,0) */
export function corePts(c: Core): Pt[] {
  let x = 0, y = 0, h = (c.start * Math.PI) / 180;
  const pts: Pt[] = [[0, 0]];
  c.segs.forEach((s, i) => {
    x += (Number(s.len) || 0) * Math.cos(h); y += (Number(s.len) || 0) * Math.sin(h);
    pts.push([x, y]);
    if (i < c.segs.length - 1) h += (s.dir * (180 - (Number(s.ang) || 0)) * Math.PI) / 180;
  });
  return pts;
}
/** Напрями сторін основної ламаної, рад */
export function coreHeads(c: Core): number[] {
  let h = (c.start * Math.PI) / 180;
  return c.segs.map((s, i) => { const r = h; if (i < c.segs.length - 1) h += (s.dir * (180 - (Number(s.ang) || 0)) * Math.PI) / 180; return r; });
}

/** Сторони і кути з точок (довжини — 0,1 мм, кути — 0,1°) */
export function ptsToCore(pts: Pt[], hemS: Hem | null, hemE: Hem | null): Core {
  const hs: number[] = [], segs: FSeg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    hs.push(Math.atan2(dy, dx) * 180 / Math.PI);
    segs.push({ len: r1(Math.hypot(dx, dy)), ang: 90, dir: 1 });
  }
  for (let i = 0; i < segs.length - 1; i++) {
    let t = hs[i + 1] - hs[i];
    while (t > 180) t -= 360;
    while (t <= -180) t += 360;
    segs[i].ang = r1(180 - Math.abs(t));
    segs[i].dir = t >= 0 ? 1 : -1;
  }
  return { start: r1(norm360(hs[0] ?? 0)), segs, hemS, hemE };
}

// ============================================
// Розкрій листа: кожен виріб — смуга шириною «розгортка» на всю довжину листа (стандарт 1250 × 2000).
// Смуги різних елементів комбінуються на одному листі так, щоб відходів було якнайменше (1D-розкрій).
// ============================================
export interface NestSheet { strips: number[]; used: number; waste: number }   // strips — індекси елементів
export interface NestPlan { count: number; pattern: number[]; used: number; waste: number }
export interface Nest { sheets: number; plans: NestPlan[]; usedArea: number; sheetArea: number; wastePct: number; tooWide: number[]; tooLong: number[] }

/** Скільки смуг потрібно елементу: з однієї смуги на довжину листа виходить ⌊L листа / L виробу⌋ виробів */
export function stripsNeeded(e: FElem, sheetL: number) {
  const L = Number(e.length) || 0, q = Math.max(0, Math.round(Number(e.qty) || 0));
  if (!q || L <= 0) return 0;
  const per = L <= sheetL ? Math.max(1, Math.floor(sheetL / L)) : 1;
  return Math.ceil(q / per);
}

function ffd(items: { w: number; i: number }[], W: number, best: boolean): NestSheet[] {
  const bins: NestSheet[] = [];
  [...items].sort((a, b) => b.w - a.w).forEach(it => {
    let k = -1;
    for (let j = 0; j < bins.length; j++) {
      if (bins[j].waste + 1e-9 >= it.w && (k < 0 || !best || bins[j].waste < bins[k].waste)) { k = j; if (!best) break; }
    }
    if (k < 0) { bins.push({ strips: [], used: 0, waste: W }); k = bins.length - 1; }
    bins[k].strips.push(it.i); bins[k].used += it.w; bins[k].waste -= it.w;
  });
  return bins;
}

/** Жадібно: кожен лист заповнюємо найкращою комбінацією смуг (обмежений рюкзак по ширині, крок 0,5 мм) */
function knapGreedy(types: { w: number; i: number; n: number }[], W: number): NestSheet[] {
  const Q = 2, cap = Math.floor(W * Q + 1e-6);
  const left = types.map(t => ({ ...t, u: Math.ceil(t.w * Q - 1e-6) }));
  const out: NestSheet[] = [];
  let guard = 0;
  while (left.some(t => t.n > 0) && guard++ < 10000) {
    // dp[c] — максимальне заповнення ≤ c; from[c] — елемент і попередня ємність
    const dp = new Int32Array(cap + 1).fill(-1); dp[0] = 0;
    const prev = new Int32Array(cap + 1).fill(-1), what = new Int32Array(cap + 1).fill(-1);
    left.forEach((t, ti) => {
      if (t.n <= 0 || t.u > cap) return;
      // двійкове розбиття кількості
      let n = Math.min(t.n, Math.floor(cap / t.u)), m = 1;
      while (n > 0) {
        const take = Math.min(m, n); n -= take; m *= 2;
        const w = t.u * take;
        for (let c = cap; c >= w; c--) if (dp[c - w] >= 0 && dp[c] < 0) { dp[c] = 1; prev[c] = c - w; what[c] = ti * 100000 + take; }
      }
    });
    let c = cap; while (c > 0 && dp[c] < 0) c--;
    if (c <= 0) break;
    const sh: NestSheet = { strips: [], used: 0, waste: W };
    while (c > 0) {
      const ti = Math.floor(what[c] / 100000), take = what[c] % 100000;
      for (let k = 0; k < take; k++) { sh.strips.push(left[ti].i); sh.used += left[ti].w; sh.waste -= left[ti].w; }
      left[ti].n -= take; c = prev[c];
    }
    out.push(sh);
  }
  return out;
}

export function nestPlan(items: FElem[], W: number, sheetL: number, mix = true): Nest {
  const tooWide: number[] = [], tooLong: number[] = [];
  const types: { w: number; i: number; n: number }[] = [];
  items.forEach((e, i) => {
    const w = girth(e), n = stripsNeeded(e, sheetL);
    if (!n || w <= 0) return;
    if (w > W + 1e-9) { tooWide.push(i); return; }
    if ((Number(e.length) || 0) > sheetL) tooLong.push(i);
    types.push({ w, i, n });
  });
  let sheets: NestSheet[];
  if (!mix) {
    sheets = [];
    types.forEach(t => { const per = Math.floor((W + 1e-9) / t.w); for (let n = t.n; n > 0; n -= per) { const k = Math.min(per, n); sheets.push({ strips: Array(k).fill(t.i), used: k * t.w, waste: W - k * t.w }); } });
  } else {
    const flat = types.flatMap(t => Array.from({ length: t.n }, () => ({ w: t.w, i: t.i })));
    const cand = [ffd(flat, W, false), ffd(flat, W, true)];
    if (flat.length <= 5000) cand.push(knapGreedy(types, W));
    sheets = cand.reduce((a, b) => (b.length < a.length ? b : a));
  }
  // однакові листи — групуємо в схеми
  const map = new Map<string, NestPlan>();
  sheets.forEach(s => {
    const pattern = [...s.strips].sort((a, b) => girth(items[b]) - girth(items[a]) || a - b);
    const key = pattern.join(',');
    const p = map.get(key);
    if (p) p.count++; else map.set(key, { count: 1, pattern, used: s.used, waste: s.waste });
  });
  const plans = [...map.values()].sort((a, b) => b.count - a.count || a.waste - b.waste);
  const usedArea = sheets.reduce((a, s) => a + s.used, 0) * sheetL / 1e6;
  const sheetArea = sheets.length * W * sheetL / 1e6;
  return { sheets: sheets.length, plans, usedArea, sheetArea, wastePct: sheetArea ? (1 - usedArea / sheetArea) * 100 : 0, tooWide, tooLong };
}
