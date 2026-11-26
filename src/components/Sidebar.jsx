import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Car,
  FileText,
  DollarSign,
  MessageSquareText,
  ClipboardCheck,
  Settings,
  ShieldAlert,
  LogOut,
  ShieldCheck,
  X,
  Sparkles,
} from 'lucide-react';

const MENU_GROUPS = [
  {
    title: 'Operação Diária',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/cobrancas', label: 'Cobranças', icon: DollarSign, badgeKey: 'cobrancasAtrasadas', badgeTone: 'red' },
      { path: '/veiculos', label: 'Veículos & Frota', icon: Car },
    ],
  },
  {
    title: 'Gestão de Contratos',
    items: [
      { path: '/locatarios', label: 'Locatários', icon: Users },
      { path: '/contratos', label: 'Contratos', icon: FileText },
      { path: '/triagem', label: 'Triagem & Candidatos', icon: ClipboardCheck, badgeKey: 'candidatosPendentes', badgeTone: 'amber' },
    ],
  },
  {
    title: 'Comunicação & Segurança',
    items: [
      { path: '/mensagens', label: 'Mensagens WhatsApp', icon: MessageSquareText },
      { path: '/acessos', label: 'Controle de Acessos', icon: ShieldCheck },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { path: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

const Sidebar = ({ isOpen, toggleSidebar, counts = {} }) => {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const getBadge = (item) => {
    if (!item.badgeKey) return null;
    const value = counts[item.badgeKey];
    if (!value || value <= 0) return null;

    if (item.badgeTone === 'red') {
      return (
        <span className="ml-auto inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-400">
          {value} atrasadas
        </span>
      );
    }

    if (item.badgeTone === 'amber') {
      return (
        <span className="ml-auto inline-flex items-center rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
          {value} novos
        </span>
      );
    }

    return (
      <span className="ml-auto inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
        {value}
      </span>
    );
  };

  return (
    <aside
      className={`apple-dark-sidebar fixed inset-y-0 left-0 z-50 w-64 sm:w-72 transform bg-[#0b0b0c] text-white transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:inset-0 shrink-0
    `}
    >
      <div className="flex h-full flex-col border-r border-white/10">
        {/* Topo do Menu / Identidade */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0066cc] text-white font-bold text-sm tracking-tight shadow-sm shadow-[#0066cc]/40">
              SGA
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-white leading-tight">
                {profile?.empresa_nome || 'Painel SGA'}
              </h3>
              <p className="text-[11px] font-medium text-slate-400">Gestão de Locações</p>
            </div>
          </div>
          <button
            onClick={toggleSidebar}
            className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navegação Agrupada */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {!isAdmin && MENU_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {group.title}
              </div>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={() => window.innerWidth < 768 && toggleSidebar()}
                      className={({ isActive }) => `
                        flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2 text-sm transition-all
                        ${
                          isActive
                            ? 'bg-[#0066cc] text-white font-medium shadow-sm shadow-[#0066cc]/30'
                            : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }
                      `}
                    >
                      <item.icon size={19} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {getBadge(item)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Seção Exclusiva para Admin */}
          {isAdmin && (
            <div className="pt-2">
              <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
                Administração Global
              </div>
              <NavLink
                to="/admin"
                onClick={() => window.innerWidth < 768 && toggleSidebar()}
                className={({ isActive }) => `
                  flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-amber-300 transition-colors hover:bg-white/10
                  ${isActive ? 'bg-amber-400/15 text-amber-200' : ''}
                `}
              >
                <ShieldAlert size={19} className="shrink-0 text-amber-300" />
                <span className="font-medium truncate">Painel Admin</span>
              </NavLink>
            </div>
          )}
        </nav>

        {/* Rodapé com Perfil do Locador */}
        <div className="border-t border-white/10 bg-white/[0.03] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white font-semibold text-xs shrink-0">
                {(profile?.nome_completo || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col overflow-hidden min-w-0">
                <span className="truncate text-sm font-medium text-white">
                  {profile?.nome_completo || 'Locador'}
                </span>
                <span className="truncate text-[11px] text-slate-400">{profile?.email}</span>
              </div>
            </div>
            <button
              onClick={signOut}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:text-red-300 hover:bg-red-400/10 transition shrink-0"
              title="Sair do sistema"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
