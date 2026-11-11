// Вікно «Історія дій» у каталозі — ті самі записи історії, лише дії з каталогом
import React, { useEffect } from 'react';
import HistoryList from '../history/HistoryList';

export default function CatalogHistory({ onClose, onUndone }: { onClose: () => void; onUndone?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    if (!onUndone) return;
    window.addEventListener('rk-catalog-changed', onUndone); return () => window.removeEventListener('rk-catalog-changed', onUndone);
  }, [onUndone]);
  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Історія дій" onClick={onClose}>
      <div className="kp-modal-box hist-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>🕘 Історія дій з каталогом</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        <HistoryList kind="catalog" />
      </div>
    </div>
  );
}
