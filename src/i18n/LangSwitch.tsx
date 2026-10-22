// Перемикач мови UA / RU / EN
import React, { useEffect, useState } from 'react';
import { LANGS, Lang, getLang, setLang, onLangChange } from './i18n';

export default function LangSwitch({ className = '' }: { className?: string }) {
  const [cur, setCur] = useState<Lang>(getLang());
  useEffect(() => onLangChange(setCur), []);
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Мова / Language" data-no-i18n>
      {LANGS.map(l => (
        <button key={l.code} type="button" className={cur === l.code ? 'on' : ''} title={l.name}
          aria-pressed={cur === l.code} onClick={() => setLang(l.code)}>{l.label}</button>
      ))}
    </div>
  );
}
