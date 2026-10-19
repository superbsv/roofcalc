// BrandMark.tsx — пласка версія знака ROOFKIT для інтерфейсу (брендбук v1.0, розділ 02):
// геометрична покрівля — срібляста ліва площина, помаранчева права, темний трикутник під ними.
// Відмальовано за затвердженим 3D-знаком; 3D-версія — лише для промо.
import React from 'react';

const SILVER = 'var(--rk-silver)';
const ORANGE = 'var(--clr-brand)';
const SHADE  = 'var(--rk-mark-shade)';

/** Знак без напису. size — ширина в px (висота ~0.42 ширини). */
export default function BrandMark({ size = 30 }: { size?: number }) {
  const h = Math.round(size * 52 / 126);
  return (
    <svg width={size} height={h} viewBox="0 0 126 52" aria-hidden="true" focusable="false">
      <polygon points="0,50 48,2 76,2 28,50" fill={SILVER} />
      <polygon points="40,50 64,26 80,42 80,50" fill={SHADE} />
      <polygon points="65,16 78,3 125,50 96,50" fill={ORANGE} />
    </svg>
  );
}

/** Напис ROOF (сріблястий) + KIT (помаранчевий). */
export function BrandWordmark({ size = 1 }: { size?: number; sub?: string }) {
  return (
    <span className="rk-word" style={{ fontSize: `${size}rem` }}>
      <span style={{ color: SILVER }}>ROOF</span><span style={{ color: ORANGE }}>KIT</span>
    </span>
  );
}

/** Знак + напис в один рядок (шапка, сторінки входу). */
export function BrandLogo({ size = 30, text = 1.05 }: { size?: number; text?: number }) {
  return (
    <span className="rk-logo" aria-label="ROOFKIT">
      <BrandMark size={size} />
      <BrandWordmark size={text} />
    </span>
  );
}
