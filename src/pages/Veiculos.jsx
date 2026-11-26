import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { veiculosService } from '../services/veiculos';
import { useAuth } from '../contexts/AuthContext';
import { getSegmentLabels } from '../utils/segmentConfig';
import { Plus, Edit, Trash2, Search, Loader2, Car, Package, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import { PageHeader } from '../components/ui/PageHeader';
import VeiculoModal from '../components/VeiculoModal';

const Veiculos = () => {
  const { profile } = useAuth();
  const labels = getSegmentLabels(profile);
  const ItemIcon = labels.isVehicles ? Car : Package;
  const statusTabs = useMemo(
    () => [
      { id: 'todos', label: 'Todos' },
      { id: 'disponivel', label: 'Disponíveis' },
      { id: 'alugado', label: labels.rentedStatusLabel },
      { id: 'inativo', label: labels.inactiveStatusLabel },
    ],
    [labels.rentedStatusLabel, labels.inactiveStatusLabel],
  );
  const [veiculos, setVeiculos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [sortOrder, setSortOrder] = useState('modelo_asc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVeiculo, setSelectedVeiculo] = useState(null);

  const fetchVeiculos = useCallback(async () => {
    if (!profile?.id) return;
    try {
      setLoading(true);
      const data = await veiculosService.list(profile.id);
      setVeiculos(data || []);
    } catch {
      toast.error(`Erro ao carregar ${labels.itemPlural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, labels.itemPlural]);

  useEffect(() => {
    fetchVeiculos();
  }, [fetchVeiculos]);

  const handleDelete = async (id, modelo, placa) => {
    if (!window.confirm(`Remover ${labels.itemSingular.toLowerCase()} ${modelo} (${placa})? Certifique-se de que não haja contratos ativos.`)) return;

    try {
      await veiculosService.remove(id);
      toast.success(`${labels.itemSingular} removido com sucesso!`);
      fetchVeiculos();
    } catch (error) {
      toast.error(error?.message || 'Erro ao excluir: este item pode estar vinculado a contratos existentes.');
    }
  };

  const getVehicleStatus = useCallback((v) => {
    if (!v.ativo) {
      return {
        id: 'inativo',
        label: labels.inactiveStatusLabel,
        badgeClass: 'bg-red-50 text-red-700 border-red-200',
      };
    }
    const hasActiveContract = v.contratos?.some((c) => c.status === 'ativo');
    if (hasActiveContract) {
      return {
        id: 'alugado',
        label: labels.rentedStatusLabel,
        badgeClass: 'bg-blue-50 text-[#0066cc] border-blue-200',
      };
    }
    return {
      id: 'disponivel',
      label: 'Disponível',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }, [labels.inactiveStatusLabel, labels.rentedStatusLabel]);

  // Contagens para as abas
  const statusCounts = useMemo(() => {
    const counts = { todos: veiculos.length, disponivel: 0, alugado: 0, inativo: 0 };
    veiculos.forEach((v) => {
      const status = getVehicleStatus(v).id;
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [veiculos, getVehicleStatus]);

  const filteredVeiculos = useMemo(() => {
    const list = veiculos.filter((v) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        v.modelo.toLowerCase().includes(q) ||
        v.placa.toLowerCase().includes(q) ||
        (v.marca && v.marca.toLowerCase().includes(q)) ||
        (v.categoria && v.categoria.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (statusFilter === 'todos') return true;
      const status = getVehicleStatus(v).id;
      return status === statusFilter;
    });

    return list.sort((a, b) => {
      if (sortOrder === 'modelo_desc') {
        return (b.modelo || '').localeCompare(a.modelo || '', 'pt-BR');
      }
      if (sortOrder === 'placa_asc') {
        return (a.placa || '').localeCompare(b.placa || '', 'pt-BR');
      }
      return (a.modelo || '').localeCompare(b.modelo || '', 'pt-BR');
    });
  }, [veiculos, searchTerm, statusFilter, sortOrder, getVehicleStatus]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ItemIcon}
        title={labels.itemPlural}
        description={`${veiculos.length} registro(s) em ${labels.itemPlural.toLowerCase()}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchVeiculos}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-black/15 bg-white px-3.5 text-sm font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95 disabled:opacity-50"
              title="Atualizar lista"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              onClick={() => {
                setSelectedVeiculo(null);
                setIsModalOpen(true);
              }}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0066cc] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#005ab4] active:scale-95"
            >
              <Plus size={18} /> Cadastrar {labels.itemSingular}
            </button>
          </div>
        }
      />

      {/* Abas de Status Operacional e Busca */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Abas */}
        <div className="flex flex-wrap gap-1.5 p-1 rounded-full bg-[#f5f5f7] border border-black/5 w-fit">
          {statusTabs.map((tab) => {
            const count = statusCounts[tab.id] || 0;
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs sm:text-sm font-medium transition ${
                  active
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#7a7a7a] hover:text-[#1d1d1f]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                    active
                      ? 'bg-[#0066cc]/10 text-[#0066cc]'
                      : 'bg-black/5 text-[#7a7a7a]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Busca e Ordenação */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" />
            <input
              type="text"
              placeholder={`Buscar ${labels.itemCodeLabel.toLowerCase()}, ${labels.itemNameLabel.toLowerCase()}, categoria...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-full border border-black/15 bg-white py-2 pl-9 pr-4 text-xs sm:text-sm text-[#1d1d1f] placeholder:text-[#7a7a7a] outline-none focus:border-[#0066cc]"
            />
          </div>

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="rounded-full border border-black/15 bg-white px-3.5 py-2 text-xs sm:text-sm text-[#1d1d1f] outline-none cursor-pointer focus:border-[#0066cc]"
            aria-label={`Ordenar ${labels.itemPlural.toLowerCase()}`}
          >
            <option value="modelo_asc">{labels.itemNameLabel} (A-Z)</option>
            <option value="modelo_desc">{labels.itemNameLabel} (Z-A)</option>
            <option value="placa_asc">{labels.itemCodeLabel} (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Container Principal */}
      <div className="rounded-[18px] border border-black/10 bg-white overflow-hidden shadow-none">
        {/* Tabela Desktop */}
        <div className="hidden md:block overflow-x-auto">
          {loading ? (
            <div className="p-16 flex flex-col items-center justify-center gap-2 text-[#7a7a7a]">
              <Loader2 className="animate-spin text-[#0066cc]" size={32} />
              <p className="text-xs">Carregando {labels.itemPlural.toLowerCase()}...</p>
            </div>
          ) : filteredVeiculos.length === 0 ? (
            <div className="p-16 text-center text-[#7a7a7a] space-y-2">
              <ItemIcon size={36} className="mx-auto text-[#7a7a7a]/50" />
              <p className="font-medium text-[#1d1d1f]">Nenhum registro encontrado</p>
              <p className="text-xs text-[#7a7a7a]">
                {searchTerm || statusFilter !== 'todos'
                  ? 'Tente ajustar os filtros ou termo de busca.'
                  : `Cadastre seu primeiro item em ${labels.itemPlural.toLowerCase()} para começar.`}
              </p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-[#fafafc] border-b border-black/5">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">{labels.itemSingular}</th>
                  <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">{labels.itemCodeLabel}</th>
                  <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">{labels.itemMeta1Label} / {labels.itemMeta2Label}</th>
                  <th className="px-5 py-3 text-xs font-semibold text-[#7a7a7a]">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-semibold text-[#7a7a7a]">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {filteredVeiculos.map((v) => {
                  const statusInfo = getVehicleStatus(v);
                  return (
                    <tr key={v.id} className="transition hover:bg-black/[0.015] group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0066cc] shrink-0">
                            <ItemIcon size={18} />
                          </div>
                          <div>
                            <div className="font-semibold text-[#1d1d1f]">{v.modelo}</div>
                            <div className="text-xs text-[#7a7a7a] uppercase">
                              {[v.categoria, v.marca].filter(Boolean).join(' · ') || 'Sem categoria'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-block rounded-md border border-black/15 bg-[#f5f5f7] px-2.5 py-1 font-mono text-xs font-bold text-[#1d1d1f] uppercase tracking-wider">
                          {v.placa}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[#7a7a7a]">
                        <div className="font-medium text-[#1d1d1f]">{v.cor || v.descricao || '-'}</div>
                        <div>{v.ano ? `${labels.itemMeta2Label}: ${v.ano}` : '-'}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${statusInfo.badgeClass}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right space-x-1">
                        <button
                          onClick={() => {
                            setSelectedVeiculo(v);
                            setIsModalOpen(true);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#7a7a7a] hover:bg-black/5 hover:text-[#0066cc] transition"
                          title={`Editar ${labels.itemSingular.toLowerCase()}`}
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(v.id, v.modelo, v.placa)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#7a7a7a] hover:bg-red-50 hover:text-red-600 transition"
                          title={`Remover ${labels.itemSingular.toLowerCase()}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Cards Mobile */}
        <div className="md:hidden divide-y divide-black/5">
          {loading ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-[#7a7a7a]">
              <Loader2 className="animate-spin text-[#0066cc]" size={28} />
              <p className="text-xs">Carregando {labels.itemPlural.toLowerCase()}...</p>
            </div>
          ) : filteredVeiculos.length === 0 ? (
            <div className="p-12 text-center text-[#7a7a7a]">
              <ItemIcon size={32} className="mx-auto text-[#7a7a7a]/50 mb-2" />
              <p className="font-medium text-[#1d1d1f] text-sm">Nenhum registro encontrado</p>
            </div>
          ) : (
            filteredVeiculos.map((v) => {
              const statusInfo = getVehicleStatus(v);
              return (
                <div key={v.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0066cc] shrink-0">
                        <ItemIcon size={18} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm text-[#1d1d1f]">{v.modelo}</h4>
                        <p className="text-xs text-[#7a7a7a] uppercase">
                          {[v.categoria, v.marca].filter(Boolean).join(' · ') || 'Sem categoria'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${statusInfo.badgeClass}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-[#f5f5f7] p-2.5">
                    <span className="font-mono text-sm font-bold text-[#1d1d1f] tracking-wider uppercase">
                      {v.placa}
                    </span>
                    <span className="text-xs text-[#7a7a7a]">
                      {v.cor || v.descricao || '-'} {v.ano ? `· ${v.ano}` : ''}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => {
                        setSelectedVeiculo(v);
                        setIsModalOpen(true);
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-black/15 bg-white py-2 text-xs font-medium text-[#1d1d1f] hover:bg-black/5 active:scale-95"
                    >
                      <Edit size={14} /> Editar
                    </button>
                    <button
                      onClick={() => handleDelete(v.id, v.modelo, v.placa)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-600 hover:bg-red-50 active:scale-95"
                      title="Excluir"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <VeiculoModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchVeiculos}
        veiculo={selectedVeiculo}
        userId={profile?.id}
      />
    </div>
  );
};

export default Veiculos;