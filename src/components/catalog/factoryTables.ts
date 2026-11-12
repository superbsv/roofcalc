// ============================================
// Таблиці виробників металочерепиці: недопустимі довжини (не виготовляються).
// Стандартний («завершений») лист = 350 × n + база; від нього до межі рекомендованого — можна,
// далі до наступного стандарту — не виготовляється. Діапазон записуємо як перший … останній
// недопустимий міліметр (721–849), тому межі таблиць «730–840» з кроком 10 теж покриті.
// Ті самі дані на сервері — backend/src/core/catalog_data/*.php (оновлення наявних позицій каталогу).
// ============================================
export interface FactoryTable { id: string; label: string; base: number; rec: number; rows: number; min: number; max: number }

export const FACTORY_TABLES: FactoryTable[] = [
  { id: 'gr-classic', label: 'Good Roof — Classic-Roof 350/15', base: 130, rec: 220, rows: 21, min: 480, max: 7700 },
  { id: 'gr-maxi', label: 'Good Roof — Maxi-Roof 350/20', base: 106, rec: 328, rows: 20, min: 456, max: 7434 },
  { id: 'gr-premium', label: 'Good Roof — Premium-Roof 350/30', base: 100, rec: 245, rows: 21, min: 450, max: 7695 },
  { id: 'gr-retro', label: 'Good Roof — Retro-Roof 350/20', base: 150, rec: 220, rows: 21, min: 500, max: 7720 },
  { id: 'tile-a', label: 'Тайл — Класика, Ретро', base: 150, rec: 220, rows: 18, min: 500, max: 6670 },
  { id: 'tile-b', label: 'Тайл — Преміум, Елегант, Престиж, Модерн', base: 70, rec: 280, rows: 18, min: 420, max: 6650 },
];

export function factoryRanges(t: FactoryTable): [number, number][] {
  const r: [number, number][] = [];
  for (let n = 1; n <= t.rows; n++) { const s = 350 * n + t.base; r.push([s + t.rec + 1, s + 349]); }
  return r;
}
