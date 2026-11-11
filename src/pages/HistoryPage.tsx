// Сторінка «Історія дій»: усі зміни в кабінеті (проекти, скати, клієнти, каталог, налаштування, заявки)
import React from 'react';
import HistoryList from '../components/history/HistoryList';
import { useAuth } from '../components/auth/AuthContext';

export default function HistoryPage() {
  const { user } = useAuth();
  return (
    <div className="hist-page">
      <div className="page-header">
        <div><h1 className="page-title">Історія дій</h1>
          <p className="text-muted">{user?.role === 'admin' ? 'Дії всіх користувачів кабінету' : 'Ваші дії'} · будь-яку можна скасувати</p></div>
      </div>
      <div className="card hist-card"><HistoryList chips /></div>
    </div>
  );
}
