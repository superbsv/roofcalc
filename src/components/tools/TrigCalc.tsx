// ============================================
// Калькулятор тригонометричний (як у «Кровля Профи»): прямокутний і довільний трикутник.
// Вводите будь-які відомі величини → «Розрахунок» заповнює решту і площу.
// ============================================
import React, { useEffect, useState } from 'react';
import { solveTriangle, TriKey, TriVals } from './trig';

type Mode = 'right' | 'any';
type Field = TriKey | 'S';
const FIELDS: Field[] = ['a', 'b', 'c', 'A', 'B', 'C', 'S'];
const isAngle = (k: Field) => k === 'A' || k === 'B' || k === 'C';
const LABEL: Record<Field, string> = { a: 'a', b: 'b', c: 'c', A: 'α', B: 'β', C: 'γ', S: 'S' };
const UNIT: Record<Field, string> = { a: 'м', b: 'м', c: 'м', A: 'град.', B: 'град.', C: 'град.', S: 'кв.м' };

// Розташування полів на схемі (px у блоці 440×340)
const POS: Record<Mode, Partial<Record<Field, [number, number]>>> = {
  right: { S: [170, 14], A: [14, 74], c: [176, 150], b: [14, 186], C: [14, 268], B: [244, 268], a: [130, 306] },
  any:   { S: [160, 14], A: [150, 74], b: [26, 176], c: [260, 176], C: [26, 268], B: [270, 268], a: [150, 306] },
};
const TRI: Record<Mode, string> = { right: '84,54 84,290 300,290', any: '220,80 70,290 370,290' };

const parse = (s: string) => { const v = parseFloat(s.replace(',', '.').trim()); return Number.isFinite(v) ? v : NaN; };
const fmt = (k: Field, v: number) => (isAngle(k) ? v.toFixed(2) : v.toFixed(3));

export default function TrigCalc({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('right');
  const [vals, setVals] = useState<Record<Field, string>>({ a: '', b: '', c: '', A: '', B: '', C: '90.00', S: '' });
  const [mine, setMine] = useState<Set<Field>>(new Set());   // поля, які ввів користувач
  const [msg, setMsg] = useState<{ t: 'err' | 'note'; s: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reset = (m: Mode = mode) => {
    setVals({ a: '', b: '', c: '', A: '', B: '', C: m === 'right' ? '90.00' : '', S: '' });
    setMine(new Set()); setMsg(null);
  };
  const switchMode = (m: Mode) => { setMode(m); reset(m); };

  const edit = (k: Field, s: string) => {
    setVals(v => ({ ...v, [k]: s }));
    setMine(m => { const n = new Set(m); if (s.trim() === '') n.delete(k); else n.add(k); return n; });
    setMsg(null);
  };

  const calc = () => {
    const input: TriVals = {};
    mine.forEach(k => { if (k !== 'S') { const v = parse(vals[k]); if (v > 0) input[k] = v; } });
    if (mode === 'right') input.C = 90;
    if (mode === 'right' && (input.A ?? 0) + (input.B ?? 0) >= 90 && input.A && input.B) { setMsg({ t: 'err', s: 'У прямокутному трикутнику α + β = 90°' }); return; }
    try {
      const r = solveTriangle(input);
      const next = { ...vals };
      FIELDS.forEach(k => { if (!mine.has(k) || k === 'S') next[k] = fmt(k, (r.vals as any)[k]); });
      if (mode === 'right') next.C = '90.00';
      setVals(next);
      setMsg(r.note ? { t: 'note', s: r.note } : null);
    } catch (e: any) { setMsg({ t: 'err', s: e.message }); }
  };

  const shown: Field[] = FIELDS;
  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Калькулятор тригонометричний" onClick={onClose}>
      <div className="kp-modal-box trig-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>Калькулятор тригонометричний</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        <div className="trig-tabs" role="tablist">
          {([['right', 'Прямокутний трикутник'], ['any', 'Довільний трикутник']] as const).map(([m, l]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)}>{l}</button>
          ))}
        </div>
        <div className="trig-scroll">
          <div className="trig-pane">
            <svg width="440" height="340" viewBox="0 0 440 340" aria-hidden="true">
              <polygon points={TRI[mode]} fill="var(--clr-brand-pale)" stroke="var(--clr-text)" strokeWidth="3" strokeLinejoin="round" />
              {mode === 'right' && <path d="M84 270 H104 V290" fill="none" stroke="var(--clr-text-2)" strokeWidth="1.5" />}
            </svg>
            {shown.map(k => {
              const pos = POS[mode][k]; if (!pos) return null;
              const fixed = mode === 'right' && k === 'C';
              const ro = fixed || k === 'S';
              return (
                <label key={k} className={`trig-f${isAngle(k) ? ' ang' : ''}${mine.has(k) ? ' mine' : ''}`} style={{ left: pos[0], top: pos[1] }}>
                  <b>{LABEL[k]}</b> =
                  <input inputMode="decimal" value={vals[k]} readOnly={ro} tabIndex={ro ? -1 : 0}
                    onChange={e => edit(k, e.target.value)} onKeyDown={e => e.key === 'Enter' && calc()} aria-label={`${LABEL[k]}, ${UNIT[k]}`} />
                  <span>{UNIT[k]}</span>
                </label>
              );
            })}
          </div>
        </div>
        {msg && <div className={`alert ${msg.t === 'err' ? 'alert-error' : 'alert-info'} trig-msg`}>{msg.s}</div>}
        <div className="trig-hint">
          {mode === 'right' ? 'Введіть дві відомі величини (хоча б одну сторону). γ = 90°.' : 'Введіть три відомі величини, серед них хоча б одну сторону.'} Кут α — навпроти сторони a, β — навпроти b, γ — навпроти c.
        </div>
        <div className="kp-modal-foot">
          <button className="btn btn-secondary" onClick={() => reset()}>Обнулити</button>
          <button className="btn btn-primary" onClick={calc}>Розрахунок</button>
        </div>
      </div>
    </div>
  );
}
