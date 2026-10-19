// ============================================
// ABT Покрівля — сторінка проєкту
// Структура як у «Кровля Профи»: провідник проєкту (покрівля / фасади / вузли проєкту)
// + режими елемента: Форма · Матеріал · Укладка · Доборні.
// ТЗ: docs/TZ-analog-krovlya-profi.md
// ============================================

import React, { useEffect, useState, useCallback } from 'react';
import SlopeEditor from '../components/editor/SlopeEditor';
import LayoutScheme from '../components/layout/LayoutScheme';
import {
  Project, Slope, CalcResult, MaterialProfile, Point, EdgeType,
  projectsApi, slopesApi, materialsApi, specApi, SpecItem, exportApi
} from '../api/client';
import { EDGE_TYPES, autoEdgeTypes, edgeColor, edgeLabel, sideLengthMm, rectHole, mirrorElement } from '../components/roof/edges';
import { useTheme } from '../components/theme/theme';

interface Props { projectId: number; }

type Kind = 'roof' | 'facade';
type Node =
  | { type: 'element'; id: number }
  | { type: 'dobor' }
  | { type: 'estimate' }
  | { type: 'reports' };
type Mode = 'form' | 'material' | 'layout' | 'dobor';

const MODES: [Mode, string, string][] = [
  ['form',     '1', 'Форма'],
  ['material', '2', 'Матеріал'],
  ['layout',   '3', 'Укладка'],
  ['dobor',    '4', 'Доборні'],
];

