// ============================================
// Специфікація → «СХЕМИ РОЗКРОЮ»: схема кожного ската (як в «Укладці») і під нею параметри ската
// (сторони, Lmax, площі, зсуви, округлення, звис, укладка) — як у бланку «Кровлі Профі».
// Схеми малюються картинкою PNG, тож потрапляють у друк, PDF і архів.
// ============================================
import React, { useEffect, useState } from 'react';
import { Slope } from '../../api/client';
import { slopeSchemePng } from '../layout/slopeImage';
import { sideLengthMm } from '../roof/edges';
import { sideLetter } from '../roof/templates';

const m3 = (mm: number | null | undefined) => ((Number(mm) || 0) / 1000).toFixed(3);
const f2 = (n: number | null | undefined, d = 3) => (Number(n) || 0).toFixed(d).replace('.', ',');
const DIR: Record<string, string> = { left_right: 'зліва направо', right_left: 'справа наліво', bottom_top: 'знизу вгору', top_bottom: 'згори вниз' };

export default function SpecSchemes({ slopes, orderNo, orderDate }: { slopes: Slope[]; orderNo?: string; orderDate?: string }) {
  const [imgs, setImgs] = useState<Record<number, string | null>>({});
  const sig = slopes.map(s => `${s.id}:${s.calc_at || s.updated_at}`).join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<number, string | null> = {};
      for (const s of slopes) {
        try { out[s.id] = await slopeSchemePng({ name: s.name, polygon_points: s.polygon_points, holes: s.holes, calc_result: s.calc_result }); }
        catch { out[s.id] = null; }
        if (!alive) return;
        setImgs(p => ({ ...p, [s.id]: out[s.id] }));
      }
    })();
    return () => { alive = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!slopes.length) return null;
  return (
    <>
      {slopes.map((s, n) => {
        const r: any = s.calc_result || {};
        const pts = s.polygon_points || [];
        const sides = pts.map((a, i) => [sideLetter(i), m3(sideLengthMm(a, pts[(i + 1) % pts.length]))]);
        return (
          <section key={s.id} className="kp-scheme">
            {/* заголовок розділу — всередині першого блоку, щоб при друку не лишався сам унизу сторінки */}
            {n === 0 && <h3 className="kp-paper-h">СХЕМИ РОЗКРОЮ</h3>}
            <div className="kp-scheme-h"><b><span>Скат</span> {n + 1}.</b> <span data-no-i18n>{s.name} — S = {f2(r.slope_area_m2)} m² · {r.total_sheets ?? 0}</span> <span>шт</span></div>
            {imgs[s.id] ? <img className="kp-scheme-img" src={imgs[s.id]!} alt="" />
              : imgs[s.id] === null ? <div className="kp-paper-line">Скат ще не розраховано.</div>
              : <div className="kp-paper-line no-print">Створення схеми…</div>}
            <div className="kp-scheme-params">
              <div>{sides.map(([l, v]) => <div key={l}>{l} = {v}; <span className="kp-sp-m">розмір</span></div>)}</div>
              <div>
                <div><span>Розрахунок</span> № {orderNo || '—'} <span>від</span> {orderDate ? orderDate.split('-').reverse().join('.') : '—'}</div>
                <div>Lmax реальна / Lmax стандартна, м: <b>{m3(r.max_real_length_mm)} / {m3(r.max_std_length_mm)}</b></div>
                <div>Площа ската, м²: <b>{f2(r.slope_area_m2)}</b></div>
                <div>Вертикальний зсув: <b>{m3(s.v_shift)} м</b></div>
                <div>Точність округлення: <b>{m3(r.rounding_mm)} м</b></div>
                <div>Карнизний звис (капельник): <b>{m3(s.eave_overhang)} м</b></div>
              </div>
              <div>
                <div><span>Скат</span> № {n + 1}/{slopes.length}</div>
                <div>Довжина ската Lск, м: <b>{m3(r.slope_height_mm)}</b></div>
                <div>Корисна / Повна площа листів, м²: <b>{f2(r.useful_area_m2)} / {f2(r.total_full_area_m2)}</b></div>
                <div>Обрізки: <b>{f2(r.waste_pct, 2)} %</b></div>
                <div><span>Укладка</span> «<span>{DIR[s.laying_direction] || s.laying_direction}</span>» / <span>Горизонтальний зсув листів:</span> <b>{m3(s.layout_shift)} м</b></div>
                <div>Врахування невиконуваних розмірів: <b>{s.snap_off ? 'Ні' : 'Так'}</b></div>
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
