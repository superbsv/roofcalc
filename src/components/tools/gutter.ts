// ============================================
// Розрахунок водостічної системи (як калькулятор profil.com.ua):
// тип даху → розміри карнизів → колір → специфікація елементів.
// Усі розміри в метрах.
// ============================================

export type RoofKind = 'shed' | 'gable' | 'hip' | 'L' | 'U' | 'T' | 'X';

export interface KindDef {
  id: RoofKind;
  name: string;
  /** Поля, які вводить користувач (літери на схемі) */
  fields: { k: string; label: string; def: number }[];
  /** Відкритий контур (жолоби із заглушками) чи замкнений по периметру */
  open: boolean;
}

export const KINDS: KindDef[] = [
  { id: 'shed', name: 'Односхилий', open: true, fields: [{ k: 'a', label: 'Довжина карниза', def: 10 }] },
  { id: 'gable', name: 'Двосхилий', open: true, fields: [{ k: 'a', label: 'Довжина карниза', def: 10 }] },
  { id: 'hip', name: 'Чотирисхилий', open: false, fields: [
    { k: 'a', label: 'Довжина', def: 12 }, { k: 'b', label: 'Ширина', def: 9 }] },
  { id: 'L', name: 'Г-подібний', open: false, fields: [
    { k: 'a', label: 'Загальна довжина', def: 14 }, { k: 'b', label: 'Загальна ширина', def: 12 },
    { k: 'c', label: 'Ширина крила', def: 6 }, { k: 'd', label: 'Ширина корпусу', def: 7 }] },
  { id: 'U', name: 'П-подібний', open: false, fields: [
    { k: 'a', label: 'Загальна довжина', def: 18 }, { k: 'b', label: 'Загальна ширина', def: 12 },
    { k: 'c', label: 'Ширина лівого крила', def: 6 }, { k: 'd', label: 'Глибина виїмки', def: 5 },
    { k: 'e', label: 'Ширина правого крила', def: 6 }] },
  { id: 'T', name: 'Т-подібний', open: false, fields: [
    { k: 'a', label: 'Довжина поперечини', def: 16 }, { k: 'b', label: 'Ширина поперечини', def: 7 },
    { k: 'c', label: 'Ширина ніжки', def: 6 }, { k: 'd', label: 'Довжина ніжки', def: 6 }] },
  { id: 'X', name: 'Хрестоподібний', open: false, fields: [
    { k: 'a', label: 'Довжина по горизонталі', def: 16 }, { k: 'b', label: 'Ширина горизонтального крила', def: 6 },
    { k: 'c', label: 'Довжина по вертикалі', def: 16 }, { k: 'd', label: 'Ширина вертикального крила', def: 6 }] },
];

export interface Run { len: number; caps: number }
export interface Contour { runs: Run[]; extCorners: number; intCorners: number; error?: string }

/** Ділянки жолоба (між кутами або заглушками) для обраного типу */
export function contour(kind: RoofKind, v: Record<string, number>): Contour {
  const { a = 0, b = 0, c = 0, d = 0, e = 0 } = v;
  const closed = (sides: number[], ext: number, int: number): Contour => {
    if (sides.some(s => !(s > 0.05))) return { runs: [], extCorners: 0, intCorners: 0, error: 'Перевірте розміри: одна зі сторін виходить нульовою або від’ємною' };
    return { runs: sides.map(len => ({ len, caps: 0 })), extCorners: ext, intCorners: int };
  };
  switch (kind) {
    case 'shed': return a > 0 ? { runs: [{ len: a, caps: 2 }], extCorners: 0, intCorners: 0 } : { runs: [], extCorners: 0, intCorners: 0, error: 'Вкажіть довжину карниза' };
    case 'gable': return a > 0 ? { runs: [{ len: a, caps: 2 }, { len: a, caps: 2 }], extCorners: 0, intCorners: 0 } : { runs: [], extCorners: 0, intCorners: 0, error: 'Вкажіть довжину карниза' };
    case 'hip': return closed([a, b, a, b], 4, 0);
    case 'L': return closed([a, d, a - c, b - d, c, b], 5, 1);
    case 'U': return closed([a, b, e, d, a - c - e, d, c, b], 6, 2);
    case 'T': return closed([a, b, (a - c) / 2, d, c, d, (a - c) / 2, b], 6, 2);
    case 'X': return closed([b, (a - d) / 2, (c - b) / 2, d, (c - b) / 2, (a - d) / 2, b, (a - d) / 2, (c - b) / 2, d, (c - b) / 2, (a - d) / 2], 8, 4);
  }
}

export interface Params {
  height: number;      // від землі до карниза, м
  overhang: number;    // винос карниза від стіни, м
  pipes: number | null; // кількість водостоків (null — авто)
  system: '130/100' | '90/75';
}

export interface Line { name: string; qty: number; unit: string; note?: string }
export interface Result { lines: Line[]; gutterLen: number; pipes: number; pipeLen: number; error?: string }

