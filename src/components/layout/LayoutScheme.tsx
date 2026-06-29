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
  // Ручне редагування
  manual_length?: number;
  offset_x?: number;
  offset_y?: number;
}

type Point = ApiPoint; // [number, number]

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
  full:     '#3b82f6',  // повний лист — синій
  cut:      '#f59e0b',  // обрізаний — жовтий
  waste:    '#ef4444',  // великий відхід — червоний
  polygon:  '#dc2626',  // контур ската — червоний
  grid:     '#e5e7eb',  // сітка
  text:     '#1e40af',  // підписи розмірів
  bg:       '#f8fafc',  // фон
};

export default function LayoutScheme({ calcResult, polygonPoints, slopeName, onUpdate }: Props) {
  const [placements, setPlacements] = useState<SheetPlacement[]>(
    calcResult.placements.map(p => ({ ...p }))
  );
  const [selectedSheet, setSelectedSheet] = useState<number | null>(null);
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ length: 0, offset_x: 0, offset_y: 0 });
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  // Розміри скату в мм
  const W = calcResult.slope_width_mm;
  const H = calcResult.slope_height_mm;

  // SVG розміри з відступами
  const PADDING = 80;
  const SVG_W = 900;
  const SVG_H = 600;
  const DRAW_W = SVG_W - PADDING * 2;
  const DRAW_H = SVG_H - PADDING * 2;

  // Масштаб
  const scaleX = DRAW_W / W;
  const scaleY = DRAW_H / H;
  const scale = Math.min(scaleX, scaleY) * zoom;

  // Перетворення координат мм → SVG px
  const tx = (x: number) => PADDING + x * scale;
  const ty = (y: number) => PADDING + (H - y) * scale; // перевертаємо Y

  // Полігон ската в SVG координатах
  const polyPath = polygonPoints.length >= 3
