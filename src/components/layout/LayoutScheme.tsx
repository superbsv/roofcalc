// ============================================
// ArtBudTrading Roof Calculator
// components/layout/LayoutScheme.tsx
// Логіка за зразком KrovlyaProfy:
// - листи в колонці стикуються, сума = висота полігону
// - зміна довжини листа компенсується сусідом зверху
// - горизонтальний зсув = повна перегенерація
// ============================================

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Point as ApiPoint } from '../../api/client';
import { interiorAngles, fmtAngle } from '../roof/edges';

interface SheetPlacement {
  sheet_number: number;
  col_index: number;
  row_index: number;
  x: number;
  y: number;
  full_width: number;
  useful_width: number;
  lap?: 'left' | 'right';
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
  holes?: Point[][];
  slopeName: string;
  jointY?: number | null;                       // лінія стику рядів, мм
  jointRange?: [number, number] | null;
  onJointChange?: (mm: number) => void;         // зсув лінії стику кнопками ↑/↓
  jointStep?: number;                           // мінімальний крок лінії (хвиля металочерепиці), мм
  shiftX?: number;                              // поточний зсув сітки колонок, мм
  onShiftX?: (mm: number) => void;             // новий зсув сітки колонок (перерахунок на сервері)
  onReset?: () => void;                         // скинути зсув і лінію стику
  splitForced?: boolean;                        // стик додано на вимогу (скат вміщається одним листом)
  onForceSplit?: (on: boolean) => void;         // додати / прибрати стик на вимогу
  onUpdate?: (placements: SheetPlacement[]) => void;
}

// Кольори беруться з теми ABT (CSS-змінні працюють і для SVG-атрибутів)
const COLORS = {
  full:     'var(--clr-sheet)',
  cut:      'var(--clr-sheet-cut)',
  waste:    'var(--clr-sheet-waste)',
  selected: 'var(--clr-brand)',
  polygon:  'var(--clr-polygon)',
  grid:     'var(--clr-grid)',
  text:     'var(--clr-text)',
  bg:       'var(--clr-canvas)',
};

const PADDING = 80;
const SVG_W   = 900;
const SVG_H   = 600;

const STEPS = [
  { label: '0.1м',   mm: 100 },
  { label: '0.01м',  mm: 10  },
  { label: '0.001м', mm: 1   },
];

