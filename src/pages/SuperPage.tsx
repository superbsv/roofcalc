// ============================================
// ABT Покрівля — панель супер-адміна платформи
// Кабінети клієнтів: тарифи, оплата, ліміти, блокування, користувачі, «Увійти як».
// ============================================

import React, { useCallback, useEffect, useState } from 'react';
import { superApi, Tenant, TenantDetail, SuperStats, TenantState } from '../api/client';
import { useAuth } from '../components/auth/AuthContext';

const STATE: Record<TenantState, [string, string]> = {
  internal: ['Внутрішній', 'badge-blue'],
  active:   ['Активний', 'badge-green'],
  trial:    ['Пробний', 'badge-orange'],
  expired:  ['Не оплачено', 'badge-red'],
  blocked:  ['Заблоковано', 'badge-red'],
};
const ROLES: Record<string, string> = { admin: 'Власник / адмін', manager: 'Менеджер', dealer: 'Дилер', production: 'Виробництво', viewer: 'Перегляд' };

const dateUa = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '—');
const daysLeft = (d?: string | null) => {
  if (!d) return null;
  return Math.ceil((new Date(d + 'T23:59:59').getTime() - Date.now()) / 86400000);
};

export default function SuperPage({ onOpenCabinet }: { onOpenCabinet: () => void }) {
  const { impersonate } = useAuth();
  const [stats, setStats] = useState<SuperStats | null>(null);
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<TenantDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (q = '') => {
    try {
      const [s, t] = await Promise.all([superApi.stats(), superApi.tenants(q)]);
      setStats(s.stats); setPlans(t.plans); setTenants(t.tenants);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await fn(); } catch (e: any) { setError(e.message); }
    setBusy('');
  };

  const open = (id: number) => run('open', async () => { setSel(await superApi.tenant(id)); });
  const afterChange = async (d: TenantDetail) => { setSel(d); await load(search); };

  const loginAs = (t: Tenant) => run('imp', async () => {
    await impersonate(t.id);
    onOpenCabinet();
  });

  return (
    <div className="super">
      <div className="page-header">
        <div>
          <h1 className="page-title">Платформа · кабінети</h1>
          <div className="page-subtitle">Компанії-клієнти, тарифи, оплата і доступ</div>
        </div>
        <div className="flex gap-3" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="form-label" style={{ margin: 0 }}>Пошук
            <input className="form-control" type="search" placeholder="Компанія, email, телефон, місто" value={search}
              onChange={e => { setSearch(e.target.value); const v = e.target.value; clearTimeout((window as any)._ssrch); (window as any)._ssrch = setTimeout(() => load(v), 350); }} />
          </label>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Створити кабінет</button>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {stats && (
        <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {([
            ['Кабінетів клієнтів', stats.tenants],
            ['Активних (оплачено)', stats.active],
            ['На пробному періоді', stats.trial],
            ['Не оплачено', stats.expired],
            ['Заблоковано', stats.blocked],
            ['Розрахунків за 30 днів', stats.projects_30d],
          ] as [string, number][]).map(([l, v]) => (
            <div key={l} className="metric-card"><div className="metric-value">{v}</div><div className="metric-label">{l}</div></div>
          ))}
        </div>
      )}

      <div className="super-grid">
        <div className="card" style={{ padding: 0, overflow: 'hidden', minWidth: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Компанія</th><th>Тариф</th><th>Стан</th><th>Діє до</th><th>Корист.</th><th>Розрах. 30 дн / всього</th><th>Останній вхід</th><th></th></tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const [label, cls] = STATE[t.state] || ['—', 'badge-gray'];
                  const until = t.state === 'trial' ? t.trial_until : t.paid_until;
                  const left = daysLeft(until);
                  return (
                    <tr key={t.id} className={sel?.tenant.id === t.id ? 'super-row-on' : ''}>
                      <td>
                        <button type="button" className="super-link" onClick={() => open(t.id)}>{t.name}</button>
                        {String(t.is_manufacturer ?? '0') === '1' && <span className="badge badge-orange" style={{ marginLeft: 6 }}>Виробник</span>}
                        <div className="text-xs text-muted">{[t.contact_email, t.contact_phone, t.city].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td>{plans[t.plan] || t.plan}</td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td>{t.state === 'internal' ? '∞' : dateUa(until)}{left !== null && t.state !== 'internal' && left >= 0 && left <= 7 ? <div className="text-xs" style={{ color: 'var(--clr-warning)' }}>{left} дн.</div> : null}</td>
                      <td>{t.users_count}{t.max_users ? ` / ${t.max_users}` : ''}</td>
                      <td>{t.projects_30d} / {t.projects_count}</td>
                      <td className="text-xs text-muted">{t.last_login_at ? dateUa(t.last_login_at) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => open(t.id)}>Відкрити</button>
                        {t.state !== 'internal' && <button className="btn btn-secondary btn-sm" onClick={() => loginAs(t)} disabled={!!busy}>Увійти як</button>}
                      </td>
                    </tr>
                  );
                })}
                {!tenants.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--clr-text-3)' }}>Кабінетів не знайдено</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {sel && <TenantCard d={sel} plans={plans} busy={busy} onClose={() => setSel(null)} onChanged={afterChange}
          run={run} onLoginAs={() => loginAs(sel.tenant)} />}
      </div>

      {creating && <CreateTenant plans={plans} onClose={() => setCreating(false)}
        onCreated={async d => { setCreating(false); await afterChange(d); }} />}
    </div>
  );
}

