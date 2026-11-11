// ============================================
// Історія дій з каталогом: останні зміни (додано / змінено / видалено / перенесено / імпорт)
// з кнопкою «Скасувати» — повертає позиції каталогу до стану перед дією
// ============================================
import React, { useEffect, useState } from 'react';
import { catApi, catalogChanged } from './CatalogNav';

interface Item { id: number; label: string; created_at: string; undone_at?: string | null; user_name?: string | null; count: number }

const when = (s: string) => {
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(+d)) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function CatalogHistory({ onClose, onUndone }: { onClose: () => void; onUndone?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    catApi('GET', '/catalog/history').then(d => setItems(d.items || [])).catch(e => setMsg(e.message)).finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const undo = async (it: Item) => {
    if (!window.confirm(`Скасувати дію «${it.label}»?\nПозиції каталогу повернуться до стану перед цією дією.`)) return; // i18n-ignore (tpl)
    setBusy(true); setMsg('');
    try {
      const d = await catApi('POST', `/catalog/history/${it.id}/undo`);
      setItems(d.items || []);
      setMsg(`Скасовано. Відновлено позицій: ${d.restored}`); // i18n-ignore (tpl)
      catalogChanged(); onUndone?.();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Історія дій" onClick={onClose}>
      <div className="kp-modal-box hist-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>🕘 Історія дій з каталогом</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        {msg && <div className="hist-msg">{msg}</div>}
        <div className="hist-list">
          {busy && !items.length && <div className="lib-empty">Завантаження…</div>}
          {!busy && !items.length && <div className="lib-empty">Дій поки немає</div>}
          {items.map(it => (
            <div key={it.id} className={`hist-row${it.undone_at ? ' undone' : ''}`}>
              <span className="hist-when">{when(it.created_at)}</span>
              <span className="hist-label">{it.label}</span>
              {it.user_name && <span className="hist-user" data-no-i18n>{it.user_name}</span>}
              {it.undone_at
                ? <span className="hist-done">скасовано</span>
                : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => undo(it)} title="Повернути як було до цієї дії">↶ Скасувати</button>}
            </div>
          ))}
        </div>
        <div className="hist-note">Зберігаються останні 100 дій. Скасування повертає позиції до стану перед дією (пізніші зміни цих позицій теж відкотяться).</div>
      </div>
    </div>
  );
}
