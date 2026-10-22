// ============================================
// Візуалізатор будинку (three.js, як на сайті-каталозі ABT): дах, фасад, підшива, водостік, паркан.
// Відкривається в кабінеті поруч із калькуляторами — показати клієнту продукт і колір (лише інформативно).
// Сам рушій — public/house3d/house3d.js (window.ABTHouse3D.mount), вантажиться лише при першому відкритті.
// ============================================
import React, { useEffect, useRef, useState } from 'react';

type Part = 'roof' | 'facade' | 'soffit' | 'gutter' | 'fence';
interface Color { code: string; name: string; hex: string; wood?: boolean }
interface Mode { label: string; colors: string[]; def: string }

const RAL: Record<string, [string, string]> = {
  '9003': ['RAL 9003 білий', '#F1F0EA'], '9010': ['RAL 9010 чисто-білий', '#F1ECE1'], '1015': ['RAL 1015 слонова кістка', '#E6D2B5'],
  '1014': ['RAL 1014 бежевий', '#DDC49A'], '7047': ['RAL 7047 світло-сірий', '#D0D0D0'], '7035': ['RAL 7035 сірий', '#C5C7C4'],
  '9006': ['RAL 9006 срібний', '#A5A8A6'], '7004': ['RAL 7004 сигнальний сірий', '#9B9B9B'], '7024': ['RAL 7024 графіт', '#474A51'],
  '7016': ['RAL 7016 антрацит', '#293133'], 'RR23': ['RR23 темно-сірий', '#3E4447'], '9005': ['RAL 9005 чорний', '#141414'],
  'RR33': ['RR33 чорний', '#1D1D1D'], '8017': ['RAL 8017 шоколадний', '#45322E'], '8019': ['RAL 8019 сіро-коричневий', '#403A3A'],
  'RR32': ['RR32 темно-коричневий', '#3B2E28'], '8004': ['RAL 8004 мідно-коричневий', '#8F4E35'], '3005': ['RAL 3005 винно-червоний', '#5E2129'],
  '3009': ['RAL 3009 оксидно-червоний', '#642424'], '3011': ['RAL 3011 коричнево-червоний', '#792423'], '6005': ['RAL 6005 зелений мох', '#2F4538'],
  '6020': ['RAL 6020 хромовий зелений', '#37422F'], '9001': ['RAL 9001 кремово-білий', '#E9E0D2'], '1013': ['RAL 1013 перлинно-білий', '#EAE6CA'],
  '7044': ['RAL 7044 шовковисто-сірий', '#B7B3A8'], '1019': ['RAL 1019 сіро-бежевий', '#A48F7A'], '5005': ['RAL 5005 синій', '#1F4B7F'], '1018': ['RAL 1018 жовтий', '#F3C82E'],
  'zinc': ['Оцинкований (без покриття)', '#B9BEC2'],
  'b-white': ['Цегла біла', '#E8E4DC'], 'b-beige': ['Цегла бежева', '#D2C6A2'], 'b-straw': ["Цегла солом'яна", '#D9B77E'],
  'b-ginger': ['Цегла руда', '#C2864E'], 'b-terra': ['Цегла теракотова', '#A65A38'], 'b-red': ['Цегла червона', '#8E3B26'],
  'b-brown': ['Цегла коричнева', '#5E3A2C'], 'b-graph': ['Цегла графітова', '#4A4A4C'],
  'w-nut': ['Софіт під дерево горіх', '#7A4B2C'], 'w-oak': ['Софіт під дерево золотий дуб', '#A8743F'],
};
const color = (code: string): Color => ({ code, name: RAL[code][0], hex: RAL[code][1], wood: code.startsWith('w-') });
const ROOF_RAL = ['7016', 'RR23', '7024', 'RR33', '9005', '8017', '8019', 'RR32', '8004', '3005', '3009', '3011', '6005', '6020', '5005', '9006'];

const PARTS: { key: Part; label: string; mode: string; modes: Record<string, Mode> }[] = [
  { key: 'roof', label: 'Дах', mode: 'falz', modes: {
    falz: { label: 'Клік-фальц', colors: ROOF_RAL, def: '7016' },
    tile: { label: 'Металочерепиця', colors: ROOF_RAL.filter(c => c !== '9006'), def: '7016' },
    prof: { label: 'Профнастил', colors: [...ROOF_RAL, '9003', 'zinc'], def: '7016' },
  } },
  { key: 'facade', label: 'Фасад', mode: 'plain', modes: {
    plain: { label: 'Однотонний', colors: ['9003', '9010', '9001', '1013', '1015', '1014', '7047', '7035', '7044', '7004', '1019', '7024', '7016', '9005', '8017', '1018'], def: '9003' },
    brick: { label: 'Під цеглу', colors: ['b-white', 'b-beige', 'b-straw', 'b-ginger', 'b-terra', 'b-red', 'b-brown', 'b-graph'], def: 'b-ginger' },
  } },
  { key: 'soffit', label: 'Підшива', mode: 'base', modes: {
    base: { label: '', colors: ['9003', '1015', '9001', '7047', '9006', '7024', '7016', '9005', '8017', '8019', 'w-nut', 'w-oak'], def: '9003' },
  } },
  { key: 'gutter', label: 'Водостік', mode: 'base', modes: {
    base: { label: '', colors: ['9003', '9006', '7024', '7016', 'RR33', '9005', '8017', '8019', 'RR32', '8004', '3005', '3009', '6005'], def: '7016' },
  } },
  { key: 'fence', label: 'Паркан', mode: 'base', modes: {
    base: { label: '', colors: ['7016', '7024', '9005', '8017', '8019', '3005', '6005', '5005', '9006', '9003', '1015'], def: '7024' },
  } },
];