// ---------- Картка кабінету ----------
function TenantCard({ d, plans, busy, onClose, onChanged, run, onLoginAs }: {
  d: TenantDetail; plans: Record<string, string>; busy: string;
  onClose: () => void; onChanged: (d: TenantDetail) => Promise<void>;
  run: (label: string, fn: () => Promise<void>) => Promise<void>; onLoginAs: () => void;
}) {
  const t = d.tenant;
  const internal = String(t.is_internal) === '1';
  const [f, setF] = useState<Partial<Tenant>>({});
  const [nu, setNu] = useState({ name: '', login: '', email: '', password: '', role: 'manager' });
  useEffect(() => {
    setF({
      name: t.name, plan: t.plan, status: t.status, trial_until: t.trial_until || '', paid_until: t.paid_until || '',
      max_users: t.max_users ?? null, max_projects_month: t.max_projects_month ?? null,
      contact_name: t.contact_name || '', contact_email: t.contact_email || '', contact_phone: t.contact_phone || '',
      city: t.city || '', notes: t.notes || '', is_manufacturer: String(t.is_manufacturer ?? '0') === '1',
    });
  }, [t]);
  const set = (k: keyof Tenant, v: any) => setF(x => ({ ...x, [k]: v }));
  const [label, cls] = STATE[t.state];

  return (
    <aside className="card super-card" aria-label={`Кабінет ${t.name}`}>
      <div className="super-card-head">
        <div>
          <div className="text-xs text-muted">Кабінет №{t.id} · створено {dateUa(t.created_at)}</div>
          <h2 style={{ margin: '2px 0 6px', fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>{t.name}</h2>
          <span className={`badge ${cls}`}>{label}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрити картку">✕</button>
      </div>

      {!internal && (
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onLoginAs} disabled={!!busy}>Увійти як клієнт</button>
          {[1, 3, 12].map(m => (
            <button key={m} className="btn btn-secondary btn-sm" disabled={!!busy}
              onClick={() => run('ext', async () => { await onChanged(await superApi.extend(t.id, m, f.plan === 'trial' ? 'start' : f.plan)); })}>
              +{m} міс.
            </button>
          ))}
          {t.status === 'blocked'
            ? <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => run('st', async () => { await onChanged(await superApi.update(t.id, { status: 'active' })); })}>Розблокувати</button>
            : <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => window.confirm(`Заблокувати «${t.name}»? Кабінет перейде в режим «лише перегляд».`) && run('st', async () => { await onChanged(await superApi.update(t.id, { status: 'blocked' })); })}>Заблокувати</button>}
        </div>
      )}

      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 0 }}>
        <div className="metric-card"><div className="metric-value">{d.stats.projects_30d}</div><div className="metric-label">розрахунків за 30 дн.</div></div>
        <div className="metric-card"><div className="metric-value">{d.stats.projects}</div><div className="metric-label">усього розрахунків</div></div>
        <div className="metric-card"><div className="metric-value">{d.stats.materials}</div><div className="metric-label">власних матеріалів</div></div>
      </div>

      <form className="super-form" onSubmit={e => { e.preventDefault(); run('save', async () => { await onChanged(await superApi.update(t.id, f)); }); }}>
        <label className="form-label">Назва компанії<input className="form-control" value={f.name || ''} onChange={e => set('name', e.target.value)} /></label>
        {!internal && (
          <>
            <div className="form-row form-row-2">
              <label className="form-label">Тариф
                <select className="form-control" value={f.plan || ''} onChange={e => set('plan', e.target.value)}>
                  {Object.entries(plans).filter(([k]) => k !== 'internal').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="form-label">Статус
                <select className="form-control" value={f.status || ''} onChange={e => set('status', e.target.value)}>
                  <option value="trial">Пробний період</option><option value="active">Активний (оплата)</option><option value="blocked">Заблоковано</option>
                </select></label>
              <label className="form-label">Пробний до<input className="form-control" type="date" value={f.trial_until || ''} onChange={e => set('trial_until', e.target.value)} /></label>
              <label className="form-label">Оплачено до<input className="form-control" type="date" value={f.paid_until || ''} onChange={e => set('paid_until', e.target.value)} /></label>
              <label className="form-label">Макс. користувачів<input className="form-control" inputMode="numeric" placeholder="без ліміту" value={f.max_users ?? ''} onChange={e => set('max_users', e.target.value)} /></label>
              <label className="form-label">Розрахунків / міс<input className="form-control" inputMode="numeric" placeholder="без ліміту" value={f.max_projects_month ?? ''} onChange={e => set('max_projects_month', e.target.value)} /></label>
            </div>
          </>
        )}
        <div className="form-row form-row-2">
          <label className="form-label">Контактна особа<input className="form-control" value={f.contact_name || ''} onChange={e => set('contact_name', e.target.value)} /></label>
          <label className="form-label">Місто<input className="form-control" value={f.city || ''} onChange={e => set('city', e.target.value)} /></label>
          <label className="form-label">Email<input className="form-control" type="email" value={f.contact_email || ''} onChange={e => set('contact_email', e.target.value)} /></label>
          <label className="form-label">Телефон<input className="form-control" type="tel" value={f.contact_phone || ''} onChange={e => set('contact_phone', e.target.value)} /></label>
        </div>
        <label className="form-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!f.is_manufacturer} onChange={e => set('is_manufacturer', e.target.checked)} />
          Виробник — може публікувати свої матеріали в каталог виробників для всіх кабінетів
        </label>
        <label className="form-label">Нотатки (бачить лише ABT)<textarea className="form-control" rows={2} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={!!busy}>{busy === 'save' ? 'Збереження…' : 'Зберегти'}</button>
      </form>

      <div>
        <h3 className="kp-h3">Користувачі кабінету · {d.users.length}{t.max_users ? ` / ${t.max_users}` : ''}</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ім'я</th><th>Логін / email</th><th>Роль</th><th>Вхід</th></tr></thead>
            <tbody>
              {d.users.map(u => (
                <tr key={u.id} style={{ opacity: String(u.is_active) === '1' ? 1 : 0.5 }}>
                  <td>{u.name}</td><td className="text-xs">{u.login}{u.email && u.email !== u.login ? <div className="text-muted">{u.email}</div> : null}</td>
                  <td className="text-xs">{ROLES[u.role] || u.role}</td><td className="text-xs text-muted">{dateUa(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="super-adduser" onSubmit={e => { e.preventDefault(); run('user', async () => { await onChanged(await superApi.addUser(t.id, nu)); setNu({ name: '', login: '', email: '', password: '', role: 'manager' }); }); }}>
          <input className="form-control" aria-label="Ім'я" placeholder="Ім'я" value={nu.name} onChange={e => setNu(v => ({ ...v, name: e.target.value }))} />
          <input className="form-control" aria-label="Логін" placeholder="Логін" value={nu.login} onChange={e => setNu(v => ({ ...v, login: e.target.value }))} />
          <input className="form-control" aria-label="Email" placeholder="Email" type="email" value={nu.email} onChange={e => setNu(v => ({ ...v, email: e.target.value }))} />
          <input className="form-control" aria-label="Пароль" placeholder="Пароль (від 8 символів)" type="text" value={nu.password} onChange={e => setNu(v => ({ ...v, password: e.target.value }))} />
          <select className="form-control" aria-label="Роль" value={nu.role} onChange={e => setNu(v => ({ ...v, role: e.target.value }))}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-secondary" type="submit" disabled={!!busy}>+ Додати</button>
        </form>
      </div>

      {d.log.length > 0 && (
        <div>
          <h3 className="kp-h3">Журнал кабінету</h3>
          <div className="super-log">
            {d.log.map((l, i) => <div key={i}><span className="text-muted">{l.created_at.slice(0, 16).replace('T', ' ')}</span> · {l.user_name || '—'} · {l.action}</div>)}
          </div>
        </div>
      )}
    </aside>
  );
}

// ---------- Новий кабінет ----------
function CreateTenant({ plans, onClose, onCreated }: { plans: Record<string, string>; onClose: () => void; onCreated: (d: TenantDetail) => Promise<void> }) {
  const [f, setF] = useState({ name: '', city: '', contact_phone: '', owner_name: '', owner_login: '', owner_email: '', owner_password: '', plan: 'trial', trial_days: 14, max_users: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: any) => setF(x => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await onCreated(await superApi.create(f)); } catch (er: any) { setError(er.message); }
    setBusy(false);
  };
  return (
    <div className="kp-modal" role="dialog" aria-modal="true" aria-label="Новий кабінет" onClick={onClose}>
      <form className="kp-modal-box" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="kp-modal-head"><span>Новий кабінет</span><button type="button" className="kp-x" onClick={onClose} aria-label="Закрити">×</button></div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="form-label">Назва компанії *<input className="form-control" required value={f.name} onChange={e => set('name', e.target.value)} autoFocus /></label>
          <div className="form-row form-row-2">
            <label className="form-label">Місто<input className="form-control" value={f.city} onChange={e => set('city', e.target.value)} /></label>
            <label className="form-label">Телефон<input className="form-control" type="tel" value={f.contact_phone} onChange={e => set('contact_phone', e.target.value)} /></label>
          </div>
          <div className="kp-h3" style={{ marginTop: 6 }}>Власник кабінету (перший користувач)</div>
          <div className="form-row form-row-2">
            <label className="form-label">Ім'я<input className="form-control" value={f.owner_name} onChange={e => set('owner_name', e.target.value)} /></label>
            <label className="form-label">Email<input className="form-control" type="email" value={f.owner_email} onChange={e => set('owner_email', e.target.value)} /></label>
            <label className="form-label">Логін<input className="form-control" value={f.owner_login} onChange={e => set('owner_login', e.target.value)} placeholder="або вхід за email" /></label>
            <label className="form-label">Пароль *<input className="form-control" required minLength={8} value={f.owner_password} onChange={e => set('owner_password', e.target.value)} placeholder="від 8 символів" /></label>
          </div>
          <div className="form-row form-row-2">
            <label className="form-label">Тариф
              <select className="form-control" value={f.plan} onChange={e => set('plan', e.target.value)}>
                {Object.entries(plans).filter(([k]) => k !== 'internal').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            {f.plan === 'trial'
              ? <label className="form-label">Днів пробного<input className="form-control" type="number" min={1} max={90} value={f.trial_days} onChange={e => set('trial_days', +e.target.value)} /></label>
              : <label className="form-label">Макс. користувачів<input className="form-control" inputMode="numeric" placeholder="без ліміту" value={f.max_users} onChange={e => set('max_users', e.target.value)} /></label>}
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="text-xs text-muted">Передайте власнику логін і пароль — він зможе змінити пароль у профілі.</div>
        </div>
        <div className="kp-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Скасувати</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Створення…' : 'Створити'}</button>
        </div>
      </form>
    </div>
  );
}
