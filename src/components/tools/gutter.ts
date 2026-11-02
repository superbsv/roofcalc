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

// ---------- Виробники водостічних систем ----------
// Типорозміри, довжини жолобів/труб, крок кронштейнів і кольори — за каталогами виробників.
// Відтінки RAL орієнтовні (як у каталогах «~RAL»).

export interface GColor { id: string; name: string; hex: string; ral?: string }
export interface GSystem {
  /** «жолоб/труба», мм */
  id: string;
  /** id кольорів виробника, доступних у цьому типорозмірі (порожньо — усі) */
  colors?: string[];
}
export interface Maker {
  id: string;
  name: string;
  material: 'ПВХ' | 'Сталь';
  country: string;
  /** Довжини жолоба, м */
  gutterLens: number[];
  /** Довжини труби, м */
  pipeLens: number[];
  /** Максимальний крок кронштейнів жолоба, м */
  step: number;
  systems: GSystem[];
  colors: GColor[];
}

const C = (ral: string, name: string, hex: string): GColor => ({ id: ral, ral, name, hex });
const WHITE = C('9010', 'Білий', '#F1EFE6'), BROWN = C('8017', 'Коричневий', '#45322E'), DBROWN = C('8019', 'Темно-коричневий', '#3F3A3A');
const BLACK = C('9005', 'Чорний', '#121212'), BRICK = C('8004', 'Цегляний', '#8E402A');

export const MAKERS: Maker[] = [
  {
    id: 'profil', name: 'Profil', material: 'ПВХ', country: 'Україна',
    gutterLens: [3, 4], pipeLens: [3, 4], step: 0.5,
    systems: [{ id: '90/75' }, { id: '130/100' }],
    colors: [WHITE, BROWN, C('7024', 'Графіт', '#474A50'), BRICK, C('3011', 'Червоний', '#792423'), BLACK],
  },
  {
    id: 'rainway', name: 'Rainway', material: 'ПВХ', country: 'Україна',
    gutterLens: [3, 2], pipeLens: [3, 2], step: 0.6,
    systems: [{ id: '90/75' }, { id: '130/100' }],
    colors: [C('9003', 'Білий', '#F2F2EE'), BROWN, C('7024', 'Графіт', '#474A50'), C('7040', 'Сірий', '#9DA3A6'),
      C('6005', 'Зелений', '#114232'), C('3005', 'Червоний', '#5E2129'), BRICK, BLACK],
  },
  {
    id: 'bryza', name: 'Bryza', material: 'ПВХ', country: 'Польща',
    gutterLens: [3, 4], pipeLens: [3, 4], step: 0.5,
    systems: [{ id: '75/63' }, { id: '100/63' }, { id: '100/90' }, { id: '125/90' }, { id: '125/110' }, { id: '150/110' }],
    colors: [WHITE, BROWN, C('3011', 'Червоний', '#792423'), C('7021', 'Графіт', '#2F3234'), C('6020', 'Зелений', '#37422F'),
      BRICK, { id: 'cu', name: 'Мідний', hex: '#9A5A33' }, BLACK],
  },
  {
    id: 'proaqua', name: 'ProAqua', material: 'ПВХ', country: 'Польща',
    gutterLens: [3, 4], pipeLens: [3, 4], step: 0.5,
    systems: [
      { id: '75/63', colors: ['8017', '8019', '7016', '9005'] },
      { id: '100/90', colors: ['8017', '8019', '7016', '9005'] },
      { id: '125/90' }, { id: '125/110' }, { id: '150/110' },
    ],
    colors: [WHITE, BROWN, DBROWN, C('7016', 'Графіт', '#383E42'), BRICK, BLACK],
  },
  {
    id: 'flamingo', name: 'Flamingo', material: 'Сталь', country: 'Польща',
    gutterLens: [3, 4], pipeLens: [3, 1], step: 0.6,
    systems: [
      { id: '125/90' }, { id: '125/100' },
      { id: '135/90', colors: ['8017', '8019', '7011', '7016', '9005'] },
      { id: '135/100', colors: ['8017', '8019', '7011', '7016', '9005'] },
      { id: '150/90' }, { id: '150/100' },
    ],
    colors: [C('9002', 'Білий', '#E7EBDA'), BROWN, DBROWN, C('7011', 'Графіт', '#434B4D'), C('7016', 'Антрацит', '#383E42'), BRICK,
      C('3009', 'Вишневий', '#642424'), C('6020', 'Зелений', '#37422F'), C('8003', 'Мідний', '#734222'),
      C('9006', 'Сріблястий', '#A5A8A6'), BLACK],
  },
  {
    id: 'river', name: 'River', material: 'ПВХ', country: 'Польща',
    gutterLens: [3], pipeLens: [3], step: 0.6,
    systems: [{ id: '125/90' }],
    colors: [C('9010', 'Білий', '#F1EFE6'), BROWN, C('7024', 'Графіт', '#474A50'), C('6005', 'Зелений', '#114232'),
      C('3005', 'Червоний', '#5E2129'), BRICK, BLACK],
  },
];

export const makerById = (id: string) => MAKERS.find(m => m.id === id) ?? MAKERS[0];
export const systemColors = (m: Maker, sys: string): GColor[] => {
  const s = m.systems.find(x => x.id === sys);
  return s?.colors ? m.colors.filter(c => s.colors!.includes(c.id)) : m.colors;
};

