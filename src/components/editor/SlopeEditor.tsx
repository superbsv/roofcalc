// ============================================
// ArtBudTrading Roof Calculator
// components/editor/SlopeEditor.tsx
// ============================================

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { TEMPLATES, buildTemplate, templateIconPoints, sideLetter } from '../roof/templates';
import { useTheme, Theme } from '../theme/theme';
import { Point, Slope, SheetPlacement, CalcResult, EdgeType } from '../../api/client';
import { edgeColor, interiorAngles, fmtAngle, setSideLength, setVertexAngle } from '../roof/edges';

interface Props {
  slope: Slope | null;
  calcResult?: CalcResult | null;
  onPolygonChange: (points: Point[]) => void;
  readOnly?: boolean;
  gridScale?: number;
  edgeTypes?: EdgeType[];   // підсвітка ребер за типом
  holes?: Point[][];        // вирізи, мм
  bare?: boolean;           // без власних бічних панелей (вікно ската КП)
}

// Палітри полотна ABT для темної і світлої теми (canvas не читає CSS-змінні, тому hex)
type Palette = {
  grid: string; axis: string; polygon: string; polygonFill: string; point: string; pointFirst: string;
  sheet: string[]; sheetBorder: string[]; dim: string; tooltip: string; cursorLen: string;
  label: string; tooltipBg: string; tooltipText: string; pointStroke: string;
};
const PALETTES: Record<Theme, Palette> = {
  dark: {
    grid: '#1E1E1E', axis: '#344154', polygon: '#F5F7FA', polygonFill: 'rgba(255,122,0,0.10)',
    point: '#FF7A1A', pointFirst: '#FF5A5A',
    sheet: ['rgba(191,195,199,0.20)','rgba(191,195,199,0.34)'], sheetBorder: ['#C3CBD5','#7C8A9C'],
    dim: '#C3CBD5', tooltip: '#0B1119', cursorLen: '#FF7A1A',
    label: '#94A3B8', tooltipBg: 'rgba(13,13,13,0.92)', tooltipText: '#FFFFFF', pointStroke: '#0B1119',
  },
  light: {
    grid: '#E8E8E4', axis: '#C2C4C6', polygon: '#151E29', polygonFill: 'rgba(255,122,0,0.10)',
    point: '#FF7A1A', pointFirst: '#C8322F',
    sheet: ['rgba(78,82,88,0.14)','rgba(78,82,88,0.26)'], sheetBorder: ['#4E5258','#2E3135'],
    dim: '#4E5258', tooltip: '#151E29', cursorLen: '#C25E00',
    label: '#64748B', tooltipBg: 'rgba(26,26,26,0.92)', tooltipText: '#FFFFFF', pointStroke: '#FFFFFF',
  },
};

// Точність прив'язки — 1мм
const SNAP_PRECISION = 0.001;

