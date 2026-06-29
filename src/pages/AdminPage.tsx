// ============================================
// ArtBudTrading Roof Calculator
// pages/AdminPage.tsx — Адмін-панель
// ============================================

import React, { useEffect, useState } from 'react';
import { MaterialProfile } from '../api/client';

const BASE = process.env.REACT_APP_API_URL || '/calculator/api';
const tok  = () => localStorage.getItem('rc_token');
const api  = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Помилка');
  return d;
};

type AdminTab = 'users' | 'materials' | 'settings' | 'logs';

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Адмін-панель</h1>
          <div className="page-subtitle">Управління системою ArtBudTrading</div>
        </div>
      </div>
      <div className="tabs">
        {([['users','👥 Користувачі'],['materials','🏗 Матеріали'],['settings','⚙ Налаштування'],['logs','📋 Журнал']] as [AdminTab,string][]).map(([t,l]) => (
          <button key={t} className={`tab-btn${tab===t?' active':''}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {tab === 'users'     && <UsersTab />}
      {tab === 'materials' && <MaterialsTab />}
      {tab === 'settings'  && <SettingsTab />}
      {tab === 'logs'      && <LogsTab />}
    </div>
  );
}

// ============================================
// Users Tab
// ============================================
function UsersTab() {
  const [users, setUsers]   = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]  = useState<any>(null);
  const [form, setForm]     = useState({ name:'', email:'', login:'', password:'', role:'manager', company:'', phone:'', is_active:1 });
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);

  const load = () => api('GET', '/admin/users').then(r => setUsers(r.users));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setEditing(null); setForm({name:'',email:'',login:'',password:'',role:'manager',company:'',phone:'',is_active:1}); setShowForm(true); };
  const openEdit   = (u: any) => { setEditing(u); setForm({...u, password:''}); setShowForm(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (editing) await api('PUT', `/admin/users/${editing.id}`, form);
      else         await api('POST', '/admin/users', form);
      await load(); setShowForm(false);
    } catch(err: any) { setError(err.message); }
    setBusy(false);
  };

  const roleColors: Record<string,[string,string]> = {
    admin:['#1B5E2E','#E8F5EC'], manager:['#1565C0','#E3F2FD'],
    dealer:['#E65100','#FFF3E0'], production:['#6A1B9A','#F3E5F5'], viewer:['#546E7A','#ECEFF1'],
  };
  const roleLabels: Record<string,string> = { admin:'Адміністратор',manager:'Менеджер',dealer:'Дилер',production:'Виробництво',viewer:'Перегляд' };

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{marginBottom:'16px'}}>
        <span style={{color:'var(--clr-text-3)',fontSize:'.875rem'}}>{users.length} користувачів</span>
        <button className="btn btn-primary" onClick={openCreate}>+ Додати користувача</button>
      </div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <table>
          <thead><tr><th>Ім'я</th><th>Логін / Email</th><th>Роль</th><th>Компанія</th><th>Статус</th><th>Останній вхід</th><th></th></tr></thead>
          <tbody>
            {users.map(u => {
              const [color, bg] = roleColors[u.role] || ['#000','#fff'];
              return (
                <tr key={u.id}>
                  <td><b>{u.name}</b></td>
                  <td><div>{u.login}</div><div className="text-xs text-muted">{u.email}</div></td>
                  <td><span className="badge" style={{color,background:bg}}>{roleLabels[u.role]||u.role}</span></td>
                  <td>{u.company||'—'}</td>
                  <td><span className={`badge ${u.is_active?'badge-green':'badge-gray'}`}>{u.is_active?'Активний':'Вимкнений'}</span></td>
                  <td className="text-xs text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('uk-UA') : '—'}</td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>✏ Редагувати</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div className="card" style={{width:'480px',maxHeight:'90vh',overflow:'auto'}}>
            <div className="card-header">
              <span className="card-title">{editing ? 'Редагувати' : 'Новий'} користувач</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={save}>
              <div className="form-row form-row-2">
                <div className="form-group"><label className="form-label">Ім'я *</label><input className="form-control" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Роль</label>
                  <select className="form-control" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                    {Object.entries(roleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Email *</label><input className="form-control" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Логін *</label><input className="form-control" value={form.login} onChange={e=>setForm(f=>({...f,login:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">{editing?'Новий пароль':'Пароль *'}</label><input className="form-control" type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder={editing?'Залиште порожнім щоб не змінювати':''} /></div>
                <div className="form-group"><label className="form-label">Компанія</label><input className="form-control" value={form.company||''} onChange={e=>setForm(f=>({...f,company:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Телефон</label><input className="form-control" value={form.phone||''} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></div>
                <div className="form-group"><label className="form-label">Статус</label>
                  <select className="form-control" value={form.is_active} onChange={e=>setForm(f=>({...f,is_active:+e.target.value}))}>
                    <option value={1}>Активний</option><option value={0}>Вимкнений</option>
                  </select>
                </div>
              </div>
              {error && <div className="alert alert-error" style={{marginBottom:'12px'}}>⚠ {error}</div>}
              <div className="flex gap-3">
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy?'Збереження…':'Зберегти'}</button>
                <button type="button" className="btn btn-secondary" onClick={()=>setShowForm(false)}>Скасувати</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Materials Tab
// ============================================
function MaterialsTab() {
  const [profiles, setProfiles] = useState<MaterialProfile[]>([]);
  const [filter, setFilter]     = useState<string>('all');

  useEffect(() => { api('GET', '/admin/materials').then(r => setProfiles(r.profiles)); }, []);

  const typeLabel: Record<string,string> = { tile:'Металочерепиця', profile:'Профнастил', falts:'Клік-фальц' };
  const filtered = filter === 'all' ? profiles : profiles.filter(p => p.type === filter);

  return (
    <div>
      <div className="flex gap-3 items-center mb-4" style={{marginBottom:'16px'}}>
        <select className="form-control" style={{width:'200px'}} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">Всі типи</option>
          <option value="tile">Металочерепиця</option>
          <option value="profile">Профнастил</option>
          <option value="falts">Клік-фальц</option>
        </select>
        <span className="text-muted text-sm">{filtered.length} профілів</span>
      </div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <table>
          <thead>
            <tr><th>Назва</th><th>Тип</th><th>Ширина повна/корисна</th><th>Нахлест по дov</th><th>Крок хвилі</th><th>Ціна/м²</th><th>Статус</th></tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id}>
                <td><b>{p.name}</b>{p.manufacturer && <span className="text-xs text-muted" style={{marginLeft:'4px'}}>({p.manufacturer})</span>}</td>
                <td><span className={`badge ${p.type==='tile'?'badge-green':p.type==='profile'?'badge-blue':'badge-orange'}`}>{typeLabel[p.type]}</span></td>
                <td className="font-mono">{p.full_width} / {p.useful_width} мм</td>
                <td className="font-mono">{p.length_overlap} мм</td>
                <td className="font-mono">{p.wave_step ? `${p.wave_step} мм` : '—'}</td>
                <td><b>{p.price_per_m2} грн</b></td>
                <td><span className={`badge ${p.is_active?'badge-green':'badge-gray'}`}>{p.is_active?'Активний':'Вимкнений'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================
// Settings Tab
// ============================================
function SettingsTab() {
  const [settings, setSettings] = useState<Record<string,string>>({});
  const [busy, setBusy]         = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    api('GET', '/admin/settings').then(r => {
      const map: Record<string,string> = {};
      r.settings.forEach((s: any) => { map[s.key_name] = s.value; });
      setSettings(map);
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try { await api('PUT', '/admin/settings', settings); setSaved(true); setTimeout(()=>setSaved(false),3000); }
    catch {}
    setBusy(false);
  };

  const fields = [
    { key:'company_name',    label:'Назва компанії' },
    { key:'company_phone',   label:'Телефон (PDF)' },
    { key:'company_email',   label:'Email (PDF)' },
    { key:'company_address', label:'Адреса (PDF)' },
    { key:'default_vat',     label:'НДС, %', type:'number' },
    { key:'session_hours',   label:'Тривалість сесії, год', type:'number' },
    { key:'share_link_days', label:'Термін посилання клієнту, днів', type:'number' },
    { key:'min_joint_dist_mm', label:'Мін. відстань між стиками фальцу, мм', type:'number' },
  ];

  return (
    <div className="card" style={{maxWidth:'600px'}}>
      <div className="card-header"><span className="card-title">Налаштування системи</span></div>
      <div className="form-row form-row-2">
        {fields.map(f => (
          <div key={f.key} className="form-group">
            <label className="form-label">{f.label}</label>
            <input
              className="form-control"
              type={f.type || 'text'}
              value={settings[f.key] || ''}
              onChange={e => setSettings(s => ({...s, [f.key]: e.target.value}))}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-4">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Збереження…' : 'Зберегти налаштування'}
        </button>
        {saved && <span style={{color:'var(--clr-success)',alignSelf:'center',fontSize:'.875rem'}}>✓ Збережено</span>}
      </div>
    </div>
  );
}

// ============================================
// Logs Tab
// ============================================
function LogsTab() {
  const [logs, setLogs]   = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api('GET', '/admin/logs?limit=50').then(r => { setLogs(r.logs); setTotal(r.total); });
  }, []);

  const actionLabel = (a: string) => {
    const map: Record<string,string> = {
      'auth.login':'Вхід', 'auth.fail':'Невдалий вхід', 'auth.logout':'Вихід',
      'project.create':'Створення проекту', 'project.update':'Зміна проекту',
      'project.delete':'Видалення проекту', 'project.calculate':'Розрахунок',
      'project.export_pdf':'Експорт PDF', 'project.export_excel':'Експорт Excel',
      'admin.user.create':'Створення юзера', 'admin.user.update':'Зміна юзера',
      'admin.material.create':'Новий матеріал', 'admin.settings.update':'Зміна налаштувань',
    };
    return map[a] || a;
  };

  return (
    <div>
      <div className="text-muted text-sm mb-4" style={{marginBottom:'12px'}}>Всього записів: {total}</div>
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <table>
          <thead><tr><th>Дата/час</th><th>Користувач</th><th>Дія</th><th>IP</th></tr></thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={i}>
                <td className="font-mono text-xs">{new Date(l.created_at).toLocaleString('uk-UA')}</td>
                <td>
                  <div>{l.user_name || '—'}</div>
                  <div className="text-xs text-muted">{l.user_email}</div>
                </td>
                <td>
                  <span className={`badge ${
                    l.action.includes('delete')?'badge-red':
                    l.action.includes('fail')?'badge-orange':
                    l.action.includes('export')?'badge-blue':'badge-gray'
                  }`}>{actionLabel(l.action)}</span>
                </td>
                <td className="font-mono text-xs">{l.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}