export interface Params {
  height: number;       // висота будинку (від землі до карниза), м
  pipes?: number | null;
  maker: Maker;
  system: string;       // «жолоб/труба», мм
}

export interface Line { name: string; qty: number; unit: string; note?: string }
export interface Result { lines: Line[]; gutterLen: number; pipes: number; pipeLen: number; error?: string }

const fmt = (n: number) => String(n).replace('.', ',');

/** Набір відрізків заданих довжин для ділянки len: найменший відхід, потім найменше штук. Повертає кількість по кожній довжині. */
export function pieces(len: number, lens: number[]): number[] {
  const L = [...lens].sort((a, b) => b - a);
  let best: { n: number[]; waste: number; cnt: number } = { n: L.map((_, i) => (i === 0 ? Math.ceil(len / L[0] - 1e-9) : 0)), waste: Infinity, cnt: Infinity };
  const n = L.map(() => 0);
  const rec = (i: number, rest: number) => {
    if (i === L.length - 1) {
      n[i] = Math.max(0, Math.ceil(rest / L[i] - 1e-9));
      const total = L.reduce((s, l, k) => s + l * n[k], 0), waste = total - len, cnt = n.reduce((a, b) => a + b, 0);
      if (waste < best.waste - 1e-6 || (Math.abs(waste - best.waste) < 1e-6 && cnt < best.cnt)) best = { n: [...n], waste, cnt };
      return;
    }
    const max = Math.ceil(Math.max(0, rest) / L[i] - 1e-9);
    for (let k = 0; k <= max; k++) { n[i] = k; rec(i + 1, rest - k * L[i]); }
    n[i] = 0;
  };
  if (len > 0) rec(0, len); else best.n = L.map(() => 0);
  // назад у порядку вхідного масиву
  return lens.map(l => best.n[L.indexOf(l)]);
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
  const m = p.maker;
  const sys = m.systems.some(s => s.id === p.system) ? p.system : m.systems[0].id;

  const gutterLen = c.runs.reduce((s, r) => s + r.len, 0);
  const gN = m.gutterLens.map(() => 0);
  let gJoin = 0, brackets = 0, caps = 0;
  c.runs.forEach(r => {
    const g = pieces(r.len, m.gutterLens);
    g.forEach((k, i) => { gN[i] += k; });
    gJoin += Math.max(0, g.reduce((a, b) => a + b, 0) - 1);
    // Кронштейни рівномірно з кроком ≤ step; крайні — не далі 0,2 м від заглушки
    brackets += r.caps ? Math.ceil(Math.max(0, r.len - 0.4) / m.step - 1e-9) + 1 : Math.ceil(r.len / m.step - 1e-9);
    caps += r.caps;
  });
  brackets += c.extCorners + c.intCorners;   // біля кожного кута — додатковий кронштейн (≤ 0,2 м від повороту)
  const pipes = Math.max(1, Math.round(p.pipes ?? autoPipes(kind, c, gutterLen)));

  // Труба на один водостік: висота будинку мінус лійка/коліна (≈ 0,4 м) + обхід карниза (≈ 0,35 м)
  const pipeOne = Math.max(0.5, p.height - 0.4) + 0.35;
  const one = pieces(pipeOne, m.pipeLens);
  const pN = one.map(k => k * pipes);
  const muff = pipes * Math.max(0, one.reduce((a, b) => a + b, 0) - 1);
  // Тримачі труби: крок ≤ 2 м (будинок до 10 м), ≤ 1,5 м — вище 10 м
  const hStep = p.height > 10 ? 1.5 : 2;
  const holders = pipes * Math.max(2, Math.ceil((p.height - 0.4) / hStep - 1e-9));
  const elbows = pipes * 2;           // обхід карниза: 2 коліна
  const [gd, pd] = sys.split('/');

  const byLen = (lens: number[], qty: number[], mk: (l: number) => string) =>
    lens.map((l, i) => ({ l, q: qty[i] })).sort((a, b) => b.l - a.l).map(x => ({ name: mk(x.l), qty: x.q, unit: 'шт' } as Line));

  const lines: Line[] = [
    ...byLen(m.gutterLens, gN, l => `Жолоб ${gd} мм, ${fmt(l)} м`),
    { name: 'З’єднувач жолоба', qty: gJoin, unit: 'шт' },
    { name: 'Кронштейн жолоба', qty: brackets, unit: 'шт', note: `крок ≤ ${Math.round(m.step * 100)} см` },
    { name: 'Заглушка жолоба', qty: caps, unit: 'шт', note: caps ? 'ліва + права' : undefined },
    { name: 'Кут жолоба зовнішній 90°', qty: c.extCorners, unit: 'шт' },
    { name: 'Кут жолоба внутрішній 90°', qty: c.intCorners, unit: 'шт' },
    { name: `Лійка ${gd}/${pd}`, qty: pipes, unit: 'шт' },
    { name: `Коліно труби ${pd} мм`, qty: elbows, unit: 'шт', note: 'обхід карниза' },
    ...byLen(m.pipeLens, pN, l => `Труба ${pd} мм, ${fmt(l)} м`),
    { name: 'З’єднувач труби (муфта)', qty: muff, unit: 'шт' },
    { name: 'Тримач труби', qty: holders, unit: 'шт', note: `крок ≤ ${fmt(hStep)} м` },
    { name: `Коліно зливне ${pd} мм`, qty: pipes, unit: 'шт' },
  ].filter(l => l.qty > 0);
  return { lines, gutterLen, pipes, pipeLen: pipeOne * pipes };
}
