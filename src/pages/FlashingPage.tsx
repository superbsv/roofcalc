// ============================================
// «Креслення добірних елементів»: малюємо профілі планок (сторони, кути, закатки, фарбована сторона),
// рахуємо розгортку і заготовки з листа, зберігаємо креслення, друкуємо / PDF бланк на гнуття.
// ============================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catApi } from '../components/catalog/CatalogNav';
import FlashingSvg, { segLetter } from '../components/flashing/FlashingSvg';
import { FDoc, FElem, FSeg, FLASH_TEMPLATES, blankCalc, emptyDoc, newElem, newId } from '../components/flashing/flashing';
import { specToPdf } from '../components/spec/specExport';

interface ListRow { id: number; name: string; client_name?: string | null; updated_at: string; user_name?: string | null; items_count: number }
interface Cur { id?: number; name: string; client_name: string; data: FDoc }

const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const f2 = (v: number) => v.toFixed(2);
const dateUa = (s?: string) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T')); return isNaN(+d) ? s : d.toLocaleDateString('uk-UA'); };

// Поле вводу числа: зберігає те, що набрано (кома, порожньо), а наверх віддає число
function NumIn({ value, onChange, className, title, step }: { value: number; onChange: (v: number) => void; className?: string; title?: string; step?: number }) {
  const [t, setT] = useState(String(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { setT(String(value)); last.current = value; } }, [value]);
  return (
    <input className={'form-control ' + (className || '')} inputMode="decimal" title={title} value={t}
      onChange={e => { setT(e.target.value); const n = num(e.target.value); last.current = n; onChange(n); }}
      onKeyDown={e => {
        if (!step || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const n = Math.round((num(t) + (e.key === 'ArrowUp' ? step : -step)) * 10) / 10;
        setT(String(n)); last.current = n; onChange(n);
      }} />
  );
}

function ElemEditor({ e, sheetW, onChange, onDel, onDup, onMove, idx, total }:
  { e: FElem; sheetW: number; onChange: (p: Partial<FElem>) => void; onDel: () => void; onDup: () => void; onMove: (d: number) => void; idx: number; total: number }) {
  const [hi, setHi] = useState(-1);
  const c = blankCalc(e, sheetW);
  const setSeg = (i: number, p: Partial<FSeg>) => onChange({ segs: e.segs.map((s, k) => k === i ? { ...s, ...p } : s) });
  const addSeg = (i: number) => {
    const segs = [...e.segs];
    segs.splice(i + 1, 0, { len: 50, ang: 90, dir: segs[i]?.dir || 1 });
    onChange({ segs });
  };
  const delSeg = (i: number) => { if (e.segs.length > 1) onChange({ segs: e.segs.filter((_, k) => k !== i) }); };
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
        <div className="fl-segs">
          <table className="fl-segtab">
            <thead><tr><th></th><th>Сторона, мм</th><th>Кут після, °</th><th>Загин</th><th></th></tr></thead>
            <tbody>
              {e.segs.map((s, i) => (
                <tr key={i} className={i === hi ? 'on' : ''} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}>
                  <td className="fl-l">{segLetter(i)}</td>
                  <td><NumIn value={s.len} step={1} onChange={v => setSeg(i, { len: Math.max(0, v) })} /></td>
                  {i < e.segs.length - 1 ? <>
                    <td><NumIn value={s.ang} step={1} title="Внутрішній кут між цією і наступною стороною: 90° — прямий, 135° — тупий, 0° — закатка"
                      onChange={v => setSeg(i, { ang: Math.max(0, Math.min(180, v)) })} /></td>
                    <td>
                      <button type="button" className="fl-dir" onClick={() => setSeg(i, { dir: (-s.dir) as 1 | -1 })} title="Загин уліво / управо">
                        {s.dir > 0 ? '↺ ліво' : '↻ право'}</button>
                    </td>
                  </> : <><td className="fl-end" colSpan={2}>кінець</td></>}
                  <td className="fl-rowbtn">
                    <button type="button" onClick={() => addSeg(i)} title="Додати сторону після цієї">+</button>
                    <button type="button" disabled={e.segs.length < 2} onClick={() => delSeg(i)} title="Видалити сторону">−</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fl-quick">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ segs: [{ len: 12, ang: 0, dir: e.segs[0]?.dir || 1 }, ...e.segs] })} title="Закатка 12 мм на початку">+ закатка на початку</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
              const segs = e.segs.map((s, i) => i === e.segs.length - 1 ? { ...s, ang: 0, dir: s.dir } : s);
              onChange({ segs: [...segs, { len: 12, ang: 90, dir: 1 }] });
            }} title="Закатка 12 мм у кінці">+ закатка в кінці</button>
          </div>
          <div className="fl-params">
            <label><span>Напрям 1-ї сторони, °</span><NumIn value={e.start} step={5} onChange={v => onChange({ start: v })} /></label>
            <label><span>Фарбована сторона</span>
              <button type="button" className="fl-dir" onClick={() => onChange({ paint: (-e.paint) as 1 | -1 })}>{e.paint > 0 ? '◐ ліва' : '◑ права'}</button></label>
            <label><span>Довжина виробу, мм</span><NumIn value={e.length} step={50} onChange={v => onChange({ length: Math.max(0, v) })} /></label>
            <label><span>Кількість, шт</span><NumIn value={e.qty} step={1} onChange={v => onChange({ qty: Math.max(0, Math.round(v)) })} /></label>
          </div>
        </div>
        <div className="fl-draw">
          <FlashingSvg e={e} w={440} h={320} hi={hi} onSeg={i => setHi(i)} />
          <div className="fl-legend"><i className="fl-paintmark" /> <span>фарбована сторона</span> · <span>a, b, c… — сторони</span></div>
        </div>
      </div>
      <div className="fl-metrics">
        <span>Розгортка: <b>{f1(c.girth)} мм</b></span>
        <span>Загинів: <b>{c.bends}</b></span>
        <span>Заготовок з листа: <b>{c.strips} шт</b></span>
        <span>Листів металу: <b>{c.sheets}</b></span>
        <span>Погонних метрів: <b>{f2(c.runM)}</b></span>
        <span>Метал: <b>{f2(c.metal)} м²</b></span>
        {c.girth > sheetW && <span className="fl-warn">⚠ Розгортка більша за ширину листа</span>}
      </div>
    </div>
  );
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

  const tot = useMemo(() => items.reduce((a, e) => {
    const c = blankCalc(e, cur?.data.sheet_width || 1250);
    return { qty: a.qty + (e.qty || 0), runM: a.runM + c.runM, metal: a.metal + c.metal, sheets: a.sheets + c.sheets };
  }, { qty: 0, runM: 0, metal: 0, sheets: 0 }), [items, cur?.data.sheet_width]);

  const shown = list.filter(r => !q || (r.name + ' ' + (r.client_name || '')).toLowerCase().includes(q.toLowerCase()));
  const sw = cur?.data.sheet_width || 1250;

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
            <p className="text-muted">Елемент креслиться сторонами: довжина сторони в мм і внутрішній кут загину після неї (90° — прямий, 135° — тупий, 0° — закатка). Розгортка і кількість заготовок з листа рахуються автоматично.</p>
          </div>
        ) : (
          <div className="fl-main">
            <div className="card fl-doc no-print">
              <div className="fl-doc-grid">
                <label className="fl-wide"><span>Назва креслення</span><input className="form-control" value={cur.name} onChange={e => patch({ name: e.target.value })} data-no-i18n /></label>
                <label><span>Клієнт / об'єкт</span><input className="form-control" value={cur.client_name} onChange={e => patch({ client_name: e.target.value })} data-no-i18n /></label>
                <label><span>Колір (RAL)</span><input className="form-control" value={cur.data.color || ''} onChange={e => patchDoc({ color: e.target.value })} data-no-i18n /></label>
                <label><span>Покриття</span><input className="form-control" value={cur.data.coating || ''} onChange={e => patchDoc({ coating: e.target.value })} data-no-i18n /></label>
                <label><span>Товщина, мм</span><input className="form-control" value={cur.data.thickness || ''} onChange={e => patchDoc({ thickness: e.target.value })} data-no-i18n /></label>
                <label><span>Ширина листа металу, мм</span><NumIn value={sw} step={10} onChange={v => patchDoc({ sheet_width: Math.max(1, v) })} /></label>
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
                <ElemEditor key={e.id} e={e} idx={i} total={items.length} sheetW={sw}
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
                <span className="text-muted fl-add-note">Шаблони — типові форми з примірними розмірами, змініть їх під свій об'єкт.</span>
              </div>
            </div>

            {/* Бланк на гнуття — його друкуємо і зберігаємо в PDF */}
            <article className="kp-paper fl-paper" ref={paperRef}>
              <h2 className="kp-paper-title">КРЕСЛЕННЯ ДОБІРНИХ ЕЛЕМЕНТІВ</h2>
              <div className="fl-paper-head">
                <div><span>Креслення:</span> <b data-no-i18n>{cur.name}</b></div>
                <div><span>Клієнт / об'єкт:</span> <span data-no-i18n>{cur.client_name || '—'}</span></div>
                <div><span>Колір:</span> <span data-no-i18n>{cur.data.color || '—'}</span> · <span>Покриття:</span> <span data-no-i18n>{cur.data.coating || '—'}</span> · <span>Товщина:</span> <span data-no-i18n>{cur.data.thickness || '—'}</span></div>
                <div><span>Дата:</span> {new Date().toLocaleDateString('uk-UA')} · <span>Ширина листа:</span> {sw} мм</div>
              </div>
              <div className="fl-paper-grid">
                {items.map((e, i) => {
                  const c = blankCalc(e, sw);
                  return (
                    <div key={e.id} className="fl-paper-item">
                      <div className="fl-paper-name"><b>{i + 1}.</b> <span data-no-i18n>{e.name}</span></div>
                      <FlashingSvg e={e} w={380} h={250} print />
                      <div className="fl-paper-meta">
                        <span>Розгортка: <b>{f1(c.girth)} мм</b></span><span>Загинів: <b>{c.bends}</b></span>
                        <span>Довжина: <b>{e.length} мм</b></span><span>К-сть: <b>{e.qty} шт</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <table className="kp-table kp-paper-table">
                <thead><tr><th>№</th><th>Елемент</th><th>Розгортка, мм</th><th>Загинів</th><th>Довжина, мм</th><th>К-сть, шт</th><th>П.м.</th><th>Метал, м²</th></tr></thead>
                <tbody>
                  {items.map((e, i) => {
                    const c = blankCalc(e, sw);
                    return <tr key={e.id}><td>{i + 1}</td><td data-no-i18n>{e.name}</td><td>{f1(c.girth)}</td><td>{c.bends}</td><td>{e.length}</td><td>{e.qty}</td><td>{f2(c.runM)}</td><td>{f2(c.metal)}</td></tr>;
                  })}
                  <tr className="tr-total"><td colSpan={5}>Всього:</td><td>{tot.qty}</td><td>{f2(tot.runM)}</td><td>{f2(tot.metal)}</td></tr>
                </tbody>
              </table>
              <div className="kp-paper-line">Листів металу: <b>{tot.sheets}</b></div>
              <div className="kp-paper-line fl-paper-legend">Помаранчева лінія на кресленні — фарбована сторона.</div>
              {cur.data.note && <div className="kp-paper-note"><b>Примітка:</b> <span data-no-i18n>{cur.data.note}</span></div>}
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
