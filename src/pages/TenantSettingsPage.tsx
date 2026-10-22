// ============================================
// ABT Покрівля — налаштування кабінету компанії
// Реквізити і логотип у документах, колір, нумерація замовлень, команда, тариф і ліміти.
// ============================================

import React, { useEffect, useRef, useState } from 'react';
import { tenantApi, teamApi, TenantInfo, TenantSettings, TeamUser } from '../api/client';
import { useAuth } from '../components/auth/AuthContext';

const ROLES: Record<string, string> = { admin: 'Адміністратор', manager: 'Менеджер', dealer: 'Дилер', production: 'Виробництво', viewer: 'Лише перегляд' };
const COLORS = ['#FF7A1A', '#2F6BC2', '#1E7A46', '#B42318', '#151E29'];
const dateUa = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '—');

export default function TenantSettingsPage() {
  const { user, refresh } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [info, setInfo] = useState<TenantInfo | null>(null);
  const [f, setF] = useState<Partial<TenantSettings>>({});
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [nu, setNu] = useState({ name: '', email: '', login: '', password: '', role: 'manager' });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const i = await tenantApi.get();
      setInfo(i); setF(i.tenant);
      if (isAdmin) setTeam((await teamApi.list()).users);
    } catch (e: any) { setError(e.message); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const run = async (label: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(label); setError(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); } catch (e: any) { setError(e.message); }
    setBusy('');
  };
  const set = (k: keyof TenantSettings, v: any) => setF(x => ({ ...x, [k]: v }));

  const save = () => run('save', async () => {
    const body: Partial<TenantSettings> = {
      name: f.name, doc_company: f.doc_company, doc_requisites: f.doc_requisites, doc_address: f.doc_address,
      doc_phone: f.doc_phone, doc_email: f.doc_email, doc_site: f.doc_site, brand_color: f.brand_color,
      next_order_no: f.next_order_no, logo: f.logo ?? null,
    };
    const i = await tenantApi.update(body);
    setInfo(i); setF(i.tenant);
    await refresh();
  }, 'Збережено');

  const pickLogo = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setError('Логотип — файл PNG або JPG'); return; }
    if (file.size > 400 * 1024) { setError('Логотип завеликий — до 400 КБ'); return; }
    const r = new FileReader();
    r.onload = () => set('logo', String(r.result));
    r.readAsDataURL(file);
  };

  const addUser = (e: React.FormEvent) => {
    e.preventDefault();
    run('user', async () => {
      await teamApi.create({ ...nu, name: nu.name || nu.email, login: nu.login || nu.email });
      setNu({ name: '', email: '', login: '', password: '', role: 'manager' });
      await load();
    }, 'Користувача додано');
  };
  const patchUser = (u: TeamUser, body: Record<string, unknown>) => run('u' + u.id, async () => {
    await teamApi.update(u.id, body); await load();
  });

  if (!info) return <div>{error ? <div className="alert alert-error">{error}</div> : 'Завантаження…'}</div>;
  const t = info.tenant;
  const internal = String(t.is_internal) === '1';
  const until = t.status === 'trial' ? t.trial_until : t.paid_until;
  const bar = (used: number, lim: number | null) => (lim ? Math.min(100, Math.round(used * 100 / lim)) : 0);

  return (
    <div className="tset">
      <div className="page-header">
        <div>
          <h1 className="page-title">Налаштування кабінету</h1>
          <div className="page-subtitle">{t.name}</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Збереження…' : 'Зберегти'}</button>}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {msg && <div className="alert alert-success" role="status">{msg}</div>}

      <div className="tset-grid">
        <section className="card tset-card">
          <h2 className="kp-h3">Компанія і документи</h2>
          <div className="tset-logo">
            <div className="tset-logo-box">{f.logo ? <img src={f.logo} alt="Логотип компанії" /> : <span>Логотип</span>}</div>
            {isAdmin && (
              <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={e => pickLogo(e.target.files?.[0])} />
                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>Завантажити логотип</button>
                {f.logo && <button className="btn btn-ghost btn-sm" onClick={() => set('logo', null)}>Прибрати</button>}
                <div className="text-xs text-muted" style={{ width: '100%' }}>PNG або JPG до 400 КБ. Друкується у шапці PDF.</div>
              </div>
            )}
          </div>
          <fieldset disabled={!isAdmin} className="tset-fields">
            <label className="form-label">Назва кабінету<input className="form-control" value={f.name || ''} onChange={e => set('name', e.target.value)} /></label>
            <label className="form-label">Назва в документах<input className="form-control" value={f.doc_company || ''} onChange={e => set('doc_company', e.target.value)} placeholder={t.name} /></label>
            <label className="form-label">Реквізити (ЄДРПОУ, IBAN, адреса)<textarea className="form-control" rows={3} value={f.doc_requisites || ''} onChange={e => set('doc_requisites', e.target.value)} /></label>
            <div className="form-row form-row-2">
              <label className="form-label">Телефон<input className="form-control" type="tel" value={f.doc_phone || ''} onChange={e => set('doc_phone', e.target.value)} /></label>
              <label className="form-label">Email<input className="form-control" type="email" value={f.doc_email || ''} onChange={e => set('doc_email', e.target.value)} /></label>
              <label className="form-label">Адреса<input className="form-control" value={f.doc_address || ''} onChange={e => set('doc_address', e.target.value)} /></label>
              <label className="form-label">Сайт<input className="form-control" value={f.doc_site || ''} onChange={e => set('doc_site', e.target.value)} /></label>
            </div>
            <div className="form-row form-row-2">
              <div className="form-label">Колір у PDF
                <div className="tset-colors" role="radiogroup" aria-label="Колір у PDF">
                  {COLORS.map(c => (
                    <button key={c} type="button" role="radio" aria-checked={(f.brand_color || '#FF7A1A').toUpperCase() === c} aria-label={c}
                      className={`tset-swatch${(f.brand_color || '#FF7A1A').toUpperCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set('brand_color', c)} />
                  ))}
                  <input type="color" aria-label="Свій колір" value={f.brand_color || '#FF7A1A'} onChange={e => set('brand_color', e.target.value)} />
                </div>
              </div>
              <label className="form-label">Наступний № замовлення<input className="form-control" type="number" min={1} value={f.next_order_no || 1} onChange={e => set('next_order_no', +e.target.value)} /></label>
            </div>
          </fieldset>
        </section>

        <section className="card tset-card">
          <h2 className="kp-h3">Тариф</h2>
          <div className="tset-plan">
            <div><b>{info.plan.name}</b>{!internal && <> · {t.status === 'trial' ? 'пробний до' : 'оплачено до'} <b>{dateUa(until)}</b></>}</div>
            <span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>{t.active ? 'Активний' : t.status === 'blocked' ? 'Заблоковано' : 'Не оплачено'}</span>
          </div>
          {([['Користувачі', info.usage.users, info.limits.users], ['Розрахунки цього місяця', info.usage.projects_month, info.limits.projects_month]] as [string, number, number | null][]).map(([l, used, lim]) => (
            <div key={l} className="tset-usage">
              <div className="flex" style={{ justifyContent: 'space-between' }}><span className="text-sm">{l}</span><span className="text-sm"><b>{used}</b> / {lim ?? '∞'}</span></div>
              {lim ? <div className="tset-bar"><div style={{ width: `${bar(used, lim)}%`, background: bar(used, lim) >= 90 ? 'var(--clr-error)' : 'var(--clr-brand)' }} /></div> : null}
            </div>
          ))}
          {!internal && <div className="text-sm text-muted">Щоб змінити тариф або продовжити підписку, зверніться в підтримку ROOFKIT. Онлайн-оплата з'явиться найближчим часом.</div>}
        </section>

        {isAdmin && (
          <section className="card tset-card tset-team">
            <h2 className="kp-h3">Команда · {info.usage.users}{info.limits.users ? ` / ${info.limits.users}` : ''}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ім'я</th><th>Логін / email</th><th>Роль</th><th>Вхід</th><th></th></tr></thead>
                <tbody>
                  {team.map(u => {
                    const self = u.id === user?.id;
                    const on = String(u.is_active) === '1';
                    return (
                      <tr key={u.id} style={{ opacity: on ? 1 : 0.5 }}>
                        <td>{u.name}{self && <span className="text-xs text-muted"> (ви)</span>}</td>
                        <td className="text-xs">{u.login}{u.email && u.email !== u.login ? <div className="text-muted">{u.email}</div> : null}</td>
                        <td>
                          <select className="form-control form-control-sm" value={u.role} disabled={self || !!busy} aria-label={`Роль ${u.name}`}
                            onChange={e => patchUser(u, { role: e.target.value })}>
                            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td className="text-xs text-muted">{dateUa(u.last_login_at)}</td>
                        <td>{!self && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => patchUser(u, { is_active: on ? 0 : 1 })}>{on ? 'Вимкнути' : 'Увімкнути'}</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <form className="tset-adduser" onSubmit={addUser}>
              <input className="form-control" aria-label="Ім'я" placeholder="Ім'я" value={nu.name} onChange={e => setNu(v => ({ ...v, name: e.target.value }))} />
              <input className="form-control" aria-label="Email" placeholder="Email (логін)" type="email" required value={nu.email} onChange={e => setNu(v => ({ ...v, email: e.target.value }))} />
              <input className="form-control" aria-label="Пароль" placeholder="Пароль (від 8 символів)" required minLength={8} value={nu.password} onChange={e => setNu(v => ({ ...v, password: e.target.value }))} />
              <select className="form-control" aria-label="Роль" value={nu.role} onChange={e => setNu(v => ({ ...v, role: e.target.value }))}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn btn-secondary" type="submit" disabled={!!busy}>+ Додати працівника</button>
            </form>
            <div className="text-xs text-muted">Передайте працівнику email і пароль — він зможе змінити пароль після входу.</div>
          </section>
        )}
      </div>
    </div>
  );
}
