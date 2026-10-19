// ============================================
// RoofKit — головна сторінка продукту (для гостей): можливості, кроки, тарифи
// ============================================

import React, { useEffect, useState } from 'react';
import { authApi, PlanDef } from '../api/client';
import { BrandLogo } from '../components/brand/BrandMark';
import { ThemeToggle } from '../components/theme/theme';
import { PlanCards } from './RegisterPage';

const FEATURES: { t: string; d: string; i: React.ReactNode }[] = [
  { t: 'Скати за шаблонами', d: '20 типових форм: трапеція, трикутник, Г-подібні, з вирізами. Розміри — кліком по стороні, кути — кліком по вершині, вершини перетягуються мишею.',
    i: <path d="M4 26 L16 6 L28 26 Z" /> },
  { t: 'Розкладка листів', d: 'Колонки за корисною шириною, одна лінія стику на весь скат з можливістю зсуву, кратність хвилі, нахлест і карнизний звис — як у Кровлі Профі.',
    i: <><rect x="4" y="6" width="7" height="20" /><rect x="12.5" y="6" width="7" height="20" /><rect x="21" y="6" width="7" height="20" /><line x1="2" y1="15" x2="30" y2="15" strokeDasharray="3 2" /></> },
  { t: 'Специфікація', d: 'Листи по довжинах від більшого до меншого, доборні елементи, площі корисна і повна, відсоток відходів.',
    i: <><line x1="6" y1="8" x2="26" y2="8" /><line x1="6" y1="14" x2="26" y2="14" /><line x1="6" y1="20" x2="26" y2="20" /><line x1="6" y1="26" x2="18" y2="26" /></> },
  { t: 'PDF з вашим логотипом', d: 'Схема укладки, розкрій і специфікація з реквізитами вашої компанії та фірмовим кольором. Експорт у Excel.',
    i: <><path d="M8 4 H20 L26 10 V28 H8 Z" /><path d="M20 4 V10 H26" /></> },
  { t: 'Команда і ролі', d: 'Адміністратор, менеджери, переглядачі. Кожен бачить свої розрахунки, керівник — усі розрахунки компанії.',
    i: <><circle cx="11" cy="11" r="4" /><circle cx="22" cy="12" r="3" /><path d="M4 26 C4 19 18 19 18 26" /><path d="M18 22 C19 18 28 18 28 24" /></> },
  { t: 'Матеріали', d: 'Каталог металочерепиці, профнастилу і фальцу вже всередині. Додавайте власні профілі або копіюйте з каталогу.',
    i: <><path d="M4 12 Q8 6 12 12 T20 12 T28 12" /><path d="M4 20 Q8 14 12 20 T20 20 T28 20" /></> },
];

const FAQ: [string, string][] = [
  ['Чим ROOFKIT відрізняється від Кровлі Профі?', 'Порядок роботи той самий: замовлення, матеріал, скати, укладка, специфікація. Але ROOFKIT працює в браузері, українською, з командою і спільною базою розрахунків — без встановлення і ліцензійних ключів.'],
  ['Де зберігаються мої розрахунки?', 'На захищеному сервері, у кабінеті вашої компанії. Інші компанії їх не бачать. Працювати можна з будь-якого комп\'ютера.'],
  ['Чи можна додати власні матеріали?', 'Так. Каталог металочерепиці, профнастилу і фальцу вже всередині, а свої профілі можна створити з нуля або скопіювати з каталогу і змінити параметри.'],
  ['Що буде після пробного періоду?', 'Кабінет переходить у режим перегляду: усі розрахунки зберігаються. Щоб продовжити роботу, оберіть тариф.'],
  ['Скільки людей може працювати в одному кабінеті?', 'Залежить від тарифу. Адміністратор додає менеджерів і переглядачів, кожен бачить свої розрахунки, керівник — усі.'],
];

const STEPS = ['Замовлення', 'Матеріал', 'Скати', 'Укладка', 'Специфікація'];

