// ============================================
// Скати → зображення PNG / JPG: схема розкладки (як у «Укладці»), заголовок і розміри сторін.
// Кожен скат окремо або всі разом одним зображенням (один під одним).
// Схема малюється «начисто» (без виділення) у прихованому контейнері, кольори — світлої теми.
// ============================================
import React from 'react';
import { createRoot } from 'react-dom/client';
import LayoutScheme from './LayoutScheme';
import { sideLengthMm } from '../roof/edges';
import { sideLetter } from '../roof/templates';
import { t } from '../../i18n/i18n';
import { Point } from '../../api/client';

export interface SlopeForImage {
  name: string;
  polygon_points?: Point[] | null;
  holes?: Point[][] | null;
  calc_result?: any;
}

const W = 1600;                 // ширина зображення, px
const PAD = 36;
const m3 = (mm: number) => ((Number(mm) || 0) / 1000).toFixed(3);
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'roof';

// Кольори світлої теми з таблиць стилів (:root і :root[data-theme=light]) — зображення завжди світле
function lightPalette(): Record<string, string> {
  const vars: Record<string, string> = {};
  const take = (rule: CSSStyleRule) => {
    for (let i = 0; i < rule.style.length; i++) {
      const k = rule.style[i];
      if (k.startsWith('--')) vars[k] = rule.style.getPropertyValue(k).trim();
    }
  };
  const order: CSSStyleRule[][] = [[], []];
  for (const sh of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sh.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSStyleRule)) continue;
      const sel = r.selectorText.replace(/\s+/g, '');
      if (sel === ':root') order[0].push(r);
      else if (/^:root\[data-theme=["']?light["']?\]$/.test(sel)) order[1].push(r);
    }
  }
  order.flat().forEach(take);
  return vars;
}

function resolveVars(s: string, pal: Record<string, string>): string {
  for (let i = 0; i < 4 && s.includes('var(--'); i++) {
    s = s.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, k, fb) => pal[k] ?? fb ?? '#888');
  }
  return s;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

// Схема одного ската → зображення SVG (через приховане монтування LayoutScheme)
async function schemeImage(sl: SlopeForImage, pal: Record<string, string>): Promise<HTMLImageElement | null> {
  const res = sl.calc_result;
  if (!res?.placements?.length) return null;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-12000px', top: '0', width: '1100px', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(React.createElement(LayoutScheme, {
      calcResult: res, polygonPoints: sl.polygon_points || [], holes: sl.holes || [], slopeName: sl.name,
      jointY: res.joint_y_mm ?? null, waveStep: res.wave_step_mm ?? 0,
    } as any));
    await new Promise(r => setTimeout(r, 120));   // рендер + переклад інтерфейсу (MutationObserver)
    // схема — найбільший SVG (інші — дрібні іконки кнопок)
    const svg = Array.from(host.querySelectorAll('svg')).sort((a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length)[0] as SVGSVGElement | undefined;
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = (clone.getAttribute('viewBox') || '0 0 900 600').split(/\s+/).map(Number);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(vb[2])); clone.setAttribute('height', String(vb[3]));
    clone.setAttribute('font-family', 'Inter, Arial, Helvetica, sans-serif');
    clone.removeAttribute('style');
    const xml = resolveVars(new XMLSerializer().serializeToString(clone), pal);
    return await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml));
  } finally {
    root.unmount(); host.remove();
  }
}

interface Block { sl: SlopeForImage; img: HTMLImageElement | null; h: number; sides: string[] }

/** Зображення скатів: один скат — окремий файл; кілька — одне зображення, скати один під одним */
export async function saveSlopesImage(slopes: SlopeForImage[], fmt: 'png' | 'jpg', fileName: string, subtitle = '') {
  const pal = lightPalette();
  const blocks: Block[] = [];
  for (const sl of slopes) {
    const img = await schemeImage(sl, pal);
    const pts = sl.polygon_points || [];
    const sides = pts.map((a, i) => `${sideLetter(i)} = ${m3(sideLengthMm(a, pts[(i + 1) % pts.length]))}`);
    (sl.holes || []).forEach((h, i) => {
      const xs = h.map(p => p[0]), ys = h.map(p => p[1]);
      sides.push(`${t(`Виріз №${i + 1}`)}: ${m3(Math.max(...xs) - Math.min(...xs))} × ${m3(Math.max(...ys) - Math.min(...ys))}`);
    });
    const imgH = img ? Math.round((W - 2 * PAD) * img.height / img.width) : 60;
    blocks.push({ sl, img, h: 70 + imgH + 24 + Math.ceil(sides.length / 6) * 26 + 20, sides });
  }
  if (!blocks.length) throw new Error(t('Немає розрахованих скатів'));
  const head = subtitle ? 50 : 0;
  const totalH = head + blocks.reduce((a, b) => a + b.h, 0) + PAD;
  // обмеження розміру полотна (мобільні браузери ~16 Мпікс)
  const scale = Math.min(1, Math.sqrt(15e6 / (W * totalH)));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale); cv.height = Math.round(totalH * scale);
  const ctx = cv.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, totalH);
  const font = (w: number, px: number) => `${w} ${px}px Inter, Arial, Helvetica, sans-serif`;
  let y = PAD;
  if (subtitle) {
    ctx.fillStyle = '#0F172A'; ctx.font = font(800, 26); ctx.fillText(subtitle, PAD, y + 20);
    y += head;
  }
  for (const b of blocks) {
    const r = b.sl.calc_result || {};
    ctx.fillStyle = '#0F172A'; ctx.font = font(800, 26);
    ctx.fillText(b.sl.name, PAD, y + 26);
    ctx.fillStyle = '#475569'; ctx.font = font(500, 17);
    const info = [r.profile_name, `${r.total_sheets ?? r.placements?.length ?? 0} ${t('листів')}`, r.slope_area_m2 != null ? `${Number(r.slope_area_m2).toFixed(2)} м²` : '']
      .filter(Boolean).join(' · ');
    ctx.fillText(info, PAD, y + 54);
    y += 70;
    const iw = W - 2 * PAD;
    if (b.img) {
      const ih = Math.round(iw * b.img.height / b.img.width);
      ctx.drawImage(b.img, PAD, y, iw, ih);
      ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1; ctx.strokeRect(PAD + .5, y + .5, iw - 1, ih - 1);
      y += ih + 24;
    } else {
      ctx.fillStyle = '#B91C1C'; ctx.font = font(600, 17); ctx.fillText(t('Скат ще не розраховано.'), PAD, y + 30); y += 84;
    }
    ctx.fillStyle = '#0F172A'; ctx.font = font(600, 18);
    for (let i = 0; i < b.sides.length; i += 6) {
      ctx.fillText(b.sides.slice(i, i + 6).join('     '), PAD, y + 4);
      y += 26;
    }
    y += 20;
    if (b !== blocks[blocks.length - 1]) { ctx.strokeStyle = '#CBD5E1'; ctx.beginPath(); ctx.moveTo(PAD, y - 10); ctx.lineTo(W - PAD, y - 10); ctx.stroke(); }
  }
  const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
  const blob: Blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('canvas')), mime, 0.92));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileSafe(fileName) + (fmt === 'png' ? '.png' : '.jpg');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
