// ============================================
// ArtBudTrading Roof Calculator
// components/editor/SlopeEditor.tsx
// Повнофункціональний Canvas-редактор скатів
// ============================================

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Point, Slope, SheetPlacement, CalcResult } from '../../api/client';

interface Props {
  slope: Slope | null;
  calcResult?: CalcResult | null;
  onPolygonChange: (points: Point[]) => void;
  readOnly?: boolean;
  gridScale?: number;
}

const COLORS = {
  grid:       '#E2E8F0',
  polygon:    '#1B5E2E',
  polygonFill:'rgba(27,94,46,0.08)',
  point:      '#1B5E2E',
  pointFirst: '#C62828',
  sheet:      ['rgba(21,101,192,0.18)','rgba(27,94,46,0.18)'],
  sheetBorder:['#1565C0','#1B5E2E'],
  dim:        '#1565C0',
};

interface TplParam { key: string; label: string; default: number; }
interface Template {
  name: string;
  icon: string;
  params: TplParam[];
  build: (p: Record<string, number>) => Point[];
}

const TEMPLATES: Template[] = [
  {
    name: 'Прямокутник', icon: 'rect',
    params: [
      { key:'a', label:'a — ширина, м',  default: 6 },
      { key:'h', label:'h — висота, м',  default: 4 },
    ],
    build: ({a,h}) => [[0,0],[a,0],[a,h],[0,h]],
  },
  {
    name: 'Трапеція', icon: 'trap',
    params: [
      { key:'a',  label:'a — нижня основа, м', default: 6 },
      { key:'c',  label:'c — верхня основа, м', default: 4 },
      { key:'h',  label:'h — висота, м',        default: 4 },
      { key:'a1', label:'a1 — зміщення, м',     default: 1 },
    ],
    build: ({a,c,h,a1}) => [[0,0],[a,0],[a1+c,h],[a1,h]],
  },
  {
    name: 'Прав. трикутник', icon: 'rtri',
    params: [
      { key:'a', label:'a — основа, м', default: 6 },
      { key:'h', label:'h — висота, м', default: 4 },
    ],
    build: ({a,h}) => [[0,0],[a,0],[0,h]],
  },
  {
    name: 'Рівнобедр. трикутник', icon: 'itri',
    params: [
      { key:'a', label:'a — основа, м', default: 6 },
      { key:'h', label:'h — висота, м', default: 4 },
    ],
    build: ({a,h}) => [[0,0],[a,0],[a/2,h]],
  },
  {
    name: 'Паралелограм', icon: 'para',
    params: [
      { key:'a',  label:'a — основа, м',    default: 6 },
      { key:'h',  label:'h — висота, м',    default: 4 },
      { key:'a1', label:'a1 — зміщення, м', default: 1 },
    ],
    build: ({a,h,a1}) => [[0,0],[a,0],[a+a1,h],[a1,h]],
  },
  {
    name: 'Пятикутник', icon: 'pent',
    params: [
      { key:'a',  label:'a — ширина, м',        default: 6 },
      { key:'h',  label:'h — повна висота, м',  default: 4 },
      { key:'h1', label:'h1 — висота зрізу, м', default: 1 },
    ],
    build: ({a,h,h1}) => [[0,0],[a,0],[a,h-h1],[a/2,h],[0,h-h1]],
  },
  {
    name: 'Г-подібний', icon: 'lshp',
    params: [
      { key:'a', label:'a — повна ширина, м', default: 6 },
      { key:'b', label:'b — повна висота, м', default: 4 },
      { key:'c', label:'c — виріз ширина, м', default: 2 },
      { key:'d', label:'d — виріз висота, м', default: 2 },
    ],
    build: ({a,b,c,d}) => [[0,0],[a,0],[a,d],[a-c,d],[a-c,b],[0,b]],
  },
  {
    name: 'Ступінчатий', icon: 'step',
    params: [
      { key:'a', label:'a — повна ширина, м',   default: 6 },
      { key:'b', label:'b — повна висота, м',   default: 4 },
      { key:'c', label:'c — ступінь ширина, м', default: 3 },
      { key:'d', label:'d — ступінь висота, м', default: 2 },
    ],
    build: ({a,b,c,d}) => [[0,0],[c,0],[c,d],[a,d],[a,b],[0,b]],
  },
];

