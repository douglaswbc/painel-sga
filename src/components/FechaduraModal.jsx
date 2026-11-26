import React, { useState, useEffect } from 'react';
import { X, Lock, Key, Save, ShieldCheck } from 'lucide-react';
import { fechadurasService } from '../services/fechaduras';
import { toast } from 'react-toastify';

const FechaduraModal = ({ isOpen, onClose, fechadura, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nome: '',
    identificador: '',
    status: 'ativo'
  });

  useEffect(() => {
    if (fechadura) {
      setFormData({
        nome: fechadura.nome,
        identificador: fechadura.identificador,
        status: fechadura.status || 'ativo'
      });
    } else {
      setFormData({ nome: '', identificador: '', status: 'ativo' });
    }
  }, [fechadura, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const dataToSave = {
        ...formData,
        identificador: formData.identificador.toLowerCase().trim().replace(/\s+/g, '-')
      };

      if (fechadura) {
        await fechadurasService.update(fechadura.id, dataToSave);
      } else {
        await fechadurasService.create(dataToSave);
      }

      toast.success(fechadura ? 'Fechadura atualizada!' : 'Nova fechadura cadastrada!');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" />
            {fechadura ? 'Editar Fechadura' : 'Nova Fechadura'}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-all">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Nome da Porta</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                <input
                  required
                  type="text"
                  placeholder="Ex: Entrada Principal, Garagem..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-zinc-100 outline-none focus:border-indigo-500 transition-all font-medium"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex justify-between">
                <span>Identificador Único</span>
                <span className="text-[9px] text-zinc-600 normal-case italic">Usado no comando "Abrir [ID]"</span>
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                <input
                  required
                  type="text"
                  placeholder="Ex: porta-01, bloco-a"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-zinc-100 outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                  value={formData.identificador}
                  onChange={(e) => setFormData({ ...formData, identificador: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Status</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 outline-none focus:border-indigo-500"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="ativo">Ativa / Operacional</option>
                <option value="inativo">Inativa / Bloqueada</option>
                <option value="manutencao">Em Manutenção</option>
              </select>
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 rounded-xl text-zinc-500 hover:text-white font-bold transition-all text-sm"
            >
              CANCELAR
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black rounded-xl shadow-lg shadow-indigo-600/20 py-3 transition-all flex items-center justify-center gap-2 text-xs tracking-widest uppercase"
            >
              {loading ? 'SALVANDO...' : (
                <>
                  <Save size={18} /> SALVAR
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FechaduraModal;
