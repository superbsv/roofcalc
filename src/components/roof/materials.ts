// materials.ts — типи матеріалів і режими розрахунку, як у «Кровля Профи»
import { MaterialProfile } from '../../api/client';

export type MaterialType = MaterialProfile['type'];

export const MATERIAL_TYPES: { key: MaterialType; label: string; short: string; hint: string; fixed: boolean; stock: boolean; hidden?: boolean }[] = [
  { key: 'tile',         label: 'Металочерепиця',              short: 'МЧ', fixed: false, stock: true,
    hint: 'Лист під довжину ската: крок хвилі, заборонені довжини.' },
  { key: 'profile',      label: 'Профнастил',                  short: 'ПН', fixed: false, stock: true,
    hint: 'Лист під довжину ската з округленням до кроку різання.' },
  { key: 'falts',        label: 'Клік-фальц',                  short: 'КФ', fixed: false, stock: false,
    hint: 'Картини з вертикальним нахлестом і розбіжкою стиків.' },
  { key: 'siding',       label: 'Металевий сайдинг',           short: 'МС', fixed: false, stock: false,
    hint: 'Фасадні панелі, ріжуться під висоту стіни.' },
  { key: 'sandwich',     label: 'Сендвіч-панелі',              short: 'СП', fixed: false, stock: false,
    hint: 'Панелі під розмір, з округленням до кроку заводу.' },
  // старі типи — тільки для раніше збережених розрахунків
  { key: 'tile_module',  label: 'Одномодульна металочерепиця', short: 'ОМ', fixed: true,  stock: false, hidden: true, hint: '' },
  { key: 'sheet',        label: 'Листові (ондулін, шифер)',     short: 'ЛМ', fixed: true,  stock: false, hidden: true, hint: '' },
  { key: 'natural_tile', label: 'Натуральна черепиця',         short: 'НЧ', fixed: true,  stock: false, hidden: true, hint: '' },
];

export const materialLabel = (t: string) => MATERIAL_TYPES.find(m => m.key === t)?.label ?? t;
export const isFixedType = (t: string) => !!MATERIAL_TYPES.find(m => m.key === t)?.fixed;
export const supportsStock = (t: string) => !!MATERIAL_TYPES.find(m => m.key === t)?.stock;
