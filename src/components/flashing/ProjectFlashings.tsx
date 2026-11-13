// ============================================
// Добірні елементи в специфікації проекту: креслення доборів, прив'язані до проекту,
// друкуються разом зі специфікацією (креслення з розмірами + таблиця). Кнопки керування
// (нове / прив'язати / відкрити / відв'язати) — лише на екрані, у друк і PDF не потрапляють.
// ============================================
import React, { useCallback, useEffect, useState } from 'react';
import { catApi } from '../catalog/CatalogNav';
import FlashingDraw from './FlashingDraw';
import { FDoc, FElem, blankCalc, emptyDoc } from './flashing';

interface Linked { id: number; name: string; client_name?: string | null; data: FDoc }
interface Row { id: number; name: string; project_id?: number | null; project_name?: string | null }

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const f2 = (v: number) => v.toFixed(2);

export default function ProjectFlashings({ projectId, onOpen }: { projectId: number; onOpen?: (id: number | null) => void }) {
  const [linked, setLinked] = useState<Linked[]>([]);
  const [free, setFree] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    catApi('GET', `/flashings?project_id=${projectId}`)
      .then(d => setLinked((d.items || []).map((r: any) => ({ ...r, data: { ...emptyDoc(), items: [], ...(r.data || {}) } }))))
      .catch(e => setMsg(e.message));
    catApi('GET', '/flashings').then(d => setFree((d.items || []).filter((r: Row) => !r.project_id))).catch(() => undefined);
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const link = async (id: number, pid: number | null) => {
    try { await catApi('POST', `/flashings/${id}/link`, { project_id: pid }); load(); } catch (e: any) { setMsg(e.message); }
  };

  return (
    <>
      <div className="kp-flash-ctl no-print" data-html2canvas-ignore>
        <b>Креслення доборів</b>
        {onOpen && <button className="btn btn-secondary btn-sm" onClick={() => onOpen(null)}>+ Нове креслення доборів</button>}
        {free.length > 0 && (
          <select className="form-control" value="" onChange={e => e.target.value && link(+e.target.value, projectId)}>
            <option value="">Прив'язати наявне креслення…</option>
            {free.map(r => <option key={r.id} value={r.id} data-no-i18n>{r.name}</option>)}
          </select>
        )}
        {linked.map(f => (
          <span key={f.id} className="kp-flash-chip">
            <span data-no-i18n>{f.name}</span>
            {onOpen && <button title="Відкрити креслення" onClick={() => onOpen(f.id)}>✎</button>}
            <button title="Відв'язати від проекту" onClick={() => link(f.id, null)}>✕</button>
          </span>
        ))}
        {!linked.length && <span className="text-muted">Креслення доборів не прив'язані — у специфікації їх не буде.</span>}
        {msg && <span className="fl-warn">{msg}</span>}
      </div>

      {linked.filter(f => f.data.items?.length).map(f => <FlashingBlock key={f.id} f={f} />)}
    </>
  );
}

function FlashingBlock({ f }: { f: Linked }) {
  const d = f.data, sw = d.sheet_width || 1250, sl = d.sheet_length || 2000;
  const items: FElem[] = d.items || [];
  const meta = [d.color && `RAL ${String(d.color).replace(/^RAL\s*/i, '')}`, d.coating, d.thickness && `${d.thickness} мм`, d.maker].filter(Boolean).join(' · ');
  const tot = items.reduce((a, e) => { const c = blankCalc(e, sw, sl); return { qty: a.qty + (e.qty || 0), runM: a.runM + c.runM }; }, { qty: 0, runM: 0 });
  return (
    <>
      <h3 className="kp-paper-h">ДОБІРНІ ЕЛЕМЕНТИ <span className="kp-flash-name" data-no-i18n>— {f.name}</span></h3>
      {meta && <div className="kp-paper-line" data-no-i18n>{meta}</div>}
      <div className="fl-paper-grid kp-flash-grid">
        {items.map((e, i) => {
          const c = blankCalc(e, sw, sl);
          return (
            <div key={e.id} className="fl-paper-item">
              <div className="fl-paper-name"><b>{i + 1}.</b> <span data-no-i18n>{e.name}</span></div>
              <FlashingDraw e={e} still={{ w: 330, h: 210 }} />
              <div className="fl-paper-meta">
                <span>Заготовка: <b>{f1(c.girth)} мм</b></span><span>Довжина: <b>{e.length} мм</b></span><span>К-сть: <b>{e.qty} шт</b></span>
              </div>
            </div>
          );
        })}
      </div>
      <table className="kp-table kp-paper-table">
        <thead><tr><th>№</th><th>Елемент</th><th>Ширина заготовки, мм</th><th>Загинів</th><th>Довжина, мм</th><th>К-сть, шт</th><th>П.м.</th></tr></thead>
        <tbody>
          {items.map((e, i) => {
            const c = blankCalc(e, sw, sl);
            return <tr key={e.id}><td>{i + 1}</td><td data-no-i18n>{e.name}</td><td>{f1(c.girth)}</td><td>{c.bends}</td><td>{e.length}</td><td>{e.qty}</td><td>{f2(c.runM)}</td></tr>;
          })}
          <tr className="tr-total"><td colSpan={5}>Всього:</td><td>{tot.qty}</td><td>{f2(tot.runM)}</td></tr>
        </tbody>
      </table>
      {d.note && <div className="kp-paper-line" data-no-i18n>{d.note}</div>}
    </>
  );
}
