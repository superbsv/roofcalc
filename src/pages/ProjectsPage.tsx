// ============================================
// ArtBudTrading Roof Calculator
// pages/ProjectsPage.tsx — Список проектів
// ============================================

import React, { useEffect, useState } from 'react';
import { Project, projectsApi } from '../api/client';

interface Props { onOpenProject: (id: number) => void; }

const STATUS_LABELS: Record<string, [string, string]> = {
  draft:      ['Чернетка',     'badge-gray'],
  calculated: ['Розраховано',  'badge-blue'],
  sent:       ['Відправлено',  'badge-green'],
  archived:   ['Архів',        'badge-orange'],
};

const ROOF_TYPES = [
  { value: 'gable',    label: 'Двосхилий' },
  { value: 'hip',      label: 'Вальмовий' },
  { value: 'mansard',  label: 'Мансардний' },
  { value: 'shed',     label: 'Односхилий' },
  { value: 'complex',  label: 'Складний' },
];

export default function ProjectsPage({ onOpenProject }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [total,    setTotal]    = useState(0);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error,    setError]    = useState('');

  const [form, setForm] = useState({
    name: '', client_name: '', client_phone: '',
    object_address: '', roof_type: 'gable', notes: '',
  });

  const load = async (q?: string) => {
    setLoading(true);
    try {
      const res = await projectsApi.list(q ? { search: q } : {});
      setProjects(res.data);
      setTotal(res.total);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    clearTimeout((window as any)._srch);
    (window as any)._srch = setTimeout(() => load(e.target.value), 400);
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Введіть назву проекту'); return; }
    setCreating(true); setError('');
    try {
      const res = await projectsApi.create(form);
      setProjects(prev => [res.project, ...prev]);
      setShowForm(false);
      setForm({ name:'', client_name:'', client_phone:'', object_address:'', roof_type:'gable', notes:'' });
      onOpenProject(res.project.id);
    } catch (e: any) { setError(e.message); }
    setCreating(false);
  };

  const deleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Видалити проект?')) return;
    try {
      await projectsApi.delete(id);
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch (e: any) { setError(e.message); }
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString('uk-UA');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Мої проекти</h1>
          <div className="page-subtitle">Всього: {total} проектів</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setShowForm(true)}>
          + Створити розрахунок
        </button>
      </div>

      {error && <div className="alert alert-error mb-4" style={{marginBottom:'16px'}}>⚠ {error}</div>}

      {/* Search */}
      <div className="card" style={{marginBottom:'16px',padding:'12px 16px'}}>
        <input
          className="form-control"
          placeholder="Пошук за назвою проекту або клієнтом…"
          value={search}
          onChange={handleSearch}
        />
      </div>

      {/* Projects table */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Назва проекту</th>
                <th>Клієнт</th>
                <th>Об'єкт</th>
                <th>Тип даху</th>
                <th>Сума, грн</th>
                <th>Статус</th>
                <th>Оновлено</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{textAlign:'center',padding:'32px',color:'var(--clr-text-3)'}}>
                  Завантаження…
                </td></tr>
              ) : !projects.length ? (
                <tr><td colSpan={8} style={{textAlign:'center',padding:'32px',color:'var(--clr-text-3)'}}>
                  Проектів поки немає. Натисніть «Створити розрахунок»
                </td></tr>
              ) : projects.map(p => {
                const [statusLabel, statusClass] = STATUS_LABELS[p.status] || ['', 'badge-gray'];
                return (
                  <tr key={p.id} style={{cursor:'pointer'}} onClick={() => onOpenProject(p.id)}>
                    <td>
                      <div style={{fontWeight:600}}>{p.name}</div>
                      {p.manager_name && <div className="text-xs text-muted">{p.manager_name}</div>}
                    </td>
                    <td>
                      <div>{p.client_name || '—'}</div>
                      {p.client_phone && <div className="text-xs text-muted">{p.client_phone}</div>}
                    </td>
                    <td style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {p.object_address || '—'}
                    </td>
                    <td>{ROOF_TYPES.find(t => t.value === p.roof_type)?.label || p.roof_type || '—'}</td>
                    <td>
                      {p.total_price
                        ? <b>{p.total_price.toLocaleString('uk-UA', {maximumFractionDigits:0})} грн</b>
                        : '—'
                      }
                    </td>
                    <td><span className={`badge ${statusClass}`}>{statusLabel}</span></td>
                    <td className="text-muted text-xs">{fmt(p.updated_at)}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        style={{color:'var(--clr-error)'}}
                        onClick={e => deleteProject(p.id, e)}
                        title="Видалити"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {showForm && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.5)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
        }} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="card" style={{width:'100%',maxWidth:'520px',maxHeight:'90vh',overflow:'auto'}}>
            <div className="card-header">
              <span className="card-title">Новий проект</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowForm(false)}>✕</button>
            </div>

            <form onSubmit={createProject}>
              <div className="form-group">
                <label className="form-label">Назва проекту *</label>
                <input className="form-control" value={form.name}
                  onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  placeholder="Приватний будинок по вул. Зелена 5" autoFocus />
              </div>

              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label">Ім'я клієнта</label>
                  <input className="form-control" value={form.client_name}
                    onChange={e => setForm(f => ({...f, client_name: e.target.value}))}
                    placeholder="Іваненко Іван Іванович" />
                </div>
                <div className="form-group">
                  <label className="form-label">Телефон клієнта</label>
                  <input className="form-control" value={form.client_phone}
                    onChange={e => setForm(f => ({...f, client_phone: e.target.value}))}
                    placeholder="+38 050 000 00 00" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Адреса об'єкта</label>
                <input className="form-control" value={form.object_address}
                  onChange={e => setForm(f => ({...f, object_address: e.target.value}))}
                  placeholder="м. Київ, вул. Зелена 5" />
              </div>

              <div className="form-group">
                <label className="form-label">Тип даху</label>
                <select className="form-control" value={form.roof_type}
                  onChange={e => setForm(f => ({...f, roof_type: e.target.value}))}>
                  {ROOF_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Примітки</label>
                <textarea className="form-control" rows={2} value={form.notes}
                  onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Додаткова інформація…" />
              </div>

              {error && <div className="alert alert-error mb-4" style={{marginBottom:'12px'}}>⚠ {error}</div>}

              <div className="flex gap-3">
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Створення…' : 'Створити проект'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                  Скасувати
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