const ICON_SVG: Record<string, string> = {
  rect: '<rect x="3" y="4" width="36" height="22" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  trap: '<polygon points="6,24 36,24 31,4 11,4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  rtri: '<polygon points="4,24 36,24 4,4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  itri: '<polygon points="4,24 36,24 20,4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  para: '<polygon points="10,24 38,24 30,4 2,4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  pent: '<polygon points="3,24 37,24 37,12 20,4 3,12" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  lshp: '<polyline points="3,24 3,4 22,4 22,14 37,14 37,24 3,24" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  step: '<polyline points="3,24 3,4 18,4 18,13 37,13 37,24 3,24" fill="none" stroke="currentColor" stroke-width="1.5"/>',
};

export default function SlopeEditor({ slope, calcResult, onPolygonChange, readOnly, gridScale = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);

  const [points, setPoints]         = useState<Point[]>([]);
  const [closed, setClosed]         = useState(false);
  const [mode, setMode]             = useState<'draw'|'move'>('draw');
  const [mouse, setMouse]           = useState<Point>([0, 0]);
  const [scale, setScale]           = useState(60);
  const [offset, setOffset]         = useState<Point>([40, 40]);
  const [dragIdx, setDragIdx]       = useState(-1);
  const [showLayout, setShowLayout] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<number | null>(null);

  // Модальне вікно шаблону
  const [tplModal, setTplModal]     = useState(false);
  const [tplIdx, setTplIdx]         = useState(0);
  const [tplValues, setTplValues]   = useState<Record<string,string>>({});

  useEffect(() => {
    if (slope?.polygon_points?.length) {
      const pts = slope.polygon_points.map(([x,y]): Point => [x/1000, y/1000]);
      setPoints(pts);
      setClosed(true);
      setShowLayout(!!slope.calc_result);
      fitView(pts);
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
    drawPoints(ctx, H);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, closed, mouse, scale, offset, mode, showLayout, calcResult]);

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
    return [snapGrid(wx), snapGrid(wy)];
  };

  const snapGrid = (v: number) => Math.round(v / gridScale) * gridScale;

  function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const step = scale * gridScale;
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    const startX = ((offset[0] % step) + step) % step;
    for (let x = startX; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    const startY = ((H - offset[1]) % step + step) % step;
    for (let y = startY % step; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = '#A0AEC0'; ctx.font = '10px Inter, sans-serif';
    const gs = gridScale;
    let i = 0;
    for (let x = offset[0]; x < W; x += step) {
      ctx.fillText((i * gs).toFixed(gs < 1 ? 1 : 0) + 'м', x + 2, H - offset[1] + 13);
      i++;
    }
    i = 0;
    for (let y = H - offset[1]; y > 0; y -= step) {
      if (i > 0) ctx.fillText((i * gs).toFixed(gs < 1 ? 1 : 0), 2, y - 2);
      i++;
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
    if (closed) {
      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = COLORS.dim;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const len = Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2) * gridScale;
        const [mx, my] = w2s((a[0]+b[0])/2, (a[1]+b[1])/2, H);
        ctx.fillText(len.toFixed(2) + 'м', mx + 4, my - 4);
      }
    }
    ctx.restore();
  }

  function drawPoints(ctx: CanvasRenderingContext2D, H: number) {
    points.forEach((p, i) => {
      const [sx, sy] = w2s(p[0], p[1], H);
      ctx.beginPath();
      ctx.arc(sx, sy, i === 0 && !closed ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle   = i === 0 ? COLORS.pointFirst : COLORS.point;
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
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
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = COLORS.sheetBorder[ci];
        ctx.fillText(`${pl.col_index+1},${pl.row_index+1}`, px + 3, py - ph + 11);
      }
    });
    ctx.restore();
  }

  function fitView(pts: Point[]) {
    const cv = canvasRef.current;
    if (!cv || !pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const W = cv.width || 600, H = cv.height || 500;
    const pw = Math.max(...xs) - Math.min(...xs) || 1;
    const ph = Math.max(...ys) - Math.min(...ys) || 1;
    const newScale = Math.min((W - 100) / pw, (H - 100) / ph) * 0.8;
    const newOffX  = (W - pw * newScale) / 2 - Math.min(...xs) * newScale;
    const newOffY  = (H - ph * newScale) / 2 - Math.min(...ys) * newScale;
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
    if (mode === 'move' && dragIdx >= 0) {
      const next = [...points];
      next[dragIdx] = [wx, wy];
      setPoints(next);
      notifyChange(next);
    }
  };

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
    if (mode === 'draw') {
      if (closed) { setClosed(false); setPoints([]); setShowLayout(false); return; }
      if (points.length >= 3) {
        const [fx, fy] = w2s(points[0][0], points[0][1], H);
        if ((sx-fx)**2 + (sy-fy)**2 < 100) {
          setClosed(true); notifyChange(points); return;
        }
      }
      const next = [...points, [wx, wy] as Point];
      setPoints(next);
    } else {
      let found = -1;
      points.forEach((p, i) => {
        const [px, py] = w2s(p[0], p[1], H);
        if ((sx-px)**2 + (sy-py)**2 < 64) found = i;
      });
      setDragIdx(found);
    }
  };

  const onMouseUp = () => setDragIdx(-1);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !closed && points.length >= 3) {
      setClosed(true); notifyChange(points);
    }
    if (e.key === 'Escape') { setPoints([]); setClosed(false); setShowLayout(false); }
    if (e.key === 'z' && e.ctrlKey) {
      e.preventDefault();
      if (closed) setClosed(false);
      else setPoints(p => p.slice(0, -1));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, closed]);

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
    const nums: Record<string,number> = {};
    tpl.params.forEach(p => { nums[p.key] = parseFloat(tplValues[p.key]) || p.default; });
    const pts = tpl.build(nums) as Point[];
    setActiveTemplate(tplIdx);
    setPoints(pts);
    setClosed(true);
    setShowLayout(false);
    setTplModal(false);
    notifyChange(pts);
    setTimeout(() => fitView(pts), 50);
  }

  function clearAll() {
    setPoints([]); setClosed(false); setShowLayout(false); setActiveTemplate(null);
    onPolygonChange([]);
  }

  const coordsText = (() => {
    const cv = canvasRef.current;
    if (!cv) return '';
    const H = cv.height || 500;
    const [wx, wy] = s2w(mouse[0], mouse[1], H);
    return `X: ${(wx*gridScale).toFixed(2)}м  Y: ${(wy*gridScale).toFixed(2)}м`;
  })();

  return (
    <div className="editor-wrap">
      {/* Sidebar */}
      <div className="editor-sidebar">
        <div style={{padding:'8px 12px 4px',fontSize:'.65rem',fontWeight:600,color:'#8896A5',textTransform:'uppercase',letterSpacing:'.5px'}}>
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
                <g dangerouslySetInnerHTML={{__html: ICON_SVG[tpl.icon]}} />
              </svg>
              <span>{tpl.name}</span>
            </button>
          ))}
        </div>

        <div style={{padding:'8px 12px 4px',marginTop:'8px',fontSize:'.65rem',fontWeight:600,color:'#8896A5',textTransform:'uppercase',letterSpacing:'.5px'}}>
          Режим
        </div>
        <div style={{padding:'0 8px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <button className={`btn btn-sm${mode==='draw'?' btn-primary':' btn-secondary'}`}
            style={{width:'100%',justifyContent:'flex-start'}} onClick={() => setMode('draw')}>
            ✏ Малювати
          </button>
          <button className={`btn btn-sm${mode==='move'?' btn-primary':' btn-secondary'}`}
            style={{width:'100%',justifyContent:'flex-start'}} onClick={() => setMode('move')}>
            ↕ Редагувати
          </button>
          <button className="btn btn-sm btn-danger"
            style={{width:'100%',justifyContent:'flex-start'}} onClick={clearAll}>
            🗑 Очистити
          </button>
        </div>

        <div style={{padding:'8px 12px',marginTop:'8px',fontSize:'.7rem',color:'#8896A5',lineHeight:1.6,borderTop:'1px solid var(--clr-border)'}}>
          <b style={{color:'var(--clr-text-2)'}}>Управління:</b><br/>
          ЛКМ — точка<br/>
          ПКМ / Enter — замкнути<br/>
          Ctrl+Z — відмінити<br/>
          Esc — скинути
        </div>
      </div>

      {/* Canvas */}
      <div className="editor-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{display:'block',width:'100%',height:'100%',cursor:mode==='draw'?'crosshair':'default'}}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onContextMenu={e => e.preventDefault()}
        />
        <div className="editor-toolbar">
          <button className="btn btn-sm btn-secondary btn-icon" title="Відмінити (Ctrl+Z)"
            onClick={() => closed ? setClosed(false) : setPoints(p => p.slice(0,-1))}>↩</button>
          <button className="btn btn-sm btn-secondary btn-icon" title="Збільшити"
            onClick={() => setScale(s => s * 1.25)}>+</button>
          <button className="btn btn-sm btn-secondary btn-icon" title="Зменшити"
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
      </div>

      {/* Right panel */}
      <div className="editor-panel">
        {closed && points.length >= 3 && (
          <div>
            <div style={{fontSize:'.72rem',fontWeight:600,color:'#8896A5',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'8px'}}>
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
                  {((Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])))*gridScale).toFixed(2)} м
                </span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'.8rem'}}>
                <span style={{color:'var(--clr-text-3)'}}>Висота:</span>
                <span style={{fontWeight:600,fontFamily:'var(--font-mono)'}}>
                  {((Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])))*gridScale).toFixed(2)} м
                </span>
              </div>
            </div>
          </div>
        )}

        {calcResult && !calcResult.errors?.length && (
          <div>
            <div style={{fontSize:'.72rem',fontWeight:600,color:'#8896A5',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'8px'}}>
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
            <div style={{fontSize:'.72rem',fontWeight:600,color:'#8896A5',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:'6px'}}>
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
      </div>

      {/* Модальне вікно шаблону */}
      {tplModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000}}>
          <div style={{background:'#fff',borderRadius:'12px',padding:'24px',width:'360px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <h3 style={{margin:'0 0 4px',fontSize:'1rem'}}>📐 {TEMPLATES[tplIdx].name}</h3>
            <div style={{fontSize:'.8rem',color:'#6b7280',marginBottom:'16px'}}>Введіть розміри ската</div>

            <div style={{textAlign:'center',marginBottom:'16px',background:'#f8fafc',borderRadius:'8px',padding:'12px'}}>
              <svg viewBox="0 0 42 30" width="120" height="86" style={{color:'#1B5E2E'}}>
                <g dangerouslySetInnerHTML={{__html: ICON_SVG[TEMPLATES[tplIdx].icon]}} />
              </svg>
            </div>

            {TEMPLATES[tplIdx].params.map(param => (
              <div key={param.key} style={{marginBottom:'12px'}}>
                <label style={{display:'block',fontSize:'.8rem',fontWeight:500,marginBottom:'4px',color:'#374151'}}>
                  {param.label}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={tplValues[param.key] ?? String(param.default)}
                  onChange={e => setTplValues(v => ({...v, [param.key]: e.target.value}))}
                  style={{width:'100%',padding:'8px 12px',border:'1px solid #d1d5db',borderRadius:'6px',fontSize:'.9rem',boxSizing:'border-box'}}
                />
              </div>
            ))}

            <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'8px'}}>
              <button onClick={() => setTplModal(false)}
                style={{padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:'6px',cursor:'pointer',background:'#fff'}}>
                Скасувати
              </button>
              <button onClick={applyTemplate}
                style={{padding:'8px 16px',background:'#2563eb',color:'#fff',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:600}}>
                Застосувати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
