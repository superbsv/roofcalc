// ============================================
// ABT Покрівля — проєкт. Порядок роботи як у «Кровля Профи» 8.15:
//   1. Реквізити замовлення і вибір типу розрахунку
//   2. Матеріал (параметри зліва, доборні справа)
//   3. Скати: шаблон / малювання, таблиця сторін з доборними, вирізи, провідник проєкту
//   4. Схема укладки листів на скаті
//   5. Специфікація
// ТЗ: docs/TZ-analog-krovlya-profi.md, розділ 13
// ============================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SlopeEditor from '../components/editor/SlopeEditor';
import LayoutScheme from '../components/layout/LayoutScheme';
import {
  Project, ProjectSettings, Slope, MaterialProfile, Point, EdgeType, CalcMode, AccessoryType,
  projectsApi, slopesApi, materialsApi, specApi, SpecItem, exportApi,
} from '../api/client';
import { EDGE_TYPES, autoEdgeTypes, edgeColor, sideLengthMm, rectHole, mirrorElement } from '../components/roof/edges';
import { useTheme } from '../components/theme/theme';
import { CALC_TYPES, calcTypeInfo } from '../components/roof/calcTypes';
import { TEMPLATES, Template, buildTemplate, templateIconPoints, sideLetter } from '../components/roof/templates';
import { materialLabel } from '../components/roof/materials';

interface Props { projectId: number; }

type Step = 'order' | 'material' | 'slope' | 'layout' | 'spec';
const STEPS: [Step, string][] = [
  ['order', 'Замовлення'],
  ['material', 'Матеріал'],
  ['slope', 'Скати'],
  ['layout', 'Укладка'],
  ['spec', 'Специфікація'],
];

