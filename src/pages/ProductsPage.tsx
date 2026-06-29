// ============================================
// ArtBudTrading Roof Calculator
// pages/ProductsPage.tsx — Сторінка продукції
// ============================================

import React, { useEffect, useState } from 'react';

const BASE = process.env.REACT_APP_API_URL || '/calculator/api';
const tok  = () => localStorage.getItem('rc_token');
const api  = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Помилка');
  return d;
};

type Category = 'tile' | 'profile' | 'falts';

interface Material {
  id: number;
  type: Category;
  name: string;
  manufacturer?: string;
  full_width: number;
  useful_width: number;
  side_overlap: number;
  length_overlap: number;
  wave_step?: number;
  wave_height?: number;
  min_length: number;
  max_length: number;
  cut_step?: number;
  forbidden_lengths?: number[][];
  stock_lengths?: number[];
  lock_type?: string;
  min_joint_distance?: number;
  join_overlap?: number;
  min_slope_angle?: number;
  price_per_m2: number;
  price_per_meter?: number;
  weight_per_m2?: number;
  screw_per_m2?: number;
  screw_name?: string;
  screw_price?: number;
  color_options?: string[];
  coating_options?: string[];
  thickness_options?: number[];
  is_active: boolean;
  sort_order: number;
}

const EMPTY: Omit<Material, 'id'> = {
  type: 'tile',
  name: '',
  manufacturer: '',
  full_width: 1185,
  useful_width: 1100,
  side_overlap: 85,
  length_overlap: 150,
  wave_step: 350,
  wave_height: 38,
  min_length: 400,
  max_length: 8000,
  cut_step: 350,
  forbidden_lengths: [],
  stock_lengths: [],
  lock_type: '',
  min_joint_distance: 500,
  join_overlap: 100,
  min_slope_angle: 14,
  price_per_m2: 0,
  price_per_meter: 0,
  weight_per_m2: 0,
  screw_per_m2: 7,
  screw_name: 'Саморіз 4.8×35',
  screw_price: 2.50,
  color_options: [],
  coating_options: [],
  thickness_options: [],
  is_active: true,
  sort_order: 0,
};

const CAT_LABEL: Record<Category, string> = {
  tile: 'Металочерепиця',
  profile: 'Профнастил',
  falts: 'Фальцева покрівля',
};

