// ============================================
// Структура «Каталогу продукції» в бічному меню:
// розділи можна перетягувати, додавати, перейменовувати і видаляти (адмін платформи);
// на розділ можна перетягнути матеріал зі списку — він переїде в цей розділ.
// ============================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MATERIAL_TYPES } from '../roof/materials';

export interface CatalogSection { id: number; name: string; calc_type: string; sort_order: number; cnt: number }

const BASE = process.env.REACT_APP_API_URL || '/api';
export const catApi = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('rc_token')}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let d: any = {};
  try { d = t ? JSON.parse(t) : {}; } catch { throw new Error(`Помилка сервера (${r.status})`); }
  if (!r.ok) throw new Error(d.error || 'Помилка');
  return d;
};

// Сповіщення між сайдбаром і сторінкою каталогу (оновити лічильники / список)
export const CATALOG_EVENT = 'rk-catalog-changed';
export const catalogChanged = () => window.dispatchEvent(new Event(CATALOG_EVENT));
export const MAT_DND = 'application/x-rk-material';

let cache: CatalogSection[] | null = null;
export function useSections() {
  const [list, setList] = useState<CatalogSection[]>(cache || []);
  const [canEdit, setCanEdit] = useState(false);
  const load = useCallback(async () => {
    try { const d = await catApi('GET', '/catalog/sections'); cache = d.sections; setList(d.sections); setCanEdit(!!d.can_edit); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(CATALOG_EVENT, load);
    return () => window.removeEventListener(CATALOG_EVENT, load);
  }, [load]);
  return { sections: list, setSections: setList, canEdit, reload: load };
}

export default function CatalogNav({ active, onOpen }: { active?: number; onOpen: (id: number) => void }) {
  const { sections, setSections, canEdit, reload } = useSections();
  const [edit, setEdit] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('tile');
  const [msg, setMsg] = useState('');
  const [over, setOver] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);

  const fail = (e: any) => { setMsg(e.message || 'Помилка'); setTimeout(() => setMsg(''), 4000); };
  const run = async (fn: () => Promise<any>) => { try { const d = await fn(); if (d?.sections) setSections(d.sections); catalogChanged(); } catch (e) { fail(e); } };

  const onDragStart = (e: React.DragEvent, id: number) => { dragId.current = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'section:' + id); };
  const onDragOver = (e: React.DragEvent, id: number) => {
    const isMat = e.dataTransfer.types.includes(MAT_DND);
    if (isMat || (edit && dragId.current !== null)) { e.preventDefault(); setOver(id); }
  };
  const onDrop = (e: React.DragEvent, id: number) => {
    e.preventDefault(); setOver(null);
    const mat = e.dataTransfer.getData(MAT_DND);
    if (mat) {
      const ids = JSON.parse(mat) as number[];
      run(async () => { const r = await catApi('POST', '/catalog/move', { ids, section_id: id }); if (r.skipped || r.wrong_type) fail({ message: `Перенесено: ${r.moved}. Пропущено: ${r.skipped + r.wrong_type} (чужі або інший тип розрахунку)` }); return reload(); });
      return;
    }
    const from = dragId.current; dragId.current = null;
    if (from === null || from === id) return;
    const ids = sections.map(s => s.id).filter(x => x !== from);
    ids.splice(ids.indexOf(id), 0, from);
    setSections(ids.map(i => sections.find(s => s.id === i)!));      // одразу показуємо новий порядок
    run(() => catApi('PUT', '/catalog/sections-order', { ids }));
  };

  const saveName = (id: number) => { const n = name.trim(); setRenaming(null); if (n) run(() => catApi('PUT', `/catalog/sections/${id}`, { name: n })); };
  const del = (s: CatalogSection) => { if (window.confirm(`Видалити розділ «${s.name}»?`)) run(() => catApi('DELETE', `/catalog/sections/${s.id}`)); };
  const add = (e: React.FormEvent) => {
    e.preventDefault(); const n = newName.trim(); if (!n) return;
    run(async () => { const d = await catApi('POST', '/catalog/sections', { name: n, calc_type: newType }); setAdding(false); setNewName(''); return d; });
  };

  return (
    <div className="catnav">
      {canEdit && (
        <button type="button" className={`catnav-edit${edit ? ' on' : ''}`} onClick={() => { setEdit(!edit); setAdding(false); setRenaming(null); }}
          title="Змінити структуру каталогу">{edit ? '✓ Готово' : '✎ Структура'}</button>
      )}
      {sections.map(s => (
        <div key={s.id}
          className={`sidebar-item catnav-item${active === s.id ? ' active' : ''}${over === s.id ? ' over' : ''}${edit ? ' edit' : ''}`}
          draggable={edit && renaming !== s.id}
          onDragStart={e => onDragStart(e, s.id)} onDragEnd={() => { dragId.current = null; setOver(null); }}
          onDragOver={e => onDragOver(e, s.id)} onDragLeave={() => setOver(o => (o === s.id ? null : o))} onDrop={e => onDrop(e, s.id)}
          onClick={() => { if (renaming !== s.id) onOpen(s.id); }}>
          {edit && <span className="catnav-grip" aria-hidden="true">⋮⋮</span>}
          {renaming === s.id
            ? <input className="catnav-input" autoFocus value={name} onChange={e => setName(e.target.value)} onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') saveName(s.id); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => saveName(s.id)} />
            : <span className="catnav-name">{s.name}</span>}
          {!edit && s.cnt > 0 && <em className="catnav-cnt">{s.cnt}</em>}
          {edit && renaming !== s.id && <>
            <button type="button" className="catnav-btn" title="Перейменувати" onClick={e => { e.stopPropagation(); setRenaming(s.id); setName(s.name); }}>✎</button>
            <button type="button" className="catnav-btn del" title="Видалити розділ" onClick={e => { e.stopPropagation(); del(s); }}>×</button>
          </>}
        </div>
      ))}
      {edit && (adding
        ? <form className="catnav-add" onSubmit={add}>
            <input className="catnav-input" autoFocus placeholder="Назва розділу" value={newName} onChange={e => setNewName(e.target.value)} />
            <select className="catnav-input" value={newType} onChange={e => setNewType(e.target.value)} aria-label="Як рахувати">
              {MATERIAL_TYPES.map(t => <option key={t.key} value={t.key}>Розрахунок: {t.label}</option>)}
            </select>
            <div className="catnav-add-btns">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Скасувати</button>
              <button type="submit" className="btn btn-primary btn-sm">Додати</button>
            </div>
          </form>
        : <button type="button" className="catnav-plus" onClick={() => setAdding(true)}>+ Додати розділ</button>)}
      {edit && <div className="catnav-hint">Перетягуйте розділи за ⋮⋮. Матеріали можна перетягнути зі списку на потрібний розділ.</div>}
      {msg && <div className="catnav-msg">{msg}</div>}
    </div>
  );
}
