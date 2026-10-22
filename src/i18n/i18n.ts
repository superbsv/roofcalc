// ============================================
// ROOFKIT — мультимовність: українська (основна), російська, англійська.
// Інтерфейс пишеться українською; переклад робиться словником src/i18n/dict.json
// (ключ — український текст). Перекладач проходить по сторінці і замінює тексти та підказки,
// стежить за змінами (MutationObserver), тому працює для всіх сторінок, повідомлень сервера і діалогів.
// Нові тексти: додайте рядок у dict.json — "Український текст": ["Русский", "English"].
// ============================================
import DICT from './dict.json';

export type Lang = 'uk' | 'ru' | 'en';
export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'uk', label: 'UA', name: 'Українська' },
  { code: 'ru', label: 'RU', name: 'Русский' },
  { code: 'en', label: 'EN', name: 'English' },
];
const KEY = 'rk_lang';
const CYR = /[А-Яа-яЇїІіЄєҐґ]/;

const exact = new Map<string, [string, string]>(Object.entries((DICT as any).exact) as any);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tpls = ((DICT as any).tpl as [string, string, string][]).map(([k, ru, en]) => {
  const order: number[] = [];
  const re = new RegExp('^' + k.split(/(\{\d+\})/).map(p => {
    const m = /^\{(\d+)\}$/.exec(p);
    if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; }
    return esc(p);
  }).join('') + '$');
  return { re, order, ru, en };
});
// Довгі фрагменти (для повідомлень, складених з кількох частин) — замінюються всередині тексту
const frags = Array.from(exact.entries()).filter(([k]) => k.length >= 14).sort((a, b) => b[0].length - a[0].length);

let lang: Lang = (() => { try { const v = localStorage.getItem(KEY) as Lang; return LANGS.some(l => l.code === v) ? v : 'uk'; } catch { return 'uk'; } })();
export const getLang = () => lang;

const cache = new Map<string, string>();
function translateCore(s: string): string {
  const idx = lang === 'ru' ? 0 : 1;
  const e = exact.get(s);
  if (e) return e[idx];
  for (const t of tpls) {
    const m = t.re.exec(s);
    if (m) {
      const vals: Record<number, string> = {};
      t.order.forEach((n, i) => { const v = m[i + 1], e2 = exact.get(v.trim()); vals[n] = e2 ? v.replace(v.trim(), e2[idx]) : v; });
      return (idx === 0 ? t.ru : t.en).replace(/\{(\d+)\}/g, (_, n) => vals[Number(n)] ?? '');
    }
  }
  let out = s;
  for (const [k, v] of frags) if (out.includes(k)) out = out.split(k).join(v[idx]);
  return out;
}

/** Переклад рядка на поточну мову (для коду: confirm, title тощо). Український текст повертається як є. */
export function t(s: string): string {
  if (lang === 'uk' || !s || !CYR.test(s)) return s;
  const ck = lang + '\u0001' + s;
  const c = cache.get(ck);
  if (c !== undefined) return c;
  const lead = /^\s*/.exec(s)![0], trail = /\s*$/.exec(s)![0];
  const core = s.slice(lead.length, s.length - trail.length).replace(/\s+/g, ' ');
  const r = lead + translateCore(core) + trail;
  cache.set(ck, r);
  return r;
}

// ---------- Переклад сторінки ----------
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT']);
const textOrig = new WeakMap<Text, { orig: string; out: string }>();
const attrOrig = new WeakMap<Element, Record<string, { orig: string; out: string }>>();
let observer: MutationObserver | null = null;
let busy = false;

const skipped = (el: Element | null): boolean => {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-no-i18n') || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
};

function doText(n: Text) {
  const cur = n.data;
  const rec = textOrig.get(n);
  let orig = cur;
  if (rec && cur === rec.out) orig = rec.orig;          // уже перекладено — беремо оригінал
  if (!CYR.test(orig)) { if (rec) textOrig.delete(n); return; }
  if (skipped(n.parentElement)) return;
  const out = t(orig);
  textOrig.set(n, { orig, out });
  if (cur !== out) n.data = out;
}

function doAttrs(el: Element) {
  let rec = attrOrig.get(el);
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur == null) continue;
    const r = rec?.[a];
    const orig = r && cur === r.out ? r.orig : cur;
    if (!CYR.test(orig)) continue;
    const out = t(orig);
    if (!rec) { rec = {}; attrOrig.set(el, rec); }
    rec[a] = { orig, out };
    if (cur !== out) el.setAttribute(a, out);
  }
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit') && CYR.test(el.value)) {
    const r = rec?.value, cur = el.value, orig = r && cur === r.out ? r.orig : cur, out = t(orig);
    if (!rec) { rec = {}; attrOrig.set(el, rec); }
    rec.value = { orig, out };
    if (cur !== out) el.value = out;
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    if (SKIP.has(el.tagName)) return;
    doAttrs(el);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = tw.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text); else doAttrs(n as Element);
    n = tw.nextNode();
  }
}

/** Перекласти окремий вузол (напр. вікно друку, відкрите через window.open) */
export function translateTree(root: Node) { if (lang !== 'uk') walk(root); }

function translatePage() {
  busy = true;
  try {
    walk(document.body);
    const tt = document.title;
    if (CYR.test(tt) || (document as any).__rkTitle) {
      const orig = (document as any).__rkTitle && tt === (document as any).__rkTitleOut ? (document as any).__rkTitle : tt;
      (document as any).__rkTitle = orig; (document as any).__rkTitleOut = t(orig);
      if (tt !== (document as any).__rkTitleOut) document.title = (document as any).__rkTitleOut;
    }
  } finally { busy = false; }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(muts => {
    if (busy) return;
    busy = true;
    try {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target as Text);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    } finally { busy = false; }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value'] });
}

// Діалоги браузера (confirm / alert / prompt) теж перекладаються
const nativeConfirm = window.confirm.bind(window), nativeAlert = window.alert.bind(window), nativePrompt = window.prompt.bind(window);
window.confirm = (m?: any) => nativeConfirm(typeof m === 'string' ? tr(m) : m);
window.alert = (m?: any) => nativeAlert(typeof m === 'string' ? tr(m) : m);
window.prompt = (m?: any, d?: any) => nativePrompt(typeof m === 'string' ? tr(m) : m, d);
// багаторядкові повідомлення — по рядках
function tr(m: string) { return m.split('\n').map(x => t(x)).join('\n'); }

const listeners = new Set<(l: Lang) => void>();
export function onLangChange(f: (l: Lang) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l === 'uk' ? 'uk' : l;
  cache.clear();
  translatePage();                       // для 'uk' повертає оригінальні тексти
  listeners.forEach(f => f(l));
}

export function initI18n() {
  document.documentElement.lang = lang;
  const go = () => { translatePage(); startObserver(); };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
}
