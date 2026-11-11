// Кнопки-стрілки зсуву (розкладка листів, вершини ската): крок 0.1 / 0.01 / 0.001 м, затиснута — повторює
import React, { useEffect, useRef } from 'react';

export const STEPS = [
  { label: '0.1м',   mm: 100 },
  { label: '0.01м',  mm: 10  },
  { label: '0.001м', mm: 1   },
];

// Кнопка-стрілка: разове натискання — один крок; затиснута — кроки повторюються (з прискоренням), поки не відпустиш.
// onEnd — після відпускання (сервер перераховує один раз за все утримання).
export function HoldBtn({ onTick, onEnd, disabled, title, children }: { onTick: () => void; onEnd?: () => void; disabled?: boolean; title: string; children: React.ReactNode }) {
  const st = useRef<{ timer?: number; n: number; on: boolean }>({ n: 0, on: false });
  const tickRef = useRef(onTick); tickRef.current = onTick;
  const endRef = useRef(onEnd); endRef.current = onEnd;
  const stop = () => {
    if (!st.current.on) return;
    st.current.on = false; window.clearTimeout(st.current.timer);
    endRef.current?.();
  };
  const loop = () => {
    st.current.timer = window.setTimeout(() => {
      if (!st.current.on) return;
      tickRef.current(); st.current.n++; loop();
    }, st.current.n < 8 ? 120 : st.current.n < 30 ? 60 : 30);
  };
  useEffect(() => () => window.clearTimeout(st.current.timer), []);
  return (
    <button type="button" className="ls-arr" title={title} aria-label={title} disabled={disabled}
      onPointerDown={e => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        st.current.on = true; st.current.n = 0;
        tickRef.current();
        st.current.timer = window.setTimeout(loop, 400);
      }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onClick={e => { if (e.detail === 0 && !disabled) { tickRef.current(); endRef.current?.(); } }}   // клавіатура (Enter / пробіл)
      onContextMenu={e => e.preventDefault()}>
      {children}
    </button>
  );
}