const m3 = (mm: number | undefined) => ((Number(mm) || 0) / 1000).toFixed(3);
const f2 = (n: number | undefined, d = 2) => (Number(n || 0)).toLocaleString('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => new Date().toISOString().slice(0, 10);
const dateUa = (iso?: string) => (iso ? iso.split('-').reverse().join('.') : '');

// Доборні у списку сторони — як у КП: «без доборних» і комплекти в кутових дужках
const doborLabel = (t: EdgeType) => (t === 'none' ? 'без доборних' : `<${EDGE_TYPES.find(e => e.key === t)?.label || t}>`);

function modeOf(s: ProjectSettings): CalcMode {
  return s.supply === 'stock' ? (`stock${s.stock_variant || 1}` as CalcMode) : 'order';
}

// Нормалізація складських даних матеріалу: [[L, qty|null]]
function stockOf(m?: MaterialProfile): [number, number | null][] {
  const raw = (m?.stock_lengths || []) as any[];
  return raw.map(r => Array.isArray(r) ? [Number(r[0]), r[1] == null ? null : Number(r[1])] as [number, number | null]
    : typeof r === 'object' ? [Number(r.length), r.qty == null ? null : Number(r.qty)] as [number, number | null]
    : [Number(r), null] as [number, number | null]).filter(r => r[0] > 0);
}
function rangesOf(m?: MaterialProfile): [number, number][] {
  const raw = (m?.forbidden_lengths || []) as any[];
  return raw.map(r => Array.isArray(r) ? [Number(r[0]), Number(r[1])] as [number, number] : [Number(r.min), Number(r.max)] as [number, number]);
}

// Мініатюра контуру
function Thumb({ pts, w = 46, h = 30 }: { pts: Point[]; w?: number; h?: number }) {
  if (!pts || pts.length < 3) return <svg width={w} height={h} aria-hidden="true"><rect x="3" y="3" width={w - 6} height={h - 6} fill="none" stroke="currentColor" strokeDasharray="3 3" opacity=".5" /></svg>;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((w - 8) / Math.max(1, maxX - minX), (h - 8) / Math.max(1, maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  const path = pts.map(([x, y]) => `${ox + (x - minX) * k},${h - oy - (y - minY) * k}`).join(' ');
  return <svg width={w} height={h} aria-hidden="true"><polygon points={path} fill="none" stroke="var(--clr-brand)" strokeWidth="1.6" /></svg>;
}

export default function ProjectPage({ projectId }: Props) {
  const theme = useTheme();
  const [project, setProject] = useState<Project | null>(null);
  const [slopes, setSlopes] = useState<Slope[]>([]);
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [accessories, setAccessories] = useState<AccessoryType[]>([]);
  const [specItems, setSpecItems] = useState<SpecItem[]>([]);
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [info, setInfo] = useState({ name: '', client_name: '', client_phone: '', object_address: '' });
  const [step, setStep] = useState<Step>('order');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editorRev, setEditorRev] = useState(0);
  const [cutouts, setCutouts] = useState(false);
  const [hole, setHole] = useState({ x: '1.000', y: '1.000', w: '0.600', h: '0.600' });
  const [tpl, setTpl] = useState<{ t: Template; v: Record<string, string> } | null>(null);
  const [clip, setClip] = useState<Slope | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [showExplorer, setShowExplorer] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const active = slopes.find(s => s.id === activeId) || null;
  const slopesRef = useRef<Slope[]>([]);
  slopesRef.current = slopes;
  const activeIdx = active ? slopes.findIndex(s => s.id === active.id) : -1;
  const ct = calcTypeInfo(settings.calc_type);
  const material = materials.find(m => m.id === settings.material_id);
  const typeMaterials = useMemo(() => materials.filter(m => ct?.materialTypes.includes(m.type)), [materials, ct]);

  // ---------- Завантаження ----------
  useEffect(() => {
    (async () => {
      try {
        const [p, ms] = await Promise.all([projectsApi.get(projectId), materialsApi.list()]);
        setMaterials(ms.profiles);
        materialsApi.accessories().then(r => setAccessories(r.accessories)).catch(() => {});
        const st: ProjectSettings = { ...(p.project.settings || {}) };
        // Старі проєкти без реквізитів: тип розрахунку і матеріал беремо з першого ската
        const withMat = p.slopes.find(s => s.material_profile_id);
        if (!st.material_id && withMat) st.material_id = withMat.material_profile_id;
        if (!st.calc_type && st.material_id) {
          const m = ms.profiles.find(x => x.id === st.material_id);
          const c = CALC_TYPES.find(c => c.materialTypes.includes(m?.type || ''));
          if (c) st.calc_type = c.key;
        }
        st.order_no = st.order_no || String(p.project.id);
        st.order_date = st.order_date || (p.project.created_at || '').slice(0, 10) || today();
        st.currency = st.currency || 'грн';
        st.k = st.k ?? (withMat?.eave_overhang ?? 50);
        st.pk = st.pk ?? 0;
        st.direction = st.direction || 'right_left';
        st.supply = st.supply || 'order';
        st.stock_variant = st.stock_variant || 1;
        setProject(p.project);
        setSettings(st);
        setInfo({
          name: p.project.name || '', client_name: p.project.client_name || '',
          client_phone: p.project.client_phone || '', object_address: p.project.object_address || '',
        });
        setSlopes(p.slopes);
        setActiveId(p.slopes[0]?.id ?? null);
        setStep(!st.calc_type ? 'order' : !st.material_id ? 'material' : 'slope');
        setLoaded(true);
      } catch (e: any) { setError(e.message); }
    })();
  }, [projectId]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await fn(); } catch (e: any) { setError(e.message); }
    setBusy('');
  };

  const saveSettings = async (patch: Partial<ProjectSettings>, extra: Partial<Project> = {}) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const r = await projectsApi.update(projectId, { ...extra, settings: next });
    setProject(r.project);
    return next;
  };

  const replaceSlope = (s: Slope) => setSlopes(prev => prev.map(x => x.id === s.id ? { ...x, ...s } : x));

  const patchSlope = async (id: number, body: Partial<Slope>, keepCalc = false) => {
    const r = await slopesApi.update(id, body);
    setSlopes(prev => prev.map(x => x.id === id ? { ...x, ...r.slope, calc_result: keepCalc ? x.calc_result : r.slope.calc_result } : x));
    return r.slope;
  };

  // ---------- 1. Реквізити замовлення ----------
  const chooseType = (key: string) => run('type', async () => {
    const c = calcTypeInfo(key)!;
    const keepMat = material && c.materialTypes.includes(material.type) ? material.id : undefined;
    await saveSettings({ calc_type: c.key, material_id: keepMat }, {
      name: info.name.trim() || `Замовлення №${settings.order_no}`,
      client_name: info.client_name, client_phone: info.client_phone, object_address: info.object_address,
    });
    if (!info.name.trim()) setInfo(v => ({ ...v, name: `Замовлення №${settings.order_no}` }));
    setStep('material');
  });

  // ---------- 2. Матеріал → «Далі»: застосувати до всіх скатів (експрес-розрахунок КП) ----------
  const materialNext = () => run('apply', async () => {
    if (!material) return;
    const st = await saveSettings({});
    const body: Partial<Slope> = {
      material_profile_id: material.id, eave_overhang: st.k ?? 0, ridge_gap: st.pk ?? 0, calc_mode: modeOf(st),
      element_kind: ct?.facade ? 'facade' : 'roof',
    };
    const updated: Slope[] = [];
    for (const s of slopes) {
      const same = s.material_profile_id === body.material_profile_id && s.eave_overhang === body.eave_overhang
        && s.ridge_gap === body.ridge_gap && (s.calc_mode || 'order') === body.calc_mode;
      updated.push(same ? s : { ...s, ...(await slopesApi.update(s.id, body)).slope });
    }
    if (!updated.length) {
      const r = await slopesApi.create(projectId, newSlopeBody(1, st));
      updated.push(r.slope);
    }
    setSlopes(updated);
    setActiveId(cur => (cur && updated.some(s => s.id === cur) ? cur : updated[0].id));
    setEditorRev(r => r + 1);
    setStep('slope');
  });

  function newSlopeBody(n: number, st: ProjectSettings = settings): Partial<Slope> {
    return {
      name: `${ct?.facade ? 'Фасад' : 'Скат'} ${n}`, polygon_points: [], holes: [], slope_angle: ct?.facade ? 90 : 30,
      eave_overhang: st.k ?? 0, ridge_gap: st.pk ?? 0, laying_direction: st.direction || 'right_left',
      material_profile_id: st.material_id, calc_mode: modeOf(st), element_kind: ct?.facade ? 'facade' : 'roof',
    };
  }

  // ---------- 3. Скати ----------
  const addSlope = () => run('add', async () => {
    const r = await slopesApi.create(projectId, newSlopeBody(slopes.length + 1));
    setSlopes(prev => [...prev, r.slope]);
    setActiveId(r.slope.id); setCutouts(false); setEditorRev(x => x + 1); setStep('slope');
  });

  const goSlope = (id: number) => { setActiveId(id); setEditorRev(x => x + 1); setMenu(null); };

  const pts = active?.polygon_points || [];
  const edgeTypes: EdgeType[] = active?.edge_types?.length === pts.length && pts.length >= 3 ? active.edge_types : autoEdgeTypes(pts);
  const holes = active?.holes || [];

  const onPolygonChange = useCallback(async (p: Point[]) => {
    if (!activeId) return;
    try {
      const cur = slopesRef.current.find(s => s.id === activeId);
      // Перетягування вершини не змінює кількість сторін — доборні на сторонах зберігаємо
      const keep = cur?.edge_types?.length === p.length && (cur?.polygon_points?.length || 0) === p.length;
      const r = await slopesApi.update(activeId, { polygon_points: p, edge_types: p.length >= 3 ? (keep ? cur!.edge_types : autoEdgeTypes(p)) : [] });
      replaceSlope({ ...r.slope, calc_result: undefined });
    } catch (e: any) { setError(e.message); }
  }, [activeId]);

  const applyTemplate = () => run('tpl', async () => {
    if (!tpl || !active) return;
    const p = buildTemplate(tpl.t, tpl.v).map(([x, y]) => [Math.round(x * 1000), Math.round(y * 1000)] as Point);
    await patchSlope(active.id, { polygon_points: p, edge_types: autoEdgeTypes(p), holes: [] });
    setTpl(null); setEditorRev(x => x + 1);
  });

  const clearSlope = () => active && window.confirm('Очистити поле ската?') && run('clear', async () => {
    await patchSlope(active.id, { polygon_points: [], edge_types: [], holes: [] });
    setEditorRev(x => x + 1);
  });

  const setEdge = (i: number, t: EdgeType) => active && run('edge', async () => {
    const next = [...edgeTypes]; next[i] = t;
    await patchSlope(active.id, { edge_types: next });
  });

  const addHole = () => active && run('hole', async () => {
    const mm = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 1000) || 0;
    const w = mm(hole.w), h = mm(hole.h);
    if (w <= 0 || h <= 0) return;
    await patchSlope(active.id, { holes: [...holes, rectHole(mm(hole.x), mm(hole.y), w, h)] });
    setEditorRev(x => x + 1);
  });
  const removeHole = (i: number) => active && run('hole', async () => {
    await patchSlope(active.id, { holes: holes.filter((_, k) => k !== i) });
    setEditorRev(x => x + 1);
  });

  // Провідник: копіювати в буфер / дзеркально / вирізати / вставити перед-після
  const slopeCopyBody = (s: Slope, name: string): Partial<Slope> => ({
    name, polygon_points: s.polygon_points, holes: s.holes || [], edge_types: s.edge_types || [],
    element_kind: s.element_kind, slope_angle: s.slope_angle, eave_overhang: s.eave_overhang, ridge_gap: s.ridge_gap,
    laying_direction: s.laying_direction, material_profile_id: s.material_profile_id, calc_mode: s.calc_mode,
  });

  const renumber = async (list: Slope[]) => {
    const out: Slope[] = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      out.push(s.sort_order !== i + 1 ? { ...s, ...(await patchSlope(s.id, { sort_order: i + 1 }, true)), calc_result: s.calc_result } : s);
    }
    setSlopes(out);
  };

  const mirrorSlope = (s: Slope) => run('mirror', async () => {
    const m = mirrorElement(s.polygon_points, s.edge_types || [], s.holes || []);
    const r = await slopesApi.create(projectId, { ...slopeCopyBody(s, `${s.name} (дзеркально)`), polygon_points: m.pts, edge_types: m.edgeTypes, holes: m.holes });
    setSlopes(prev => [...prev, r.slope]);
    goSlope(r.slope.id);
  });

  const cutSlope = (s: Slope) => window.confirm(`Вирізати «${s.name}» у буфер?`) && run('cut', async () => {
    setClip(s);
    await slopesApi.delete(s.id);
    const next = slopes.filter(x => x.id !== s.id);
    setSlopes(next);
    if (activeId === s.id) { setActiveId(next[0]?.id ?? null); setEditorRev(x => x + 1); }
  });

  const pasteSlope = (targetId: number, where: 'before' | 'after') => clip && run('paste', async () => {
    const r = await slopesApi.create(projectId, slopeCopyBody(clip, clip.name));
    const list = slopes.filter(s => s.id !== r.slope.id);
    const at = list.findIndex(s => s.id === targetId) + (where === 'after' ? 1 : 0);
    list.splice(at, 0, r.slope);
    await renumber(list);
    goSlope(r.slope.id);
  });

  const deleteSlope = (s: Slope) => window.confirm(`Видалити «${s.name}»?`) && run('del', async () => {
    await slopesApi.delete(s.id);
    const next = slopes.filter(x => x.id !== s.id);
    setSlopes(next);
    if (activeId === s.id) { setActiveId(next[0]?.id ?? null); setEditorRev(x => x + 1); }
  });

  // ---------- 4. Укладка ----------
  const calcSlope = async (id: number) => {
    const r = await slopesApi.calculate(id);
    setSlopes(prev => prev.map(s => s.id === id ? { ...s, calc_result: r.result } : s));
    return r.result;
  };

  const showLayout = () => active && run('calc', async () => {
    if (pts.length < 3) throw new Error('Спочатку задайте контур ската: шаблон зліва або малювання мишею');
    await calcSlope(active.id);
    setStep('layout');
  });

  const layoutGo = (dir: -1 | 1) => run('calc', async () => {
    const s = slopes[activeIdx + dir];
    if (!s) return;
    setActiveId(s.id); setEditorRev(x => x + 1);
    if (!s.calc_result && (s.polygon_points?.length || 0) >= 3) await calcSlope(s.id);
  });

  const setSlopeMode = (mode: CalcMode) => active && run('calc', async () => {
    await patchSlope(active.id, { calc_mode: mode });
    await calcSlope(active.id);
  });

  const setSlopeK = (k: number) => active && run('calc', async () => {
    await patchSlope(active.id, { eave_overhang: k });
    await calcSlope(active.id);
  });

  // ---------- 5. Специфікація ----------
  const openSpec = () => run('spec', async () => {
    const r = await projectsApi.calculateAll(projectId);
    const p = await projectsApi.get(projectId);
    setSlopes(p.slopes); setProject(p.project);
    const sp = await specApi.get(projectId);
    setSpecItems(sp.items);
    if (r.skipped?.length) setError('Не розраховано — ' + r.skipped.join(' · '));
    setStep('spec');
  });

  const goStep = (s: Step) => {
    if (s === 'material' && !settings.calc_type) return;
    if ((s === 'slope' || s === 'layout') && !settings.material_id) return;
    if (s === 'layout') { showLayout(); return; }
    if (s === 'spec') { openSpec(); return; }
    if (s === 'slope') setEditorRev(x => x + 1);
    setStep(s);
  };

  if (!loaded) {
    return <div className="kp">{error ? <div className="alert alert-error">{error}</div> : <div className="text-muted">Завантаження…</div>}</div>;
  }

  const totalSlopes = slopes.length;
  const slopeNo = activeIdx >= 0 ? `${activeIdx + 1}/${totalSlopes}` : `0/${totalSlopes}`;
  const res = active?.calc_result || null;

  // ---------- Провідник проєкту ----------
  const explorer = showExplorer && (
    <aside className="kp-explorer" aria-label="Провідник проєкту">
      <div className="kp-explorer-head">
        <span>Провідник проєкту</span>
        <button type="button" className="kp-x" onClick={() => setShowExplorer(false)} aria-label="Сховати провідник">×</button>
      </div>
      <div className="kp-explorer-grid">
        {slopes.map((s, i) => (
          <button key={s.id} type="button"
            className={`kp-thumb${s.id === activeId ? ' on' : ''}${s.calc_result ? ' done' : ''}`}
            title={`${s.name}${s.calc_result ? ' — укладку розраховано' : ''}`}
            onClick={() => (step === 'layout' ? run('calc', async () => { goSlope(s.id); if (!s.calc_result && (s.polygon_points?.length || 0) >= 3) await calcSlope(s.id); }) : goSlope(s.id))}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: s.id }); }}>
            <span className="kp-thumb-n">{i + 1}</span>
            <Thumb pts={s.polygon_points} />
          </button>
        ))}
        <button type="button" className="kp-thumb kp-thumb-add" onClick={addSlope} title="Додати скат">+</button>
      </div>
      <div className="kp-explorer-hint">Права кнопка — меню ската</div>
    </aside>
  );

  const menuSlope = menu ? slopes.find(s => s.id === menu.id) : null;

  return (
    <div className="kp">
      {/* Кроки роботи як у КП */}
      <nav className="kp-steps" aria-label="Етапи розрахунку">
        {STEPS.map(([s, label], i) => {
          const enabled = s === 'order' || (s === 'material' ? !!settings.calc_type : !!settings.material_id);
          return (
            <button key={s} type="button" className={`kp-step${step === s ? ' on' : ''}`} disabled={!enabled || !!busy}
              aria-current={step === s ? 'step' : undefined} onClick={() => goStep(s)}>
              <span className="kp-step-n">{i + 1}</span>{label}
            </button>
          );
        })}
        <div className="kp-steps-meta">
          {project?.name}{ct ? ` · ${ct.label}` : ''}{material ? ` · ${material.name}` : ''}
        </div>
      </nav>

      {error && <div className="alert alert-error" role="alert">{error}<button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>Закрити</button></div>}

      {/* ===================== 1. РЕКВІЗИТИ ЗАМОВЛЕННЯ ===================== */}
      {step === 'order' && (
        <div className="kp-window kp-order">
          <section className="kp-pane">
            <h2 className="kp-h">Ввести реквізити замовлення</h2>
            <div className="kp-form">
              <label>Замовлення №</label>
              <div className="kp-inline">
                <input className="form-control" value={settings.order_no || ''} onChange={e => setSettings(s => ({ ...s, order_no: e.target.value }))} style={{ maxWidth: 120 }} />
                <span>від</span>
                <input className="form-control" type="date" value={settings.order_date || ''} onChange={e => setSettings(s => ({ ...s, order_date: e.target.value }))} style={{ maxWidth: 170 }} />
              </div>
              <label>Замовник</label>
              <input className="form-control" value={info.client_name} onChange={e => setInfo(v => ({ ...v, client_name: e.target.value }))} placeholder="ПІБ або назва компанії" />
              <label>Телефон замовника</label>
              <input className="form-control" value={info.client_phone} onChange={e => setInfo(v => ({ ...v, client_phone: e.target.value }))} />
              <label>Об'єкт</label>
              <input className="form-control" value={info.object_address} onChange={e => setInfo(v => ({ ...v, object_address: e.target.value }))} placeholder="Адреса об'єкта" />
              <label>Моя компанія</label>
              <input className="form-control" value={settings.company ?? 'ТОВ «АртБудТрейдинг»'} onChange={e => setSettings(s => ({ ...s, company: e.target.value }))} />
              <label>Відповідальний</label>
              <input className="form-control" value={settings.responsible || ''} onChange={e => setSettings(s => ({ ...s, responsible: e.target.value }))} />
              <label>Грошова одиниця</label>
              <div className="kp-inline">
                <input className="form-control" value={settings.currency || ''} onChange={e => setSettings(s => ({ ...s, currency: e.target.value }))} style={{ maxWidth: 90 }} />
                <span>курс до у.о.</span>
                <input className="form-control" type="number" min={0} step="0.01" value={settings.rate ?? ''} onChange={e => setSettings(s => ({ ...s, rate: e.target.value === '' ? undefined : +e.target.value }))} style={{ maxWidth: 110 }} placeholder="—" />
              </div>
              <label>Назва проєкту</label>
              <input className="form-control" value={info.name} onChange={e => setInfo(v => ({ ...v, name: e.target.value }))} placeholder={`Замовлення №${settings.order_no}`} />
            </div>
          </section>
          <section className="kp-pane">
            <h2 className="kp-h">Вибрати тип розрахунку</h2>
            <div className="kp-types">
              {CALC_TYPES.map(c => (
                <button key={c.key} type="button" className={`kp-type${settings.calc_type === c.key ? ' on' : ''}`}
                  onClick={() => chooseType(c.key)} disabled={!!busy}>
                  <span className="kp-type-name">{c.label}</span>
                  <span className="kp-type-hint">{c.hint}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ===================== 2. МАТЕРІАЛ ===================== */}
      {step === 'material' && ct && (
        <div className="kp-window">
          <div className="kp-toolbar">
            <button className="btn btn-secondary btn-sm" onClick={() => setStep('order')}>← Назад</button>
            <div className="kp-title">{ct.label}</div>
            <select className="form-control kp-matsel" aria-label="Матеріал" value={settings.material_id || 0}
              onChange={e => { const id = +e.target.value || undefined; const m = materials.find(x => x.id === id); setSettings(s => ({ ...s, material_id: id, coating: m?.coating_options?.[0], color: m?.color_options?.[0] })); }}>
              <option value={0}>— Оберіть матеріал з бази —</option>
              {Array.from(new Set(typeMaterials.map(m => m.manufacturer || 'Інші'))).sort().map(mf => (
                <optgroup key={mf} label={mf}>
                  {typeMaterials.filter(m => (m.manufacturer || 'Інші') === mf).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button className="btn btn-primary" onClick={materialNext} disabled={!material || !!busy || !ct.ready}>
              {busy === 'apply' ? 'Застосовую…' : 'Далі →'}
            </button>
          </div>

          {!ct.ready && <div className="alert alert-warning">Тип розрахунку «{ct.label}» ще в розробці — оберіть інший тип або поверніться пізніше.</div>}
          {!typeMaterials.length && <div className="alert alert-info">У базі немає матеріалів типу «{ct.label}». Додайте їх у розділі «Товари» (довідник матеріалів).</div>}

          {material && (
            <div className="kp-material">
              <MaterialPanel m={material} ct={ct.key} settings={settings} setSettings={setSettings} />
              <section className="kp-pane kp-dobor">
                <h3 className="kp-h3">Доборні елементи</h3>
                <div className="table-wrap">
                  <table className="kp-table">
                    <thead><tr><th>Найменування</th><th title="Ділити навпіл — сопряження двох скатів">1/2</th><th>Довжина, м</th><th>Нахлест, м</th><th>Ціна</th></tr></thead>
                    <tbody>
                      {EDGE_TYPES.filter(e => e.key !== 'none').map(e => (
                        <tr key={e.key} className="kp-kit"><td>&lt;{e.label}&gt;</td><td></td><td>-</td><td>-</td><td>-</td></tr>
                      ))}
                      {accessories.map(a => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td><input type="checkbox" readOnly checked={['ridge', 'hip', 'valley'].includes(a.calc_rule)} aria-label="1/2" /></td>
                          <td>{m3(a.working_length)}</td><td>{m3(a.default_overlap)}</td><td>{f2(Number(a.price))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-muted">Комплекти в кутових дужках &lt;…&gt; присвоюються сторонам ската. Перелік доборних редагується в довіднику.</div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* ===================== 3. СКАТ ===================== */}
      {step === 'slope' && (
        <div className="kp-window">
          <div className="kp-toolbar">
            <div className="kp-btnpair">
              <button className="btn btn-secondary btn-sm" onClick={() => setStep('material')}>Назад</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setStep('material')} title="Вихідні дані матеріалу">Вих. дані</button>
            </div>
            <div className="kp-counter"><span>{ct?.facade ? 'ФАСАД' : 'СКАТ'}:</span><b>{slopeNo}</b></div>
            {active && (
              <>
                <div className="kp-radio" role="radiogroup" aria-label="Напрямок укладки">
                  {([['left_right', 'Зліва направо'], ['right_left', 'Справа наліво']] as const).map(([v, l]) => (
                    <label key={v}><input type="radio" checked={active.laying_direction === v}
                      onChange={() => run('dir', async () => { await patchSlope(active.id, { laying_direction: v }); })} /> {l}</label>
                  ))}
                </div>
                <label className="kp-field">Уклон, °
                  <input key={`a${active.id}`} className="form-control" type="number" min={0} max={90} defaultValue={active.slope_angle}
                    onBlur={e => +e.target.value !== active.slope_angle && run('angle', async () => { await patchSlope(active.id, { slope_angle: +e.target.value }, true); })} />
                </label>
                <label className="kp-field kp-field-name">Назва
                  <input key={`n${active.id}`} className="form-control" defaultValue={active.name}
                    onBlur={e => e.target.value.trim() && e.target.value !== active.name && run('name', async () => { await patchSlope(active.id, { name: e.target.value.trim() }, true); })} />
                </label>
              </>
            )}
            <div className="kp-tools">
              <button className={`btn btn-sm ${cutouts ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCutouts(v => !v)} disabled={!active || pts.length < 3} title="Режим «Вирізи»">Вирізи</button>
              <button className="btn btn-secondary btn-sm" onClick={() => active && mirrorSlope(active)} disabled={!active || pts.length < 3} title="Зеркально відобразити і додати в кінець">Дзеркально</button>
              <button className="btn btn-secondary btn-sm" onClick={clearSlope} disabled={!active} title="Очистити поле">Очистити</button>
              <button className="btn btn-secondary btn-sm" onClick={addSlope} disabled={!!busy} title="Додати скат">+ Скат</button>
              {!showExplorer && <button className="btn btn-secondary btn-sm" onClick={() => setShowExplorer(true)}>Провідник</button>}
            </div>
            <div className="kp-btnpair">
              <button className="btn btn-primary btn-sm" onClick={showLayout} disabled={!active || pts.length < 3 || !!busy}>{busy === 'calc' ? 'Розрахунок…' : 'Розрахунок'}</button>
              <button className="btn btn-secondary btn-sm" onClick={openSpec} disabled={!slopes.length || !!busy}>{busy === 'spec' ? 'Рахуємо…' : 'Специф.'}</button>
            </div>
          </div>

          <div className={`kp-slope${showExplorer ? ' with-explorer' : ''}`}>
            {/* Ліва панель: шаблони → після вводу — таблиця сторін і доборних */}
            <aside className="kp-left">
              {!active ? (
                <div className="text-sm text-muted">Немає скатів. <button className="btn btn-primary btn-sm" onClick={addSlope}>Додати скат</button></div>
              ) : pts.length < 3 ? (
                <>
                  <div className="kp-h3">Шаблони скатів</div>
                  <div className="kp-tpls">
                    {TEMPLATES.map(t => (
                      <button key={t.id} type="button" className="kp-tpl" title={t.name}
                        onClick={() => setTpl({ t, v: Object.fromEntries(t.params.map(p => [p.key, String(p.default)])) })}>
                        <svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><polygon points={templateIconPoints(t)} fill="var(--clr-brand-pale)" stroke="currentColor" strokeWidth="1.4" /></svg>
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: 8 }}>
                    Або намалюйте контур мишею: клік — вершина, права кнопка / Enter — замкнути, Ctrl+Z — скасувати сторону.
                    Готовий контур змінюйте, перетягуючи вершини лівою кнопкою (крок 1 см, з Shift — 1 мм).
                  </div>
                </>
              ) : cutouts ? (
                <>
                  <div className="kp-h3">Вирізи</div>
                  {holes.length ? (
                    <table className="kp-table">
                      <thead><tr><th>№</th><th>Ш × В, м</th><th>X, Y</th><th></th></tr></thead>
                      <tbody>
                        {holes.map((h, i) => {
                          const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
                          return (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{m3(Math.max(...xs) - Math.min(...xs))}×{m3(Math.max(...ys) - Math.min(...ys))}</td>
                              <td>{m3(Math.min(...xs))}; {m3(Math.min(...ys))}</td>
                              <td><button className="kp-x" onClick={() => removeHole(i)} aria-label={`Видалити виріз ${i + 1}`}>×</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : <div className="text-xs text-muted">Вирізів немає.</div>}
                  <div className="kp-holeform">
                    {([['x', 'X лів. краю'], ['y', 'Y низу'], ['w', 'Ширина'], ['h', 'Висота']] as [keyof typeof hole, string][]).map(([k, l]) => (
                      <label key={k}>{l}, м<input className="form-control" inputMode="decimal" value={hole[k]} onChange={e => setHole(v => ({ ...v, [k]: e.target.value }))} /></label>
                    ))}
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={addHole} style={{ width: '100%' }}>Додати виріз</button>
                  <div className="text-xs text-muted" style={{ marginTop: 6 }}>Вирізи не мають виходити за скат і перетинатися.</div>
                </>
              ) : (
                <>
                  <div className="kp-sides-head"><span>Розмір, м</span><span>Доборний елемент</span></div>
                  {pts.map((a, i) => (
                    <div key={i} className="kp-side">
                      <b>{sideLetter(i)} =</b>
                      <span className="kp-side-len">{m3(sideLengthMm(a, pts[(i + 1) % pts.length]))}</span>
                      <select className="form-control form-control-sm" value={edgeTypes[i]} aria-label={`Доборний елемент сторони ${sideLetter(i)}`}
                        style={{ boxShadow: edgeTypes[i] !== 'none' ? `inset 3px 0 0 ${edgeColor(edgeTypes[i], theme)}` : undefined }}
                        onChange={e => setEdge(i, e.target.value as EdgeType)}>
                        {(['none', ...EDGE_TYPES.filter(e => e.key !== 'none').map(e => e.key)] as EdgeType[]).map(k => <option key={k} value={k}>{doborLabel(k)}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="text-xs text-muted" style={{ marginTop: 6 }}>Перетягніть вершину лівою кнопкою миші, щоб змінити розміри: крок 1 см, із Shift — 1 мм.</div>
                  <dl className="kp-mini">
                    <dt>Площа ската</dt><dd>{f2(polyArea(pts) / 1e6, 3)} м²</dd>
                    {holes.length > 0 && <><dt>Вирізи</dt><dd>{holes.length} шт</dd></>}
                    <dt>Матеріал</dt><dd>{materials.find(m => m.id === active.material_profile_id)?.name || '—'}</dd>
                  </dl>
                </>
              )}
            </aside>

            <div className="kp-canvas">
              {active && (
                <SlopeEditor key={`${active.id}:${editorRev}`} bare slope={active} calcResult={null}
                  onPolygonChange={onPolygonChange} edgeTypes={edgeTypes} holes={holes} />
              )}
            </div>
            {explorer}
          </div>
        </div>
      )}

      {/* ===================== 4. СХЕМА УКЛАДКИ ===================== */}
      {step === 'layout' && active && (
        <div className="kp-window">
          <div className="kp-toolbar">
            <div className="kp-btnpair">
              <button className="btn btn-secondary btn-sm" onClick={() => goStep('slope')}>Назад</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setStep('material')}>Вих. дані</button>
            </div>
            <div className="kp-counter"><span>{ct?.facade ? 'ФАСАД' : 'СКАТ'}:</span><b>{slopeNo}</b></div>
            <button className="btn btn-secondary btn-sm" onClick={() => layoutGo(-1)} disabled={activeIdx <= 0 || !!busy} aria-label="Попередній скат">◀</button>
            <button className="btn btn-secondary btn-sm" onClick={() => layoutGo(1)} disabled={activeIdx >= slopes.length - 1 || !!busy} aria-label="Наступний скат">▶</button>
            <label className="kp-field">Карнизний звис К, мм
              <input key={`k${active.id}`} className="form-control" type="number" min={0} max={500} defaultValue={active.eave_overhang}
                onBlur={e => +e.target.value !== active.eave_overhang && setSlopeK(+e.target.value)} />
            </label>
            {ct?.stock && (
              <div className="seg" role="radiogroup" aria-label="Тип розрахунку">
                {([['order', 'На замовл.'], ['stock1', 'Склад 1'], ['stock2', 'Склад 2'], ['stock3', 'Склад 3']] as [CalcMode, string][]).map(([m, l]) => {
                  const cur = active.calc_mode === 'stock' ? 'stock2' : (active.calc_mode || 'order');
                  return <button key={m} type="button" role="radio" aria-checked={cur === m} className={cur === m ? 'on' : ''}
                    disabled={!!busy || (m !== 'order' && !stockOf(materials.find(x => x.id === active.material_profile_id)).length)}
                    onClick={() => setSlopeMode(m)}>{l}</button>;
                })}
              </div>
            )}
            <div className="kp-tools">
              <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Друк</button>
              {!showExplorer && <button className="btn btn-secondary btn-sm" onClick={() => setShowExplorer(true)}>Провідник</button>}
            </div>
            <div className="kp-btnpair">
              {activeIdx < slopes.length - 1
                ? <button className="btn btn-primary btn-sm" onClick={() => layoutGo(1)} disabled={!!busy}>Далі</button>
                : <button className="btn btn-primary btn-sm" onClick={addSlope} disabled={!!busy}>+ Скат</button>}
              <button className="btn btn-secondary btn-sm" onClick={openSpec} disabled={!!busy}>{busy === 'spec' ? 'Рахуємо…' : 'Специф.'}</button>
            </div>
          </div>

          <div className={`kp-slope${showExplorer ? ' with-explorer' : ''}`}>
            <aside className="kp-left">
              <div className="kp-h3">{active.name} · {slopeNo}</div>
              {pts.map((a, i) => (
                <div key={i} className="kp-side-ro"><b>{sideLetter(i)}</b> = {m3(sideLengthMm(a, pts[(i + 1) % pts.length]))} <span>{doborLabel(edgeTypes[i])}</span></div>
              ))}
              {holes.map((h, i) => {
                const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
                return <div key={`h${i}`} className="kp-side-ro">Виріз №{i + 1}: {m3(Math.max(...xs) - Math.min(...xs))} × {m3(Math.max(...ys) - Math.min(...ys))}</div>;
              })}
              {res?.laid_by_length?.length ? (
                <>
                  <div className="kp-h3" style={{ marginTop: 12 }}>Довжини листів</div>
                  <table className="kp-table">
                    <thead><tr><th>L, м</th><th>шт</th></tr></thead>
                    <tbody>{res.laid_by_length.map(g => <tr key={g.length_mm}><td>{m3(g.length_mm)}</td><td>{g.count}</td></tr>)}</tbody>
                  </table>
                </>
              ) : null}
            </aside>

            <div className="kp-layout-main">
              {!res ? (
                <div className="empty-state"><div>Скат ще не розраховано.</div>
                  <button className="btn btn-primary" onClick={showLayout} disabled={pts.length < 3 || !!busy}>Розрахувати</button></div>
              ) : res.errors?.length ? (
                <div className="alert alert-error">{res.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
              ) : (
                <>
                  {res.warnings?.map((w, i) => <div key={i} className="alert alert-warning">{w}</div>)}
                  <LayoutScheme calcResult={res as any} polygonPoints={pts} slopeName={active.name} />
                  <div className="kp-infobar">
                    <dl>
                      <dt>Замовлення</dt><dd>№{settings.order_no} від {dateUa(settings.order_date)}</dd>
                      <dt>Lmax реальна / стандартна, м</dt><dd>{m3(res.max_real_length_mm)} / {m3(res.max_std_length_mm)}</dd>
                      <dt>Площа ската, м²</dt><dd>{f2(res.slope_area_m2, 3)}</dd>
                      <dt>Точність округлення, м</dt><dd>{m3(res.rounding_mm)}</dd>
                      <dt>Карнизний звис (К), м</dt><dd>{m3(active.eave_overhang)}</dd>
                    </dl>
                    <dl>
                      <dt>Скат №</dt><dd>{slopeNo} · {active.name}</dd>
                      <dt>Погонні метри</dt><dd>{f2(res.running_m, 3)}</dd>
                      <dt>Площа листів корисна / повна, м²</dt><dd>{f2(res.useful_area_m2, 3)} / {f2(res.total_full_area_m2, 3)}</dd>
                      <dt>Укладка</dt><dd>{active.laying_direction === 'left_right' ? 'зліва направо' : 'справа наліво'}</dd>
                      <dt>Тип розрахунку</dt><dd>{modeName(res.mode)}</dd>
                      <dt>Відсоток відходів</dt><dd><b>{f2(res.waste_pct, 1)}%</b></dd>
                    </dl>
                  </div>
                  {res.cutting?.length ? <CuttingTable rows={res.cutting} /> : null}
                  {res.alternatives && res.alternatives.length > 1 && (
                    <div className="kp-card">
                      <div className="kp-h3">Варіанти рядності (склад 1): найкращий з {res.alternatives.length}</div>
                      <table className="kp-table">
                        <thead><tr><th>№</th><th>Нижні ряди, м</th><th>Погонні метри</th></tr></thead>
                        <tbody>{res.alternatives.map((a, i) => <tr key={i} className={i === 0 ? 'kp-best' : ''}><td>{i + 1}</td><td>{a.rows.length ? a.rows.map(m3).join(' + ') : 'один ряд'}</td><td>{f2(a.running_m, 3)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                  {res.stock_usage?.length ? (
                    <div className="kp-card">
                      <div className="kp-h3">Склад</div>
                      <table className="kp-table">
                        <thead><tr><th>L, м</th><th>Потрібно</th><th>Наявність</th></tr></thead>
                        <tbody>{res.stock_usage.map(u => <tr key={u.length} className={u.available != null && u.used > u.available ? 'kp-short' : ''}><td>{m3(u.length)}</td><td>{u.used}</td><td>{u.available ?? '∞'}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            {explorer}
          </div>
        </div>
      )}

      {/* ===================== 5. СПЕЦИФІКАЦІЯ ===================== */}
      {step === 'spec' && (
        <Specification project={project} settings={settings} slopes={slopes} material={material} items={specItems}
          projectId={projectId} onBack={() => goStep('slope')} onMaterial={() => setStep('material')} />
      )}

      {/* Вікно шаблону: схема + розміри, м */}
      {tpl && (
        <div className="kp-modal" role="dialog" aria-modal="true" aria-label={tpl.t.name} onClick={() => setTpl(null)}>
          <div className="kp-modal-box" onClick={e => e.stopPropagation()}>
            <div className="kp-modal-head"><span className="kp-counter"><b>{slopeNo}</b></span><span>{tpl.t.name}</span>
              <button className="kp-x" onClick={() => setTpl(null)} aria-label="Закрити">×</button></div>
            <div className="kp-modal-body">
              <svg viewBox="0 0 40 28" className="kp-modal-pic" aria-hidden="true">
                <polygon points={templateIconPoints(tpl.t)} fill="var(--clr-brand-pale)" stroke="var(--clr-brand)" strokeWidth=".8" />
              </svg>
              <div className="kp-modal-fields">
                <div className="kp-h3">Розмір, м:</div>
                {tpl.t.params.map((p, i) => (
                  <label key={p.key}><span>{p.label}</span>
                    <input className="form-control" inputMode="decimal" autoFocus={i === 0} value={tpl.v[p.key] ?? ''}
                      onChange={e => setTpl(v => v && ({ ...v, v: { ...v.v, [p.key]: e.target.value } }))}
                      onKeyDown={e => e.key === 'Enter' && applyTemplate()} />
                  </label>
                ))}
              </div>
            </div>
            <div className="kp-modal-foot">
              <button className="btn btn-secondary" onClick={() => setTpl(null)}>Скасувати</button>
              <button className="btn btn-primary" onClick={applyTemplate}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Контекстне меню провідника */}
      {menu && menuSlope && (
        <div className="kp-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) }} role="menu" onClick={e => e.stopPropagation()}>
          <button role="menuitem" onClick={() => { setClip(menuSlope); setMenu(null); }}>Копіювати в буфер</button>
          <button role="menuitem" onClick={() => { setMenu(null); mirrorSlope(menuSlope); }} disabled={(menuSlope.polygon_points?.length || 0) < 3}>Зеркально відобразити</button>
          <button role="menuitem" onClick={() => { setMenu(null); cutSlope(menuSlope); }}>Вирізати</button>
          <button role="menuitem" onClick={() => { setMenu(null); pasteSlope(menuSlope.id, 'before'); }} disabled={!clip}>Вставити «перед»</button>
          <button role="menuitem" onClick={() => { setMenu(null); pasteSlope(menuSlope.id, 'after'); }} disabled={!clip}>Вставити «після»</button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(null); deleteSlope(menuSlope); }}>Видалити</button>
        </div>
      )}
    </div>
  );
}

// ---------- Допоміжне ----------

function polyArea(p: Point[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}

function modeName(m?: string): string {
  switch (m) {
    case 'order': return 'на замовлення';
    case 'stock': case 'stock2': return 'зі складу 2 — цілими листами, мінімум витрати';
    case 'stock1': return 'зі складу 1 — цілими листами з дотриманням рядності';
    case 'stock3': return 'зі складу 3 — розрахунковими листами з розкроєм';
    case 'fixed': return 'цілими елементами';
    case 'sheetcut': return 'з розкроєм листів';
    default: return m || '—';
  }
}

function CuttingTable({ rows }: { rows: NonNullable<Slope['calc_result']>['cutting'] }) {
  if (!rows?.length) return null;
  return (
    <div className="kp-card">
      <div className="kp-h3">Таблиця розкрою</div>
      <table className="kp-table">
        <thead><tr><th>№ листа</th><th>Довжина листа, м</th><th>Розкроїти на, м</th><th>Залишок, м</th></tr></thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i} className={c.missing ? 'kp-short' : ''}>
              <td>{c.from === c.to ? c.from : `${c.from}–${c.to}`}</td>
              <td>{m3(c.sheet_length)}{c.missing ? ' (немає на складі)' : ''}</td>
              <td>{c.cuts.map(m3).join(' + ')}</td>
              <td>{c.remainder ? m3(c.remainder) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Вікно матеріалу: ліва частина — параметри (як «Металлочерепица» у КП)
function MaterialPanel({ m, ct, settings, setSettings }: {
  m: MaterialProfile; ct: string; settings: ProjectSettings;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettings>>;
}) {
  const fixed = ct === 'piece' || ct === 'sheet';
  const stock = stockOf(m);
  const ranges = rangesOf(m);
  const canStock = (ct === 'tile' || ct === 'profile');
  const round = m.round_step || m.cut_step || 10;
  const num = (k: 'k' | 'pk') => (
    <input className="form-control" type="number" min={0} max={500} value={settings[k] ?? 0}
      onChange={e => setSettings(s => ({ ...s, [k]: +e.target.value }))} />
  );
  return (
    <section className="kp-pane kp-matpane">
      <div className="kp-matgrid">
        <MaterialSketch wave={ct === 'tile'} />
        <div className="kp-params">
          <label>Перекриття конькове ПК, мм{num('pk')}</label>
          <label>Перекриття замкове ПЗ, м<input className="form-control" readOnly value={m3(m.length_overlap)} /></label>
          {ct === 'tile' && <label>Довжина хвилі, м<input className="form-control" readOnly value={m3(m.wave_step)} /></label>}
          <label>Карнизний звис К, мм{num('k')}</label>
          <label>Повна ширина листа, м<input className="form-control" readOnly value={m3(m.full_width)} /></label>
          <label>Корисна ширина листа, м<input className="form-control" readOnly value={m3(m.useful_width)} /></label>
          {fixed && <label>Довжина листа, м<input className="form-control" readOnly value={m3(m.max_length)} /></label>}
        </div>
      </div>

      <div className="kp-matrow">
        <fieldset className="kp-fieldset">
          <legend>Напрямок укладки</legend>
          {([['left_right', 'зліва направо'], ['right_left', 'справа наліво']] as const).map(([v, l]) => (
            <label key={v}><input type="radio" checked={settings.direction === v} onChange={() => setSettings(s => ({ ...s, direction: v }))} /> {l}</label>
          ))}
        </fieldset>
        <div className="kp-params">
          <label>Покриття
            <select className="form-control" value={settings.coating || ''} onChange={e => setSettings(s => ({ ...s, coating: e.target.value }))}>
              <option value="">—</option>{(m.coating_options || []).map(o => <option key={o}>{o}</option>)}
            </select></label>
          <label>Колір
            <select className="form-control" value={settings.color || ''} onChange={e => setSettings(s => ({ ...s, color: e.target.value }))}>
              <option value="">—</option>{(m.color_options || []).map(o => <option key={o}>{o}</option>)}
            </select></label>
          <label>Ціна, {settings.currency || 'грн'} за 1 м²<input className="form-control" readOnly value={f2(m.price_per_m2)} /></label>
          <label>Мін. уклон покрівлі, °<input className="form-control" readOnly value={m.min_slope_angle} /></label>
        </div>
      </div>

      {!fixed && (
        <div className="kp-supply">
          <div className={`kp-supply-col${settings.supply !== 'stock' ? ' on' : ''}`}>
            <label className="kp-supply-title"><input type="radio" checked={settings.supply !== 'stock'} onChange={() => setSettings(s => ({ ...s, supply: 'order' }))} /> НА ЗАМОВЛЕННЯ</label>
            <div className="kp-params kp-params-2">
              <label>Lmax, м<input className="form-control" readOnly value={m3(m.max_length)} /></label>
              <label>Lmin, м<input className="form-control" readOnly value={m3(m.min_length)} /></label>
              <label>Величина округлення, м<input className="form-control" readOnly value={m3(round)} /></label>
              {m.max_std_length ? <label>Lmax стандартна, м<input className="form-control" readOnly value={m3(m.max_std_length)} /></label> : null}
            </div>
            <div className="kp-check"><input type="checkbox" readOnly checked={ranges.length > 0} /> Враховувати діапазони невиконуваних розмірів листів</div>
            {ranges.length > 0 && (
              <table className="kp-table kp-ranges">
                <thead><tr><th></th><th>«від»</th><th>«до»</th></tr></thead>
                <tbody>{ranges.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{m3(r[0])}</td><td>{m3(r[1])}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div className={`kp-supply-col${settings.supply === 'stock' ? ' on' : ''}`}>
            <label className="kp-supply-title"><input type="radio" disabled={!canStock || !stock.length} checked={settings.supply === 'stock'} onChange={() => setSettings(s => ({ ...s, supply: 'stock' }))} /> ЗІ СКЛАДУ</label>
            <table className="kp-table">
              <thead><tr><th></th><th>Довжина, м</th><th>Наявність, шт</th></tr></thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => stock[i]).map((r, i) => (
                  <tr key={i}><td>L({i + 1})</td><td>{r ? m3(r[0]) : ''}</td><td>{r ? (r[1] ?? '∞') : ''}</td></tr>
                ))}
              </tbody>
            </table>
            <fieldset className="kp-fieldset" disabled={settings.supply !== 'stock'}>
              <legend>Тип розрахунку за замовчуванням</legend>
              {([1, 2, 3] as const).map(v => (
                <label key={v}><input type="radio" checked={(settings.stock_variant || 1) === v} onChange={() => setSettings(s => ({ ...s, stock_variant: v }))} />
                  {v === 1 ? ' Цілими листами 1 (рядність)' : v === 2 ? ' Цілими листами 2 (мінімум витрати)' : ' Складськими з розкроєм 3'}</label>
              ))}
            </fieldset>
            {!stock.length && <div className="text-xs text-muted">Складські довжини не задано в довіднику.</div>}
          </div>
        </div>
      )}
      <div className="text-xs text-muted">Параметри матеріалу (ширини, довжини, склад) редагуються в довіднику «Товари». ПК, К, напрямок, покриття і колір — параметри цього проєкту.</div>
    </section>
  );
}

// Схема профілю з позначеннями ПК, ПЗ, хвиля, К (як у вікні матеріалу КП)
function MaterialSketch({ wave }: { wave: boolean }) {
  const steps = wave ? 7 : 4;
  const d: string[] = [];
  for (let i = 0; i < steps; i++) {
    const x0 = 30 + i * 28, y0 = 150 - i * 16;
    d.push(wave ? `M${x0},${y0} q10,-14 20,-10 l8,-6` : `M${x0},${y0} l28,-16`);
  }
  return (
    <svg className="kp-sketch" viewBox="0 0 260 180" role="img" aria-label="Схема параметрів листа">
      <path d="M20,165 L235,40" stroke="var(--clr-text-3)" strokeWidth="1" strokeDasharray="4 3" fill="none" />
      <path d={d.join(' ')} stroke="var(--clr-brand)" strokeWidth="3" fill="none" />
      <path d="M150,96 l60,-35" stroke="var(--clr-brand)" strokeWidth="3" fill="none" opacity=".55" />
      <line x1="215" y1="58" x2="240" y2="40" stroke="var(--clr-text)" strokeWidth="2" />
      <text x="196" y="30" className="kp-sk-t">ПК</text>
      <text x="140" y="80" className="kp-sk-t">ПЗ</text>
      {wave && <text x="70" y="105" className="kp-sk-t">хвиля</text>}
      <text x="8" y="172" className="kp-sk-t">К</text>
      <line x1="20" y1="165" x2="34" y2="157" stroke="var(--clr-text)" strokeWidth="2" />
    </svg>
  );
}

// ---------- Специфікація (структура КП 8.15, розділ 13.10 ТЗ) ----------
function Specification({ project, settings, slopes, material, items, projectId, onBack, onMaterial }: {
  project: Project | null; settings: ProjectSettings; slopes: Slope[]; material?: MaterialProfile;
  items: SpecItem[]; projectId: number; onBack: () => void; onMaterial: () => void;
}) {
  const cur = settings.currency || 'грн';
  const calc = slopes.filter(s => s.calc_result && !s.calc_result.errors?.length);
  const sum = (f: (s: Slope) => number) => calc.reduce((a, s) => a + (f(s) || 0), 0);
  const tot = {
    area: sum(s => Number(s.calc_result!.slope_area_m2)),
    useful: sum(s => Number(s.calc_result!.useful_area_m2)),
    full: sum(s => Number(s.calc_result!.total_full_area_m2 ?? s.calc_result!.order_area_m2)),
    pm: sum(s => Number(s.calc_result!.running_m)),
    sheets: sum(s => Number(s.calc_result!.total_sheets)),
  };
  const waste = tot.useful > 0 ? Math.max(0, (tot.useful - tot.area) * 100 / tot.useful) : 0;
  const lengths: Record<number, number> = {};
  calc.forEach(s => s.calc_result!.sheets_by_length.forEach(g => { lengths[g.length_mm] = (lengths[g.length_mm] || 0) + g.count; }));
  const lenRows = Object.entries(lengths).map(([l, c]) => [+l, c]).sort((a, b) => b[0] - a[0]);

  const group = (list: SpecItem[]) => {
    const map: Record<string, SpecItem> = {};
    list.forEach(i => {
      const k = i.name + '|' + i.unit + '|' + i.price;
      map[k] = map[k] ? { ...map[k], quantity: Number(map[k].quantity) + Number(i.quantity), total: Number(map[k].total) + Number(i.total) }
        : { ...i, quantity: Number(i.quantity), total: Number(i.total) };
    });
    return Object.values(map);
  };
  const sheetItems = items.filter(i => i.type === 'sheet');
  const accItems = group(items.filter(i => i.type !== 'sheet'));
  const sheetTotal = sheetItems.reduce((a, i) => a + Number(i.total), 0);
  const grand = items.reduce((a, i) => a + Number(i.total), 0);
  const ct = calcTypeInfo(settings.calc_type);

  return (
    <div className="kp-window">
      <div className="kp-toolbar">
        <div className="kp-btnpair">
          <button className="btn btn-secondary btn-sm" onClick={onBack}>Назад</button>
          <button className="btn btn-secondary btn-sm" onClick={onMaterial}>Вих. дані</button>
        </div>
        <div className="kp-tools">
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Друк</button>
          <a className="btn btn-secondary btn-sm" href={exportApi.pdf(projectId)} target="_blank" rel="noopener noreferrer">PDF</a>
          <a className="btn btn-secondary btn-sm" href={exportApi.excel(projectId)} target="_blank" rel="noopener noreferrer">Експорт XLS</a>
          <a className="btn btn-secondary btn-sm" href={exportApi.productionPdf(projectId)} target="_blank" rel="noopener noreferrer">Розкрій (виробництво)</a>
          <a className="btn btn-secondary btn-sm" href={exportApi.json(projectId)} target="_blank" rel="noopener noreferrer">JSON</a>
        </div>
      </div>

      <article className="kp-paper">
        <div className="kp-paper-head">
          <div><span>Постачальник:</span> {settings.company ?? 'ТОВ «АртБудТрейдинг»'}</div>
          <div><span>Замовник:</span> {project?.client_name || '—'}{project?.client_phone ? `, ${project.client_phone}` : ''}</div>
          {project?.object_address && <div><span>Об'єкт:</span> {project.object_address}</div>}
        </div>
        <h2 className="kp-paper-title">СПЕЦИФІКАЦІЯ</h2>
        <div className="kp-paper-sub">
          <div>Замовлення №{settings.order_no} від {dateUa(settings.order_date)}</div>
          <div>Тип розрахунку: «{ct?.label?.toUpperCase()} {settings.supply === 'stock' ? 'ЗІ СКЛАДУ' : 'НА ЗАМОВЛЕННЯ'}»</div>
        </div>
        <div className="kp-paper-mat"><span>{(ct?.facade ? 'ФАСАДНИЙ' : 'ПОКРІВЕЛЬНИЙ')} МАТЕРІАЛ:</span> <b>{material?.name || '—'}</b>{material ? ` (${materialLabel(material.type)})` : ''}</div>
        {material && (
          <dl className="kp-paper-params">
            <dt>Повна ширина листа, м</dt><dd>{m3(material.full_width)}</dd>
            <dt>ПК, м</dt><dd>{m3(settings.pk)}</dd>
            <dt>Покриття</dt><dd>{settings.coating || '—'}</dd>
            <dt>Корисна ширина листа, м</dt><dd>{m3(material.useful_width)}</dd>
            <dt>ПЗ, м</dt><dd>{m3(material.length_overlap)}</dd>
            <dt>Колір</dt><dd>{settings.color || '—'}</dd>
            {material.wave_step ? <><dt>Довжина хвилі, м</dt><dd>{m3(material.wave_step)}</dd></> : <><dt>&nbsp;</dt><dd></dd></>}
            <dt>К, м</dt><dd>{m3(settings.k)}</dd>
            <dt>&nbsp;</dt><dd></dd>
            <dt>Макс. реальна довжина листа, м</dt><dd>{m3(material.max_length)}</dd>
            <dt>Макс. стандартна довжина, м</dt><dd>{m3(calc[0]?.calc_result?.max_std_length_mm || material.max_length)}</dd>
          </dl>
        )}

        <table className="kp-table kp-paper-table">
          <thead>
            <tr><th>№ ската</th><th>Уклон, град.</th><th>S ската, м²</th><th>S корисна, м²</th><th>S повна, м²</th><th>Листів, шт</th><th>Відходи, %</th></tr>
          </thead>
          <tbody>
            {slopes.map((s, i) => {
              const r = s.calc_result;
              return (
                <tr key={s.id}>
                  <td>{i + 1}. {s.name}</td><td>{s.slope_angle}</td>
                  <td>{r ? f2(r.slope_area_m2, 3) : '—'}</td><td>{r ? f2(r.useful_area_m2, 3) : '—'}</td>
                  <td>{r ? f2(r.total_full_area_m2 ?? r.order_area_m2, 3) : '—'}</td>
                  <td>{r ? r.total_sheets : '—'}</td><td>{r ? f2(r.waste_pct, 2) : '—'}</td>
                </tr>
              );
            })}
            <tr className="tr-total"><td>Всього:</td><td></td><td>{f2(tot.area, 3)}</td><td>{f2(tot.useful, 3)}</td><td>{f2(tot.full, 3)}</td><td>{tot.sheets}</td><td>{f2(waste, 2)}</td></tr>
          </tbody>
        </table>
        {sheetTotal > 0 && <div className="kp-paper-line">Сума за покрівельний матеріал, {cur}: <b>{f2(sheetTotal)}</b></div>}

        {lenRows.length > 0 && (
          <div className="kp-lens">
            <table className="kp-table kp-lens-col">
              <thead><tr><th>Довжина, м</th><th>К-сть, шт</th></tr></thead>
              <tbody>
                {lenRows.map(([l, c]) => <tr key={l}><td>{m3(l)}</td><td>{c}</td></tr>)}
                <tr className="tr-total"><td>Всього</td><td>{lenRows.reduce((a, r) => a + r[1], 0)}</td></tr>
              </tbody>
            </table>
            <div className="kp-paper-line">Погонних метрів: <b>{f2(tot.pm, 3)}</b></div>
          </div>
        )}

        <h3 className="kp-paper-h">ДОБОРНІ ЕЛЕМЕНТИ ПОСКАТНО</h3>
        {slopes.map((s, i) => {
          const a = s.calc_result?.accessories;
          if (!a) return null;
          const parts = a.items.map(it => `${it.name} = ${it.quantity} ${it.unit}`);
          return <div key={s.id} className="kp-paper-line">Скат №{i + 1}: {parts.length ? parts.join('; ') : 'без доборних'}</div>;
        })}

        {calc.some(s => s.calc_result?.cutting?.length) && (
          <>
            <h3 className="kp-paper-h">ТАБЛИЦЯ РОЗКРОЮ</h3>
            {calc.filter(s => s.calc_result?.cutting?.length).map(s => (
              <div key={s.id}><div className="kp-paper-line">{s.name}</div><CuttingTable rows={s.calc_result!.cutting} /></div>
            ))}
          </>
        )}

        <h3 className="kp-paper-h">ДОБОРНІ ЕЛЕМЕНТИ, КОМПЛЕКТУЮЧІ — ЗАГАЛЬНА КІЛЬКІСТЬ</h3>
        <table className="kp-table kp-paper-table">
          <thead><tr><th>Найменування</th><th>Од.</th><th>Кількість</th><th>Ціна, {cur}</th><th>Сума, {cur}</th></tr></thead>
          <tbody>
            {sheetItems.length > 0 && <tr><td>{material?.name || 'Покрівельний матеріал'} — {sheetItems.reduce((a, i) => a + Number(i.quantity), 0)} листів</td><td>м²</td><td>{f2(tot.full, 3)}</td><td>{f2(material?.price_per_m2)}</td><td>{f2(sheetTotal)}</td></tr>}
            {accItems.map(i => (
              <tr key={i.name + i.price}><td>{i.name}</td><td>{i.unit}</td><td>{Number(i.quantity).toFixed(i.unit === 'шт' ? 0 : 2)}</td><td>{f2(i.price)}</td><td>{f2(i.total)}</td></tr>
            ))}
            <tr className="tr-total"><td colSpan={4}>ПІДСУМОК:</td><td>{f2(grand)}</td></tr>
          </tbody>
        </table>
        {settings.rate ? <div className="kp-paper-line">У у.о. за курсом {settings.rate}: <b>{f2(grand / settings.rate)}</b></div> : null}
        <div className="kp-paper-sign"><span>Менеджер:</span> {settings.responsible || project?.manager_name || '________________'}</div>
        {!items.length && <div className="alert alert-info">Специфікація порожня: розрахуйте хоча б один скат.</div>}
      </article>
    </div>
  );
}
