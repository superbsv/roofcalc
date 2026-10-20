// ============================================
// Розв'язання трикутника за будь-якими відомими величинами (як «Калькулятор тригонометричний» КП).
// Позначення: сторони a, b, c; кути α, β, γ протилежні до a, b, c відповідно. Сторони в метрах, кути в градусах.
// ============================================

export type TriKey = 'a' | 'b' | 'c' | 'A' | 'B' | 'C';
export type TriVals = Partial<Record<TriKey, number>>;
export interface TriResult { vals: Required<TriVals> & { S: number }; note?: string }

const R = Math.PI / 180;
const sides: ['a', 'b', 'c'] = ['a', 'b', 'c'];
const ang = { a: 'A', b: 'B', c: 'C' } as const;
const ok = (v?: number) => v != null && Number.isFinite(v) && v > 0;

export function solveTriangle(input: TriVals): TriResult {
  const v: TriVals = {};
  (Object.keys(input) as TriKey[]).forEach(k => { if (ok(input[k])) v[k] = input[k]; });
  const nSides = sides.filter(s => ok(v[s])).length;
  const nAngles = (['A', 'B', 'C'] as const).filter(k => ok(v[k])).length;
  if (nSides === 0) throw new Error('Вкажіть хоча б одну сторону');
  if (nSides + nAngles < 3) throw new Error('Потрібно щонайменше три відомі величини (для прямокутного — дві)');
  if (nAngles === 3 && Math.abs((v.A! + v.B! + v.C!) - 180) > 0.01) throw new Error('Сума кутів має дорівнювати 180°');
  let note: string | undefined;

  for (let pass = 0; pass < 6; pass++) {
    // 1. Два кути → третій
    const known = (['A', 'B', 'C'] as const).filter(k => ok(v[k]));
    if (known.length === 2) {
      const miss = (['A', 'B', 'C'] as const).find(k => !ok(v[k]))!;
      v[miss] = 180 - v[known[0]]! - v[known[1]]!;
      if (v[miss]! <= 0) throw new Error('Сума двох кутів має бути менше 180°');
    }
    // 2. Три сторони → кути (теорема косинусів)
    if (ok(v.a) && ok(v.b) && ok(v.c)) {
      const { a, b, c } = v as Required<TriVals>;
      if (a + b <= c || a + c <= b || b + c <= a) throw new Error('Такий трикутник не існує: кожна сторона має бути менша за суму двох інших');
      if (!ok(v.A)) v.A = Math.acos((b * b + c * c - a * a) / (2 * b * c)) / R;
      if (!ok(v.B)) v.B = Math.acos((a * a + c * c - b * b) / (2 * a * c)) / R;
      if (!ok(v.C)) v.C = 180 - v.A! - v.B!;
      break;
    }
    // 3. Дві сторони і кут між ними → третя сторона
    for (const s of sides) {
      const [p, q] = sides.filter(x => x !== s);
      if (!ok(v[s]) && ok(v[p]) && ok(v[q]) && ok(v[ang[s]])) {
        v[s] = Math.sqrt(v[p]! ** 2 + v[q]! ** 2 - 2 * v[p]! * v[q]! * Math.cos(v[ang[s]]! * R));
      }
    }
    if (ok(v.a) && ok(v.b) && ok(v.c)) continue;
    // 4. Теорема синусів: є пара «сторона + протилежний кут»
    const pair = sides.find(s => ok(v[s]) && ok(v[ang[s]]));
    if (pair) {
      const k = v[pair]! / Math.sin(v[ang[pair]]! * R);
      for (const s of sides) {
        if (ok(v[ang[s]]) && !ok(v[s])) v[s] = k * Math.sin(v[ang[s]]! * R);
      }
      for (const s of sides) {
        if (ok(v[s]) && !ok(v[ang[s]])) {
          const sn = v[s]! / k;
          if (sn > 1 + 1e-9) throw new Error('Такий трикутник не існує: сторона задовга для вказаного кута');
          let x = Math.asin(Math.min(1, sn)) / R;
          // неоднозначний випадок (дві сторони і кут не між ними) — беремо гострий кут, якщо він можливий
          const other = (['A', 'B', 'C'] as const).filter(t => t !== ang[s] && ok(v[t])).reduce((acc, t) => acc + v[t]!, 0);
          if (other + x >= 180) x = 180 - x;
          else if (other + (180 - x) < 180 && Math.abs(x - 90) > 1e-6) note = 'Дві сторони і кут не між ними: можливі два трикутники, показано варіант з гострим кутом';
          v[ang[s]] = x;
          break;
        }
      }
      continue;
    }
  }

  if (!(sides.every(s => ok(v[s])) && ok(v.A) && ok(v.B) && ok(v.C))) {
    throw new Error('Недостатньо даних: для довільного трикутника потрібні три величини, серед них хоча б одна сторона');
  }
  // перевірка узгодженості (якщо введено більше даних, ніж потрібно)
  const cv = v as Required<TriVals>;
  if (Math.abs(cv.A + cv.B + cv.C - 180) > 0.05) throw new Error('Дані суперечать одне одному: сума кутів не 180°');
  for (const s of sides) {
    const [p, q] = sides.filter(x => x !== s);
    const exp = Math.sqrt(cv[p] ** 2 + cv[q] ** 2 - 2 * cv[p] * cv[q] * Math.cos(cv[ang[s]] * R));
    if (Math.abs(exp - cv[s]) > Math.max(0.002, cv[s] * 0.001)) throw new Error('Дані суперечать одне одному: перевірте введені сторони і кути');
  }
  const { a, b, C } = v as Required<TriVals>;
  const S = 0.5 * a * b * Math.sin(C * R);
  return { vals: { ...(v as Required<TriVals>), S }, note };
}
