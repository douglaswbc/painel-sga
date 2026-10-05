import React, { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';

const DashboardLayout = () => {
  const { user, loading } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="sga-app flex h-screen overflow-hidden bg-[#f5f5f7] text-[#1d1d1f]">
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-14 items-center border-b border-black/10 bg-[#f5f5f7]/85 px-4 backdrop-blur-xl sm:h-16 md:px-8">
          <button 
            className="mr-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-[#1d1d1f] transition hover:bg-black/5 active:scale-95 md:hidden"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label={isSidebarOpen ? 'Fechar menu' : 'Abrir menu'}
          >
            <Menu size={24} />
          </button>
          <h2 className="text-sm font-semibold tracking-tight text-[#1d1d1f] sm:text-base">Sistema de Gestão</h2>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 xl:p-8">
          <Outlet /> {/* Aqui serão renderizadas as páginas (Dashboard, Locatários, etc) */}
        </main>
      </div>

      {/* Overlay para mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default DashboardLayout;
