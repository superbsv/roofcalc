// ============================================
// ArtBudTrading Roof Calculator
// pages/ProductsPage.tsx — Сторінка продукції
// ============================================

import React, { useEffect, useState } from 'react';
import { MATERIAL_TYPES, isFixedType } from '../components/roof/materials';
import { useAuth } from '../components/auth/AuthContext';
import { useSections, catalogChanged, CATALOG_EVENT, MAT_DND } from '../components/catalog/CatalogNav';
import LibraryPicker from '../components/catalog/LibraryPicker';
import { exportCatalog, importCatalog } from '../components/catalog/catalogIO';

const BASE = process.env.REACT_APP_API_URL || '/api';
const tok  = () => localStorage.getItem('rc_token');
const api  = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Помилка');
  return d;
};

type Category = 'tile' | 'tile_module' | 'profile' | 'sheet' | 'natural_tile' | 'falts' | 'siding' | 'sandwich';

interface Material {
  id: number;
  type: Category;
  name: string;
  tenant_id?: number | null;      // null — каталог ABT
  published?: number | boolean;   // опубліковано в каталозі виробників
  owner_name?: string | null; owner_mf?: number | string | null;
  manufacturer?: string;
  full_width: number;
  useful_width: number;
  side_overlap: number;
  length_overlap: number;
  wave_step?: number;
  wave_height?: number;
  min_length: number;
  max_length: number;
  cut_step?: number;
  forbidden_lengths?: number[][];
  stock_lengths?: any[];
  round_step?: number | null;
  max_std_length?: number | null;
  lock_type?: string;
  min_joint_distance?: number;
  join_overlap?: number;
  min_slope_angle?: number;
  is_active: boolean;
  sort_order: number;
}

function stockToText(raw: any[] | undefined): string {
  return (raw || []).map(r => Array.isArray(r) ? (r[1] == null ? `${r[0]}` : `${r[0]}:${r[1]}`)
    : typeof r === 'object' && r ? (r.qty == null ? `${r.length}` : `${r.length}:${r.qty}`) : String(r)).join(', ');
}

const EMPTY: Omit<Material, 'id'> = {
  type: 'tile',
  name: '',
  manufacturer: '',
  full_width: 1185,
  useful_width: 1100,
  side_overlap: 85,
  length_overlap: 150,
  wave_step: 350,
  wave_height: 38,
  min_length: 400,
  max_length: 8000,
  cut_step: 350,
  forbidden_lengths: [],
  stock_lengths: [],
  lock_type: '',
  min_joint_distance: 500,
  join_overlap: 100,
  min_slope_angle: 14,
  is_active: true,
  sort_order: 0,
};

const CAT_LABEL: Record<Category, string> = Object.fromEntries(MATERIAL_TYPES.map(t => [t.key, t.label])) as Record<Category, string>;

// Типові параметри нового матеріалу за типом (підказка, менеджер змінює під свій прайс)
const TYPE_DEFAULTS: Partial<Record<Category, Partial<Omit<Material, 'id'>>>> = {
  tile_module:  { full_width: 1180, useful_width: 1100, side_overlap: 80, length_overlap: 0,   min_length: 400,  max_length: 400,  wave_step: 0, cut_step: 0 },
  sheet:        { full_width: 950,  useful_width: 860,  side_overlap: 90, length_overlap: 170, min_length: 2000, max_length: 2000, wave_step: 0, cut_step: 0, min_slope_angle: 5 },
  natural_tile: { full_width: 300,  useful_width: 250,  side_overlap: 50, length_overlap: 80,  min_length: 420,  max_length: 420,  wave_step: 0, cut_step: 0, min_slope_angle: 22 },
  siding:       { full_width: 260,  useful_width: 226,  side_overlap: 34, length_overlap: 0,   min_length: 300,  max_length: 6000,  wave_step: 0, cut_step: 10, min_slope_angle: 0 },
  sandwich:     { full_width: 1000, useful_width: 1000, side_overlap: 0,  length_overlap: 0,   min_length: 1000, max_length: 14000, wave_step: 0, cut_step: 50, min_slope_angle: 0 },
  profile:      { full_width: 1150, useful_width: 1100, side_overlap: 50, length_overlap: 200, min_length: 500,  max_length: 12000, wave_step: 0, cut_step: 50, min_slope_angle: 8 },
};

