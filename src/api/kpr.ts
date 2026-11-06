// ============================================
// Імпорт файлу «Кровля Профи» (.kpr) → проект ROOFKIT (той самий формат, що й .roofkit).
// .kpr — текст у кодуванні Windows-1251, одне значення на рядок (десятковий роздільник — кома).
// Шапка: 1 версія · 2 № замовлення · 3 дата · 4 постачальник · 5 замовник · 6 матеріал · 8 покриття · 9 колір ·
// 12 ПК, м · 13 ПЗ, м · 14 К, м · 15 корисна · 16 повна · 17 довжина хвилі (металочерепиця) · далі Lmax станд. і реальна ·
// точність округлення — рядок перед першим скатом · в кінці: прапорець «невиконувані розміри» і 22 пари діапазонів · 15 корисна ширина · 16 повна ширина · 17 Lmax станд. · 18 Lmax реальна.
// Скат: [True/False, False, 0, напрям «зліва направо» True/False, False, id, n] + n пар (тип сторони, довжина) + n+1 точок (x, y) ·
// службові поля (площа тощо) · кількість вирізів і вирізи в тому самому форматі · 10 службових полів.
// Геометрія — у метрах, y від карниза вгору (як у ROOFKIT).
// ============================================
import { projectFileApi, Point } from './client';

const num = (s: string | undefined) => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
const mm = (s: string | undefined) => Math.round(num(s) * 1000);

function guessType(name: string): 'tile' | 'profile' | 'falts' | 'siding' | 'sandwich' {
  const n = name.toLowerCase();
  if (/черепиц/.test(n)) return 'tile';
  if (/фальц/.test(n)) return 'falts';
  if (/сайдинг/.test(n)) return 'siding';
  if (/сендв|сэндв/.test(n)) return 'sandwich';
  return 'profile';
}

export interface KprSlope { pts: Point[]; holes: Point[][]; leftRight: boolean }

