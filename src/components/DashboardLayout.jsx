import React, { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import QuickSearchModal from './QuickSearchModal';
import QuickActionsMenu from './QuickActionsMenu';
import MetaAlertBanner from './MetaAlertBanner';
import { useNavCounts } from '../hooks/useNavCounts';
import { Menu, Search, Command } from 'lucide-react';

const PAGE_TITLES = {
  '/dashboard': 'Dashboard',
  '/cobrancas': 'Cobranças & PIX',
  '/veiculos': 'Veículos & Frota',
  '/locatarios': 'Locatários',
  '/contratos': 'Contratos',
  '/triagem': 'Triagem de Candidatos',
  '/mensagens': 'Mensagens WhatsApp',
  '/acessos': 'Controle de Acessos',
  '/configuracoes': 'Configurações',
  '/admin': 'Painel Admin',
};

const DashboardLayout = () => {
  const { user, profile, loading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const location = useLocation();

  const { counts } = useNavCounts(user?.id);

  // Escuta atalho Ctrl+K ou Cmd+K para abrir busca rápida
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const currentTitle = PAGE_TITLES[location.pathname] || 'Painel SGA';

  return (
    <div className="sga-app flex h-screen overflow-hidden bg-[#f5f5f7] text-[#1d1d1f]">
      {/* Sidebar Desktop e Drawer Mobile */}
      <Sidebar
        isOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        counts={counts}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar Otimizada */}
        <header className="sticky top-0 z-30 flex h-14 sm:h-16 items-center justify-between border-b border-black/10 bg-[#f5f5f7]/90 px-4 backdrop-blur-xl md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#1d1d1f] transition hover:bg-black/5 active:scale-95 md:hidden"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label={isSidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            >
              <Menu size={22} />
            </button>
            <div className="truncate">
              <h2 className="text-base sm:text-lg font-semibold tracking-tight text-[#1d1d1f] truncate">
                {currentTitle}
              </h2>
            </div>
          </div>

          {/* Área Central: Busca Rápida (Desktop e Tablet) */}
          <div className="hidden sm:flex flex-1 max-w-md mx-4">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="w-full flex items-center justify-between gap-2 rounded-full border border-black/10 bg-white px-4 py-2 text-xs sm:text-sm text-[#7a7a7a] shadow-none transition hover:border-black/20 hover:text-[#1d1d1f]"
            >
              <div className="flex items-center gap-2 truncate">
                <Search size={16} className="text-[#0066cc] shrink-0" />
                <span className="truncate">Buscar locatário, placa, página...</span>
              </div>
              <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-black/15 bg-[#f5f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#7a7a7a]">
                <Command size={10} /> K
              </kbd>
            </button>
          </div>

          {/* Área Direita: Botão de Busca Mobile + Ações Rápidas */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Ícone de busca em telas muito pequenas */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-full text-[#1d1d1f] hover:bg-black/5 transition"
              aria-label="Buscar"
            >
              <Search size={20} />
            </button>

            {/* Menu Dropdown de Ações Rápidas */}
            <QuickActionsMenu />

            {/* Avatar / Perfil rápido */}
            <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-black/10">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0066cc]/10 text-[#0066cc] font-semibold text-xs">
                {(profile?.nome_completo || 'L').charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-[#1d1d1f] max-w-[120px] truncate">
                {profile?.nome_completo?.split(' ')[0] || 'Locador'}
              </span>
            </div>
          </div>
        </header>

        {/* Conteúdo Principal com compensação para a Bottom Nav no mobile */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 xl:p-8 pb-24 md:pb-8">
          <div className="mx-auto mb-4 max-w-7xl">
            <MetaAlertBanner enabled={profile?.role === 'locador'} />
          </div>
          <Outlet />
        </main>
      </div>

      {/* Barra de Navegação Inferior (Mobile Only) */}
      <BottomNav
        onOpenMenu={() => setIsSidebarOpen(true)}
        onOpenQuickActions={() => setIsSearchOpen(true)}
        counts={counts}
      />

      {/* Modal de Busca Rápida / Command Palette */}
      <QuickSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        userId={user?.id}
      />

      {/* Overlay escuro para quando a Sidebar estiver aberta no mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden animate-fade-in"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default DashboardLayout;
