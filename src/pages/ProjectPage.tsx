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

type Tab = 'editor' | 'params' | 'results' | 'layout' | 'spec';

export default function ProjectPage({ projectId }: Props) {
  const [project,   setProject]   = useState<Project | null>(null);
  const [slopes,    setSlopes]    = useState<Slope[]>([]);
  const [materials, setMaterials] = useState<MaterialProfile[]>([]);
  const [specItems, setSpecItems] = useState<SpecItem[]>([]);
  const [activeSlope,  setActiveSlope]  = useState<Slope | null>(null);
  const [calcResult,   setCalcResult]   = useState<CalcResult | null>(null);
  const [tab,          setTab]          = useState<Tab>('editor');
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

  // Load project
  useEffect(() => {
    projectsApi.get(projectId).then(res => {
      setProject(res.project);
      setSlopes(res.slopes);
      if (res.slopes.length) selectSlope(res.slopes[0]);
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
      setTab('results');
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
      setTab('spec');
    } catch (e: any) { setError(e.message); }
    setCalculating(false);
  };

  const loadSpec = async () => {
    try {
      const res = await specApi.get(projectId);
      setSpecItems(res.items);
    } catch {}
  };

  // Матеріали по типу
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const materialsByType = {
    tile:    materials.filter(m => m.type === 'tile'),
    profile: materials.filter(m => m.type === 'profile'),
    falts:   materials.filter(m => m.type === 'falts'),
  };

  const selectedMaterial = materials.find(m => m.id === slopeParams.material_profile_id);

  const totalPrice = specItems.reduce((s, i) => s + Number(i.total || 0), 0);
  const sheetItems = specItems.filter(i => i.type === 'sheet');
  const accItems   = specItems.filter(i => i.type === 'accessory');
  const fastItems  = specItems.filter(i => i.type === 'fastener');

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
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={calculateAll} disabled={calculating}>
            {calculating ? '⏳ Рахуємо…' : '⚡ Перерахувати всі'}
          </button>
          <a className="btn btn-secondary" href={exportApi.pdf(projectId)} target="_blank" rel="noopener noreferrer">
            📄 PDF
          </a>
          <a className="btn btn-secondary" href={exportApi.excel(projectId)} target="_blank" rel="noopener noreferrer">
            📊 Excel
          </a>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:'16px',flex:1,minHeight:0}}>
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
        <div style={{display:'flex',flexDirection:'column',gap:'12px',minHeight:0}}>
          {/* Tabs */}
          <div className="tabs" style={{marginBottom:0}}>
            {([
              ['editor','✏ Редактор'],
              ['params','⚙ Параметри'],
              ['results','📐 Результат'],
              ['layout','📐 Схема'],
              ['spec','📋 Специфікація'],
            ] as [Tab, string][]).map(([t, lbl]) => (
              <button
                key={t}
                className={`tab-btn${tab === t ? ' active' : ''}`}
                onClick={() => { setTab(t); if (t === 'spec') loadSpec(); }}
              >{lbl}</button>
            ))}
          </div>

          {/* TAB: EDITOR */}
          {tab === 'editor' && (
            <div style={{flex:1,minHeight:0}}>
              {activeSlope ? (
                <>
                  <SlopeEditor
                    slope={activeSlope}
                    calcResult={calcResult}
                    onPolygonChange={onPolygonChange}
                  />
                  <div className="flex gap-3 mt-4" style={{marginTop:'12px'}}>
                    <button className="btn btn-accent" onClick={calculate} disabled={calculating || !activeSlope.polygon_points?.length}>
                      {calculating ? '⏳ Розрахунок…' : '🔢 Розрахувати скат'}
                    </button>
                    <span style={{fontSize:'.8rem',color:'var(--clr-text-3)',alignSelf:'center'}}>
                      {activeSlope.polygon_points?.length >= 3
                        ? `✓ Контур замкнуто (${activeSlope.polygon_points.length} точок)`
                        : 'Намалюйте контур ската'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="alert alert-info">Оберіть скат зліва або додайте новий</div>
              )}
            </div>
          )}

          {/* TAB: PARAMS */}
          {tab === 'params' && activeSlope && (
            <div className="card" style={{overflow:'auto'}}>
              <div className="form-row form-row-2">
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
                  <label className="form-label">Карнизний свес, мм</label>
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
                  <label className="form-label">Напрямок укладки</label>
                  <select className="form-control" value={slopeParams.laying_direction}
                    onChange={e => setSlopeParams(p => ({...p, laying_direction: e.target.value as any}))}>
                    <option value="right_left">Справа наліво</option>
                    <option value="left_right">Зліва направо</option>
                    <option value="bottom_top">Знизу вгору</option>
                    <option value="top_bottom">Згори вниз</option>
                  </select>
                </div>
              </div>

              <div style={{borderTop:'1px solid var(--clr-border)',paddingTop:'16px',marginTop:'8px'}}>
                <div style={{fontWeight:600,fontSize:'.875rem',marginBottom:'12px'}}>Матеріал</div>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label">Тип покриття</label>
                    <select className="form-control" value={
                        materials.find(m=>m.id===slopeParams.material_profile_id)?.type || ''
                      }
                      onChange={e => setSlopeParams(p => ({...p, material_profile_id: 0}))}>
                      <option value="">Оберіть тип…</option>
                      <option value="tile">Металочерепиця</option>
                      <option value="profile">Профнастил</option>
                      <option value="falts">Клік-фальц</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Профіль</label>
                    <select className="form-control" value={slopeParams.material_profile_id}
                      onChange={e => setSlopeParams(p => ({...p, material_profile_id: +e.target.value}))}>
                      <option value={0}>Оберіть профіль…</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.full_width}/{m.useful_width} мм)</option>
                      ))}
                    </select>
                  </div>
                  {selectedMaterial?.color_options?.length && (
                    <div className="form-group">
                      <label className="form-label">Колір</label>
                      <select className="form-control" value={slopeParams.material_color}
                        onChange={e => setSlopeParams(p => ({...p, material_color: e.target.value}))}>
                        <option value="">Оберіть колір…</option>
                        {selectedMaterial.color_options.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                  {selectedMaterial?.coating_options?.length && (
                    <div className="form-group">
                      <label className="form-label">Покриття</label>
                      <select className="form-control" value={slopeParams.material_coating}
                        onChange={e => setSlopeParams(p => ({...p, material_coating: e.target.value}))}>
                        <option value="">Оберіть…</option>
                        {selectedMaterial.coating_options.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                  {selectedMaterial?.thickness_options?.length && (
                    <div className="form-group">
                      <label className="form-label">Товщина, мм</label>
                      <select className="form-control" value={slopeParams.material_thickness}
                        onChange={e => setSlopeParams(p => ({...p, material_thickness: +e.target.value}))}>
                        {selectedMaterial.thickness_options.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button className="btn btn-primary" onClick={saveParams} disabled={saving}>
                  {saving ? 'Збереження…' : 'Зберегти параметри'}
                </button>
                <button className="btn btn-accent" onClick={calculate} disabled={calculating}>
                  {calculating ? '⏳ Розрахунок…' : '🔢 Розрахувати'}
                </button>
              </div>
            </div>
          )}

          {/* TAB: RESULTS */}
          {tab === 'results' && (
            <div style={{overflow:'auto'}}>
              {calcResult && !calcResult.errors?.length ? (
                <>
                  <div className="metrics-grid">
                    {[
                      ['Листів всього', calcResult.total_sheets],
                      ['Площа ската', `${calcResult.slope_area_m2} м²`],
                      ['По ширині', `${calcResult.cols_count} шт`],
                      ['По довжині', `${calcResult.rows_count} ряд`],
                      ['Довжина листа', `${calcResult.sheet_length_mm} мм`],
                      ['Відходи', `${calcResult.waste_pct}%`],
                    ].map(([l,v]) => (
                      <div key={l as string} className="metric-card">
                        <div className="metric-value">{v}</div>
                        <div className="metric-label">{l}</div>
                      </div>
                    ))}
                  </div>

                  {calcResult.warnings?.map((w,i) => (
                    <div key={i} className="alert alert-warning mb-4" style={{marginBottom:'8px'}}>⚠ {w}</div>
                  ))}

                  <div className="card" style={{marginBottom:'12px'}}>
                    <div className="card-header">
                      <span className="card-title">Листи по довжинах</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Довжина</th><th>Ширина повна</th>
                            <th>Кількість</th><th>Площа (замовлення)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calcResult.sheets_by_length?.map((g, i) => (
                            <tr key={i}>
                              <td className="font-mono">{g.length_mm} мм</td>
                              <td className="font-mono">{g.full_width_mm} мм</td>
                              <td><b>{g.count} шт</b></td>
                              <td>{g.full_area_m2?.toFixed(2)} м²</td>
                            </tr>
                          ))}
                          <tr className="tr-total">
                            <td colSpan={2}>Всього</td>
                            <td><b>{calcResult.total_sheets} шт</b></td>
                            <td>{calcResult.total_full_area_m2?.toFixed(2) || calcResult.order_area_m2?.toFixed(2)} м²</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {calcResult.accessories?.items?.length ? (
                    <div className="card">
                      <div className="card-header">
                        <span className="card-title">Доборні елементи та кріплення</span>
                      </div>
                      <table>
                        <thead>
                          <tr><th>Назва</th><th>Кількість</th><th>Ціна</th><th>Сума</th></tr>
                        </thead>
                        <tbody>
                          {calcResult.accessories.items.map((a, i) => (
                            <tr key={i}>
                              <td>{a.name}</td>
                              <td>{a.quantity} {a.unit}</td>
                              <td>{Number(a.price).toFixed(2)} грн</td>
                              <td><b>{Number(a.total).toFixed(2)} грн</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : calcResult?.errors?.length ? (
                <div className="alert alert-error">
                  {calcResult.errors.map((e, i) => <div key={i}>✗ {e}</div>)}
                </div>
              ) : (
                <div className="alert alert-info">
                  Перейдіть на вкладку «Редактор» і натисніть «Розрахувати скат»
                </div>
              )}
            </div>
          )}

          {/* TAB: SPECIFICATION */}
{tab === 'layout' && calcResult && activeSlope && (
  <div style={{overflow:'auto'}}>
    <LayoutScheme
      calcResult={calcResult}
      polygonPoints={activeSlope.polygon_points || []}
      slopeName={activeSlope.name}
    />
  </div>
)}
          {tab === 'spec' && (
            <div style={{overflow:'auto'}}>
              {specItems.length ? (
                <>
                  <div className="metrics-grid" style={{marginBottom:'16px'}}>
                    <div className="metric-card">
                      <div className="metric-value">{totalPrice.toLocaleString('uk-UA', {maximumFractionDigits:0})} грн</div>
                      <div className="metric-label">Загальна сума</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">{sheetItems.reduce((s,i)=>s+i.quantity,0)}</div>
                      <div className="metric-label">Листів всього</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">{slopes.filter(s=>s.calc_result).length}/{slopes.length}</div>
                      <div className="metric-label">Розраховано скатів</div>
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
                        <table style={{border:'1px solid var(--clr-brand-border)',borderTop:'none'}}>
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

                  <div className="flex gap-3 mt-4">
                    <a className="btn btn-primary" href={exportApi.pdf(projectId)} target="_blank" rel="noopener noreferrer">
                      📄 КП для клієнта (PDF)
                    </a>
                    <a className="btn btn-secondary" href={exportApi.excel(projectId)} target="_blank" rel="noopener noreferrer">
                      📊 Excel для менеджера
                    </a>
                    <a className="btn btn-secondary" href={exportApi.productionPdf(projectId)} target="_blank" rel="noopener noreferrer">
                      🏭 Виробничий PDF
                    </a>
                  </div>
                </>
              ) : (
                <div className="alert alert-info">
                  Спочатку розрахуйте всі скати кнопкою «⚡ Перерахувати всі»
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
