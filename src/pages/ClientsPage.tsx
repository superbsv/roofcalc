// ============================================
// ROOFKIT — Клієнти: список, картка клієнта (контакти, статус, нотатки) і всі його розрахунки
// ============================================
import React, { useCallback, useEffect, useState } from 'react';
import { clientsApi, projectsApi, Client, ClientProject, ClientStatus } from '../api/client';
import { calcTypeInfo } from '../components/roof/calcTypes';
import { useAuth } from '../components/auth/AuthContext';

const STATUS: Record<ClientStatus, [string, string]> = {
  new: ['Новий', 'badge-blue'], work: ['В роботі', 'badge-orange'], regular: ['Постійний', 'badge-green'], archive: ['Архів', 'badge-gray'],
};
const PSTATUS: Record<string, string> = { draft: 'Чернетка', calculated: 'Розраховано', sent: 'Відправлено', archived: 'Архів' };
const SOURCES = ['Дзвінок', 'Сайт / віджет', 'Магазин', 'Рекомендація', 'Соцмережі', 'Інше'];
const dateUa = (s?: string | null) => (s ? new Date(s.replace(' ', 'T')).toLocaleDateString('uk-UA') : '—');
const num = (v: any, d = 2) => (v == null || v === '' ? '—' : Number(v).toLocaleString('uk-UA', { maximumFractionDigits: d }));
const EMPTY: Partial<Client> = { name: '', phone: '', email: '', address: '', source: '', status: 'new', notes: '' };

