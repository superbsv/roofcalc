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
}

export const CALC_TYPES: CalcTypeInfo[] = [
  { key: 'tile', label: 'Металочерепиця', hint: 'Малюнок сусідніх листів суміщається, ряди кратні хвилі. «На замовлення» і «зі складу».',
    materialTypes: ['tile'], stock: true, ready: true },
  { key: 'piece', label: 'Черепиця', hint: 'Прямокутні листи фіксованого розміру, обрізки не використовуються (Метробонд, натуральна).',
    materialTypes: ['tile_module', 'natural_tile'], stock: false, ready: true },
  { key: 'profile', label: 'Профнастил', hint: 'Лист будь-якої довжини до Lmax, з округленням. «На замовлення» і «зі складу».',
    materialTypes: ['profile'], stock: true, ready: true },
  { key: 'falts', label: 'Фальцева покрівля', hint: 'Як профнастил, але нахлест сусідніх листів зі зміщенням (врозбіжку).',
    materialTypes: ['falts'], stock: false, ready: true },
  { key: 'sheet', label: 'Листовий матеріал', hint: 'Ондулін, єврошифер: лист фіксованої довжини, обрізається зверху і знизу, обрізки використовуються.',
    materialTypes: ['sheet'], stock: false, ready: true },
  { key: 'siding', label: 'Сайдинг', hint: 'Фасадні панелі, обрізаються зліва і справа. Движок фасадів — наступний етап.',
    materialTypes: ['siding'], stock: true, facade: true, ready: false },
];

export const calcTypeInfo = (k?: string) => CALC_TYPES.find(c => c.key === k);

export function calcTypeForMaterial(materialType?: string): CalcTypeInfo | undefined {
  return CALC_TYPES.find(c => c.materialTypes.includes(materialType || ''));
}
