// ============================================
// Калькулятор водостоку (за зразком profil.com.ua/calculator):
// 1. Тип даху → 2. Параметри → 3. Колір → 4. Результат.
// ============================================
import React, { useEffect, useMemo, useState } from 'react';
import { KINDS, RoofKind, COLORS, calculate, contour, autoPipes, Params } from './gutter';

type Pt = [number, number];
interface Pic { poly?: Pt[]; gutters?: [Pt, Pt][]; labels: Record<string, Pt>; extra?: React.ReactNode }

// Схеми у плані (вигляд зверху), viewBox 300×220. Товста лінія — жолоб.
const PICS: Record<RoofKind, Pic> = {
  shed: { poly: [[50, 50], [250, 50], [250, 170], [50, 170]], gutters: [[[50, 170], [250, 170]]],
    labels: { a: [150, 196] }, extra: <path d="M150 70 v70 m-8 -10 l8 10 l8 -10" stroke="var(--clr-text-3)" strokeWidth="1.5" fill="none" /> },
  gable: { poly: [[50, 40], [250, 40], [250, 180], [50, 180]], gutters: [[[50, 40], [250, 40]], [[50, 180], [250, 180]]],
    labels: { a: [150, 206] }, extra: <path d="M50 110 H250" stroke="var(--clr-text-3)" strokeWidth="1.5" strokeDasharray="5 4" /> },
  hip: { poly: [[40, 40], [260, 40], [260, 180], [40, 180]], labels: { a: [150, 206], b: [282, 112] },
    extra: <path d="M40 40 L110 110 H190 L260 40 M40 180 L110 110 M190 110 L260 180" stroke="var(--clr-text-3)" strokeWidth="1.2" fill="none" /> },
  L: { poly: [[40, 30], [130, 30], [130, 110], [260, 110], [260, 190], [40, 190]],
    labels: { a: [150, 212], b: [18, 112], c: [85, 22], d: [282, 152] } },
  U: { poly: [[30, 30], [110, 30], [110, 110], [190, 110], [190, 30], [270, 30], [270, 190], [30, 190]],
    labels: { a: [150, 212], b: [290, 112], c: [70, 22], d: [150, 72], e: [230, 22] } },
  T: { poly: [[30, 30], [270, 30], [270, 100], [190, 100], [190, 195], [110, 195], [110, 100], [30, 100]],
    labels: { a: [150, 22], b: [290, 67], c: [150, 214], d: [208, 150] } },
  X: { poly: [[110, 15], [190, 15], [190, 80], [280, 80], [280, 140], [190, 140], [190, 205], [110, 205], [110, 140], [20, 140], [20, 80], [110, 80]],
    labels: { a: [150, 168], b: [292, 112], c: [208, 40], d: [150, 10] } },
};

function Scheme({ kind, small }: { kind: RoofKind; small?: boolean }) {
  const p = PICS[kind];
  const pts = p.poly!.map(q => q.join(',')).join(' ');
  return (
    <svg viewBox="0 0 300 220" width={small ? 120 : '100%'} height={small ? 88 : undefined} aria-hidden="true">
      <polygon points={pts} fill="var(--clr-brand-pale)" stroke={p.gutters ? 'var(--clr-text-2)' : 'var(--clr-brand)'} strokeWidth={p.gutters ? 2 : 6} strokeLinejoin="miter" />
      {p.extra}
      {p.gutters?.map(([s, e], i) => <line key={i} x1={s[0]} y1={s[1]} x2={e[0]} y2={e[1]} stroke="var(--clr-brand)" strokeWidth="6" />)}
      {!small && Object.entries(p.labels).map(([k, [x, y]]) => (
        <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="17" fontWeight="700" fill="var(--clr-text)" fontFamily="var(--font-display)">{k}</text>
      ))}
    </svg>
  );
}

