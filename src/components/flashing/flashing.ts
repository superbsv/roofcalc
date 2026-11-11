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

export function blankCalc(e: FElem, sheetW: number) {
  const g = girth(e);
  const strips = g > 0 ? Math.floor(sheetW / g) : 0;
  const sheets = strips > 0 ? Math.ceil((e.qty || 0) / strips) : 0;
  return {
    girth: g,
    bends: bends(e),
    strips,                                                   // заготовок з одного листа
    sheets,                                                   // листів металу довжиною виробу
    area: (g * (e.length || 0) * (e.qty || 0)) / 1e6,         // м² у виробах (за розгорткою)
    metal: (sheets * sheetW * (e.length || 0)) / 1e6,         // м² металу з урахуванням обрізків
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
  E('Карнизна планка', 180, [S(12, 0, -1), S(100, 105, -1), S(70, 135, 1), S(20)], 1),
  E('Вітрова (торцева) планка', 0, [S(12, 0, 1), S(100, 90, 1), S(120, 90, 1), S(20)], -1),
  E('Ендова нижня', 270, [S(20, 120, 1), S(300, 120, 1), S(300, 120, 1), S(20)], 1),
  E('Ендова верхня', 270, [S(15, 135, 1), S(120, 90, 1), S(120, 135, 1), S(15)], 1),
  E('Примикання верхнє', 0, [S(20, 90, -1), S(150, 120, -1), S(150, 0, 1), S(12)], -1),
  E('Примикання бокове', 0, [S(20, 90, -1), S(150, 90, -1), S(150, 90, 1), S(20)], -1),
  E('Відлив віконний', 270, [S(20, 95, 1), S(200, 95, -1), S(40, 135, 1), S(15)], 1),
  E('Парапетна (П-подібна) планка', 90, [S(50, 90, -1), S(300, 90, -1), S(50)], 1),
  E('Порожній профіль', 0, [S(100, 90, 1), S(100)], 1),
];

export const newElem = (tpl: Omit<FElem, 'id'>): FElem => ({ ...JSON.parse(JSON.stringify(tpl)), id: newId() });
export const emptyDoc = (): FDoc => ({ sheet_width: 1250, items: [newElem(FLASH_TEMPLATES[1])] });
