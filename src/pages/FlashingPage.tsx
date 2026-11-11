// ============================================
// «Креслення добірних елементів»: малюємо профілі планок (сторони, кути, закатки, фарбована сторона),
// рахуємо розгортку і заготовки з листа, зберігаємо креслення, друкуємо / PDF бланк на гнуття.
// ============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catApi } from '../components/catalog/CatalogNav';
import FlashingSvg from '../components/flashing/FlashingSvg';
import { FDoc, FElem, FLASH_TEMPLATES, Nest, SketchEl, blankCalc, emptyDoc, fromSketch, girth, nestPlan, newElem, newId } from '../components/flashing/flashing';
import FlashingDraw from '../components/flashing/FlashingDraw';
import NumIn from '../components/flashing/NumIn';
import { specToPdf } from '../components/spec/specExport';

interface ListRow { id: number; name: string; client_name?: string | null; updated_at: string; user_name?: string | null; items_count: number }
interface Cur { id?: number; name: string; client_name: string; data: FDoc }

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const f2 = (v: number) => v.toFixed(2);
const dateUa = (s?: string) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T')); return isNaN(+d) ? s : d.toLocaleDateString('uk-UA'); };

function ElemEditor({ e, sheetW, sheetL, onChange, onDel, onDup, onMove, idx, total }:
  { e: FElem; sheetW: number; sheetL: number; onChange: (p: Partial<FElem>) => void; onDel: () => void; onDup: () => void; onMove: (d: number) => void; idx: number; total: number }) {
  const [hi, setHi] = useState(-1);
  const c = blankCalc(e, sheetW, sheetL);
  // Дзеркально: усі загини в інший бік, напрям першої сторони відбивається
  const mirror = () => onChange({ segs: e.segs.map(s => ({ ...s, dir: (-s.dir) as 1 | -1 })), start: (540 - e.start) % 360, paint: (-e.paint) as 1 | -1 });
  // Креслити з іншого кінця: зворотний порядок сторін
  const reverse = () => {
    const n = e.segs.length;
    const segs = e.segs.map((s, i) => ({ len: e.segs[n - 1 - i].len, ang: i < n - 1 ? e.segs[n - 2 - i].ang : 90, dir: (i < n - 1 ? -e.segs[n - 2 - i].dir : 1) as 1 | -1 }));
    // напрям нової першої сторони — протилежний останній старій
    let h = e.start;
    e.segs.forEach((s, i) => { if (i < n - 1) h += s.dir * (180 - s.ang); });
    onChange({ segs, start: ((h + 180) % 360 + 360) % 360, paint: (-e.paint) as 1 | -1 });
  };

  return (
    <div className="card fl-elem">
      <div className="fl-elem-head">
        <span className="fl-elem-no">{idx + 1}</span>
        <input className="form-control fl-elem-name" value={e.name} onChange={ev => onChange({ name: ev.target.value })} placeholder="Назва елемента" data-no-i18n />
        <div className="fl-elem-tools">
          <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => onMove(-1)} title="Вище">↑</button>
          <button className="btn btn-ghost btn-sm" disabled={idx === total - 1} onClick={() => onMove(1)} title="Нижче">↓</button>
          <button className="btn btn-ghost btn-sm" onClick={mirror} title="Дзеркально: загини в інший бік">⇋</button>
          <button className="btn btn-ghost btn-sm" onClick={reverse} title="Креслити з іншого кінця (зворотний порядок сторін)">⇄</button>
          <button className="btn btn-ghost btn-sm" onClick={onDup} title="Копія елемента">⧉</button>
          <button className="btn btn-ghost btn-sm fl-del" onClick={onDel} title="Видалити елемент">✕</button>
        </div>
      </div>
      <div className="fl-elem-body">
        <div className="fl-draw">
          <FlashingDraw e={e} onChange={onChange} hi={hi} setHi={setHi} />
          <div className="fl-legend"><span>→ RAL — фарбований бік</span> · <span>⟲ — завальцювання</span></div>
        </div>
      </div>
      <div className="fl-metrics">
        <label className="fl-inl"><span>Довжина, мм</span><NumIn value={e.length} step={50} onChange={v => onChange({ length: Math.max(0, v) })} /></label>
        <label className="fl-inl"><span>Кількість, шт</span><NumIn value={e.qty} step={1} onChange={v => onChange({ qty: Math.max(0, Math.round(v)) })} /></label>
        <span>Ширина заготовки: <b>{f1(c.girth)} мм</b></span>
        <span>Загинів: <b>{c.bends}</b></span>
        <span>Заготовок з листа: <b>{c.strips} шт</b></span>
        <span>Заготовок потрібно: <b>{c.need} шт</b></span>
        <span title="Якщо кроїти лише цей елемент">Листів окремо: <b>{c.sheets}</b></span>
        <span>Погонних метрів: <b>{f2(c.runM)}</b></span>
        {e.length > sheetL && <span className="fl-warn">⚠ Виріб довший за лист</span>}
        {c.girth > sheetW && <span className="fl-warn">⚠ Розгортка більша за ширину листа</span>}
      </div>
    </div>
  );
}

