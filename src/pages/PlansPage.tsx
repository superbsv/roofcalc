// ============================================
// ABT Покрівля — тарифи платформи (супер-адмін)
// Назва, ціна, ліміти користувачів і розрахунків, показ на сторінці реєстрації, перелік можливостей.
// ============================================

import React, { useEffect, useState } from 'react';
import { superApi, PlanDef } from '../api/client';

const ORDER = ['trial', 'start', 'pro', 'business', 'custom'];

export default function PlansPage() {
  const [plans, setPlans] = useState<Record<string, PlanDef>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { superApi.stats().then(r => setPlans(r.plan_defs)).catch(e => setError(e.message)); }, []);
  const set = (k: string, patch: Partial<PlanDef>) => setPlans(p => ({ ...p, [k]: { ...p[k], ...patch } }));
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0) || null);

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const body: Record<string, Partial<PlanDef>> = {};
      ORDER.forEach(k => { if (plans[k]) body[k] = plans[k]; });
      const r = await superApi.savePlans(body);
      setPlans(r.plans); setMsg('Тарифи збережено');
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="super">
      <div className="page-header">
        <div>
          <h1 className="page-title">Тарифи платформи</h1>
          <div className="page-subtitle">Ліміти діють для всіх кабінетів тарифу, якщо в картці кабінету не задано власних</div>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Збереження…' : 'Зберегти'}</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      <div className="plans-grid">
        {ORDER.filter(k => plans[k]).map(k => {
          const p = plans[k];
          return (
            <section key={k} className="card plans-card">
              <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <input className="form-control plans-name" aria-label="Назва тарифу" value={p.name} onChange={e => set(k, { name: e.target.value })} />
                <span className="badge badge-gray">{k}</span>
              </div>
              <div className="form-row form-row-2">
                {k !== 'trial' && <label className="form-label">Ціна, грн / міс<input className="form-control" inputMode="numeric" value={p.price || ''} placeholder="уточнюйте" onChange={e => set(k, { price: Number(e.target.value) || 0 })} /></label>}
                {k !== 'trial' && <label className="form-label">Ціна за рік, грн<input className="form-control" inputMode="numeric" value={p.price_year || ''} placeholder="немає" onChange={e => set(k, { price_year: Number(e.target.value) || null })} /></label>}
                {k !== 'trial' && <label className="form-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={!!p.price_from} onChange={e => set(k, { price_from: e.target.checked })} /> Показувати «від» перед ціною</label>}
                {k === 'trial' && <label className="form-label">Днів пробного<input className="form-control" inputMode="numeric" value={p.days ?? ''} onChange={e => set(k, { days: num(e.target.value) })} /></label>}
                <label className="form-label">Користувачів<input className="form-control" inputMode="numeric" placeholder="∞" value={p.users ?? ''} onChange={e => set(k, { users: num(e.target.value) })} /></label>
                <label className="form-label">Розрахунків / міс<input className="form-control" inputMode="numeric" placeholder="∞" value={p.projects_month ?? ''} onChange={e => set(k, { projects_month: num(e.target.value) })} /></label>
              </div>
              {k !== 'trial' && k !== 'custom' && (
                <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                  <label className="text-sm" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!p.public} onChange={e => set(k, { public: e.target.checked })} /> Показувати на сторінці реєстрації</label>
                  <label className="text-sm" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={!!p.popular} onChange={e => set(k, { popular: e.target.checked })} /> Позначка «популярний»</label>
                </div>
              )}
              <label className="form-label">Можливості (кожна з нового рядка)
                <textarea className="form-control" rows={4} value={(p.features || []).join('\n')} onChange={e => set(k, { features: e.target.value.split('\n') })} />
              </label>
            </section>
          );
        })}
      </div>
    </div>
  );
}
