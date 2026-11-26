import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { veiculosService } from '../services/veiculos';
import { toast } from 'react-toastify';

const VeiculoModal = ({ isOpen, onClose, onSuccess, veiculo = null, userId }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    placa: '',
    modelo: '',
    marca: '',
    cor: '',
    ano: '',
    ativo: true,
  });

  useEffect(() => {
    if (veiculo) {
      setFormData({
        ...veiculo,
        ano: veiculo.ano || '',
      });
    } else {
      setFormData({ placa: '', modelo: '', marca: '', cor: '', ano: '', ativo: true });
    }
  }, [veiculo, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { contratos, id, ...cleanData } = formData;

      const payload = {
        ...cleanData,
        id_usuario: userId,
        ano: formData.ano ? parseInt(formData.ano) : null,
      };

      if (veiculo?.id) {
        await veiculosService.update(veiculo.id, payload);
      } else {
        await veiculosService.create(payload);
      }

      toast.success(veiculo ? 'Veículo atualizado!' : 'Veículo cadastrado!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error('Erro ao salvar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white text-[#1d1d1f] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-black/10">
          <h3 className="text-lg font-semibold tracking-tight text-[#1d1d1f]">
            {veiculo ? 'Editar Veículo' : 'Novo Veículo'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f] transition"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#7a7a7a] mb-1.5">Placa *</label>
              <input
                required
                placeholder="ABC1D23"
                className="w-full bg-[#f5f5f7] border border-black/15 rounded-xl px-3.5 py-2.5 text-sm font-mono uppercase text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:border-[#0066cc] outline-none"
                value={formData.placa}
                onChange={(e) => setFormData({ ...formData, placa: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7a7a7a] mb-1.5">Ano</label>
              <input
                type="number"
                placeholder="Ex: 2024"
                className="w-full bg-[#f5f5f7] border border-black/15 rounded-xl px-3.5 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:border-[#0066cc] outline-none"
                value={formData.ano}
                onChange={(e) => setFormData({ ...formData, ano: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#7a7a7a] mb-1.5">Marca *</label>
              <input
                required
                placeholder="Ex: Honda, Yamaha"
                className="w-full bg-[#f5f5f7] border border-black/15 rounded-xl px-3.5 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:border-[#0066cc] outline-none"
                value={formData.marca}
                onChange={(e) => setFormData({ ...formData, marca: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#7a7a7a] mb-1.5">Modelo *</label>
              <input
                required
                placeholder="Ex: CG 160 Titan"
                className="w-full bg-[#f5f5f7] border border-black/15 rounded-xl px-3.5 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:border-[#0066cc] outline-none"
                value={formData.modelo}
                onChange={(e) => setFormData({ ...formData, modelo: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#7a7a7a] mb-1.5">Cor</label>
            <input
              placeholder="Ex: Preto, Vermelho"
              className="w-full bg-[#f5f5f7] border border-black/15 rounded-xl px-3.5 py-2.5 text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] focus:border-[#0066cc] outline-none"
              value={formData.cor}
              onChange={(e) => setFormData({ ...formData, cor: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2.5 pt-2">
            <input
              type="checkbox"
              id="ativo"
              className="w-4 h-4 rounded text-[#0066cc] focus:ring-[#0071e3] border-black/20"
              checked={formData.ativo}
              onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
            />
            <label htmlFor="ativo" className="text-sm font-medium text-[#1d1d1f] cursor-pointer">
              Veículo disponível / ativo na frota
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-black/10">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-medium text-[#7a7a7a] hover:bg-black/5 hover:text-[#1d1d1f] transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0066cc] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#005ab4] active:scale-95 disabled:opacity-50"
            >
              {loading && <Loader2 className="animate-spin" size={16} />}
              Salvar Veículo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VeiculoModal;