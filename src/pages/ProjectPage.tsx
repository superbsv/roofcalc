// ============================================
// ArtBudTrading Roof Calculator
// pages/ProjectPage.tsx
// Головна сторінка роботи з проектом
// ============================================

import React, { useEffect, useState, useCallback } from 'react';
import SlopeEditor from '../components/editor/SlopeEditor';
import LayoutScheme from '../components/layout/LayoutScheme';
import {
  Project, Slope, CalcResult, MaterialProfile, Point,
  projectsApi, slopesApi, materialsApi, specApi, SpecItem, exportApi
} from '../api/client';

interface Props { projectId: number; }

// Чотири кроки роботи, як у макеті ABT: 01 Скати → 02 Розкладка → 03 Доборні → 04 Звіт
type Tab = 'slopes' | 'layout' | 'dobor' | 'report';

const TABS: [Tab, string, string][] = [
  ['slopes', '01', 'Скати'],
  ['layout', '02', 'Розкладка'],
  ['dobor',  '03', 'Доборні'],
  ['report', '04', 'Звіт'],
];

export default function ProjectPage({ projectId }: Props) {
  const [project,   setProject]   = useState<Project | null>(null);
  const [slopes,    setSlopes]    = useState<Slope[]>([]);
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [specItems, setSpecItems] = useState<SpecItem[]>([]);
  const [activeSlope,  setActiveSlope]  = useState<Slope | null>(null);
  const [calcResult,   setCalcResult]   = useState<CalcResult | null>(null);
  const [tab,          setTab]          = useState<Tab>('slopes');
  const [calculating,  setCalculating]  = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [slopeParams,  setSlopeParams]  = useState({
    name: 'Скат 1',
    slope_angle: 30,
    eave_overhang: 50,
    ridge_gap: 50,
    laying_direction: 'right_left' as const,
    material_profile_id: 0,
    material_color: '',
    material_coating: '',
    material_thickness: 0.5,
  });
  // Єдиний матеріал на весь проект
  const [projectMaterialId, setProjectMaterialId] = useState<number>(0);
  const [manufacturer, setManufacturer] = useState<string>('');
  const [applyingMaterial, setApplyingMaterial]   = useState(false);

  // Load project
  useEffect(() => {
    projectsApi.get(projectId).then(res => {
      setProject(res.project);
      setSlopes(res.slopes);
      if (res.slopes.length) selectSlope(res.slopes[0]);
      // Визначаємо матеріал проекту з першого ската що його має
      const withMat = res.slopes.find(s => s.material_profile_id);
      if (withMat?.material_profile_id) {
        setProjectMaterialId(withMat.material_profile_id);
        materialsApi.list().then(r => {
          const m = r.profiles.find(x => x.id === withMat.material_profile_id);
          if (m?.manufacturer) setManufacturer(m.manufacturer);
        });
      }
    }).catch(e => setError(e.message));
    materialsApi.list().then(res => setMaterials(res.profiles));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function selectSlope(s: Slope) {
    setActiveSlope(s);
    setCalcResult(s.calc_result || null);
    setSlopeParams({
      name: s.name,
      slope_angle: s.slope_angle,
      eave_overhang: s.eave_overhang,
      ridge_gap: s.ridge_gap,
      laying_direction: s.laying_direction as any,
      material_profile_id: s.material_profile_id || 0,
      material_color: s.material_color || '',
      material_coating: s.material_coating || '',
      material_thickness: s.material_thickness || 0.5,
    });
  }

  const addSlope = async () => {
    try {
      const res = await slopesApi.create(projectId, {
        name: `Скат ${slopes.length + 1}`,
        polygon_points: [],
        slope_angle: 30,
        eave_overhang: 50,
        ridge_gap: 50,
        laying_direction: 'right_left',
        material_profile_id: projectMaterialId || undefined,
      });
      setSlopes(prev => [...prev, res.slope]);
      selectSlope(res.slope);
    } catch (e: any) { setError(e.message); }
  };

  const deleteSlope = async (id: number) => {
    if (!window.confirm('Видалити скат?')) return;
    try {
      await slopesApi.delete(id);
      const next = slopes.filter(s => s.id !== id);
      setSlopes(next);
      if (activeSlope?.id === id) {
        setActiveSlope(next[0] || null);
        setCalcResult(null);
      }
    } catch (e: any) { setError(e.message); }
  };

  // Оновлення геометрії при малюванні
  const onPolygonChange = useCallback(async (pts: Point[]) => {
    if (!activeSlope) return;
    if (pts.length < 3) return;
    try {
      const res = await slopesApi.update(activeSlope.id, { polygon_points: pts });
      setSlopes(prev => prev.map(s => s.id === activeSlope.id ? res.slope : s));
      setActiveSlope(res.slope);
      setCalcResult(null);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlope?.id]);

  // Збереження параметрів ската
  const saveParams = async () => {
    if (!activeSlope) return;
    setSaving(true);
    try {
      const res = await slopesApi.update(activeSlope.id, slopeParams);
      setSlopes(prev => prev.map(s => s.id === activeSlope.id ? res.slope : s));
      setActiveSlope(res.slope);
      setCalcResult(null);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  // Розрахунок
  const calculate = async () => {
    if (!activeSlope) return;
    setCalculating(true); setError('');
    try {
      const res = await slopesApi.calculate(activeSlope.id);
      setCalcResult(res.result);
      setSlopes(prev => prev.map(s => s.id === activeSlope.id
        ? { ...s, calc_result: res.result } : s));
      setTab('layout');
    } catch (e: any) { setError(e.message); }
    setCalculating(false);
  };

  // Розрахунок всього проекту
  const calculateAll = async () => {
    setCalculating(true); setError('');
    try {
      await projectsApi.calculateAll(projectId);
      const res = await projectsApi.get(projectId);
      setProject(res.project);
      setSlopes(res.slopes);
      if (activeSlope) {
        const updated = res.slopes.find(s => s.id === activeSlope.id);
        if (updated) { setActiveSlope(updated); setCalcResult(updated.calc_result || null); }
      }
      const spec = await specApi.get(projectId);
      setSpecItems(spec.items);
      setTab('report');
    } catch (e: any) { setError(e.message); }
    setCalculating(false);
  };

  const loadSpec = async () => {
    try {
      const res = await specApi.get(projectId);
      setSpecItems(res.items);
    } catch {}
  };

  // Застосувати матеріал до ВСІХ скатів проекту
  const applyMaterialToAll = async (materialId: number) => {
    setProjectMaterialId(materialId);
    if (!materialId || !slopes.length) return;
    setApplyingMaterial(true);
    setError('');
    try {
      // Оновлюємо кожен скат
      const updated: Slope[] = [];
      for (const s of slopes) {
        const res = await slopesApi.update(s.id, { material_profile_id: materialId });
        updated.push(res.slope);
      }
      setSlopes(updated);
      // Оновлюємо активний скат і його параметри
      if (activeSlope) {
        const act = updated.find(s => s.id === activeSlope.id);
        if (act) {
          setActiveSlope(act);
          setSlopeParams(p => ({ ...p, material_profile_id: materialId }));
        }
      }
    } catch (e: any) {
      setError(e.message);
    }
    setApplyingMaterial(false);
  };

  // Матеріали по типу
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const materialsByType = {
    tile:    materials.filter(m => m.type === 'tile'),
    profile: materials.filter(m => m.type === 'profile'),
    falts:   materials.filter(m => m.type === 'falts'),
  };

  const selectedMaterial = materials.find(m => m.id === (projectMaterialId || slopeParams.material_profile_id));

  // Унікальні виробники
  const manufacturers = Array.from(new Set(
    materials.map(m => (m.manufacturer || '').trim()).filter(Boolean)
  )).sort();

  // Матеріали обраного виробника (або всі якщо виробник не обрано)
  const filteredMaterials = manufacturer
    ? materials.filter(m => (m.manufacturer || '').trim() === manufacturer)
    : materials;

  const totalPrice = specItems.reduce((s, i) => s + Number(i.total || 0), 0);
  const sheetItems = specItems.filter(i => i.type === 'sheet');

  // Групуємо доборні по назві
  const groupItems = (items: SpecItem[]) => {
    const map: Record<string, SpecItem> = {};
    items.forEach(i => {
      const key = i.name + '|' + i.unit;
      if (map[key]) {
        map[key] = { ...map[key], quantity: Number(map[key].quantity) + Number(i.quantity), total: Number(map[key].total) + Number(i.total) };
      } else {
        map[key] = { ...i, quantity: Number(i.quantity), total: Number(i.total) };
      }
    });
    return Object.values(map);
  };

  const accItems  = groupItems(specItems.filter(i => i.type === 'accessory'));
  const fastItems = groupItems(specItems.filter(i => i.type === 'fastener'));

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',gap:'16px'}}>
      {/* Page header */}
      <div className="page-header">
        <div>
          <div className="page-title">{project?.name || 'Проект'}</div>
          <div className="page-subtitle">
            {project?.client_name && `Клієнт: ${project.client_name} · `}
            {project?.object_address}
          </div>
        </div>
        <div className="flex gap-3" style={{alignItems:'center',flexWrap:'wrap'}}>
          {/* Завод виробник */}
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <label style={{fontSize:'.82rem',fontWeight:600,color:'var(--clr-text-2)',whiteSpace:'nowrap'}}>
              Завод виробник:
            </label>
            <select className="form-control" style={{minWidth:'180px'}}
              value={manufacturer}
              onChange={e => { setManufacturer(e.target.value); }}
              disabled={applyingMaterial}>
              <option value="">— Усі виробники —</option>
              {manufacturers.map(mf => (
                <option key={mf} value={mf}>{mf}</option>
              ))}
            </select>
          </div>

          {/* Матеріал проекту */}
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <label style={{fontSize:'.82rem',fontWeight:600,color:'var(--clr-text-2)',whiteSpace:'nowrap'}}>
              Матеріал проекту:
            </label>
            <select className="form-control" style={{minWidth:'240px'}}
              value={projectMaterialId}
              onChange={e => applyMaterialToAll(+e.target.value)}
              disabled={applyingMaterial}>
              <option value={0}>— Оберіть матеріал —</option>
              {filteredMaterials.filter(m=>m.type==='tile').length > 0 && (
                <optgroup label="Металочерепиця">
                  {filteredMaterials.filter(m=>m.type==='tile').map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              )}
              {filteredMaterials.filter(m=>m.type==='profile').length > 0 && (
                <optgroup label="Профнастил">
                  {filteredMaterials.filter(m=>m.type==='profile').map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              )}
              {filteredMaterials.filter(m=>m.type==='falts').length > 0 && (
                <optgroup label="Фальцева покрівля">
                  {filteredMaterials.filter(m=>m.type==='falts').map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {applyingMaterial && <span style={{fontSize:'.78rem',color:'var(--clr-text-3)'}}>застосування…</span>}
          </div>

          <button className="btn btn-secondary" onClick={calculateAll} disabled={calculating}>
            {calculating ? 'Рахуємо…' : 'Перерахувати всі'}
          </button>
          <a className="btn btn-secondary" href={exportApi.pdf(projectId)} target="_blank" rel="noopener noreferrer">
            PDF
          </a>
          <a className="btn btn-secondary" href={exportApi.excel(projectId)} target="_blank" rel="noopener noreferrer">
            Excel
          </a>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div style={{display:'grid',gridTemplateColumns:'220px minmax(0,1fr)',gap:'16px',flex:1,minHeight:0}}>
        {/* Slopes list */}
        <div className="card" style={{padding:'12px',overflow:'auto'}}>
          <div className="flex items-center justify-between mb-4" style={{marginBottom:'12px'}}>
            <span style={{fontWeight:600,fontSize:'.875rem'}}>Скати</span>
            <button className="btn btn-primary btn-sm btn-icon" onClick={addSlope} title="Додати скат">+</button>
          </div>
          <div className="slope-list">
            {slopes.map(s => (
              <div
                key={s.id}
                className={`slope-item${activeSlope?.id === s.id ? ' active' : ''}`}
                onClick={() => selectSlope(s)}
              >
                <div className="slope-item-header">
                  <span className="slope-item-name">{s.name}</span>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{color:'var(--clr-error)',padding:'2px'}}
                    onClick={e => { e.stopPropagation(); deleteSlope(s.id); }}
                  >✕</button>
                </div>
                <div className="slope-item-meta">
                  {s.material_name && <span>{s.material_name}</span>}
                  {s.calc_result && (
                    <span style={{color:'var(--clr-success)',marginLeft:'4px'}}>
                      · {s.calc_result.total_sheets} листів
                    </span>
                  )}
                </div>
              </div>
            ))}
            {!slopes.length && (
              <div style={{textAlign:'center',color:'var(--clr-text-3)',padding:'20px',fontSize:'.8rem'}}>
                Натисніть + щоб додати перший скат
              </div>
            )}
          </div>
        </div>

        {/* Right side */}
        <div style={{display:'flex',flexDirection:'column',gap:'12px',minHeight:0,minWidth:0}}>
          {/* Tabs — 4 кроки */}
          <div className="tabs" style={{marginBottom:0}}>
            {TABS.map(([t, num, lbl]) => (
              <button
                key={t}
                className={`tab-btn${tab === t ? ' active' : ''}`}
                onClick={() => { setTab(t); if (t === 'dobor' || t === 'report') loadSpec(); }}
              ><span className="tab-num">{num}</span>{lbl}</button>
            ))}
          </div>

          {/* 01 СКАТИ: контур + параметри */}
          {tab === 'slopes' && (
            <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column',gap:'12px',overflow:'auto'}}>
              {activeSlope ? (
                <>
                  <SlopeEditor
                    slope={activeSlope}
                    calcResult={calcResult}
                    onPolygonChange={onPolygonChange}
                  />
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Параметри ската</span>
                      <span style={{fontSize:'.8rem',color:'var(--clr-text-3)'}}>
                        {activeSlope.polygon_points?.length >= 3
                          ? `Контур замкнуто · ${activeSlope.polygon_points.length} точок`
                          : 'Намалюйте контур ската або оберіть шаблон'}
                      </span>
                    </div>
                    <div className="form-row form-row-3">
                      <div className="form-group">
                        <label className="form-label">Назва ската</label>
                        <input className="form-control" value={slopeParams.name}
                          onChange={e => setSlopeParams(p => ({...p, name: e.target.value}))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Кут нахилу, °</label>
                        <input className="form-control" type="number" min={1} max={80}
                          value={slopeParams.slope_angle}
                          onChange={e => setSlopeParams(p => ({...p, slope_angle: +e.target.value}))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Напрямок укладки</label>
                        <select className="form-control" value={slopeParams.laying_direction}
                          onChange={e => setSlopeParams(p => ({...p, laying_direction: e.target.value as any}))}>
                          <option value="right_left">Справа наліво</option>
                          <option value="left_right">Зліва направо</option>
                          <option value="bottom_top">Знизу вгору</option>
                          <option value="top_bottom">Згори вниз</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Карнизний звис, мм</label>
                        <input className="form-control" type="number" min={0} max={300}
                          value={slopeParams.eave_overhang}
                          onChange={e => setSlopeParams(p => ({...p, eave_overhang: +e.target.value}))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Припуск під конек, мм</label>
                        <input className="form-control" type="number" min={0} max={200}
                          value={slopeParams.ridge_gap}
                          onChange={e => setSlopeParams(p => ({...p, ridge_gap: +e.target.value}))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Матеріал</label>
                        <div className="form-control" style={{background:'var(--clr-surface-2)',fontSize:'.85rem',color: selectedMaterial ? 'var(--clr-text)' : 'var(--clr-text-3)'}}>
                          {selectedMaterial
                            ? `${selectedMaterial.name} · ${selectedMaterial.full_width}/${selectedMaterial.useful_width} мм`
                            : 'Оберіть угорі «Матеріал проекту»'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3" style={{flexWrap:'wrap'}}>
                      <button className="btn btn-secondary" onClick={saveParams} disabled={saving}>
                        {saving ? 'Збереження…' : 'Зберегти параметри'}
                      </button>
                      <button className="btn btn-primary" onClick={async () => { await saveParams(); await calculate(); }}
                        disabled={calculating || saving || !(activeSlope.polygon_points?.length >= 3)}>
                        {calculating ? 'Розрахунок…' : 'Розкласти листи →'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="alert alert-info">Оберіть скат зліва або додайте новий</div>
              )}
            </div>
          )}

          {/* 02 РОЗКЛАДКА: схема + підсумки + листи */}
          {tab === 'layout' && (
            <div style={{overflow:'auto',display:'flex',flexDirection:'column',gap:'12px'}}>
              {calcResult && !calcResult.errors?.length && activeSlope ? (
                <>
                  <div className="metrics-grid" style={{marginBottom:0,gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))'}}>
                    {[
                      ['Листів', calcResult.total_sheets],
                      ['Площа ската', `${calcResult.slope_area_m2} м²`],
                      ['По ширині', `${calcResult.cols_count} шт`],
                      ['Рядів', calcResult.rows_count],
                      ['Площа листів', `${(calcResult.total_full_area_m2 ?? calcResult.order_area_m2 ?? 0).toFixed(2)} м²`],
                      ['Відходи', `${calcResult.waste_pct}%`],
                    ].map(([l,v]) => (
                      <div key={l as string} className="metric-card">
                        <div className="metric-value">{v}</div>
                        <div className="metric-label">{l}</div>
                      </div>
                    ))}
                  </div>

                  {calcResult.warnings?.map((w,i) => (
                    <div key={i} className="alert alert-warning">{w}</div>
                  ))}

                  <LayoutScheme
                    calcResult={calcResult}
                    polygonPoints={activeSlope.polygon_points || []}
                    slopeName={activeSlope.name}
                  />

                </>
              ) : calcResult?.errors?.length ? (
                <div className="alert alert-error">
                  {calcResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              ) : (
                <div className="alert alert-info">
                  Скат ще не розкладено. На кроці «01 Скати» натисніть «Розкласти листи».
                </div>
              )}
            </div>
          )}

          {/* 03 ДОБОРНІ: довжини ребер + елементи */}
          {tab === 'dobor' && (
            <div style={{overflow:'auto',display:'flex',flexDirection:'column',gap:'12px'}}>
              {calcResult?.accessories ? (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Ребра · {activeSlope?.name}</span>
                  </div>
                  <div className="metrics-grid" style={{marginBottom:0}}>
                    {[
                      ['Карниз', calcResult.accessories.eave_length_m],
                      ['Конек', calcResult.accessories.ridge_length_m],
                      ['Торці', calcResult.accessories.end_length_m],
                      ['Ендова', calcResult.accessories.valley_length_m],
                    ].map(([l,v]) => (
                      <div key={l as string} className="metric-card">
                        <div className="metric-value">{Number(v || 0).toFixed(2)} м</div>
                        <div className="metric-label">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {accItems.length || fastItems.length ? (
                [['Доборні елементи', accItems], ['Кріплення', fastItems]].map(([title, items]) => (items as SpecItem[]).length ? (
                  <div key={title as string} className="spec-section" style={{marginBottom:0}}>
                    <div className="spec-section-title">{title as string} · уся покрівля</div>
                    <div className="table-wrap">
                      <table style={{border:'1px solid var(--clr-border)',borderTop:'none'}}>
                        <thead><tr><th>Найменування</th><th>Од.</th><th>К-сть</th></tr></thead>
                        <tbody>
                          {(items as SpecItem[]).map(item => (
                            <tr key={item.id}>
                              <td>{item.name}</td>
                              <td>{item.unit}</td>
                              <td><b>{Number(item.quantity).toFixed(item.unit === 'шт' ? 0 : 2)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null)
              ) : calcResult?.accessories?.items?.length ? (
                <div className="card">
                  <div className="card-header"><span className="card-title">Доборні та кріплення · {activeSlope?.name}</span></div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Назва</th><th>Кількість</th></tr></thead>
                      <tbody>
                        {calcResult.accessories.items.map((a, i) => (
                          <tr key={i}><td>{a.name}</td><td><b>{a.quantity} {a.unit}</b></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="alert alert-info">
                  Доборні з'являться після розрахунку. Натисніть угорі «Перерахувати всі».
                </div>
              )}
            </div>
          )}

          {/* 04 ЗВІТ: специфікація + експорт */}
          {tab === 'report' && (
            <div style={{overflow:'auto'}}>
              {specItems.length ? (
                <>
                  <div className="metrics-grid" style={{marginBottom:'16px'}}>
                    <div className="metric-card">
                      <div className="metric-value" style={{color:'var(--clr-brand)'}}>{sheetItems.reduce((s,i)=>s+Number(i.quantity),0)}</div>
                      <div className="metric-label">Листів всього</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">{slopes.filter(s=>s.calc_result).length}/{slopes.length}</div>
                      <div className="metric-label">Розраховано скатів</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">{totalPrice.toLocaleString('uk-UA', {maximumFractionDigits:0})} грн</div>
                      <div className="metric-label">Загальна сума</div>
                    </div>
                  </div>

                  {[
                    ['Основне покриття', sheetItems],
                    ['Доборні елементи', accItems],
                    ['Кріплення', fastItems],
                  ].map(([title, items]) => (items as SpecItem[]).length ? (
                    <div key={title as string} className="spec-section">
                      <div className="spec-section-title">{title as string}</div>
                      <div className="table-wrap">
                        <table style={{border:'1px solid var(--clr-border)',borderTop:'none'}}>
                          <thead>
                            <tr>
                              <th>Найменування</th><th>Од.</th>
                              <th>К-сть</th><th>Ціна</th><th>Сума</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(items as SpecItem[]).map(item => (
                              <tr key={item.id}>
                                <td>{item.name}</td>
                                <td>{item.unit}</td>
                                <td>{Number(item.quantity).toFixed(2)}</td>
                                <td>{Number(item.price).toFixed(2)} грн</td>
                                <td><b>{Number(item.total).toFixed(2)} грн</b></td>
                              </tr>
                            ))}
                            <tr className="tr-total">
                              <td colSpan={4}>Підсумок розділу</td>
                              <td><b>{(items as SpecItem[]).reduce((s,i)=>s+Number(i.total),0).toFixed(2)} грн</b></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null)}

                  <div className="flex gap-3 mt-4" style={{flexWrap:'wrap'}}>
                    <a className="btn btn-primary" href={exportApi.pdf(projectId)} target="_blank" rel="noopener noreferrer">
                      КП для клієнта · PDF
                    </a>
                    <a className="btn btn-secondary" href={exportApi.excel(projectId)} target="_blank" rel="noopener noreferrer">
                      Excel для менеджера
                    </a>
                    <a className="btn btn-secondary" href={exportApi.productionPdf(projectId)} target="_blank" rel="noopener noreferrer">
                      Виробничий PDF
                    </a>
                  </div>
                </>
              ) : (
                <div className="alert alert-info">
                  Спочатку розрахуйте всі скати кнопкою «Перерахувати всі»
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