// ============================================
// Діапазон [minY, maxY] полігону в точці X (мм)
// Повертає null якщо x поза полігоном
// ============================================
function getPolygonRangeAtX(x: number, polygon: Point[]): { minY: number; maxY: number } | null {
  if (!polygon.length) return null;
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
  if (ys.length < 2) return null;
  return { minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// Діапазон покриття колонки (об'єднання по 3 точках)
function getColumnRange(x: number, usefulWidth: number, slopeWidth: number, polygon: Point[]): { minY: number; maxY: number } | null {
  const visLeft  = Math.max(0, x);
  const visRight = Math.min(slopeWidth, x + usefulWidth);
  if (visRight <= visLeft) return null;
  // Межі колонки + усі вершини контуру всередині колонки (вершина/гребінь між краями —
  // саме там найвища чи найнижча точка, інакше лист не дотягується до неї)
  const xs = [visLeft, (visLeft + visRight) / 2, visRight];
  for (const [px] of polygon) if (px > visLeft && px < visRight) xs.push(px);
  const ranges = xs
    .map(sx => getPolygonRangeAtX(sx, polygon))
    .filter((r): r is { minY: number; maxY: number } => r !== null);
  if (!ranges.length) return null;
  return {
    minY: Math.min(...ranges.map(r => r.minY)),
    maxY: Math.max(...ranges.map(r => r.maxY)),
  };
}

// ============================================
// Повна генерація розкладки (як KrovlyaProfy):
// колонки з layoutOffset, в кожній — стек листів знизу вгору,
// нижні = maxLen, верхній обрізаний по колонці
// ============================================
function generateFullLayout(
  layoutOffset: number,
  verticalOffset: number, // зсув сітки рядів по вертикалі (мм)
  slopeWidth: number,
  polygon: Point[],
  usefulWidth: number,
  fullWidth: number,
  maxSheetLength: number,
  eaveOverhang: number,   // карнизний звис (додається знизу)
  ridgeGap: number,       // ковзан (додається зверху)
  rtl: boolean = false,   // укладка справа наліво: колонки від правого краю
): SheetPlacement[] {
  const placements: SheetPlacement[] = [];
  let sheetNum = 1;

  const shiftCols = Math.ceil(Math.abs(layoutOffset) / usefulWidth) + 1;
  const maxCols = Math.ceil(slopeWidth / usefulWidth) + shiftCols + 1;
  const step = maxSheetLength;
  // Зсув сітки рядів у межах одного кроку
  const vMod = ((verticalOffset % step) + step) % step;

  for (let col = -shiftCols; col <= maxCols; col++) {
    const x = rtl ? slopeWidth + layoutOffset - (col + 1) * usefulWidth : layoutOffset + col * usefulWidth;
    if (x >= slopeWidth || x + usefulWidth <= 0) continue;

    const range = getColumnRange(x, usefulWidth, slopeWidth, polygon);
    if (!range) continue;

    const bottomY = range.minY - eaveOverhang;
    const topY    = range.maxY + ridgeGap;
    if (topY - bottomY <= 0) continue;

    // Сітка рядів зсунута на vMod. Перша межа може бути нижче bottomY.
    let boundary = bottomY + vMod - step;
    if (vMod === 0) boundary = bottomY;
    let row = 0;

    while (boundary < topY - 0.5) {
      const sheetBottom = boundary;
      const sheetTop    = boundary + step;
      // Обрізаємо лист по зоні покриття колонки
      const visBottom = Math.max(sheetBottom, bottomY);
      const visTop    = Math.min(sheetTop, topY);
      const visLen    = visTop - visBottom;
      if (visLen > 0.5) {
        placements.push({
          sheet_number: sheetNum++,
          col_index: col, row_index: row++,
          x, y: Math.round(visBottom),
          full_width: fullWidth, useful_width: usefulWidth, lap: rtl ? 'left' : 'right',
          length: Math.max(1, Math.round(visLen)),
        });
      }
      boundary += step;
    }
  }
  return placements;
}

// Оцінка % відходу листа відносно полігону
// Площа перетину прямокутника з многокутником (відсікання Сазерленда–Ходжмена)
function rectPolyArea(x0: number, y0: number, x1: number, y1: number, poly: Point[]): number {
  let out: Point[] = poly.map(p => [p[0], p[1]] as Point);
  const clip = (inside: (p: Point) => boolean, cut: (a: Point, b: Point) => Point) => {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
  };
  const atX = (x: number) => (a: Point, b: Point): Point => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
  const atY = (y: number) => (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
  clip(p => p[0] >= x0, atX(x0)); if (out.length < 3) return 0;
  clip(p => p[0] <= x1, atX(x1)); if (out.length < 3) return 0;
  clip(p => p[1] >= y0, atY(y0)); if (out.length < 3) return 0;
  clip(p => p[1] <= y1, atY(y1)); if (out.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < out.length; i++) { const q = out[(i + 1) % out.length]; a += out[i][0] * q[1] - q[0] * out[i][1]; }
  return Math.abs(a) / 2;
}

// Стан листа за реальним перетином з площиною ската (з урахуванням вирізів).
// Карнизний звис (частина листа нижче краю ската в колонці) обрізкою не вважається.
function sheetState(x: number, y: number, len: number, usefulWidth: number, polygon: Point[], holes: Point[][]): 'full' | 'cut' | 'waste' {
  const ys: number[] = [];
  const n = polygon.length;
  for (const sx of [x + 1, x + usefulWidth / 2, x + usefulWidth - 1]) {
    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n];
      if (a[0] === b[0] || sx < Math.min(a[0], b[0]) || sx > Math.max(a[0], b[0])) continue;
      ys.push(a[1] + (b[1] - a[1]) * (sx - a[0]) / (b[0] - a[0]));
    }
  }
  const bottom = ys.length ? Math.max(y, Math.min(...ys)) : y;
  const top = y + len;
  const rect = usefulWidth * Math.max(0, top - bottom);
  if (rect <= 0) return 'waste';
  let inter = rectPolyArea(x, bottom, x + usefulWidth, top, polygon);
  holes.forEach(h => { if (h.length >= 3) inter -= rectPolyArea(x, bottom, x + usefulWidth, top, h); });
  const k = Math.max(0, inter) / rect;
  if (k < 0.5) return 'waste';
  if (k < 0.985) return 'cut';
  return 'full';
}

export default function LayoutScheme({ calcResult, polygonPoints, holes = [], slopeName, onUpdate, jointY, jointRange, onJointChange, jointStep = 1, shiftX = 0, onShiftX, onReset, splitForced = false, onForceSplit }: Props) {
  const W = calcResult.slope_width_mm;
  const H = calcResult.slope_height_mm;

  const usefulWidth = calcResult.placements[0]?.useful_width ?? 1100;
  const fullWidth   = calcResult.placements[0]?.full_width   ?? 1185;
  const sheetLength = calcResult.sheet_length_mm;
  // Звис і ковзан: беремо з різниці sheet_length та висоти полігону.
  // eaveOverhang виносимо в низ (карниз), ridgeGap — зверху (ковзан).
  const eaveRidgeTotal = Math.max(0, sheetLength - H);
  const eaveOverhang = eaveRidgeTotal; // весь припуск — карнизний звис (як у KrovlyaProfy за замовч.)
  const ridgeGap = 0;
  const rtl = calcResult.placements[0]?.lap === 'left';
  // Ліва межа повного листа: нахлест виходить у бік, протилежний напрямку укладки
  const fullX = (p: SheetPlacement) => p.x + (p.offset_x ?? 0) - (p.lap === 'left' ? p.full_width - p.useful_width : 0);

  const [placements, setPlacements]   = useState<SheetPlacement[]>(() => calcResult.placements.map(p => ({ ...p })));
  const [layoutOffset, setLayoutOffset] = useState(0);
  const [verticalOffset, setVerticalOffset] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [manualMode, setManualMode]   = useState(false);
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  const [zoom, setZoom]               = useState(1);
  const [stepMm, setStepMm]           = useState(100); // крок зміни (як в KrovlyaProfy)

  const [rubberBand, setRubberBand] = useState<{x1:number;y1:number;x2:number;y2:number}|null>(null);
  const svgRef     = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart  = useRef<{x:number;y:number}|null>(null);

  const [panelPos, setPanelPos] = useState({ x: 20, y: 140 });
  const panelDrag = useRef<{startX:number;startY:number;startPX:number;startPY:number}|null>(null);

  useEffect(() => {
    setPlacements(calcResult.placements.map(p => ({ ...p })));
    setLayoutOffset(0);
    setVerticalOffset(0);
    setManualMode(false);
    setSelected(new Set());
  }, [calcResult]);

  // Межі видимої області: скат + усі листи повнорозмірно (листи не обрізаються контуром ската)
  let vx0 = 0, vx1 = W, vy0 = 0, vy1 = H;
  for (const p of placements) {
    if (p.deleted) continue;
    const px = fullX(p), py = p.y + (p.offset_y ?? 0), len = p.manual_length ?? p.length;
    vx0 = Math.min(vx0, px); vx1 = Math.max(vx1, px + p.full_width);
    vy0 = Math.min(vy0, py); vy1 = Math.max(vy1, py + len);
  }
  const VW = Math.max(1, vx1 - vx0), VH = Math.max(1, vy1 - vy0);
  const scale = Math.min((SVG_W - PADDING*2) / VW, (SVG_H - PADDING*2) / VH); // масштаб — через ширину SVG (zoom)
  const tx = (x: number) => PADDING + (x - vx0) * scale;
  const ty = (y: number) => PADDING + (vy1 - y) * scale;
  // Дрібна сітка: 0.1 м, основні лінії — кожен 1 м
  const gridLines: { k: string; x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let gx = Math.ceil(vx0 / 100) * 100; gx <= vx1 + 0.5; gx += 100) {
    gridLines.push({ k: `gx${gx}`, x1: tx(gx), y1: ty(vy1), x2: tx(gx), y2: ty(vy0), major: Math.round(gx) % 1000 === 0 });
  }
  for (let gy = Math.ceil(vy0 / 100) * 100; gy <= vy1 + 0.5; gy += 100) {
    gridLines.push({ k: `gy${gy}`, x1: tx(vx0), y1: ty(gy), x2: tx(vx1), y2: ty(gy), major: Math.round(gy) % 1000 === 0 });
  }

  const polyPath = polygonPoints.length >= 3
    ? polygonPoints.map((p, i) => `${i===0?'M':'L'} ${tx(p[0])} ${ty(p[1])}`).join(' ') + ' Z'
    : `M ${tx(0)} ${ty(0)} L ${tx(W)} ${ty(0)} L ${tx(W)} ${ty(H)} L ${tx(0)} ${ty(H)} Z`;

  const visiblePlacements = placements.filter(p => !p.deleted);
  const hasSelection = selected.size > 0;

  const getLen = (p: SheetPlacement) => p.manual_length ?? p.length;
  const getY   = (p: SheetPlacement) => p.y + (p.offset_y ?? 0);
  const getX   = (p: SheetPlacement) => p.x + (p.offset_x ?? 0);

  // ============================================
  // Горизонтальний зсув — повна перегенерація
  // ============================================
  const shiftLayout = useCallback((deltaMm: number) => {
    if (onShiftX) { onShiftX(shiftX + deltaMm); return; } // сітка колонок рахується на сервері
    const newOffset = layoutOffset + deltaMm;
    setLayoutOffset(newOffset);
    setManualMode(true);
    if (polygonPoints.length >= 3) {
      const np = generateFullLayout(newOffset, verticalOffset, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl);
      setPlacements(np);
      onUpdate?.(np);
    }
    setSelected(new Set());
  }, [layoutOffset, verticalOffset, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl, onUpdate, onShiftX, shiftX]);

  // Вертикальний зсув розкладки — перегенерація з обрізкою/додаванням листів
  const shiftVerticalLayout = useCallback((deltaMm: number) => {
    // Одна лінія стику на весь скат: ↑/↓ рухають її (для металочерепиці — щонайменше на крок хвилі)
    if (onJointChange) {
      if (jointY != null) onJointChange(jointY + Math.sign(deltaMm) * Math.max(Math.abs(deltaMm), jointStep));
      return;
    }
    const newV = verticalOffset + deltaMm;
    setVerticalOffset(newV);
    setManualMode(true);
    if (polygonPoints.length >= 3) {
      const np = generateFullLayout(layoutOffset, newV, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl);
      setPlacements(np);
      onUpdate?.(np);
    }
    setSelected(new Set());
  }, [verticalOffset, layoutOffset, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl, onUpdate, onJointChange, jointY, jointStep]);

  // ============================================
  // Зміна довжини виділеного листа з КОМПЕНСАЦІЄЮ
  // сусіда зверху в тій же колонці (стик рухається).
  // Якщо сусіда нема — просто змінюємо довжину.
  // ============================================
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const changeLengthWithJoint = useCallback((deltaMm: number) => {
    setManualMode(true);
    setPlacements(prev => {
      const next = prev.map(p => ({ ...p }));
      const byNum = new Map(next.map(p => [p.sheet_number, p]));

      selected.forEach(num => {
        const p = byNum.get(num);
        if (!p || p.deleted) return;

        const curLen = p.manual_length ?? p.length;
        const newLen = Math.max(50, curLen + deltaMm);
        const actualDelta = newLen - curLen;
        if (actualDelta === 0) return;

        // Сусід зверху: та ж колонка, row_index + 1, стик y = p.y + curLen
        const above = next.find(q =>
          !q.deleted &&
          q.sheet_number !== p.sheet_number &&
          q.col_index === p.col_index &&
          q.row_index === p.row_index + 1
        );

        p.manual_length = newLen;

        if (above) {
          const aboveLen = above.manual_length ?? above.length;
          const newAboveLen = aboveLen - actualDelta;
          if (newAboveLen >= 50) {
            above.manual_length = newAboveLen;
            above.y = above.y + actualDelta; // стик рухається
          } else {
            // Сусід зникає, якщо довжина стала занадто малою
            above.deleted = true;
          }
        }
      });

      onUpdate?.(next.filter(p => !p.deleted));
      return next;
    });
  }, [selected, onUpdate]);

  // Змінити довжину виділених листів ЗВЕРХУ (верхній край рухається)
  const changeLengthTop = useCallback((deltaMm: number) => {
    setManualMode(true);
    setPlacements(prev => {
      const next = prev.map(p => ({ ...p }));
      selected.forEach(num => {
        const p = next.find(q => q.sheet_number === num);
        if (!p || p.deleted) return;
        const curLen = p.manual_length ?? p.length;
        const newLen = Math.max(50, curLen + deltaMm);
        p.manual_length = newLen;
        // Сусід зверху компенсує (стик рухається)
        const above = next.find(q => !q.deleted && q.sheet_number !== p.sheet_number &&
          q.col_index === p.col_index && q.row_index === p.row_index + 1);
        if (above) {
          const aLen = above.manual_length ?? above.length;
          const naLen = aLen - (newLen - curLen);
          if (naLen >= 50) { above.manual_length = naLen; above.y = above.y + (newLen - curLen); }
          else above.deleted = true;
        }
      });
      onUpdate?.(next.filter(p => !p.deleted));
      return next;
    });
  }, [selected, onUpdate]);

  // Змінити довжину виділених листів ЗНИЗУ (нижній край рухається)
  const changeLengthBottom = useCallback((deltaMm: number) => {
    setManualMode(true);
    setPlacements(prev => {
      const next = prev.map(p => ({ ...p }));
      selected.forEach(num => {
        const p = next.find(q => q.sheet_number === num);
        if (!p || p.deleted) return;
        const curLen = p.manual_length ?? p.length;
        const newLen = Math.max(50, curLen + deltaMm);
        const actualDelta = newLen - curLen;
        p.manual_length = newLen;
        p.offset_y = (p.offset_y ?? 0) - actualDelta; // низ рухається вниз
        // Сусід знизу компенсує
        const below = next.find(q => !q.deleted && q.sheet_number !== p.sheet_number &&
          q.col_index === p.col_index && q.row_index === p.row_index - 1);
        if (below) {
          const bLen = below.manual_length ?? below.length;
          const nbLen = bLen - actualDelta;
          if (nbLen >= 50) below.manual_length = nbLen;
          else below.deleted = true;
        }
      });
      onUpdate?.(next.filter(p => !p.deleted));
      return next;
    });
  }, [selected, onUpdate]);

  // ============================================
  // Вертикальний зсув виділених (переміщення стику знизу):
  // рухає y листа, компенсує довжину листа ЗНИЗУ
  // ============================================
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const moveJointVertical = useCallback((deltaMm: number) => {
    setManualMode(true);
    setPlacements(prev => {
      const next = prev.map(p => ({ ...p }));

      selected.forEach(num => {
        const p = next.find(q => q.sheet_number === num);
        if (!p || p.deleted) return;

        const below = next.find(q =>
          !q.deleted &&
          q.sheet_number !== p.sheet_number &&
          q.col_index === p.col_index &&
          q.row_index === p.row_index - 1
        );

        const curLen = p.manual_length ?? p.length;

        if (below) {
          // Стик рухається: низ p йде вгору/вниз, довжина p компенсує, довжина below теж
          const belowLen = below.manual_length ?? below.length;
          const newBelowLen = belowLen + deltaMm;
          const newPLen = curLen - deltaMm;
          if (newBelowLen >= 50 && newPLen >= 50) {
            below.manual_length = newBelowLen;
            p.y = p.y + deltaMm;
            p.manual_length = newPLen;
          }
        } else {
          // Немає сусіда знизу — просто рухаємо лист
          p.offset_y = (p.offset_y ?? 0) + deltaMm;
        }
      });

      onUpdate?.(next.filter(p => !p.deleted));
      return next;
    });
  }, [selected, onUpdate]);

  const deleteSelected = () => {
    setPlacements(prev => {
      const updated = prev.map(p => selected.has(p.sheet_number) ? { ...p, deleted: true } : p);
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
    setSelected(new Set());
  };

  const resetAll = () => {
    onReset?.();
    setLayoutOffset(0);
    setVerticalOffset(0);
    setManualMode(false);
    const orig = calcResult.placements.map(p => ({ ...p }));
    setPlacements(orig);
    onUpdate?.(orig);
    setSelected(new Set());
  };

  // ---- Колір листа (завжди з полігону, синхронно з правками) ----
  const sheetColor = (p: SheetPlacement, isSel: boolean): string => {
    if (isSel) return COLORS.selected;
    if (polygonPoints.length >= 3) {
      const st = sheetState(getX(p), getY(p), getLen(p), p.useful_width, polygonPoints, holes);
      return st === 'waste' ? COLORS.waste : st === 'cut' ? COLORS.cut : COLORS.full;
    }
    // Fallback на дані PHP якщо полігону нема
    if (p.intersect_area_m2 !== undefined && p.full_area_m2 !== undefined) {
      const wastePct = (p.waste_area_m2??0) / (p.full_area_m2??1) * 100;
      if (wastePct > 50) return COLORS.waste;
      if (p.intersect_area_m2 < p.full_area_m2 * 0.95) return COLORS.cut;
    }
    return COLORS.full;
  };

  // ---- SVG події ----
  const getSvgPoint = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const f = SVG_W / rect.width;
    return { x: (e.clientX - rect.left)*f, y: (e.clientY - rect.top)*f };
  };

  const svgToMm = (svgX: number, svgY: number) => ({
    wx: vx0 + (svgX - PADDING) / scale,
    wy: vy1 - (svgY - PADDING) / scale,
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
        const len = getLen(p), py = getY(p), px = fullX(p);
        return px < maxX && px + p.full_width > minX && py < maxY && py + len > minY;
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
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'INPUT') return;
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

  const uniqueLengths = useMemo(
    () => Array.from(new Set(visiblePlacements.map(p => getLen(p)))).sort((a,b)=>a-b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements]
  );

  return (
    <div style={{ fontFamily:'system-ui, sans-serif', position:'relative' }}>

      {/* Заголовок */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h3 style={{ margin:0, fontSize:'1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize:'.8rem', color:'var(--clr-text-3)', marginTop:'2px' }}>
            {calcResult.profile_name} · {visiblePlacements.length} листів · {calcResult.slope_area_m2.toFixed(2)} м²
            {jointY != null && <span> · Лінія стику: <b style={{ color:'var(--clr-text)' }}>{(jointY/1000).toFixed(3)} м</b>{jointRange ? ` (можна ${(jointRange[0]/1000).toFixed(3)}–${(jointRange[1]/1000).toFixed(3)})` : ''}</span>}
            {(onShiftX ? shiftX : layoutOffset) !== 0 && <span style={{ color:'var(--clr-brand)' }}> · Зсув: {(onShiftX ? shiftX : layoutOffset)>0?'+':''}{onShiftX ? shiftX : layoutOffset} мм</span>}
            {hasSelection && <span style={{ color:COLORS.selected, fontWeight:600 }}> · Виділено: {selected.size} шт</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={selectAll} style={{ padding:'6px 12px', background:COLORS.selected, color:'var(--clr-on-brand)', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600, fontSize:'.82rem' }}>☑ Виділити всі</button>
          {hasSelection && <button onClick={()=>setSelected(new Set())} style={{ padding:'6px 12px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.82rem' }}>✕ Зняти</button>}
          <button onClick={()=>setZoom(z=>Math.max(0.3,z-0.1))} style={zoomBtn}>−</button>
          <span style={{ fontSize:'.85rem', minWidth:'40px', textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>Math.min(3,z+0.1))} style={zoomBtn}>+</button>
          <button onClick={()=>setZoom(1)} style={zoomBtn}>⟳</button>
          <button onClick={resetAll} style={{ ...zoomBtn, color:'var(--clr-error)', borderColor:'var(--clr-error)' }}>↩ Скинути</button>
        </div>
      </div>

      <div style={{ fontSize:'.8rem', color:'var(--clr-text-3)', marginBottom:'8px' }}>
        💡 Клік — виділити лист · Shift+клік — додати · Тягни мишу — виділити область
      </div>

      {/* Панель зсуву всієї розкладки */}
      <div style={{ background:'var(--clr-surface)', border:'1px solid var(--clr-border)', borderRadius:'8px', padding:'10px 14px', marginBottom:'8px', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'.82rem', fontWeight:600, color:'var(--clr-text-2)', whiteSpace:'nowrap' }}>По горизонталі:</span>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {STEPS.map(s => (
              <React.Fragment key={s.mm}>
                <button onClick={()=>shiftLayout(-s.mm)} style={shiftBtn}>← {s.label}</button>
                <button onClick={()=>shiftLayout(+s.mm)} style={shiftBtn}>→ {s.label}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'.82rem', fontWeight:600, color:'var(--clr-text-2)', whiteSpace:'nowrap' }}
            title={onJointChange ? 'Рухає лінію стику рядів — усі листи ската діляться по ній' : undefined}>
            {onJointChange ? 'Лінія стику:' : 'По вертикалі:'}</span>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {onJointChange && jointY == null && <>
              <span style={{ fontSize:'.78rem', color:'var(--clr-text-3)', alignSelf:'center' }}>скат в один ряд</span>
              {onForceSplit && <button onClick={() => onForceSplit(true)} style={{ ...shiftBtn, borderColor:'var(--clr-brand)', color:'var(--clr-brand)', fontWeight:700 }}
                title="Розділити всі листи ската однією лінією (коротші листи)">＋ Додати стик</button>}
            </>}
            {!(onJointChange && jointY == null) && STEPS.map(s => (
              <React.Fragment key={s.mm}>
                <button onClick={()=>shiftVerticalLayout(-s.mm)} style={shiftBtn}>↓ {s.label}</button>
                <button onClick={()=>shiftVerticalLayout(+s.mm)} style={shiftBtn}>↑ {s.label}</button>
              </React.Fragment>
            ))}
            {splitForced && onForceSplit && jointY != null && (
              <button onClick={() => onForceSplit(false)} style={{ ...shiftBtn, color:'var(--clr-error)', borderColor:'var(--clr-error)' }}
                title="Повернути укладку одним листом на всю довжину">✕ Прибрати стик</button>
            )}
          </div>
        </div>
      </div>

      {/* SVG */}
      <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:'75vh', border:'1px solid var(--clr-border)', borderRadius:'8px', background:COLORS.bg }}>
        <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          style={{ display:'block', width:`${zoom*100}%`, height:'auto' }}
          onMouseDown={onSvgMouseDown} onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onClick={onSvgClick}>
          <rect width={SVG_W} height={SVG_H} fill={COLORS.bg}/>
          {gridLines.map(g => (
            <line key={g.k} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke={g.major ? 'var(--clr-grid-major)' : 'var(--clr-grid)'} strokeWidth={g.major ? 0.8 : 0.4}/>
          ))}
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--clr-text-3)"/>
            </marker>
          </defs>

          <g>
            {visiblePlacements.map(p => {
              const length = getLen(p);
              const py     = getY(p);
              const isSel  = selected.has(p.sheet_number);
              const x1 = tx(fullX(p));
              const y1 = ty(py);
              const w  = p.full_width * scale;
              const h  = length * scale;
              const color = sheetColor(p, isSel);
              return (
                <g key={p.sheet_number} onClick={e=>handleSheetClick(e,p.sheet_number)} style={{cursor:'pointer'}}>
                  <rect x={x1} y={y1-h} width={w} height={h}
                    fill={color} fillOpacity={isSel?0.5:0.35}
                    stroke={color} strokeWidth={isSel?2.5:1}/>
                  {h>20 && <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle"
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={Math.max(9,Math.min(13,h/4))} fontWeight="600">
                    {(length/1000).toFixed(3)}
                  </text>}
                  {h>30 && w>20 && <text x={x1+w/2} y={y1-h/2+14} textAnchor="middle" dominantBaseline="middle"
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={8} opacity={0.7}>
                    №{p.sheet_number}
                  </text>}
                  {p.manual_length && <text x={x1+3} y={y1-h+10} fill="#FF7A1A" fontSize={9}>✎</text>}
                </g>
              );
            })}
          </g>

          <path d={polyPath} fill="none" stroke={COLORS.polygon} strokeWidth="2"/>
          {/* Внутрішні кути площини */}
          {polygonPoints.length >= 3 && interiorAngles(polygonPoints).map((a, i) => {
            if (Math.abs(a.deg - 180) < 0.05) return null;
            const cx = tx(polygonPoints[i][0]), cy = ty(polygonPoints[i][1]);
            const r = 18, e = a.start + a.sweep;
            const x1 = cx + Math.cos(a.start) * r, y1 = cy - Math.sin(a.start) * r;
            const x2 = cx + Math.cos(e) * r, y2 = cy - Math.sin(e) * r;
            const b = a.start + a.sweep / 2;
            const lx = cx + Math.cos(b) * 38, ly = cy - Math.sin(b) * 38;
            return (
              <g key={`ang${i}`} pointerEvents="none">
                <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${a.sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`} fill="none" stroke="var(--clr-brand)" strokeWidth="1.2" />
                <text x={lx} y={ly + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--clr-brand)"
                  stroke="var(--clr-canvas)" strokeWidth="3" style={{ paintOrder: 'stroke' }}>{fmtAngle(a.deg)}</text>
              </g>
            );
          })}

          {rubberBand && (
            <rect x={rubberBand.x1} y={rubberBand.y1} width={rubberBand.x2-rubberBand.x1} height={rubberBand.y2-rubberBand.y1}
              fill="rgba(255,122,0,0.1)" stroke={COLORS.selected} strokeWidth="1" strokeDasharray="4 2"/>
          )}

          <line x1={tx(0)} y1={PADDING-20} x2={tx(W)} y2={PADDING-20} stroke="var(--clr-text-3)" strokeWidth="1" markerEnd="url(#arrow)"/>
          <text x={tx(W/2)} y={PADDING-28} textAnchor="middle" fill="var(--clr-text-2)" fontSize="11" fontWeight="600">{(W/1000).toFixed(2)} м</text>
          <line x1={tx(vx0)-20} y1={ty(0)} x2={tx(vx0)-20} y2={ty(H)} stroke="var(--clr-text-3)" strokeWidth="1"/>
          <text x={tx(vx0)-35} y={ty(H/2)} textAnchor="middle" fill="var(--clr-text-2)" fontSize="11" fontWeight="600"
            transform={`rotate(-90,${tx(vx0)-35},${ty(H/2)})`}>{(H/1000).toFixed(2)} м</text>
          {Array.from({length:Math.ceil(W/1000)+1},(_,i)=>i).map(i=>(
            <text key={`lx${i}`} x={tx(i*1000)} y={ty(vy0)+18} textAnchor="middle" fill="var(--clr-text-3)" fontSize="9">{i}</text>
          ))}
          {Array.from({length:Math.ceil(H/1000)+1},(_,i)=>i).map(i=>(
            <text key={`ly${i}`} x={tx(vx0)-8} y={ty(i*1000)+3} textAnchor="end" fill="var(--clr-text-3)" fontSize="9">{i}</text>
          ))}
        </svg>
      </div>

      {/* Легенда */}
      <div style={{ display:'flex', gap:'16px', marginTop:'12px', flexWrap:'wrap' }}>
        <LegendItem color={COLORS.full}     label="Повний лист"/>
        <LegendItem color={COLORS.cut}      label="Обрізаний лист"/>
        <LegendItem color={COLORS.waste}    label="Великий відхід (>50%)"/>
        <LegendItem color={COLORS.selected} label="Виділений лист"/>
      </div>

      {/* Таблиця */}
      <div style={{ marginTop:'16px', background:'var(--clr-surface)', border:'1px solid var(--clr-border)', borderRadius:'8px', overflow:'hidden' }}>
        <div style={{ padding:'10px 16px', background:'var(--clr-surface-2)', borderBottom:'1px solid var(--clr-border)', fontWeight:600, fontSize:'.85rem' }}>
          Специфікація листів
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.85rem' }}>
          <thead>
            <tr style={{ background:'var(--clr-surface-2)' }}>
              <th style={{ padding:'8px 12px', textAlign:'left' }}>Довжина</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Кількість</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Корисна площа</th>
              <th style={{ padding:'8px 12px', textAlign:'center' }}>Повна площа</th>
            </tr>
          </thead>
          <tbody>
            {uniqueLengths.map(len => {
              const sheets = visiblePlacements.filter(p=>getLen(p)===len);
              return (
                <tr key={len} style={{ borderTop:'1px solid var(--clr-border)' }}>
                  <td style={{ padding:'8px 12px', fontWeight:500 }}>{(len/1000).toFixed(3)} м</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.length} шт</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.reduce((s,p)=>s+(p.intersect_area_m2??0),0).toFixed(3)} м²</td>
                  <td style={{ padding:'8px 12px', textAlign:'center' }}>{sheets.reduce((s,p)=>s+(p.full_area_m2??0),0).toFixed(3)} м²</td>
                </tr>
              );
            })}
            <tr style={{ borderTop:'1px solid var(--clr-border-dark)', fontWeight:600, background:'var(--clr-surface-2)' }}>
              <td style={{ padding:'8px 12px' }}>Всього</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.length} шт</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.reduce((s,p)=>s+(p.intersect_area_m2??0),0).toFixed(3)} м²</td>
              <td style={{ padding:'8px 12px', textAlign:'center' }}>{visiblePlacements.reduce((s,p)=>s+(p.full_area_m2??0),0).toFixed(3)} м²</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ===== ПЛАВАЮЧА ПАНЕЛЬ (стиль KrovlyaProfy) ===== */}
      {hasSelection && (
        <div onMouseDown={onPanelMouseDown}
          style={{ position:'fixed', left:panelPos.x, top:panelPos.y, zIndex:500,
            background:'var(--clr-surface)', color:'var(--clr-text)', border:`2px solid ${COLORS.selected}`, borderRadius:'10px',
            boxShadow:'0 8px 32px rgba(0,0,0,0.6)', width:'250px', userSelect:'none' }}>
          <div style={{ background:COLORS.selected, color:'var(--clr-on-brand)', padding:'7px 12px', borderRadius:'8px 8px 0 0',
            cursor:'move', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontWeight:600, fontSize:'.82rem' }}>✏ Виділено: {selected.size} шт</span>
            <button onClick={()=>setSelected(new Set())}
              style={{ background:'none', border:'none', color:'var(--clr-on-brand)', cursor:'pointer', fontSize:'1rem', lineHeight:1 }}>✕</button>
          </div>
          <div style={{ padding:'12px' }}>

            {/* Крок зміни (мм) */}
            <div style={{ marginBottom:'12px' }}>
              <div style={{ fontSize:'.72rem', fontWeight:600, color:'var(--clr-text-3)', marginBottom:'4px' }}>
                Крок зміни, мм:
              </div>
              <div style={{ display:'flex', gap:'4px' }}>
                <input type="number" value={stepMm} min={1} max={1000}
                  onChange={e => setStepMm(Math.max(1, Number(e.target.value) || 1))}
                  style={{ flex:1, padding:'5px 8px', border:'1px solid var(--clr-border-dark)', background:'var(--abt-black)', color:'var(--clr-text)', borderRadius:'6px', fontSize:'.85rem', textAlign:'center' }}/>
                {[1, 10, 100].map(v => (
                  <button key={v} onClick={()=>setStepMm(v)}
                    style={{ padding:'4px 8px', border: stepMm===v ? `1.5px solid ${COLORS.selected}` : '1px solid var(--clr-border-dark)',
                      borderRadius:'6px', cursor:'pointer', background: stepMm===v ? 'var(--clr-brand-pale)' : 'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.75rem' }}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Довжина ЗВЕРХУ */}
            <div style={{ marginBottom:'10px' }}>
              <div style={{ fontSize:'.72rem', fontWeight:600, color:'var(--clr-text-3)', marginBottom:'4px' }}>
                ⬆ Довжина зверху (верхній край):
              </div>
              <div style={{ display:'flex', gap:'4px' }}>
                <button onClick={()=>changeLengthTop(-stepMm)} style={lenBtn}>− {stepMm}мм</button>
                <button onClick={()=>changeLengthTop(+stepMm)} style={lenBtn}>+ {stepMm}мм</button>
              </div>
            </div>

            {/* Довжина ЗНИЗУ */}
            <div style={{ marginBottom:'12px' }}>
              <div style={{ fontSize:'.72rem', fontWeight:600, color:'var(--clr-text-3)', marginBottom:'4px' }}>
                ⬇ Довжина знизу (нижній край):
              </div>
              <div style={{ display:'flex', gap:'4px' }}>
                <button onClick={()=>changeLengthBottom(-stepMm)} style={lenBtn}>− {stepMm}мм</button>
                <button onClick={()=>changeLengthBottom(+stepMm)} style={lenBtn}>+ {stepMm}мм</button>
              </div>
              <div style={{ fontSize:'.68rem', color:'var(--clr-text-3)', marginTop:'3px' }}>
                Сусідній лист компенсує зміну (стик рухається)
              </div>
            </div>

            {/* Дії */}
            <div style={{ display:'flex', gap:'6px', borderTop:'1px solid var(--clr-border)', paddingTop:'10px' }}>
              <button onClick={deleteSelected}
                style={{ flex:1, padding:'8px', border:'1px solid var(--clr-error)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-error-bg)', color:'var(--clr-error)', fontSize:'.82rem', fontWeight:500 }}>
                🗑 Видалити
              </button>
              <button onClick={resetAll}
                style={{ flex:1, padding:'8px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.82rem' }}>
                ↩ Скинути все
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const zoomBtn: React.CSSProperties  = { padding:'4px 10px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)' };
const shiftBtn: React.CSSProperties = { padding:'5px 10px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', fontSize:'.78rem', fontWeight:500, color:'var(--clr-text)' };
const lenBtn: React.CSSProperties   = { flex:1, padding:'7px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)', fontWeight:600, fontSize:'.82rem' };

function LegendItem({ color, label }: { color:string; label:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.78rem', color:'var(--clr-text-2)' }}>
      <div style={{ width:'14px', height:'14px', background:color, opacity:0.6, borderRadius:'3px', border:`1px solid ${color}` }}/>
      {label}
    </div>
  );
}
