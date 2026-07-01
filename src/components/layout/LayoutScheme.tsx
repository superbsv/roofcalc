// ============================================
// ArtBudTrading Roof Calculator
// components/layout/LayoutScheme.tsx
// ============================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Point as ApiPoint } from '../../api/client';

interface SheetPlacement {
  sheet_number: number;
  col_index: number;
  row_index: number;
  x: number;
  y: number;
  full_width: number;
  useful_width: number;
  length: number;
  intersect_area_m2?: number;
  full_area_m2?: number;
  waste_area_m2?: number;
  manual_length?: number;
  offset_x?: number;
  offset_y?: number;
  deleted?: boolean;
}

type Point = ApiPoint;

interface CalcResult {
  profile_name: string;
  slope_area_m2: number;
  slope_width_mm: number;
  slope_height_mm: number;
  cols_count: number;
  rows_count: number;
  total_sheets: number;
  sheet_length_mm: number;
  sheet_full_width?: number;
  sheet_useful_width?: number;
  placements: SheetPlacement[];
  warnings: string[];
}

interface Props {
  calcResult: CalcResult;
  polygonPoints: Point[];
  slopeName: string;
  onUpdate?: (placements: SheetPlacement[]) => void;
}

const COLORS = {
  full:     '#3b82f6',
  cut:      '#f59e0b',
  waste:    '#ef4444',
  selected: '#7c3aed',
  polygon:  '#dc2626',
  split:    '#0891b2',
  grid:     '#e5e7eb',
  text:     '#1e40af',
  bg:       '#f8fafc',
};

const STEPS = [
  { label: '0.1м',   mm: 100 },
  { label: '0.01м',  mm: 10  },
  { label: '0.001м', mm: 1   },
];

const PADDING = 80;
const SVG_W   = 900;
const SVG_H   = 600;

function getPolygonHeightAtX(x: number, polygon: Point[]): number {
  if (!polygon.length) return 0;
  const ys: number[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    if (x1 === x2) {
      if (Math.abs(x1 - x) < 2) { ys.push(y1, y2); }
      continue;
    }
    const xMin = Math.min(x1, x2), xMax = Math.max(x1, x2);
    if (x >= xMin && x <= xMax) {
      const t = (x - x1) / (x2 - x1);
      ys.push(y1 + t * (y2 - y1));
    }
  }
  if (ys.length < 2) return 0;
  return Math.max(...ys) - Math.min(...ys);
}

function generateLayout(
  layoutOffset: number,
  slopeWidth: number,
  slopeHeight: number,
  polygon: Point[],
  usefulWidth: number,
  fullWidth: number,
  baseLength: number,
  eaveRidgeExtra: number,
): SheetPlacement[] {
  const placements: SheetPlacement[] = [];
  let sheetNum = 1;
  const startCol = Math.floor((-layoutOffset / usefulWidth) - 1) + 1;

  for (let col = startCol; ; col++) {
    const x = layoutOffset + col * usefulWidth;
    if (x >= slopeWidth) break;
    if (x + usefulWidth <= 0) continue;

    const visLeft  = Math.max(0, x);
    const visRight = Math.min(slopeWidth, x + usefulWidth);
    const visMid   = (visLeft + visRight) / 2;

    const hL = getPolygonHeightAtX(visLeft, polygon);
    const hM = getPolygonHeightAtX(visMid, polygon);
    const hR = getPolygonHeightAtX(visRight, polygon);
    const colH = Math.max(hL, hM, hR);

    if (colH <= 0) continue;
    const sheetLength = Math.max(1, Math.round(colH + eaveRidgeExtra));

    placements.push({
      sheet_number: sheetNum++,
      col_index:    col,
      row_index:    0,
      x,
      y:            0,
      full_width:   fullWidth,
      useful_width: usefulWidth,
      length:       sheetLength,
    });
  }

  return placements;
}

