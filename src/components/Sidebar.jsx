import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, Users, Car, FileText, 
  DollarSign, MessageSquareText, ClipboardCheck, 
  Settings, ShieldAlert, LogOut, ShieldCheck
} from 'lucide-react';

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const { profile, signOut } = useAuth();

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/locatarios', label: 'Locatários', icon: Users },
    { path: '/veiculos', label: 'Veículos', icon: Car },
    { path: '/contratos', label: 'Contratos', icon: FileText },
    { path: '/cobrancas', label: 'Cobranças', icon: DollarSign },
    { path: '/mensagens', label: 'Mensagens', icon: MessageSquareText },
    { path: '/triagem', label: 'Triagem', icon: ClipboardCheck },
    { path: '/configuracoes', label: 'Configurações', icon: Settings },
    { path: '/acessos', label: 'Controle de Acessos', icon: ShieldCheck },
  ];

  return (
    <aside className={`apple-dark-sidebar fixed inset-y-0 left-0 z-50 w-64 transform bg-black text-white transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:inset-0
    `}>
      <div className="flex h-full flex-col border-r border-white/10">
        <div className="border-b border-white/10 px-5 py-5">
          <h3 className="text-lg font-semibold tracking-tight text-white">Painel SGA</h3>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {menuItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => window.innerWidth < 768 && toggleSidebar()}
                  className={({ isActive }) => `
                    flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-colors
                    ${isActive ? 'bg-[#0066cc] text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'}
                  `}
                >
                  <item.icon size={20} />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              </li>
            ))}

            {profile?.role === 'admin' && (
              <li className="mt-4 border-t border-white/10 pt-4">
                <NavLink
                  to="/admin"
                  className={({ isActive }) => `
                    flex min-h-11 items-center gap-3 rounded-full px-4 py-2.5 text-sm text-amber-300 transition-colors hover:bg-white/10
                    ${isActive ? 'bg-white/10' : ''}
                  `}
                >
                  <ShieldAlert size={20} /> {/* Atualizado aqui também */}
                  <span className="font-medium">Painel Admin</span>
                </NavLink>
              </li>
            )}
          </ul>
        </nav>

        <div className="border-t border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-sm font-semibold text-white">{profile?.nome_completo || 'Usuário'}</span>
              <span className="truncate text-xs text-slate-400">{profile?.email}</span>
            </div>
            <button 
              onClick={signOut}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-red-300 transition-colors hover:bg-red-400/10"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
