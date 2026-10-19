// Схема шаблону ската з розмірними лініями і буквами параметрів (a, c, h, a1…), як у вікні шаблону КП.
// Малюється з поточних введених розмірів, тож схема змінюється разом із полями.
import React from 'react';
import { Template } from './templates';

interface Props {
  t: Template;
  values: Record<string, string>;
  focus?: string | null;
}

export default function TemplateSketch({ t, values, focus }: Props) {
  const nums: Record<string, number> = {};
  t.params.forEach(p => {
    const v = parseFloat(String(values[p.key] ?? '').replace(',', '.'));
    nums[p.key] = Number.isFinite(v) && v > 0 ? v : p.default;
  });
  let pts = t.build(nums);
  if (pts.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    const d: Record<string, number> = {};
    t.params.forEach(p => { d[p.key] = p.default; });
    pts = t.build(d);
  }
  const xs0 = pts.map(p => p[0]), ys0 = pts.map(p => p[1]);
  const size = Math.max(Math.max(...xs0) - Math.min(...xs0), Math.max(...ys0) - Math.min(...ys0), 0.1);
  const g = size * 0.12;
  const dims = t.dims(nums, g);

  // Межі з урахуванням розмірних ліній
  const xs = [...xs0], ys = [...ys0];
  dims.forEach(d => {
    if (d.dir === 'h') { xs.push(d.x1, d.x2); ys.push(d.at); } else { ys.push(d.y1, d.y2); xs.push(d.at); }
  });
  const pad = g * 0.9;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const W = 400, Hh = 300;
  const k = Math.min(W / (maxX - minX), Hh / (maxY - minY));
  const ox = (W - (maxX - minX) * k) / 2, oy = (Hh - (maxY - minY) * k) / 2;
  const X = (x: number) => ox + (x - minX) * k;
  const Y = (y: number) => Hh - oy - (y - minY) * k;
  const poly = pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');

  return (
    <svg className="kp-modal-pic" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={`Схема: ${t.name}`}>
      <defs>
        <marker id="tsArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" fill="context-stroke" />
        </marker>
      </defs>
      <polygon points={poly} fill="var(--clr-brand-pale)" stroke="var(--clr-brand)" strokeWidth="3" strokeLinejoin="round" />
      {dims.map((d, i) => {
        const on = focus === d.k;
        const col = on ? 'var(--clr-brand)' : 'var(--clr-text-2)';
        let ext: [number, number, number, number][], line: [number, number, number, number], lx: number, ly: number;
        if (d.dir === 'h') {
          ext = [[X(d.x1), Y(d.y1), X(d.x1), Y(d.at)], [X(d.x2), Y(d.y2), X(d.x2), Y(d.at)]];
          line = [X(d.x1), Y(d.at), X(d.x2), Y(d.at)];
          lx = (X(d.x1) + X(d.x2)) / 2; ly = Y(d.at) - 6;
        } else {
          ext = [[X(d.x1), Y(d.y1), X(d.at), Y(d.y1)], [X(d.x2), Y(d.y2), X(d.at), Y(d.y2)]];
          line = [X(d.at), Y(d.y1), X(d.at), Y(d.y2)];
          lx = X(d.at) + 7; ly = (Y(d.y1) + Y(d.y2)) / 2 + 5;
        }
        const tiny = Math.hypot(line[2] - line[0], line[3] - line[1]) < 14;
        return (
          <g key={i} stroke={col} strokeWidth={on ? 1.8 : 1.1}>
            {ext.map((e, j) => <line key={j} x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} strokeDasharray="3 3" opacity=".7" />)}
            <line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]}
              markerStart={tiny ? undefined : 'url(#tsArrow)'} markerEnd={tiny ? undefined : 'url(#tsArrow)'} />
            <text x={lx} y={ly} textAnchor={d.dir === 'h' ? 'middle' : 'start'} stroke="var(--clr-canvas)" strokeWidth="5" fill={on ? 'var(--clr-brand)' : 'var(--clr-text)'}
              fontSize="17" fontWeight="800" fontFamily="var(--font-display)" style={{ paintOrder: 'stroke' }}>
              {d.k}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
