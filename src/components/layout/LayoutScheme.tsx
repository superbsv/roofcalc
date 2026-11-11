// ============================================
// ArtBudTrading Roof Calculator
// components/layout/LayoutScheme.tsx
// Логіка за зразком KrovlyaProfy:
// - листи в колонці стикуються, сума = висота полігону
// - зміна довжини листа компенсується сусідом зверху
// - горизонтальний зсув = повна перегенерація
// ============================================

import React, { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Point as ApiPoint } from '../../api/client';
import { HoldBtn, STEPS } from './HoldBtn';

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
  tech_err?: string;
  split_n?: number;            // лист, отриманий розділенням листа col:row (ключ «col:row+n»)
  orient?: 'h';                // сайдинг: панель лежить горизонтально (x — уздовж стіни, y — низ ряду)
}

type Point = ApiPoint;
const sheetKey = (p: { col_index: number; row_index: number; split_n?: number }) => `${p.col_index}:${p.row_index}${p.split_n ? `+${p.split_n}` : ''}`;
type TechCfg = { step_mm: number; origin_mm: number; zones_mm: [number, number][]; gap_mm: number; tolerance_mm: number };

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
  tech?: TechCfg;
}

// Технологічна перевірка поперечного різу (дзеркало MetalTileProfile на сервері — миттєво при правці стрілками)
function stampErr(len: number, t?: TechCfg): string | null {
  if (!t || !t.zones_mm?.length) return null;
  const r = (((len - t.origin_mm) % t.step_mm) + t.step_mm) % t.step_mm;
  if (t.zones_mm.some(([a, b]) => r >= a + (t.tolerance_mm || 0) && r <= b - (t.tolerance_mm || 0))) return null;
  return `рез за ${Math.min(r, t.step_mm - r)} мм від лінії штампа`; // i18n-ignore (tpl «рез за {0} мм від лінії штампа»)
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
  splitForced?: boolean;                        // (застаріле) стик на вимогу
  rowsDiv?: number;                             // ⇕ висота ряду: Lmax станд. ÷ rowsDiv (0/1 — авто)
  rowLen?: number;                              // фактична висота ряду, мм
  onRowsDiv?: (d: number) => void;              // ⇕ коротший / довший ряд
  vShift?: number;                              // зсув листів по вертикалі (один ряд), мм
  onVShift?: (mm: number) => void;              // ↑/↓ без стику: рухають усі листи вгору/вниз (як у КП)
  waveStep?: number;                            // крок хвилі — для ліній хвиль на листах
  onForceSplit?: (on: boolean) => void;         // додати / прибрати стик на вимогу
  onUpdate?: (placements: SheetPlacement[]) => void;
  sheetEdits?: Record<string, { len?: number; y?: number; del?: boolean }> | null; // збережені ручні правки
  onEdits?: (edits: Record<string, { len?: number; y?: number; del?: boolean }>) => void; // зберегти правки (на сервер)
  shiftPanelTarget?: HTMLElement | null;   // куди винести панель зсувів (бічна панель «Укладки»)
  overlay?: React.ReactNode;               // підписи під кресленням (розміри сторін)
  onOptimize?: () => void;                 // підібрати укладку з найменшою витратою
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

export default function LayoutScheme({ calcResult, polygonPoints: rawPolygon, holes: rawHoles = [], slopeName, onUpdate, jointY, jointRange, onJointChange, jointStep = 1, shiftX = 0, onShiftX, onReset, splitForced = false, onForceSplit, rowsDiv = 0, rowLen = 0, onRowsDiv, vShift = 0, onVShift, waveStep = 0, sheetEdits, onEdits, shiftPanelTarget, overlay, onOptimize }: Props) {
  // Горизонтальний сайдинг: уся логіка працює в системі движка (x ↔ y), а схема показується повернутою
  const horiz = (calcResult as any).orientation === 'h';
  const polygonPoints = useMemo(() => horiz ? rawPolygon.map(([a, b]) => [b, a] as Point) : rawPolygon, [horiz, rawPolygon]);
  const holes = useMemo(() => horiz ? rawHoles.map(h => h.map(([a, b]) => [b, a] as Point)) : rawHoles, [horiz, rawHoles]);
  const CW = horiz ? SVG_H : SVG_W, CH = horiz ? SVG_W : SVG_H;   // «віртуальне» полотно до повороту
  // підпис, що не перевертається разом зі схемою
  const tt = (x: number, y: number, extra?: string) => horiz ? `matrix(0,-1,-1,0,${x + y},${x + y})` : extra;
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
  const rectOf = (p: SheetPlacement, len: number) => ({ x: fullX(p), y: p.y + (p.offset_y ?? 0), w: p.full_width, h: len });

  const [placements, setPlacements]   = useState<SheetPlacement[]>(() => calcResult.placements.map(p => ({ ...p })));
  const [layoutOffset, setLayoutOffset] = useState(0);
  const [verticalOffset, setVerticalOffset] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [manualMode, setManualMode]   = useState(false);
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  // Масштаб зберігається між перерахунками (схема перемальовується після кожного зсуву);
  // спочатку — «вписати у висоту екрана», щоб схема не виходила за межі вікна
  const [zoom, setZoomState]          = useState<number>(() => savedZoom ?? 1);
  const setZoom = (f: number | ((z: number) => number)) => setZoomState(z => { const n = typeof f === 'function' ? f(z) : f; savedZoom = n; return n; });
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (savedZoom != null || !boxRef.current) return;
    const w = boxRef.current.clientWidth || 900;
    const fit = (window.innerHeight * 0.6) / (w * SVG_H / SVG_W);
    const z = Math.max(0.3, Math.min(1, Math.floor(fit * 20) / 20));
    savedZoom = z; setZoomState(z);
  }, []);

  const [rubberBand, setRubberBand] = useState<{x1:number;y1:number;x2:number;y2:number}|null>(null);
  const svgRef     = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const dragStart  = useRef<{x:number;y:number}|null>(null);

  const [panelPos, setPanelPos] = useState({ x: 20, y: 140 });
  const panelDrag = useRef<{startX:number;startY:number;startPX:number;startPY:number}|null>(null);

  // ---- Збереження ручних правок листів (щоб не губились при переході на інший скат) ----
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editsRef = useRef(sheetEdits); editsRef.current = sheetEdits;
  const markDirty = () => { dirty.current = true; };

  // Підписи довжин на схемі (як «Вид» у КП): горизонтально / вертикально / сховати — запам'ятовується в браузері
  const [labels, setLabels] = useState<'h' | 'v' | 'off'>(() => {
    try { const v = localStorage.getItem('rk_ls_labels'); return v === 'v' || v === 'off' ? v : 'h'; } catch { return 'h'; }
  });
  const cycleLabels = () => setLabels(l => {
    const n = l === 'h' ? 'v' : l === 'v' ? 'off' : 'h';
    try { localStorage.setItem('rk_ls_labels', n); } catch { /* приватний режим */ }
    return n;
  });

  // ---- Відміна ручних правок (до 9 кроків, як у КП). Утримання кнопки — один крок ----
  const placementsRef = useRef(placements); placementsRef.current = placements;
  const history = useRef<SheetPlacement[][]>([]);
  const lastSnap = useRef(0);
  const [histLen, setHistLen] = useState(0);
  const snap = () => {
    const now = Date.now();
    if (now - lastSnap.current > 700) {
      history.current.push(placementsRef.current.map(p => ({ ...p })));
      if (history.current.length > 9) history.current.shift();
      setHistLen(history.current.length);
    }
    lastSnap.current = now;
  };
  const undo = () => {
    const prev = history.current.pop();
    setHistLen(history.current.length);
    if (!prev) return;
    markDirty();
    setManualMode(true);
    setPlacements(prev);
    onUpdate?.(prev.filter(p => !p.deleted));
  };
  useEffect(() => { history.current = []; setHistLen(0); }, [slopeName]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.code === 'KeyZ' || e.key.toLowerCase() === 'z')) {
        const t = e.target as HTMLElement | null;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (!history.current.length) return;
        e.preventDefault(); undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty.current || !onEdits) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const base = new Map(calcResult.placements.map(p => [sheetKey(p), p]));
      const map: Record<string, { len?: number; y?: number; del?: boolean }> = { ...(editsRef.current || {}) };
      placements.forEach(p => {
        const k = sheetKey(p), b = base.get(k);
        if (p.deleted) { map[k] = { del: true }; return; }
        const len = Math.round(p.manual_length ?? p.length), y = Math.round(p.y + (p.offset_y ?? 0));
        if (!b || len !== Math.round(b.length) || y !== Math.round(b.y)) map[k] = { len, y };
      });
      dirty.current = false;
      onEdits(map);
    }, 500);
  }, [placements]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  useEffect(() => {
    if (dirty.current) return;              // поки є незбережені правки — не перезаписуємо їх
    setPlacements(calcResult.placements.map(p => ({ ...p })));
    setLayoutOffset(0);
    setVerticalOffset(0);
    setManualMode(false);
    setSelected(sel => new Set(Array.from(sel).filter(n => calcResult.placements.some(p => p.sheet_number === n))));
  }, [calcResult]);

  // Рамка схеми залежить лише від контуру ската (з постійним запасом під листи) — при зсувах ←/→ ↑/↓
  // рамка і масштаб стоять на місці, рухаються тільки листи
  const vx0 = -Math.round(fullWidth * 1.2), vx1 = W + Math.round(fullWidth * 1.2), vy0 = -800, vy1 = H + 800;
  const VW = Math.max(1, vx1 - vx0), VH = Math.max(1, vy1 - vy0);
  const scale = Math.min((CW - PADDING*2) / VW, (CH - PADDING*2) / VH); // масштаб — через ширину SVG (zoom)
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
  // Лінії штампа (від низу листа: початок модуля + k × крок) і дозволені зони різу біля верхнього краю виділеного листа
  const tech = calcResult.tech;
  const stStep = tech?.step_mm || waveStep;
  const stOrg = tech?.origin_mm || 0;
  const stamps = (len: number) => {
    const out: number[] = [];
    if (stStep <= 0) return out;
    for (let v = stOrg > 0 ? stOrg : stStep; v < len && out.length < 200; v += stStep) out.push(v);
    return out;
  };
  const zoneBands = (len: number) => {
    const out: [number, number][] = [];
    if (!tech) return out;
    const k0 = Math.floor((len - tech.origin_mm) / tech.step_mm);
    for (let k = k0 - 1; k <= k0; k++) for (const [a, b] of tech.zones_mm) {
      const lo = tech.origin_mm + k * tech.step_mm + a, hi = Math.min(len, tech.origin_mm + k * tech.step_mm + b);
      if (hi > lo && lo >= 0) out.push([lo, hi]);
    }
    return out;
  };
  const hasSelection = selected.size > 0;

  const getLen = (p: SheetPlacement) => p.manual_length ?? p.length;
  const getY   = (p: SheetPlacement) => p.y + (p.offset_y ?? 0);
  const getX   = (p: SheetPlacement) => p.x + (p.offset_x ?? 0);

  // Утримання стрілок зсуву: кроки накопичуються (схема одразу показує зсув), сервер рахує один раз після відпускання
  const [pend, setPend] = useState<{ k: 'h' | 'v'; mm: number } | null>(null);
  const pendRef = useRef<{ k: 'h' | 'v'; mm: number } | null>(null);
  const pendClear = useRef<number | undefined>(undefined);
  useEffect(() => { pendRef.current = null; setPend(null); }, [calcResult]);   // прийшов новий розрахунок — попередній перегляд не потрібен
  const tickPend = (k: 'h' | 'v', mm: number) => {
    const cur = pendRef.current && pendRef.current.k === k ? pendRef.current.mm : 0;
    let next = cur + mm;
    if (k === 'v' && !(onJointChange && jointY != null) && onVShift) next = Math.min(next, vShift);   // вище карниза не піднімаємо
    if (k === 'v' && onJointChange && jointY != null && jointRange) next = Math.max(jointRange[0] - jointY, Math.min(jointRange[1] - jointY, next));   // лінія — у допустимих межах
    pendRef.current = { k, mm: next }; setPend({ k, mm: next });
  };
  const endPend = () => {
    const p = pendRef.current;
    if (!p || !p.mm) { pendRef.current = null; setPend(null); return; }
    if (p.k === 'h') shiftLayout(p.mm); else shiftVerticalLayout(p.mm);
    window.clearTimeout(pendClear.current);
    pendClear.current = window.setTimeout(() => { pendRef.current = null; setPend(null); }, 4000);   // якщо сервер нічого не змінив
  };
  const pendH = pend?.k === 'h' ? pend.mm : 0;
  const pendV = pend?.k === 'v' ? pend.mm : 0;

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
    if (onJointChange && jointY != null) {
      onJointChange(jointY + Math.sign(deltaMm) * Math.max(Math.abs(deltaMm), jointStep));
      return;
    }
    // Один ряд (як у КП): ↓ опускає всі листи (довшають), ↑ піднімає; для металочерепиці — за модулем хвилі
    if (onVShift) { const nv = Math.max(0, vShift - deltaMm); if (nv !== vShift) onVShift(nv); return; }
    const newV = verticalOffset + deltaMm;
    setVerticalOffset(newV);
    setManualMode(true);
    if (polygonPoints.length >= 3) {
      const np = generateFullLayout(layoutOffset, newV, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl);
      setPlacements(np);
      onUpdate?.(np);
    }
    setSelected(new Set());
  }, [verticalOffset, layoutOffset, W, polygonPoints, usefulWidth, fullWidth, sheetLength, eaveOverhang, ridgeGap, rtl, onUpdate, onJointChange, jointY, jointStep, onVShift, vShift]);

  // ============================================
  // Зміна довжини виділеного листа з КОМПЕНСАЦІЄЮ
  // сусіда зверху в тій же колонці (стик рухається).
  // Якщо сусіда нема — просто змінюємо довжину.
  // ============================================
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const changeLengthWithJoint = useCallback((deltaMm: number) => {
    setManualMode(true);
    markDirty();
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
  // Сусідній лист у тій самій колонці над (dir=+1) або під (dir=−1) листом — за положенням, а не за номером ряду
  // (після розділення листа обидві частини мають той самий ряд)
  const neighbour = (list: SheetPlacement[], p: SheetPlacement, dir: 1 | -1) => {
    const y = p.y + (p.offset_y ?? 0);
    let best: SheetPlacement | undefined;
    list.forEach(q => {
      if (q.deleted || q === p || q.sheet_number === p.sheet_number || q.col_index !== p.col_index) return;
      const qy = q.y + (q.offset_y ?? 0);
      if (dir > 0 ? qy <= y : qy >= y) return;
      if (!best || (dir > 0 ? qy < best.y + (best.offset_y ?? 0) : qy > best.y + (best.offset_y ?? 0))) best = q;
    });
    return best;
  };
  const changeLengthTop = useCallback((deltaMm: number) => {
    setManualMode(true);
    markDirty();
    snap();
    setPlacements(prev => {
      const next = prev.map(p => ({ ...p }));
      selected.forEach(num => {
        const p = next.find(q => q.sheet_number === num);
        if (!p || p.deleted) return;
        const curLen = p.manual_length ?? p.length;
        const newLen = Math.max(50, curLen + deltaMm);
        p.manual_length = newLen;
        // Сусід зверху компенсує (стик рухається)
        const above = neighbour(next, p, +1);
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
    markDirty();
    snap();
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
        const below = neighbour(next, p, -1);
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
    markDirty();
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

  // Розділити виділений лист на два з нахлестом (для врізання вікна, димоходу): низ і верх — порівну
  // (металочерепиця — нижній стандартної довжини),
  // далі розміри коригуються стрілками «Довжина знизу / зверху» (сусідній лист компенсує зміну)
  const ovMm = Math.max(0, Number((calcResult as any).overlap_mm) || 0);
  const splitTarget = selected.size === 1 ? placements.find(p => !p.deleted && selected.has(p.sheet_number)) : undefined;
  const canSplit = !!splitTarget && getLen(splitTarget) >= 2 * Math.max(300, ovMm + 100);
  const splitSelected = () => {
    const p = splitTarget;
    if (!p || !canSplit) return;
    snap(); lastSnap.current = 0;
    markDirty();
    setManualMode(true);
    const L = getLen(p), y0 = getY(p);
    // металочерепиця: нижній лист — стандартний (цілі хвилі + нахлест), щоб малюнок збігся з верхнім
    let lower = Math.round((L + ovMm) / 2 / 10) * 10;
    if (waveStep > 0) {
      const base = Number((calcResult as any).std_base_mm ?? ovMm) || 0;   // стандарт = хвиля × n + база (з таблиці виробника)
      lower = Math.max(1, Math.round((lower - base) / waveStep)) * waveStep + base;
      if (lower > L - 300) lower = Math.max(1, Math.floor((L - 300 - base) / waveStep)) * waveStep + base;
    }
    const upperY = y0 + lower - ovMm, upperLen = y0 + L - upperY;
    const used = new Set(placements.filter(q => q.col_index === p.col_index && q.row_index === p.row_index).map(q => q.split_n || 0));
    let n = 1; while (used.has(n)) n++;
    const num = Math.max(0, ...placements.map(q => q.sheet_number)) + 1;
    const next = placements.map(q => q === p ? { ...q, manual_length: lower } : q);
    next.push({ ...p, split_n: n, sheet_number: num, y: upperY, offset_y: 0, manual_length: upperLen, length: upperLen, tech_err: undefined });
    setPlacements(next);
    onUpdate?.(next.filter(q => !q.deleted));
    setSelected(new Set([num]));
  };

  const deleteSelected = () => {
    snap(); lastSnap.current = 0;
    markDirty();
    setPlacements(prev => {
      const updated = prev.map(p => selected.has(p.sheet_number) ? { ...p, deleted: true } : p);
      onUpdate?.(updated.filter(p => !p.deleted));
      return updated;
    });
    setSelected(new Set());
  };

  // Прибрати надлишкові перекриття (як у КП): два листи однієї колонки, що перекриваються, замінюються одним,
  // якщо він не довший за максимальну довжину листа. Діє на виділені листи або (без виділення) на весь скат.
  const maxLen = Number((calcResult as any).max_real_length_mm) || 0;
  const mergeCandidates = (list: SheetPlacement[], only: Set<number> | null) => {
    const byCol = new Map<number, SheetPlacement[]>();
    list.forEach(p => { if (!p.deleted) { const a = byCol.get(p.col_index) || []; a.push(p); byCol.set(p.col_index, a); } });
    let n = 0;
    byCol.forEach(col => {
      col.sort((a, b) => getY(a) - getY(b));
      for (let i = 0; i + 1 < col.length; i++) {
        const lo = col[i], up = col[i + 1];
        if (only && !only.has(lo.sheet_number) && !only.has(up.sheet_number)) continue;
        const loTop = getY(lo) + getLen(lo), upTop = getY(up) + getLen(up);
        if (getY(up) > loTop) continue;                    // між листами зазор — не об'єднуємо
        const merged = Math.max(loTop, upTop) - getY(lo);
        if (maxLen > 0 && merged > maxLen) continue;
        n++;
        lo.manual_length = merged; up.deleted = true;
        col.splice(i + 1, 1); i--;                          // об'єднаний лист може поглинути і наступний
      }
    });
    return n;
  };
  const canMerge = mergeCandidates(placements.map(p => ({ ...p })), hasSel()) > 0;
  function hasSel() { return selected.size ? selected : null; }
  const mergeOverlaps = () => {
    const next = placements.map(p => ({ ...p }));
    if (!mergeCandidates(next, hasSel())) return;
    snap(); lastSnap.current = 0;
    markDirty();
    setManualMode(true);
    setPlacements(next);
    onUpdate?.(next.filter(p => !p.deleted));
    setSelected(new Set());
  };

  const resetAll = () => {
    history.current = []; setHistLen(0);
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
      // горизонтальна панель — перевіряємо в транспонованій системі (x ↔ y), як її рахує движок
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

  const svgToMm = (dx: number, dy: number) => {
    // повернута схема: точка екрана → «віртуальне» полотно (обернення matrix(0,-1,-1,0,SVG_W,SVG_H))
    const svgX = horiz ? SVG_H - dy : dx, svgY = horiz ? SVG_W - dx : dy;
    return { wx: vx0 + (svgX - PADDING) / scale, wy: vy1 - (svgY - PADDING) / scale };
  };

  // ---- Перегляд: тягни лівою кнопкою — рухати схему, Shift+тягни — виділити область, коліщатко — масштаб;
  // на телефоні — один палець рухає, два пальці — масштаб (щипок) ----
  const zoomAnchor = useRef<{ cx: number; cy: number; sl: number; st: number; z0: number } | null>(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const zoomAt = (z1: number, cx: number, cy: number) => {
    const box = boxRef.current; if (!box) return;
    const z0 = zoomRef.current, nz = Math.max(0.3, Math.min(6, z1));
    if (Math.abs(nz - z0) < 1e-4) return;
    zoomAnchor.current = { cx, cy, sl: box.scrollLeft, st: box.scrollTop, z0 };
    setZoom(nz);
  };
  useLayoutEffect(() => {                       // тримаємо точку під курсором / між пальцями на місці
    const a = zoomAnchor.current, box = boxRef.current;
    if (!a || !box) return;
    zoomAnchor.current = null;
    const k = zoom / a.z0;
    box.scrollLeft = (a.sl + a.cx) * k - a.cx;
    box.scrollTop = (a.st + a.cy) * k - a.cy;
  }, [zoom]);
  useEffect(() => {
    const box = boxRef.current; if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    // дотик: 1 палець — прокрутка схеми, 2 — масштаб
    let t0: { x: number; y: number; sl: number; st: number } | null = null;
    let p0: { d: number; z: number } | null = null;
    const mid = (a: Touch, b: Touch) => { const r = box.getBoundingClientRect(); return [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top]; };
    const onTS = (e: TouchEvent) => {
      if (e.touches.length === 1) { const t = e.touches[0]; t0 = { x: t.clientX, y: t.clientY, sl: box.scrollLeft, st: box.scrollTop }; p0 = null; }
      else if (e.touches.length === 2) { const [a, b] = [e.touches[0], e.touches[1]]; p0 = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: zoomRef.current }; t0 = null; }
    };
    const onTM = (e: TouchEvent) => {
      if (e.touches.length === 2 && p0) {
        e.preventDefault();
        const [a, b] = [e.touches[0], e.touches[1]];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const [cx, cy] = mid(a, b);
        zoomAt(p0.z * d / Math.max(1, p0.d), cx, cy);
      } else if (e.touches.length === 1 && t0) {
        const t = e.touches[0];
        const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) isDragging.current = true;
        e.preventDefault();
        box.scrollLeft = t0.sl - dx; box.scrollTop = t0.st - dy;
      }
    };
    const onTE = (e: TouchEvent) => { if (!e.touches.length) { t0 = null; p0 = null; setTimeout(() => { isDragging.current = false; }, 0); } };
    box.addEventListener('wheel', onWheel, { passive: false });
    box.addEventListener('touchstart', onTS, { passive: true });
    box.addEventListener('touchmove', onTM, { passive: false });
    box.addEventListener('touchend', onTE);
    box.addEventListener('touchcancel', onTE);
    return () => {
      box.removeEventListener('wheel', onWheel); box.removeEventListener('touchstart', onTS);
      box.removeEventListener('touchmove', onTM); box.removeEventListener('touchend', onTE); box.removeEventListener('touchcancel', onTE);
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = false;
    if (e.shiftKey) { dragStart.current = getSvgPoint(e); return; }   // Shift + тягни — виділити область
    const box = boxRef.current; if (!box) return;
    pan.current = { x: e.clientX, y: e.clientY, sl: box.scrollLeft, st: box.scrollTop };
    const move = (ev: MouseEvent) => {
      const p = pan.current; if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      if (!isDragging.current && Math.abs(dx) + Math.abs(dy) > 4) { isDragging.current = true; setPanning(true); }
      if (isDragging.current) { box.scrollLeft = p.sl - dx; box.scrollTop = p.st - dy; }
    };
    const up = () => {
      pan.current = null; setPanning(false);
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      setTimeout(() => { isDragging.current = false; }, 0);   // клік після перетягування не знімає виділення
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    e.preventDefault();
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
        const r = rectOf(p, getLen(p));
        return r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY;
      }).map(p => p.sheet_number);
      if (inRect.length > 0) {
        setSelected(e.shiftKey ? new Set([...selected, ...inRect]) : new Set(inRect));
      }
    }
    dragStart.current = null;
    setTimeout(() => { isDragging.current = false; }, 0);
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


  return (
    <div style={{ fontFamily:'system-ui, sans-serif', position:'relative' }}>

      {/* Заголовок */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'8px' }}>
        <div>
          <h3 style={{ margin:0, fontSize:'1rem' }}>Схема розкладки — {slopeName}</h3>
          <div style={{ fontSize:'.8rem', color:'var(--clr-text-3)', marginTop:'2px' }}>
            {calcResult.profile_name} · {visiblePlacements.length} листів · {calcResult.slope_area_m2.toFixed(2)} м²
            {jointY != null && <span> · Перша лінія стику: <b style={{ color: pendV ? 'var(--clr-brand)' : 'var(--clr-text)' }}>{((jointY + pendV)/1000).toFixed(3)} м</b>{rowLen ? ` · висота ряду ${(rowLen/1000).toFixed(3)} м` : ''}{jointRange ? ` (лінія ${(jointRange[0]/1000).toFixed(3)}–${(jointRange[1]/1000).toFixed(3)})` : ''}</span>}
            {jointY == null && vShift - pendV !== 0 && <span style={{ color:'var(--clr-brand)' }}> · Випуск нижче карниза: ↓{vShift - pendV} мм</span>}
            {jointY != null && vShift > 0 && <span style={{ color:'var(--clr-brand)' }}> · Випуск нижче карниза: ↓{vShift} мм
              {onVShift && <button type="button" onClick={() => onVShift(0)} title="Прибрати випуск нижче карниза" style={{ marginLeft: 4, border: 'none', background: 'none', color: 'var(--clr-brand)', cursor: 'pointer', fontWeight: 700 }}>✕</button>}</span>}
            {(() => { const sx = (onShiftX ? shiftX : layoutOffset) + pendH; return sx !== 0 && <span style={{ color:'var(--clr-brand)' }}> · Зсув: {sx>0?'+':''}{sx} мм</span>; })()}
            {hasSelection && <span style={{ color:COLORS.selected, fontWeight:600 }}> · Виділено: {selected.size} шт</span>}
          </div>
        </div>
        <div style={{ display:'flex', gap:'6px', alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={selectAll} style={{ padding:'6px 12px', background:COLORS.selected, color:'var(--clr-on-brand)', border:'none', borderRadius:'6px', cursor:'pointer', fontWeight:600, fontSize:'.82rem' }}>☑ Виділити всі</button>
          {hasSelection && <button onClick={()=>setSelected(new Set())} style={{ padding:'6px 12px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.82rem' }}>✕ Зняти</button>}
          <button onClick={()=>setZoom(z=>Math.max(0.3,z-0.1))} style={zoomBtn}>−</button>
          <span style={{ fontSize:'.85rem', minWidth:'40px', textAlign:'center' }}>{Math.round(zoom*100)}%</span>
          <button onClick={()=>setZoom(z=>Math.min(6,z+0.1))} style={zoomBtn}>+</button>
          <button onClick={()=>{ savedZoom = null; const w = boxRef.current?.clientWidth || 900; setZoom(Math.max(0.3, Math.min(1, Math.floor(((window.innerHeight * 0.6) / (w * SVG_H / SVG_W)) * 20) / 20))); }} style={zoomBtn} title="Вписати в екран">⟳</button>
          <button onClick={cycleLabels} style={zoomBtn} title="Підписи довжин листів: горизонтально → вертикально → сховати">
            {labels === 'h' ? 'Розміри: ↔' : labels === 'v' ? 'Розміри: ↕' : 'Розміри: —'}
          </button>
          <button onClick={mergeOverlaps} disabled={!canMerge} style={{ ...zoomBtn, opacity: canMerge ? 1 : .45, cursor: canMerge ? 'pointer' : 'default' }}
            title={maxLen ? `Замінити листи, що перекриваються, одним (до ${(maxLen / 1000).toFixed(3)} м). Діє на виділені листи або на весь скат` : 'Замінити листи, що перекриваються, одним'}>⇲ Прибрати зайві перекриття</button>{/* i18n-ignore: шаблон у tpl */}
          <button onClick={undo} disabled={!histLen} style={{ ...zoomBtn, opacity: histLen ? 1 : .45, cursor: histLen ? 'pointer' : 'default' }} title="Відмінити останню правку листів (Ctrl+Z), до 9 кроків">↶ Відмінити{histLen ? ` (${histLen})` : ''}</button>
          <button onClick={resetAll} style={{ ...zoomBtn, color:'var(--clr-error)', borderColor:'var(--clr-error)' }}>↩ Скинути</button>
        </div>
      </div>

      <div style={{ fontSize:'.8rem', color:'var(--clr-text-3)', marginBottom:'8px' }}>
        💡 Клік — виділити лист · Shift+клік — додати · Тягни мишу / пальцем — рухати схему · Shift+тягни — виділити область · Коліщатко / два пальці — масштаб
      </div>

      {/* Панель зсуву всієї розкладки — у бічній панелі (стрілки як у «Кровля Профи»: ◀ 0.1 м, ◀◀ 0.01 м, ◀◀◀ 0.001 м) */}
      {(() => {
        const vertOk = !(onJointChange && jointY == null && !onVShift);
        // повернута схема (сайдинг): «горизонталь» движка — це ряди вгору/вниз, «вертикаль» — уздовж стіни
        const G: Record<string, string> = horiz ? { '◀': '▼', '▶': '▲', '▲': '▶', '▼': '◀' } : {};
        const arrows = (ch: string, n: number) => (G[ch] || ch).repeat(n);
        const panel = (
          <div className="ls-shift">
            {onOptimize && <button type="button" className="btn btn-primary btn-sm ls-opt" onClick={onOptimize}
              title="Підібрати зсув листів з найменшою витратою матеріалу (з урахуванням вирізів)">⚡ Оптимізувати укладку</button>}
            <div className="ls-shift-h">{horiz ? 'Ряди (по вертикалі)' : 'По горизонталі'}</div>
            <div className="ls-shift-row">
              {[...STEPS].reverse().map((st, i) => (
                <HoldBtn key={'l' + st.mm} title={`← ${st.label}`} onTick={() => tickPend('h', -st.mm)} onEnd={endPend}>{arrows('◀', 3 - i)}</HoldBtn>
              ))}
              {STEPS.map((st, i) => (
                <HoldBtn key={'r' + st.mm} title={`→ ${st.label}`} onTick={() => tickPend('h', +st.mm)} onEnd={endPend}>{arrows('▶', i + 1)}</HoldBtn>
              ))}
            </div>
            <div className="ls-shift-h" title={onJointChange ? 'Рухає лінію стику рядів — усі листи ската діляться по ній' : undefined}>
              {onJointChange && jointY != null ? 'Лінія стику' : horiz ? 'Уздовж стіни (по горизонталі)' : 'По вертикалі'}</div>
            {vertOk && (
              <div className="ls-shift-col">
                <div className="ls-shift-row">
                  {STEPS.map((st, i) => (
                    <HoldBtn key={'u' + st.mm} title={`↑ ${st.label}`} disabled={!(onJointChange && jointY != null) && !!onVShift && vShift - pendV <= 0} onTick={() => tickPend('v', +st.mm)} onEnd={endPend}>{arrows('▲', i + 1)}</HoldBtn>
                  ))}
                </div>
                <div className="ls-shift-row">
                  {STEPS.map((st, i) => (
                    <HoldBtn key={'d' + st.mm} title={`↓ ${st.label}`} onTick={() => tickPend('v', -st.mm)} onEnd={endPend}>{arrows('▼', i + 1)}</HoldBtn>
                  ))}
                </div>
              </div>
            )}
            {onRowsDiv && (
              <div className="ls-shift-col">
                <button type="button" className="ls-row-btn" onClick={() => onRowsDiv(Math.max(2, rowsDiv + 1))}
                  title="⇕ Коротший ряд: листи коротшають, з'являється розріз (як у Кровля Профи)">⇕ коротший ряд</button>
                {rowsDiv >= 2 && <button type="button" className="ls-row-btn" onClick={() => onRowsDiv(rowsDiv - 1 < 2 ? 0 : rowsDiv - 1)} title="⇕ Довший ряд">⇕ довший ряд</button>}
              </div>
            )}
            <div className="ls-shift-legend">◀ / ▲ — 0.1 м · ◀◀ — 0.01 м · ◀◀◀ — 0.001 м</div>
          </div>
        );
        return shiftPanelTarget ? createPortal(panel, shiftPanelTarget) : panel;
      })()}

      {/* SVG */}
      <div className="ls-box">
      <div ref={boxRef} style={{ overflowX:'auto', overflowY:'auto', maxHeight:'75vh', border:'1px solid var(--clr-border)', borderRadius:'8px', background:COLORS.bg,
        cursor: panning ? 'grabbing' : 'grab', touchAction:'none', overscrollBehavior:'contain' }}>
        <svg ref={svgRef} viewBox={`0 0 ${SVG_W} ${SVG_H}`} overflow="hidden"
          style={{ display:'block', width:`${zoom*100}%`, height:'auto' }}
          onMouseDown={onSvgMouseDown} onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onClick={onSvgClick}>
          <rect width={SVG_W} height={SVG_H} fill={COLORS.bg}/>
          <g transform={horiz ? `matrix(0,-1,-1,0,${SVG_W},${SVG_H})` : undefined}>
          {gridLines.map(g => (
            <line key={g.k} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
              stroke={g.major ? 'var(--clr-grid-major)' : 'var(--clr-grid)'} strokeWidth={g.major ? 0.8 : 0.4}/>
          ))}
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--clr-text-3)"/>
            </marker>
          </defs>

          <g transform={pendH ? `translate(${pendH * scale},0)` : (pendV && jointY == null && onVShift) ? `translate(0,${-pendV * scale})` : undefined}>
            {visiblePlacements.map(p => {
              const length = getLen(p);
              const isSel  = selected.has(p.sheet_number);
              const rr = rectOf(p, length);
              const x1 = tx(rr.x);
              const y1 = ty(rr.y);
              const w  = rr.w * scale;
              const h  = rr.h * scale;
              const color = sheetColor(p, isSel);
              return (
                <g key={p.sheet_number} onClick={e=>handleSheetClick(e,p.sheet_number)} style={{cursor:'pointer'}}>
                  <rect x={x1} y={y1-h} width={w} height={h}
                    fill={color} fillOpacity={isSel?0.5:0.35}
                    stroke={color} strokeWidth={isSel?2.5:1}/>
                  {stStep > 0 && stStep * scale >= 4 && stamps(length).map(v => (
                    <line key={`w${v}`} x1={x1} x2={x1 + w} y1={y1 - v * scale} y2={y1 - v * scale}
                      stroke={color} strokeOpacity={0.45} strokeWidth={0.6} />
                  ))}
                  {isSel && tech && zoneBands(length).map(([a, b]) => (
                    <rect key={`z${a}`} x={x1} y={y1 - b * scale} width={w} height={(b - a) * scale}
                      fill="#16A34A" fillOpacity={0.22} stroke="#16A34A" strokeOpacity={0.6} strokeWidth={0.6} pointerEvents="none" />
                  ))}
                  {/* довжина підписується на кожному листі; на короткому — дрібнішим шрифтом, щоб влізла */}
                  {labels === 'h' && h>6 && w>14 && <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle" transform={tt(x1+w/2, y1-h/2)}
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={horiz ? Math.max(5, Math.min(12, w*0.75, h/3.2)) : Math.max(6, Math.min(13, Math.max(h/4, 9), h*0.8, w/3.2))} fontWeight="600">
                    {(length/1000).toFixed(3)}
                  </text>}
                  {labels === 'v' && !horiz && h>14 && w>6 && <text x={x1+w/2} y={y1-h/2} textAnchor="middle" dominantBaseline="middle"
                    transform={`rotate(-90 ${x1+w/2} ${y1-h/2})`}
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={Math.max(5, Math.min(14, w/2.2, h/3.2))} fontWeight="600">
                    {(length/1000).toFixed(3)}
                  </text>}
                  {labels === 'h' && !horiz && h>30 && w>20 && <text x={x1+w/2} y={y1-h/2+14} textAnchor="middle" dominantBaseline="middle"
                    fill={isSel?COLORS.selected:COLORS.text} fontSize={8} opacity={0.7}>
                    №{p.sheet_number}
                  </text>}
                  {p.manual_length && <text x={x1+3} y={y1-h+10} transform={tt(x1+3, y1-h+10)} fill="#FF7A1A" fontSize={9}>✎</text>}
                  {(() => {
                    const err = length === p.length && p.tech_err ? p.tech_err : stampErr(length, tech);
                    if (!err) return null;
                    return <>
                      <rect x={x1+1.5} y={y1-h+1.5} width={Math.max(0, w-3)} height={Math.max(0, h-3)} fill="none" stroke="#DC2626" strokeWidth={2} strokeDasharray="5 3" pointerEvents="none"/>
                      <text x={x1+w-4} y={y1-h+12} transform={tt(x1+w-4, y1-h+12)} textAnchor="end" fill="#DC2626" fontSize={11} fontWeight="700">⚠</text>
                      <title>{`№${p.sheet_number}: ${err}`}</title>
                    </>;
                  })()}
                </g>
              );
            })}
          </g>

          <path d={polyPath} fill="none" stroke={COLORS.polygon} strokeWidth="2"/>
          {/* Вирізи (труби, вікна): поверх листів — листи обходять виріз, накладка вирізається при монтажі */}
          <defs>
            <pattern id="ls-hole-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="#DC2626" strokeOpacity="0.45" strokeWidth="2"/>
            </pattern>
          </defs>
          {holes.filter(h => h.length >= 3).map((h, i) => {
            const d = h.map((q, k) => `${k ? 'L' : 'M'} ${tx(q[0])} ${ty(q[1])}`).join(' ') + ' Z';
            const cx = h.reduce((a, q) => a + q[0], 0) / h.length, cy = h.reduce((a, q) => a + q[1], 0) / h.length;
            return (
              <g key={`hole${i}`} pointerEvents="none">
                <path d={d} fill={COLORS.bg} />
                <path d={d} fill="url(#ls-hole-hatch)" stroke="#DC2626" strokeWidth="1.5" />
                <text x={tx(cx)} y={ty(cy) + 4} transform={tt(tx(cx), ty(cy) + 4)} textAnchor="middle" fontSize="11" fontWeight="700" fill="#DC2626"
                  stroke={COLORS.bg} strokeWidth="3" style={{ paintOrder: 'stroke' }}>{`Виріз №${i + 1}`}</text>
              </g>
            );
          })}

          </g>
          {rubberBand && (
            <rect x={rubberBand.x1} y={rubberBand.y1} width={rubberBand.x2-rubberBand.x1} height={rubberBand.y2-rubberBand.y1}
              fill="rgba(255,122,0,0.1)" stroke={COLORS.selected} strokeWidth="1" strokeDasharray="4 2"/>
          )}
          <g transform={horiz ? `matrix(0,-1,-1,0,${SVG_W},${SVG_H})` : undefined}>

          <line x1={tx(0)} y1={PADDING-20} x2={tx(W)} y2={PADDING-20} stroke="var(--clr-text-3)" strokeWidth="1" markerEnd="url(#arrow)"/>
          <text x={tx(W/2)} y={PADDING-28} transform={tt(tx(W/2), PADDING-28)} textAnchor="middle" fill="var(--clr-text-2)" fontSize="11" fontWeight="600">{(W/1000).toFixed(2)} м</text>
          <line x1={tx(vx0)-20} y1={ty(0)} x2={tx(vx0)-20} y2={ty(H)} stroke="var(--clr-text-3)" strokeWidth="1"/>
          <text x={tx(vx0)-35} y={ty(H/2)} textAnchor="middle" fill="var(--clr-text-2)" fontSize="11" fontWeight="600"
            transform={tt(tx(vx0)-35, ty(H/2), `rotate(-90,${tx(vx0)-35},${ty(H/2)})`)}>{(H/1000).toFixed(2)} м</text>
          {Array.from({length:Math.ceil(W/1000)+1},(_,i)=>i).map(i=>(
            <text key={`lx${i}`} x={tx(i*1000)} y={ty(vy0)+18} transform={tt(tx(i*1000), ty(vy0)+18)} textAnchor="middle" fill="var(--clr-text-3)" fontSize="9">{i}</text>
          ))}
          {Array.from({length:Math.ceil(H/1000)+1},(_,i)=>i).map(i=>(
            <text key={`ly${i}`} x={tx(vx0)-8} y={ty(i*1000)+3} transform={tt(tx(vx0)-8, ty(i*1000)+3)} textAnchor="end" fill="var(--clr-text-3)" fontSize="9">{i}</text>
          ))}
          </g>
        </svg>
      </div>
      {overlay && <div className="ls-overlay">{overlay}</div>}
      </div>

      {/* Легенда */}
      <div style={{ display:'flex', gap:'16px', marginTop:'12px', flexWrap:'wrap' }}>
        <LegendItem color={COLORS.full}     label="Повний лист"/>
        <LegendItem color={COLORS.cut}      label="Обрізаний лист"/>
        <LegendItem color={COLORS.waste}    label="Великий відхід (>50%)"/>
        <LegendItem color={COLORS.selected} label="Виділений лист"/>
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

            {/* Довжина ЗВЕРХУ: ▲ подовжити, ▼ вкоротити (▲ 0.1 м, ▲▲ 0.01 м, ▲▲▲ 0.001 м) */}
            <div style={{ marginBottom:'10px' }}>
              <div style={{ fontSize:'.72rem', fontWeight:600, color:'var(--clr-text-3)', marginBottom:'4px' }}>
                {horiz ? '➡ Довжина справа (правий край):' : '⬆ Довжина зверху (верхній край):'}
              </div>
              <div className="ls-shift-row">
                {STEPS.map((st, i) => <HoldBtn key={'tu' + st.mm} title={`↑ ${st.label}`} onTick={() => changeLengthTop(+st.mm)}>{(horiz ? '▶' : '▲').repeat(i + 1)}</HoldBtn>)}
              </div>
              <div className="ls-shift-row" style={{ marginTop: 4 }}>
                {STEPS.map((st, i) => <HoldBtn key={'td' + st.mm} title={`↓ ${st.label}`} onTick={() => changeLengthTop(-st.mm)}>{(horiz ? '◀' : '▼').repeat(i + 1)}</HoldBtn>)}
              </div>
            </div>

            {/* Довжина ЗНИЗУ: ▼ подовжити донизу, ▲ вкоротити */}
            <div style={{ marginBottom:'12px' }}>
              <div style={{ fontSize:'.72rem', fontWeight:600, color:'var(--clr-text-3)', marginBottom:'4px' }}>
                {horiz ? '⬅ Довжина зліва (лівий край):' : '⬇ Довжина знизу (нижній край):'}
              </div>
              <div className="ls-shift-row">
                {STEPS.map((st, i) => <HoldBtn key={'bu' + st.mm} title={`↑ ${st.label}`} onTick={() => changeLengthBottom(-st.mm)}>{(horiz ? '▶' : '▲').repeat(i + 1)}</HoldBtn>)}
              </div>
              <div className="ls-shift-row" style={{ marginTop: 4 }}>
                {STEPS.map((st, i) => <HoldBtn key={'bd' + st.mm} title={`↓ ${st.label}`} onTick={() => changeLengthBottom(+st.mm)}>{(horiz ? '◀' : '▼').repeat(i + 1)}</HoldBtn>)}
              </div>
              <div style={{ fontSize:'.68rem', color:'var(--clr-text-3)', marginTop:'4px' }}>
                ▲ / ▼ — 0.1 м · ▲▲ — 0.01 м · ▲▲▲ — 0.001 м. Сусідній лист компенсує зміну (стик рухається)
              </div>
            </div>

            {/* Дії */}
            <div style={{ display:'flex', gap:'6px', borderTop:'1px solid var(--clr-border)', paddingTop:'10px' }}>
              <button onClick={splitSelected} disabled={!canSplit}
                title={canSplit ? 'Розділити лист на два з нахлестом — для розриву під вікно чи димохід; далі підкоригуйте довжини стрілками' : 'Виділіть один лист (не коротший за 0.6 м)'}
                style={{ flex:1, padding:'8px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor: canSplit ? 'pointer' : 'default', opacity: canSplit ? 1 : .45, background:'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.82rem', fontWeight:500 }}>
                ✂ Розділити
              </button>
              <button onClick={deleteSelected}
                style={{ flex:1, padding:'8px', border:'1px solid var(--clr-error)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-error-bg)', color:'var(--clr-error)', fontSize:'.82rem', fontWeight:500 }}>
                🗑 Видалити
              </button>
              <button onClick={undo} disabled={!histLen}
                style={{ flex:1, padding:'8px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor: histLen ? 'pointer' : 'default', opacity: histLen ? 1 : .45, background:'var(--clr-surface-2)', color:'var(--clr-text)', fontSize:'.82rem' }}>
                ↶ Відмінити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

let savedZoom: number | null = null; // масштаб схеми на час сесії
const zoomBtn: React.CSSProperties  = { padding:'4px 10px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', cursor:'pointer', background:'var(--clr-surface-2)', color:'var(--clr-text)' };

function LegendItem({ color, label }: { color:string; label:string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.78rem', color:'var(--clr-text-2)' }}>
      <div style={{ width:'14px', height:'14px', background:color, opacity:0.6, borderRadius:'3px', border:`1px solid ${color}` }}/>
      {label}
    </div>
  );
}
