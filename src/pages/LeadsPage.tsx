// ============================================
// ROOFKIT — заявки з віджета на сайті компанії і налаштування віджета
// ============================================
import React, { useEffect, useMemo, useState } from 'react';
import { leadsApi, widgetApi, Lead, WidgetSettings } from '../api/client';
import { useAuth } from '../components/auth/AuthContext';

const ST: Record<Lead['status'], [string, string]> = {
  new: ['Нова', 'badge-orange'], work: ['В роботі', 'badge-blue'], done: ['Оброблено', 'badge-green'], spam: ['Спам', 'badge-gray'],
};
const FIELD: Record<string, string> = { L: 'Довжина', W: 'Ширина', S: 'Скат', A: 'Низ', C: 'Верх', H: 'Висота', N: 'Скатів' };
const dt = (s: string) => new Date(s.replace(' ', 'T')).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function LeadsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<'leads' | 'widget'>('leads');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = () => leadsApi.list(filter || undefined).then(r => setLeads(r.leads)).catch(e => setError(e.message));
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (l: Lead, s: Lead['status']) => {
    try { await leadsApi.update(l.id, s); setLeads(xs => xs.map(x => x.id === l.id ? { ...x, status: s } : x)); }
    catch (e: any) { setError(e.message); }
  };

  return (
    <div className="leads">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div><h1 className="page-title">Заявки з сайту</h1>
          <div className="text-sm text-muted">Відвідувачі вашого сайту рахують дах у віджеті ROOFKIT і залишають телефон — заявки з'являються тут</div></div>
        {isAdmin && (
          <div className="leads-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'leads'} className={tab === 'leads' ? 'on' : ''} onClick={() => setTab('leads')}>Заявки</button>
            <button role="tab" aria-selected={tab === 'widget'} className={tab === 'widget' ? 'on' : ''} onClick={() => setTab('widget')}>Віджет на сайт</button>
          </div>
        )}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {tab === 'widget' && isAdmin ? <WidgetSetup /> : (
        <>
          <div className="flex gap-3" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {[['', 'Усі'], ['new', 'Нові'], ['work', 'В роботі'], ['done', 'Оброблені'], ['spam', 'Спам']].map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {leads.length === 0 ? (
            <div className="card empty-state"><div>Заявок поки немає.</div>
              {isAdmin && <button className="btn btn-primary" onClick={() => setTab('widget')}>Підключити віджет на сайт</button>}</div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="table leads-table">
                <thead><tr><th>Дата</th><th>Клієнт</th><th>Дах</th><th>Розрахунок</th><th>Статус</th></tr></thead>
                <tbody>
                  {leads.map(l => {
                    const c = l.payload?.calc, r = l.payload?.roof;
                    return (
                      <React.Fragment key={l.id}>
                        <tr onClick={() => setOpen(open === l.id ? null : l.id)} style={{ cursor: 'pointer' }} className={l.status === 'new' ? 'lead-new' : ''}>
                          <td className="text-sm">{dt(l.created_at)}</td>
                          <td><b>{l.name || 'Без імені'}</b><div><a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}>{l.phone}</a></div></td>
                          <td className="text-sm">{r ? <>{r.type}<div className="text-muted">{Object.entries(r.values || {}).map(([k, v]) => `${FIELD[k] || k} ${v}`).join(' · ')}</div></> : '—'}</td>
                          <td className="text-sm">{c ? <>{c.area_m2} м² · {c.sheets} листів<div className="text-muted">{c.material}</div></> : '—'}</td>
                          <td><span className={`badge ${ST[l.status][1]}`}>{ST[l.status][0]}</span></td>
                        </tr>
                        {open === l.id && (
                          <tr className="lead-detail"><td colSpan={5}>
                            <div className="lead-box">
                              <div>
                                {l.comment && <p><b>Коментар:</b> {l.comment}</p>}
                                {l.source_url && <p className="text-sm text-muted">Сторінка: {l.source_url}</p>}
                                {c?.lengths?.length ? <p className="text-sm">Листи: {c.lengths.map(g => `${(g.length_mm / 1000).toFixed(3)} × ${g.count}`).join(', ')}</p> : null}
                              </div>
                              <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                                {(Object.keys(ST) as Lead['status'][]).filter(s => s !== l.status).map(s => (
                                  <button key={s} className="btn btn-secondary btn-sm" onClick={() => setStatus(l, s)}>{ST[s][0]}</button>
                                ))}
                              </div>
                            </div>
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WidgetSetup() {
  const [w, setW] = useState<WidgetSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { widgetApi.get().then(setW).catch(e => setErr(e.message)); }, []);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://roofkit.com.ua';
  const code = w ? `<script src="${origin}/widget.js" data-roofkit="${w.key}" async></script>` : '';
  const save = async (patch: Partial<WidgetSettings> & { regenerate?: boolean }, note = 'Збережено') => {
    setBusy(true); setErr('');
    try { setW(await widgetApi.save(patch)); setMsg(note); setTimeout(() => setMsg(''), 2500); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const groups = useMemo(() => {
    const g: Record<string, WidgetSettings['available']> = {};
    (w?.available || []).forEach(m => { const k = m.manufacturer || 'Без виробника'; (g[k] = g[k] || []).push(m); });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b, 'uk'));
  }, [w]);
  if (!w) return err ? <div className="alert alert-error">{err}</div> : <div className="text-muted">Завантаження…</div>;
  const sel = new Set(w.materials);
  const toggle = (id: number) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setW({ ...w, materials: Array.from(n) }); };

  return (
    <div className="widget-setup">
      <div className="card">
        <div className="flex gap-3" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div><h3 style={{ margin: 0 }}>Віджет {w.enabled ? 'увімкнено' : 'вимкнено'}</h3>
            <div className="text-sm text-muted">Калькулятор з вашою назвою, логотипом і фірмовим кольором для вставки на ваш сайт</div></div>
          <button className={`btn ${w.enabled ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={() => save({ enabled: !w.enabled }, w.enabled ? 'Віджет вимкнено' : 'Віджет увімкнено')}>
            {w.enabled ? 'Вимкнути' : 'Увімкнути віджет'}</button>
        </div>
        {msg && <div className="alert alert-success" style={{ marginTop: 10 }}>{msg}</div>}
        {err && <div className="alert alert-error" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. Код для сайту</h3>
        <p className="text-sm text-muted">Вставте цей рядок на сторінку свого сайту в місце, де має бути калькулятор (у конструкторах сайтів — блок «HTML-код»).</p>
        <pre className="widget-code">{code}</pre>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => { navigator.clipboard?.writeText(code); setMsg('Код скопійовано'); setTimeout(() => setMsg(''), 2000); }}>Скопіювати код</button>
          <a className="btn btn-secondary btn-sm" href={`/widget.html?k=${w.key}`} target="_blank" rel="noopener noreferrer">Відкрити віджет окремо</a>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => window.confirm('Створити новий ключ? Старий код на сайті перестане працювати.') && save({ regenerate: true }, 'Новий ключ створено — оновіть код на сайті')}>Новий ключ</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>2. Матеріали у віджеті</h3>
        <p className="text-sm text-muted">Оберіть, що можуть рахувати відвідувачі (металочерепиця, профнастил, фальц). Якщо нічого не обрано — показуються всі активні матеріали вашого каталогу.</p>
        <div className="widget-mats">
          {groups.map(([mf, list]) => (
            <fieldset key={mf}><legend>{mf}</legend>
              {list.map(m => <label key={m.id}><input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} /> {m.name}</label>)}
            </fieldset>
          ))}
        </div>
        <div className="flex gap-3" style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
          <label className="form-label">Карнизний звис у розрахунку, мм
            <input className="form-control" type="number" min={0} max={500} value={w.eave_overhang} onChange={e => setW({ ...w, eave_overhang: +e.target.value })} style={{ width: 120 }} /></label>
          <button className="btn btn-primary" disabled={busy} onClick={() => save({ materials: w.materials, eave_overhang: w.eave_overhang })}>Зберегти</button>
        </div>
      </div>

      {w.enabled && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. Попередній перегляд</h3>
          <iframe title="Попередній перегляд віджета" src={`/widget.html?k=${w.key}`} style={{ width: '100%', height: 760, border: 0 }} />
        </div>
      )}
    </div>
  );
}