const SCRIPT = '/house3d/house3d.js';
let loading: Promise<void> | null = null;
const loadEngine = () => {
  if ((window as any).ABTHouse3D) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true;
    s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('house3d')); };
    document.body.appendChild(s);
  });
  return loading;
};

export default function House3D() {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<any>(null);
  const [tab, setTab] = useState<Part>('roof');
  const [mode, setMode] = useState<Record<Part, string>>(() => Object.fromEntries(PARTS.map(p => [p.key, p.mode])) as Record<Part, string>);
  const [sel, setSel] = useState<Record<Part, string>>(() => Object.fromEntries(PARTS.map(p => [p.key, p.modes[p.mode].def])) as Record<Part, string>);

  useEffect(() => {
    let alive = true;
    const el = box.current;
    if (!el) return;
    // 3D вантажимо, коли блок з'являється на екрані (рушій ~660 КБ)
    const start = () => loadEngine().then(() => {
      if (!alive || !el || (el as any).__houseApi) return;
      const init: Record<string, any> = { roofType: mode.roof, facadeMode: mode.facade };
      PARTS.forEach(p => { const c = color(sel[p.key]); init[p.key] = c.hex; if (c.wood) init[p.key + 'Wood'] = true; });
      try { (window as any).ABTHouse3D.mount(el, init); api.current = (el as any).__houseApi; } catch { /* без WebGL лишається картинка */ }
    }).catch(() => {});
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(e => { if (e[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '200px' });
      io.observe(el);
      return () => { alive = false; io.disconnect(); };
    }
    start();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const part = PARTS.find(p => p.key === tab)!;
  const m = part.modes[mode[tab]];
  const cur = color(sel[tab]);

  const pick = (p: Part, code: string) => {
    setSel(s => ({ ...s, [p]: code }));
    const c = color(code);
    api.current?.setColor(p, c.hex, !!c.wood);
  };
  const switchMode = (p: Part, mk: string) => {
    const pd = PARTS.find(x => x.key === p)!, md = pd.modes[mk];
    const keep = md.colors.includes(sel[p]) ? sel[p] : md.def;    // той самий колір, якщо він є в новому продукті
    setMode(s => ({ ...s, [p]: mk }));
    setSel(s => ({ ...s, [p]: keep }));
    const c = color(keep);
    api.current?.setMode(p, mk, c.hex);
    api.current?.setColor(p, c.hex, !!c.wood);
  };

  return (
    <div className="land-house">
      <div className="house3d" ref={box}>
        <img className="house3d__poster" src="/house3d/house-poster.webp" width={1200} height={900} alt="Будинок з покрівлею, водостоком і підшивою — приміряйте кольори" />
        <span className="house3d__hint" aria-hidden="true"><span className="house3d__hint-mouse">Потягніть — повернути · Ctrl + коліщатко — наблизити</span><span className="house3d__hint-touch">Двома пальцями — наблизити й повернути</span></span>
      </div>
      <div className="swatch">
        <div className="swatch__tabs" role="tablist" aria-label="Що змінюємо">
          {PARTS.map(p => (
            <button key={p.key} type="button" role="tab" className="swatch__tab" aria-selected={tab === p.key} onClick={() => setTab(p.key)}>
              <i style={{ background: color(sel[p.key]).hex }} />{p.label}
            </button>
          ))}
        </div>
        {Object.keys(part.modes).length > 1 && (
          <div className="swatch__modes" role="radiogroup" aria-label={`${part.label}: продукт`}>
            {Object.entries(part.modes).map(([mk, md]) => (
              <button key={mk} type="button" role="radio" className="swatch__mode" aria-checked={mode[tab] === mk} onClick={() => switchMode(tab, mk)}>{md.label}</button>
            ))}
          </div>
        )}
        <div className="swatch__list" role="radiogroup" aria-label={`${part.label}: колір`}>
          {m.colors.map(code => {
            const c = color(code);
            return (
              <button key={code} type="button" role="radio" aria-checked={sel[tab] === code} title={c.name}
                className={`swatch__chip${c.wood ? ' swatch__chip--wood' : ''}${code.startsWith('b-') ? ' swatch__chip--brick' : ''}`}
                style={{ ['--c' as any]: c.hex }} onClick={() => pick(tab, code)}><span className="sr-only">{c.name}</span></button>
            );
          })}
        </div>
        <div className="swatch__link">
          <span><b>{part.label}{m.label ? <> · {m.label}</> : null}:</b> {cur.name}</span>
        </div>
      </div>
    </div>
  );
}
