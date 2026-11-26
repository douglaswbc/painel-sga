import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getSegmentLabels } from '../utils/segmentConfig';
import { locatariosService } from '../services/locatarios';
import { veiculosService } from '../services/veiculos';
import { contratosService } from '../services/contratos';
import { toast } from 'react-toastify';

const saoPauloToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const recurrenceOption = (value) => {
  if (typeof value !== 'string') return 'mensal';
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('{')) {
    try {
      const config = JSON.parse(value);
      if (config.frequencia === 'weekly') return Number(config.intervalo) > 1 ? 'quinzenal' : 'semanal';
      if (config.frequencia === 'daily') return 'diaria';
      if (config.frequencia === 'yearly') return 'anual';
      return 'mensal';
    } catch { return 'mensal'; }
  }
  if (normalized.includes('quinzenal') || normalized.includes('biweekly')) return 'quinzenal';
  if (normalized.includes('semanal') || normalized.includes('weekly')) return 'semanal';
  if (normalized.includes('diari') || normalized.includes('daily')) return 'diaria';
  if (normalized.includes('anual') || normalized.includes('yearly')) return 'anual';
  return 'mensal';
};

const ContratoModal = ({ isOpen, onClose, onSuccess, contrato = null, userId }) => {
  const { profile } = useAuth();
  const labels = getSegmentLabels(profile);
  const [loading, setLoading] = useState(false);
  const [dataOptions, setDataOptions] = useState({ locatarios: [], veiculos: [] });
  const [formData, setFormData] = useState({
    id_locatario: '',
    id_veiculo: '',
    valor: '',
    recorrencia: 'semanal',
    data_inicio: saoPauloToday(),
    status: 'ativo'
  });

  // Carrega opções de seleção ao abrir o modal
  useEffect(() => {
    const fetchOptions = async () => {
      const [locs, veics] = await Promise.all([
        locatariosService.listSimple(userId, true),
        veiculosService.listSimple(userId),
      ]);
      setDataOptions({ locatarios: locs || [], veiculos: veics || [] });
    };

    if (isOpen) {
      fetchOptions();
      if (contrato) {
        setFormData({ ...contrato, recorrencia: recurrenceOption(contrato.recorrencia) });
      } else {
        setFormData({
          id_locatario: '', id_veiculo: '', valor: '',
          recorrencia: 'semanal', data_inicio: saoPauloToday(),
          status: 'ativo'
        });
      }
    }
  }, [isOpen, contrato, userId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const dueDate = new Date(`${formData.data_inicio}T12:00:00-03:00`);
      const dueWeekDay = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][dueDate.getUTCDay()];
      const biweekly = formData.recorrencia === 'quinzenal';
      let savedRecurrence = null;
      if (contrato && recurrenceOption(contrato.recorrencia) === formData.recorrencia && typeof contrato.recorrencia === 'string') {
        try {
          if (contrato.recorrencia.trim().startsWith('{')) savedRecurrence = JSON.parse(contrato.recorrencia);
        } catch { /* Rebuild malformed values below. */ }
      }
      const recurrence = savedRecurrence || {
        frequencia: ({ diaria: 'daily', semanal: 'weekly', quinzenal: 'weekly', mensal: 'monthly', anual: 'yearly' })[formData.recorrencia] || 'monthly',
        intervalo: biweekly ? 2 : 1,
        dias: [dueWeekDay],
        termina: { tipo: 'nunca', valor: null },
        expiracao: 4,
      };

      const payload = { 
        ...formData, 
        id_veiculo: formData.id_veiculo || null,
        id_usuario: userId, 
        valor: parseFloat(formData.valor),
        recorrencia: JSON.stringify(recurrence),
        // Editar valor/veículo/locatário não pode reiniciar a recorrência já avançada.
        proxima_cobranca: contrato && contrato.data_inicio === formData.data_inicio
          ? contrato.proxima_cobranca
          : dueDate.toISOString()
      };
      
      if (contrato?.id) {
        await contratosService.update(contrato.id, payload);
      } else {
        await contratosService.create(payload);
      }

      toast.success("Contrato salvo com sucesso!");
      onSuccess();
      onClose();
    } catch (error) {
      toast.error("Erro ao salvar contrato: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card w-full max-w-lg rounded-xl border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h3 className="text-xl font-bold text-white">{contrato ? 'Editar Contrato' : 'Novo Contrato'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">{labels.customerSingular}</label>
            <select 
              required
              className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none"
              value={formData.id_locatario}
              onChange={e => setFormData({...formData, id_locatario: e.target.value})}
            >
              <option value="">Selecionar {labels.customerSingular}</option>
              {dataOptions.locatarios.map(l => <option key={l.id} value={l.id}>{l.nome_completo}</option>)}
            </select>
          </div>

          {labels.usesItems && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">{labels.itemSingular} (opcional)</label>
              <select 
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none"
                value={formData.id_veiculo || ''}
                onChange={e => setFormData({...formData, id_veiculo: e.target.value})}
              >
                <option value="">Sem item vinculado (serviço / plano)</option>
                {dataOptions.veiculos.map(v => <option key={v.id} value={v.id}>{v.modelo} ({v.placa})</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Valor (R$)</label>
              <input 
                type="number" step="0.01" required
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none"
                value={formData.valor}
                onChange={e => setFormData({...formData, valor: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Recorrência</label>
              <select 
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none"
                value={formData.recorrencia}
                onChange={e => setFormData({...formData, recorrencia: e.target.value})}
              >
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
                <option value="mensal">Mensal</option>
                <option value="diaria">Diária</option>
                <option value="anual">Anual</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Data de Início</label>
            <input 
              type="date" required
              className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white outline-none"
              value={formData.data_inicio}
              onChange={e => setFormData({...formData, data_inicio: e.target.value})}
            />
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400">Cancelar</button>
            <button type="submit" disabled={loading} className="bg-accent text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2">
              {loading && <Loader2 className="animate-spin" size={18} />} Salvar Contrato
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ContratoModal;