? polygonPoints.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${tx(p[0] * 1000)} ${ty(p[1] * 1000)}`
      ).join(' ') + ' Z'
    : `M ${tx(0)} ${ty(0)} L ${tx(W)} ${ty(0)} L ${tx(W)} ${ty(H)} L ${tx(0)} ${ty(H)} Z`;

  // Колір листа залежно від відходу
const sheetColor = (p: SheetPlacement) => {
    const wastePct = (p.waste_area_m2 ?? 0) / (p.full_area_m2 ?? 1) * 100;
    if (wastePct > 50) return COLORS.waste;
    if ((p.intersect_area_m2 ?? 0) < (p.full_area_m2 ?? 1) * 0.95) return COLORS.cut;
    return COLORS.full;
  };

  const openEdit = (p: SheetPlacement) => {
    setSelectedSheet(p.sheet_number);
    setEditForm({
      length: p.manual_length ?? p.length,
      offset_x: p.offset_x ?? 0,
      offset_y: p.offset_y ?? 0,
    });
    setEditModal(true);
  };

  const saveEdit = () => {
    if (selectedSheet === null) return;
    const updated = placements.map(p =>
      p.sheet_number === selectedSheet
        ? { ...p, manual_length: editForm.length, offset_x: editForm.offset_x, offset_y: editForm.offset_y }
        : p
    );
    setPlacements(updated);
    onUpdate?.(updated);
    setEditModal(false);
  };

  const resetEdit = () => {
    if (selectedSheet === null) return;
    const updated = placements.map(p =>
      p.sheet_number === selectedSheet
        ? { ...p, manual_length: undefined, offset_x: undefined, offset_y: undefined }
        : p
    );
    setPlacements(updated);
    onUpdate?.(updated);
    setEditModal(false);
  };

  // Унікальні довжини для легенди
  const uniqueLengths = Array.from(new Set(placements.map(p => p.manual_length ?? p.length))).sort((a, b) => a - b);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Заголовок і кнопки */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize: '.8rem', color: '#6b7280', marginTop: '2px' }}>
            {calcResult.profile_name} · {calcResult.total_sheets} листів · {calcResult.slope_area_m2.toFixed(2)} м²
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
            style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
            −
          </button>
          <span style={{ fontSize: '.85rem', minWidth: '45px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.1))}
            style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
            +
          </button>
          <button onClick={() => setZoom(1)}
            style={{ padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
            ⟳
          </button>
        </div>
      </div>

      {/* SVG схема */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '580px', border: '1px solid #e5e7eb', borderRadius: '10px', background: COLORS.bg }}>
        <svg
          ref={svgRef}
          width={SVG_W * zoom}
          height={SVG_H * zoom}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ display: 'block' }}
        >
          {/* Фон */}
          <rect width={SVG_W} height={SVG_H} fill={COLORS.bg} />

          {/* Сітка */}
          {Array.from({ length: Math.ceil(W / 1000) + 1 }, (_, i) => i).map(i => (
            <line key={`gx${i}`}
              x1={tx(i * 1000)} y1={PADDING} x2={tx(i * 1000)} y2={PADDING + H * scale}
              stroke={COLORS.grid} strokeWidth="0.5" />
          ))}
          {Array.from({ length: Math.ceil(H / 1000) + 1 }, (_, i) => i).map(i => (
            <line key={`gy${i}`}
              x1={PADDING} y1={ty(i * 1000)} x2={PADDING + W * scale} y2={ty(i * 1000)}
              stroke={COLORS.grid} strokeWidth="0.5" />
          ))}

          {/* Кліп-шлях по контуру ската */}
          <defs>
            <clipPath id="slope-clip">
              <path d={polyPath} />
            </clipPath>
          </defs>

          {/* Листи (обрізані по контуру) */}
          <g clipPath="url(#slope-clip)">
            {placements.map(p => {
              const length = p.manual_length ?? p.length;
              const ox = (p.offset_x ?? 0);
              const oy = (p.offset_y ?? 0);
              const x1 = tx(p.x + ox);
              const y1 = ty(oy); // листи починаються знизу
              const w = p.full_width * scale;
              const h = length * scale;
              const color = sheetColor(p);
              const isSelected = selectedSheet === p.sheet_number;

              return (
                <g key={p.sheet_number} onClick={() => openEdit(p)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={x1} y={y1 - h}
                    width={w} height={h}
                    fill={color} fillOpacity={isSelected ? 0.5 : 0.25}
                    stroke={color} strokeWidth={isSelected ? 2 : 1}
                  />
                  {/* Розмір листа */}
                  {h > 20 && (
                    <text
                      x={x1 + w / 2} y={y1 - h / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={COLORS.text} fontSize={Math.max(9, Math.min(13, h / 4))}
                      fontWeight="600"
                    >
                      {(length / 1000).toFixed(3)}
                    </text>
                  )}
                  {/* Номер листа */}
                  {h > 30 && w > 20 && (
                    <text
                      x={x1 + w / 2} y={y1 - h / 2 + 14}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={COLORS.text} fontSize={8} opacity={0.7}
                    >
                      №{p.sheet_number}
                    </text>
                  )}
                  {/* Позначка ручного редагування */}
                  {p.manual_length && (
                    <text x={x1 + 3} y={y1 - h + 10} fill="#dc2626" fontSize={9}>✎</text>
                  )}
                </g>
              );
            })}
          </g>

          {/* Контур ската */}
          <path d={polyPath} fill="none" stroke={COLORS.polygon} strokeWidth="2" />

          {/* Розміри по осі X (ширина) */}
          <line x1={tx(0)} y1={PADDING - 20} x2={tx(W)} y2={PADDING - 20} stroke="#9ca3af" strokeWidth="1" markerEnd="url(#arrow)" />
          <text x={tx(W / 2)} y={PADDING - 28} textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600">
            {(W / 1000).toFixed(2)} м
          </text>

          {/* Розміри по осі Y (висота) */}
          <line x1={PADDING - 20} y1={ty(0)} x2={PADDING - 20} y2={ty(H)} stroke="#9ca3af" strokeWidth="1" />
          <text
            x={PADDING - 35} y={ty(H / 2)}
            textAnchor="middle" fill="#374151" fontSize="11" fontWeight="600"
            transform={`rotate(-90, ${PADDING - 35}, ${ty(H / 2)})`}
          >
            {(H / 1000).toFixed(2)} м
          </text>

          {/* Підписи по X через метр */}
          {Array.from({ length: Math.ceil(W / 1000) + 1 }, (_, i) => i).map(i => (
            <text key={`lx${i}`} x={tx(i * 1000)} y={PADDING + H * scale + 18}
              textAnchor="middle" fill="#6b7280" fontSize="9">
              {i}
            </text>
          ))}

          {/* Підписи по Y через метр */}
          {Array.from({ length: Math.ceil(H / 1000) + 1 }, (_, i) => i).map(i => (
            <text key={`ly${i}`} x={PADDING - 8} y={ty(i * 1000) + 3}
              textAnchor="end" fill="#6b7280" fontSize="9">
              {i}
            </text>
          ))}

          {/* Стрілки */}
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Легенда */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
        <LegendItem color={COLORS.full} label="Повний лист" />
        <LegendItem color={COLORS.cut} label="Обрізаний лист" />
        <LegendItem color={COLORS.waste} label="Великий відхід (>50%)" />
        <span style={{ fontSize: '.75rem', color: '#6b7280', marginLeft: 'auto' }}>
          Клікни на лист для редагування
        </span>
      </div>

      {/* Таблиця довжин */}
      <div style={{ marginTop: '16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: '.85rem' }}>
          Специфікація листів
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left' }}>Довжина</th>
              <th style={{ padding: '8px 12px', textAlign: 'center' }}>Кількість</th>
              <th style={{ padding: '8px 12px', textAlign: 'center' }}>Корисна площа</th>
              <th style={{ padding: '8px 12px', textAlign: 'center' }}>Повна площа</th>
            </tr>
          </thead>
          <tbody>
            {uniqueLengths.map(len => {
              const sheets = placements.filter(p => (p.manual_length ?? p.length) === len);
              const usefulArea = sheets.reduce((s, p) => s + (p.intersect_area_m2 ?? 0), 0);
              const fullArea = sheets.reduce((s, p) => s + (p.full_area_m2 ?? 0), 0);
              return (
                <tr key={len} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{(len / 1000).toFixed(3)} м</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{sheets.length} шт</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{usefulArea.toFixed(3)} м²</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{fullArea.toFixed(3)} м²</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 600, background: '#f9fafb' }}>
              <td style={{ padding: '8px 12px' }}>Всього</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>{placements.length} шт</td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                {placements.reduce((s, p) => s + (p.intersect_area_m2 ?? 0), 0).toFixed(3)} м²
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                {placements.reduce((s, p) => s + (p.full_area_m2 ?? 0), 0).toFixed(3)} м²
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Модальне вікно редагування */}
      {editModal && selectedSheet !== null && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: '12px', padding: '24px',
            width: '380px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 16px' }}>✎ Редагування листа №{selectedSheet}</h3>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                Довжина листа, мм
              </label>
              <input type="number" value={editForm.length}
                onChange={e => setEditForm(f => ({ ...f, length: Number(e.target.value) }))}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '.9rem', boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: '.75rem', color: '#6b7280', marginTop: '4px' }}>
                Стандартна: {(placements.find(p => p.sheet_number === selectedSheet)?.length ?? 0) / 1000} м
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                Зміщення по горизонталі, мм
              </label>
              <input type="number" value={editForm.offset_x}
                onChange={e => setEditForm(f => ({ ...f, offset_x: Number(e.target.value) }))}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '.9rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '.8rem', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                Зміщення по вертикалі, мм
              </label>
              <input type="number" value={editForm.offset_y}
                onChange={e => setEditForm(f => ({ ...f, offset_y: Number(e.target.value) }))}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '.9rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={resetEdit}
                style={{ padding: '8px 16px', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', cursor: 'pointer', background: '#fff' }}>
                Скинути
              </button>
              <button onClick={() => setEditModal(false)}
                style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
                Скасувати
              </button>
              <button onClick={saveEdit}
                style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                Застосувати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.78rem', color: '#374151' }}>
      <div style={{ width: '14px', height: '14px', background: color, opacity: 0.6, borderRadius: '3px', border: `1px solid ${color}` }} />
      {label}
    </div>
  );
}
