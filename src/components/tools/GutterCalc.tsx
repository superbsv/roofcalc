// ============================================
// Калькулятор водостоку — повторює калькулятор profil.com.ua/calculator:
// 1. Тип покрівлі → 2. Параметри покрівлі → 3. Підбір кольору → 4. Результат.
// ============================================
import React, { useEffect, useMemo, useState } from 'react';
import { KINDS, RoofKind, COLORS, calculate, Params } from './gutter';
import RoofPic from './RoofPics';
import { t, translateTree } from '../../i18n/i18n';

const STEPS = ['1. Тип покрівлі', '2. Параметри покрівлі', '3. Підбір кольору', '4. Результат'];
const num = (s: string | undefined) => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export default function GutterCalc({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<RoofKind>('r1');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [height, setHeight] = useState('');
  const [system, setSystem] = useState<Params['system']>('130/100');
  const [color, setColor] = useState(COLORS[1].id);
  const [tried, setTried] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const def = KINDS.find(k => k.id === kind)!;
  const v = useMemo(() => Object.fromEntries(def.letters.map(l => [l, num(vals[l])])), [def, vals]);
  const res = calculate(kind, v, { height: num(height), system });
  const col = COLORS.find(c => c.id === color)!;
  const kindNo = KINDS.indexOf(def) + 1;

  const pickKind = (k: RoofKind) => { if (k !== kind) { setVals({}); setTried(false); } setKind(k); setStep(1); };
  const toColor = () => { setTried(true); if (!res.error) setStep(2); };
  const go = (i: number) => { if (i <= step) setStep(i); else if (step === 1 && i === 2) toColor(); else if (i === step + 1 && step !== 1) setStep(i); };

  const sides = def.letters.filter(l => v[l] > 0).map(l => `${l} = ${v[l]} м`).join(', ');
  const text = () => [
    `Водостічна система ${system} мм, колір ${col.name} (RAL ${col.id})`,
    `Тип покрівлі №${kindNo}; ${sides}; висота будинку ${num(height)} м`,
    ...res.lines.map(l => `${l.name} — ${l.qty} ${l.unit}`),
  ].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text().split('\n').map(t).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  const print = () => {
    const w = window.open('', '_blank', 'width=720,height=900'); if (!w) return;
    const rows = res.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${l.name}</td><td style="text-align:right">${l.qty}</td><td>${l.unit}</td></tr>`).join('');
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Водостік — ROOFKIT</title><style>body{font:14px/1.4 Arial,sans-serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#EEF2F7}</style>
      <h2>Розрахунок водостічної системи</h2><p>Система ${system} мм · колір ${col.name} (RAL ${col.id})<br>Тип покрівлі №${kindNo}: ${sides}; висота будинку ${num(height)} м<br>Жолоб: ${res.gutterLen.toFixed(2)} м · водостоків: ${res.pipes}</p>
      <table><tr><th>№</th><th>Найменування</th><th>К-сть</th><th>Од.</th></tr>${rows}</table><p style="color:#777;font-size:12px">Розраховано в ROOFKIT · roofkit.com.ua</p>`);
    w.document.close(); translateTree(w.document.body); w.document.title = t(w.document.title); w.focus(); w.print();
  };

  const field = (key: string, label: string, value: string, onChange: (s: string) => void) => (
    <label key={key} className={`gut-f${tried && def.need.includes(key) && !(num(value) > 0) ? ' bad' : ''}`}>
      <span>{label}</span>
      <span className="gut-f-in"><input inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && toColor()} aria-label={label} /><i>м</i></span>
    </label>
  );

  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Калькулятор водостоку" onClick={onClose}>
      <div className="kp-modal-box gut-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>Калькулятор водостоку</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>

        <ol className="gut-bar">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <button onClick={() => go(i)}>{s}</button>
            </li>
          ))}
        </ol>

        <div className="gut-body">
          {step === 0 && <>
            <div className="gut-h">Крок 1. Оберіть тип покрівлі</div>
            <div className="gut-kinds">
              {KINDS.map((k, i) => (
                <button key={k.id} className={`gut-kind${k.id === kind ? ' on' : ''}`} onClick={() => pickKind(k.id)} aria-label={`Тип покрівлі ${i + 1}`}>
                  <RoofPic kind={k.id} />
                </button>
              ))}
            </div>
          </>}

          {step === 1 && <>
            <div className="gut-h">Крок 2. Вкажіть параметри покрівлі</div>
            <div className="gut-p2">
              <div className="gut-p2-left">
                <div className="gut-fields">
                  {def.letters.map(l => field(l, `Сторона ${l}`, vals[l] ?? '', s => setVals(x => ({ ...x, [l]: s }))))}
                  {field('H', 'Висота будинку', height, setHeight)}
                </div>
                {tried && res.error && <div className="alert alert-error" style={{ marginTop: 12 }}>{res.error}</div>}
                <p className="gut-note"><b>*Примітка:</b> Параметри покрівлі можуть бути цілими або десятковими числами. Десяткові записуються через «крапку». Наприклад: 15.5</p>
              </div>
              <div className="gut-p2-right">
                <div className="gut-arrows">
                  <button className="gut-back" onClick={() => setStep(0)}>Повернутися</button>
                  <button className="gut-next" onClick={toColor}>3. Вибрати колір водостоку</button>
                </div>
                <div className="gut-bigpic"><RoofPic kind={kind} /></div>
              </div>
            </div>
          </>}

          {step === 2 && <>
            <div className="gut-h">Крок 3. Оберіть колір водостоку</div>
            <div className="gut-colors">
              {COLORS.map(c => (
                <button key={c.id} className={`gut-color${c.id === color ? ' on' : ''}`} onClick={() => setColor(c.id)}>
                  <i style={{ background: c.hex }} /><span>{c.name}</span><small>RAL {c.id}</small>
                </button>
              ))}
            </div>
            <div className="gut-sys">
              <span>Система (жолоб / труба):</span>
              {(['130/100', '90/75'] as const).map(s => (
                <label key={s}><input type="radio" name="gut-sys" checked={system === s} onChange={() => setSystem(s)} /> {s} мм</label>
              ))}
            </div>
            <div className="gut-arrows gut-arrows-row">
              <button className="gut-back" onClick={() => setStep(1)}>Повернутися</button>
              <button className="gut-next" onClick={() => setStep(3)}>4. Розрахувати</button>
            </div>
          </>}

          {step === 3 && <>
            <div className="gut-h">Крок 4. Результат</div>
            <div className="gut-res">
              <div className="gut-res-pic"><RoofPic kind={kind} /></div>
              <div className="gut-res-main">
                <div className="gut-res-head">
                  <i style={{ background: col.hex }} />
                  <div><b>Система {system} мм · {col.name} (RAL {col.id})</b>
                    <div>{sides}; висота {num(height)} м · жолоб {res.gutterLen.toFixed(2)} м · водостоків {res.pipes}</div></div>
                </div>
                <table className="gut-table">
                  <thead><tr><th>№</th><th>Найменування</th><th>К-сть</th><th>Од.</th></tr></thead>
                  <tbody>{res.lines.map((l, i) => (
                    <tr key={l.name}><td>{i + 1}</td><td>{l.name}</td><td className="n">{l.qty}</td><td>{l.unit}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="gut-arrows gut-arrows-row">
              <button className="gut-back" onClick={() => setStep(2)}>Повернутися</button>
              <div className="gut-acts">
                <button className="btn btn-secondary" onClick={copy}>{copied ? 'Скопійовано ✓' : 'Копіювати'}</button>
                <button className="btn btn-primary" onClick={print}>Друк / PDF</button>
              </div>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
