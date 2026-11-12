// ============================================
// Креслення добору мишкою (як скати в редакторі): клік — точка, сторони з розмірами, кути загинів,
// перетягування вершин, закатки на кінцях, фарбована сторона. Модель — та сама FElem (сторони + кути),
// тож таблиця сторін і креслення завжди збігаються.
// ============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Core, FElem, HEM_LEN, Hem, LabelReq, Pt, angOffset, coreHeads, placeLabels, textBox, corePts, joinCore, outerSides, ptsToCore, splitCore } from './flashing';
import NumIn from './NumIn';

type Pop = { kind: 'seg' | 'pt'; idx: number; x: number; y: number } | null;
interface View { k: number; tx: number; ty: number }

const H_EDIT = 380;
const FS = 11;          // розміри, px
const RAL_FS = 10;
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

const NOP = () => {};
/** still — лише креслення заданого розміру (бланк, друк, PDF): без панелі, сітки, точок і подій */
export default function FlashingDraw({ e, onChange = NOP, hi = -1, setHi = NOP, still }:
  { e: FElem; onChange?: (p: Partial<FElem>) => void; hi?: number; setHi?: (i: number) => void; still?: { w: number; h: number } }) {
  const H = still ? still.h : H_EDIT;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(still ? still.w : 0);   // 0 — ще не виміряно
  const [view, setView] = useState<View>({ k: 1, tx: 300, ty: 190 });
  const viewRef = useRef(view); viewRef.current = view;
  const [org, setOrg] = useState<Pt>([0, 0]);
  const [mode, setMode] = useState<'edit' | 'draw'>(e.segs.length || still ? 'edit' : 'draw');
  const [anchor, setAnchor] = useState<Pt | null>(null);       // перша точка порожнього профілю
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState(true);
  const [drawFrom, setDrawFrom] = useState<'end' | 'start'>('end');
  const [pop, setPop] = useState<Pop>(null);
  const [panning, setPanning] = useState(false);
  const undo = useRef<Pick<FElem, 'segs' | 'start' | 'paint'>[]>([]);
  const [, force] = useState(0);
  const popEdited = useRef(false);
  const pinch = useRef<{ d: number; mx: number; my: number; v: View } | null>(null);
  const touched2 = useRef(false);     // у жесті був другий палець — клік/точку не ставимо

  const core = useMemo(() => splitCore(e), [e]);
  const hs = core.hemS ? 1 : 0;
  const pts = useMemo<Pt[]>(() => core.segs.length ? corePts(core).map(p => [p[0] + org[0], p[1] + org[1]] as Pt) : (anchor ? [anchor] : []), [core, org, anchor]);
  const heads = useMemo(() => coreHeads(core), [core]);

  // ---- зміни з креслення: знімок для «Відмінити» ----
  const pushUndo = useCallback(() => {
    undo.current.push({ segs: JSON.parse(JSON.stringify(e.segs)), start: e.start, paint: e.paint });
    if (undo.current.length > 100) undo.current.shift();
    force(x => x + 1);
  }, [e.segs, e.start, e.paint]);
  const doUndo = () => { const u = undo.current.pop(); if (u) { onChange(u); force(x => x + 1); setPop(null); } };
  const commit = (c: Core) => onChange(joinCore(c));
  const commitPts = (p: Pt[], hemS: Hem | null = core.hemS, hemE: Hem | null = core.hemE) => {
    if (p.length < 2) { onChange({ segs: [] }); return; }
    setOrg(p[0]);
    commit(ptsToCore(p.map(q => [q[0] - p[0][0], q[1] - p[0][1]] as Pt), hemS, hemE));
  };

  // ---- розмір полотна ----
  useEffect(() => {
    const el = wrapRef.current; if (!el || still) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth) setW(Math.max(260, el.clientWidth)); });
    ro.observe(el); if (el.clientWidth) setW(Math.max(260, el.clientWidth));
    return () => ro.disconnect();
  }, [still]);

  // ---- вмістити креслення ----
  const fit = useCallback((w = W) => {
    const all: Pt[] = pts.length ? [...pts] : [[0, 0], [200, 150]];
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = still ? Math.min(48, w * 0.14) : 60;
    const k = Math.max(0.05, Math.min(20, Math.min((w - pad * 2) / Math.max(20, maxX - minX), (H - pad * 2) / Math.max(20, maxY - minY))));
    setView({ k, tx: w / 2 - ((minX + maxX) / 2) * k, ty: H / 2 + ((minY + maxY) / 2) * k });
  }, [pts, W, H, still]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && W > 0) { fitted.current = true; fit(W); } }, [W, fit]);

  const S = (p: Pt): Pt => [view.tx + p[0] * view.k, view.ty - p[1] * view.k];
  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect(), v = viewRef.current;
    return [(cx - r.left - v.tx) / v.k, (v.ty - (cy - r.top)) / v.k];
  };

  // ---- прив'язка: довжина кроком, кут кроком 5° відносно попередньої сторони ----
  const lenStep = 1;   // довжина — кратно 1 мм
  const snapFrom = (from: Pt, raw: Pt, refHead: number | null, free: boolean): Pt => {
    const dx = raw[0] - from[0], dy = raw[1] - from[1];
    let L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (free || !snap) return raw;
    L = Math.max(lenStep, Math.round(L / lenStep) * lenStep);
    const base = refHead ?? 0;
    a = base + rad(Math.round(deg(a - base) / 5) * 5);
    return [from[0] + L * Math.cos(a), from[1] + L * Math.sin(a)];
  };

  // ---- масштаб колесом ----
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const v = viewRef.current, f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      const k = Math.max(0.05, Math.min(40, v.k * f)), q = k / v.k;
      setView({ k, tx: sx - (sx - v.tx) * q, ty: sy - (sy - v.ty) * q });
    };
    // Два пальці — масштаб і рух; один палець — як миша (pointer-події)
    const two = (t: TouchList) => {
      const r = el.getBoundingClientRect(), a = t[0], b = t[1];
      return { d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), mx: (a.clientX + b.clientX) / 2 - r.left, my: (a.clientY + b.clientY) / 2 - r.top };
    };
    const onTS = (ev: TouchEvent) => {
      if (ev.touches.length === 1) touched2.current = false;
      if (ev.touches.length >= 2) { touched2.current = true; pinch.current = { ...two(ev.touches), v: viewRef.current }; }
    };
    const onTM = (ev: TouchEvent) => {
      const p = pinch.current;
      if (!p || ev.touches.length < 2) return;
      ev.preventDefault();
      const c = two(ev.touches), k = Math.max(0.05, Math.min(40, p.v.k * c.d / p.d)), q = k / p.v.k;
      setView({ k, tx: c.mx - (p.mx - p.v.tx) * q, ty: c.my - (p.my - p.v.ty) * q });
    };
    const onTE = (ev: TouchEvent) => { if (ev.touches.length < 2) pinch.current = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTS, { passive: true });
    el.addEventListener('touchmove', onTM, { passive: false });
    el.addEventListener('touchend', onTE);
    el.addEventListener('touchcancel', onTE);
    return () => {
      el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onTS);
      el.removeEventListener('touchmove', onTM); el.removeEventListener('touchend', onTE); el.removeEventListener('touchcancel', onTE);
    };
  }, []);
  const zoomBy = (f: number) => {
    const v = viewRef.current, k = Math.max(0.05, Math.min(40, v.k * f)), q = k / v.k, cx = W / 2, cy = H / 2;
    setView({ k, tx: cx - (cx - v.tx) * q, ty: cy - (cy - v.ty) * q });
  };

  // Рух креслення з порожнього місця; без руху — onClick
  const startPan = (ev: React.PointerEvent, onClick?: () => void) => {
    const x0 = ev.clientX, y0 = ev.clientY, v0 = viewRef.current;
    let moved = false;
    if (pinch.current) return;
    const move = (m: PointerEvent) => {
      if (pinch.current || touched2.current) { moved = true; return; }
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) > (m.pointerType === 'touch' ? 8 : 4)) { moved = true; setPanning(true); }
      if (moved) setView({ ...v0, tx: v0.tx + dx, ty: v0.ty + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      setPanning(false); if (!moved && !touched2.current) onClick?.();
    };
    window.addEventListener('pointercancel', up);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // ---- малювання ----
  // креслимо від кінця або від початку профілю (кінець, з якого продовжують, перестає бути краєм — завальцювання там знімається)
  const fromStart = drawFrom === 'start' && core.segs.length > 0;
  const lastPt = fromStart ? pts[0] : pts[pts.length - 1];
  const lastHead = core.segs.length ? (fromStart ? heads[0] + Math.PI : heads[heads.length - 1]) : null;
  const addPoint = (p: Pt) => {
    if (!pts.length) { setAnchor(p); setOrg(p); return; }
    if (Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1]) < 0.5) return;
    pushUndo();
    if (fromStart) commitPts([p, ...pts], null, core.hemE);
    else commitPts([...pts, p], core.hemS, null);
    setAnchor(null);
  };
  const finishDraw = () => { setMode('edit'); setDrawFrom('end'); setCursor(null); if (!core.segs.length) setAnchor(null); };
  const continueFrom = (j: number) => {
    setPop(null);
    if (j === 0 && pts.length > 1) { setDrawFrom('start'); setMode('draw'); return; }
    if (j < pts.length - 1) {
      if (!window.confirm('Сторони після цієї точки буде видалено, креслення продовжиться звідси. Продовжити?')) return;
      pushUndo();
      commitPts(pts.slice(0, j + 1), core.hemS, null);
    }
    setDrawFrom('end'); setMode('draw');
  };
  const restart = () => {
    if (e.segs.length && !window.confirm('Стерти профіль і накреслити заново?')) return;
    pushUndo(); onChange({ segs: [] }); setAnchor(null); setPop(null); setMode('draw');
  };

  const onBgDown = (ev: React.PointerEvent) => {
    svgRef.current?.focus();
    if (ev.button === 1) { ev.preventDefault(); startPan(ev); return; }
    if (ev.button === 2) { if (mode === 'draw') finishDraw(); return; }
    if (mode === 'draw') {
      const raw = toWorld(ev.clientX, ev.clientY), free = ev.shiftKey;
      startPan(ev, () => addPoint(lastPt ? snapFrom(lastPt, raw, lastHead, free) : raw));
    } else startPan(ev, () => setPop(null));
  };
  const onMove = (ev: React.PointerEvent) => { if (mode === 'draw') setCursor(toWorld(ev.clientX, ev.clientY)); };
  const preview = mode === 'draw' && lastPt && cursor ? snapFrom(lastPt, cursor, lastHead, false) : null;

  // ---- перетягування вершини; клік без руху — вікно вершини ----
  const startDrag = (ev: React.PointerEvent, j: number) => {
    ev.stopPropagation();
    if (ev.button !== 0) return;
    const x0 = ev.clientX, y0 = ev.clientY, base = pts.map(p => [...p] as Pt);
    const hd = heads;
    let moved = false;
    const move = (m: PointerEvent) => {
      if (pinch.current) return;
      if (!moved && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > (m.pointerType === 'touch' ? 6 : 3)) { moved = true; pushUndo(); setPop(null); }
      if (!moved) return;
      const raw = toWorld(m.clientX, m.clientY), free = m.shiftKey;
      const np = j > 0 ? snapFrom(base[j - 1], raw, j >= 2 ? hd[j - 2] : null, free)
        : base.length > 1 ? snapFrom(base[1], raw, hd.length > 1 ? hd[1] + Math.PI : null, free) : raw;
      const p = base.map(q => [...q] as Pt); p[j] = np;
      commitPts(p);
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved && !touched2.current) { const r = wrapRef.current!.getBoundingClientRect(); openPop('pt', j, m.clientX - r.left, m.clientY - r.top); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const openPop = (kind: 'seg' | 'pt', idx: number, x: number, y: number) => { popEdited.current = false; setPop({ kind, idx, x, y }); };
  const onSegDown = (ev: React.PointerEvent, i: number) => {
    ev.stopPropagation();
    if (ev.button !== 0) return;
    const r = wrapRef.current!.getBoundingClientRect();
    openPop('seg', i, ev.clientX - r.left, ev.clientY - r.top);
  };
  const onHemDown = (ev: React.PointerEvent, j: number) => {
    ev.stopPropagation();
    if (ev.button !== 0) return;
    const r = wrapRef.current!.getBoundingClientRect();
    openPop('pt', j, ev.clientX - r.left, ev.clientY - r.top);
  };
  const editOnce = () => { if (!popEdited.current) { popEdited.current = true; pushUndo(); } };

  // ---- операції вікон ----
  const setCoreSeg = (i: number, p: Partial<Core['segs'][number]>) => { editOnce(); commit({ ...core, segs: core.segs.map((s, k) => k === i ? { ...s, ...p } : s) }); };
  const setHem = (end: 'S' | 'E', h: Hem | null) => { editOnce(); commit(end === 'S' ? { ...core, hemS: h } : { ...core, hemE: h }); };
  const splitSeg = (i: number) => {
    pushUndo();
    const p = [...pts]; const a = p[i], b = p[i + 1];
    p.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    commitPts(p); setPop(null);
  };
  const delPoint = (j: number) => {
    pushUndo();
    const p = pts.filter((_, k) => k !== j);
    if (p.length < 2) { onChange({ segs: [] }); setAnchor(p[0] || null); setMode('draw'); }
    else commitPts(p, j === 0 ? null : core.hemS, j === pts.length - 1 ? null : core.hemE);
    setPop(null);
  };
  const hemSide = (-e.paint) as 1 | -1;   // закатка — на нефарбований бік
  const flipPaint = () => { pushUndo(); onChange({ paint: (-e.paint) as 1 | -1 }); };

  // ---- клавіші ----
  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); return; }
    if (ev.key === 'Escape' || ev.key === 'Enter') { if (pop) setPop(null); else if (mode === 'draw') finishDraw(); }
    if (ev.key === 'Backspace' && mode === 'draw' && pts.length) { ev.preventDefault(); delPoint(fromStart ? 0 : pts.length - 1); setMode('draw'); }
  };

  // ---- геометрія для малювання ----
  const gapW = 3 / view.k;   // завальцювання — тонка петля
  const U = (h: number): Pt => [Math.cos(h), Math.sin(h)];
  const LN = (h: number): Pt => [-Math.sin(h), Math.cos(h)];
  // закатки: лінія (a→b у напрямку руху креслення) + дуга від згину до основної ламаної
  const hemGeo = (end: 'S' | 'E') => {
    const hm = end === 'S' ? core.hemS : core.hemE;
    if (!hm || !core.segs.length) return null;
    if (end === 'S') {
      const C = pts[0], h = heads[0] - hm.dir * Math.PI, n = LN(h), u = U(h);
      const B: Pt = [C[0] - gapW * n[0] * hm.dir, C[1] - gapW * n[1] * hm.dir];
      const A: Pt = [B[0] - hm.len * u[0], B[1] - hm.len * u[1]];
      return { a: A, b: B, fold: B, core: C, h, bulge: u };
    }
    const E = pts[pts.length - 1], h = heads[heads.length - 1], n = LN(h);
    const S0: Pt = [E[0] + gapW * n[0] * hm.dir, E[1] + gapW * n[1] * hm.dir];
    const h2 = h + hm.dir * Math.PI, u2 = U(h2);
    return { a: S0, b: [S0[0] + hm.len * u2[0], S0[1] + hm.len * u2[1]] as Pt, fold: S0, core: E, h: h2, bulge: U(h) };
  };
  const hemSG = hemGeo('S'), hemEG = hemGeo('E');
  const nSeg = e.segs.length;
  const fullIdx = (i: number) => i + hs;

  // сітка
  const gStep = GRID_STEPS.find(s => s * view.k >= 9) || 1000;
  const grid = useMemo(() => {
    const out: React.ReactElement[] = [];
    const x0 = Math.floor((-view.tx / view.k) / gStep), x1 = Math.ceil(((W - view.tx) / view.k) / gStep);
    const y0 = Math.floor(((view.ty - H) / view.k) / gStep), y1 = Math.ceil((view.ty / view.k) / gStep);
    for (let i = x0; i <= x1 && out.length < 600; i++) { const x = view.tx + i * gStep * view.k; out.push(<line key={'x' + i} x1={x} y1={0} x2={x} y2={H} className={i % 5 === 0 ? 'fd-g2' : 'fd-g1'} />); }
    for (let i = y0; i <= y1 && out.length < 1200; i++) { const y = view.ty - i * gStep * view.k; out.push(<line key={'y' + i} x1={0} y1={y} x2={W} y2={y} className={i % 5 === 0 ? 'fd-g2' : 'fd-g1'} />); }
    return out;
  }, [view, W, H, gStep]);

  const scr = (h: number): Pt => [Math.cos(h), -Math.sin(h)];             // напрям на екрані
  const scrN = (h: number, side: number): Pt => [-Math.sin(h) * side, -Math.cos(h) * side];   // ліва нормаль на екрані × side
  // ---- позначення як на кресленні: розмірні лінії з виносними й стрілками (зовні), кути (всередині),
  //      розмір завальцювання, виноска RAL з полицею — усе без перетинів з лініями, точками і між собою ----
  const labels = (() => {
    type Kind = 'ang' | 'dim' | 'ral';
    type L = LabelReq & { t: string; cls: string; key: string; kind: Kind; A?: Pt; B?: Pt; rot?: number; tw?: number; sx?: number };
    const out: L[] = [];
    // кути — першими, по бісектрисі всередині загину
    core.segs.slice(0, -1).forEach((q, i) => {
      if (q.ang >= 179.95) return;
      const at = S(pts[i + 1]), u1 = scr(heads[i]), u2 = scr(heads[i + 1]);
      let bx = -u1[0] + u2[0], by = -u1[1] + u2[1];
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6) { bx = -u1[1]; by = u1[0]; } else { bx /= bl; by /= bl; }
      const t = r1(q.ang) + '°', bb = textBox(t, 10);
      out.push({ key: 'a' + i, t, cls: 'fd-ang', kind: 'ang', ax: at[0], ay: at[1], nx: bx, ny: by, d: angOffset(t, 10, q.ang), w: bb.w, h: bb.h });
    });
    // розмір: текст уздовж розмірної лінії, із зовнішнього боку
    const dim = (key: string, A: Pt, B: Pt, n: Pt, t: string, cls: string, dl0: number) => {
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1) return;
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
      let rot = deg(Math.atan2(uy, ux)); if (rot > 90.01) rot -= 180; if (rot <= -90.01) rot += 180;
      const bb = textBox(t, FS), c = Math.abs(Math.cos(rad(rot))), sn = Math.abs(Math.sin(rad(rot)));
      // короткий розмір — текст за кінцем розмірної лінії
      const shift = L < bb.w + 12 ? L / 2 + bb.w / 2 + 8 : 0;
      out.push({ key, t, cls, kind: 'dim', A, B, rot, ax: (A[0] + B[0]) / 2 + ux * shift, ay: (A[1] + B[1]) / 2 + uy * shift, nx: n[0], ny: n[1],
        d: dl0 + FS / 2 + 2, w: c * bb.w + sn * bb.h, h: sn * bb.w + c * bb.h });
    };
    const outer = outerSides(core.segs, pts, heads, (-e.paint) as 1 | -1);
    core.segs.forEach((q, i) => dim('d' + i, S(pts[i]), S(pts[i + 1]), scrN(heads[i], outer[i]), String(r1(q.len)), 'fd-dim' + (hi === fullIdx(i) ? ' on' : ''), 14));
    // завальцювання — розмір із зовнішнього боку петлі
    ([[hemSG, core.hemS, 'dhs'], [hemEG, core.hemE, 'dhe']] as const).forEach(([g, hm, key]) => {
      if (!g || !hm) return;
      const F = S(g.fold), C = S(g.core);
      let nx = F[0] - C[0], ny = F[1] - C[1]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      dim(key, S(g.a), S(g.b), [nx, ny], String(r1(hm.len)), 'fd-dim', 10);
    });
    // фарбований бік — виноска зі стрілкою і полицею «RAL»
    if (core.segs.length) {
      const sc = (i: number) => core.segs[i].len * (outer[i] !== e.paint ? 10 : 1);   // краще там, де розмір з іншого боку
      let m = 0; core.segs.forEach((q, i) => { if (sc(i) > sc(m)) m = i; });
      const A = S(pts[m]), B = S(pts[m + 1]), n = scrN(heads[m], e.paint);
      const P: Pt = [A[0] + (B[0] - A[0]) * 0.3, A[1] + (B[1] - A[1]) * 0.3];
      const bb = textBox('RAL', RAL_FS), tw = bb.w + 8, sx = n[0] >= 0 ? 1 : -1;
      // напрям виноски — навскіс від лінії (нормаль + трохи вгору)
      let lx = n[0] + sx * 0.5, ly = n[1] - 0.5; const ll = Math.hypot(lx, ly); lx /= ll; ly /= ll;
      out.push({ key: 'pm', t: 'RAL', cls: 'fd-ral', kind: 'ral', ax: P[0] + sx * tw / 2, ay: P[1] - RAL_FS / 2 - 2, nx: lx, ny: ly, d: 30, w: tw, h: bb.h + 4, tw, sx, A: P });
    }
    const lines: [Pt, Pt][] = core.segs.map((_, i) => [S(pts[i]), S(pts[i + 1])]);
    [hemSG, hemEG].forEach(g => { if (g) lines.push([S(g.a), S(g.b)], [S(g.fold), S(g.core)]); });
    const pos = placeLabels(lines, still ? [] : pts.map(S), out);
    const arrow = (tip: Pt, dx: number, dy: number, k: string) => {   // (dx, dy) — від вістря назад
      const a = 6, b = 1.8;
      return <path key={k} d={`M${tip[0]},${tip[1]} L${tip[0] + dx * a - dy * b},${tip[1] + dy * a + dx * b} L${tip[0] + dx * a + dy * b},${tip[1] + dy * a - dx * b} Z`} className="fd-arw" />;
    };
    return out.map((l, i) => {
      const [x, y] = pos[i];
      if (l.kind === 'ang') return <text key={l.key} x={x} y={y} className={l.cls} textAnchor="middle" dominantBaseline="central">{l.t}</text>;
      if (l.kind === 'ral') {
        const P = l.A!, sx = l.sx!, tw = l.tw!;
        const Q: Pt = [x - sx * tw / 2, y + RAL_FS / 2 + 2];          // початок полиці
        const dx = Q[0] - P[0], dy = Q[1] - P[1], dd = Math.hypot(dx, dy) || 1;
        return <g key={l.key} style={{ pointerEvents: 'none' }}>
          <line x1={P[0]} y1={P[1]} x2={Q[0]} y2={Q[1]} className="fd-dl" />
          <line x1={Q[0]} y1={Q[1]} x2={Q[0] + sx * tw} y2={Q[1]} className="fd-dl" />
          {arrow(P, dx / dd, dy / dd, 'h')}
          <text x={x} y={y} className={l.cls} textAnchor="middle" dominantBaseline="central" data-no-i18n>RAL</text>
        </g>;
      }
      // розмірна лінія на відстані (текст − пів висоти) від сторони
      const A = l.A!, B = l.B!, L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
      const tn = (x - (A[0] + B[0]) / 2) * l.nx + (y - (A[1] + B[1]) / 2) * l.ny;
      const dl = Math.max(6, tn - FS / 2 - 2);
      const A2: Pt = [A[0] + l.nx * dl, A[1] + l.ny * dl], B2: Pt = [B[0] + l.nx * dl, B[1] + l.ny * dl];
      const inside = L >= 16;
      return <g key={l.key} style={{ pointerEvents: 'none' }}>
        <line x1={A[0] + l.nx * 3} y1={A[1] + l.ny * 3} x2={A2[0] + l.nx * 3} y2={A2[1] + l.ny * 3} className="fd-dl" />
        <line x1={B[0] + l.nx * 3} y1={B[1] + l.ny * 3} x2={B2[0] + l.nx * 3} y2={B2[1] + l.ny * 3} className="fd-dl" />
        <line x1={inside ? A2[0] : A2[0] - ux * 9} y1={inside ? A2[1] : A2[1] - uy * 9} x2={inside ? B2[0] : B2[0] + ux * 9} y2={inside ? B2[1] : B2[1] + uy * 9} className="fd-dl" />
        {inside ? <>{arrow(A2, ux, uy, 'a')}{arrow(B2, -ux, -uy, 'b')}</> : <>{arrow(A2, -ux, -uy, 'a')}{arrow(B2, ux, uy, 'b')}</>}
        <text x={x} y={y} className={l.cls} textAnchor="middle" dominantBaseline="central" transform={`rotate(${l.rot} ${x} ${y})`}>{l.t}</text>
      </g>;
    });
  })();
  const hemArc = (g: NonNullable<ReturnType<typeof hemGeo>>, key: string) => {
    const P = S(g.fold), Q = S(g.core), b = scr(Math.atan2(g.bulge[1], g.bulge[0]));
    const r = Math.max(1.5, Math.hypot(Q[0] - P[0], Q[1] - P[1]) * 0.7);
    return <path key={key} d={`M${P[0]},${P[1]} C${P[0] + b[0] * r},${P[1] + b[1] * r} ${Q[0] + b[0] * r},${Q[1] + b[1] * r} ${Q[0]},${Q[1]}`} className="fd-line fd-hem" fill="none" />;
  };

  // ---- вікно ----
  const popBox = (() => {
    if (!pop) return null;
    const left = Math.max(6, Math.min(pop.x + 12, W - 236)), top = Math.max(6, Math.min(pop.y + 12, H - 190));
    const head = (t: React.ReactNode) => (
      <div className="kp-prompt-head"><span>{t}</span><button type="button" className="kp-x" onClick={() => setPop(null)} aria-label="Закрити">×</button></div>
    );
    if (pop.kind === 'seg') {
      const s = core.segs[pop.idx]; if (!s) return null;
      return (
        <div className="kp-prompt fd-pop" style={{ left, top }} onPointerDown={ev => ev.stopPropagation()}>
          {head('Сторона')}
          <label><span>Довжина, мм</span><NumIn autoFocus value={s.len} step={1} onEnter={() => setPop(null)} onChange={v => setCoreSeg(pop.idx, { len: Math.max(0.1, v) })} /></label>
          {(pop.idx === 0 || pop.idx === core.segs.length - 1) && <div className="fd-pop-btns">
            {pop.idx === 0 && (core.hemS
              ? <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => setHem('S', null)}>{core.segs.length > 1 ? 'Прибрати завальцювання' : 'Прибрати завальцювання початку'}</button>
              : <button type="button" className="btn btn-primary btn-sm" onClick={() => setHem('S', { len: HEM_LEN, dir: hemSide })}>{core.segs.length > 1 ? '⟲ Завальцювати' : '⟲ Завальцювати початок'}</button>)}
            {pop.idx === core.segs.length - 1 && (core.hemE
              ? <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => setHem('E', null)}>{core.segs.length > 1 ? 'Прибрати завальцювання' : 'Прибрати завальцювання кінця'}</button>
              : <button type="button" className="btn btn-primary btn-sm" onClick={() => setHem('E', { len: HEM_LEN, dir: hemSide })}>{core.segs.length > 1 ? '⟲ Завальцювати' : '⟲ Завальцювати кінець'}</button>)}
          </div>}
          <div className="fd-pop-btns">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => splitSeg(pop.idx)}>Розділити навпіл</button>
          </div>
        </div>
      );
    }
    const j = pop.idx, last = pts.length - 1, isEnd = j === 0 || j === last;
    const bend = j > 0 && j < last ? core.segs[j - 1] : null;
    const endKey: 'S' | 'E' = j === 0 ? 'S' : 'E';
    const hm = isEnd ? (j === 0 ? core.hemS : core.hemE) : null;
    return (
      <div className="kp-prompt fd-pop" style={{ left, top }} onPointerDown={ev => ev.stopPropagation()}>
        {head(isEnd ? (j === 0 ? 'Початок профілю' : 'Кінець профілю') : 'Загин')}
        {bend && <>
          <label><span>Внутрішній кут, °</span><NumIn autoFocus value={bend.ang} step={1} onEnter={() => setPop(null)}
            title="90° — прямий, 135° — тупий" onChange={v => setCoreSeg(j - 1, { ang: Math.max(8, Math.min(180, v)) })} /></label>
          <button type="button" className="fl-dir" onClick={() => setCoreSeg(j - 1, { dir: (-bend.dir) as 1 | -1 })}>{bend.dir > 0 ? '↺ загин уліво' : '↻ загин управо'} — змінити</button>
        </>}
        {isEnd && core.segs.length > 0 && (hm ? <>
          <label><span>Завальцювання, мм</span><NumIn autoFocus value={hm.len} step={1} onEnter={() => setPop(null)} onChange={v => setHem(endKey, { ...hm, len: Math.max(1, v) })} /></label>
          <div className="fd-pop-btns">
            <button type="button" className="fl-dir" onClick={() => setHem(endKey, { ...hm, dir: (-hm.dir) as 1 | -1 })}>⇅ На інший бік</button>
            <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => setHem(endKey, null)}>Прибрати завальцювання</button>
          </div>
        </> : <>
          <div className="fd-pop-btns">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setHem(endKey, { len: HEM_LEN, dir: hemSide })}>⟲ Завальцювати</button>
          </div>
        </>)}
        <div className="fd-pop-btns">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => continueFrom(j)}>✎ Продовжити звідси</button>
          {pts.length > 1 && <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => delPoint(j)}>Видалити точку</button>}
        </div>
      </div>
    );
  })();

  const ink = 'fd-line';
  const cur = panning ? 'grabbing' : mode === 'draw' ? 'crosshair' : 'default';

  return (
    <div className={'fd' + (still ? ' fd-still' : '')}>
      {!still && <div className="fd-tools">
        <button type="button" className={'fd-tb' + (mode === 'draw' ? ' on' : '')} onClick={() => { setPop(null); setMode(mode === 'draw' ? 'edit' : 'draw'); }} title="Клік — нова точка; подвійний клік, Enter або права кнопка — завершити">✎ Малювати</button>
        <button type="button" className={'fd-tb' + (mode === 'edit' ? ' on' : '')} onClick={finishDraw} title="Тягніть вершини; клік по стороні або вершині — розміри">↖ Редагувати</button>
        <span className="fd-sep" />
        <button type="button" className="fd-tb" onClick={flipPaint} title="Фарбована сторона — з іншого боку">◐ Колір з іншого боку</button>
        <button type="button" className={'fd-tb' + (snap ? ' on' : '')} onClick={() => setSnap(!snap)} title="Довжина кроком, кут кроком 5°. Shift — тимчасово без прив'язки">⌗ Прив'язка</button>
        <span className="fd-sep" />
        <button type="button" className="fd-tb" disabled={!undo.current.length} onClick={doUndo} title="Відмінити (Ctrl+Z)">↶</button>
        <button type="button" className="fd-tb" onClick={() => zoomBy(1.3)} title="Збільшити">＋</button>
        <button type="button" className="fd-tb" onClick={() => zoomBy(1 / 1.3)} title="Зменшити">－</button>
        <button type="button" className="fd-tb" onClick={() => fit()} title="Вмістити креслення">⊡</button>
        <button type="button" className="fd-tb" onClick={restart} title="Стерти і накреслити заново">⟲ Заново</button>
      </div>}
      <div className="fd-canvas" ref={wrapRef}>
        <svg ref={svgRef} width={W || '100%'} height={H} tabIndex={still ? undefined : 0} className="fd-svg" style={{ cursor: cur, pointerEvents: still ? 'none' : undefined }}
          onPointerDown={still ? undefined : onBgDown} onPointerMove={still ? undefined : onMove} onPointerLeave={() => setCursor(null)}
          onDoubleClick={() => { if (mode === 'draw') finishDraw(); }} onContextMenu={ev => ev.preventDefault()} onKeyDown={onKey}>
          {!still && <g>{grid}</g>}
          {/* закатки */}
          {hemSG && <g onPointerDown={mode === 'edit' ? ev => onHemDown(ev, 0) : undefined} style={{ cursor: 'pointer', pointerEvents: mode === 'draw' ? 'none' : undefined }}>{hemArc(hemSG, 'ahs')}
            <line x1={S(hemSG.a)[0]} y1={S(hemSG.a)[1]} x2={S(hemSG.b)[0]} y2={S(hemSG.b)[1]} stroke="transparent" strokeWidth={16} />
            <line x1={S(hemSG.a)[0]} y1={S(hemSG.a)[1]} x2={S(hemSG.b)[0]} y2={S(hemSG.b)[1]} className={ink + ' fd-hem' + (hi === 0 ? ' on' : '')} /></g>}
          {hemEG && <g onPointerDown={mode === 'edit' ? ev => onHemDown(ev, pts.length - 1) : undefined} style={{ cursor: 'pointer', pointerEvents: mode === 'draw' ? 'none' : undefined }}>{hemArc(hemEG, 'ahe')}
            <line x1={S(hemEG.a)[0]} y1={S(hemEG.a)[1]} x2={S(hemEG.b)[0]} y2={S(hemEG.b)[1]} stroke="transparent" strokeWidth={16} />
            <line x1={S(hemEG.a)[0]} y1={S(hemEG.a)[1]} x2={S(hemEG.b)[0]} y2={S(hemEG.b)[1]} className={ink + ' fd-hem' + (hi === nSeg - 1 ? ' on' : '')} /></g>}
          {/* сторони */}
          {core.segs.map((_, i) => {
            const A = S(pts[i]), B = S(pts[i + 1]), on = hi === fullIdx(i) || (pop?.kind === 'seg' && pop.idx === i);
            return (
              <g key={'s' + i} onPointerDown={mode === 'edit' ? ev => onSegDown(ev, i) : undefined}
                onPointerEnter={() => setHi(fullIdx(i))} onPointerLeave={() => setHi(-1)} style={{ cursor: mode === 'edit' ? 'pointer' : undefined, pointerEvents: mode === 'draw' ? 'none' : undefined }}>
                <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="transparent" strokeWidth={14} />
                <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} className={ink + (on ? ' on' : '')} />
              </g>
            );
          })}
          {labels}
          {/* попередній перегляд нової сторони */}
          {preview && lastPt && (() => {
            const A = S(lastPt), B = S(preview), L = Math.hypot(preview[0] - lastPt[0], preview[1] - lastPt[1]);
            const h = Math.atan2(preview[1] - lastPt[1], preview[0] - lastPt[0]);
            let t = lastHead == null ? null : deg(h - lastHead);
            if (t != null) { while (t > 180) t -= 360; while (t <= -180) t += 360; }
            return <g style={{ pointerEvents: 'none' }}>
              <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} className="fd-prev" />
              <circle cx={B[0]} cy={B[1]} r={3} className="fd-prev-pt" />
              <text x={B[0] + 9} y={B[1] - 9} className="fd-prev-t">{r1(L)} мм{t != null ? ` · ${r1(180 - Math.abs(t))}°` : ''}</text>
            </g>;
          })()}
          {/* вершини */}
          {!still && pts.map((p, j) => {
            const P = S(p), end = j === 0 || j === pts.length - 1;
            // у режимі малювання клік по будь-якій точці — продовжити креслення з неї
            const pick = mode === 'draw' && core.segs.length > 0 && !(j === pts.length - 1 && !fromStart) && !(j === 0 && fromStart);
            return <g key={'v' + j} onPointerDown={mode === 'edit' ? ev => startDrag(ev, j) : pick ? ev => { ev.stopPropagation(); continueFrom(j); } : undefined}
              style={{ pointerEvents: mode === 'draw' && !pick ? 'none' : undefined, cursor: mode === 'draw' ? 'pointer' : 'grab' }}>
              <circle cx={P[0]} cy={P[1]} r={13} fill="transparent" />
              <circle cx={P[0]} cy={P[1]} r={end ? 4.5 : 4} className={'fd-pt' + (end ? ' end' : '') + (pop?.kind === 'pt' && pop.idx === j ? ' on' : '')} />
            </g>;
          })}
        </svg>
        {!still && popBox}
        {!still && <div className="fd-hint">
          {mode === 'draw'
            ? (pts.length ? 'Клік — наступна точка · клік по точці профілю — продовжити з неї · подвійний клік / Enter / ПКМ — завершити · Backspace — прибрати останню · Shift — без прив\'язки' : 'Клікніть, де починається профіль')
            : 'Тягніть вершини · клік по стороні — довжина, завальцювати · по вершині — кут · колесо / два пальці — масштаб · тягніть фон — рух'}
        </div>}
      </div>
    </div>
  );
}
