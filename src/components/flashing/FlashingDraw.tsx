// ============================================
// Креслення добору мишкою (як скати в редакторі): клік — точка, сторони з розмірами, кути загинів,
// перетягування вершин, закатки на кінцях, фарбована сторона. Модель — та сама FElem (сторони + кути),
// тож таблиця сторін і креслення завжди збігаються.
// ============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Core, FElem, Hem, Pt, coreHeads, corePts, joinCore, ptsToCore, splitCore } from './flashing';
import { segLetter } from './FlashingSvg';
import NumIn from './NumIn';

type Pop = { kind: 'seg' | 'pt'; idx: number; x: number; y: number } | null;
interface View { k: number; tx: number; ty: number }

const H = 380;
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

export default function FlashingDraw({ e, onChange, hi, setHi }:
  { e: FElem; onChange: (p: Partial<FElem>) => void; hi: number; setHi: (i: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(600);
  const [view, setView] = useState<View>({ k: 1, tx: 300, ty: 190 });
  const viewRef = useRef(view); viewRef.current = view;
  const [org, setOrg] = useState<Pt>([0, 0]);
  const [mode, setMode] = useState<'edit' | 'draw'>(e.segs.length ? 'edit' : 'draw');
  const [anchor, setAnchor] = useState<Pt | null>(null);       // перша точка порожнього профілю
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState(true);
  const [pop, setPop] = useState<Pop>(null);
  const [panning, setPanning] = useState(false);
  const undo = useRef<Pick<FElem, 'segs' | 'start' | 'paint'>[]>([]);
  const [, force] = useState(0);
  const popEdited = useRef(false);

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
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)));
    ro.observe(el); setW(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // ---- вмістити креслення ----
  const fit = useCallback((w = W) => {
    const all: Pt[] = pts.length ? [...pts] : [[0, 0], [200, 150]];
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 60;
    const k = Math.max(0.05, Math.min(20, Math.min((w - pad * 2) / Math.max(20, maxX - minX), (H - pad * 2) / Math.max(20, maxY - minY))));
    setView({ k, tx: w / 2 - ((minX + maxX) / 2) * k, ty: H / 2 + ((minY + maxY) / 2) * k });
  }, [pts, W]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && W > 280) { fitted.current = true; fit(W); } }, [W, fit]);

  const S = (p: Pt): Pt => [view.tx + p[0] * view.k, view.ty - p[1] * view.k];
  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect(), v = viewRef.current;
    return [(cx - r.left - v.tx) / v.k, (v.ty - (cy - r.top)) / v.k];
  };

  // ---- прив'язка: довжина кроком, кут кроком 5° відносно попередньої сторони ----
  const lenStep = view.k >= 3 ? 1 : view.k >= 0.8 ? 5 : 10;
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
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Рух креслення з порожнього місця; без руху — onClick
  const startPan = (ev: React.PointerEvent, onClick?: () => void) => {
    const x0 = ev.clientX, y0 = ev.clientY, v0 = viewRef.current;
    let moved = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x0, dy = m.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) { moved = true; setPanning(true); }
      if (moved) setView({ ...v0, tx: v0.tx + dx, ty: v0.ty + dy });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setPanning(false); if (!moved) onClick?.(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // ---- малювання ----
  const lastPt = pts[pts.length - 1];
  const lastHead = core.segs.length ? heads[heads.length - 1] : null;
  const addPoint = (p: Pt) => {
    if (!pts.length) { setAnchor(p); setOrg(p); return; }
    if (Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1]) < 0.5) return;
    pushUndo();
    commitPts([...pts, p]);
    setAnchor(null);
  };
  const finishDraw = () => { setMode('edit'); setCursor(null); if (!core.segs.length) setAnchor(null); };
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
      if (!moved && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) > 3) { moved = true; pushUndo(); setPop(null); }
      if (!moved) return;
      const raw = toWorld(m.clientX, m.clientY), free = m.shiftKey;
      const np = j > 0 ? snapFrom(base[j - 1], raw, j >= 2 ? hd[j - 2] : null, free)
        : base.length > 1 ? snapFrom(base[1], raw, hd.length > 1 ? hd[1] + Math.PI : null, free) : raw;
      const p = base.map(q => [...q] as Pt); p[j] = np;
      commitPts(p);
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved) { const r = wrapRef.current!.getBoundingClientRect(); openPop('pt', j, m.clientX - r.left, m.clientY - r.top); }
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
  const flipPaint = () => { pushUndo(); onChange({ paint: (-e.paint) as 1 | -1 }); };

  // ---- клавіші ----
  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); return; }
    if (ev.key === 'Escape' || ev.key === 'Enter') { if (pop) setPop(null); else if (mode === 'draw') finishDraw(); }
    if (ev.key === 'Backspace' && mode === 'draw' && pts.length) { ev.preventDefault(); delPoint(pts.length - 1); setMode('draw'); }
  };

  // ---- геометрія для малювання ----
  const gapW = 7 / view.k;
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

  // сітка
  const gStep = GRID_STEPS.find(s => s * view.k >= 9) || 1000;
  const grid = useMemo(() => {
    const out: React.ReactElement[] = [];
    const x0 = Math.floor((-view.tx / view.k) / gStep), x1 = Math.ceil(((W - view.tx) / view.k) / gStep);
    const y0 = Math.floor(((view.ty - H) / view.k) / gStep), y1 = Math.ceil((view.ty / view.k) / gStep);
    for (let i = x0; i <= x1 && out.length < 600; i++) { const x = view.tx + i * gStep * view.k; out.push(<line key={'x' + i} x1={x} y1={0} x2={x} y2={H} className={i % 5 === 0 ? 'fd-g2' : 'fd-g1'} />); }
    for (let i = y0; i <= y1 && out.length < 1200; i++) { const y = view.ty - i * gStep * view.k; out.push(<line key={'y' + i} x1={0} y1={y} x2={W} y2={y} className={i % 5 === 0 ? 'fd-g2' : 'fd-g1'} />); }
    return out;
  }, [view, W, gStep]);

  const off = 4;
  const scr = (h: number): Pt => [Math.cos(h), -Math.sin(h)];             // напрям на екрані
  const scrN = (h: number, side: number): Pt => [-Math.sin(h) * side, -Math.cos(h) * side];   // ліва нормаль на екрані × side
  const paintLine = (a: Pt, b: Pt, h: number, key: string) => {
    const A = S(a), B = S(b), n = scrN(h, e.paint);
    return <line key={key} x1={A[0] + n[0] * off} y1={A[1] + n[1] * off} x2={B[0] + n[0] * off} y2={B[1] + n[1] * off} className="fd-paint" />;
  };
  const dimLabel = (a: Pt, b: Pt, h: number, text: React.ReactNode, key: string, on: boolean, d = 13) => {
    const A = S(a), B = S(b), n = scrN(h, -e.paint);
    return <text key={key} x={(A[0] + B[0]) / 2 + n[0] * d} y={(A[1] + B[1]) / 2 + n[1] * d} className={'fd-dim' + (on ? ' on' : '')} textAnchor="middle" dominantBaseline="middle">{text}</text>;
  };
  const hemArc = (g: NonNullable<ReturnType<typeof hemGeo>>, key: string) => {
    const P = S(g.fold), Q = S(g.core), b = scr(Math.atan2(g.bulge[1], g.bulge[0]));
    const r = Math.max(2, Math.hypot(Q[0] - P[0], Q[1] - P[1]) * 0.7);
    return <path key={key} d={`M${P[0]},${P[1]} C${P[0] + b[0] * r},${P[1] + b[1] * r} ${Q[0] + b[0] * r},${Q[1] + b[1] * r} ${Q[0]},${Q[1]}`} className="fd-line" fill="none" />;
  };
  const nSeg = e.segs.length;
  const fullIdx = (i: number) => i + hs;

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
          {head(<>Сторона <b>{segLetter(fullIdx(pop.idx))}</b></>)}
          <label><span>Довжина, мм</span><NumIn autoFocus value={s.len} step={1} onEnter={() => setPop(null)} onChange={v => setCoreSeg(pop.idx, { len: Math.max(0.1, v) })} /></label>
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
          <label><span>Закатка (завальцювання), мм</span><NumIn autoFocus value={hm.len} step={1} onEnter={() => setPop(null)} onChange={v => setHem(endKey, { ...hm, len: Math.max(1, v) })} /></label>
          <div className="fd-pop-btns">
            <button type="button" className="fl-dir" onClick={() => setHem(endKey, { ...hm, dir: (-hm.dir) as 1 | -1 })}>⇅ На інший бік</button>
            <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => setHem(endKey, null)}>Прибрати закатку</button>
          </div>
        </> : <>
          <span className="fd-pop-sub">Закатка (завальцювання краю):</span>
          <div className="fd-pop-btns">
            <button type="button" className="fl-dir" onClick={() => setHem(endKey, { len: 12, dir: 1 })}>+ закатка ↺</button>
            <button type="button" className="fl-dir" onClick={() => setHem(endKey, { len: 12, dir: -1 })}>+ закатка ↻</button>
          </div>
        </>)}
        <div className="fd-pop-btns">
          {j === last && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPop(null); setMode('draw'); }}>✎ Продовжити звідси</button>}
          {pts.length > 1 && <button type="button" className="btn btn-ghost btn-sm fl-del" onClick={() => delPoint(j)}>Видалити точку</button>}
        </div>
      </div>
    );
  })();

  const ink = 'fd-line';
  const cur = panning ? 'grabbing' : mode === 'draw' ? 'crosshair' : 'default';

  return (
    <div className="fd">
      <div className="fd-tools">
        <button type="button" className={'fd-tb' + (mode === 'draw' ? ' on' : '')} onClick={() => { setPop(null); setMode(mode === 'draw' ? 'edit' : 'draw'); }} title="Клік — нова точка; подвійний клік, Enter або права кнопка — завершити">✎ Малювати</button>
        <button type="button" className={'fd-tb' + (mode === 'edit' ? ' on' : '')} onClick={finishDraw} title="Тягніть вершини; клік по стороні або вершині — розміри">↖ Редагувати</button>
        <span className="fd-sep" />
        <button type="button" className="fd-tb" onClick={flipPaint} title="Фарбована сторона — з іншого боку">◐ Колір з іншого боку</button>
        <button type="button" className={'fd-tb' + (snap ? ' on' : '')} onClick={() => setSnap(!snap)} title="Довжина кроком, кут кроком 5°. Shift — тимчасово без прив'язки">⌗ Прив'язка</button>
        <span className="fd-sep" />
        <button type="button" className="fd-tb" disabled={!undo.current.length} onClick={doUndo} title="Відмінити (Ctrl+Z)">↶</button>
        <button type="button" className="fd-tb" onClick={() => fit()} title="Вмістити креслення">⊡</button>
        <button type="button" className="fd-tb" onClick={restart} title="Стерти і накреслити заново">⟲ Заново</button>
      </div>
      <div className="fd-canvas" ref={wrapRef}>
        <svg ref={svgRef} width={W} height={H} tabIndex={0} className="fd-svg" style={{ cursor: cur }}
          onPointerDown={onBgDown} onPointerMove={onMove} onPointerLeave={() => setCursor(null)}
          onDoubleClick={() => { if (mode === 'draw') finishDraw(); }} onContextMenu={ev => ev.preventDefault()} onKeyDown={onKey}>
          <g>{grid}</g>
          {/* фарбована сторона */}
          {core.segs.map((_, i) => paintLine(pts[i], pts[i + 1], heads[i], 'p' + i))}
          {hemSG && paintLine(hemSG.a, hemSG.b, hemSG.h, 'phs')}
          {hemEG && paintLine(hemEG.a, hemEG.b, hemEG.h, 'phe')}
          {/* закатки */}
          {hemSG && <>{hemArc(hemSG, 'ahs')}<line x1={S(hemSG.a)[0]} y1={S(hemSG.a)[1]} x2={S(hemSG.b)[0]} y2={S(hemSG.b)[1]} className={ink + (hi === 0 ? ' on' : '')} /></>}
          {hemEG && <>{hemArc(hemEG, 'ahe')}<line x1={S(hemEG.a)[0]} y1={S(hemEG.a)[1]} x2={S(hemEG.b)[0]} y2={S(hemEG.b)[1]} className={ink + (hi === nSeg - 1 ? ' on' : '')} /></>}
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
          {/* розміри */}
          {core.segs.map((s, i) => dimLabel(pts[i], pts[i + 1], heads[i], <><tspan className="fd-l">{segLetter(fullIdx(i))}</tspan> {r1(s.len)}</>, 'd' + i, hi === fullIdx(i)))}
          {hemSG && core.hemS && dimLabel(hemSG.a, hemSG.b, hemSG.h, <><tspan className="fd-l">{segLetter(0)}</tspan> ⟲{r1(core.hemS.len)}</>, 'dhs', hi === 0, 15)}
          {hemEG && core.hemE && dimLabel(hemEG.a, hemEG.b, hemEG.h, <><tspan className="fd-l">{segLetter(nSeg - 1)}</tspan> ⟲{r1(core.hemE.len)}</>, 'dhe', hi === nSeg - 1, 15)}
          {/* кути */}
          {core.segs.slice(0, -1).map((s, i) => {
            const at = S(pts[i + 1]), u1 = scr(heads[i]), u2 = scr(heads[i + 1]);
            let bx = -u1[0] + u2[0], by = -u1[1] + u2[1];
            const bl = Math.hypot(bx, by);
            if (bl < 1e-6) { bx = -u1[1]; by = u1[0]; } else { bx /= bl; by /= bl; }
            return <text key={'a' + i} x={at[0] + bx * 20} y={at[1] + by * 20} className="fd-ang" textAnchor="middle" dominantBaseline="middle">{r1(s.ang)}°</text>;
          })}
          {/* попередній перегляд нової сторони */}
          {preview && lastPt && (() => {
            const A = S(lastPt), B = S(preview), L = Math.hypot(preview[0] - lastPt[0], preview[1] - lastPt[1]);
            const h = Math.atan2(preview[1] - lastPt[1], preview[0] - lastPt[0]);
            let t = lastHead == null ? null : deg(h - lastHead);
            if (t != null) { while (t > 180) t -= 360; while (t <= -180) t += 360; }
            return <g style={{ pointerEvents: 'none' }}>
              <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} className="fd-prev" />
              <circle cx={B[0]} cy={B[1]} r={3} className="fd-prev-pt" />
              <text x={B[0] + 10} y={B[1] - 10} className="fd-prev-t">{r1(L)} мм{t != null ? ` · ${r1(180 - Math.abs(t))}°` : ''}</text>
            </g>;
          })()}
          {/* вершини */}
          {pts.map((p, j) => {
            const P = S(p), end = j === 0 || j === pts.length - 1;
            return <circle key={'v' + j} cx={P[0]} cy={P[1]} r={end ? 4.5 : 4} className={'fd-pt' + (end ? ' end' : '') + (pop?.kind === 'pt' && pop.idx === j ? ' on' : '')}
              onPointerDown={mode === 'edit' ? ev => startDrag(ev, j) : undefined} style={{ pointerEvents: mode === 'draw' ? 'none' : undefined, cursor: 'grab' }} />;
          })}
        </svg>
        {popBox}
        <div className="fd-hint">
          {mode === 'draw'
            ? (pts.length ? 'Клік — наступна точка · подвійний клік / Enter / ПКМ — завершити · Backspace — прибрати останню · Shift — без прив\'язки' : 'Клікніть, де починається профіль')
            : 'Тягніть вершини · клік по стороні — довжина · по вершині — кут, закатка · колесо — масштаб · тягніть фон — рух'}
        </div>
      </div>
    </div>
  );
}
