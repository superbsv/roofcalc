// ============================================
// Історія дій з кнопкою «Скасувати» — спільний список для сторінки «Історія дій» і вікна в каталозі.
// Скасування повертає змінені дією дані до стану перед нею (видалене — відновлюється, додане — прибирається)
// ============================================
import React, { useEffect, useState } from 'react';
import { catApi, catalogChanged } from '../catalog/CatalogNav';

export interface HistItem { id: number; kind: string; label: string; created_at: string; updated_at?: string; undone_at?: string | null; user_name?: string | null }

export const KINDS: [string, string][] = [
  ['', 'Усе'], ['project', 'Проекти'], ['client', 'Клієнти'], ['catalog', 'Каталог'], ['flashing', 'Креслення'], ['settings', 'Налаштування'], ['lead', 'Заявки'],
];

const when = (s?: string) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(+d)) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function HistoryList({ kind = '', chips = false }: { kind?: string; chips?: boolean }) {
  const [k, setK] = useState(kind);
  const [items, setItems] = useState<HistItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState('');
  const q = k ? `?kind=${k}` : '';

  useEffect(() => {
    setBusy(true);
    catApi('GET', '/history' + q).then(d => setItems(d.items || [])).catch(e => setMsg(e.message)).finally(() => setBusy(false));
  }, [q]);

  const undo = async (it: HistItem) => {
    if (!window.confirm(`Скасувати дію «${it.label}»?\nДані повернуться до стану перед цією дією.`)) return; // i18n-ignore (tpl)
    setBusy(true); setMsg('');
    try {
      const d = await catApi('POST', `/history/${it.id}/undo${q}`);
      setItems(d.items || []);
      setMsg(`Скасовано: ${it.label}`); // i18n-ignore (tpl)
      if (it.kind === 'catalog') catalogChanged();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="hist">
      {chips && (
        <div className="cl-chips hist-chips">
          {KINDS.map(([v, l]) => <button key={v} className={k === v ? 'on' : ''} onClick={() => setK(v)}>{l}</button>)}
        </div>
      )}
      {msg && <div className="hist-msg">{msg}</div>}
      <div className="hist-list">
        {busy && !items.length && <div className="lib-empty">Завантаження…</div>}
        {!busy && !items.length && <div className="lib-empty">Дій поки немає</div>}
        {items.map(it => (
          <div key={it.id} className={`hist-row${it.undone_at ? ' undone' : ''}`}>
            <span className="hist-when">{when(it.updated_at || it.created_at)}</span>
            <span className="hist-label">{it.label}</span>
            {it.user_name && <span className="hist-user" data-no-i18n>{it.user_name}</span>}
            {it.undone_at
              ? <span className="hist-done">скасовано</span>
              : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => undo(it)} title="Повернути як було до цієї дії">↶ Скасувати</button>}
          </div>
        ))}
      </div>
      <div className="hist-note">Зберігаються останні 150 дій. Часті правки одного ската чи проекту за 5 хвилин об'єднуються в один запис. Скасування повертає дані до стану перед дією — пізніші зміни тих самих даних теж відкотяться.</div>
    </div>
  );
}
