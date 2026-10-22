// ============================================
// Розрахунок водостічної системи (як калькулятор profil.com.ua):
// тип даху → розміри карнизів → колір → специфікація елементів.
// Усі розміри в метрах.
// ============================================

export type RoofKind = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7';

export interface KindDef {
  id: RoofKind;
  /** Літери сторін — точно як на схемі profil.com.ua */
  letters: string[];
  /** Літери, без яких розрахунок неможливий */
  need: string[];
  /** Мінімум водостоків (червоні вертикалі на схемі) */
  minPipes: number;
}

// Порядок і набір літер — як у калькуляторі profil.com.ua (крок 1 → крок 2)
export const KINDS: KindDef[] = [
  { id: 'r1', letters: ['A', 'B', 'C'], need: ['A'], minPipes: 4 },                                   // двосхилий
  { id: 'r2', letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], need: ['A', 'E', 'F', 'G'], minPipes: 4 }, // двосхилий з фронтоном
  { id: 'r3', letters: ['A', 'B', 'C', 'D'], need: ['A', 'B'], minPipes: 4 },                         // вальмовий
  { id: 'r4', letters: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'], need: ['A', 'B', 'D', 'E', 'F', 'G'], minPipes: 6 }, // вальмовий з крилом
  { id: 'r5', letters: ['A', 'B', 'C', 'D', 'E', 'F'], need: ['A', 'D', 'E', 'F'], minPipes: 4 },    // Г-подібний
  { id: 'r6', letters: ['A', 'B', 'C', 'D', 'E', 'G'], need: ['A', 'D', 'E'], minPipes: 4 },         // двосхилий з виступом
  { id: 'r7', letters: ['A', 'B', 'C'], need: ['A'], minPipes: 2 },                                   // односхилий
];

export interface Run { len: number; caps: number }
export interface Contour { runs: Run[]; extCorners: number; intCorners: number; error?: string }

/** Ділянки жолоба (червоні лінії на схемі) для обраного типу. Сторони в метрах. */
export function contour(kind: RoofKind, v: Record<string, number>): Contour {
  const def = KINDS.find(k => k.id === kind)!;
  const miss = def.need.filter(k => !(v[k] > 0));
  if (miss.length) return { runs: [], extCorners: 0, intCorners: 0, error: `Вкажіть сторон${miss.length > 1 ? 'и' : 'у'} ${miss.join(', ')}` };
  const { A = 0, B = 0, D = 0, E = 0, F = 0, G = 0 } = v;
  const bad = (n: number) => !(n > 0.05);
  const err = (s: string): Contour => ({ runs: [], extCorners: 0, intCorners: 0, error: s });
  switch (kind) {
    case 'r1': return { runs: [{ len: A, caps: 2 }, { len: A, caps: 2 }], extCorners: 0, intCorners: 0 };
    case 'r7': return { runs: [{ len: A, caps: 2 }], extCorners: 0, intCorners: 0 };
    case 'r3': return { runs: [{ len: 2 * (A + B), caps: 0 }], extCorners: 4, intCorners: 0 };
    case 'r2':   // задній карниз A; ліворуч F → кут → G; праворуч G → кут → E
      return { runs: [{ len: A, caps: 2 }, { len: F + G, caps: 2 }, { len: G + E, caps: 2 }], extCorners: 0, intCorners: 2 };
    case 'r4': { // замкнений контур: A, B, D, G, E, G, F, B  (A = F + E + D)
      return { runs: [{ len: A + 2 * B + D + 2 * G + E + F, caps: 0 }], extCorners: 6, intCorners: 2 };
    }
    case 'r5':   // зовнішні карнизи F + A (зовнішній кут), внутрішні E + D (внутрішній кут)
      return { runs: [{ len: F + A, caps: 2 }, { len: E + D, caps: 2 }], extCorners: 1, intCorners: 1 };
    case 'r6': { // задній A; спереду E, D та решта A − E − D
      const rest = A - E - D;
      if (bad(rest)) return err('Сторона A має бути більшою за E + D');
      return { runs: [{ len: A, caps: 2 }, { len: E, caps: 2 }, { len: D, caps: 2 }, { len: rest, caps: 2 }], extCorners: 0, intCorners: 0 };
    }
  }
  return err('Невідомий тип');
}

export interface Params {
  height: number;       // висота будинку (від землі до карниза), м
  pipes?: number | null;
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

export const autoPipes = (kind: RoofKind, c: Contour, gutterLen: number) => {
  if (!c.runs.length) return 0;
  // Як на схемі (червоні вертикалі), але не більше ~10 м жолоба на одну лійку
  return Math.max(KINDS.find(k => k.id === kind)!.minPipes, Math.ceil(gutterLen / 10));
};

export function calculate(kind: RoofKind, v: Record<string, number>, p: Params): Result {
  const c = contour(kind, v);
  if (c.error) return { lines: [], gutterLen: 0, pipes: 0, pipeLen: 0, error: c.error };
  if (!(p.height > 0.5)) return { lines: [], gutterLen: 0, pipes: 0, pipeLen: 0, error: 'Вкажіть висоту будинку' };

  const gutterLen = c.runs.reduce((s, r) => s + r.len, 0);
  let n3 = 0, n4 = 0, gJoin = 0, brackets = 0, caps = 0;
  c.runs.forEach(r => {
    const g = gutterPieces(r.len);
    n3 += g.n3; n4 += g.n4;
    gJoin += Math.max(0, g.n3 + g.n4 - 1);
    brackets += Math.ceil(r.len / 0.6) + (r.caps ? 1 : 0);   // крок кронштейнів ≤ 60 см
    caps += r.caps;
  });
  const pipes = Math.max(1, Math.round(p.pipes ?? autoPipes(kind, c, gutterLen)));

  // Труба на один водостік: висота будинку мінус лійка/коліна (≈ 0,4 м) + обхід карниза (≈ 0,35 м)
  const pipeOne = Math.max(0.5, p.height - 0.4) + 0.35;
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
