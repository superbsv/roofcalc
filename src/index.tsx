import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTheme } from './components/theme/theme';
import { initI18n } from './i18n/i18n';
initTheme();
initI18n();
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
