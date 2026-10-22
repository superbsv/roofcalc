// ============================================
// Специфікація → PDF і Excel рівно в тому вигляді, як її видно на екрані після розрахунку
// (з урахуванням вибраної мови інтерфейсу).
// ============================================
import { t } from '../../i18n/i18n';

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'specification';

/** PDF: сторінки A4, розриви — між рядками таблиць і блоками (рядки не розрізаються) */
export async function specToPdf(paper: HTMLElement, name: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const W = 900;
  const clone = paper.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, { width: W + 'px', maxWidth: W + 'px', boxShadow: 'none', border: '0', borderRadius: '0', margin: '0', position: 'fixed', left: '-10000px', top: '0' });
  document.body.appendChild(clone);
  try {
    const top0 = clone.getBoundingClientRect().top;
    const cuts = new Set<number>();
    clone.querySelectorAll('tr, .kp-paper > *, .kp-lens > *, .kp-paper-line').forEach(el => cuts.add(Math.round(el.getBoundingClientRect().bottom - top0)));
    const scale = 2;
    const canvas = await html2canvas(clone, { scale, backgroundColor: '#FFFFFF', useCORS: true, logging: false });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), margin = 10;
    const pxPerMm = canvas.width / (pw - margin * 2);                   // пікселі полотна на мм
    const pageH = Math.floor((ph - margin * 2) * pxPerMm / scale);    // висота сторінки в CSS-пікселях
    const sorted = Array.from(cuts).filter(y => y > 0).sort((a, b) => a - b);
    const total = canvas.height / scale;
    let y = 0, first = true;
    while (y < total - 1) {
      let end = Math.min(total, y + pageH);
      if (end < total) {
        const lo = y + 40, hi = end;
        let c = 0;
        for (const v of sorted) { if (v > lo && v <= hi) c = v; }
        if (c) end = c;
      }
      const sh = Math.ceil((end - y) * scale);
      const part = document.createElement('canvas');
      part.width = canvas.width; part.height = sh;
      const ctx = part.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, part.width, part.height);
      ctx.drawImage(canvas, 0, Math.round(y * scale), canvas.width, sh, 0, 0, canvas.width, sh);
      if (!first) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pw - margin * 2, sh / pxPerMm);
      first = false; y = end;
    }
    pdf.save(fileSafe(name) + '.pdf');
  } finally { clone.remove(); }
}

/** Excel: усі блоки специфікації по порядку; до таблиці комплектації — колонки «Ціна» і «Сума» з формулами */
export async function specToExcel(paper: HTMLElement, name: string) {
  const XLSX = await import('xlsx');
  const aoa: (string | number | null)[][] = [];
  const merges: any[] = [];
  const num = (s: string): string | number => { const v = s.replace(/\s/g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : s; };
  let priceTable: { first: number; last: number; qtyCol: number } | null = null;
  const tables = Array.from(paper.querySelectorAll('table')) as HTMLTableElement[];
  const lastTable = tables[tables.length - 1];

  const addTable = (tb: HTMLTableElement) => {
    const withPrice = tb === lastTable;
    const rows = Array.from(tb.rows);
    const start = aoa.length;
    rows.forEach((tr, ri) => {
      const isHead = tr.parentElement?.tagName === 'THEAD';
      const cells: (string | number)[] = Array.from(tr.cells).map(c => { const x = (c.innerText || '').trim(); return isHead ? x : num(x); });
      if (withPrice && ri === 0) cells.push(t('Ціна'), t('Сума'));
      aoa.push(cells);
    });
    if (withPrice && rows.length > 1) priceTable = { first: start + 1, last: aoa.length - 1, qtyCol: rows[0].cells.length - 1 };
    aoa.push([]);
  };
  const walk = (el: HTMLElement) => {
    if (el.tagName === 'TABLE') { addTable(el as HTMLTableElement); return; }
    if (el.tagName === 'DL') {
      const dts = Array.from(el.querySelectorAll('dt')), dds = Array.from(el.querySelectorAll('dd'));
      let row: (string | number)[] = [];
      dts.forEach((dt, i) => {
        const k = (dt.textContent || '').replace(/ /g, ' ').trim();
        if (k) row.push(k, num((dds[i]?.textContent || '').trim()));
        if (row.length >= 6) { aoa.push(row); row = []; }
      });
      if (row.length) aoa.push(row);
      aoa.push([]); return;
    }
    if (el.querySelector('table')) { Array.from(el.children).forEach(c => walk(c as HTMLElement)); return; }
    const txt = (el.innerText || '').trim();
    if (!txt) return;
    if (el.classList.contains('kp-paper-head') || el.classList.contains('kp-paper-sub')) {
      Array.from(el.children).forEach(c => { const x = (c as HTMLElement).innerText.trim(); if (x) aoa.push([x]); });
      return;
    }
    aoa.push([txt]);
    if (el.classList.contains('kp-paper-title')) merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: 5 } });
  };
  Array.from(paper.children).forEach(c => walk(c as HTMLElement));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const pt = priceTable as { first: number; last: number; qtyCol: number } | null;
  if (pt) {
    const L = (c: number) => XLSX.utils.encode_col(c);
    const q = L(pt.qtyCol), p = L(pt.qtyCol + 1), sc = L(pt.qtyCol + 2);
    for (let r = pt.first; r <= pt.last; r++) ws[`${sc}${r + 1}`] = { t: 'n', f: `IF(${p}${r + 1}="","",${q}${r + 1}*${p}${r + 1})` };
    const tr = pt.last + 2;
    ws[`${p}${tr}`] = { t: 's', v: t('Всього') };
    ws[`${sc}${tr}`] = { t: 'n', f: `SUM(${sc}${pt.first + 1}:${sc}${pt.last + 1})` };
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    ref.e.r = Math.max(ref.e.r, tr - 1); ref.e.c = Math.max(ref.e.c, pt.qtyCol + 2);
    ws['!ref'] = XLSX.utils.encode_range(ref);
  }
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 46 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t('Специфікація').slice(0, 31));
  XLSX.writeFile(wb, fileSafe(name) + '.xlsx');
}
