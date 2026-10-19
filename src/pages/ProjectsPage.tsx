// ============================================
// ArtBudTrading Roof Calculator
// pages/ProjectsPage.tsx — Список проектів
// ============================================

import React, { useEffect, useState } from 'react';
import { Project, projectsApi } from '../api/client';
import { calcTypeInfo } from '../components/roof/calcTypes';

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
  const [error,    setError]    = useState('');

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

  // «Файл → Новий» у КП: одразу відкривається вікно реквізитів замовлення і вибору типу розрахунку
  const createProject = async () => {
    setCreating(true); setError('');
    try {
      const res = await projectsApi.create({ name: 'Новий розрахунок' });
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
        <button className="btn btn-primary btn-lg" onClick={createProject} disabled={creating}>
          {creating ? 'Створення…' : '+ Новий розрахунок'}
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
                <th>Тип розрахунку</th>
                <th>Статус</th>
                <th>Оновлено</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'32px',color:'var(--clr-text-3)'}}>
                  Завантаження…
                </td></tr>
              ) : !projects.length ? (
                <tr><td colSpan={7} style={{textAlign:'center',padding:'32px',color:'var(--clr-text-3)'}}>
                  Проектів поки немає. Натисніть «Новий розрахунок»
                </td></tr>
              ) : projects.map(p => {
                const [statusLabel, statusClass] = STATUS_LABELS[p.status] || ['', 'badge-gray'];
                return (
                  <tr key={p.id} style={{cursor:'pointer'}} onClick={() => onOpenProject(p.id)}>
                    <td>
                      <div style={{fontWeight:600}}>{p.name}</div>
                      {p.settings?.order_no && <div className="text-xs text-muted">№{p.settings.order_no}{p.settings.order_date ? ` від ${p.settings.order_date.split('-').reverse().join('.')}` : ''}</div>}
                      {p.manager_name && <div className="text-xs text-muted">{p.manager_name}</div>}
                    </td>
                    <td>
                      <div>{p.client_name || '—'}</div>
                      {p.client_phone && <div className="text-xs text-muted">{p.client_phone}</div>}
                    </td>
                    <td style={{maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {p.object_address || '—'}
                    </td>
                    <td>{calcTypeInfo(p.settings?.calc_type)?.label || ROOF_TYPES.find(t => t.value === p.roof_type)?.label || '—'}</td>
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

    </div>
  );
}