const kindOf = (s: Slope): Kind => (s.element_kind === 'facade' ? 'facade' : 'roof');
const fmt = (n: number | undefined, d = 2) => (Number(n || 0)).toLocaleString('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d });

// Мініатюра контуру для провідника
function Thumb({ pts, active }: { pts: Point[]; active: boolean }) {
  if (!pts || pts.length < 3) {
    return <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true"><rect x="2" y="2" width="30" height="20" fill="none" stroke="var(--clr-text-3)" strokeDasharray="3 3" /></svg>;
  }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min(30 / Math.max(1, maxX - minX), 20 / Math.max(1, maxY - minY));
  const path = pts.map(([x, y]) => `${2 + (x - minX) * k},${22 - (y - minY) * k}`).join(' ');
  return (
    <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
      <polygon points={path} fill={active ? 'var(--clr-brand)' : 'none'} stroke={active ? 'var(--clr-brand)' : 'var(--clr-text-3)'} strokeWidth="1.5" />
    </svg>
  );
}

export default function ProjectPage({ projectId }: Props) {
  const theme = useTheme();
  const [project,   setProject]   = useState<Project | null>(null);
  const [slopes,    setSlopes]    = useState<Slope[]>([]);
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [specItems, setSpecItems] = useState<SpecItem[]>([]);
  const [node,      setNode]      = useState<Node | null>(null);
  const [mode,      setMode]      = useState<Mode>('form');
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [params,    setParams]    = useState({
    name: 'Скат 1', slope_angle: 30, eave_overhang: 50, ridge_gap: 50,
    laying_direction: 'right_left' as Slope['laying_direction'],
  });
  const [projectMaterialId, setProjectMaterialId] = useState<number>(0);
  const [manufacturer, setManufacturer] = useState<string>('');
  const [applyingMaterial, setApplyingMaterial] = useState(false);
  const [hole, setHole] = useState({ x: 1000, y: 1000, w: 600, h: 600 });

  const active = node?.type === 'element' ? slopes.find(s => s.id === node.id) || null : null;

  // ---------- Завантаження ----------
  const reload = useCallback(async (keepId?: number) => {
    const res = await projectsApi.get(projectId);
    setProject(res.project);
    setSlopes(res.slopes);
    const pick = (keepId && res.slopes.find(s => s.id === keepId)) || res.slopes[0];
    if (pick) selectElement(pick); else setNode({ type: 'dobor' });
    return res.slopes;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    reload().then(sl => {
      const withMat = sl.find(s => s.material_profile_id);
      if (withMat?.material_profile_id) setProjectMaterialId(withMat.material_profile_id);
    }).catch(e => setError(e.message));
    materialsApi.list().then(res => {
      setMaterials(res.profiles);
    });
  }, [reload]);

  useEffect(() => {
    if (!projectMaterialId || manufacturer) return;
    const m = materials.find(x => x.id === projectMaterialId);
    if (m?.manufacturer) setManufacturer(m.manufacturer);
  }, [materials, projectMaterialId, manufacturer]);

  function selectElement(s: Slope) {
    setNode({ type: 'element', id: s.id });
    setCalcResult(s.calc_result || null);
    setParams({
      name: s.name, slope_angle: s.slope_angle, eave_overhang: s.eave_overhang,
      ridge_gap: s.ridge_gap, laying_direction: s.laying_direction,
    });
  }

  const loadSpec = async () => {
    try { const r = await specApi.get(projectId); setSpecItems(r.items); } catch {}
  };

  const replaceSlope = (s: Slope) => setSlopes(prev => prev.map(x => x.id === s.id ? { ...x, ...s } : x));

  // Оновити поля елемента; будь-яка зміна скидає розрахунок (так робить і бекенд)
  const patch = async (body: Partial<Slope>) => {
    if (!active) return;
    try {
      const res = await slopesApi.update(active.id, body);
      replaceSlope({ ...res.slope, calc_result: undefined });
      setCalcResult(null);
    } catch (e: any) { setError(e.message); }
  };

  // ---------- Елементи: додати / копіювати / дзеркало / видалити ----------
  const addElement = async (kind: Kind) => {
    try {
      const n = slopes.filter(s => kindOf(s) === kind).length + 1;
      const res = await slopesApi.create(projectId, {
        name: kind === 'roof' ? `Скат ${n}` : `Фасад ${n}`,
        polygon_points: [], slope_angle: kind === 'roof' ? 30 : 90,
        eave_overhang: 50, ridge_gap: 50, laying_direction: 'right_left',
        material_profile_id: projectMaterialId || undefined,
        element_kind: kind,
      });
      setSlopes(prev => [...prev, res.slope]);
      selectElement(res.slope); setMode('form');
    } catch (e: any) { setError(e.message); }
  };

  const copyElement = async () => {
    if (!active) return;
    try {
      const res = await slopesApi.create(projectId, {
        name: `${active.name} (копія)`,
        polygon_points: active.polygon_points, holes: active.holes || [],
        edge_types: active.edge_types || [], element_kind: kindOf(active),
        slope_angle: active.slope_angle, eave_overhang: active.eave_overhang, ridge_gap: active.ridge_gap,
        laying_direction: active.laying_direction, material_profile_id: active.material_profile_id,
      });
      setSlopes(prev => [...prev, res.slope]);
      selectElement(res.slope);
    } catch (e: any) { setError(e.message); }
  };

  const mirrorActive = async () => {
    if (!active || (active.polygon_points?.length || 0) < 3) return;
    const m = mirrorElement(active.polygon_points, active.edge_types || [], active.holes || []);
    await patch({ polygon_points: m.pts, edge_types: m.edgeTypes, holes: m.holes });
  };

  const deleteActive = async () => {
    if (!active || !window.confirm(`Видалити «${active.name}»?`)) return;
    try {
      await slopesApi.delete(active.id);
      const next = slopes.filter(s => s.id !== active.id);
      setSlopes(next);
      if (next[0]) selectElement(next[0]); else { setNode({ type: 'dobor' }); setCalcResult(null); }
    } catch (e: any) { setError(e.message); }
  };

  // ---------- Форма ----------
  const onPolygonChange = useCallback(async (pts: Point[]) => {
    if (!active || pts.length < 3) return;
    try {
      // Нова геометрія: типи ребер визначаємо заново автоматично
      const res = await slopesApi.update(active.id, { polygon_points: pts, edge_types: autoEdgeTypes(pts) });
      replaceSlope({ ...res.slope, calc_result: undefined });
      setCalcResult(null);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const pts = active?.polygon_points || [];
  const edgeTypes: EdgeType[] = active?.edge_types?.length === pts.length && pts.length >= 3
    ? active.edge_types : autoEdgeTypes(pts);
  const holes = active?.holes || [];

  const setEdge = (i: number, t: EdgeType) => {
    const next = [...edgeTypes]; next[i] = t;
    patch({ edge_types: next });
  };
  const addHole = () => {
    if (hole.w <= 0 || hole.h <= 0) return;
    patch({ holes: [...holes, rectHole(+hole.x, +hole.y, +hole.w, +hole.h)] });
  };
  const removeHole = (i: number) => patch({ holes: holes.filter((_, k) => k !== i) });

  const saveParams = async () => {
    if (!active) return;
    setSaving(true);
    await patch(params);
    setSaving(false);
  };

  // ---------- Матеріал ----------
  const manufacturers = Array.from(new Set(materials.map(m => (m.manufacturer || '').trim()).filter(Boolean))).sort();
  const filteredMaterials = manufacturer ? materials.filter(m => (m.manufacturer || '').trim() === manufacturer) : materials;
  const projectMaterial = materials.find(m => m.id === projectMaterialId);
  const elementMaterial = materials.find(m => m.id === active?.material_profile_id);

  const applyMaterialToAll = async (materialId: number) => {
    setProjectMaterialId(materialId);
    if (!materialId || !slopes.length) return;
    setApplyingMaterial(true); setError('');
    try {
      const updated: Slope[] = [];
      for (const s of slopes) {
        const res = await slopesApi.update(s.id, { material_profile_id: materialId });
        updated.push(res.slope);
      }
      setSlopes(updated);
      setCalcResult(null);
    } catch (e: any) { setError(e.message); }
    setApplyingMaterial(false);
  };

  const setElementMaterial = (materialId: number) => patch({ material_profile_id: materialId || undefined });

  // ---------- Розрахунок ----------
  const calculate = async () => {
    if (!active) return;
    setCalculating(true); setError('');
    try {
      const res = await slopesApi.calculate(active.id);
      setCalcResult(res.result);
      setSlopes(prev => prev.map(s => s.id === active.id ? { ...s, calc_result: res.result } : s));
      setMode('layout');
    } catch (e: any) { setError(e.message); }
    setCalculating(false);
  };

  const calculateAll = async () => {
    setCalculating(true); setError('');
    try {
      await projectsApi.calculateAll(projectId);
      await reload(active?.id);
      await loadSpec();
    } catch (e: any) { setError(e.message); }
    setCalculating(false);
  };

  // ---------- Зведення по проєкту ----------
  const groupItems = (items: SpecItem[]) => {
    const map: Record<string, SpecItem> = {};
    items.forEach(i => {
      const key = i.name + '|' + i.unit;
      map[key] = map[key]
        ? { ...map[key], quantity: Number(map[key].quantity) + Number(i.quantity), total: Number(map[key].total) + Number(i.total) }
        : { ...i, quantity: Number(i.quantity), total: Number(i.total) };
    });
    return Object.values(map);
  };
  const sheetItems = specItems.filter(i => i.type === 'sheet');
  const accItems   = groupItems(specItems.filter(i => i.type === 'accessory'));
  const fastItems  = groupItems(specItems.filter(i => i.type === 'fastener'));
  const totalPrice = specItems.reduce((s, i) => s + Number(i.total || 0), 0);

  const projectEdges = slopes.reduce((acc, s) => {
    const a = s.calc_result?.accessories;
    if (!a) return acc;
    acc.eave += a.eave_length_m || 0; acc.ridge += a.ridge_length_m || 0; acc.hip += a.hip_length_m || 0;
    acc.valley += a.valley_length_m || 0; acc.end += a.end_length_m || 0; acc.abutment += a.abutment_length_m || 0;
    return acc;
  }, { eave: 0, ridge: 0, hip: 0, valley: 0, end: 0, abutment: 0 } as Record<string, number>);

  const roofEls   = slopes.filter(s => kindOf(s) === 'roof');
  const facadeEls = slopes.filter(s => kindOf(s) === 'facade');
  const totalArea = slopes.reduce((s, x) => s + Number(x.calc_result?.slope_area_m2 || 0), 0);
  const totalSheets = slopes.reduce((s, x) => s + Number(x.calc_result?.total_sheets || 0), 0);

  const openNode = (n: Node) => { setNode(n); if (n.type !== 'element') loadSpec(); };

  // ---------- Рендер ----------
  const explorerItem = (s: Slope) => {
    const on = active?.id === s.id;
    return (
      <button key={s.id} type="button" className={`px-item${on ? ' active' : ''}`} onClick={() => selectElement(s)}>
        <Thumb pts={s.polygon_points} active={on} />
        <span className="px-item-name">{s.name}</span>
        <span className="px-item-meta">
          {s.calc_result ? `${s.calc_result.total_sheets} л.` : (s.polygon_points?.length >= 3 ? '—' : 'порожній')}
        </span>
      </button>
    );
  };

  return (
    <div className="project-shell">
      {/* Шапка проєкту */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="page-title">{project?.name || 'Проєкт'}</div>
          <div className="page-subtitle">
            {project?.client_name && `Клієнт: ${project.client_name} · `}
            {project?.object_address}
            {totalArea > 0 && ` · ${fmt(totalArea, 1)} м² · ${totalSheets} листів`}
          </div>
        </div>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={calculateAll} disabled={calculating || !slopes.length}>
            {calculating ? 'Рахуємо…' : 'Розрахувати проєкт'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}<button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setError('')}>Закрити</button></div>}

      <div className="project-grid">
        {/* ===== Провідник проєкту ===== */}
        <nav className="px" aria-label="Провідник проєкту">
          <div className="px-section">
            <div className="px-title">Покрівля <span>{roofEls.length}</span></div>
            {roofEls.map(explorerItem)}
            <button type="button" className="px-add" onClick={() => addElement('roof')}>+ Скат</button>
          </div>
          <div className="px-section">
            <div className="px-title">Фасади <span>{facadeEls.length}</span></div>
            {facadeEls.map(explorerItem)}
            <button type="button" className="px-add" onClick={() => addElement('facade')}>+ Фасад</button>
          </div>
          <div className="px-section">
            <div className="px-title">Проєкт</div>
            {([
              ['dobor', 'Доборні елементи'],
              ['estimate', 'Кошторис'],
              ['reports', 'Звіти і друк'],
            ] as [Node['type'], string][]).map(([t, label]) => (
              <button key={t} type="button" className={`px-item px-node${node?.type === t ? ' active' : ''}`} onClick={() => openNode({ type: t } as Node)}>
                <span className="px-item-name">{label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* ===== Робоча область ===== */}
        <section className="workspace" aria-live="polite">
          {active && (
            <>
              <div className="ws-head">
                <div className="ws-title">
                  <span className="ws-kind">{kindOf(active) === 'roof' ? 'Скат' : 'Фасад'}</span>
                  {active.name}
                </div>
                <div className="ws-actions">
                  <button className="btn btn-secondary btn-sm" onClick={copyElement}>Копіювати</button>
                  <button className="btn btn-secondary btn-sm" onClick={mirrorActive} disabled={pts.length < 3}>Дзеркало</button>
                  <button className="btn btn-danger btn-sm" onClick={deleteActive}>Видалити</button>
                </div>
              </div>

              <div className="tabs" style={{ marginBottom: 0 }} role="tablist">
                {MODES.map(([m, num, label]) => (
                  <button key={m} role="tab" aria-selected={mode === m} className={`tab-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                    <span className="tab-num">{num}</span>{label}
                  </button>
                ))}
              </div>

              {/* --- 1. ФОРМА --- */}
              {mode === 'form' && (
                <div className="ws-body">
                  <SlopeEditor slope={active} calcResult={calcResult} onPolygonChange={onPolygonChange}
                    edgeTypes={edgeTypes} holes={holes} />

                  <div className="form-cards">
                    <div className="card">
                      <div className="card-header"><span className="card-title">Ребра і сопряження</span>
                        <span className="text-xs text-muted">впливають на доборні</span></div>
                      {pts.length >= 3 ? (
                        <div className="table-wrap">
                          <table>
                            <thead><tr><th>Ребро</th><th>Довжина, мм</th><th>Тип</th></tr></thead>
                            <tbody>
                              {pts.map((a, i) => (
                                <tr key={i}>
                                  <td><span className="edge-dot" style={{ background: edgeColor(edgeTypes[i], theme) }} />{i + 1}–{(i + 1) % pts.length + 1}</td>
                                  <td>{Math.round(sideLengthMm(a, pts[(i + 1) % pts.length]))}</td>
                                  <td>
                                    <select className="form-control form-control-sm" value={edgeTypes[i]} aria-label={`Тип ребра ${i + 1}`}
                                      onChange={e => setEdge(i, e.target.value as EdgeType)}>
                                      {EDGE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                                    </select>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <div className="text-sm text-muted">Спочатку задайте контур: шаблон або малювання.</div>}
                    </div>

                    <div className="card">
                      <div className="card-header"><span className="card-title">Вирізи</span>
                        <span className="text-xs text-muted">труби, мансардні вікна</span></div>
                      {holes.length > 0 && (
                        <div className="table-wrap" style={{ marginBottom: 12 }}>
                          <table>
                            <thead><tr><th>№</th><th>Розмір, мм</th><th>Позиція X, Y</th><th></th></tr></thead>
                            <tbody>
                              {holes.map((h, i) => {
                                const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
                                return (
                                  <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td>{Math.max(...xs) - Math.min(...xs)} × {Math.max(...ys) - Math.min(...ys)}</td>
                                    <td>{Math.min(...xs)}, {Math.min(...ys)}</td>
                                    <td><button className="btn btn-ghost btn-sm" onClick={() => removeHole(i)} aria-label={`Видалити виріз ${i + 1}`}>Видалити</button></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="hole-form">
                        {([['x', 'X лівого краю'], ['y', 'Y низу'], ['w', 'Ширина'], ['h', 'Висота']] as [keyof typeof hole, string][]).map(([k, l]) => (
                          <label key={k} className="form-label">{l}, мм
                            <input className="form-control" type="number" min={0} value={hole[k]}
                              onChange={e => setHole(v => ({ ...v, [k]: +e.target.value }))} />
                          </label>
                        ))}
                        <button className="btn btn-secondary" onClick={addHole} disabled={pts.length < 3}>Додати виріз</button>
                      </div>
                    </div>

                    <div className="card">
                      <div className="card-header"><span className="card-title">Параметри</span></div>
                      <div className="form-row form-row-2">
                        <label className="form-label">Назва
                          <input className="form-control" value={params.name} onChange={e => setParams(p => ({ ...p, name: e.target.value }))} /></label>
                        <label className="form-label">Кут нахилу, °
                          <input className="form-control" type="number" min={1} max={90} value={params.slope_angle}
                            onChange={e => setParams(p => ({ ...p, slope_angle: +e.target.value }))} /></label>
                        <label className="form-label">Карнизний звис, мм
                          <input className="form-control" type="number" min={0} max={300} value={params.eave_overhang}
                            onChange={e => setParams(p => ({ ...p, eave_overhang: +e.target.value }))} /></label>
                        <label className="form-label">Припуск під конек, мм
                          <input className="form-control" type="number" min={0} max={200} value={params.ridge_gap}
                            onChange={e => setParams(p => ({ ...p, ridge_gap: +e.target.value }))} /></label>
                        <label className="form-label">Напрямок укладки
                          <select className="form-control" value={params.laying_direction}
                            onChange={e => setParams(p => ({ ...p, laying_direction: e.target.value as any }))}>
                            <option value="right_left">Справа наліво</option>
                            <option value="left_right">Зліва направо</option>
                            <option value="bottom_top">Знизу вгору</option>
                            <option value="top_bottom">Згори вниз</option>
                          </select></label>
                      </div>
                      <div className="flex gap-3" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                        <button className="btn btn-secondary" onClick={saveParams} disabled={saving}>{saving ? 'Збереження…' : 'Зберегти'}</button>
                        <button className="btn btn-primary" onClick={() => setMode('material')}>Далі: матеріал →</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* --- 2. МАТЕРІАЛ --- */}
              {mode === 'material' && (
                <div className="ws-body">
                  <div className="card">
                    <div className="card-header"><span className="card-title">Матеріал проєкту</span>
                      <span className="text-xs text-muted">застосовується до всіх елементів</span></div>
                    <div className="form-row form-row-2">
                      <label className="form-label">Завод-виробник
                        <select className="form-control" value={manufacturer} onChange={e => setManufacturer(e.target.value)} disabled={applyingMaterial}>
                          <option value="">— Усі виробники —</option>
                          {manufacturers.map(mf => <option key={mf} value={mf}>{mf}</option>)}
                        </select></label>
                      <label className="form-label">Матеріал
                        <MaterialSelect value={projectMaterialId} list={filteredMaterials} disabled={applyingMaterial}
                          onChange={applyMaterialToAll} /></label>
                    </div>
                    {applyingMaterial && <div className="text-sm text-muted">Застосовую до всіх елементів…</div>}
                  </div>

                  <div className="card">
                    <div className="card-header"><span className="card-title">Матеріал елемента «{active.name}»</span></div>
                    <label className="form-label">Інший матеріал лише для цього елемента
                      <MaterialSelect value={active.material_profile_id || 0} list={filteredMaterials} onChange={setElementMaterial} /></label>
                    {(elementMaterial || projectMaterial) && (
                      <MaterialFacts m={(elementMaterial || projectMaterial)!} />
                    )}
                    <div className="flex gap-3" style={{ flexWrap: 'wrap', marginTop: 12 }}>
                      <button className="btn btn-primary" onClick={calculate}
                        disabled={calculating || pts.length < 3 || !active.material_profile_id}>
                        {calculating ? 'Розрахунок…' : 'Розкласти листи →'}
                      </button>
                      {!active.material_profile_id && <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Оберіть матеріал</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* --- 3. УКЛАДКА --- */}
              {mode === 'layout' && (
                <div className="ws-body">
                  {calcResult && !calcResult.errors?.length ? (
                    <>
                      <div className="metrics-grid" style={{ marginBottom: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
                        {[
                          ['Листів', calcResult.total_sheets],
                          ['Площа', `${fmt(calcResult.slope_area_m2)} м²`],
                          ['Площа листів', `${fmt(calcResult.total_full_area_m2 ?? calcResult.order_area_m2)} м²`],
                          ['По ширині', `${calcResult.cols_count} шт`],
                          ['Рядів', calcResult.rows_count],
                          ['Відходи', `${calcResult.waste_pct}%`],
                        ].map(([l, v]) => (
                          <div key={l as string} className="metric-card"><div className="metric-value">{v}</div><div className="metric-label">{l}</div></div>
                        ))}
                      </div>
                      {calcResult.holes_area_m2 ? <div className="alert alert-info">Вирізи: {fmt(calcResult.holes_area_m2)} м² віднято від площі елемента.</div> : null}
                      {calcResult.warnings?.map((w, i) => <div key={i} className="alert alert-warning">{w}</div>)}
                      <LayoutScheme calcResult={calcResult} polygonPoints={pts} slopeName={active.name} />
                    </>
                  ) : calcResult?.errors?.length ? (
                    <div className="alert alert-error">{calcResult.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
                  ) : (
                    <div className="empty-state">
                      <div>Елемент ще не розкладено.</div>
                      <button className="btn btn-primary" onClick={calculate} disabled={calculating || pts.length < 3 || !active.material_profile_id}>
                        {calculating ? 'Розрахунок…' : 'Розкласти листи'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* --- 4. ДОБОРНІ ЕЛЕМЕНТА --- */}
              {mode === 'dobor' && (
                <div className="ws-body">
                  {calcResult?.accessories ? (
                    <>
                      <EdgeSums sums={{
                        eave: calcResult.accessories.eave_length_m, ridge: calcResult.accessories.ridge_length_m,
                        hip: calcResult.accessories.hip_length_m || 0, valley: calcResult.accessories.valley_length_m,
                        end: calcResult.accessories.end_length_m, abutment: calcResult.accessories.abutment_length_m || 0,
                      }} theme={theme} />
                      <div className="card">
                        <div className="card-header"><span className="card-title">Доборні та кріплення · {active.name}</span></div>
                        <div className="table-wrap">
                          <table>
                            <thead><tr><th>Найменування</th><th>К-сть</th><th>Ціна</th><th>Сума</th></tr></thead>
                            <tbody>
                              {calcResult.accessories.items.map((a, i) => (
                                <tr key={i}><td>{a.name}</td><td><b>{a.quantity} {a.unit}</b></td><td>{fmt(a.price)} грн</td><td>{fmt(a.total)} грн</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <div>Доборні з'являться після розрахунку елемента.</div>
                      <button className="btn btn-primary" onClick={calculate} disabled={calculating || pts.length < 3 || !active.material_profile_id}>Розрахувати</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ===== Вузли проєкту ===== */}
          {node?.type === 'dobor' && (
            <div className="ws-body">
              <div className="ws-head"><div className="ws-title"><span className="ws-kind">Проєкт</span>Доборні елементи</div></div>
              <EdgeSums sums={projectEdges} theme={theme} />
              {accItems.length || fastItems.length ? (
                ([['Доборні елементи', accItems], ['Кріплення', fastItems]] as [string, SpecItem[]][]).map(([title, items]) => items.length ? (
                  <div key={title} className="spec-section" style={{ marginBottom: 0 }}>
                    <div className="spec-section-title">{title}</div>
                    <div className="table-wrap">
                      <table style={{ border: '1px solid var(--clr-border)', borderTop: 'none' }}>
                        <thead><tr><th>Найменування</th><th>Од.</th><th>К-сть</th></tr></thead>
                        <tbody>{items.map(it => <tr key={it.id}><td>{it.name}</td><td>{it.unit}</td><td><b>{Number(it.quantity).toFixed(it.unit === 'шт' ? 0 : 2)}</b></td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                ) : null)
              ) : <div className="alert alert-info">Натисніть «Розрахувати проєкт», щоб зібрати доборні з усіх елементів.</div>}
            </div>
          )}

          {node?.type === 'estimate' && (
            <div className="ws-body">
              <div className="ws-head"><div className="ws-title"><span className="ws-kind">Проєкт</span>Кошторис</div></div>
              {specItems.length ? (
                <>
                  <div className="metrics-grid" style={{ marginBottom: 0 }}>
                    <div className="metric-card"><div className="metric-value" style={{ color: 'var(--clr-brand)' }}>{fmt(totalPrice, 0)} грн</div><div className="metric-label">Загальна сума</div></div>
                    <div className="metric-card"><div className="metric-value">{sheetItems.reduce((s, i) => s + Number(i.quantity), 0)}</div><div className="metric-label">Листів</div></div>
                    <div className="metric-card"><div className="metric-value">{slopes.filter(s => s.calc_result).length}/{slopes.length}</div><div className="metric-label">Розраховано елементів</div></div>
                  </div>
                  {([['Основне покриття', sheetItems], ['Доборні елементи', accItems], ['Кріплення', fastItems]] as [string, SpecItem[]][]).map(([title, items]) => items.length ? (
                    <div key={title} className="spec-section" style={{ marginBottom: 0 }}>
                      <div className="spec-section-title">{title}</div>
                      <div className="table-wrap">
                        <table style={{ border: '1px solid var(--clr-border)', borderTop: 'none' }}>
                          <thead><tr><th>Найменування</th><th>Од.</th><th>К-сть</th><th>Ціна</th><th>Сума</th></tr></thead>
                          <tbody>
                            {items.map(it => (
                              <tr key={it.id}><td>{it.name}</td><td>{it.unit}</td><td>{fmt(it.quantity)}</td><td>{fmt(it.price)} грн</td><td><b>{fmt(it.total)} грн</b></td></tr>
                            ))}
                            <tr className="tr-total"><td colSpan={4}>Підсумок розділу</td><td><b>{fmt(items.reduce((s, i) => s + Number(i.total), 0))} грн</b></td></tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null)}
                </>
              ) : <div className="alert alert-info">Кошторис з'явиться після «Розрахувати проєкт».</div>}
            </div>
          )}

          {node?.type === 'reports' && (
            <div className="ws-body">
              <div className="ws-head"><div className="ws-title"><span className="ws-kind">Проєкт</span>Звіти і друк</div></div>
              <div className="report-grid">
                {[
                  ['Комерційна пропозиція', 'Для клієнта: матеріали, доборні, ціни. PDF з логотипом.', exportApi.pdf(projectId), 'PDF'],
                  ['Специфікація для менеджера', 'Excel: специфікація, скати, розкрій по довжинах.', exportApi.excel(projectId), 'Excel'],
                  ['Виробничий звіт', 'Довжини листів для різки, без цін.', exportApi.productionPdf(projectId), 'PDF'],
                  ['Дані проєкту', 'JSON-файл для архіву або перенесення.', exportApi.json(projectId), 'JSON'],
                ].map(([t, d, href, f]) => (
                  <a key={t} className="report-card" href={href} target="_blank" rel="noopener noreferrer">
                    <span className="report-fmt">{f}</span>
                    <span className="report-title">{t}</span>
                    <span className="report-desc">{d}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- Допоміжні компоненти ----------

function MaterialSelect({ value, list, onChange, disabled }: { value: number; list: MaterialProfile[]; onChange: (id: number) => void; disabled?: boolean }) {
  const groups: [MaterialProfile['type'], string][] = [['tile', 'Металочерепиця'], ['profile', 'Профнастил'], ['falts', 'Фальцева покрівля']];
  return (
    <select className="form-control" value={value} onChange={e => onChange(+e.target.value)} disabled={disabled}>
      <option value={0}>— Оберіть матеріал —</option>
      {groups.map(([t, label]) => {
        const items = list.filter(m => m.type === t);
        return items.length ? <optgroup key={t} label={label}>{items.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup> : null;
      })}
    </select>
  );
}

function MaterialFacts({ m }: { m: MaterialProfile }) {
  const rows: [string, string][] = [
    ['Тип', m.type === 'tile' ? 'Металочерепиця' : m.type === 'profile' ? 'Профнастил' : 'Фальц'],
    ['Ширина повна / корисна', `${m.full_width} / ${m.useful_width} мм`],
    ['Нахлест боковий / поздовжній', `${m.side_overlap} / ${m.length_overlap} мм`],
    ['Довжина листа', `${m.min_length}–${m.max_length} мм`],
  ];
  if (m.wave_step) rows.push(['Крок хвилі', `${m.wave_step} мм`]);
  if (m.forbidden_lengths?.length) rows.push(['Заборонені довжини', m.forbidden_lengths.map(f => `${f.min}–${f.max}`).join(', ')]);
  if (m.stock_lengths?.length) rows.push(['Складський типоряд', m.stock_lengths.join(', ') + ' мм']);
  rows.push(['Мін. кут покрівлі', `${m.min_slope_angle}°`]);
  return (
    <dl className="facts">
      {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
    </dl>
  );
}

function EdgeSums({ sums, theme }: { sums: Record<string, number>; theme: 'dark' | 'light' }) {
  const keys: EdgeType[] = ['eave', 'ridge', 'hip', 'valley', 'end', 'abutment'];
  return (
    <div className="metrics-grid" style={{ marginBottom: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
      {keys.map(k => (
        <div key={k} className="metric-card" style={{ boxShadow: `inset 0 3px 0 ${edgeColor(k, theme)}` }}>
          <div className="metric-value">{fmt(sums[k] || 0)} м</div>
          <div className="metric-label">{edgeLabel(k)}</div>
        </div>
      ))}
    </div>
  );
}