export default function LayoutScheme({ calcResult, polygonPoints, slopeName, onUpdate }: Props) {
  const W = calcResult.slope_width_mm;
  const H = calcResult.slope_height_mm;
  const usefulWidth    = calcResult.placements[0]?.useful_width ?? 1100;
  const fullWidth      = calcResult.placements[0]?.full_width  ?? 1185;
  const baseLength     = calcResult.sheet_length_mm;
  const maxPolygonHeight = polygonPoints.length >= 3
    ? Math.max(...polygonPoints.map((_, i) => getPolygonHeightAtX(polygonPoints[i][0], polygonPoints)))
    : H;
  const eaveRidgeExtra = Math.max(0, baseLength - maxPolygonHeight);

  const [placements, setPlacements] = useState<SheetPlacement[]>(() => calcResult.placements.map(p => ({ ...p })));
  const [rowSplitOffset, setRowSplitOffset] = useState(0); // зсув лінії розподілу рядів мм
  const layoutOffsetRef = useRef(0);
  const [layoutOffset, setLayoutOffset] = useState(0);
  const [selected, setSelected]         = useState<Set<number>>(new Set());
  const [zoom, setZoom]                 = useState(1);

  const [rubberBand, setRubberBand] = useState<{x1:number;y1:number;x2:number;y2:number}|null>(null);
  const svgRef     = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart  = useRef<{x:number;y:number}|null>(null);

  const [panelPos, setPanelPos] = useState({ x: 20, y: 120 });
  const panelDrag = useRef<{startX:number;startY:number;startPX:number;startPY:number}|null>(null);

  useEffect(() => {
    setPlacements(calcResult.placements.map(p => ({ ...p })));
    layoutOffsetRef.current = 0;
    setLayoutOffset(0);
    setRowSplitOffset(0);
    setSelected(new Set());
  }, [calcResult]);

  const scale = Math.min((SVG_W - PADDING*2) / W, (SVG_H - PADDING*2) / H) * zoom;
  const tx = (x: number) => PADDING + x * scale;
  const ty = (y: number) => PADDING + (H - y) * scale;

  const polyPath = polygonPoints.length >= 3
    ? polygonPoints.map((p, i) => `${i===0?'M':'L'} ${tx(p[0])} ${ty(p[1])}`).join(' ') + ' Z'
    : `M ${tx(0)} ${ty(0)} L ${tx(W)} ${ty(0)} L ${tx(W)} ${ty(H)} L ${tx(0)} ${ty(H)} Z`;

  // Оригінальна Y-позиція розділу (з першого листа row_index=1)
  const originalSplitY = calcResult.placements.find(p => p.row_index === 1)?.y ?? 0;
  const hasMultipleRows = calcResult.rows_count > 1 && originalSplitY > 0;
  const effectiveSplitY = originalSplitY + rowSplitOffset;

  // Обчислюємо відображувані довжини з урахуванням rowSplitOffset
  const getDisplayLength = (p: SheetPlacement): number => {
    const base = p.manual_length ?? p.length;
    if (!hasMultipleRows || rowSplitOffset === 0) return base;
    if (p.row_index === 0) return Math.max(1, base + rowSplitOffset);
    if (p.row_index === 1) return Math.max(1, base - rowSplitOffset);
    return base;
  };

  const getDisplayY = (p: SheetPlacement): number => {
    if (!hasMultipleRows || rowSplitOffset === 0) return p.y + (p.offset_y ?? 0);
    if (p.row_index >= 1) return p.y + rowSplitOffset + (p.offset_y ?? 0);
    return p.y + (p.offset_y ?? 0);
  };

  const sheetColor = (p: SheetPlacement, isSel: boolean) => {
    if (isSel) return COLORS.selected;
    if (p.intersect_area_m2 === undefined || p.full_area_m2 === undefined) return COLORS.full;
    if ((p.waste_area_m2??0)/(p.full_area_m2??1)*100 > 50) return COLORS.waste;
    if (p.intersect_area_m2 < p.full_area_m2 * 0.95) return COLORS.cut;
    return COLORS.full;
  };

  const visiblePlacements = placements.filter(p => !p.deleted);
  const hasSelection = selected.size > 0;

  // Зсув розкладки
  const shiftLayout = useCallback((deltaMm: number) => {
    layoutOffsetRef.current += deltaMm;
    const newOffset = layoutOffsetRef.current;
    setLayoutOffset(newOffset);
    // Зсуваємо x всіх листів без перегенерації щоб зберегти multi-row
    setPlacements(prev => {
      const updated = prev.map(p => ({ ...p, offset_x: (p.offset_x ?? 0) + deltaMm }));
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
    setSelected(new Set());
  }, [onUpdate]);
  const shiftVertical = useCallback((deltaMm: number) => {
    setPlacements(prev => {
      const updated = prev.map(p => ({ ...p, offset_y: (p.offset_y ?? 0) + deltaMm }));
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
  }, [onUpdate]);
  // Зсув лінії розподілу рядів
  const shiftSplit = useCallback((deltaMm: number) => {
    setRowSplitOffset(prev => prev + deltaMm);
  }, []);

  const updateSelected = useCallback((fn: (p: SheetPlacement) => SheetPlacement) => {
    setPlacements(prev => {
      const updated = prev.map(p => selected.has(p.sheet_number) ? fn(p) : p);
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
  }, [selected, onUpdate]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const moveLeft  = (mm: number) => updateSelected(p => ({ ...p, offset_x: (p.offset_x??0) - mm }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const moveRight = (mm: number) => updateSelected(p => ({ ...p, offset_x: (p.offset_x??0) + mm }));
  const moveUp    = (mm: number) => updateSelected(p => ({ ...p, offset_y: (p.offset_y??0) + mm }));
  const moveDown  = (mm: number) => updateSelected(p => ({ ...p, offset_y: (p.offset_y??0) - mm }));
  const lenPlus   = (mm: number) => updateSelected(p => ({ ...p, manual_length: (p.manual_length??p.length) + mm }));
  const lenMinus  = (mm: number) => updateSelected(p => ({ ...p, manual_length: Math.max(1, (p.manual_length??p.length) - mm) }));

  const deleteSelected = () => {
    setPlacements(prev => {
      const updated = prev.map(p => selected.has(p.sheet_number) ? { ...p, deleted: true } : p);
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
    setSelected(new Set());
  };

  const resetSelected = () => updateSelected(p => ({ ...p, manual_length: undefined, offset_x: undefined, offset_y: undefined }));

  const resetAll = () => {
    layoutOffsetRef.current = 0;
    setLayoutOffset(0);
    setRowSplitOffset(0);
    const orig = calcResult.placements.map(p => ({ ...p }));
    setPlacements(orig);
    onUpdate?.(orig);
    setSelected(new Set());
  };

  const getSvgPoint = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const f = SVG_W / rect.width;
    return { x: (e.clientX - rect.left)*f, y: (e.clientY - rect.top)*f };
  };

  const svgToMm = (svgX: number, svgY: number) => ({
    wx: (svgX - PADDING) / scale,
    wy: H - (svgY - PADDING) / scale,
  });

  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragStart.current = getSvgPoint(e);
    isDragging.current = false;
  };

  const onSvgMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const pt = getSvgPoint(e);
    if (Math.abs(pt.x - dragStart.current.x) > 4 || Math.abs(pt.y - dragStart.current.y) > 4) {
      isDragging.current = true;
      setRubberBand({
        x1: Math.min(dragStart.current.x, pt.x), y1: Math.min(dragStart.current.y, pt.y),
        x2: Math.max(dragStart.current.x, pt.x), y2: Math.max(dragStart.current.y, pt.y),
      });
    }
  };

  const onSvgMouseUp = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    if (isDragging.current && rubberBand) {
      const w1 = svgToMm(rubberBand.x1, rubberBand.y1);
      const w2 = svgToMm(rubberBand.x2, rubberBand.y2);
      const minX = Math.min(w1.wx, w2.wx), maxX = Math.max(w1.wx, w2.wx);
      const minY = Math.min(w1.wy, w2.wy), maxY = Math.max(w1.wy, w2.wy);
      const inRect = visiblePlacements.filter(p => {
        const len = getDisplayLength(p);
        const dispY = getDisplayY(p);
        const ox = p.offset_x ?? 0;
        const px = p.x + ox;
        return px < maxX && px + p.full_width > minX && dispY < maxY && dispY + len > minY;
      }).map(p => p.sheet_number);
      if (inRect.length > 0) {
        setSelected(e.shiftKey ? new Set([...selected, ...inRect]) : new Set(inRect));
      }
    }
    dragStart.current = null;
    isDragging.current = false;
    setRubberBand(null);
  };

  const handleSheetClick = (e: React.MouseEvent, num: number) => {
    if (isDragging.current) return;
    e.stopPropagation();
    if (e.shiftKey) {
      setSelected(prev => { const n = new Set(prev); n.has(num) ? n.delete(num) : n.add(num); return n; });
    } else {
      setSelected(prev => prev.size===1 && prev.has(num) ? new Set() : new Set([num]));
    }
  };

  const onSvgClick = (e: React.MouseEvent) => {
    if (isDragging.current) return;
    const tag = (e.target as SVGElement).tagName;
    if (tag === 'svg' || tag === 'rect') setSelected(new Set());
  };

  const selectAll = () => setSelected(new Set(visiblePlacements.map(p => p.sheet_number)));

  const onPanelMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    panelDrag.current = { startX:e.clientX, startY:e.clientY, startPX:panelPos.x, startPY:panelPos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panelDrag.current) return;
      setPanelPos({ x: panelDrag.current.startPX + e.clientX - panelDrag.current.startX, y: panelDrag.current.startPY + e.clientY - panelDrag.current.startY });
    };
    const onUp = () => { panelDrag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const uniqueLengths = Array.from(new Set(visiblePlacements.map(p => getDisplayLength(p)))).sort((a,b)=>a-b);

  return (
    <div style={{ fontFamily:'system-ui, sans-serif', position:'relative' }}>

      {/* Заголовок */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h3 style={{ margin:0, fontSize:'1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize:'.8rem', color:'#6b7280', marginTop:'2px' }}>
            {calcResult.profile_name} · {visiblePlacements.length} листів · {calcResult.slope_area_m2.toFixed(2)} м²
            {layoutOffset !== 0 && <span style={{ color:'#f59e0b' }}> · Зсув: {layoutOffset>0?'+':''}{layoutOffset}мм</span>}
            {rowSplitOffset !== 0 && <span style={{ color:COLORS.split }}> · Розподіл: {rowSplitOffset>0?'+':''}{rowSplitOffset}мм</span>}
            {hasSelection && <span style={{ color:COLORS.selected, fontWeight:600 }}> · Виділено: {selected.size} шт</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={selectAll} style={{ padding:'6px 12px', background:COLORS.selected, color:'#fff', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600, fontSize:'.82rem' }}>☑ Виділити всі</button>
          {hasSelection && <button onClick={()=>setSelected(new Set())} style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.82rem' }}>✕ Зняти</button>}
          <button onClick={()=>setZoom(z=>Math.max(0.3,z-0.1))} style={zoomBtn}>−</button>
          <span style={{ fontSize:'.85rem', minWidth:'40px', textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>Math.min(3,z+0.1))} style={zoomBtn}>+</button>
          <button onClick={()=>setZoom(1)} style={zoomBtn}>⟳</button>
          <button onClick={resetAll} style={{ ...zoomBtn, color:'#dc2626', borderColor:'#fca5a5' }}>↩ Скинути</button>
        </div>
      </div>

      <div style={{ fontSize:'.8rem', color:'#9ca3af', marginBottom:'8px' }}>
        💡 Клік — виділити · Shift+клік — додати · Тягни мишу — виділити область
      </div>

      {/* Зелена панель зсуву */}
      <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:'8px', padding:'10px 14px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'.82rem', fontWeight:600, color:'#166534', whiteSpace:'nowrap' }}>🔄 По горизонталі:</span>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {STEPS.map(s => (
              <React.Fragment key={s.mm}>
                <button onClick={()=>shiftLayout(-s.mm)} style={shiftBtn}>← {s.label}</button>
                <button onClick={()=>shiftLayout(+s.mm)} style={shiftBtn}>→ {s.label}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Блакитна панель розподілу рядів */}
      {hasMultipleRows && (
        <div style={{ background:'#ecfeff', border:'1px solid #a5f3fc', borderRadius:'8px', padding:'10px 14px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'.82rem', fontWeight:600, color:'#0e7490', whiteSpace:'nowrap' }}>
            ✂ Лінія розподілу рядів ({(effectiveSplitY/1000).toFixed(3)} м):
          </span>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {STEPS.map(s => (
              <React.Fragment key={s.mm}>
                <button onClick={()=>shiftSplit(-s.mm)} style={splitBtn}>↓ {s.label}</button>
                <button onClick={()=>shiftSplit(+s.mm)} style={splitBtn}>↑ {s.label}</button>
              </React.Fragment>
            ))}
          </div>
          {rowSplitOffset !== 0 && (
            <button onClick={()=>setRowSplitOffset(0)} style={{ padding:'4px 10px', border:'1px solid #a5f3fc', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.75rem', color:'#0e7490' }}>
              ↩ Скинути
            </button>
          )}
        </div>
      )}

      {/* SVG */}
      <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'580px', border:'1px solid #e5e7eb', borderRadius:'10px', background:COLORS.bg }}>
        <svg ref={svgRef} width={SVG_W*zoom} height={SVG_H*zoom} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ display:'block' }}
          onMouseDown={onSvgMouseDown} onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onClick={onSvgClick}>
          <rect width={SVG_W} height={SVG_H} fill={COLORS.bg}/>
          {Array.from({length:Math.ceil(W/1000)+1},(_,i)=>i).map(i=>(
            <line key={`gx${i}`} x1={tx(i*1000)} y1={PADDING} x2={tx(i*1000)} y2={PADDING+H*scale} stroke={COLORS.grid} strokeWidth="0.5"/>
          ))}
          {Array.from({length:Math.ceil(H/1000)+1},(_,i)=>i).map(i=>(
            <line key={`gy${i}`} x1={PADDING} y1={ty(i*1000)} x2={PADDING+W*scale} y2={ty(i*1000)} stroke={COLORS.grid} strokeWidth="0.5"/>
          ))}
          <defs>
            <clipPath id="slope-bounds">
              <rect x={PADDING} y={PADDING-20} width={W*scale} height={(H+20)*scale+20}/>
            </clipPath>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af"/>
            </marker>
          </defs>

          {/* Листи */}
          <g clipPath="url(#slope-bounds)">
            {visiblePlacements.map(p => {
              const length = getDisplayLength(p);
              const dispY  = getDisplayY(p);
              const ox     = p.offset_x ?? 0;
              const isSel  = selected.has(p.sheet_number);
              const x1 = tx(p.x + ox);
              const y1 = ty(dispY);
              const w  = p.full_width * scale;
              const h  = length * scale;
              const color = sheetColor(p, isSel);
              return (
                <g key={p.sheet_number} onClick={e=>handleSheetClick(e,p.sheet_number)} style={{cursor:'pointer'}}>
                  <rect x={x1} y={y1-h} width={w} height={h}
                    fill={color} fillOpacity={isSel?0.45:0.25}
                    stroke={color} strokeWidth={isSel?2.5:1}/>
                  {h>20 && <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle"
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={Math.max(9,Math.min(13,h/4))} fontWeight="600">
                    {(length/1000).toFixed(3)}
                  </text>}
                  {h>30 && w>20 && <text x={x1+w/2} y={y1-h/2+14} textAnchor="middle" dominantBaseline="middle"
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={8} opacity={0.7}>
                    №{p.sheet_number}
                  </text>}
                  {p.manual_length && <text x={x1+3} y={y1-h+10} fill="#dc2626" fontSize={9}>✎</text>}
                </g>
              );
            })}
          </g>

          {/* Лінія розподілу рядів */}
          {hasMultipleRows && effectiveSplitY > 0 && (
            <g>
              <line
                x1={PADDING} y1={ty(effectiveSplitY)}
                x2={PADDING + W*scale} y2={ty(effectiveSplitY)}
                stroke={COLORS.split} strokeWidth="2" strokeDasharray="8 4"/>
              <rect x={PADDING+2} y={ty(effectiveSplitY)-10} width={80} height={18} rx="4"
                fill={COLORS.split} opacity={0.9}/>
              <text x={PADDING+6} y={ty(effectiveSplitY)+3}
                fill="#fff" fontSize="10" fontWeight="600">
                ✂ {(effectiveSplitY/1000).toFixed(2)}м
              </text>
            </g>
          )}

          <path d={polyPath} fill="none" stroke={COLORS.polygon} strokeWidth="2"/>

          {rubberBand && (
            <rect x={rubberBand.x1} y={rubberBand.y1} width={rubberBand.x2-rubberBand.x1} height={rubberBand.y2-rubberBand.y1}
              fill="rgba(124,58,237,0.1)" stroke={COLORS.selected} strokeWidth="1" strokeDasharray="4 2"/>
          )}

          <line x1={tx(0)} y1={PADDING-20} x2={tx(W)} y2={PADDING-20} stroke="#9ca3af" strokeWidth="1" markerEnd="url(#arrow)"/>
          <text x={tx(W/2)} y={PADDING-28} textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600">{(W/1000).toFixed(2)} м</text>
          <line x1={PADDING-20} y1={ty(0)} x2={PADDING-20} y2={ty(H)} stroke="#9ca3af" strokeWidth="1"/>
          <text x={PADDING-35} y={ty(H/2)} textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600"
            transform={`rotate(-90,${PADDING-35},${ty(H/2)})`}>{(H/1000).toFixed(2)} м</text>
          {Array.from({length:Math.ceil(W/1000)+1},(_,i)=>i).map(i=>(
            <text key={`lx${i}`} x={tx(i*1000)} y={PADDING+H*scale+18} textAnchor="middle" fill="#6b7280" fontSize="9">{i}</text>
          ))}
          {Array.from({length:Math.ceil(H/1000)+1},(_,i)=>i).map(i=>(
            <text key={`ly${i}`} x={PADDING-8} y={ty(i*1000)+3} textAnchor="end" fill="#6b7280" fontSize="9">{i}</text>
          ))}
        </svg>
      </div>

      {/* Легенда */}
      <div style={{ display:'flex', gap:'16px', marginTop:'12px', flexWrap:'wrap' }}>
        <LegendItem color={COLORS.full}     label="Повний лист"/>
        <LegendItem color={COLORS.cut}      label="Обрізаний лист"/>
        <LegendItem color={COLORS.waste}    label="Великий відхід (>50%)"/>
        <LegendItem color={COLORS.selected} label="Виділений лист"/>
        {hasMultipleRows && <LegendItem color={COLORS.split} label="Лінія розподілу рядів"/>}
      </div>

      {/* Таблиця */}
      <div style={{ marginTop:'16px', background:'#fff', border:'1px solid #e5e7eb', borderRadius:'8px', overflow:'hidden' }}>
        <div style={{ padding:'10px 16px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb', fontWeight:600, fontSize:'.85rem' }}>
          Специфікація листів
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.85rem' }}>
          <thead>
            <tr style={{ background:'#f3f4f6' }}>
              <th style={{ padding:'8px 12px', textAlign:'left' }}>Довжина</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Кількість</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Корисна площа</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Повна площа</th>
            </tr>
          </thead>
          <tbody>
            {uniqueLengths.map(len => {
              const sheets = visiblePlacements.filter(p=>getDisplayLength(p)===len);
              return (
                <tr key={len} style={{ borderTop:'1px solid #f3f4f6' }}>
                  <td style={{ padding:'8px 12px', fontWeight:500 }}>{(len/1000).toFixed(3)} м</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.length} шт</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.reduce((s,p)=>s+(p.intersect_area_m2??0),0).toFixed(3)} м²</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.reduce((s,p)=>s+(p.full_area_m2??0),0).toFixed(3)} м²</td>
                </tr>
              );
            })}
            <tr style={{ borderTop:'2px solid #e5e7eb', fontWeight:600, background:'#f9fafb' }}>
              <td style={{ padding:'8px 12px' }}>Всього</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.length} шт</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.reduce((s,p)=>s+(p.intersect_area_m2??0),0).toFixed(3)} м²</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.reduce((s,p)=>s+(p.full_area_m2??0),0).toFixed(3)} м²</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Плаваюча панель */}
      {hasSelection && (
        <div onMouseDown={onPanelMouseDown}
          style={{ position:'fixed', left:panelPos.x, top:panelPos.y, zIndex:500,
            background:'#fff', border:`2px solid ${COLORS.selected}`, borderRadius:'10px',
            boxShadow:'0 8px 32px rgba(0,0,0,0.2)', width:'280px', userSelect:'none' }}>
          <div style={{ background:COLORS.selected, color:'#fff', padding:'8px 12px', borderRadius:'8px 8px 0 0',
            cursor:'move', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:600, fontSize:'.85rem' }}>✏ Виділено: {selected.size} шт</span>
            <button onClick={()=>setSelected(new Set())}
              style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', fontSize:'1rem', lineHeight:1 }}>✕</button>
          </div>
          <div style={{ padding:'12px' }}>
            <div style={{ marginBottom:'10px' }}>
              <div style={sectionLabel}>← → Зсув по горизонталі (з перегенерацією)</div>
              {STEPS.map(s=>(
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px' }}>
                  <button onClick={()=>shiftLayout(-s.mm)} style={ctrlBtn}>← {s.label}</button>
                  <button onClick={()=>shiftLayout(+s.mm)} style={ctrlBtn}>→ {s.label}</button>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:'10px' }}>
              <div style={sectionLabel}>↑ ↓ Зміщення по вертикалі</div>
              {STEPS.map(s=>(
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px' }}>
                  <button onClick={()=>moveDown(s.mm)} style={ctrlBtn}>↓ {s.label}</button>
                  <button onClick={()=>moveUp(s.mm)}   style={ctrlBtn}>↑ {s.label}</button>
                </div>
              ))}
            </div>
            <div style={{ marginBottom:'12px' }}>
              <div style={sectionLabel}>↕ Довжина листа</div>
              {STEPS.map(s=>(
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px' }}>
                  <button onClick={()=>lenMinus(s.mm)} style={ctrlBtn}>− {s.label}</button>
                  <button onClick={()=>lenPlus(s.mm)}  style={ctrlBtn}>+ {s.label}</button>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px', borderTop:'1px solid #e5e7eb', paddingTop:'10px' }}>
              <button onClick={resetSelected} style={{ padding:'6px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#f9fafb', fontSize:'.8rem' }}>
                ↩ Скинути вибрані
              </button>
              <button onClick={deleteSelected} style={{ padding:'6px', border:'1px solid #fca5a5', borderRadius:'6px', cursor:'pointer', background:'#fff', color:'#dc2626', fontSize:'.8rem' }}>
                🗑 Видалити вибрані
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties  = { padding:'4px 10px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff' };
const shiftBtn: React.CSSProperties = { padding:'5px 10px', border:'1px solid #bbf7d0', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.78rem', fontWeight:500, color:'#166534' };
const splitBtn: React.CSSProperties = { padding:'5px 10px', border:'1px solid #a5f3fc', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.78rem', fontWeight:500, color:'#0e7490' };
const ctrlBtn: React.CSSProperties  = { flex:1, padding:'5px 4px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.78rem', fontWeight:500 };
const sectionLabel: React.CSSProperties = { fontSize:'.72rem', fontWeight:600, color:'#6b7280', marginBottom:'6px', textTransform:'uppercase' as const };

function LegendItem({ color, label }: { color:string; label:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.78rem', color:'#374151' }}>
      <div style={{ width:'14px', height:'14px', background:color, opacity:0.6, borderRadius:'3px', border:`1px solid ${color}` }}/>
      {label}
    </div>
  );
}