/** Мінімальний набір 3-м і 4-м жолобів для ділянки (менше відходу, потім менше штук) */
export function gutterPieces(len: number): { n3: number; n4: number } {
  let best = { n3: 0, n4: Math.ceil(len / 4), waste: Infinity, cnt: Infinity };
  for (let n4 = 0; n4 <= Math.ceil(len / 4); n4++) {
    const rest = Math.max(0, len - 4 * n4);
    const n3 = Math.ceil(rest / 3 - 1e-9);
    const waste = 4 * n4 + 3 * n3 - len, cnt = n3 + n4;
    if (waste < best.waste - 1e-6 || (Math.abs(waste - best.waste) < 1e-6 && cnt < best.cnt)) best = { n3, n4, waste, cnt };
  }
  return { n3: best.n3, n4: best.n4 };
}

export const autoPipes = (c: Contour, gutterLen: number) => {
  if (!c.runs.length) return 0;
  // Не більше ~10 м жолоба на одну лійку; для двосхилого — мінімум по одній на кожен карниз
  const byLen = Math.ceil(gutterLen / 10);
  const min = c.runs.length === 1 ? 1 : c.runs.every(r => r.caps) ? c.runs.length : 4;
  return Math.max(byLen, min);
};

export function calculate(kind: RoofKind, v: Record<string, number>, p: Params): Result {
  const c = contour(kind, v);
  if (c.error) return { lines: [], gutterLen: 0, pipes: 0, pipeLen: 0, error: c.error };
  if (!(p.height > 0.5)) return { lines: [], gutterLen: 0, pipes: 0, pipeLen: 0, error: 'Вкажіть висоту від землі до карниза' };

  const gutterLen = c.runs.reduce((s, r) => s + r.len, 0);
  let n3 = 0, n4 = 0, gJoin = 0, brackets = 0, caps = 0;
  c.runs.forEach(r => {
    const g = gutterPieces(r.len);
    n3 += g.n3; n4 += g.n4;
    gJoin += Math.max(0, g.n3 + g.n4 - 1);
    brackets += Math.ceil(r.len / 0.6) + (r.caps ? 1 : 0);   // крок кронштейнів ≤ 60 см
    caps += r.caps;
  });
  const pipes = Math.max(1, Math.round(p.pipes ?? autoPipes(c, gutterLen)));

  // Труба на один водостік: висота мінус лійка/зливне коліно + обхід карниза
  const offset = Math.max(0, p.overhang - 0.15);
  const pipeOne = Math.max(0.5, p.height - 0.4) + offset;
  let t3 = 0, t1 = 0, muff = 0;
  for (let i = 0; i < pipes; i++) {
    let rest = pipeOne, k3 = Math.floor(rest / 3); rest -= k3 * 3;
    let k1 = 0;
    if (rest > 1e-6) { if (rest <= 1) k1 = 1; else k3 += 1; }   // залишок > 1 м — ріжемо 3-метрову
    t3 += k3; t1 += k1; muff += Math.max(0, k3 + k1 - 1);
  }
  const holders = pipes * Math.max(2, Math.ceil((p.height - 0.4) / 1.8));
  const elbows = pipes * 2;           // обхід карниза: 2 коліна
  const [gd, pd] = p.system.split('/');

  const lines: Line[] = [
    { name: `Жолоб ${gd} мм, 4 м`, qty: n4, unit: 'шт' },
    { name: `Жолоб ${gd} мм, 3 м`, qty: n3, unit: 'шт' },
    { name: 'З’єднувач жолоба', qty: gJoin, unit: 'шт' },
    { name: 'Кронштейн жолоба', qty: brackets, unit: 'шт', note: 'крок ≤ 60 см' },
    { name: 'Заглушка жолоба', qty: caps, unit: 'шт', note: caps ? 'ліва + права' : undefined },
    { name: 'Кут жолоба зовнішній 90°', qty: c.extCorners, unit: 'шт' },
    { name: 'Кут жолоба внутрішній 90°', qty: c.intCorners, unit: 'шт' },
    { name: `Лійка ${gd}/${pd}`, qty: pipes, unit: 'шт' },
    { name: `Коліно труби ${pd} мм`, qty: elbows, unit: 'шт', note: 'обхід карниза' },
    { name: `Труба ${pd} мм, 3 м`, qty: t3, unit: 'шт' },
    { name: `Труба ${pd} мм, 1 м`, qty: t1, unit: 'шт' },
    { name: 'З’єднувач труби (муфта)', qty: muff, unit: 'шт' },
    { name: 'Тримач труби', qty: holders, unit: 'шт', note: 'крок ≤ 1,8 м' },
    { name: `Коліно зливне ${pd} мм`, qty: pipes, unit: 'шт' },
  ].filter(l => l.qty > 0);
  return { lines, gutterLen, pipes, pipeLen: pipeOne * pipes };
}

export const COLORS: { id: string; name: string; hex: string }[] = [
  { id: '9003', name: 'Білий', hex: '#F2F2EE' },
  { id: '8017', name: 'Коричневий', hex: '#45322E' },
  { id: '8019', name: 'Темно-коричневий', hex: '#3F3A3A' },
  { id: '7024', name: 'Графіт', hex: '#474A50' },
  { id: '9005', name: 'Чорний', hex: '#121212' },
  { id: '3005', name: 'Вишневий', hex: '#5E2129' },
  { id: '3011', name: 'Червоно-коричневий', hex: '#792423' },
  { id: '6005', name: 'Зелений', hex: '#114232' },
  { id: '8004', name: 'Цегляний', hex: '#8E402A' },
  { id: '9006', name: 'Сріблястий', hex: '#A5A8A6' },
];
