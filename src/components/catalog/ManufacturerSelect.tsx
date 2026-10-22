// ============================================
// Виробник — випадаючий список (без дублів). Новий виробник додається пунктом «+ Новий виробник…»;
// якщо така назва вже є (інший регістр / пробіли) — обирається наявна.
// ============================================
import React, { useEffect, useState } from 'react';
import { catApi, CATALOG_EVENT } from './CatalogNav';

let cache: string[] | null = null;
const NEW = '__new__';
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function useManufacturers() {
  const [list, setList] = useState<string[]>(cache || []);
  useEffect(() => {
    const load = () => catApi('GET', '/catalog/manufacturers').then(d => { cache = d.manufacturers; setList(d.manufacturers); }).catch(() => {});
    load();
    window.addEventListener(CATALOG_EVENT, load);
    return () => window.removeEventListener(CATALOG_EVENT, load);
  }, []);
  return list;
}

/** Повертає наявну назву виробника, якщо введена збігається з нею (без урахування регістру і пробілів) */
export const canonicalMf = (name: string, list: string[]) => {
  const n = name.trim().replace(/\s+/g, ' ');
  return list.find(x => norm(x) === norm(n)) || n;
};

export default function ManufacturerSelect({ value, onChange, className = 'form-control', ariaLabel = 'Виробник' }: {
  value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string;
}) {
  const list = useManufacturers();
  const [extra, setExtra] = useState<string[]>([]);
  const all = Array.from(new Set([...list, ...extra, ...(value && !list.some(x => norm(x) === norm(value)) ? [value] : [])]))
    .sort((a, b) => a.localeCompare(b, 'uk'));
  const pick = (v: string) => {
    if (v !== NEW) { onChange(v); return; }
    const n = window.prompt('Назва нового виробника:');
    if (!n || !n.trim()) return;
    const c = canonicalMf(n, all);
    if (!all.includes(c)) setExtra(e => [...e, c]);
    onChange(c);
  };
  return (
    <select className={className} aria-label={ariaLabel} value={value || ''} onChange={e => pick(e.target.value)}>
      <option value="">— без виробника —</option>
      {all.map(m => <option key={m} value={m} data-no-i18n>{m}</option>)}
      <option value={NEW}>+ Новий виробник…</option>
    </select>
  );
}
