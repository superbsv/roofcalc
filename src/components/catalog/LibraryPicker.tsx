// ============================================
// Вибір позицій з «Каталогу ROOFKIT» для копіювання в особистий каталог кабінету
// ============================================
import React, { useEffect, useMemo, useState } from 'react';
import { catApi, catalogChanged, useSections } from './CatalogNav';

interface Item { id: number; name: string; manufacturer?: string | null; type: string; section_id: number; full_width: number; useful_width: number; max_length: number; tenant_id?: number | null; owner_name?: string | null; in_my: number }

export default function LibraryPicker({ section, calcTypes, onClose, onCopied }: {
  section?: number; calcTypes?: string[]; onClose: () => void; onCopied?: (n: number) => void;
}) {
  const { sections } = useSections();
  const [sec, setSec] = useState<number | ''>(section ?? '');
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const secs = sections.filter(s => !calcTypes || calcTypes.includes(s.calc_type));

  useEffect(() => {
    setBusy(true); setSel(new Set());
    catApi('GET', '/catalog/library' + (sec ? `?section=${sec}` : ''))
      .then(d => setItems((d.items as Item[]).filter(i => !calcTypes || calcTypes.includes(i.type))))
      .catch(e => setMsg(e.message)).finally(() => setBusy(false));
  }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const mf = (i: Item) => (i.manufacturer || '').trim() || (i.tenant_id ? i.owner_name || '' : '') || 'Без виробника';
  const shown = items.filter(i => !q.trim() || `${i.name} ${mf(i)}`.toLowerCase().includes(q.trim().toLowerCase()));
  const groups = useMemo(() => {
    const g = new Map<string, Item[]>();
    shown.forEach(i => { const k = mf(i); g.set(k, [...(g.get(k) || []), i]); });
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0], 'uk'));
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (list: Item[]) => setSel(s => {
    const free = list.filter(i => !+i.in_my); const all = free.every(i => s.has(i.id));
    const n = new Set(s); free.forEach(i => (all ? n.delete(i.id) : n.add(i.id))); return n;
  });
  const copy = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await catApi('POST', '/catalog/copy', { ids: Array.from(sel) });
      catalogChanged(); onCopied?.(r.copied); onClose();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Каталог ROOFKIT" onClick={onClose}>
      <div className="kp-modal-box lib-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>Каталог ROOFKIT — оберіть позиції для свого каталогу</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        <div className="lib-tools">
          <select className="form-control" value={sec} onChange={e => setSec(e.target.value ? Number(e.target.value) : '')} aria-label="Розділ">
            <option value="">Усі розділи</option>
            {secs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className="form-control" placeholder="Пошук: назва або виробник" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="lib-list">
          {busy && !items.length && <div className="lib-empty">Завантаження…</div>}
          {!busy && !shown.length && <div className="lib-empty">У каталозі ROOFKIT немає позицій у цьому розділі.</div>}
          {groups.map(([g, list]) => (
            <div key={g} className="lib-group">
              <label className="lib-ghead"><input type="checkbox" checked={list.filter(i => !+i.in_my).length > 0 && list.filter(i => !+i.in_my).every(i => sel.has(i.id))}
                disabled={list.every(i => +i.in_my)} onChange={() => toggleGroup(list)} /> <b>{g}</b> <em>{list.length}</em></label>
              {list.map(i => (
                <label key={i.id} className={`lib-item${+i.in_my ? ' have' : ''}`}>
                  <input type="checkbox" checked={sel.has(i.id) || !!+i.in_my} disabled={!!+i.in_my} onChange={() => toggle(i.id)} />
                  <span className="lib-name">{i.name}</span>
                  <span className="lib-meta">{i.useful_width}/{i.full_width} мм · до {(i.max_length / 1000).toFixed(1)} м</span>
                  {+i.in_my ? <span className="badge badge-green">Уже у вашому каталозі</span> : null}
                </label>
              ))}
            </div>
          ))}
        </div>
        {msg && <div className="alert alert-error" style={{ margin: '0 14px' }}>{msg}</div>}
        <div className="kp-modal-foot">
          <button className="btn btn-secondary" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary" disabled={!sel.size || busy} onClick={copy}>Скопіювати в мій каталог ({sel.size})</button>
        </div>
      </div>
    </div>
  );
}