export function parseKpr(text: string) {
  const L = text.split(/\r?\n/);
  if (!/^\d+\.\d+/.test(L[0] || '')) throw new Error('Це не файл «Кровля Профи» (.kpr)');
  // перший скат: True|False, False, 0, True|False, False, id, n
  const isStart = (k: number) => (L[k] === 'True' || L[k] === 'False') && (L[k + 1] === 'True' || L[k + 1] === 'False')
    && /^\d+$/.test(L[k + 2] || '') && (L[k + 3] === 'True' || L[k + 3] === 'False') && (L[k + 4] === 'True' || L[k + 4] === 'False')
    && /^\d+$/.test(L[k + 5] || '') && /^\d+$/.test(L[k + 6] || '') && +L[k + 6] >= 3 && +L[k + 6] < 200;
  let i = 25;
  while (i < L.length && !isStart(i)) i++;
  const roundLine = L[i - 1];                       // точність округлення — рядок перед першим скатом
  const slopes: KprSlope[] = [];
  const readPoly = (j: number, n: number): [Point[], number] => {
    j += 2 * n;                                     // пари (тип сторони, довжина) — довжини перераховуються з точок
    const pts: Point[] = [];
    for (let k = 0; k <= n; k++) pts.push([mm(L[j + 2 * k]), mm(L[j + 2 * k + 1])]);
    return [pts.slice(0, n), j + 2 * (n + 1)];
  };
  while (i < L.length && isStart(i) && slopes.length < 200) {
    const leftRight = L[i + 3] === 'True';   // «Укладка зліва направо» (False — справа наліво)
    const n = parseInt(L[i + 6], 10);
    let [pts, j] = readPoly(i + 7, n);
    j += 8;                                         // висота, площі, відходи, площа вирізів
    const nh = parseInt(L[j] || '0', 10) || 0; j++;
    const holes: Point[][] = [];
    for (let h = 0; h < nh && h < 50; h++) {
      const hn = parseInt(L[j] || '0', 10); j++;
      if (!(hn >= 3)) break;
      const [hp, nj] = readPoly(j, hn); holes.push(hp); j = nj;
    }
    j += 10;
    slopes.push({ pts, holes, leftRight });
    i = j;
  }
  if (!slopes.length) throw new Error('У файлі «Кровля Профи» не знайдено скатів');

  const matName = (L[5] || '').replace(/(\s*\(Copy\))+/gi, '').trim() || 'Матеріал з «Кровля Профи»';
  // 17: у металочерепиці — довжина хвилі (< 2 м), далі Lmax стандартна і реальна; в інших — одразу Lmax станд. і реальна
  const waveM = num(L[16]);
  const isTile = waveM > 0.05 && waveM < 2;
  const type = isTile ? 'tile' : guessType(matName);
  const useful = mm(L[14]) || 1100, full = mm(L[15]) || useful;
  const pk = mm(L[11]);                             // 12: ПК (перекриття конькове)
  const pz = mm(L[12]);                             // 13: ПЗ
  const k = mm(L[13]);                              // 14: К
  const round = /^\d+([.,]\d+)?$/.test(roundLine || '') ? mm(roundLine) : 0;
  const lmaxReal = mm(L[isTile ? 18 : 17]) || 6000, lmaxStd = mm(L[isTile ? 17 : 16]) || lmaxReal;
  // Невиконувані розміри: останній рядок True/False у файлі — «враховувати», за ним 22 пари «від — до», м (нулі — порожні)
  let flagAt = -1;
  for (let q = L.length - 1; q > i; q--) if (L[q] === 'True' || L[q] === 'False') { flagAt = q; break; }
  const forbidden: [number, number][] = [];
  if (flagAt > 0 && L[flagAt] === 'True') {
    for (let q = 0; q < 22; q++) {
      const a = mm(L[flagAt + 1 + 2 * q]), b = mm(L[flagAt + 2 + 2 * q]);
      if (b > a && b > 0) forbidden.push([a, b]);
    }
  }
  const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(L[2] || '');
  const material = {
    id: 1, name: matName, type, manufacturer: '', match_by_size: true,
    full_width: full, useful_width: useful, side_overlap: Math.max(0, full - useful),
    length_overlap: type === 'falts' ? 0 : pz, join_overlap: type === 'falts' ? pz : null,
    wave_step: isTile ? Math.round(waveM * 1000) : type === 'tile' ? 350 : 0, min_length: 300, max_length: lmaxReal, max_std_length: lmaxStd,
    round_step: round || 10, min_slope_angle: 0,
    forbidden_lengths: forbidden.length ? forbidden : null,
    // діапазони з КП уже описують технологію різу — власне правило «±50 мм від штампа» тоді вимикаємо
    ...(isTile && forbidden.length ? { stamp_gap: 0 } : {}),
  };
  return {
    roofkit_project: 1,
    source: 'krovlya-profi',
    project: {
      name: `Замовлення №${L[1] || ''} від ${L[2] || ''} (Кровля Профи)`,
      client_name: (L[4] || '').trim() || null,
      notes: (L[3] || '').trim() ? `Постачальник у «Кровля Профи»: ${L[3].trim()}` : null,
      settings: {
        calc_type: type, material_id: 1,
        order_date: date ? `${date[3]}-${date[2]}-${date[1]}` : undefined,
        k, pk, round_step: round || null,
        coating: (L[7] || '').trim() || undefined, color: (L[8] || '').trim() || undefined,
      },
    },
    materials: [material],
    slopes: slopes.map((s, n) => ({
      name: `Скат ${n + 1}`, // i18n-ignore (дані: назва ската)
      sort_order: n + 1, polygon_points: s.pts, holes: s.holes,
      laying_direction: s.leftRight ? 'left_right' : 'right_left', eave_overhang: k, ridge_gap: pk, material_ref: 1,
    })),
  };
}

/** Відкрити файл «Кровля Профи» в кабінеті: розбір у браузері, далі — звичайний імпорт проекту */
export async function openKprFile(file: File) {
  const buf = await file.arrayBuffer();
  const text = new TextDecoder('windows-1251').decode(buf);
  return projectFileApi.import(parseKpr(text));
}
