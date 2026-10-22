// ============================================
// Типи розрахунку — рівно як кнопки у вікні «Реквізити замовлення» КП
// ============================================
import { CalcType } from '../../api/client';

export interface CalcTypeInfo {
  key: CalcType;
  label: string;
  hint: string;
  materialTypes: string[];   // типи матеріалів з довідника
  stock: boolean;            // «на замовлення» / «зі складу»
  facade?: boolean;
  ready: boolean;            // є движок розрахунку
  hidden?: boolean;
}

export const CALC_TYPES: CalcTypeInfo[] = [
  { key: 'tile', label: 'Металочерепиця', hint: 'Малюнок сусідніх листів суміщається, ряди кратні хвилі.',
    materialTypes: ['tile'], stock: true, ready: true },
  { key: 'profile', label: 'Профнастил', hint: 'Лист будь-якої довжини до Lmax, з округленням.',
    materialTypes: ['profile'], stock: true, ready: true },
  { key: 'falts', label: 'Клік-фальц', hint: 'Картини на всю довжину ската; стики — врозбіжку, якщо скат довший за Lmax.',
    materialTypes: ['falts'], stock: false, ready: true },
  { key: 'siding', label: 'Металевий сайдинг', hint: 'Фасад: панелі ріжуться під висоту стіни з округленням, вирізи під вікна і двері.',
    materialTypes: ['siding'], stock: false, facade: true, ready: true },
  { key: 'sandwich', label: 'Сендвіч-панелі', hint: 'Стіни і дахи: панелі під розмір з округленням до кроку заводу.',
    materialTypes: ['sandwich'], stock: false, ready: true },
  // Старі типи — лише для відкриття раніше збережених розрахунків (у виборі не показуються)
  { key: 'piece', label: 'Черепиця', hint: '', materialTypes: ['tile_module', 'natural_tile'], stock: false, ready: true, hidden: true },
  { key: 'sheet', label: 'Листовий матеріал', hint: '', materialTypes: ['sheet'], stock: false, ready: true, hidden: true },
];

export const calcTypeInfo = (k?: string) => CALC_TYPES.find(c => c.key === k);

export function calcTypeForMaterial(materialType?: string): CalcTypeInfo | undefined {
  return CALC_TYPES.find(c => c.materialTypes.includes(materialType || ''));
}
