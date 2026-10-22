// ============================================
// RoofKit — головна сторінка продукту (для гостей): можливості, кроки, тарифи
// ============================================

import React, { useEffect, useState } from 'react';
import { authApi, PlanDef } from '../api/client';
import { BrandLogo, BrandLogoFull } from '../components/brand/BrandMark';
import { ThemeToggle } from '../components/theme/theme';
import LangSwitch from '../i18n/LangSwitch';
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
  { t: 'Матеріали', d: 'Каталог ROOFKIT — актуальні профілі від заводів. Ведіть власний каталог: додавайте позиції вручну, копіюйте з каталогу ROOFKIT, імпортуйте з Excel.',
    i: <><path d="M4 12 Q8 6 12 12 T20 12 T28 12" /><path d="M4 20 Q8 14 12 20 T20 20 T28 20" /></> },
];

const FAQ: [string, string][] = [
  ['Чим ROOFKIT відрізняється від Кровлі Профі?', 'Порядок роботи той самий: замовлення, матеріал, скати, укладка, специфікація. Але ROOFKIT працює в браузері, українською, з командою і спільною базою розрахунків — без встановлення і ліцензійних ключів.'],
  ['Де зберігаються мої розрахунки?', 'На захищеному сервері, у кабінеті вашої компанії. Інші компанії їх не бачать. Працювати можна з будь-якого комп\'ютера.'],
  ['Чи можна додати власні матеріали?', 'Так. Каталог металочерепиці, профнастилу і фальцу вже всередині, а свої профілі можна створити з нуля або скопіювати з каталогу і змінити параметри.'],
  ['Я виробник покрівлі. Як потрапити в каталог?', 'Напишіть нам — ми позначимо ваш кабінет як «виробник». Ви самі додаєте свої профілі, довжини й кольори та публікуєте їх у каталозі виробників: їх одразу бачать і використовують усі компанії ROOFKIT.'],
  ['Що буде після пробного періоду?', 'Кабінет переходить у режим перегляду: усі розрахунки зберігаються. Щоб продовжити роботу, оберіть тариф.'],
  ['Скільки людей може працювати в одному кабінеті?', 'Залежить від тарифу. Адміністратор додає менеджерів і переглядачів, кожен бачить свої розрахунки, керівник — усі.'],
];

const STEPS = ['Замовлення', 'Матеріал', 'Скати', 'Укладка', 'Специфікація'];

// Ілюстрація — справжній розрахунок: трапеція 8.8 × 4.0 м (верх 3.0), металочерепиця 1180/1100,
// хвиля 350, ПЗ 150, К 50, укладка справа наліво. Дані — з движка SheetLayoutEngine.
const HERO_POLY: [number, number][] = [[0, 0], [8800, 0], [5900, 4000], [2900, 4000]];
const HERO_SHEETS: [number, number, number][] = [
  [7700, -50, 1570], [6600, -50, 3090], [5500, -50, 4050], [4400, -50, 4050],
  [3300, -50, 4050], [2200, -50, 4050], [1100, -50, 3090], [0, -50, 1570],
];
const HERO_SIDES: { k: string; v: string; i: number }[] = [
  { k: 'a', v: '4.941', i: 3 }, { k: 'b', v: '3.000', i: 2 }, { k: 'c', v: '4.941', i: 1 }, { k: 'd', v: '8.800', i: 0 },
];

function HeroScheme() {
  const K = 0.052, OX = 30, OY = 296;
  const X = (x: number) => OX + x * K, Y = (y: number) => OY - y * K;
  const lap = 80; // повна ширина − корисна: нахлест у бік укладки (вліво)
  const full = (x: number) => x >= 3300 && x <= 4400; // листи без підрізки
  const poly = HERO_POLY.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const cx = HERO_POLY.reduce((s, p) => s + p[0], 0) / 4, cy = HERO_POLY.reduce((s, p) => s + p[1], 0) / 4;
  return (
    <svg className="land-scheme" viewBox="0 0 520 340" role="img" aria-label="Приклад розрахунку: трапецієподібний скат, 8 листів металочерепиці з довжинами">
      <defs>
        <pattern id="land-grid" width="5.2" height="5.2" patternUnits="userSpaceOnUse" x={OX} y={OY}>
          <path d="M5.2 0H0V5.2" fill="none" stroke="currentColor" strokeOpacity=".05" strokeWidth=".6" />
        </pattern>
        <pattern id="land-grid-m" width="52" height="52" patternUnits="userSpaceOnUse" x={OX} y={OY}>
          <path d="M52 0H0V52" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth=".8" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="520" height="340" fill="url(#land-grid)" />
      <rect x="0" y="0" width="520" height="340" fill="url(#land-grid-m)" />
      {HERO_SHEETS.map(([x, y, len], n) => (
        <g key={n}>
          <rect x={X(x - lap)} y={Y(y + len)} width={(1100 + lap) * K} height={len * K} className={full(x) ? 'land-sheet full' : 'land-sheet'} />
          <text x={X(x + 550)} y={Y(y + len / 2) + 4} textAnchor="middle" className="land-len">{(len / 1000).toFixed(3)}</text>
          <text x={X(x + 550)} y={Y(y + len / 2) + 17} textAnchor="middle" className="land-no">№{n + 1}</text>
        </g>
      ))}
      <polygon points={poly} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {HERO_SIDES.map(sd => {
        const p = HERO_POLY[sd.i], q = HERO_POLY[(sd.i + 1) % 4];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1;
        const lx = X(mx) + (dx / d) * 22, ly = Y(my) - (dy / d) * 22;
        return (
          <text key={sd.k} x={lx} y={ly + 4} textAnchor="middle" className="land-side">
            <tspan className="land-side-k">{sd.k}</tspan> = {sd.v}
          </text>
        );
      })}
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
        <a className="land-brand" href="/" aria-label="RoofKit — на головну"><BrandLogo size={52} text={1.15} /></a>
        <nav className="land-nav" aria-label="Розділи">
          <a href="#features">Можливості</a>
          <a href="#steps">Як працює</a>
          <a href="#plans">Тарифи</a>
          <a href="#faq">Питання</a>
        </nav>
        <div className="land-actions">
          <LangSwitch />
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
        <BrandLogoFull width={260} />
        <h2>Від геометрії даху до готової специфікації</h2>
        <button type="button" className="btn btn-primary btn-lg" onClick={onRegister}>Створити кабінет</button>
      </section>

      <footer className="land-foot">
        <span>© {new Date().getFullYear()} ROOFKIT</span>
      </footer>
    </div>
  );
}
