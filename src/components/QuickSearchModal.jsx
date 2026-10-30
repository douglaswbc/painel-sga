import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Car,
  Users,
  DollarSign,
  FileText,
  ClipboardCheck,
  MessageSquareText,
  Settings,
  ShieldCheck,
  LayoutDashboard,
  ExternalLink,
  X,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { supabase } from '../services/supabase';

const SYSTEM_PAGES = [
  { path: '/dashboard', label: 'Dashboard — Visão Geral', icon: LayoutDashboard, category: 'Páginas' },
  { path: '/cobrancas', label: 'Cobranças — PIX e Vencimentos', icon: DollarSign, category: 'Páginas' },
  { path: '/veiculos', label: 'Veículos — Frota e Disponibilidade', icon: Car, category: 'Páginas' },
  { path: '/locatarios', label: 'Locatários — Cadastro e Motoristas', icon: Users, category: 'Páginas' },
  { path: '/contratos', label: 'Contratos — Locações Ativas', icon: FileText, category: 'Páginas' },
  { path: '/triagem', label: 'Triagem — Candidatos e Inscrições', icon: ClipboardCheck, category: 'Páginas' },
  { path: '/mensagens', label: 'Mensagens — Templates e Disparos Meta', icon: MessageSquareText, category: 'Páginas' },
  { path: '/acessos', label: 'Controle de Acessos — Fechaduras', icon: ShieldCheck, category: 'Páginas' },
  { path: '/configuracoes', label: 'Configurações — Zernio, Meta e MP', icon: Settings, category: 'Páginas' },
];

export default function QuickSearchModal({ isOpen, onClose, userId }) {
  const [query, setQuery] = useState('');
  const [tenants, setTenants] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTenants([]);
      setVehicles([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const searchData = useCallback(async (term) => {
    if (!term || term.trim().length < 2 || !userId) {
      setTenants([]);
      setVehicles([]);
      return;
    }

    setLoading(true);
    const cleanTerm = term.trim();
    try {
      const [tenantsRes, vehiclesRes] = await Promise.all([
        supabase
          .from('locatarios_safe')
          .select('id, nome_completo, whatsapp, cpf')
          .eq('id_usuario', userId)
          .ilike('nome_completo', `%${cleanTerm}%`)
          .limit(5),
        supabase
          .from('veiculos')
          .select('id, placa, modelo, marca, ativo')
          .eq('id_usuario', userId)
          .or(`placa.ilike.%${cleanTerm}%,modelo.ilike.%${cleanTerm}%`)
          .limit(5),
      ]);

      const sortedTenants = (tenantsRes.data || []).sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || '', 'pt-BR'));
      const sortedVehicles = (vehiclesRes.data || []).sort((a, b) => (a.modelo || '').localeCompare(b.modelo || '', 'pt-BR'));
      setTenants(sortedTenants);
      setVehicles(sortedVehicles);
    } catch (err) {
      console.warn('Erro na busca rápida:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchData(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, searchData]);

  if (!isOpen) return null;

  const filteredPages = query.trim()
    ? SYSTEM_PAGES.filter(
        (p) =>
          p.label.toLowerCase().includes(query.toLowerCase()) ||
          p.path.toLowerCase().includes(query.toLowerCase())
      )
    : SYSTEM_PAGES.slice(0, 4);

  const handleSelectPage = (path) => {
    navigate(path);
    onClose();
  };

  const handleSelectTenant = (_tenant) => {
    navigate('/locatarios');
    onClose();
  };

  const handleSelectVehicle = (_vehicle) => {
    navigate('/veiculos');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 sm:pt-24 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-xl rounded-2xl border border-black/10 bg-white text-[#1d1d1f] shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra de Pesquisa */}
        <div className="flex items-center gap-3 border-b border-black/10 px-4 py-3 sm:px-5 sm:py-4">
          <Search size={20} className="text-[#0066cc] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar locatário, placa, contrato ou página..."
            className="w-full bg-transparent text-base font-normal text-[#1d1d1f] placeholder:text-[#7a7a7a] outline-none"
          />
          {loading && <Loader2 size={18} className="animate-spin text-[#7a7a7a] shrink-0" />}
          {query && !loading && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f]"
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="hidden sm:inline-flex rounded border border-black/15 px-2 py-0.5 text-xs text-[#7a7a7a] hover:bg-black/5"
          >
            ESC
          </button>
        </div>

        {/* Resultados */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
          {/* Locatários Encontrados */}
          {tenants.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-[#7a7a7a]">
                Locatários
              </div>
              <ul className="space-y-1">
                {tenants.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => handleSelectTenant(t)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-[#0066cc]/5 hover:text-[#0066cc] group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-[#0066cc] shrink-0">
                          <Users size={16} />
                        </div>
                        <div className="truncate">
                          <p className="font-medium text-[#1d1d1f] group-hover:text-[#0066cc] truncate">
                            {t.nome_completo}
                          </p>
                          {t.whatsapp && (
                            <p className="text-xs text-[#7a7a7a]">WhatsApp: {t.whatsapp}</p>
                          )}
                        </div>
                      </div>
                      <ArrowRight size={16} className="text-[#7a7a7a] opacity-0 group-hover:opacity-100 transition" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Veículos Encontrados */}
          {vehicles.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-[#7a7a7a]">
                Veículos
              </div>
              <ul className="space-y-1">
                {vehicles.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => handleSelectVehicle(v)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-[#0066cc]/5 hover:text-[#0066cc] group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 shrink-0">
                          <Car size={16} />
                        </div>
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-[#1d1d1f] group-hover:text-[#0066cc]">
                              {v.placa}
                            </span>
                            <span className="text-xs text-[#7a7a7a]">{v.modelo}</span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight size={16} className="text-[#7a7a7a] opacity-0 group-hover:opacity-100 transition" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Atalhos de Páginas */}
          <div>
            <div className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wider text-[#7a7a7a]">
              {query.trim() ? 'Páginas Correspondentes' : 'Navegação Rápida'}
            </div>
            <ul className="space-y-1">
              {filteredPages.map((page) => (
                <li key={page.path}>
                  <button
                    onClick={() => handleSelectPage(page.path)}
                    className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-black/5 group"
                  >
                    <div className="flex items-center gap-3">
                      <page.icon size={18} className="text-[#0066cc] shrink-0" />
                      <span className="font-normal text-[#1d1d1f]">{page.label}</span>
                    </div>
                    <ArrowRight size={15} className="text-[#7a7a7a] opacity-0 group-hover:opacity-100 transition" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {query.trim().length >= 2 && !loading && tenants.length === 0 && vehicles.length === 0 && filteredPages.length === 0 && (
            <div className="py-8 text-center text-sm text-[#7a7a7a]">
              Nenhum resultado encontrado para "{query}".
            </div>
          )}
        </div>

        {/* Rodapé informativo */}
        <div className="border-t border-black/10 bg-[#fafafc] px-4 py-2.5 text-xs text-[#7a7a7a] flex items-center justify-between">
          <span>Dica: Use <strong>Ctrl + K</strong> para abrir esta busca de qualquer tela.</span>
          <button onClick={onClose} className="text-[#0066cc] font-medium hover:underline">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
