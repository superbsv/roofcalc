// ============================================
// ArtBudTrading Roof Calculator
// components/layout/LayoutScheme.tsx
// SVG схема розкладки листів
// ============================================

import React, { useState, useRef } from 'react';
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

const STEP = 50; // крок переміщення мм

export default function LayoutScheme({ calcResult, polygonPoints, slopeName, onUpdate }: Props) {
  const [placements, setPlacements] = useState<SheetPlacement[]>(
    calcResult.placements.map(p => ({ ...p }))
  );
  const [selected, setSelected]     = useState<Set<number>>(new Set());
  const [editMode, setEditMode]     = useState(false);
  const [zoom, setZoom]             = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = calcResult.slope_width_mm;
  const H = calcResult.slope_height_mm;

  const PADDING = 80;
  const SVG_W = 900;
  const SVG_H = 600;
  const DRAW_W = SVG_W - PADDING * 2;
  const DRAW_H = SVG_H - PADDING * 2;
  const scale  = Math.min(DRAW_W / W, DRAW_H / H) * zoom;

  const tx = (x: number) => PADDING + x * scale;
  const ty = (y: number) => PADDING + (H - y) * scale;

  const polyPath = polygonPoints.length >= 3
    ? polygonPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p[0])} ${ty(p[1])}`).join(' ') + ' Z'
    : `M ${tx(0)} ${ty(0)} L ${tx(W)} ${ty(0)} L ${tx(W)} ${ty(H)} L ${tx(0)} ${ty(H)} Z`;

  const sheetColor = (p: SheetPlacement, isSelected: boolean) => {
    if (isSelected) return COLORS.selected;
    if (p.intersect_area_m2 === undefined || p.full_area_m2 === undefined) return COLORS.full;
    const wastePct = (p.waste_area_m2 ?? 0) / (p.full_area_m2 ?? 1) * 100;
    if (wastePct > 50) return COLORS.waste;
    if (p.intersect_area_m2 < p.full_area_m2 * 0.95) return COLORS.cut;
    return COLORS.full;
  };

  const visiblePlacements = placements.filter(p => !p.deleted);

  // Клік на лист — виділення (Shift = мультивибір)
  const handleSheetClick = (e: React.MouseEvent, num: number) => {
    if (e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(num) ? next.delete(num) : next.add(num);
        return next;
      });
    } else {
      setSelected(prev => {
        if (prev.size === 1 && prev.has(num)) return new Set(); // зняти виділення
        return new Set([num]);
      });
    }
  };

  // Оновити виділені листи
  const updateSelected = (fn: (p: SheetPlacement) => SheetPlacement) => {
    const updated = placements.map(p => selected.has(p.sheet_number) ? fn(p) : p);
    setPlacements(updated);
    onUpdate?.(updated.filter(p => !p.deleted));
  };

  const moveLeft  = () => updateSelected(p => ({ ...p, offset_x: (p.offset_x ?? 0) - STEP }));
  const moveRight = () => updateSelected(p => ({ ...p, offset_x: (p.offset_x ?? 0) + STEP }));
  const moveUp    = () => updateSelected(p => ({ ...p, offset_y: (p.offset_y ?? 0) + STEP }));
  const moveDown  = () => updateSelected(p => ({ ...p, offset_y: (p.offset_y ?? 0) - STEP }));
  const lenPlus   = () => updateSelected(p => ({ ...p, manual_length: (p.manual_length ?? p.length) + STEP }));
  const lenMinus  = () => updateSelected(p => ({ ...p, manual_length: Math.max(100, (p.manual_length ?? p.length) - STEP) }));
  const deleteSelected = () => {
    const updated = placements.map(p => selected.has(p.sheet_number) ? { ...p, deleted: true } : p);
    setPlacements(updated);
    onUpdate?.(updated.filter(p => !p.deleted));
    setSelected(new Set());
  };
  const resetSelected = () => {
    updateSelected(p => ({ ...p, manual_length: undefined, offset_x: undefined, offset_y: undefined }));
  };

  const resetAll = () => {
    const updated = placements.map(p => ({ ...p, manual_length: undefined, offset_x: undefined, offset_y: undefined, deleted: undefined }));
    setPlacements(updated);
    onUpdate?.(updated);
    setSelected(new Set());
  };

  const uniqueLengths = Array.from(new Set(visiblePlacements.map(p => p.manual_length ?? p.length))).sort((a, b) => a - b);
  const hasSelection = selected.size > 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Заголовок */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h3 style={{ margin:0, fontSize:'1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize:'.8rem', color:'#6b7280', marginTop:'2px' }}>
            {calcResult.profile_name} · {visiblePlacements.length} листів · {calcResult.slope_area_m2.toFixed(2)} м²
            {hasSelection && <span style={{ color: COLORS.selected, fontWeight: 600 }}> · Виділено: {selected.size} шт</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
            style={{ padding:'4px 10px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff' }}>−</button>
          <span style={{ fontSize:'.85rem', minWidth:'45px', textAlign:'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))}
            style={{ padding:'4px 10px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff' }}>+</button>
          <button onClick={() => setZoom(1)}
            style={{ padding:'4px 10px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff' }}>⟳</button>
          <button onClick={resetAll}
            style={{ padding:'4px 12px', border:'1px solid #fca5a5', borderRadius:'6px', cursor:'pointer', background:'#fff', color:'#dc2626', fontSize:'.8rem' }}>
            ↩ Скинути
          </button>
        </div>
      </div>

      {/* Панель редагування — з'являється при виділенні листа */}
      {hasSelection && (
        <div style={{
          background:'#fff', border:'2px solid ' + COLORS.selected,
          borderRadius:'10px', padding:'12px 16px', marginBottom:'12px',
          display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap',
        }}>
          <div style={{ fontSize:'.8rem', fontWeight:600, color: COLORS.selected }}>
            ✏ Редагування листів ({selected.size} шт)
          </div>

          {/* Переміщення */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
            <div style={{ fontSize:'.7rem', color:'#6b7280', marginBottom:'2px' }}>Переміщення</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,32px)', gridTemplateRows:'repeat(3,32px)', gap:'2px' }}>
              <div/>
              <button onClick={moveUp} style={arrowBtn}>↑</button>
              <div/>
              <button onClick={moveLeft} style={arrowBtn}>←</button>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', fontSize:'.6rem', color:'#9ca3af' }}>
                {STEP}мм
              </div>
              <button onClick={moveRight} style={arrowBtn}>→</button>
              <div/>
              <button onClick={moveDown} style={arrowBtn}>↓</button>
              <div/>
            </div>
          </div>

          {/* Довжина */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
            <div style={{ fontSize:'.7rem', color:'#6b7280', marginBottom:'2px' }}>Довжина</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <button onClick={lenPlus} style={{ ...arrowBtn, width:'80px' }}>+ {STEP} мм</button>
              <button onClick={lenMinus} style={{ ...arrowBtn, width:'80px' }}>− {STEP} мм</button>
            </div>
          </div>

          {/* Дії */}
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', marginLeft:'auto' }}>
            <button onClick={resetSelected}
              style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#fff', fontSize:'.8rem' }}>
              ↩ Скинути вибрані
            </button>
            <button onClick={deleteSelected}
              style={{ padding:'6px 12px', border:'1px solid #fca5a5', borderRadius:'6px', cursor:'pointer', background:'#fff', color:'#dc2626', fontSize:'.8rem' }}>
              🗑 Видалити вибрані
            </button>
            <button onClick={() => setSelected(new Set())}
              style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:'6px', cursor:'pointer', background:'#f3f4f6', fontSize:'.8rem' }}>
              ✕ Зняти виділення
            </button>
          </div>
        </div>
      )}

      {!hasSelection && (
        <div style={{ fontSize:'.8rem', color:'#9ca3af', marginBottom:'8px' }}>
          💡 Клікніть на лист щоб виділити · Shift+клік — кілька листів
        </div>
      )}

      {/* SVG схема */}
      <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'580px', border:'1px solid #e5e7eb', borderRadius:'10px', background:COLORS.bg }}>
        <svg ref={svgRef} width={SVG_W * zoom} height={SVG_H * zoom} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display:'block' }}>
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
              const isSelected = selected.has(p.sheet_number);
              const x1 = tx(p.x + ox);
              const y1 = ty(oy);
              const w  = p.full_width * scale;
              const h  = length * scale;
              const color = sheetColor(p, isSelected);
              return (
                <g key={p.sheet_number} onClick={e => handleSheetClick(e, p.sheet_number)} style={{ cursor:'pointer' }}>
                  <rect x={x1} y={y1-h} width={w} height={h}
                    fill={color} fillOpacity={isSelected ? 0.45 : 0.25}
                    stroke={color} strokeWidth={isSelected ? 2.5 : 1} />
                  {h > 20 && (
                    <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle"
                      fill={isSelected ? COLORS.selected : COLORS.text}
                      fontSize={Math.max(9, Math.min(13, h/4))} fontWeight="600">
                      {(length/1000).toFixed(3)}
                    </text>
                  )}
                  {h > 30 && w > 20 && (
                    <text x={x1+w/2} y={y1-h/2+14} textAnchor="middle" dominantBaseline="middle"
                      fill={isSelected ? COLORS.selected : COLORS.text} fontSize={8} opacity={0.7}>
                      №{p.sheet_number}
                    </text>
                  )}
                  {p.manual_length && (
                    <text x={x1+3} y={y1-h+10} fill="#dc2626" fontSize={9}>✎</text>
                  )}
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

      {/* Таблиця довжин */}
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
    </div>
  );
}

const arrowBtn: React.CSSProperties = {
  width: '32px', height: '32px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  cursor: 'pointer',
  background: '#fff',
  fontSize: '1rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.78rem', color:'#374151' }}>
      <div style={{ width:'14px', height:'14px', background:color, opacity:0.6, borderRadius:'3px', border:`1px solid ${color}` }} />
      {label}
    </div>
  );
}