export default function SlopeEditor({ slope, calcResult, onPolygonChange, readOnly, gridScale = 1, edgeTypes, holes, bare }: Props) {
  const theme  = useTheme();
  const COLORS = PALETTES[theme];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  const [points, setPoints]         = useState<Point[]>([]);
  const [closed, setClosed]         = useState(false);
  const [mode, setMode]             = useState<'draw'|'move'>('draw');
  const [mouse, setMouse]           = useState<Point>([0, 0]);
  const [scale, setScale]           = useState(60);
  const [offset, setOffset]         = useState<Point>([60, 40]);
  const [dragIdx, setDragIdx]       = useState(-1);
  const [hoverEdge, setHoverEdge]   = useState(-1);
  // Точне введення: клік по стороні — довжина, клік по вершині — внутрішній кут
  const [prompt, setPrompt] = useState<{ kind: 'side' | 'angle'; idx: number; x: number; y: number; value: string } | null>(null);
  const downRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const promptInput = useRef<HTMLInputElement>(null);
  const promptKey = prompt ? `${prompt.kind}${prompt.idx}` : '';
  useEffect(() => {
    if (!promptKey) return;
    const t = setTimeout(() => { promptInput.current?.focus(); promptInput.current?.select(); }, 0);
    return () => clearTimeout(t);
  }, [promptKey]);
  const [hoverIdx, setHoverIdx]     = useState(-1);
  const [showLayout, setShowLayout] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<number | null>(null);

  const [tplModal, setTplModal]   = useState(false);
  const [tplIdx, setTplIdx]       = useState(0);
  const [tplValues, setTplValues] = useState<Record<string,string>>({});

  useEffect(() => {
    if (slope?.polygon_points?.length) {
      const pts = slope.polygon_points.map(([x,y]): Point => [x/1000, y/1000]);
      setPoints(pts);
      setClosed(true);
      setShowLayout(!!slope.calc_result);
      setTimeout(() => fitView(pts), 100);
    } else {
      setPoints([]); setClosed(false); setShowLayout(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slope?.id]);

  useEffect(() => {
    if (calcResult && !calcResult.errors?.length) setShowLayout(true);
    else if (calcResult?.errors?.length) setShowLayout(false);
  }, [calcResult]);

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx, W, H);
    if (showLayout && calcResult?.placements) drawLayout(ctx, calcResult.placements);
    drawPolygon(ctx, H);
    drawHoles(ctx, H);
    drawEdgeTypes(ctx, H);
    drawAngles(ctx, H);
    if (closed && (hoverEdge >= 0 || prompt?.kind === 'side')) {
      const ei = prompt?.kind === 'side' ? prompt.idx : hoverEdge;
      const a = points[ei], b = points[(ei + 1) % points.length];
      if (a && b) {
        const [ax, ay] = w2s(a[0], a[1], H), [bx, by] = w2s(b[0], b[1], H);
        ctx.save(); ctx.strokeStyle = COLORS.pointFirst; ctx.lineWidth = 4; ctx.globalAlpha = .6;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
      }
    }
    drawPoints(ctx, H);
    if (mode === 'draw' && !closed) drawCursorInfo(ctx, H);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, closed, mouse, scale, offset, mode, showLayout, calcResult, hoverIdx, dragIdx, theme, edgeTypes, holes, hoverEdge, prompt]);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cv = canvasRef.current;
      if (!cv) return;
      cv.width  = el.clientWidth;
      cv.height = el.clientHeight;
      render();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [render]);

  const w2s = (wx: number, wy: number, H: number): [number,number] =>
    [wx * scale + offset[0], H - (wy * scale + offset[1])];

  const s2w = (sx: number, sy: number, H: number): Point => {
    const wx = (sx - offset[0]) / scale;
    const wy = (H - sy - offset[1]) / scale;
    // Прив'язка до 1мм
    return [
      Math.round(wx / SNAP_PRECISION) * SNAP_PRECISION,
      Math.round(wy / SNAP_PRECISION) * SNAP_PRECISION,
    ];
  };

  function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const step = scale * gridScale;
    ctx.save();

    // Тонкі лінії сітки по всій площині
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    // Вертикальні лінії — від лівого краю до правого
    const startX = ((offset[0] % step) + step) % step;
    for (let x = startX; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // Горизонтальні лінії
    const startY = (((H - offset[1]) % step) + step) % step;
    for (let y = startY; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Осі X та Y (жирніші)
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    const axisY = H - offset[1];
    if (axisY >= 0 && axisY <= H) {
      ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(W, axisY); ctx.stroke();
    }
    const axisX = offset[0];
    if (axisX >= 0 && axisX <= W) {
      ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, H); ctx.stroke();
    }

    // Підписи по X (на всю ширину)
    ctx.fillStyle = COLORS.label;
    ctx.font = '10px Inter, system-ui, sans-serif';
    const labelY = Math.min(H - 4, axisY + 14);
    // Знаходимо першу мітку зліва
    const firstI = Math.floor(-offset[0] / step);
    for (let i = firstI; i * step + offset[0] < W; i++) {
      const px = i * step + offset[0];
      if (px < 0) continue;
      const val = (i * gridScale).toFixed(gridScale < 1 ? 1 : 0);
      ctx.fillText(val + 'м', px + 3, labelY);
      // Мала риска на осі
      ctx.beginPath(); ctx.moveTo(px, axisY - 3); ctx.lineTo(px, axisY + 3);
      ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1; ctx.stroke();
    }

    // Підписи по Y (на всю висоту)
    const firstJ = Math.floor((offset[1] - H) / step);
    for (let j = firstJ; j * step < offset[1]; j++) {
      const py = H - offset[1] + j * step;
      if (py < 0 || py > H) continue;
      if (j === 0) continue;
      const val = (-j * gridScale).toFixed(gridScale < 1 ? 1 : 0);
      ctx.fillText(val, axisX < 30 ? 2 : axisX - 28, py - 2);
      ctx.beginPath(); ctx.moveTo(axisX - 3, py); ctx.lineTo(axisX + 3, py);
      ctx.strokeStyle = COLORS.axis; ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.restore();
  }

  function drawPolygon(ctx: CanvasRenderingContext2D, H: number) {
    if (!points.length) return;
    ctx.save();
    ctx.beginPath();
    const [sx, sy] = w2s(points[0][0], points[0][1], H);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < points.length; i++) {
      const [px, py] = w2s(points[i][0], points[i][1], H);
      ctx.lineTo(px, py);
    }
    if (closed) {
      ctx.closePath();
      ctx.fillStyle = COLORS.polygonFill; ctx.fill();
    } else if (mode === 'draw') {
      ctx.lineTo(mouse[0], mouse[1]);
    }
    ctx.strokeStyle = COLORS.polygon; ctx.lineWidth = 2;
    ctx.stroke();

    // Підписи довжин сторін
    if (closed) {
      ctx.font = '11px "JetBrains Mono", ui-monospace, sans-serif';
      ctx.fillStyle = COLORS.dim;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const len = Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2);
        const [mx, my] = w2s((a[0]+b[0])/2, (a[1]+b[1])/2, H);
        ctx.fillText(`${sideLetter(i)} = ${len.toFixed(3)}`, mx + 4, my - 4);
      }
    }
    ctx.restore();
  }

  // Внутрішні кути площини біля кожної вершини (дуга + значення в градусах)
  function drawAngles(ctx: CanvasRenderingContext2D, H: number) {
    if (!closed || points.length < 3) return;
    const angs = interiorAngles(points);
    ctx.save();
    ctx.font = '600 11px "JetBrains Mono", ui-monospace, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    angs.forEach((a, i) => {
      if (Math.abs(a.deg - 180) < 0.05) return;
      const [sx, sy] = w2s(points[i][0], points[i][1], H);
      ctx.strokeStyle = COLORS.pointFirst; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(sx, sy, 18, -a.start, -(a.start + a.sweep), true); ctx.stroke();
      ctx.globalAlpha = 1;
      const b = a.start + a.sweep / 2;
      const lx = sx + Math.cos(b) * 36, ly = sy - Math.sin(b) * 36;
      const t = fmtAngle(a.deg);
      const w = ctx.measureText(t).width + 6;
      ctx.fillStyle = COLORS.tooltipBg; ctx.fillRect(lx - w / 2, ly - 8, w, 16);
      ctx.fillStyle = COLORS.tooltipText; ctx.fillText(t, lx, ly);
    });
    ctx.restore();
  }

  // Ребра, пофарбовані за типом (карниз, конек, хребет…)
  function drawEdgeTypes(ctx: CanvasRenderingContext2D, H: number) {
    if (!closed || !edgeTypes || edgeTypes.length !== points.length) return;
    ctx.save();
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let i = 0; i < points.length; i++) {
      const t = edgeTypes[i];
      if (t === 'none') continue;
      const a = points[i], b = points[(i + 1) % points.length];
      const [ax, ay] = w2s(a[0], a[1], H);
      const [bx, by] = w2s(b[0], b[1], H);
      ctx.strokeStyle = edgeColor(t, theme);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.restore();
  }

  // Вирізи (труби, вікна) — штрихова рамка
  function drawHoles(ctx: CanvasRenderingContext2D, H: number) {
    if (!holes?.length) return;
    ctx.save();
    holes.forEach((h, hi) => {
      if (h.length < 3) return;
      ctx.beginPath();
      h.forEach(([x, y], i) => {
        const [sx, sy] = w2s(x / 1000, y / 1000, H);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = theme === 'dark' ? '#0F1722' : '#FAFAF8';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = COLORS.polygon; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.setLineDash([]);
      const [lx, ly] = w2s(h[0][0] / 1000, h[0][1] / 1000, H);
      ctx.font = '10px "JetBrains Mono", ui-monospace, sans-serif';
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`Виріз ${hi + 1}`, lx + 4, ly - 4);
    });
    ctx.restore();
  }

  // Підсвічування координат та довжини поточного відрізка
  function drawCursorInfo(ctx: CanvasRenderingContext2D, H: number) {
    const [wx, wy] = s2w(mouse[0], mouse[1], H);
    const mx = mouse[0], my = mouse[1];

    ctx.save();
    ctx.font = '11px "JetBrains Mono", ui-monospace, sans-serif';

    // Перехрестя на курсорі
    ctx.strokeStyle = 'rgba(255,122,0,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(canvasRef.current!.width, my); ctx.stroke();
    ctx.setLineDash([]);

    // Рядок координат і довжини
    const coordStr = `X = ${wx.toFixed(3)} м;  Y = ${wy.toFixed(3)} м`;
    let lenStr = '';
    if (points.length > 0) {
      const last = points[points.length - 1];
      const len = Math.sqrt((wx - last[0])**2 + (wy - last[1])**2);
      lenStr = `  a = ${len.toFixed(3)} м`;
    }
    const fullStr = coordStr + lenStr;

    // Тло підказки
    const textW = ctx.measureText(fullStr).width + 16;
    const textH = 20;
    let bx = mx + 14, by = my - 30;
    const W = canvasRef.current!.width;
    if (bx + textW > W - 4) bx = mx - textW - 14;
    if (by < 4) by = my + 14;

    ctx.fillStyle = COLORS.tooltipBg;
    ctx.beginPath();
    ctx.roundRect?.(bx, by, textW, textH, 4);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(coordStr, bx + 8, by + 13);

    if (lenStr) {
      ctx.fillStyle = '#FFB15C';
      ctx.fillText(lenStr, bx + 8 + ctx.measureText(coordStr).width, by + 13);
    }

    // Крапка прив'язки
    ctx.fillStyle = COLORS.cursorLen;
    ctx.beginPath();
    ctx.arc(mx, my, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawPoints(ctx: CanvasRenderingContext2D, H: number) {
    points.forEach((p, i) => {
      const [sx, sy] = w2s(p[0], p[1], H);
      const isActive = i === dragIdx || i === hoverIdx;
      // Кільце навколо активної точки
      if (isActive) {
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,122,0,0.15)';
        ctx.fill();
        ctx.strokeStyle = COLORS.dim; ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, isActive ? 7 : (i === 0 && !closed ? 6 : 4), 0, Math.PI * 2);
      ctx.fillStyle   = i === 0 ? COLORS.pointFirst : (isActive ? COLORS.dim : COLORS.point);
      ctx.fill();
      ctx.strokeStyle = COLORS.pointStroke; ctx.lineWidth = 1.5; ctx.stroke();
      // Координати активної точки
      if (isActive) {
        ctx.font = '11px "JetBrains Mono", ui-monospace, sans-serif';
        ctx.fillStyle = COLORS.dim;
        const label = `(${p[0].toFixed(3)}; ${p[1].toFixed(3)})`;
        ctx.fillText(label, sx + 12, sy - 8);
        if (closed && points.length >= 3 && i === dragIdx) {
          // Довжини прилеглих сторін — як при точному доведенні вершини у КП
          const n = points.length, pi = (i - 1 + n) % n, ni = (i + 1) % n;
          const len = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3);
          ctx.font = '600 12px "JetBrains Mono", ui-monospace, sans-serif';
          ctx.fillStyle = COLORS.pointFirst;
          ctx.fillText(`${sideLetter(pi)} = ${len(points[pi], p)}   ${sideLetter(i)} = ${len(p, points[ni])}`, sx + 12, sy + 16);
        }
      }
    });
  }

  function drawLayout(ctx: CanvasRenderingContext2D, placements: SheetPlacement[]) {
    const H = canvasRef.current!.height;
    ctx.save();
    if (points.length >= 3) {
      ctx.beginPath();
      const [sx, sy] = w2s(points[0][0], points[0][1], H);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < points.length; i++) {
        const [px, py] = w2s(points[i][0], points[i][1], H);
        ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.clip();
    }
    placements.forEach((pl, idx) => {
      const mmToM = 1/1000;
      const [px, py] = w2s(pl.x * mmToM, pl.y * mmToM, H);
      const pw = pl.useful_width * mmToM * scale;
      const ph = pl.length * mmToM * scale;
      const ci = idx % 2;
      ctx.fillStyle = COLORS.sheet[ci];
      ctx.fillRect(px, py - ph, pw, ph);
      ctx.strokeStyle = COLORS.sheetBorder[ci];
      ctx.lineWidth = 0.7;
      ctx.strokeRect(px, py - ph, pw, ph);
      if (pw > 28 && ph > 14) {
        ctx.font = '9px "JetBrains Mono", ui-monospace, sans-serif';
        ctx.fillStyle = COLORS.sheetBorder[ci];
        ctx.fillText(`${pl.col_index+1},${pl.row_index+1}`, px + 3, py - ph + 11);
      }
    });
    ctx.restore();
  }

  function fitView(pts: Point[]) {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const W = (wrap?.clientWidth || cv?.width || 600);
    const H = (wrap?.clientHeight || cv?.height || 500);
    const pw = Math.max(...xs) - Math.min(...xs) || 1;
    const ph = Math.max(...ys) - Math.min(...ys) || 1;
    const PAD = 80;
    const newScale = Math.min((W - PAD * 2) / pw, (H - PAD * 2) / ph) * 0.85;
    const newOffX  = PAD - Math.min(...xs) * newScale;
    const newOffY  = PAD - Math.min(...ys) * newScale;
    setScale(newScale);
    setOffset([newOffX, newOffY]);
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const H = cv.height;
    const [wx, wy] = s2w(sx, sy, H);
    setMouse([sx, sy]);

    if (dragIdx >= 0 && downRef.current && !downRef.current.moved) {
      if (Math.hypot(sx - downRef.current.x, sy - downRef.current.y) < 4) return; // ще клік, не перетягування
      downRef.current.moved = true;
    }
    if (dragIdx >= 0) {
      // Перетягуємо вершину: крок 1 см, із Shift — 1 мм. Зберігаємо при відпусканні кнопки.
      const step = e.shiftKey ? 0.001 : 0.01;
      const snap = (v: number) => Math.round(v / step) * step;
      const next = [...points];
      next[dragIdx] = [Math.max(0, snap(wx)), Math.max(0, snap(wy))]; // в мінус по осях не можна
      setPoints(next);
      return;
    }

    // Підсвічування вершини під курсором (замкнений контур або режим редагування)
    if ((closed || mode === 'move') && points.length > 0 && !readOnly) {
      let found = -1;
      const R = 12; // збільшена зона наведення
      points.forEach((p, i) => {
        const [px, py] = w2s(p[0], p[1], H);
        if ((sx-px)**2 + (sy-py)**2 < R*R) found = i;
      });
      setHoverIdx(found);
      setHoverEdge(found >= 0 || !closed ? -1 : edgeAt(sx, sy, H));
    } else if (hoverIdx !== -1) {
      setHoverIdx(-1);
    }
  };

  // Сторона під курсором (відстань до відрізка < 7 px)
  function edgeAt(sx: number, sy: number, H: number): number {
    let best = -1, bestD = 49;
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = w2s(points[i][0], points[i][1], H);
      const [bx, by] = w2s(points[(i + 1) % points.length][0], points[(i + 1) % points.length][1], H);
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / L2));
      const d = (sx - ax - t * (bx - ax)) ** 2 + (sy - ay - t * (by - ay)) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function applyPrompt() {
    if (!prompt) return;
    const v = parseFloat(prompt.value.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    const next = prompt.kind === 'side' ? setSideLength(points, prompt.idx, v) : (v < 360 ? setVertexAngle(points, prompt.idx, v) : points);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const rounded = next.map(([x, y]) => [r(x), r(y)] as Point);
    setPoints(rounded);
    setPrompt(null);
    notifyChange(rounded);
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const H = cv.height;
    const [wx, wy] = s2w(sx, sy, H);

    if (e.button === 2) {
      e.preventDefault();
      if (!closed && points.length >= 3) { setClosed(true); notifyChange(points); }
      return;
    }
    // Замкнений контур: ЛКМ на вершині — захопити і тягнути (як у КП)
    if (closed || mode === 'move') {
      let found = -1;
      let bestDist = Infinity;
      points.forEach((p, i) => {
        const [px, py] = w2s(p[0], p[1], H);
        const d = (sx-px)**2 + (sy-py)**2;
        if (d < 196 && d < bestDist) { found = i; bestDist = d; }
      });
      setPrompt(null);
      if (found >= 0) {
        downRef.current = { x: sx, y: sy, moved: false };
        setDragIdx(found);
        return;
      }
      const ei = closed && !readOnly ? edgeAt(sx, sy, H) : -1;
      if (ei >= 0) {
        const a = points[ei], b = points[(ei + 1) % points.length];
        setPrompt({ kind: 'side', idx: ei, x: sx, y: sy, value: Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3) });
      }
      return;
    }
    if (mode === 'draw') {
      if (points.length >= 3) {
        const [fx, fy] = w2s(points[0][0], points[0][1], H);
        if ((sx-fx)**2 + (sy-fy)**2 < 100) {
          setClosed(true); notifyChange(points); return;
        }
      }
      const next = [...points, [Math.max(0, wx), Math.max(0, wy)] as Point];
      setPoints(next);
    } else {
      // Режим редагування — хапаємо найближчу точку (зона 14px)
      let found = -1;
      let bestDist = Infinity;
      points.forEach((p, i) => {
        const [px, py] = w2s(p[0], p[1], H);
        const d = (sx-px)**2 + (sy-py)**2;
        if (d < 196 && d < bestDist) { found = i; bestDist = d; }
      });
      setDragIdx(found);
    }
  };

  const onMouseUp = () => {
    if (dragIdx >= 0 && downRef.current && !downRef.current.moved) {
      // Клік по вершині без перетягування — ввести кут
      const ang = interiorAngles(points)[dragIdx];
      if (ang) setPrompt({ kind: 'angle', idx: dragIdx, x: downRef.current.x, y: downRef.current.y, value: (Math.round(ang.deg * 10) / 10).toString() });
      downRef.current = null;
      setDragIdx(-1);
      return;
    }
    downRef.current = null;
    if (dragIdx >= 0) {
      const orig = slope?.polygon_points?.[dragIdx];
      const p = points[dragIdx];
      // не зберігаємо, якщо вершину лише клацнули без зсуву
      if (!orig || Math.round(p[0] * 1000) !== orig[0] || Math.round(p[1] * 1000) !== orig[1]) notifyChange(points);
    }
    setDragIdx(-1);
  };

  // Колесо миші — масштабування
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(10, Math.min(2000, scale * factor));
    // Zoom до точки під курсором
    const newOffX = sx - (sx - offset[0]) * (newScale / scale);
    const newOffY = sy - (sy - offset[1]) * (newScale / scale);
    setScale(newScale);
    setOffset([newOffX, newOffY]);
  };

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !closed && points.length >= 3) {
      setClosed(true); notifyChange(points);
    }
    if (e.key === 'Escape') {
      if (prompt) { setPrompt(null); return; }
      if (!closed) { setPoints([]); setShowLayout(false); }   // готовий контур Esc не стирає
    }
    if (e.key === 'z' && e.ctrlKey) {
      e.preventDefault();
      if (closed) setClosed(false);
      else setPoints(p => p.slice(0, -1));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, closed, prompt]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  function notifyChange(pts: Point[]) {
    onPolygonChange(pts.map(([x,y]) => [Math.round(x*1000), Math.round(y*1000)] as Point));
  }

  function openTemplate(idx: number) {
    setTplIdx(idx);
    const defaults: Record<string,string> = {};
    TEMPLATES[idx].params.forEach(p => { defaults[p.key] = String(p.default); });
    setTplValues(defaults);
    setTplModal(true);
  }

  function applyTemplate() {
    const tpl = TEMPLATES[tplIdx];
    const pts = buildTemplate(tpl, tplValues);
    setActiveTemplate(tplIdx);
    setPoints(pts);
    setClosed(true);
    setShowLayout(false);
    setTplModal(false);
    notifyChange(pts);
    setTimeout(() => fitView(pts), 100);
  }

  function clearAll() {
    setPoints([]); setClosed(false); setShowLayout(false); setActiveTemplate(null);
    onPolygonChange([]);
  }

  // Поточні координати для статус-рядка
  const cv0 = canvasRef.current;
  const H0  = cv0?.height || 500;
  const [curWx, curWy] = s2w(mouse[0], mouse[1], H0);
  const coordsText = `X: ${curWx.toFixed(3)} м  Y: ${curWy.toFixed(3)} м`;

  return (
    <div className={`editor-wrap${bare ? ' editor-bare' : ''}`}>
      {/* Sidebar */}
      {!bare && <div className="editor-sidebar">
        <div style={{padding:'8px 12px 4px',fontSize:'.65rem',fontWeight:600,color:'var(--clr-text-3)',textTransform:'uppercase',letterSpacing:'.5px'}}>
          Шаблони
        </div>
        <div className="tpl-grid">
          {TEMPLATES.map((tpl, i) => (
            <button
              key={i}
              className={`tpl-tile${activeTemplate === i ? ' active' : ''}`}
              onClick={() => openTemplate(i)}
              title={tpl.name}
            >
              <svg viewBox="0 0 42 30" style={{color:'var(--clr-brand)'}}>
                <polygon points={templateIconPoints(tpl, 42, 30)} fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span>{tpl.name}</span>
            </button>
          ))}
        </div>

        <div style={{padding:'8px 12px 4px',marginTop:'8px',fontSize:'.65rem',fontWeight:600,color:'var(--clr-text-3)',textTransform:'uppercase',letterSpacing:'.5px'}}>
          Режим
        </div>
        <div style={{padding:'0 8px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <button className={`btn btn-sm${mode==='draw'?' btn-primary':' btn-secondary'}`}
            style={{width:'100%',justifyContent:'flex-start'}} onClick={() => setMode('draw')}>
            Малювати
          </button>
          <button className={`btn btn-sm${mode==='move'?' btn-primary':' btn-secondary'}`}
            style={{width:'100%',justifyContent:'flex-start'}} onClick={() => setMode('move')}>
            Редагувати точки
          </button>
          <button className="btn btn-sm btn-danger"
            style={{width:'100%',justifyContent:'flex-start'}} onClick={clearAll}>
            Очистити
          </button>
        </div>

        <div style={{padding:'8px 12px',marginTop:'8px',fontSize:'.7rem',color:'var(--clr-text-3)',lineHeight:1.6,borderTop:'1px solid var(--clr-border)'}}>
          <b style={{color:'var(--clr-text-2)'}}>Управління:</b><br/>
          ЛКМ — точка<br/>
          ПКМ / Enter — замкнути<br/>
          Колесо — масштаб<br/>
          Ctrl+Z — відмінити<br/>
          Esc — скинути
        </div>
      </div>}

      {/* Canvas */}
      <div className="editor-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{display:'block',width:'100%',height:'100%',cursor:dragIdx>=0?'grabbing':(hoverIdx>=0?'grab':(hoverEdge>=0?'pointer':(mode==='draw'&&!closed?'crosshair':'default')))}}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onContextMenu={e => e.preventDefault()}
        />
        <div className="editor-toolbar">
          <button className="btn btn-sm btn-secondary btn-icon" title="Відмінити (Ctrl+Z)"
            onClick={() => closed ? setClosed(false) : setPoints(p => p.slice(0,-1))}>↩</button>
          <button className="btn btn-sm btn-secondary btn-icon" title="Збільшити (+)"
            onClick={() => setScale(s => s * 1.25)}>+</button>
          <button className="btn btn-sm btn-secondary btn-icon" title="Зменшити (-)"
            onClick={() => setScale(s => s / 1.25)}>−</button>
          <button className="btn btn-sm btn-secondary btn-icon" title="По розміру"
            onClick={() => fitView(points)}>⛶</button>
          {calcResult && !calcResult.errors?.length && (
            <button className={`btn btn-sm ${showLayout?'btn-primary':'btn-secondary'}`}
              onClick={() => setShowLayout(v => !v)}>
              {showLayout ? '👁 Сховати' : '📐 Розкладка'}
            </button>
          )}
          <span style={{padding:'4px 8px',fontSize:'.75rem',color:'var(--clr-text-2)',background:'var(--clr-surface)',border:'1px solid var(--clr-border)',borderRadius:'6px'}}>
            {closed ? `✓ Замкнуто · ${points.length} точок` : points.length > 0 ? `${points.length} точок…` : 'Оберіть шаблон або малюйте'}
          </span>
        </div>
        <div className="editor-coords">{coordsText}</div>
        {prompt && (
          <div className="kp-prompt" style={{ left: Math.max(8, Math.min(prompt.x + 12, (wrapRef.current?.clientWidth || 600) - 230)), top: Math.max(8, Math.min(prompt.y + 12, (wrapRef.current?.clientHeight || 400) - 130)) }}
            onMouseDown={e => e.stopPropagation()}>
            <label>
              <span>{prompt.kind === 'side' ? `Довжина сторони ${sideLetter(prompt.idx)}, м` : 'Внутрішній кут у вершині, °'}</span>
              <input ref={promptInput} className="form-control" inputMode="decimal" value={prompt.value}
                onChange={e => setPrompt(p => p && ({ ...p, value: e.target.value }))}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyPrompt(); if (e.key === 'Escape') setPrompt(null); }} />
            </label>
            <div className="kp-prompt-btns">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPrompt(null)}>Скасувати</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={applyPrompt}>OK</button>
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      {!bare && <div className="editor-panel">
        {closed && points.length >= 3 && (
          <div>
            <div style={{fontSize:'.72rem',fontWeight:600,color:'var(--clr-text-3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'8px'}}>
              Геометрія ската
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'.8rem'}}>
                <span style={{color:'var(--clr-text-3)'}}>Точок:</span>
                <span style={{fontWeight:600}}>{points.length}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'.8rem'}}>
                <span style={{color:'var(--clr-text-3)'}}>Ширина:</span>
                <span style={{fontWeight:600,fontFamily:'var(--font-mono)'}}>
                  {((Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))*gridScale)).toFixed(3)} м
                </span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'.8rem'}}>
                <span style={{color:'var(--clr-text-3)'}}>Висота:</span>
                <span style={{fontWeight:600,fontFamily:'var(--font-mono)'}}>
                  {((Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1]))*gridScale)).toFixed(3)} м
                </span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'.8rem'}}>
                <span style={{color:'var(--clr-text-3)'}}>Точки:</span>
                <span style={{fontWeight:500,fontFamily:'var(--font-mono)',fontSize:'.7rem'}}>
                  {points.map(p=>`(${p[0].toFixed(2)},${p[1].toFixed(2)})`).join(' ')}
                </span>
              </div>
            </div>
          </div>
        )}

        {calcResult && !calcResult.errors?.length && (
          <div>
            <div style={{fontSize:'.72rem',fontWeight:600,color:'var(--clr-text-3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'8px'}}>
              Результат розрахунку
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
              {[
                ['Листів', calcResult.total_sheets?.toString()],
                ['Площа', `${calcResult.slope_area_m2} м²`],
                ['По ширині', `${calcResult.cols_count} шт`],
                ['По довжині', `${calcResult.rows_count} ряд`],
                ['Довжина', `${calcResult.sheet_length_mm} мм`],
                ['Відходи', `${calcResult.waste_pct}%`],
              ].map(([lbl, val]) => (
                <div key={lbl} style={{background:'var(--clr-brand-pale)',borderRadius:'6px',padding:'6px 8px',textAlign:'center'}}>
                  <div style={{fontSize:'1rem',fontWeight:700,color:'var(--clr-brand)',fontFamily:'var(--font-display)'}}>{val}</div>
                  <div style={{fontSize:'.65rem',color:'var(--clr-text-3)'}}>{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {calcResult?.warnings?.length ? (
          <div>
            <div style={{fontSize:'.72rem',fontWeight:600,color:'var(--clr-text-3)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'6px'}}>
              Попередження
            </div>
            {calcResult.warnings.map((w, i) => (
              <div key={i} className="alert alert-warning" style={{marginBottom:'4px',fontSize:'.75rem',padding:'6px 10px'}}>⚠ {w}</div>
            ))}
          </div>
        ) : null}

        {calcResult?.errors?.length ? (
          <div>
            {calcResult.errors.map((e, i) => (
              <div key={i} className="alert alert-error" style={{fontSize:'.75rem'}}>✗ {e}</div>
            ))}
          </div>
        ) : null}

        {!closed && (
          <div className="alert alert-info" style={{fontSize:'.75rem'}}>
            Оберіть шаблон зліва або намалюйте скат клацаючи мишею. Замкніть контур правою кнопкою або Enter.
          </div>
        )}
      </div>}

      {/* Модальне вікно шаблону */}
      {tplModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000}}>
          <div style={{background:'var(--clr-surface)',color:'var(--clr-text)',border:'1px solid var(--clr-border)',borderRadius:'8px',padding:'24px',width:'360px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.6)'}}>
            <h3 style={{margin:'0 0 4px',fontSize:'1rem'}}>📐 {TEMPLATES[tplIdx].name}</h3>
            <div style={{fontSize:'.8rem',color:'var(--clr-text-3)',marginBottom:'16px'}}>Введіть розміри ската</div>

            <div style={{textAlign:'center',marginBottom:'16px',background:'var(--clr-canvas)',borderRadius:'8px',padding:'12px'}}>
              <svg viewBox="0 0 42 30" width="120" height="86" style={{color:'var(--clr-brand)'}}>
                <polygon points={templateIconPoints(TEMPLATES[tplIdx], 42, 30)} fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>

            {TEMPLATES[tplIdx].params.map(param => (
              <div key={param.key} style={{marginBottom:'12px'}}>
                <label style={{display:'block',fontSize:'.8rem',fontWeight:500,marginBottom:'4px',color:'var(--clr-text-2)'}}>
                  {param.label}
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={tplValues[param.key] ?? String(param.default)}
                  onChange={e => setTplValues(v => ({...v, [param.key]: e.target.value}))}
                  style={{width:'100%',padding:'8px 12px',border:'1px solid var(--clr-border-dark)',background:'var(--abt-black)',color:'var(--clr-text)',borderRadius:'6px',fontSize:'.9rem',boxSizing:'border-box'}}
                />
              </div>
            ))}

            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'8px'}}>
              <button onClick={() => setTplModal(false)}
                style={{padding:'8px 16px',border:'1px solid var(--clr-border-dark)',borderRadius:'6px',cursor:'pointer',background:'var(--clr-surface-2)',color:'var(--clr-text)'}}>
                Скасувати
              </button>
              <button onClick={applyTemplate}
                style={{padding:'8px 16px',background:'var(--clr-brand)',color:'var(--clr-on-brand)',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:700}}>
                Застосувати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