function HeroScheme() {
  // Ілюстрація: трапецієподібний скат, листи двома рядами з лінією стику
  const cols = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <svg className="land-scheme" viewBox="0 0 520 340" role="img" aria-label="Приклад схеми укладки листів на скаті">
      <defs>
        <pattern id="land-grid" width="13" height="13" patternUnits="userSpaceOnUse">
          <path d="M13 0H0V13" fill="none" stroke="currentColor" strokeOpacity=".08" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="520" height="340" fill="url(#land-grid)" />
      {cols.map(c => {
        const x = 40 + c * 55;
        const cut = c === 0 || c === 7;
        const top = c < 2 ? 150 + (1 - c) * 50 : c > 5 ? 150 + (c - 6) * 50 : 60;
        return (
          <g key={c}>
            <rect x={x} y={top} width="56" height={170 - top} className={cut ? 'land-sheet waste' : 'land-sheet'} />
            <rect x={x} y="170" width="56" height="130" className={cut ? 'land-sheet waste' : 'land-sheet full'} />
          </g>
        );
      })}
      <polygon points="40,300 480,300 370,64 150,64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <line x1="28" y1="170" x2="492" y2="170" stroke="var(--clr-brand)" strokeWidth="3" strokeDasharray="10 6" />
      <rect x="402" y="157" width="88" height="26" rx="4" fill="var(--clr-brand)" />
      <text x="446" y="175" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--clr-on-brand)">2.350 м</text>
    </svg>
  );
}

export default function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const [plans, setPlans] = useState<Record<string, PlanDef>>({});
  useEffect(() => { authApi.plans().then(r => setPlans(r.plans)).catch(() => {}); }, []);
  const trialDays = plans.trial?.days || 14;

  return (
    <div className="land">
      <header className="land-head">
        <a className="land-brand" href="/" aria-label="RoofKit — на головну"><BrandLogo size={40} text={1.1} /></a>
        <nav className="land-nav" aria-label="Розділи">
          <a href="#features">Можливості</a>
          <a href="#steps">Як працює</a>
          <a href="#plans">Тарифи</a>
          <a href="#faq">Питання</a>
        </nav>
        <div className="land-actions">
          <ThemeToggle />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onLogin}>Увійти</button>
          <button type="button" className="btn btn-primary btn-sm land-hide-sm" onClick={onRegister}>Створити розрахунок</button>
        </div>
      </header>

      <section className="land-hero">
        <div className="land-hero-in">
          <div className="land-hero-text">
            <div className="land-kicker">Калькулятор покрівлі онлайн</div>
            <h1>Розрахунок покрівлі — точно, швидко, зрозуміло</h1>
            <p>Від геометрії даху до готової специфікації. Металочерепиця, профнастил, фальц: скати, укладка листів, доборні елементи і PDF для клієнта з вашим логотипом. Звична логіка Кровлі Профі — українською, у браузері.</p>
            <div className="land-cta">
              <button type="button" className="btn btn-primary btn-lg" onClick={onRegister}>Створити розрахунок</button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={onLogin}>У мене вже є кабінет</button>
            </div>
            <div className="land-note">{trialDays} днів безкоштовно, без картки. Після пробного періоду розрахунки зберігаються.</div>
          </div>
          <HeroScheme />
        </div>
      </section>

      <section className="land-facts" aria-label="Коротко">
        <div><b>5 кроків</b><span>як у Кровлі Профі</span></div>
        <div><b>20 шаблонів</b><span>форм скатів</span></div>
        <div><b>1 лінія стику</b><span>на весь скат, зсувається мишею</span></div>
        <div><b>Свій кабінет</b><span>дані компанії бачите лише ви</span></div>
      </section>

      <section id="features" className="land-sec">
        <h2>Усе для розрахунку покрівлі</h2>
        <div className="land-feats">
          {FEATURES.map(f => (
            <div key={f.t} className="land-feat">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--clr-brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{f.i}</svg>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="steps" className="land-sec">
        <h2>Як працює</h2>
        <ol className="land-steps">
          {STEPS.map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}
        </ol>
        <p className="land-steps-note">Реквізити замовлення → вибір матеріалу і його параметрів → скати за шаблонами або вручну → схема укладки з лінією стику → специфікація, PDF і Excel.</p>
      </section>

      {Object.keys(plans).length > 1 && (
        <section id="plans" className="land-sec">
          <h2>Тарифи</h2>
          <PlanCards plans={plans} />
          <p className="land-steps-note">Перші {trialDays} днів — повний доступ безкоштовно. Тариф можна змінити будь-коли.</p>
        </section>
      )}

      <section id="faq" className="land-sec">
        <h2>Питання</h2>
        <div className="land-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}</summary><p>{a}</p></details>
          ))}
        </div>
      </section>

      <section className="land-final">
        <h2>Від геометрії даху до готової специфікації</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={onRegister}>Створити кабінет</button>
      </section>

      <footer className="land-foot">
        <span>© {new Date().getFullYear()} ROOFKIT · розробка ABT — Advanced Building Technologies</span>
        <a href="https://artbudtrading.com.ua" target="_blank" rel="noopener noreferrer">artbudtrading.com.ua</a>
      </footer>
    </div>
  );
}
