// Поле вводу числа: зберігає те, що набрано (кома, порожньо), а наверх віддає число; ↑/↓ — крок
import React, { useEffect, useRef, useState } from 'react';

export const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export default function NumIn({ value, onChange, className, title, step, autoFocus, onEnter }:
  { value: number; onChange: (v: number) => void; className?: string; title?: string; step?: number; autoFocus?: boolean; onEnter?: () => void }) {
  const [t, setT] = useState(String(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setT(String(value)); last.current = value; } }, [value]);
  return (
    <input className={'form-control ' + (className || '')} inputMode="decimal" title={title} value={t} autoFocus={autoFocus}
      onFocus={e => { if (autoFocus) e.target.select(); }}
      onChange={e => { setT(e.target.value); const n = num(e.target.value); last.current = n; onChange(n); }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); onEnter?.(); return; }
        if (!step || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const n = Math.round((num(t) + (e.key === 'ArrowUp' ? step : -step)) * 10) / 10;
        setT(String(n)); last.current = n; onChange(n);
      }} />
  );
}
