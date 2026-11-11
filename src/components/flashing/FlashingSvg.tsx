// Креслення профілю добірного елемента: сторони з розмірами, кути загинів, закатки, фарбована сторона
import React from 'react';
import { FElem, profileGeo } from './flashing';

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
  const paintC = print ? '#e8590c' : 'var(--clr-brand)';
  const off = 5;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="fl-svg">
      {/* фарбована сторона — кольорова лінія вздовж профілю */}
      {segs.map((s, i) => {
        const [ax, ay] = P(s.a), [bx, by] = P(s.b), [nx, ny] = N(s.h, e.paint);
        return <line key={'p' + i} x1={ax + nx * off} y1={ay + ny * off} x2={bx + nx * off} y2={by + ny * off} stroke={paintC} strokeWidth={2.5} strokeLinecap="round" opacity={0.85} />;
      })}
      {/* закатки — півколо між сторонами */}
      {bends.map((b, i) => {
        if (!b.hem) return null;
        const a = P(b.at), nxt = P(segs[i + 1].a);
        const r = Math.max(1, Math.hypot(nxt[0] - a[0], nxt[1] - a[1]) / 2);
        return <path key={'h' + i} d={`M${a[0]},${a[1]} A${r},${r} 0 0 ${b.dir > 0 ? 0 : 1} ${nxt[0]},${nxt[1]}`} fill="none" stroke={ink} strokeWidth={2.5} />;
      })}
      {/* сторони */}
      {segs.map((s, i) => {
        const [ax, ay] = P(s.a), [bx, by] = P(s.b);
        return (
          <g key={'s' + i} onClick={onSeg ? () => onSeg(i) : undefined} style={onSeg ? { cursor: 'pointer' } : undefined}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={14} />
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={i === hi ? paintC : ink} strokeWidth={i === hi ? 3.5 : 2.5} strokeLinecap="round" />
          </g>
        );
      })}
      <circle cx={P(segs[0].a)[0]} cy={P(segs[0].a)[1]} r={3} fill={ink} />
      {/* розміри сторін — з нефарбованого боку */}
      {segs.map((s, i) => {
        const [ax, ay] = P(s.a), [bx, by] = P(s.b), [nx, ny] = N(s.h, -e.paint);
        const L = Math.hypot(bx - ax, by - ay);
        const d = L < 30 ? 22 : 16;
        const tx = (ax + bx) / 2 + nx * d, ty = (ay + by) / 2 + ny * d;
        return (
          <text key={'d' + i} x={tx} y={ty} className="fl-dim" textAnchor="middle" dominantBaseline="middle" fill={i === hi ? paintC : ink}>
            <tspan className="fl-dim-l">{segLetter(i)}</tspan> {Math.round(Number(e.segs[i].len) * 10) / 10}
          </text>
        );
      })}
      {/* кути загинів — по бісектрисі всередині кута */}
      {bends.map((b, i) => {
        const at = P(b.at);
        const u1 = U(b.h1), u2 = U(b.h2);
        let bx = -u1[0] + u2[0], by = -u1[1] + u2[1];
        const bl = Math.hypot(bx, by);
        if (bl < 1e-6) { bx = -u1[1]; by = u1[0]; } else { bx /= bl; by /= bl; }
        const d = b.hem ? 18 : 22;
        return (
          <text key={'a' + i} x={at[0] + bx * d} y={at[1] + by * d} className="fl-ang" textAnchor="middle" dominantBaseline="middle" fill={ink}>
            {b.hem ? 'закатка' : `${Math.round(b.ang * 10) / 10}°`}
          </text>
        );
      })}
    </svg>
  );
}
