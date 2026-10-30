import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Link as LinkIcon,
  DollarSign,
  Car,
  Users,
  FileText,
  Check,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { candidatosService } from '../services/candidatos';

export default function QuickActionsMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyApplicationLink = async () => {
    setCopyingLink(true);
    try {
      const statusRes = await candidatosService.getApplicationLinkStatus();
      let url = statusRes?.link?.url;

      if (!url || !statusRes?.link?.ativo) {
        // Se não tiver link ativo, gera um novo automaticamente
        const newLinkRes = await candidatosService.createApplicationLink();
        url = newLinkRes?.url;
      }

      if (url) {
        await navigator.clipboard.writeText(url);
        setCopiedSuccess(true);
        toast.success('Link de inscrição copiado para a área de transferência!');
        setTimeout(() => setCopiedSuccess(false), 2000);
      } else {
        toast.info('Acesse a tela de Triagem para configurar seu link.');
        navigate('/triagem');
      }
    } catch (err) {
      toast.error('Erro ao obter link de inscrição: ' + (err.message || 'tente novamente.'));
    } finally {
      setCopyingLink(false);
      setIsOpen(false);
    }
  };

  const handleNavigate = (path) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-[#0066cc] px-4 py-2 text-xs sm:text-sm font-medium text-white transition hover:bg-[#005ab4] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0071e3]"
        aria-expanded={isOpen}
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Ação Rápida</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-black/10 bg-white py-2 text-[#1d1d1f] shadow-xl z-50 animate-fade-in">
          <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#7a7a7a]">
            Ações Frequentes
          </div>

          {/* Copiar Link de Inscrição */}
          <button
            onClick={handleCopyApplicationLink}
            disabled={copyingLink}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-black/5 disabled:opacity-50"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-[#0066cc] shrink-0">
              {copyingLink ? (
                <Loader2 size={16} className="animate-spin" />
              ) : copiedSuccess ? (
                <Check size={16} className="text-emerald-600" />
              ) : (
                <LinkIcon size={16} />
              )}
            </div>
            <div className="truncate">
              <p className="font-medium text-[#1d1d1f] truncate">Copiar Link Inscrição</p>
              <p className="text-xs text-[#7a7a7a]">Para enviar no WhatsApp</p>
            </div>
          </button>

          <div className="my-1 border-t border-black/5" />

          {/* Nova Cobrança */}
          <button
            onClick={() => handleNavigate('/cobrancas')}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-black/5"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 shrink-0">
              <DollarSign size={16} />
            </div>
            <div>
              <p className="font-medium text-[#1d1d1f]">Nova Cobrança / PIX</p>
              <p className="text-xs text-[#7a7a7a]">Gerar cobrança ou recibo</p>
            </div>
          </button>

          {/* Novo Veículo */}
          <button
            onClick={() => handleNavigate('/veiculos')}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-black/5"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700 shrink-0">
              <Car size={16} />
            </div>
            <div>
              <p className="font-medium text-[#1d1d1f]">Cadastrar Veículo</p>
              <p className="text-xs text-[#7a7a7a]">Adicionar moto/carro à frota</p>
            </div>
          </button>

          {/* Novo Locatário */}
          <button
            onClick={() => handleNavigate('/locatarios')}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-black/5"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 shrink-0">
              <Users size={16} />
            </div>
            <div>
              <p className="font-medium text-[#1d1d1f]">Novo Locatário</p>
              <p className="text-xs text-[#7a7a7a]">Cadastrar motorista</p>
            </div>
          </button>

          {/* Novo Contrato */}
          <button
            onClick={() => handleNavigate('/contratos')}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-black/5"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-50 text-purple-700 shrink-0">
              <FileText size={16} />
            </div>
            <div>
              <p className="font-medium text-[#1d1d1f]">Novo Contrato</p>
              <p className="text-xs text-[#7a7a7a]">Vincular locatário e veículo</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
