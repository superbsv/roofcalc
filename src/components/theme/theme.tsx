// theme.tsx — світла / темна тема ABT
// Тема зберігається у localStorage ('abt_theme') і ставиться атрибутом data-theme на <html>.
import React, { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'abt_theme';
const EVENT = 'abt-theme-change';

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

// Викликається один раз до рендера, щоб не було «спалаху» не тієї теми
export function initTheme(): void {
  let t: Theme = 'dark';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') t = saved;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) t = 'light';
  } catch {}
  document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: t }));
}

export function useTheme(): Theme {
  const [theme, set] = useState<Theme>(getTheme());
  useEffect(() => {
    const on = () => set(getTheme());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return theme;
}

export function ThemeToggle({ className = 'theme-toggle' }: { className?: string }) {
  const theme = useTheme();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={className}
      onClick={() => setTheme(next)}
      aria-label={next === 'light' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
      title={next === 'light' ? 'Світла тема' : 'Темна тема'}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}
