// Креслення профілю добірного елемента: сторони з розмірами, кути загинів, закатки, фарбована сторона
import React from 'react';
import { FElem, angOffset, dimOffset, profileGeo } from './flashing';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
export const segLetter = (i: number) => LETTERS[i % 26] + (i >= 26 ? Math.floor(i / 26) : '');

export default function FlashingSvg({ e, w = 420, h = 300, hi = -1, onSeg, print = false }:
  { e: FElem; w?: number; h?: number; hi?: number; onSeg?: (i: number) => void; print?: boolean }) {
  const g0 = profileGeo(e);
  const xs0 = g0.segs.flatMap(s => [s.a[0], s.b[0]]), ys0 = g0.segs.flatMap(s => [s.a[1], s.b[1]]);
  const size = Math.max(1, Math.max(...xs0, 0) - Math.min(...xs0, 0), Math.max(...ys0, 0) - Math.min(...ys0, 0));
  const { segs, bends } = profileGeo(e, size * 0.035);
  if (!segs.length) return <svg width={w} height={h} />;
  const xs = segs.flatMap(s => [s.a[0], s.b[0]]), ys = segs.flatMap(s => [s.a[1], s.b[1]]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 46;
  const k = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  const P = (p: [number, number]): [number, number] => [ox + (p[0] - minX) * k, oy + (maxY - p[1]) * k];
  // одиничні вектори у системі екрана (y — вниз)
  const U = (a: number): [number, number] => [Math.cos(a), -Math.sin(a)];
  const N = (a: number, side: number): [number, number] => [-Math.sin(a) * side, -Math.cos(a) * side];   // ліва нормаль по ходу (екран) × side
  const ink = print ? '#111' : 'var(--fl-ink)';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="fl-svg">
      {/* закатки — півколо між сторонами */}
      {bends.map((b, i) => {
        if (!b.hem) return null;
        const a = P(b.at), nxt = P(segs[i + 1].a);
        const r = Math.max(1, Math.hypot(nxt[0] - a[0], nxt[1] - a[1]) / 2);
        return <path key={'h' + i} d={`M${a[0]},${a[1]} A${r},${r} 0 0 ${b.dir > 0 ? 0 : 1} ${nxt[0]},${nxt[1]}`} fill="none" stroke={ink} strokeWidth={1.8} />;
      })}
      {/* сторони */}
      {segs.map((s, i) => {
        const [ax, ay] = P(s.a), [bx, by] = P(s.b);
        return (
          <g key={'s' + i} onClick={onSeg ? () => onSeg(i) : undefined} style={onSeg ? { cursor: 'pointer' } : undefined}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={14} />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={ink} strokeWidth={i === hi ? 2.8 : 1.8} strokeLinecap="round" />
          </g>
        );
      })}
      <circle cx={P(segs[0].a)[0]} cy={P(segs[0].a)[1]} r={3} fill={ink} />
      {/* розміри сторін — з нефарбованого боку */}
      {segs.map((s, i) => {
        const [ax, ay] = P(s.a), [bx, by] = P(s.b), [nx, ny] = N(s.h, -e.paint);
        const t = String(Math.round(Number(e.segs[i].len) * 10) / 10), d = dimOffset(t, 11, nx, ny);
        const tx = (ax + bx) / 2 + nx * d, ty = (ay + by) / 2 + ny * d;
        return (
          <text key={'d' + i} x={tx} y={ty} className="fl-dim" textAnchor="middle" dominantBaseline="central" fill={ink} fontWeight={i === hi ? 700 : 500}>{t}</text>
        );
      })}
      {/* фарбований бік — підпис «колір» біля найдовшої сторони */}
      {(() => {
        let m = 0; segs.forEach((q, i) => { if (Number(e.segs[i].len) > Number(e.segs[m].len)) m = i; });
        const q = segs[m]; if (!q) return null;
        const [ax, ay] = P(q.a), [bx, by] = P(q.b), [nx, ny] = N(q.h, e.paint), d = dimOffset('колір', 9, nx, ny, 4);
        return <text x={(ax + bx) / 2 + nx * d} y={(ay + by) / 2 + ny * d} className="fl-paint-t" textAnchor="middle" dominantBaseline="central">колір</text>;
      })()}
      {/* кути загинів — по бісектрисі всередині кута */}
      {bends.map((b, i) => {
        const at = P(b.at);
        const u1 = U(b.h1), u2 = U(b.h2);
        let bx = -u1[0] + u2[0], by = -u1[1] + u2[1];
        const bl = Math.hypot(bx, by);
        if (bl < 1e-6) { bx = -u1[1]; by = u1[0]; } else { bx /= bl; by /= bl; }
        if (!b.hem && b.ang >= 179.95) return null;
        const t = b.hem ? 'закатка' : `${Math.round(b.ang * 10) / 10}°`, d = angOffset(t, 10, b.hem ? 120 : b.ang);
        return (
          <text key={'a' + i} x={at[0] + bx * d} y={at[1] + by * d} className="fl-ang" textAnchor="middle" dominantBaseline="central" fill={ink}>
            {t}
          </text>
        );
      })}
    </svg>
  );
}