export default function ProductsPage({ category }: { category?: Category }) {
  const [cat, setCat] = useState<Category>(category || 'tile');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [form, setForm] = useState<Omit<Material,'id'>>(EMPTY);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Тимчасові поля для JSON масивів
  const [forbiddenInput, setForbiddenInput] = useState('');
  const [stockInput, setStockInput] = useState('');
  const [colorsInput, setColorsInput] = useState('');
  const [coatingsInput, setCoatingsInput] = useState('');
  const [thicknessInput, setThicknessInput] = useState('');

  useEffect(() => { loadMaterials(); }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (category) setCat(category); }, [category]);

  const loadMaterials = async () => {
    try {
      const d = await api('GET', `/materials/${cat}`);
      setMaterials(d.profiles || []);
    } catch { setError('Помилка завантаження'); }
  };

  const selectMaterial = (m: Material) => {
    setSelected(m);
    setIsNew(false);
    setForm({ ...m });
    setForbiddenInput(JSON.stringify(m.forbidden_lengths || []));
    setStockInput((m.stock_lengths || []).join(', '));
    setColorsInput((m.color_options || []).join(', '));
    setCoatingsInput((m.coating_options || []).join(', '));
    setThicknessInput((m.thickness_options || []).join(', '));
    setError(''); setSuccess('');
  };

  const newMaterial = () => {
    setSelected(null);
    setIsNew(true);
    setForm({ ...EMPTY, type: cat });
    setForbiddenInput('[]');
    setStockInput('');
    setColorsInput('');
    setCoatingsInput('');
    setThicknessInput('');
    setError(''); setSuccess('');
  };

  const parseArrayField = (val: string): string[] =>
    val.split(',').map(s => s.trim()).filter(Boolean);

  const parseNumberArray = (val: string): number[] =>
    val.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);

  const save = async () => {
    setLoading(true); setError(''); setSuccess('');
    try {
      const payload = {
        ...form,
        forbidden_lengths: JSON.parse(forbiddenInput || '[]'),
        stock_lengths: parseNumberArray(stockInput),
        color_options: parseArrayField(colorsInput),
        coating_options: parseArrayField(coatingsInput),
        thickness_options: parseNumberArray(thicknessInput),
      };
      if (isNew) {
        await api('POST', '/admin/materials', payload);
        setSuccess('Матеріал створено!');
        setIsNew(false);
      } else if (selected) {
        await api('PUT', `/admin/materials/${selected.id}`, payload);
        setSuccess('Збережено!');
      }
      loadMaterials();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const f = (key: keyof Omit<Material,'id'>, val: any) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const showForm = isNew || selected !== null;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Ліва панель — список */}
      <div style={{
        width: '280px', minWidth: '280px', borderRight: '1px solid var(--clr-border)',
        display: 'flex', flexDirection: 'column', background: 'var(--clr-surface)',
      }}>
        {/* Вкладки категорій */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--clr-border)' }}>
          {(['tile','profile','falts'] as Category[]).map(c => (
            <button key={c} onClick={() => { setCat(c); setSelected(null); setIsNew(false); }}
              style={{
                flex: 1, padding: '10px 4px', fontSize: '.72rem', fontWeight: 600,
                border: 'none', borderBottom: cat === c ? '2px solid var(--clr-brand)' : '2px solid transparent',
                background: 'none', color: cat === c ? 'var(--clr-brand)' : 'var(--clr-text-3)',
                cursor: 'pointer',
              }}>
              {CAT_LABEL[c].replace('Металочерепиця','МЧ').replace('Профнастил','ПН').replace('Фальцева покрівля','ФП')}
            </button>
          ))}
        </div>

        {/* Кнопка додати */}
        <div style={{ padding: '8px' }}>
          <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={newMaterial}>
            + Додати {CAT_LABEL[cat]}
          </button>
        </div>

        {/* Список матеріалів */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {materials.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--clr-text-3)', fontSize: '.85rem', textAlign: 'center' }}>
              Матеріалів немає
            </div>
          )}
          {materials.map(m => (
            <div key={m.id}
              onClick={() => selectMaterial(m)}
              style={{
                padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--clr-border)',
                background: selected?.id === m.id ? 'var(--clr-brand-pale)' : 'transparent',
                borderLeft: selected?.id === m.id ? '3px solid var(--clr-brand)' : '3px solid transparent',
              }}>
              <div style={{ fontWeight: 500, fontSize: '.85rem' }}>{m.name}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--clr-text-3)' }}>
                {m.manufacturer && `${m.manufacturer} · `}
                {m.useful_width} мм · {m.price_per_m2} грн/м²
              </div>
              <div style={{ fontSize: '.7rem', marginTop: '2px' }}>
                <span style={{
                  background: m.is_active ? '#dcfce7' : '#fee2e2',
                  color: m.is_active ? '#166534' : '#991b1b',
                  padding: '1px 6px', borderRadius: '10px',
                }}>
                  {m.is_active ? 'Активний' : 'Неактивний'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Права панель — форма */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {!showForm ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--clr-text-3)' }}>
            Оберіть матеріал зліва або додайте новий
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ margin: 0 }}>{isNew ? `Новий матеріал (${CAT_LABEL[cat]})` : form.name}</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.85rem' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => f('is_active', e.target.checked)} />
                  Активний
                </label>
                <button className="btn btn-primary" onClick={save} disabled={loading}>
                  {loading ? 'Збереження…' : '💾 Зберегти'}
                </button>
              </div>
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: '16px' }}>⚠️ {error}</div>}
            {success && <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px' }}>✅ {success}</div>}

            {/* === БЛОК 1: Основна інформація === */}
            <Section title="Основна інформація">
              <Row>
                <Field label="Назва матеріалу *">
                  <input className="form-control" value={form.name} onChange={e => f('name', e.target.value)} placeholder="Н-р: MaxiTile Classic" />
                </Field>
                <Field label="Виробник">
                  <input className="form-control" value={form.manufacturer || ''} onChange={e => f('manufacturer', e.target.value)} placeholder="Н-р: Ruukki" />
                </Field>
                <Field label="Тип">
                  <select className="form-control" value={form.type} onChange={e => f('type', e.target.value)}>
                    <option value="tile">Металочерепиця</option>
                    <option value="profile">Профнастил</option>
                    <option value="falts">Фальцева покрівля</option>
                  </select>
                </Field>
              </Row>
              <Row>
                <Field label="Мін. кут нахилу, °">
                  <input type="number" className="form-control" value={form.min_slope_angle || 0}
                    onChange={e => f('min_slope_angle', Number(e.target.value))} />
                </Field>
                <Field label="Вага, кг/м²">
                  <input type="number" className="form-control" value={form.weight_per_m2 || 0} step="0.1"
                    onChange={e => f('weight_per_m2', Number(e.target.value))} />
                </Field>
                <Field label="Порядок сортування">
                  <input type="number" className="form-control" value={form.sort_order}
                    onChange={e => f('sort_order', Number(e.target.value))} />
                </Field>
              </Row>
            </Section>

            {/* === БЛОК 2: Геометрія листа === */}
            <Section title="Геометрія листа">
              <div style={{ marginBottom: '12px', padding: '12px', background: '#f0f9ff', borderRadius: '8px', fontSize: '.8rem', color: '#0369a1' }}>
                💡 Схема: [—бокове перекриття—|———корисна ширина———|—бокове перекриття—] = повна ширина
              </div>
              <Row>
                <Field label="Повна ширина листа, мм">
                  <input type="number" className="form-control" value={form.full_width}
                    onChange={e => f('full_width', Number(e.target.value))} />
                </Field>
                <Field label="Корисна ширина листа, мм">
                  <input type="number" className="form-control" value={form.useful_width}
                    onChange={e => f('useful_width', Number(e.target.value))} />
                </Field>
                <Field label="Бокове перекриття, мм">
                  <input type="number" className="form-control" value={form.side_overlap}
                    onChange={e => f('side_overlap', Number(e.target.value))} />
                </Field>
              </Row>
              <Row>
                <Field label="Поздовжнє перекриття, мм">
                  <input type="number" className="form-control" value={form.length_overlap}
                    onChange={e => f('length_overlap', Number(e.target.value))} />
                </Field>
                {(cat === 'tile' || cat === 'profile') && <>
                  <Field label="Крок хвилі, мм">
                    <input type="number" className="form-control" value={form.wave_step || ''}
                      onChange={e => f('wave_step', Number(e.target.value))} />
                  </Field>
                  <Field label="Висота хвилі, мм">
                    <input type="number" className="form-control" value={form.wave_height || ''}
                      onChange={e => f('wave_height', Number(e.target.value))} />
                  </Field>
                </>}
              </Row>
            </Section>

            {/* === БЛОК 3: Довжини === */}
            <Section title="Довжини листів">
              <Row>
                <Field label="Мінімальна довжина, мм">
                  <input type="number" className="form-control" value={form.min_length}
                    onChange={e => f('min_length', Number(e.target.value))} />
                </Field>
                <Field label="Максимальна довжина, мм">
                  <input type="number" className="form-control" value={form.max_length}
                    onChange={e => f('max_length', Number(e.target.value))} />
                </Field>
                <Field label="Крок різання (округлення), мм">
                  <input type="number" className="form-control" value={form.cut_step || ''}
                    onChange={e => f('cut_step', Number(e.target.value))} />
                </Field>
              </Row>
              <Row>
                <Field label="Складські довжини, мм (через кому)" style={{ flex: 2 }}>
                  <input className="form-control" value={stockInput} onChange={e => setStockInput(e.target.value)}
                    placeholder="Н-р: 2000, 3000, 4000, 5000, 6000" />
                  <div style={{ fontSize: '.75rem', color: 'var(--clr-text-3)', marginTop: '4px' }}>
                    Якщо порожньо — довжина розраховується автоматично
                  </div>
                </Field>
              </Row>
              <Row>
                <Field label="Заборонені діапазони довжин (JSON)" style={{ flex: 2 }}>
                  <input className="form-control" value={forbiddenInput} onChange={e => setForbiddenInput(e.target.value)}
                    placeholder='[[730, 830], [1080, 1180]]' />
                  <div style={{ fontSize: '.75rem', color: 'var(--clr-text-3)', marginTop: '4px' }}>
                    Формат: [[від, до], [від, до]] — діапазони в мм де виробник не виготовляє листи
                  </div>
                </Field>
              </Row>
            </Section>

            {/* === БЛОК 4: Замок (тільки для фальцевої) === */}
            {cat === 'falts' && (
              <Section title="Параметри замку (фальц)">
                <Row>
                  <Field label="Тип замку">
                    <select className="form-control" value={form.lock_type || ''} onChange={e => f('lock_type', e.target.value)}>
                      <option value="">— оберіть —</option>
                      <option value="standing">Стоячий фальц</option>
                      <option value="lying">Лежачий фальц</option>
                      <option value="double">Подвійний фальц</option>
                      <option value="click">Клік-фальц</option>
                    </select>
                  </Field>
                  <Field label="Мін. відстань між стиками, мм">
                    <input type="number" className="form-control" value={form.min_joint_distance || ''}
                      onChange={e => f('min_joint_distance', Number(e.target.value))} />
                  </Field>
                  <Field label="Перекриття в стику, мм">
                    <input type="number" className="form-control" value={form.join_overlap || ''}
                      onChange={e => f('join_overlap', Number(e.target.value))} />
                  </Field>
                </Row>
              </Section>
            )}

            {/* === БЛОК 5: Ціни === */}
            <Section title="Ціни">
              <Row>
                <Field label="Ціна за 1 м² (корисна площа), грн">
                  <input type="number" className="form-control" value={form.price_per_m2} step="0.01"
                    onChange={e => f('price_per_m2', Number(e.target.value))} />
                </Field>
                <Field label="Ціна за 1 пог.м, грн">
                  <input type="number" className="form-control" value={form.price_per_meter || 0} step="0.01"
                    onChange={e => f('price_per_meter', Number(e.target.value))} />
                </Field>
              </Row>
            </Section>

            {/* === БЛОК 6: Саморізи === */}
            <Section title="Кріплення (саморізи)">
              <Row>
                <Field label="Саморізів на 1 м²">
                  <input type="number" className="form-control" value={form.screw_per_m2 || 7} step="0.5"
                    onChange={e => f('screw_per_m2', Number(e.target.value))} />
                </Field>
                <Field label="Назва самореза">
                  <input className="form-control" value={form.screw_name || ''} onChange={e => f('screw_name', e.target.value)}
                    placeholder="Н-р: Саморіз 4.8×35 МАПОС" />
                </Field>
                <Field label="Ціна самореза, грн/шт">
                  <input type="number" className="form-control" value={form.screw_price || 2.5} step="0.1"
                    onChange={e => f('screw_price', Number(e.target.value))} />
                </Field>
              </Row>
            </Section>

            {/* === БЛОК 7: Варіанти === */}
            <Section title="Варіанти (кольори, покриття, товщини)">
              <Row>
                <Field label="Кольори (через кому)">
                  <input className="form-control" value={colorsInput} onChange={e => setColorsInput(e.target.value)}
                    placeholder="Н-р: Червоний, Зелений, Коричневий, Графіт" />
                </Field>
              </Row>
              <Row>
                <Field label="Покриття (через кому)">
                  <input className="form-control" value={coatingsInput} onChange={e => setCoatingsInput(e.target.value)}
                    placeholder="Н-р: Поліестер, Пластизол, Пурал, PVDF" />
                </Field>
              </Row>
              <Row>
                <Field label="Товщини металу, мм (через кому)">
                  <input className="form-control" value={thicknessInput} onChange={e => setThicknessInput(e.target.value)}
                    placeholder="Н-р: 0.45, 0.5, 0.55, 0.7" />
                </Field>
              </Row>
            </Section>

            {/* Кнопка зберегти внизу */}
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-ghost" onClick={() => { setSelected(null); setIsNew(false); }}>
                Скасувати
              </button>
              <button className="btn btn-primary" onClick={save} disabled={loading}>
                {loading ? 'Збереження…' : '💾 Зберегти матеріал'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Допоміжні компоненти ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--clr-surface)', border: '1px solid var(--clr-border)',
      borderRadius: '10px', marginBottom: '16px', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px', background: 'var(--clr-surface-2)',
        borderBottom: '1px solid var(--clr-border)', fontWeight: 600, fontSize: '.85rem',
        color: 'var(--clr-text-2)',
      }}>
        {title}
      </div>
      <div style={{ padding: '16px' }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>{children}</div>;
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ flex: 1, minWidth: '180px', ...style }}>
      <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 500, color: 'var(--clr-text-2)', marginBottom: '4px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}