export default function ClientsPage({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState<Client[]>([]);
  const [counts, setCounts] = useState<Partial<Record<ClientStatus, number>>>({});
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientStatus | ''>('');
  const [sel, setSel] = useState<{ client: Client; projects: ClientProject[] } | null>(null);
  const [form, setForm] = useState<Partial<Client> | null>(null);   // редагування / новий
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    try {
      const p: Record<string, string> = {};
      if (search.trim()) p.search = search.trim();
      if (status) p.status = status;
      const d = await clientsApi.list(p);
      setList(d.clients); setCounts(d.counts || {});
    } catch (e: any) { setErr(e.message); }
  }, [search, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(''); setOk('');
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const open = (id: number) => run('open', async () => { setSel(await clientsApi.get(id)); setForm(null); });
  const startNew = () => { setSel(null); setForm({ ...EMPTY }); setErr(''); setOk(''); };
  const save = () => form && run('save', async () => {
    const d = sel && form.id ? await clientsApi.update(sel.client.id, form) : await clientsApi.create(form);
    setSel(d); setForm(null); setOk('Збережено'); await load();
  });
  const setSt = (st: ClientStatus) => sel && run('st', async () => { setSel(await clientsApi.update(sel.client.id, { status: st })); await load(); });
  const remove = () => sel && run('del', async () => {
    const n = sel.projects.length;
    if (!window.confirm(`Видалити клієнта «${sel.client.name}»?${n ? `\nЙого розрахунки (${n}) залишаться в «Мої проекти» без клієнта.` : ''}`)) return;
    await clientsApi.remove(sel.client.id); setSel(null); await load();
  });
  const newCalc = () => sel && run('calc', async () => {
    const c = sel.client;
    const r = await projectsApi.create({ name: `Розрахунок — ${c.name}`, client_id: c.id, client_name: c.name, client_phone: c.phone || '', object_address: c.address || '' } as any);
    onOpenProject(r.project.id);
  });
  const f = (k: keyof Client, v: string) => setForm(x => ({ ...(x || {}), [k]: v }));
  const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);

  return (
    <div className="cl-wrap">
      <div className="page-header">
        <div><h1 className="page-title">Клієнти</h1>
          <p className="text-muted">{isAdmin ? 'Усі клієнти кабінету' : 'Ваші клієнти'} · {total}</p></div>
        <button className="btn btn-primary" onClick={startNew}>+ Новий клієнт</button>
      </div>

      <div className="cl-grid">
        <div className="card cl-list">
          <input className="form-control" placeholder="Пошук: ім'я, телефон, email, адреса" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="cl-chips">
            <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>Усі</button>
            {(Object.keys(STATUS) as ClientStatus[]).map(k => (
              <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{STATUS[k][0]} <em>{counts[k] || 0}</em></button>
            ))}
          </div>
          <div className="cl-items">
            {list.length === 0 && <div className="cl-empty">Клієнтів не знайдено. Клієнти з'являються автоматично, коли ви вказуєте замовника в розрахунку, або додайте вручну.</div>}
            {list.map(c => (
              <button key={c.id} className={`cl-item${sel?.client.id === c.id ? ' on' : ''}`} onClick={() => open(c.id)}>
                <div className="cl-item-top"><b>{c.name}</b><span className={`badge ${STATUS[c.status]?.[1] || 'badge-gray'}`}>{STATUS[c.status]?.[0] || c.status}</span></div>
                <div className="cl-item-sub">{c.phone || 'без телефону'}{c.address ? ` · ${c.address}` : ''}</div>
                <div className="cl-item-sub">Розрахунків: {c.projects_count || 0}{c.last_project_at ? ` · останній ${dateUa(c.last_project_at)}` : ''}{isAdmin && c.manager_name ? ` · ${c.manager_name}` : ''}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card cl-card">
          {err && <div className="alert alert-error">{err}</div>}
          {ok && <div className="alert alert-success">{ok}</div>}

          {form ? (
            <form className="cl-form" onSubmit={e => { e.preventDefault(); save(); }}>
              <h2 className="cl-h">{form.id ? 'Редагування клієнта' : 'Новий клієнт'}</h2>
              <label className="form-label">Ім'я / назва компанії *<input className="form-control" required value={form.name || ''} onChange={e => f('name', e.target.value)} autoFocus /></label>
              <div className="form-row form-row-2">
                <label className="form-label">Телефон<input className="form-control" type="tel" value={form.phone || ''} onChange={e => f('phone', e.target.value)} placeholder="+380…" /></label>
                <label className="form-label">Email<input className="form-control" type="email" value={form.email || ''} onChange={e => f('email', e.target.value)} /></label>
              </div>
              <label className="form-label">Адреса об'єкта<input className="form-control" value={form.address || ''} onChange={e => f('address', e.target.value)} /></label>
              <div className="form-row form-row-2">
                <label className="form-label">Звідки клієнт
                  <select className="form-control" value={form.source || ''} onChange={e => f('source', e.target.value)}>
                    <option value="">—</option>{SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select></label>
                <label className="form-label">Статус
                  <select className="form-control" value={form.status || 'new'} onChange={e => f('status', e.target.value)}>
                    {(Object.keys(STATUS) as ClientStatus[]).map(k => <option key={k} value={k}>{STATUS[k][0]}</option>)}
                  </select></label>
              </div>
              <label className="form-label">Нотатки<textarea className="form-control" rows={4} value={form.notes || ''} onChange={e => f('notes', e.target.value)} placeholder="Домовленості, побажання, дата замірів…" /></label>
              <div className="cl-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Скасувати</button>
                <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'save' ? 'Збереження…' : 'Зберегти'}</button>
              </div>
            </form>
          ) : sel ? (
            <>
              <div className="cl-head">
                <div>
                  <h2 className="cl-h">{sel.client.name}</h2>
                  <div className="text-muted text-xs">Клієнт з {dateUa(sel.client.created_at)}{sel.client.manager_name ? ` · менеджер: ${sel.client.manager_name}` : ''}{sel.client.source ? ` · ${sel.client.source}` : ''}</div>
                </div>
                <div className="cl-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...sel.client })}>✎ Редагувати</button>
                  <button className="btn btn-ghost btn-sm cl-del" onClick={remove} disabled={!!busy}>Видалити</button>
                </div>
              </div>
              <div className="cl-status">
                {(Object.keys(STATUS) as ClientStatus[]).map(k => (
                  <button key={k} className={sel.client.status === k ? 'on' : ''} onClick={() => setSt(k)} disabled={!!busy}>{STATUS[k][0]}</button>
                ))}
              </div>
              <dl className="cl-dl">
                <dt>Телефон</dt><dd>{sel.client.phone ? <a href={`tel:${sel.client.phone.replace(/[^\d+]/g, '')}`}>{sel.client.phone}</a> : '—'}</dd>
                <dt>Email</dt><dd>{sel.client.email ? <a href={`mailto:${sel.client.email}`}>{sel.client.email}</a> : '—'}</dd>
                <dt>Адреса</dt><dd>{sel.client.address || '—'}</dd>
                {sel.client.notes && <><dt>Нотатки</dt><dd className="cl-notes">{sel.client.notes}</dd></>}
              </dl>

              <div className="cl-proj-head">
                <h3 className="kp-h3">Розрахунки · {sel.projects.length}</h3>
                <button className="btn btn-primary btn-sm" onClick={newCalc} disabled={!!busy}>+ Новий розрахунок</button>
              </div>
              {sel.projects.length === 0 ? <div className="cl-empty">Розрахунків ще немає.</div> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>№</th><th>Назва</th><th>Тип</th><th>Площа, м²</th><th>Статус</th><th>Оновлено</th></tr></thead>
                    <tbody>{sel.projects.map(p => (
                      <tr key={p.id} className="cl-row" onClick={() => onOpenProject(p.id)}>
                        <td>{p.order_no || p.id}</td>
                        <td><b>{p.name}</b>{p.object_address ? <div className="text-xs text-muted">{p.object_address}</div> : null}{isAdmin && p.manager_name ? <div className="text-xs text-muted">{p.manager_name}</div> : null}</td>
                        <td className="text-xs">{calcTypeInfo(p.calc_type || '')?.label || '—'}</td>
                        <td>{num(p.total_area)}</td>
                        <td className="text-xs">{PSTATUS[p.status] || p.status}</td>
                        <td className="text-xs text-muted">{dateUa(p.updated_at)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="cl-placeholder">Оберіть клієнта зі списку або додайте нового</div>
          )}
        </div>
      </div>
    </div>
  );
}
