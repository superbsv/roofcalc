import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTheme } from './components/theme/theme';
import { initI18n } from './i18n/i18n';
import { initVersionCheck } from './versionCheck';
initTheme();
initI18n();
initVersionCheck();
// iPhone / iPad: Safari збільшує сторінку при натисканні на поле з дрібним шрифтом — і після цього
// вхід у кабінет (та інші форми) доводиться гортати вбік. maximum-scale=1 вимикає це автозбільшення;
// збільшувати двома пальцями на iOS усе одно можна. Android не чіпаємо.
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
