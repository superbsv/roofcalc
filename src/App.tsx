// App.tsx — ArtBudTrading Roof Calculator
import React, { useState, useEffect } from 'react';
import './styles/global.css';
import { AuthProvider, useAuth, LoginPage } from './components/auth/AuthContext';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage  from './pages/ProjectPage';
import AdminPage    from './pages/AdminPage';
import ProductsPage from './pages/ProductsPage';

type Page =
  | { type: 'projects' }
  | { type: 'project'; id: number }
  | { type: 'products'; category?: 'tile' | 'profile' | 'falts' }
  | { type: 'clients' }
  | { type: 'users' }
  | { type: 'settings' };

function Shell() {
  const { user, logout, loading } = useAuth();
  const [page, setPage] = useState<Page>({ type: 'projects' });
  const [productsOpen, setProductsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Закриваємо сайдбар при зміні сторінки
  const navigate = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  // Закриваємо сайдбар при ресайзі на десктоп
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 768) setSidebarOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>
      Завантаження…
    </div>
  );

  if (!user) return <LoginPage />;

  const initials = user.name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase();
  const roleLabel: Record<string,string> = {
    admin:'Адміністратор', manager:'Менеджер', dealer:'Дилер',
    production:'Виробництво', viewer:'Перегляд',
  };

  const navItem = (label: string, icon: React.ReactNode, active: boolean, onClick: () => void) => (
    <div className={`sidebar-item${active?' active':''}`} onClick={onClick}>
      {icon}
      {label}
    </div>
  );

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
        {/* Бургер — тільки мобільний */}
        <button className="burger-btn" onClick={() => setSidebarOpen(v => !v)} aria-label="Меню">
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {sidebarOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            }
          </svg>
        </button>

        <a href="/" className="header-logo" onClick={e => { e.preventDefault(); navigate({type:'projects'}); }}>
          <div className="header-logo-icon">🏠</div>
          <span>ArtBudTrading</span>
        </a>

        <nav className="header-nav">
          <a href="/" className={page.type==='projects'?'active':''} onClick={e=>{e.preventDefault();navigate({type:'projects'});}}>
            Проекти
          </a>
          {page.type==='project' && (
            <a href="/" className="active" onClick={e=>e.preventDefault()}>← Поточний проект</a>
          )}
        </nav>

        <div className="header-right">
          <div className="header-user">
            <div className="header-avatar">{initials}</div>
            <div>
              <div style={{fontWeight:500,fontSize:'.8rem'}}>{user.name}</div>
              <div style={{fontSize:'.7rem',opacity:.7}}>{roleLabel[user.role]}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{color:'rgba(255,255,255,.7)'}} onClick={logout}>
            Вийти
          </button>
        </div>
      </header>

      {/* Overlay для закриття сайдбару */}
      <div
        className={`sidebar-overlay${sidebarOpen?' open':''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen?' open':''}`}>

        <div className="sidebar-section">
          <div className="sidebar-title">Навігація</div>
          {navItem('Мої проекти',
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/>
            </svg>,
            page.type==='projects',
            () => navigate({type:'projects'})
          )}
        </div>

        {page.type==='project' && (
          <div className="sidebar-section">
            <div className="sidebar-title">Проект</div>
            <div className="sidebar-item active">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
              </svg>
              Скати та розрахунок
            </div>
          </div>
        )}

        {user.role === 'admin' && (
          <div className="sidebar-section">
            <div className="sidebar-title">Адмін</div>

            <div
              className={`sidebar-item${page.type==='products'?' active':''}`}
              onClick={() => { setProductsOpen(!productsOpen); navigate({type:'products'}); }}
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
              </svg>
              Продукція
              <span style={{marginLeft:'auto',fontSize:'.7rem'}}>{productsOpen?'▲':'▼'}</span>
            </div>

            {productsOpen && (
              <div style={{paddingLeft:'16px'}}>
                {[
                  {cat:'tile' as const,   label:'🏠 Металочерепиця'},
                  {cat:'profile' as const,label:'📋 Профнастил'},
                  {cat:'falts' as const,  label:'🔧 Фальцева покрівля'},
                ].map(({cat, label}) => (
                  <div
                    key={cat}
                    className={`sidebar-item${page.type==='products'&&(page as any).category===cat?' active':''}`}
                    onClick={() => navigate({type:'products', category:cat})}
                    style={{fontSize:'.85rem'}}
                  >
                    {label}
                  </div>
                ))}
              </div>
            )}

            {navItem('Клієнти',
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
              </svg>,
              page.type==='clients',
              () => navigate({type:'clients'})
            )}

            {navItem('Користувачі',
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
              </svg>,
              page.type==='users',
              () => navigate({type:'users'})
            )}

            {navItem('Налаштування',
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>,
              page.type==='settings',
              () => navigate({type:'settings'})
            )}
          </div>
        )}

        <div style={{marginTop:'auto',padding:'16px 12px',borderTop:'1px solid var(--clr-border)',fontSize:'.7rem',color:'var(--clr-text-3)'}}>
          <div style={{marginBottom:'4px',fontWeight:500,color:'var(--clr-text-2)'}}>ArtBudTrading</div>
          <div>Калькулятор покрівлі v1.0</div>
          <a href="https://artbudtrading.com.ua" target="_blank" rel="noopener noreferrer"
            style={{color:'var(--clr-brand)',fontSize:'.7rem'}}>
            artbudtrading.com.ua
          </a>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {page.type==='projects' && <ProjectsPage onOpenProject={id => navigate({type:'project', id})} />}
        {page.type==='project' && <ProjectPage projectId={page.id} />}
        {page.type==='products' && <ProductsPage category={(page as any).category} />}
        {page.type==='users' && <AdminPage />}
        {page.type==='clients' && (
          <div style={{padding:'32px'}}>
            <h2>Клієнти</h2>
            <p style={{color:'var(--clr-text-3)'}}>Розділ в розробці</p>
          </div>
        )}
        {page.type==='settings' && <AdminPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