const NEST_C = ['#f08c00', '#1c7ed6', '#2f9e44', '#ae3ec9', '#e03131', '#0c8599', '#5f3dc4', '#e8590c', '#66a80f', '#c2255c'];
function NestView({ nest, items, sw, print = false }: { nest: Nest; items: FElem[]; sw: number; print?: boolean }) {
  if (!nest.sheets && !nest.tooWide.length) return <div className="text-muted fl-nest-empty">Немає заготовок для розкрою.</div>;
  const BW = print ? 300 : 340;
  return (
    <div className="fl-nest-body">
      {!print && <div className="fl-nest-sum">
        <span>Листів: <b>{nest.sheets}</b></span>
        <span>Метал: <b>{f2(nest.sheetArea)} м²</b></span>
        <span>У заготовках: <b>{f2(nest.usedArea)} м²</b></span>
        <span>Відходи: <b>{f1(nest.wastePct)}%</b></span>
      </div>}
      {nest.tooWide.map(i => <div key={'w' + i} className="fl-warn">⚠ {i + 1}. <span data-no-i18n>{items[i]?.name}</span> — <span>заготовка ширша за лист</span></div>)}
      <table className="fl-nest-tab">
        <tbody>
          {nest.plans.map((p, k) => {
            let x = 0;
            return (
              <tr key={k}>
                <td className="fl-nest-n">{p.count} ×</td>
                <td>
                  <svg width={BW} height={22} className="fl-nest-bar">
                    <rect x={0.5} y={0.5} width={BW - 1} height={21} className="fl-nest-sheet" />
                    {p.pattern.map((ii, q) => {
                      const w = (girth(items[ii]) / sw) * (BW - 1), x0 = x; x += w;
                      return <g key={q}><rect x={0.5 + x0} y={0.5} width={Math.max(0.5, w)} height={21} fill={NEST_C[ii % NEST_C.length]} opacity={0.75} stroke="#fff" strokeWidth={1} />
                        {w > 14 && <text x={0.5 + x0 + w / 2} y={15} textAnchor="middle" className="fl-nest-t">{ii + 1}</text>}</g>;
                    })}
                  </svg>
                </td>
                <td className="fl-nest-d">{p.pattern.length > 0 ? groupPattern(p.pattern, items) : ''} <span className="fl-nest-w">· <span>залишок</span> {f1(p.waste)} мм</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const groupPattern = (pat: number[], items: FElem[]) => {
  const m = new Map<number, number>();
  pat.forEach(i => m.set(i, (m.get(i) || 0) + 1));
  return [...m.entries()].map(([i, n]) => `№${i + 1}: ${n}×${f1(girth(items[i]))}`).join(' + ');
};

// Фото → JPEG ≤ 1600 px (менше трафіку і дешевше розпізнавання)
async function shrinkImage(file: File): Promise<{ data: string; media: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Не вдалося відкрити фото')); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL('image/jpeg', 0.85);
    return { data: d.slice(d.indexOf(',') + 1), media: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

export default function FlashingPage() {
  const [list, setList] = useState<ListRow[]>([]);
  const [q, setQ] = useState('');
  const [cur, setCur] = useState<Cur | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [tpl, setTpl] = useState(1);
  const paperRef = useRef<HTMLElement>(null);

  const loadList = useCallback(() => { catApi('GET', '/flashings').then(d => setList(d.items || [])).catch(e => setMsg(e.message)); }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const guard = () => !dirty || window.confirm('Є незбережені зміни. Продовжити без збереження?');
  const open = async (id: number) => {
    if (!guard()) return;
    try {
      const d = await catApi('GET', `/flashings/${id}`);
      const f = d.flashing;
      const data: FDoc = { ...emptyDoc(), items: [], ...(f.data || {}) };
      setCur({ id: f.id, name: f.name, client_name: f.client_name || '', data }); setDirty(false); setMsg('');
    } catch (e: any) { setMsg(e.message); }
  };
  const create = () => { if (!guard()) return; setCur({ name: 'Нове креслення', client_name: '', data: emptyDoc() }); setDirty(true); setMsg(''); };

  const patch = (p: Partial<Cur>) => { setCur(c => c && ({ ...c, ...p })); setDirty(true); };
  const patchDoc = (p: Partial<FDoc>) => { setCur(c => c && ({ ...c, data: { ...c.data, ...p } })); setDirty(true); };
  const patchElem = (id: string, p: Partial<FElem>) => { setCur(c => c && ({ ...c, data: { ...c.data, items: c.data.items.map(e => e.id === id ? { ...e, ...p } : e) } })); setDirty(true); };
  const items = useMemo(() => cur?.data.items || [], [cur?.data.items]);
  const setItems = (it: FElem[]) => patchDoc({ items: it });
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoMsg, setPhotoMsg] = useState('');
  const [photoNotes, setPhotoNotes] = useState<string[]>([]);
  const fromPhoto = async (files: FileList | null) => {
    if (!files || !files.length || !cur) return;
    setBusy('photo'); setPhotoMsg(''); setPhotoNotes([]);
    const added: FElem[] = [], notes: string[] = [];
    try {
      for (const f of Array.from(files)) {
        const img = await shrinkImage(f);
        const r = await catApi('POST', '/flashings/recognize', { image: img.data, media: img.media });
        (r.elements as SketchEl[] || []).forEach(s => {
          const e = fromSketch(s);
          if (e) { added.push(e); if (s.unclear) notes.push(`${e.name}: ${s.unclear}`); }
        });
      }
      if (!added.length) setPhotoMsg('На фото не знайдено ескізів доборів');
      else {
        patchDoc({ items: [...items, ...added] });
        setPhotoMsg(`Додано з фото: ${added.length}. Перевірте розміри й кути.`); setPhotoNotes(notes);
      }
    } catch (e: any) { setPhotoMsg(e.message || String(e)); }
    finally { setBusy(''); if (photoRef.current) photoRef.current.value = ''; }
  };

  const save = useCallback(async () => {
    if (!cur) return;
    setBusy('save'); setMsg('');
    try {
      const body = { name: cur.name, client_name: cur.client_name, data: cur.data };
      const d = cur.id ? await catApi('PUT', `/flashings/${cur.id}`, body) : await catApi('POST', '/flashings', body);
      setCur(c => c && ({ ...c, id: d.flashing.id })); setDirty(false); setMsg('Збережено'); loadList();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }, [cur, loadList]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [save]);
  useEffect(() => {
    const b = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', b); return () => window.removeEventListener('beforeunload', b);
  }, [dirty]);

  const remove = async () => {
    if (!cur) return;
    if (cur.id && !window.confirm(`Видалити креслення «${cur.name}»?`)) return; // i18n-ignore (tpl)
    try { if (cur.id) await catApi('DELETE', `/flashings/${cur.id}`); setCur(null); setDirty(false); loadList(); } catch (e: any) { setMsg(e.message); }
  };
  const copy = () => { if (!cur) return; setCur({ name: cur.name + ' (копія)', client_name: cur.client_name, data: JSON.parse(JSON.stringify(cur.data)) }); setDirty(true); }; // i18n-ignore (tpl)
  const pdf = async () => {
    if (!paperRef.current || !cur) return;
    setBusy('pdf');
    try { await specToPdf(paperRef.current, `${cur.name}`); } catch (e: any) { alert(e.message || String(e)); } finally { setBusy(''); }
  };

  const sw = cur?.data.sheet_width || 1250;
  const sl = cur?.data.sheet_length || 2000;
  const mix = cur?.data.nest !== false;
  const tot = useMemo(() => items.reduce((a, e) => {
    const c = blankCalc(e, sw, sl);
    return { qty: a.qty + (e.qty || 0), runM: a.runM + c.runM, need: a.need + c.need };
  }, { qty: 0, runM: 0, need: 0 }), [items, sw, sl]);
  const nest = useMemo(() => nestPlan(items, sw, sl, mix), [items, sw, sl, mix]);

  const shown = list.filter(r => !q || (r.name + ' ' + (r.client_name || '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fl-wrap">
      <div className="page-header no-print">
        <div><h1 className="page-title">Креслення добірних елементів</h1>
          <p className="text-muted">Планки, коньки, ендови, примикання, відливи — сторони, кути, розгортка і бланк на гнуття</p></div>
        <button className="btn btn-primary" onClick={create}>+ Нове креслення</button>
      </div>

      <div className="fl-grid">
        <aside className="card fl-list no-print">
          <input className="form-control" placeholder="Пошук: назва, клієнт" value={q} onChange={e => setQ(e.target.value)} />
          <div className="fl-list-items">
            {!shown.length && <div className="cl-empty">Креслень поки немає. Натисніть «+ Нове креслення».</div>}
            {shown.map(r => (
              <button key={r.id} className={`cl-item${cur?.id === r.id ? ' on' : ''}`} onClick={() => open(r.id)}>
                <div className="cl-item-top"><b data-no-i18n>{r.name}</b><span className="fl-cnt">{r.items_count}</span></div>
                <div className="cl-item-sub"><span data-no-i18n>{r.client_name || '—'}</span> · {dateUa(r.updated_at)}{r.user_name ? <> · <span data-no-i18n>{r.user_name}</span></> : null}</div>
              </button>
            ))}
          </div>
        </aside>

        {!cur ? (
          <div className="card fl-empty no-print">
            <p>Виберіть креслення зліва або створіть нове.</p>
            <p className="text-muted">Елемент креслиться мишкою або пальцем: точка за точкою, потім клік по стороні — точна довжина або завальцювання, по вершині — кут. Ширина заготовки і кількість листів рахуються автоматично.</p>
          </div>
        ) : (
          <div className="fl-main">
            <div className="card fl-doc no-print">
              <div className="fl-doc-grid">
                <label className="fl-wide"><span>Назва креслення</span><input className="form-control" value={cur.name} onChange={e => patch({ name: e.target.value })} data-no-i18n /></label>
                <label><span>Клієнт / об'єкт</span><input className="form-control" value={cur.client_name} onChange={e => patch({ client_name: e.target.value })} data-no-i18n /></label>
                <label><span>Колір (RAL)</span><input className="form-control" value={cur.data.color || ''} onChange={e => patchDoc({ color: e.target.value })} data-no-i18n /></label>
                <label><span>Покриття</span><input className="form-control" list="fl-coatings" value={cur.data.coating || ''} onChange={e => patchDoc({ coating: e.target.value })} data-no-i18n /></label>
                <label><span>Товщина, мм</span><input className="form-control" list="fl-thick" inputMode="decimal" value={cur.data.thickness || ''} onChange={e => patchDoc({ thickness: e.target.value })} data-no-i18n /></label>
                <label><span>Виробник металу</span><input className="form-control" list="fl-makers" value={cur.data.maker || ''} onChange={e => patchDoc({ maker: e.target.value })} data-no-i18n /></label>
                <datalist id="fl-coatings">{['Поліестер', 'Матовий поліестер', 'PURAL', 'PURAL Matt', 'Printech', 'Оцинкування'].map(v => <option key={v} value={v} />)}</datalist>
                <datalist id="fl-thick">{['0.4', '0.45', '0.5', '0.55', '0.7'].map(v => <option key={v} value={v} />)}</datalist>
                <datalist id="fl-makers">{['ArcelorMittal', 'Tata Steel', 'SSAB', 'U.S. Steel Košice', 'Marcegaglia', 'Thyssenkrupp', 'Dongbu (Корея)', 'Китай'].map(v => <option key={v} value={v} />)}</datalist>
                <label><span>Лист металу, мм</span>
                  <span className="fl-sheet"><NumIn value={sw} step={10} title="Ширина листа" onChange={v => patchDoc({ sheet_width: Math.max(1, v) })} /> × <NumIn value={sl} step={50} title="Довжина листа" onChange={v => patchDoc({ sheet_length: Math.max(1, v) })} /></span></label>
                <label className="fl-wide"><span>Примітка</span><input className="form-control" value={cur.data.note || ''} onChange={e => patchDoc({ note: e.target.value })} data-no-i18n /></label>
              </div>
              <div className="fl-doc-tools">
                <button className="btn btn-primary btn-sm" disabled={busy === 'save'} onClick={save} title="Ctrl+S">{busy === 'save' ? 'Збереження…' : dirty ? '💾 Зберегти *' : '💾 Зберегти'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>🖨 Друк</button>
                <button className="btn btn-secondary btn-sm" disabled={busy === 'pdf'} onClick={pdf}>{busy === 'pdf' ? 'Створення PDF…' : 'Зберегти PDF'}</button>
                <button className="btn btn-ghost btn-sm" onClick={copy}>⧉ Копія креслення</button>
                <button className="btn btn-ghost btn-sm fl-del" onClick={remove}>🗑 Видалити</button>
                {msg && <span className="fl-msg">{msg}</span>}
              </div>
            </div>

            <div className="no-print">
              {items.map((e, i) => (
                <ElemEditor key={e.id} e={e} idx={i} total={items.length} sheetW={sw} sheetL={sl}
                  onChange={p => patchElem(e.id, p)}
                  onDel={() => { if (window.confirm(`Видалити елемент «${e.name}»?`)) setItems(items.filter(x => x.id !== e.id)); }} // i18n-ignore (tpl)
                  onDup={() => { const c = { ...JSON.parse(JSON.stringify(e)), id: newId() }; const it = [...items]; it.splice(i + 1, 0, c); setItems(it); }}
                  onMove={d => { const it = [...items]; const [x] = it.splice(i, 1); it.splice(i + d, 0, x); setItems(it); }} />
              ))}
              <div className="card fl-add">
                <span>Додати елемент:</span>
                <select className="form-control" value={tpl} onChange={e => setTpl(+e.target.value)}>
                  {FLASH_TEMPLATES.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" onClick={() => setItems([...items, newElem(FLASH_TEMPLATES[tpl])])}>+ Додати</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setItems([...items, { ...newElem(FLASH_TEMPLATES[0]), name: 'Новий елемент', segs: [] }])}>✎ Накреслити з нуля</button>
                <button className="btn btn-secondary btn-sm" disabled={busy === 'photo'} onClick={() => photoRef.current?.click()} title="Сфотографуйте ескіз від руки — креслення з'явиться автоматично">{busy === 'photo' ? 'Розпізнаю фото…' : '📷 З фото ескізу'}</button>
                <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={ev => fromPhoto(ev.target.files)} />
                <span className="text-muted fl-add-note">Шаблони — типові форми з примірними розмірами, змініть їх під свій об'єкт.</span>
                {photoMsg && <div className="fl-photo-msg"><span>{photoMsg}</span>{photoNotes.map((n, i) => <div key={i} className="fl-photo-note" data-no-i18n>⚠ {n}</div>)}</div>}
              </div>
              <div className="card fl-nest">
                <div className="fl-nest-head">
                  <b>Розкрій листів {sw} × {sl} мм</b>
                  <label className="fl-chk"><input type="checkbox" checked={mix} onChange={ev => patchDoc({ nest: ev.target.checked })} /> <span>Оптимально: змішувати різні елементи на листі</span></label>
                </div>
                <NestView nest={nest} items={items} sw={sw} />
              </div>
            </div>

            {/* Бланк на гнуття — його друкуємо і зберігаємо в PDF */}
            <article className="kp-paper fl-paper" ref={paperRef}>
              <h2 className="kp-paper-title">КРЕСЛЕННЯ ДОБІРНИХ ЕЛЕМЕНТІВ</h2>
              <div className="fl-paper-head">
                <div><span>Креслення:</span> <b data-no-i18n>{cur.name}</b></div>
                <div><span>Клієнт / об'єкт:</span> <span data-no-i18n>{cur.client_name || '—'}</span></div>
                <div><span>Колір:</span> <span data-no-i18n>{cur.data.color || '—'}</span> · <span>Покриття:</span> <span data-no-i18n>{cur.data.coating || '—'}</span> · <span>Товщина:</span> <span data-no-i18n>{cur.data.thickness ? cur.data.thickness + ' мм' : '—'}</span> · <span>Виробник металу:</span> <span data-no-i18n>{cur.data.maker || '—'}</span></div>
                <div><span>Дата:</span> {new Date().toLocaleDateString('uk-UA')} · <span>Лист:</span> {sw} × {sl} мм</div>
              </div>
              <div className="fl-paper-grid">
                {items.map((e, i) => {
                  const c = blankCalc(e, sw, sl);
                  return (
                    <div key={e.id} className="fl-paper-item">
                      <div className="fl-paper-name"><b>{i + 1}.</b> <span data-no-i18n>{e.name}</span></div>
                      <FlashingSvg e={e} w={380} h={250} print />
                      <div className="fl-paper-meta">
                        <span>Заготовка: <b>{f1(c.girth)} мм</b></span><span>Загинів: <b>{c.bends}</b></span>
                        <span>Довжина: <b>{e.length} мм</b></span><span>К-сть: <b>{e.qty} шт</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <table className="kp-table kp-paper-table">
                <thead><tr><th>№</th><th>Елемент</th><th>Ширина заготовки, мм</th><th>Загинів</th><th>Довжина, мм</th><th>К-сть, шт</th><th>П.м.</th><th>Заготовок</th></tr></thead>
                <tbody>
                  {items.map((e, i) => {
                    const c = blankCalc(e, sw, sl);
                    return <tr key={e.id}><td>{i + 1}</td><td data-no-i18n>{e.name}</td><td>{f1(c.girth)}</td><td>{c.bends}</td><td>{e.length}</td><td>{e.qty}</td><td>{f2(c.runM)}</td><td>{c.need}</td></tr>;
                  })}
                  <tr className="tr-total"><td colSpan={5}>Всього:</td><td>{tot.qty}</td><td>{f2(tot.runM)}</td><td>{tot.need}</td></tr>
                </tbody>
              </table>
              <div className="kp-paper-line">Листів металу {sw} × {sl} мм: <b>{nest.sheets}</b> · <span>відходи</span> {f1(nest.wastePct)}%</div>
              <div className="fl-paper-nest"><NestView nest={nest} items={items} sw={sw} print /></div>
              <div className="kp-paper-line fl-paper-legend">Помаранчева лінія на кресленні — фарбована сторона.</div>
              {cur.data.note && <div className="kp-paper-note"><b>Примітка:</b> <span data-no-i18n>{cur.data.note}</span></div>}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
