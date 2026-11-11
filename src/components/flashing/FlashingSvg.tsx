// Креслення профілю добірного елемента: сторони з розмірами, кути загинів, закатки, фарбована сторона
import React from 'react';
import { FElem, Pt, angOffset, dimOffset, outerSides, profileGeo } from './flashing';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
export const segLetter = (i: number) => LETTERS[i % 26] + (i >= 26 ? Math.floor(i / 26) : '');

/** Фарбований бік: стрілка до лінії з підписом RAL. (mx,my) — середина сторони, (nx,ny) — нормаль у бік фарби, (lx,ly) — центр підпису */
export const RAL_FS = 9;
export function RalArrow({ mx, my, nx, ny, lx, ly, color }: { mx: number; my: number; nx: number; ny: number; lx: number; ly: number; color: string }) {
  const w = 3 * RAL_FS * 0.62, h = RAL_FS;
  const back = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2 + 2;
  const tx = mx + nx * 3, ty = my + ny * 3;                         // вістря — біля лінії
  const sx = lx - nx * back, sy = ly - ny * back;                   // хвіст — біля підпису
  const px = -ny, py = nx, a = 4.5, b = 2.2;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={sx} y1={sy} x2={tx + nx * a} y2={ty + ny * a} stroke={color} strokeWidth={1} />
      <path d={`M${tx},${ty} L${tx + nx * a + px * b},${ty + ny * a + py * b} L${tx + nx * a - px * b},${ty + ny * a - py * b} Z`} fill={color} />
      <text x={lx} y={ly} fill={color} fontSize={RAL_FS} fontWeight={600} textAnchor="middle" dominantBaseline="central" className="fl-ral" data-no-i18n>RAL</text>
    </g>
  );
}

export default function FlashingSvg({ e, w = 420, h = 300, hi = -1, onSeg, print = false }:
  { e: FElem; w?: number; h?: number; hi?: number; onSeg?: (i: number) => void; print?: boolean }) {
  const g0 = profileGeo(e);
  const xs0 = g0.segs.flatMap(s => [s.a[0], s.b[0]]), ys0 = g0.segs.flatMap(s => [s.a[1], s.b[1]]);
  const size = Math.max(1, Math.max(...xs0, 0) - Math.min(...xs0, 0), Math.max(...ys0, 0) - Math.min(...ys0, 0));
  const { segs, bends } = profileGeo(e, size * 0.014);
  const outer = segs.length ? outerSides(e.segs, [...segs.map(q => q.a as Pt), segs[segs.length - 1].b as Pt], segs.map(q => q.h), (-e.paint) as 1 | -1) : [];
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
        return <path key={'h' + i} d={`M${a[0]},${a[1]} A${r},${r} 0 0 ${b.dir > 0 ? 0 : 1} ${nxt[0]},${nxt[1]}`} fill="none" stroke={ink} strokeWidth={1.2} />;
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
        const [ax, ay] = P(s.a), [bx, by] = P(s.b), [nx, ny] = N(s.h, outer[i]);
        const t = String(Math.round(Number(e.segs[i].len) * 10) / 10), d = dimOffset(t, 11, nx, ny);
        const tx = (ax + bx) / 2 + nx * d, ty = (ay + by) / 2 + ny * d;
        return (
          <text key={'d' + i} x={tx} y={ty} className="fl-dim" textAnchor="middle" dominantBaseline="central" fill={ink} fontWeight={i === hi ? 700 : 500}>{t}</text>
        );
      })}
      {/* фарбований бік — стрілка RAL біля найдовшої сторони */}
      {(() => {
        // найдовша сторона, де розмір — з іншого боку, ніж фарба (щоб стрілка не перетинала розмір)
        const sc = (i: number) => Number(e.segs[i].len) * (outer[i] !== e.paint ? 10 : 1);
        let m = 0; segs.forEach((q, i) => { if (sc(i) > sc(m)) m = i; });
        const q = segs[m]; if (!q) return null;
        const [ax, ay] = P(q.a), [bx, by] = P(q.b), [nx, ny] = N(q.h, e.paint), d = 18 + dimOffset('RAL', RAL_FS, nx, ny, 0);
        const mx = ax + (bx - ax) * 0.25, my = ay + (by - ay) * 0.25;   // чверть сторони — подалі від розміру посередині
        return <RalArrow mx={mx} my={my} nx={nx} ny={ny} lx={mx + nx * d} ly={my + ny * d} color={ink} />;
      })()}
      {/* кути загинів — по бісектрисі всередині кута */}
      {bends.map((b, i) => {
        const at = P(b.at);
        const u1 = U(b.h1), u2 = U(b.h2);
        let bx = -u1[0] + u2[0], by = -u1[1] + u2[1];
        const bl = Math.hypot(bx, by);
        if (bl < 1e-6) { bx = -u1[1]; by = u1[0]; } else { bx /= bl; by /= bl; }
        if (!b.hem && b.ang >= 179.95) return null;
        const t = b.hem ? 'завальц.' : `${Math.round(b.ang * 10) / 10}°`, d = angOffset(t, 10, b.hem ? 120 : b.ang);
        return (
          <text key={'a' + i} x={at[0] + bx * d} y={at[1] + by * d} className="fl-ang" textAnchor="middle" dominantBaseline="central" fill={ink}>
            {t}
          </text>
        );
      })}
    </svg>
  );
}