const STEPS = ['Тип даху', 'Параметри даху', 'Вибір кольору', 'Результат'];
const num = (s: string) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export default function GutterCalc({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<RoofKind>('gable');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [height, setHeight] = useState('5');
  const [overhang, setOverhang] = useState('0.5');
  const [pipes, setPipes] = useState('');
  const [system, setSystem] = useState<Params['system']>('130/100');
  const [color, setColor] = useState(COLORS[1].id);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const def = KINDS.find(k => k.id === kind)!;
  const v = useMemo(() => {
    const o: Record<string, number> = {};
    def.fields.forEach(f => { o[f.k] = vals[f.k] !== undefined ? num(vals[f.k]) : f.def; });
    return o;
  }, [def, vals]);
  const cont = contour(kind, v);
  const gl = cont.runs.reduce((s, r) => s + r.len, 0);
  const auto = autoPipes(cont, gl);
  const res = calculate(kind, v, { height: num(height), overhang: num(overhang), pipes: pipes.trim() ? num(pipes) : null, system });
  const col = COLORS.find(c => c.id === color)!;

  const pickKind = (k: RoofKind) => { setKind(k); setVals({}); setPipes(''); setStep(1); };
  const canNext = step !== 1 || !res.error;

  const text = () => [
    `Водостічна система ${system}, колір ${col.name} (RAL ${col.id})`,
    `Дах: ${def.name}; ${def.fields.map(f => `${f.k}=${v[f.k]} м`).join(', ')}; висота ${num(height)} м`,
    ...res.lines.map(l => `${l.name} — ${l.qty} ${l.unit}`),
  ].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=900'); if (!w) return;
    const rows = res.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${l.name}</td><td style="text-align:right">${l.qty}</td><td>${l.unit}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Водостік — ROOFKIT</title><style>body{font:14px/1.4 Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#EEF2F7}</style>
      <h2>Розрахунок водостічної системи</h2><p>Система ${system} мм · колір ${col.name} (RAL ${col.id})<br>Дах: ${def.name}; ${def.fields.map(f => `${f.k} = ${v[f.k]} м`).join(', ')}; висота до карниза ${num(height)} м; винос карниза ${num(overhang)} м<br>Жолоб по периметру: ${res.gutterLen.toFixed(2)} м · водостоків: ${res.pipes}</p>
      <table><tr><th>№</th><th>Найменування</th><th>К-сть</th><th>Од.</th></tr>${rows}</table><p style="color:#777;font-size:12px">Розраховано в ROOFKIT · roofkit.com.ua</p>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Калькулятор водостоку" onClick={onClose}>
      <div className="kp-modal-box gut-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>Калькулятор водостоку</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>

        <ol className="gut-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <button disabled={i > step && !(i === step + 1 && canNext)} onClick={() => setStep(i)}><b>{i + 1}</b><span>{s}</span></button>
            </li>
          ))}
        </ol>

        <div className="gut-body">
          {step === 0 && (
            <div className="gut-kinds">
              {KINDS.map(k => (
                <button key={k.id} className={`gut-kind${k.id === kind ? ' on' : ''}`} onClick={() => pickKind(k.id)}>
                  <Scheme kind={k.id} small /><span>{k.name}</span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="gut-params">
              <div className="gut-pic"><Scheme kind={kind} /><div className="gut-cap">{def.name} дах, вигляд зверху. Помаранчева лінія — жолоб.</div></div>
              <div className="gut-fields">
                {def.fields.map(f => (
                  <label key={f.k}><span><b>{f.k}</b> — {f.label}</span>
                    <span className="gut-in"><input inputMode="decimal" value={vals[f.k] ?? String(f.def)} onChange={e => setVals(s => ({ ...s, [f.k]: e.target.value }))} /> м</span></label>
                ))}
                <hr />
                <label><span>Висота від землі до карниза</span><span className="gut-in"><input inputMode="decimal" value={height} onChange={e => setHeight(e.target.value)} /> м</span></label>
                <label><span>Винос карниза від стіни</span><span className="gut-in"><input inputMode="decimal" value={overhang} onChange={e => setOverhang(e.target.value)} /> м</span></label>
                <label><span>Кількість водостоків</span><span className="gut-in"><input inputMode="numeric" placeholder={`авто: ${auto}`} value={pipes} onChange={e => setPipes(e.target.value)} /> шт</span></label>
                <label><span>Система (жолоб / труба)</span>
                  <select className="form-control" value={system} onChange={e => setSystem(e.target.value as Params['system'])}>
                    <option value="130/100">130 / 100 мм — стандарт</option>
                    <option value="90/75">90 / 75 мм — малі дахи, ганки</option>
                  </select></label>
                {res.error ? <div className="alert alert-error">{res.error}</div>
                  : <div className="gut-sum">Жолоб по периметру: <b>{gl.toFixed(2)} м</b></div>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="gut-colors">
              {COLORS.map(c => (
                <button key={c.id} className={`gut-color${c.id === color ? ' on' : ''}`} onClick={() => setColor(c.id)}>
                  <i style={{ background: c.hex }} /><span>{c.name}</span><small>RAL {c.id}</small>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="gut-res">
              <div className="gut-res-head">
                <i style={{ background: col.hex }} />
                <div><b>Система {system} мм · {col.name} (RAL {col.id})</b>
                  <div>{def.name} дах · жолоб {res.gutterLen.toFixed(2)} м · водостоків {res.pipes} · труба ≈ {res.pipeLen.toFixed(1)} м</div></div>
              </div>
              <table className="gut-table">
                <thead><tr><th>№</th><th>Найменування</th><th>К-сть</th><th>Од.</th></tr></thead>
                <tbody>{res.lines.map((l, i) => (
                  <tr key={l.name}><td>{i + 1}</td><td>{l.name}{l.note && <small> · {l.note}</small>}</td><td className="n">{l.qty}</td><td>{l.unit}</td></tr>
                ))}</tbody>
              </table>
              <div className="gut-note">Кількість орієнтовна: кронштейни з кроком 60 см, тримачі труби — 1,8 м, ≤ 10 м жолоба на одну лійку.</div>
            </div>
          )}
        </div>

        <div className="kp-modal-foot">
          {step > 0 ? <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>← Назад</button> : <span />}
          {step < 3 && step > 0 && <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{step === 2 ? 'Розрахувати' : 'Далі →'}</button>}
          {step === 3 && <div className="gut-acts">
            <button className="btn btn-secondary" onClick={copy}>{copied ? 'Скопійовано ✓' : 'Копіювати'}</button>
            <button className="btn btn-primary" onClick={print}>Друк / PDF</button>
          </div>}
        </div>
      </div>
    </div>
  );
}
