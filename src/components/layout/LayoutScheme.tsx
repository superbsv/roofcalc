// ============================================
// ArtBudTrading Roof Calculator
// components/layout/LayoutScheme.tsx
// ============================================

import React, { useState, useRef, useCallback } from 'react';
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
  grid:     '#e5e7eb',
  text:     '#1e40af',
  bg:       '#f8fafc',
};

// Кроки: 0.1м=100мм, 0.01м=10мм, 0.001м=1мм
const STEPS = [
  { label: '0.1м',   mm: 100 },
  { label: '0.01м',  mm: 10  },
  { label: '0.001м', mm: 1   },
];

export default function LayoutScheme({ calcResult, polygonPoints, slopeName, onUpdate }: Props) {
  const [placements, setPlacements] = useState<SheetPlacement[]>(
    calcResult.placements.map(p => ({ ...p }))
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zoom, setZoom]         = useState(1);

  // Позиція панелі редагування (перетягування)
  const [panelPos, setPanelPos] = useState({ x: 20, y: 80 });
  const dragRef    = useRef<{ startX: number; startY: number; startPX: number; startPY: number } | null>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  const W = calcResult.slope_width_mm;
  const H = calcResult.slope_height_mm;
  const PADDING = 80;
  const SVG_W = 900;
  const SVG_H = 600;
  const scale = Math.min((SVG_W - PADDING*2) / W, (SVG_H - PADDING*2) / H) * zoom;

  const tx = (x: number) => PADDING + x * scale;
  const ty = (y: number) => PADDING + (H - y) * scale;

  const polyPath = polygonPoints.length >= 3
    ? polygonPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p[0])} ${ty(p[1])}`).join(' ') + ' Z'
    : `M ${tx(0)} ${ty(0)} L ${tx(W)} ${ty(0)} L ${tx(W)} ${ty(H)} L ${tx(0)} ${ty(H)} Z`;

  const sheetColor = (p: SheetPlacement, isSel: boolean) => {
    if (isSel) return COLORS.selected;
    if (p.intersect_area_m2 === undefined || p.full_area_m2 === undefined) return COLORS.full;
    if ((p.waste_area_m2 ?? 0) / (p.full_area_m2 ?? 1) * 100 > 50) return COLORS.waste;
    if (p.intersect_area_m2 < p.full_area_m2 * 0.95) return COLORS.cut;
    return COLORS.full;
  };

  const visiblePlacements = placements.filter(p => !p.deleted);
  const hasSelection = selected.size > 0;

  // ---- Вибір листів ----
  const handleSheetClick = (e: React.MouseEvent, num: number) => {
    if (e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(num) ? next.delete(num) : next.add(num);
        return next;
      });
    } else {
      setSelected(prev => prev.size === 1 && prev.has(num) ? new Set() : new Set([num]));
    }
  };

  // ---- Оновлення виділених листів ----
  const updateSelected = useCallback((fn: (p: SheetPlacement) => SheetPlacement) => {
    setPlacements(prev => {
      const updated = prev.map(p => selected.has(p.sheet_number) ? fn(p) : p);
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
  }, [selected, onUpdate]);

  // ---- Дії зі стрілками ----
  const moveLeft  = (mm: number) => updateSelected(p => ({ ...p, offset_x: (p.offset_x ?? 0) - mm }));
  const moveRight = (mm: number) => updateSelected(p => ({ ...p, offset_x: (p.offset_x ?? 0) + mm }));
  const moveUp    = (mm: number) => updateSelected(p => ({ ...p, offset_y: (p.offset_y ?? 0) + mm }));
  const moveDown  = (mm: number) => updateSelected(p => ({ ...p, offset_y: (p.offset_y ?? 0) - mm }));
  const lenPlus   = (mm: number) => updateSelected(p => ({ ...p, manual_length: (p.manual_length ?? p.length) + mm }));
  const lenMinus  = (mm: number) => updateSelected(p => ({ ...p, manual_length: Math.max(1, (p.manual_length ?? p.length) - mm) }));

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
    setPlacements(prev => {
      const updated = prev.map(p => ({ ...p, manual_length: undefined, offset_x: undefined, offset_y: undefined, deleted: undefined }));
      onUpdate?.(updated);
      return updated;
    });
    setSelected(new Set());
  };

  // ---- Перетягування панелі ----
  const onPanelMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPX: panelPos.x, startPY: panelPos.y };
    e.preventDefault();
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    setPanelPos({
      x: dragRef.current.startPX + e.clientX - dragRef.current.startX,
      y: dragRef.current.startPY + e.clientY - dragRef.current.startY,
    });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  React.useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  const uniqueLengths = Array.from(new Set(visiblePlacements.map(p => p.manual_length ?? p.length))).sort((a, b) => a - b);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', position: 'relative' }}>

      {/* Заголовок */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h3 style={{ margin:0, fontSize:'1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize:'.8rem', color:'#6b7280', marginTop:'2px' }}>
            {calcResult.profile_name} · {visiblePlacements.length} листів · {calcResult.slope_area_m2.toFixed(2)} м²
            {hasSelection && <span style={{ color:COLORS.selected, fontWeight:600 }}> · Виділено: {selected.size} шт</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <button onClick={() => setZoom(z => Math.max(0.3, z-0.1))} style={zoomBtn}>−</button>
          <span style={{ fontSize:'.85rem', minWidth:'45px', textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z+0.1))} style={zoomBtn}>+</button>
          <button onClick={() => setZoom(1)} style={zoomBtn}>⟳</button>
          <button onClick={resetAll} style={{ ...zoomBtn, color:'#dc2626', borderColor:'#fca5a5' }}>↩ Скинути</button>
        </div>
      </div>

      {!hasSelection && (
        <div style={{ fontSize:'.8rem', color:'#9ca3af', marginBottom:'8px' }}>
          💡 Клікніть на лист щоб виділити · Shift+клік — кілька листів
        </div>
      )}

      {/* SVG */}
      <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'580px', border:'1px solid #e5e7eb', borderRadius:'10px', background:COLORS.bg }}>
        <svg width={SVG_W*zoom} height={SVG_H*zoom} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display:'block' }}>
          <rect width={SVG_W} height={SVG_H} fill={COLORS.bg} />
          {Array.from({ length: Math.ceil(W/1000)+1 }, (_, i) => i).map(i => (
            <line key={`gx${i}`} x1={tx(i*1000)} y1={PADDING} x2={tx(i*1000)} y2={PADDING+H*scale} stroke={COLORS.grid} strokeWidth="0.5" />
          ))}
          {Array.from({ length: Math.ceil(H/1000)+1 }, (_, i) => i).map(i => (
            <line key={`gy${i}`} x1={PADDING} y1={ty(i*1000)} x2={PADDING+W*scale} y2={ty(i*1000)} stroke={COLORS.grid} strokeWidth="0.5" />
          ))}
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af" />
            </marker>
          </defs>
          <g>
            {visiblePlacements.map(p => {
              const length = p.manual_length ?? p.length;
              const ox = p.offset_x ?? 0;
              const oy = p.offset_y ?? 0;
              const isSel = selected.has(p.sheet_number);
              const x1 = tx(p.x + ox);
              const y1 = ty(oy);
              const w  = p.full_width * scale;
              const h  = length * scale;
              const color = sheetColor(p, isSel);
              return (
                <g key={p.sheet_number} onClick={e => handleSheetClick(e, p.sheet_number)} style={{ cursor:'pointer' }}>
                  <rect x={x1} y={y1-h} width={w} height={h}
                    fill={color} fillOpacity={isSel ? 0.45 : 0.25}
                    stroke={color} strokeWidth={isSel ? 2.5 : 1} />
                  {h > 20 && (
                    <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle"
                      fill={isSel ? COLORS.selected : COLORS.text}
                      fontSize={Math.max(9, Math.min(13, h/4))} fontWeight="600">
                      {(length/1000).toFixed(3)}
                    </text>
                  )}
                  {h > 30 && w > 20 && (
                    <text x={x1+w/2} y={y1-h/2+14} textAnchor="middle" dominantBaseline="middle"
                      fill={isSel ? COLORS.selected : COLORS.text} fontSize={8} opacity={0.7}>
                      №{p.sheet_number}
                    </text>
                  )}
                  {p.manual_length && <text x={x1+3} y={y1-h+10} fill="#dc2626" fontSize={9}>✎</text>}
                </g>
              );
            })}
          </g>
          <path d={polyPath} fill="none" stroke={COLORS.polygon} strokeWidth="2" />
          <line x1={tx(0)} y1={PADDING-20} x2={tx(W)} y2={PADDING-20} stroke="#9ca3af" strokeWidth="1" markerEnd="url(#arrow)" />
          <text x={tx(W/2)} y={PADDING-28} textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600">{(W/1000).toFixed(2)} м</text>
          <line x1={PADDING-20} y1={ty(0)} x2={PADDING-20} y2={ty(H)} stroke="#9ca3af" strokeWidth="1" />
          <text x={PADDING-35} y={ty(H/2)} textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600"
            transform={`rotate(-90, ${PADDING-35}, ${ty(H/2)})`}>{(H/1000).toFixed(2)} м</text>
          {Array.from({ length: Math.ceil(W/1000)+1 }, (_, i) => i).map(i => (
            <text key={`lx${i}`} x={tx(i*1000)} y={PADDING+H*scale+18} textAnchor="middle" fill="#6b7280" fontSize="9">{i}</text>
          ))}
          {Array.from({ length: Math.ceil(H/1000)+1 }, (_, i) => i).map(i => (
            <text key={`ly${i}`} x={PADDING-8} y={ty(i*1000)+3} textAnchor="end" fill="#6b7280" fontSize="9">{i}</text>
          ))}
        </svg>
      </div>

      {/* Легенда */}
      <div style={{ display:'flex', gap:'16px', marginTop:'12px', flexWrap:'wrap' }}>
        <LegendItem color={COLORS.full}     label="Повний лист" />
        <LegendItem color={COLORS.cut}      label="Обрізаний лист" />
        <LegendItem color={COLORS.waste}    label="Великий відхід (>50%)" />
        <LegendItem color={COLORS.selected} label="Виділений лист" />
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
              const sheets = visiblePlacements.filter(p => (p.manual_length ?? p.length) === len);
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

      {/* ===== ПЛАВАЮЧА ПАНЕЛЬ РЕДАГУВАННЯ ===== */}
      {hasSelection && (
        <div
          ref={panelRef}
          onMouseDown={onPanelMouseDown}
          style={{
            position: 'fixed',
            left: panelPos.x,
            top: panelPos.y,
            zIndex: 500,
            background: '#fff',
            border: `2px solid ${COLORS.selected}`,
            borderRadius: '10px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            width: '280px',
            userSelect: 'none',
          }}
        >
          {/* Хедер — за нього тягнуть */}
          <div style={{
            background: COLORS.selected, color: '#fff',
            padding: '8px 12px', borderRadius: '8px 8px 0 0',
            cursor: 'move', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 600, fontSize: '.85rem' }}>✏ Виділено: {selected.size} шт</span>
            <button onClick={() => setSelected(new Set())}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ padding: '12px' }}>

            {/* Зміщення по горизонталі */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase' }}>
                ← → Зміщення по горизонталі
              </div>
              {STEPS.map(s => (
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
                  <button onClick={() => moveLeft(s.mm)} style={ctrlBtn}>← {s.label}</button>
                  <button onClick={() => moveRight(s.mm)} style={ctrlBtn}>→ {s.label}</button>
                </div>
              ))}
            </div>

            {/* Зміщення по вертикалі */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase' }}>
                ↑ ↓ Зміщення по вертикалі
              </div>
              {STEPS.map(s => (
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
                  <button onClick={() => moveDown(s.mm)} style={ctrlBtn}>↓ {s.label}</button>
                  <button onClick={() => moveUp(s.mm)} style={ctrlBtn}>↑ {s.label}</button>
                </div>
              ))}
            </div>

            {/* Довжина */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '.72rem', fontWeight: 600, color: '#6b7280', marginBottom: '6px', textTransform: 'uppercase' }}>
                ↕ Довжина листа
              </div>
              {STEPS.map(s => (
                <div key={s.mm} style={{ display:'flex', gap:'4px', marginBottom:'4px', alignItems:'center' }}>
                  <button onClick={() => lenMinus(s.mm)} style={ctrlBtn}>− {s.label}</button>
                  <button onClick={() => lenPlus(s.mm)} style={ctrlBtn}>+ {s.label}</button>
                </div>
              ))}
            </div>

            {/* Дії */}
            <div style={{ display:'flex', flexDirection:'column', gap:'6px', borderTop:'1px solid #e5e7eb', paddingTop:'10px' }}>
              <button onClick={resetSelected}
                style={{ padding:'6px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#f9fafb', fontSize:'.8rem' }}>
                ↩ Скинути вибрані
              </button>
              <button onClick={deleteSelected}
                style={{ padding:'6px', border:'1px solid #fca5a5', borderRadius:'6px', cursor:'pointer', background:'#fff', color:'#dc2626', fontSize:'.8rem' }}>
                🗑 Видалити вибрані
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #d1d5db',
  borderRadius: '6px', cursor: 'pointer', background: '#fff',
};

const ctrlBtn: React.CSSProperties = {
  flex: 1, padding: '5px 4px',
  border: '1px solid #d1d5db', borderRadius: '6px',
  cursor: 'pointer', background: '#fff',
  fontSize: '.78rem', fontWeight: 500,
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.78rem', color:'#374151' }}>
      <div style={{ width:'14px', height:'14px', background:color, opacity:0.6, borderRadius:'3px', border:`1px solid ${color}` }} />
      {label}
    </div>
  );
}
