// materials.ts — типи матеріалів і режими розрахунку, як у «Кровля Профи»
import { MaterialProfile } from '../../api/client';

export type MaterialType = MaterialProfile['type'];

export const MATERIAL_TYPES: { key: MaterialType; label: string; short: string; hint: string; fixed: boolean; stock: boolean }[] = [
  { key: 'tile',         label: 'Металочерепиця',              short: 'МЧ', fixed: false, stock: true,
    hint: 'Лист під довжину ската: крок хвилі, заборонені довжини. Режими «на замовлення» і «зі складу».' },
  { key: 'tile_module',  label: 'Одномодульна металочерепиця', short: 'ОМ', fixed: true,  stock: false,
    hint: 'Модуль фіксованої довжини (тип «Метробонд»), не ріжеться по довжині.' },
  { key: 'profile',      label: 'Профнастил',                  short: 'ПН', fixed: false, stock: true,
    hint: 'Лист під довжину ската з округленням до кроку різання. Режими «на замовлення» і «зі складу».' },
  { key: 'sheet',        label: 'Листові (ондулін, шифер)',     short: 'ЛМ', fixed: true,  stock: false,
    hint: 'Лист фіксованого розміру, нахлести в обидва боки, рахуються цілі листи.' },
  { key: 'natural_tile', label: 'Натуральна черепиця',         short: 'НЧ', fixed: true,  stock: false,
    hint: 'Штучний розрахунок: ряди × штуки за покривними розмірами черепиці.' },
  { key: 'falts',        label: 'Фальцева покрівля',           short: 'ФП', fixed: false, stock: false,
    hint: 'Картини з вертикальним нахлестом і розбіжкою стиків.' },
];

export const materialLabel = (t: string) => MATERIAL_TYPES.find(m => m.key === t)?.label ?? t;
export const isFixedType = (t: string) => !!MATERIAL_TYPES.find(m => m.key === t)?.fixed;
export const supportsStock = (t: string) => !!MATERIAL_TYPES.find(m => m.key === t)?.stock;
