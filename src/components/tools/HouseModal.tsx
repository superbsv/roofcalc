// Візуалізатор будинку у вікні (як калькулятори). Після першого відкриття вікно лише ховається,
// щоб 3D не створювався заново (зберігаються обрані кольори і ракурс).
import React, { useEffect } from 'react';
import House3D from './House3D';

export default function HouseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Візуалізатор будинку" onClick={onClose} style={open ? undefined : { display: 'none' }}>
      <div className="kp-modal-box house-box" onClick={e => e.stopPropagation()}>
        <div className="kp-modal-head"><span>Візуалізатор будинку</span>
          <button className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        <div className="house-body"><House3D /></div>
      </div>
    </div>
  );
}
