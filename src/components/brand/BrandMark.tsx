// BrandMark.tsx — тимчасовий знак ABT (діагональ + помаранчевий елемент).
// ЗАМІНИТИ на офіційний SVG із пакета брендбука 01_Logo, коли він буде в репозиторії.
import React from 'react';

export default function BrandMark({ size = 30 }: { size?: number }) {
  const h = Math.round(size * 26 / 30);
  return (
    <svg width={size} height={h} viewBox="0 0 30 26" aria-hidden="true">
      <polygon points="0,26 15,0 23,0 8,26" fill="var(--abt-silver)" />
      <polygon points="16,26 16,14 24,6 24,26" fill="var(--abt-orange)" />
    </svg>
  );
}

export function BrandWordmark({ sub = 'ПОКРІВЛЯ' }: { sub?: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', letterSpacing: '.04em' }}>ABT</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '.6rem', letterSpacing: '.24em', color: 'var(--clr-text-3)' }}>{sub}</span>
    </span>
  );
}
