// Імпорт / експорт каталогу в Excel (.xlsx) або CSV
import { catApi } from './CatalogNav';

// Колонки файлу: ключ поля → заголовок (заголовки приймаються і російською/англійською)
export const COLS: [string, string, string[]][] = [
  ['id', 'ID', []], // i18n-ignore
  ['section', 'Розділ', ['Раздел', 'Section']], // i18n-ignore
  ['manufacturer', 'Виробник', ['Производитель', 'Manufacturer']], // i18n-ignore
  ['name', 'Назва', ['Название', 'Name']], // i18n-ignore
  ['full_width', 'Повна ширина, мм', ['Полная ширина, мм', 'Full width, mm']], // i18n-ignore
  ['useful_width', 'Корисна ширина, мм', ['Полезная ширина, мм', 'Useful width, mm']], // i18n-ignore
  ['min_length', 'Мін. довжина, мм', ['Мин. длина, мм', 'Min length, mm']], // i18n-ignore
  ['max_length', 'Макс. довжина, мм', ['Макс. длина, мм', 'Max length, mm']], // i18n-ignore
  ['max_std_length', 'Стандартна довжина, мм', ['Стандартная длина, мм', 'Standard length, mm']], // i18n-ignore
  ['wave_step', 'Крок хвилі, мм', ['Шаг волны, мм', 'Wave step, mm']], // i18n-ignore
  ['round_step', 'Округлення, мм', ['Округление, мм', 'Rounding, mm']], // i18n-ignore
  ['cut_step', 'Крок різання, мм', ['Шаг резки, мм', 'Cutting step, mm']], // i18n-ignore
  ['length_overlap', 'Поздовжній нахлест, мм', ['Продольный нахлёст, мм', 'Length overlap, mm']], // i18n-ignore
  ['min_slope_angle', 'Мін. кут, °', ['Мин. угол, °', 'Min pitch, °']], // i18n-ignore
  ['lock_type', 'Тип замку', ['Тип замка', 'Lock type']], // i18n-ignore
  ['min_joint_distance', 'Мін. відстань між стиками, мм', ['Мин. расстояние между стыками, мм', 'Min joint distance, mm']], // i18n-ignore
  ['join_overlap', 'Перекриття в стику, мм', ['Перекрытие в стыке, мм', 'Joint overlap, mm']], // i18n-ignore
  ['forbidden_lengths', 'Заборонені довжини (від-до; …)', ['Запрещённые длины (от-до; …)', 'Forbidden lengths (from-to; …)']], // i18n-ignore
  ['price_per_m2', 'Ціна за м²', ['Цена за м²', 'Price per m²']], // i18n-ignore
  ['is_active', 'Активний (1/0)', ['Активный (1/0)', 'Active (1/0)']], // i18n-ignore
];

export async function exportCatalog(fileName: string) {
  const XLSX = await import('xlsx');
  const d = await catApi('GET', '/catalog/export');
  const rows = (d.rows as Record<string, any>[]).map(r => Object.fromEntries(COLS.map(([k, h]) => [h, r[k] ?? ''])));
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLS.map(c => c[1]) });
  ws['!cols'] = COLS.map(([k]) => ({ wch: k === 'name' ? 34 : k === 'section' || k === 'manufacturer' ? 22 : k === 'forbidden_lengths' ? 26 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Каталог');
  XLSX.writeFile(wb, fileName);
  return rows.length;
}

export async function importCatalog(file: File): Promise<{ created: number; updated: number; errors: string[]; errors_count: number }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const map = new Map<string, string>();
  COLS.forEach(([k, h, alt]) => [k, h, ...alt].forEach(x => map.set(norm(x), k)));
  const rows = raw.map(r => {
    const o: Record<string, any> = {};
    Object.entries(r).forEach(([h, v]) => { const k = map.get(norm(h)); if (k) o[k] = typeof v === 'string' ? v.trim() : v; });
    return o;
  }).filter(o => Object.values(o).some(v => String(v).trim() !== ''));
  if (!rows.length) throw new Error('У файлі немає рядків з даними. Перший рядок — заголовки колонок, як у файлі експорту.');
  if (!rows.some(r => r.name)) throw new Error('Не знайдено колонку «Назва». Візьміть за основу файл експорту каталогу.');
  return catApi('POST', '/catalog/import', { rows });
}
