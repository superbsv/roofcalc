// ============================================
// ABT Покрівля — реєстрація компанії (новий кабінет з пробним періодом) і тарифи
// ============================================

import React, { useEffect, useState } from 'react';
import { authApi, PlanDef } from '../api/client';
import { useAuth } from '../components/auth/AuthContext';
import { BrandLogo } from '../components/brand/BrandMark';
import { ThemeToggle } from '../components/theme/theme';
import LangSwitch from '../i18n/LangSwitch';

const limitText = (v: number | null | undefined, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : `без ліміту ${many}`);

export function PlanCards({ plans }: { plans: Record<string, PlanDef> }) {
  const paid = Object.entries(plans).filter(([k]) => k !== 'trial');
  return (
    <div className="reg-plan-row">
      {paid.map(([k, p]) => (
        <div key={k} className={`reg-plan${p.popular ? ' popular' : ''}`}>
          <div className="reg-plan-head"><span>{p.name}</span>{p.popular && <em>ПОПУЛЯРНИЙ</em>}</div>
          <div className="reg-plan-price">{p.price > 0 ? <>{p.price_from && <small>від </small>}{p.price.toLocaleString('uk-UA')} <small>грн / міс</small></> : <small>ціну уточнюйте</small>}</div>
          {p.price_year ? <div className="reg-plan-year">або {p.price_year.toLocaleString('uk-UA')} грн / рік — 2 місяці в подарунок</div> : null}
          <div className="text-sm text-muted">{limitText(p.users, 'користувач', 'користувачів')} · {limitText(p.projects_month, 'розрахунок', 'розрахунків')}{p.projects_month ? ' / міс' : ''}</div>
          <ul>{p.features.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage({ onLogin }: { onLogin: () => void }) {
  const { acceptSession } = useAuth();
  const [plans, setPlans] = useState<Record<string, PlanDef>>({});
  const [f, setF] = useState({ company: '', name: '', email: '', phone: '', password: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { authApi.plans().then(r => setPlans(r.plans)).catch(() => {}); }, []);
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await authApi.register(f);
      await acceptSession(r.token, r.user);
      window.history.replaceState(null, '', '/');
    } catch (er: any) { setError(er.message || 'Помилка реєстрації'); }
    setBusy(false);
  };

  const trial = plans.trial;
  const paid = Object.entries(plans).filter(([k]) => k !== 'trial');

  return (
    <div className="reg">
      <header className="reg-head">
        <a className="reg-brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }}><BrandLogo size={52} text={1.15} /></a>
        <div className="flex gap-3" style={{ alignItems: 'center' }}>
          <LangSwitch />
          <ThemeToggle />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLogin}>Увійти</button>
        </div>
      </header>

      <section className="reg-hero">
        <div className="reg-hero-text">
          <h1>Розрахунок покрівлі для вашої компанії — у браузері</h1>
          <p>Металочерепиця, профнастил, фальц, черепиця, листові матеріали. Схема укладки з лінією стику, доборні, специфікація і PDF з вашим логотипом. Працює як Кровля Профи, без встановлення.</p>
          <ul>
            <li>Свій кабінет: розрахунки, матеріали і команда — лише ваші</li>
            <li>Каталог ROOFKIT вже всередині</li>
            <li>{trial?.days || 14} днів повного доступу безкоштовно, без картки</li>
          </ul>
        </div>

        <form className="reg-form" onSubmit={submit}>
          <h2>Створити кабінет</h2>
          <label className="form-label">Назва компанії *<input className="form-control" required value={f.company} onChange={e => set('company', e.target.value)} placeholder="ТОВ «Ваша покрівля»" autoComplete="organization" /></label>
          <label className="form-label">Ваше ім'я<input className="form-control" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="name" /></label>
          <label className="form-label">Email * <span className="text-xs text-muted">(це ваш логін)</span><input className="form-control" type="email" required value={f.email} onChange={e => set('email', e.target.value)} autoComplete="email" /></label>
          <label className="form-label">Телефон<input className="form-control" type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="+380" autoComplete="tel" /></label>
          <label className="form-label">Пароль *<input className="form-control" type="password" required minLength={8} value={f.password} onChange={e => set('password', e.target.value)} placeholder="від 8 символів" autoComplete="new-password" /></label>
          {/* пастка для ботів — людина цього поля не бачить */}
          <input className="reg-hp" tabIndex={-1} aria-hidden="true" autoComplete="off" value={f.website} onChange={e => set('website', e.target.value)} />
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'Створюємо кабінет…' : `Почати ${trial?.days || 14} днів безкоштовно`}</button>
          <div className="text-xs text-muted">Вже є кабінет? <button type="button" className="btn btn-ghost btn-sm" onClick={onLogin}>Увійти</button></div>
        </form>
      </section>

      {paid.length > 0 && (
        <section className="reg-plans" aria-label="Тарифи">
          <h2>Тарифи</h2>
          <PlanCards plans={plans} />
          <p className="text-sm text-muted">Після пробного періоду кабінет переходить у режим перегляду — розрахунки зберігаються. Для продовження оберіть тариф.</p>
        </section>
      )}
    </div>
  );
}
