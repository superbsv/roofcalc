// ============================================
// ArtBudTrading Roof Calculator
// components/auth/AuthContext.tsx
// ============================================

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, authApi, superApi } from '../../api/client';
import BrandMark from '../brand/BrandMark';
import { ThemeToggle } from '../theme/theme';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  impersonate: (tenantId: number) => Promise<void>;   // супер-адмін: «Увійти як»
  leaveImpersonation: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Профіль, кабінет і права — завжди свіжі з сервера
  const refresh = async () => {
    try {
      const res = await authApi.me();
      localStorage.setItem('rc_user', JSON.stringify(res.user));
      setUser(res.user);
    } catch {}
  };

  useEffect(() => {
    const stored = localStorage.getItem('rc_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch {}
    }
    setLoading(false);
    if (localStorage.getItem('rc_token')) refresh();
  }, []);

  const login = async (loginVal: string, password: string) => {
    const res = await authApi.login(loginVal, password);
    localStorage.setItem('rc_token', res.token);
    localStorage.setItem('rc_user', JSON.stringify(res.user));
    localStorage.removeItem('rc_token_super');
    setUser(res.user);
    await refresh();
  };

  const logout = async () => {
    try { await authApi.logout(); } catch {}
    const sup = localStorage.getItem('rc_token_super');
    if (sup) {   // вихід із чужого кабінету — завершуємо і власну сесію супер-адміна
      localStorage.setItem('rc_token', sup);
      try { await authApi.logout(); } catch {}
    }
    localStorage.removeItem('rc_token');
    localStorage.removeItem('rc_token_super');
    localStorage.removeItem('rc_user');
    setUser(null);
  };

  const impersonate = async (tenantId: number) => {
    const res = await superApi.impersonate(tenantId);
    if (!localStorage.getItem('rc_token_super')) localStorage.setItem('rc_token_super', localStorage.getItem('rc_token') || '');
    localStorage.setItem('rc_token', res.token);
    await refresh();
  };

  const leaveImpersonation = async () => {
    try { await superApi.leave(); } catch {}
    const sup = localStorage.getItem('rc_token_super');
    if (sup) localStorage.setItem('rc_token', sup);
    localStorage.removeItem('rc_token_super');
    await refresh();
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh, impersonate, leaveImpersonation }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

// ============================================
// Login Page
// ============================================
export function LoginPage() {
  const { login } = useAuth();
  const [loginVal, setLoginVal] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginVal || !password) { setError('Введіть логін та пароль'); return; }
    setBusy(true); setError('');
    try {
      await login(loginVal, password);
      window.location.href = '/calculator/';
    } catch (err: any) {
      setError(err.message || 'Помилка входу');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <ThemeToggle className="theme-toggle-floating" />
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-mark"><BrandMark size={56} /></div>
          <div className="login-brand">ABT</div>
          <div className="login-sub">Калькулятор покрівельних матеріалів</div>
        </div>

        <form onSubmit={handle}>
          <div className="form-group">
            <label className="form-label">Логін або Email</label>
            <input
              className="form-control"
              type="text"
              value={loginVal}
              onChange={e => setLoginVal(e.target.value)}
              placeholder="login або email@company.ua"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              className="form-control"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="alert alert-error mb-4" style={{marginBottom:'16px'}}>
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full btn-lg"
            disabled={busy}
          >
            {busy ? 'Вхід…' : 'Увійти'}
          </button>
        </form>

        <div style={{marginTop:'24px',textAlign:'center',fontSize:'.75rem',color:'#8896A5'}}>
          © {new Date().getFullYear()} ArtBudTrading. Всі права захищено.
        </div>
      </div>
    </div>
  );
}