function ForbiddenRanges({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let ranges: [number, number][] = [];
  try { ranges = JSON.parse(value || '[]'); } catch {}

  const update = (newRanges: [number, number][]) => onChange(JSON.stringify(newRanges));
  const add    = () => update([...ranges, [0, 0]]);
  const remove = (i: number) => update(ranges.filter((_, idx) => idx !== i));
  const set    = (i: number, side: 0 | 1, val: number) => {
    const next = ranges.map((r, idx) => idx === i
      ? [side === 0 ? val : r[0], side === 1 ? val : r[1]] as [number, number]
      : r);
    update(next);
  };

  return (
    <div>
      {ranges.length > 0 && (
        <div style={{ display:'flex', gap:'8px', marginBottom:'4px' }}>
          <span style={{ flex:1, fontSize:'.75rem', color:'var(--clr-text-3)', textAlign:'center' }}>Від, мм</span>
          <span style={{ flex:1, fontSize:'.75rem', color:'var(--clr-text-3)', textAlign:'center' }}>До, мм</span>
          <span style={{ width:'32px' }}/>
        </div>
      )}
      {ranges.map((r, i) => (
        <div key={i} style={{ display:'flex', gap:'8px', marginBottom:'6px', alignItems:'center' }}>
          <input type="number" className="form-control" value={r[0]}
            onChange={e => set(i, 0, Number(e.target.value))}
            placeholder="від" style={{ flex:1 }} />
          <span style={{ color:'var(--clr-text-3)', fontSize:'.85rem' }}>—</span>
          <input type="number" className="form-control" value={r[1]}
            onChange={e => set(i, 1, Number(e.target.value))}
            placeholder="до" style={{ flex:1 }} />
          <button onClick={() => remove(i)}
            style={{ width:'32px', height:'36px', border:'1px solid #5A2424', borderRadius:'6px', background:'var(--clr-error-bg)', color:'var(--clr-error)', cursor:'pointer', flexShrink:0 }}>
            ✕
          </button>
        </div>
      ))}
      <button onClick={add}
        style={{ padding:'6px 12px', border:'1px solid var(--clr-border-dark)', borderRadius:'6px', background:'var(--clr-surface-2)', color:'var(--clr-text)', cursor:'pointer', fontSize:'.82rem', marginTop:'4px' }}>
        + Додати діапазон
      </button>
      {ranges.length > 0 && (
        <div style={{ fontSize:'.72rem', color:'var(--clr-text-3)', marginTop:'4px' }}>
          JSON: {JSON.stringify(ranges)}
        </div>
      )}
    </div>
  );
}

// Джерело матеріалу: каталог ABT, каталог виробника або власний матеріал кабінету
export const materialSource = (m: { tenant_id?: number | null; owner_name?: string | null; owner_mf?: number | string | null }, myTid?: number) =>
  m.tenant_id == null ? { kind: 'abt' as const, label: 'Каталог ROOFKIT' }
    : myTid != null && Number(m.tenant_id) === Number(myTid) ? { kind: 'own' as const, label: 'Власний' }
    : { kind: 'mf' as const, label: `Виробник: ${m.owner_name || '—'}` };

export default function ProductsPage({ section, onSection }: { section?: number; onSection: (id: number) => void }) {
  const { user } = useAuth();
  const myTid = user?.tenant?.id;
  const isMf = String((user?.tenant as any)?.is_manufacturer ?? '0') === '1' && !(user?.is_superadmin && !user?.impersonating);
  const { sections } = useSections();
  const secId = section ?? sections[0]?.id;
  const sec = sections.find(x => x.id === secId);
  const cat = (sec?.calc_type || 'tile') as Category;
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [form, setForm]         = useState<Omit<Material,'id'>>(EMPTY);
  const [isNew, setIsNew]       = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const [closedMf, setClosedMf] = useState<Set<string>>(new Set());
  const platform = !!(user?.is_superadmin && !user?.impersonating);
  const canEdit = (m: Material) => { const k = materialSource(m, myTid).kind; return k === 'own' || (k === 'abt' && platform); };
  const isAdmin = user?.role === 'admin';
  const [lib, setLib] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const doExport = async () => {
    setError(''); setSuccess('');
    try {
      const n = await exportCatalog(`${platform ? 'ROOFKIT_catalog' : 'my_catalog'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      setSuccess(`Експортовано позицій: ${n}`);
    } catch (e: any) { setError(e.message); }
  };
  const doImport = async (f?: File) => {
    if (!f) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const r = await importCatalog(f);
      setSuccess(`Імпорт: додано ${r.created}, оновлено ${r.updated}${r.errors_count ? `, з помилками ${r.errors_count}` : ''}`);
      if (r.errors_count) setError(r.errors.join('\n'));
      catalogChanged(); loadMaterials();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const delOne = async () => {
    if (!selected || !window.confirm(`Видалити «${selected.name}»?\nЯкщо матеріал уже використано в розрахунках — він зникне з каталогу, але старі проекти не зміняться.`)) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const r = await api('DELETE', `/admin/materials/${selected.id}`);
      setSelected(null); setIsNew(false);
      setSuccess(r.result === 'hidden' ? 'Матеріал прибрано з каталогу (є у старих розрахунках)' : 'Матеріал видалено');
      loadMaterials();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  const delGroup = async (mf: string, list: Material[]) => {
    const mine = list.filter(canEdit);
    if (!mine.length) return;
    const extra = mine.length < list.length ? `\n(${list.length - mine.length} чужих матеріалів залишаться — їх видаляє власник)` : '';
    if (!window.confirm(`Видалити виробника «${mf}» — ${mine.length} шт. (${sec?.name || CAT_LABEL[cat]})?${extra}`)) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const r = await api('POST', '/admin/materials/delete-group', { type: cat, manufacturer: mf, ids: mine.map(m => m.id) });
      if (selected && mine.some(m => m.id === selected.id)) { setSelected(null); setIsNew(false); }
      setSuccess(`Видалено: ${r.deleted + r.hidden}${r.hidden ? ` (з них ${r.hidden} прибрано з каталогу — є в розрахунках)` : ''}`);
      loadMaterials();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  const mfName = (m: Material) => (m.manufacturer || '').trim() || (m.owner_mf && String(m.owner_mf) === '1' ? (m.owner_name || '') : '') || 'Без виробника';
  // Порядок як у каталозі: виробники і матеріали — за sort_order (перетягування), потім за назвою
  const byOrder = (a: Material, b: Material) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.name.localeCompare(b.name, 'uk');
  const mfGroups: [string, Material[]][] = Array.from(new Set(materials.map(mfName)))
    .map(mf => [mf, materials.filter(m => mfName(m) === mf).sort(byOrder)] as [string, Material[]])
    .sort(([a, la], [b, lb]) => (a === 'Без виробника' ? 1 : b === 'Без виробника' ? -1 : byOrder(la[0], lb[0])));

  // ---- Перетягування ----
  const [drag, setDrag] = useState<{ kind: 'mat' | 'mf'; id?: number; mf?: string } | null>(null);
  const [dropAt, setDropAt] = useState<string>('');           // 'm:<id>' | 'g:<mf>'
  const saveOrder = async (groups: [string, Material[]][]) => {
    const ids = groups.flatMap(([, l]) => l.map(m => m.id));
    // одразу показуємо новий порядок
    setMaterials(ms => ms.map(m => ({ ...m, sort_order: (ids.indexOf(m.id) + 1) * 10 })));
    try { await api('PUT', '/catalog/materials-order', { ids }); } catch (e: any) { setError(e.message); loadMaterials(); }
  };
  const moveMaterial = async (m: Material, toMf: string, beforeId?: number) => {
    const groups = mfGroups.map(([g, l]) => [g, l.filter(x => x.id !== m.id)] as [string, Material[]]);
    const target = groups.find(([g]) => g === toMf);
    if (!target) return;
    const moved = { ...m, manufacturer: toMf === 'Без виробника' ? '' : toMf };
    const at = beforeId ? target[1].findIndex(x => x.id === beforeId) : -1;
    if (at >= 0) target[1].splice(at, 0, moved); else target[1].push(moved);
    try {
      if (mfName(m) !== toMf) {
        await api('POST', '/catalog/move', { ids: [m.id], manufacturer: moved.manufacturer });
        setMaterials(ms => ms.map(x => (x.id === m.id ? moved : x)));
        if (selected?.id === m.id) { setSelected(moved); setForm(f0 => ({ ...f0, manufacturer: moved.manufacturer })); }
      }
      await saveOrder(groups);
    } catch (e: any) { setError(e.message); loadMaterials(); }
  };
  const moveGroup = (from: string, before: string) => {
    if (from === before) return;
    const g = mfGroups.filter(([n]) => n !== from);
    const src = mfGroups.find(([n]) => n === from)!;
    g.splice(g.findIndex(([n]) => n === before), 0, src);
    saveOrder(g);
  };
  const onDropItem = (e: React.DragEvent, target: Material | null, groupName: string) => {
    e.preventDefault(); e.stopPropagation(); setDropAt('');
    const d = drag; setDrag(null);
    if (!d) return;
    if (d.kind === 'mf' && d.mf) { moveGroup(d.mf, groupName); return; }
    const m = materials.find(x => x.id === d.id);
    if (m && (!target || target.id !== m.id)) moveMaterial(m, groupName, target?.id);
  };
  const renameMf = async (mf: string, list: Material[]) => {
    const mine = list.filter(canEdit);
    const n = window.prompt(`Нова назва виробника «${mf}»${mine.length < list.length ? ' (зміниться лише у ваших матеріалах)' : ''}:`, mf === 'Без виробника' ? '' : mf);
    if (n === null || n.trim() === mf) return;
    try { await api('POST', '/catalog/move', { ids: mine.map(m => m.id), manufacturer: n.trim() }); loadMaterials(); }
    catch (e: any) { setError(e.message); }
  };
  const addMf = () => {
    const n = window.prompt('Назва нового виробника:');
    if (n && n.trim()) newMaterial(n.trim());
  };

  const [forbiddenInput, setForbiddenInput] = useState('');
  const [stockInput, setStockInput]         = useState('');

  useEffect(() => { setSelected(null); setIsNew(false); loadMaterials(); }, [secId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => loadMaterials();
    window.addEventListener(CATALOG_EVENT, h);
    return () => window.removeEventListener(CATALOG_EVENT, h);
  }, [secId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMaterials = async () => {
    if (!secId) return;
    try {
      const d = await api('GET', `/materials/section/${secId}`);
      setMaterials(d.profiles || []);
    } catch { setError('Помилка завантаження'); }
  };

  const selectMaterial = (m: Material) => {
    setSelected(m);
    setIsNew(false);
    setForm({ ...m });
    setForbiddenInput(JSON.stringify(m.forbidden_lengths || []));
    setStockInput(stockToText(m.stock_lengths));
    setError(''); setSuccess('');
  };

  const newMaterial = (mf?: string) => {
    setSelected(null);
    setIsNew(true);
    setForm({ ...EMPTY, ...(TYPE_DEFAULTS[cat] || {}), type: cat, manufacturer: mf || '' });
    setForbiddenInput('[]');
    setStockInput('');
    setError(''); setSuccess('');
  };

  // Склад як у КП: «довжина:наявність», напр. «2250:40, 3650:12, 4500» (без кількості — необмежено)
  const parseStock = (val: string): [number, number | null][] =>
    val.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(x => {
      const [l, q] = x.split(/[:x×*]/).map(v => v.trim());
      return [Number(l), q === undefined || q === '' ? null : Number(q)] as [number, number | null];
    }).filter(([l, q]) => l > 0 && (q === null || q >= 0)).slice(0, 10);

  const save = async () => {
    setLoading(true); setError(''); setSuccess('');
    try {
      const payload = {
        ...form,
        side_overlap: Math.max(0, (form.full_width || 0) - (form.useful_width || 0)),
        forbidden_lengths: JSON.parse(forbiddenInput || '[]'),
        stock_lengths: parseStock(stockInput),
      };
      if (isNew) {
        await api('POST', '/admin/materials', { ...payload, section_id: secId });
        catalogChanged();
        setSuccess('Матеріал створено!');
        setIsNew(false);
      } else if (selected) {
        await api('PUT', `/admin/materials/${selected.id}`, payload);
        setSuccess('Збережено!');
      }
      loadMaterials();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const f = (key: keyof Omit<Material,'id'>, val: any) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const showForm = isNew || selected !== null;

  return (
    <div className={`prod-wrap${showForm ? ' has-form' : ''}`}>

      {/* Ліва панель */}
      <div className="prod-list">
        <div className="prod-sec">
          <select className="form-control" value={secId ?? ''} onChange={e => onSection(Number(e.target.value))} aria-label="Розділ каталогу">
            {sections.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div style={{ padding:'8px' }}>
          <div style={{ display:'flex', gap:'6px' }}>
            <button className="btn btn-primary btn-sm" style={{ flex:1 }} onClick={() => newMaterial()}>+ Матеріал</button>
            <button className="btn btn-secondary btn-sm" style={{ flex:1 }} onClick={addMf}>+ Виробник</button>
          </div>
          {isAdmin && !platform && (
            <button className="btn btn-secondary btn-sm prod-libbtn" onClick={() => setLib(true)}>+ З каталогу ROOFKIT</button>
          )}
          {isAdmin && (
            <div className="prod-io">
              <button className="btn btn-ghost btn-sm" onClick={doExport} title="Завантажити весь каталог у файл Excel">⭳ Експорт Excel</button>
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={loading} title="Додати або оновити позиції з файлу Excel / CSV (формат — як у файлі експорту)">⭱ Імпорт</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => doImport(e.target.files?.[0])} />
            </div>
          )}
          {isAdmin && <div className="prod-dnd-hint">Перетягуйте матеріали, щоб змінити порядок, виробника або розділ</div>}
          {lib && <LibraryPicker section={secId} onClose={() => setLib(false)} onCopied={n => { setSuccess(`Скопійовано в ваш каталог: ${n}`); loadMaterials(); }} />}
        </div>
        <div style={{ flex:1, overflowY:'auto' }}>
          {materials.length === 0 && (
            <div style={{ padding:'16px', color:'var(--clr-text-3)', fontSize:'.85rem', textAlign:'center' }}>Матеріалів немає</div>
          )}
          {/* Каталог: вид матеріалу → виробник → назва форми */}
          {mfGroups.map(([mf, list]) => (
            <div key={mf} className="prod-mf">
              <div className={`prod-mf-row${dropAt === 'g:' + mf ? ' drop' : ''}`}
                draggable={isAdmin && list.some(canEdit)}
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'mf'); setDrag({ kind: 'mf', mf }); }}
                onDragEnd={() => { setDrag(null); setDropAt(''); }}
                onDragOver={e => { if (drag) { e.preventDefault(); setDropAt('g:' + mf); } }}
                onDrop={e => onDropItem(e, null, mf)}>
                <button type="button" className="prod-mf-head" onClick={() => setClosedMf(c => { const n = new Set(c); n.has(mf) ? n.delete(mf) : n.add(mf); return n; })}
                  aria-expanded={!closedMf.has(mf)}>
                  <span>{closedMf.has(mf) ? '▸' : '▾'} {mf}</span><em>{list.length}</em>
                </button>
                {isAdmin && list.some(canEdit) && (
                  <button type="button" className="prod-mf-del" title={`Перейменувати виробника «${mf}»`} aria-label={`Перейменувати виробника ${mf}`}
                    disabled={loading} onClick={() => renameMf(mf, list)}>✎</button>
                )}
                {isAdmin && list.some(canEdit) && (
                  <button type="button" className="prod-mf-del" title={`Видалити виробника «${mf}»`} aria-label={`Видалити виробника ${mf}`}
                    disabled={loading} onClick={() => delGroup(mf, list)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>
              {!closedMf.has(mf) && <div className="prod-mf-list">
              {list.map(m => (
            <div key={m.id} onClick={() => selectMaterial(m)}
              className={`prod-item${dropAt === 'm:' + m.id ? ' drop' : ''}${drag?.id === m.id ? ' dragging' : ''}`}
              draggable={isAdmin && canEdit(m)}
              onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(MAT_DND, JSON.stringify([m.id])); setDrag({ kind: 'mat', id: m.id }); }}
              onDragEnd={() => { setDrag(null); setDropAt(''); }}
              onDragOver={e => { if (drag?.kind === 'mat') { e.preventDefault(); e.stopPropagation(); setDropAt('m:' + m.id); } }}
              onDrop={e => onDropItem(e, m, mf)}
              style={{ padding:'10px 12px', cursor:'pointer', borderBottom:'1px solid var(--clr-border)',
                background: selected?.id===m.id ? 'var(--clr-brand-pale)' : 'transparent',
                borderLeft: selected?.id===m.id ? '3px solid var(--clr-brand)' : '3px solid transparent' }}>
              <div style={{ fontWeight:500, fontSize:'.85rem' }}>{m.name}</div>
              <div style={{ fontSize:'.75rem', color:'var(--clr-text-3)' }}>
                {m.useful_width} / {m.full_width} мм
              </div>
              <div style={{ fontSize:'.7rem', marginTop:'2px', display:'flex', gap:'4px', flexWrap:'wrap' }}>
                {(() => { const src = materialSource(m, myTid); return src.kind !== 'own' && (
                  <span className={`badge ${src.kind === 'abt' ? 'badge-blue' : 'badge-orange'}`} style={{ fontSize:'.68rem' }}>{src.label}</span>); })()}
                {m.published ? <span className="badge badge-green" style={{ fontSize:'.68rem' }}>У каталозі виробників</span> : null}
                <span style={{ background: m.is_active ? 'var(--clr-success-bg)' : 'var(--clr-error-bg)', color: m.is_active ? 'var(--clr-success)' : 'var(--clr-error)', padding:'1px 6px', borderRadius:'10px' }}>
                  {m.is_active ? 'Активний' : 'Неактивний'}
                </span>
              </div>
            </div>
              ))}
              </div>}
            </div>
          ))}
        </div>
      </div>

      {/* Права панель */}
      <div className="prod-form">
        {showForm && <button type="button" className="btn btn-secondary btn-sm prod-back" onClick={() => { setSelected(null); setIsNew(false); }}>← До списку матеріалів</button>}
        {!showForm ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--clr-text-3)' }}>
            Оберіть матеріал зліва або додайте новий
          </div>
        ) : (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <h2 style={{ margin:0 }}>{isNew ? `Новий матеріал (${sec?.name || CAT_LABEL[cat]})` : form.name}</h2>
              <div style={{ display:'flex', gap:'8px' }}>
                <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.85rem' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => f('is_active', e.target.checked)} />
                  Активний
                </label>
                {isMf && (isNew || (selected && materialSource(selected, myTid).kind === 'own')) && (
                  <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.85rem' }} title="Матеріал побачать усі кабінети ROOFKIT у каталозі виробників">
                    <input type="checkbox" checked={!!(form as any).published} onChange={e => setForm(p => ({ ...p, published: e.target.checked ? 1 : 0 } as any))} />
                    У каталог виробників
                  </label>
                )}
                {!isNew && selected && isAdmin && canEdit(selected) && (
                  <button className="btn btn-danger" onClick={delOne} disabled={loading}>Видалити</button>
                )}
                <button className="btn btn-primary" onClick={save} disabled={loading}>
                  {loading ? 'Збереження…' : '💾 Зберегти'}
                </button>
              </div>
            </div>

            {error   && <div className="alert alert-error"  style={{ marginBottom:'16px' }}>⚠️ {error}</div>}
            {success && <div style={{ background:'var(--clr-success-bg)', color:'var(--clr-success)', padding:'10px 16px', borderRadius:'8px', marginBottom:'16px' }}>{success}</div>}

            {/* Основна інформація */}
            <Section title="Основна інформація">
              <Row>
                <Field label="Назва матеріалу *">
                  <input className="form-control" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Н-р: MaxiTile Classic" />
                </Field>
                <Field label="Виробник *">
                  <input className="form-control" value={form.manufacturer || ''} onChange={e => f('manufacturer', e.target.value)} placeholder="Н-р: Ruukki" />
                </Field>
                <Field label="Розділ каталогу">
                  <input className="form-control" value={`${sec?.name || ''} · розрахунок: ${CAT_LABEL[cat]}`} readOnly title="Щоб перенести матеріал, перетягніть його на розділ у бічному меню" />
                </Field>
              </Row>
              <Row>
                <Field label="Порядок сортування">
                  <input type="number" className="form-control" value={form.sort_order} onChange={e => f('sort_order', Number(e.target.value))} />
                </Field>
              </Row>
            </Section>

            {/* Геометрія листа */}
            <Section title="Геометрія листа">
              <div style={{ marginBottom:'12px', padding:'12px', background:'var(--clr-info-bg)', borderRadius:'8px', fontSize:'.8rem', color:'var(--clr-info)' }}>
                Бокове перекриття рахується автоматично: повна ширина − корисна ширина = {Math.max(0, (form.full_width || 0) - (form.useful_width || 0))} мм
              </div>
              <Row>
                <Field label="Повна ширина листа, мм">
                  <input type="number" className="form-control" value={form.full_width} onChange={e => f('full_width', Number(e.target.value))} />
                </Field>
                <Field label="Корисна ширина листа, мм">
                  <input type="number" className="form-control" value={form.useful_width} onChange={e => f('useful_width', Number(e.target.value))} />
                </Field>
              </Row>
              <Row>
                <Field label="Поздовжнє перекриття, мм">
                  <input type="number" className="form-control" value={form.length_overlap} onChange={e => f('length_overlap', Number(e.target.value))} />
                </Field>
                {cat === 'tile' && <>
                  <Field label="Крок хвилі, мм">
                    <input type="number" className="form-control" value={form.wave_step || ''} onChange={e => f('wave_step', Number(e.target.value))} />
                  </Field>
                </>}
              </Row>
            </Section>

            {/* Довжини */}
            {isFixedType(form.type) ? (
            <Section title="Розмір елемента">
              <Row>
                <Field label="Довжина листа / модуля / черепиці, мм">
                  <input type="number" className="form-control" value={form.max_length}
                    onChange={e => { const v = Number(e.target.value); setForm(p => ({ ...p, max_length: v, min_length: v })); }} />
                  <div style={{ fontSize:'.75rem', color:'var(--clr-text-3)', marginTop:'4px' }}>Фіксована довжина, елемент не ріжеться. Ширини і нахлести — у розділі «Геометрія».</div>
                </Field>
              </Row>
            </Section>
            ) : (
            <Section title="Довжини листів">
              <Row>
                <Field label="Мінімальна довжина, мм">
                  <input type="number" className="form-control" value={form.min_length} onChange={e => f('min_length', Number(e.target.value))} />
                </Field>
                <Field label="Максимальна довжина, мм">
                  <input type="number" className="form-control" value={form.max_length} onChange={e => f('max_length', Number(e.target.value))} />
                </Field>
                <Field label="Величина округлення, мм">
                  <input type="number" className="form-control" value={form.round_step ?? form.cut_step ?? ''} onChange={e => f('round_step', Number(e.target.value))} />
                  <div style={{ fontSize:'.75rem', color:'var(--clr-text-3)', marginTop:'4px' }}>КП рекомендує 10 мм (0.010 м)</div>
                </Field>
                {cat === 'tile' && (
                  <Field label="Lmax стандартна, мм">
                    <input type="number" className="form-control" value={form.max_std_length ?? ''} placeholder="авто: хвиля×n+ПЗ" onChange={e => f('max_std_length', e.target.value === '' ? null : Number(e.target.value))} />
                  </Field>
                )}
              </Row>
              <Row>
                <Field label="Заборонені діапазони довжин" style={{ flex:2 }}>
                  <ForbiddenRanges value={forbiddenInput} onChange={setForbiddenInput} />
                </Field>
              </Row>
            </Section>
            )}

            {/* Замок (тільки для фальцевої) */}
            {cat === 'falts' && (
              <Section title="Параметри замку (фальц)">
                <Row>
                  <Field label="Тип замку">
                    <select className="form-control" value={form.lock_type || ''} onChange={e => f('lock_type', e.target.value)}>
                      <option value="">— оберіть —</option>
                      <option value="standing">Стоячий фальц</option>
                      <option value="lying">Лежачий фальц</option>
                      <option value="double">Подвійний фальц</option>
                      <option value="click">Клік-фальц</option>
                    </select>
                  </Field>
                  <Field label="Мін. відстань між стиками, мм">
                    <input type="number" className="form-control" value={form.min_joint_distance || ''} onChange={e => f('min_joint_distance', Number(e.target.value))} />
                  </Field>
                  <Field label="Перекриття в стику, мм">
                    <input type="number" className="form-control" value={form.join_overlap || ''} onChange={e => f('join_overlap', Number(e.target.value))} />
                  </Field>
                </Row>
              </Section>
            )}

            <div style={{ marginTop:'24px', display:'flex', justifyContent:'flex-end', gap:'12px' }}>
              <button className="btn btn-ghost" onClick={() => { setSelected(null); setIsNew(false); }}>Скасувати</button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Збереження…' : 'Зберегти матеріал'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background:'var(--clr-surface)', border:'1px solid var(--clr-border)', borderRadius:'10px', marginBottom:'16px', overflow:'hidden' }}>
      <div style={{ padding:'10px 16px', background:'var(--clr-surface-2)', borderBottom:'1px solid var(--clr-border)', fontWeight:600, fontSize:'.85rem', color:'var(--clr-text-2)' }}>
        {title}
      </div>
      <div style={{ padding:'16px' }}>{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display:'flex', gap:'16px', marginBottom:'12px', flexWrap:'wrap' }}>{children}</div>;
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ flex:1, minWidth:'180px', ...style }}>
      <label style={{ display:'block', fontSize:'.78rem', fontWeight:500, color:'var(--clr-text-2)', marginBottom:'4px' }}>{label}</label>
      {children}
    </div>
  );
}
