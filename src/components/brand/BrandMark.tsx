// BrandMark.tsx — логотип ROOFKIT (затверджений SVG: public/roofkit-logo.svg).
// Знак — сталева ліва площина, темний трикутник, помаранчева права площина; напис ROOF — сталь, KIT — помаранч.
import React, { useId } from 'react';

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}steel`} x1="0" y1="0" x2="0.8" y2="1"><stop stopColor="#F5F8FC" /><stop offset=".35" stopColor="#9EAFBF" /><stop offset=".7" stopColor="#415268" /><stop offset="1" stopColor="#192635" /></linearGradient>
      <linearGradient id={`${id}dark`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#738397" /><stop offset=".45" stopColor="#344255" /><stop offset="1" stopColor="#15212E" /></linearGradient>
      <linearGradient id={`${id}orange`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#FFDC82" /><stop offset=".3" stopColor="#FF9A26" /><stop offset=".7" stopColor="#F36A0A" /><stop offset="1" stopColor="#A93B04" /></linearGradient>
      <linearGradient id={`${id}silverText`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#FFFFFF" /><stop offset=".4" stopColor="#D7E0E9" /><stop offset="1" stopColor="#65778B" /></linearGradient>
      <linearGradient id={`${id}orangeText`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#FFD26D" /><stop offset=".5" stopColor="#FF901C" /><stop offset="1" stopColor="#DF5806" /></linearGradient>
    </defs>
  );
}

function MarkPaths({ id }: { id: string }) {
  return (
    <g strokeLinejoin="round">
      <path d="M235 412 L575 75 Q591 59 607 75 L700 169 L451 416 L235 416 Z" fill={`url(#${id}steel)`} stroke="#AEBECC" strokeWidth="4" />
      <path d="M480 416 L681 215 Q693 203 706 215 L873 412 Z" fill={`url(#${id}dark)`} stroke="#8A9AAB" strokeWidth="4" />
      <path d="M607 75 Q621 62 636 78 L1164 413 L950 413 L700 169 Z" fill={`url(#${id}orange)`} stroke="#FFB54C" strokeWidth="4" />
      <path d="M700 169 L950 413 L1164 413 L829 258 Z" fill="#D64C04" opacity=".35" />
    </g>
  );
}

/** Знак без напису. size — ширина в px. */
export default function BrandMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const h = Math.round(size * 372 / 944);
  return (
    <svg width={size} height={h} viewBox="226 52 944 372" aria-hidden="true" focusable="false">
      <Defs id={id} />
      <MarkPaths id={id} />
    </svg>
  );
}

/** Напис ROOF (сталь) + KIT (помаранч). */
export function BrandWordmark({ size = 1 }: { size?: number; sub?: string }) {
  return (
    <span className="rk-word" style={{ fontSize: `${size}rem` }}>
      <span className="rk-roof">ROOF</span><span className="rk-kit">KIT</span>
    </span>
  );
}

/** Знак + напис в один рядок (шапка). */
export function BrandLogo({ size = 30, text = 1.05 }: { size?: number; text?: number }) {
  return (
    <span className="rk-logo" aria-label="ROOFKIT">
      <BrandMark size={size} />
      <BrandWordmark size={text} />
    </span>
  );
}

/** Повний логотип (знак над написом), як у затвердженому SVG. width — ширина в px. */
export function BrandLogoFull({ width = 220 }: { width?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={width} height={Math.round(width * 600 / 1300)} viewBox="60 50 1300 600" className="rk-full" role="img" aria-label="ROOFKIT">
      <Defs id={id} />
      <MarkPaths id={id} />
      <g fontFamily="Montserrat, Arial, Helvetica, sans-serif" fontWeight="900" fontSize="190" letterSpacing="-9">
        <text x="85" y="640" fill={`url(#${id}silverText)`} stroke="#B5C3D1" strokeWidth="1.5">ROOF</text>
        <text x="782" y="640" fill={`url(#${id}orangeText)`} stroke="#FF9B35" strokeWidth="1.5">KIT</text>
      </g>
    </svg>
  );
}
