import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Pencil, Trash2, Search, MapPin,
  Phone, Mail, ToggleLeft, ToggleRight, X,
  UserCheck, ShieldAlert, MessageSquare, CalendarClock
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';
import { useTenants } from '../hooks/useTenants';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal, ModalBody, ModalFooter } from '../components/ui/Modal';
import { Input, Select } from '../components/ui/Input';
import { Table, Thead, Tbody, Th, Td, LoadingRow } from '../components/ui/Table';
import { SearchInput } from '../components/ui/SearchInput';
import { SectionHeader } from '../components/ui/SectionHeader';
import MessageSelectorModal from '../components/MessageSelectorModal';
import AgendamentoModal from '../components/AgendamentoModal';

const maskCPF = (v) => v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})/, '$1-$2').replace(/(-\d{2})\d+?$/, '$1');

const maskCNPJ = (v) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').replace(/(-\d{2})\d+?$/, '$1');

const maskCEP = (v) => v.replace(/\D/g, '').replace(/(\d{5})(\d)/, '$1-$2').replace(/(-\d{3})\d+?$/, '$1');

const validarCPF = (cpf) => {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i]) * (10 - i);
  let digito1 = (soma * 10) % 11;
  if (digito1 === 10) digito1 = 0;
  if (digito1 !== parseInt(c[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i]) * (11 - i);
  let digito2 = (soma * 10) % 11;
  if (digito2 === 10) digito2 = 0;
  return digito2 === parseInt(c[10]);
};

const emptyForm = { nome_completo: '', whatsapp: '', email: '', documento: 'CPF', cpf: '', cep: '', rua: '', numero: '', bairro: '', cidade: '', estado: '', ativo: true };

const Locatarios = () => {
  const { profile } = useAuth();
  const { tenants, loading, create, update, toggleStatus, remove } = useTenants(profile?.id);

  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('nome_asc');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formData, setFormData] = useState({ ...emptyForm });

  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [selectedTenantForMessage, setSelectedTenantForMessage] = useState(null);
  const [isAgendamentoModalOpen, setIsAgendamentoModalOpen] = useState(false);
  const [selectedTenantForAgendamento, setSelectedTenantForAgendamento] = useState(null);

  const cepFetching = useRef(false);

  const filteredTenants = useMemo(() => {
    const list = tenants.filter(t =>
      t.nome_completo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.cpf?.includes(searchTerm.replace(/\D/g, ''))
    );

    return list.sort((a, b) => {
      if (sortOrder === 'nome_desc') {
        return (b.nome_completo || '').localeCompare(a.nome_completo || '', 'pt-BR');
      }
      if (sortOrder === 'recentes') {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      return (a.nome_completo || '').localeCompare(b.nome_completo || '', 'pt-BR');
    });
  }, [tenants, searchTerm, sortOrder]);

  useEffect(() => {
    const cleanCep = formData.cep.replace(/\D/g, '');
    if (cleanCep.length !== 8 || cepFetching.current) return;
    cepFetching.current = true;
    fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
      .then(res => res.json())
      .then(data => {
        if (!data.erro) {
          setFormData(prev => ({ ...prev, rua: data.logradouro, bairro: data.bairro, cidade: data.localidade, estado: data.uf }));
          setFieldErrors(prev => ({ ...prev, cep: null }));
        } else {
          setFieldErrors(prev => ({ ...prev, cep: 'CEP nao encontrado.' }));
        }
      })
      .catch(() => {
        setFieldErrors(prev => ({ ...prev, cep: 'Erro ao consultar CEP.' }));
      })
      .finally(() => { cepFetching.current = false; });
  }, [formData.cep]);

  const handleInputChange = (field, value) => {
    let masked = value;
    if (field === 'whatsapp') masked = value.replace(/\D/g, '');
    if (field === 'cpf') {
      masked = formData.documento === 'CPF' ? maskCPF(value) : maskCNPJ(value);
    }
    if (field === 'cep') masked = maskCEP(value);
    setFormData(prev => ({ ...prev, [field]: masked }));

    if (field === 'cpf' && formData.documento === 'CPF') {
      const cleanCpf = masked.replace(/\D/g, '');
      if (cleanCpf.length === 11) {
        setFieldErrors(prev => ({ ...prev, cpf: validarCPF(masked) ? null : 'CPF invalido.' }));
      } else if (cleanCpf.length < 11) {
        setFieldErrors(prev => ({ ...prev, cpf: null }));
      }
    } else if (fieldErrors[field]) {
      setFieldErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFieldErrors({});

    const errors = {};
    if (!formData.nome_completo.trim()) errors.nome_completo = 'Nome e obrigatorio.';
    const wppDigits = formData.whatsapp.replace(/\D/g, '');
    if (wppDigits.length < 10) errors.whatsapp = 'WhatsApp invalido. Minimo 10 digitos.';
    if (formData.documento === 'CPF' && !validarCPF(formData.cpf)) {
      errors.cpf = 'CPF invalido.';
    }
    const cleanCep = formData.cep.replace(/\D/g, '');
    if (cleanCep.length === 8 && !formData.rua.trim() && !formData.bairro.trim()) {
      errors.cep = 'CEP nao encontrado. Verifique o numero.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const dataToSave = {
      ...formData,
      id_usuario: profile.id,
      whatsapp: formData.whatsapp.replace(/\D/g, ''),
      cpf: formData.cpf.replace(/\D/g, ''),
      cep: formData.cep.replace(/\D/g, ''),
    };

    try {
      if (editingTenant) {
        await update(editingTenant.id, dataToSave);
      } else {
        await create(dataToSave);
      }
      setShowModal(false);
    } catch (err) {
      if (err.code === '23505') {
        if (err.message.includes('cpf')) setFieldErrors({ cpf: 'Documento já cadastrado para outro cliente.' });
        else if (err.message.includes('whatsapp')) setFieldErrors({ whatsapp: 'WhatsApp já cadastrado para outro cliente.' });
      } else {
        toast.error(err.message);
      }
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Excluir este locatário? Esta ação não pode ser desfeita.')) return;
    try {
      await remove(id);
    } catch (err) {
      if (err.code === '23503') {
        toast.error("Não é possível excluir: este locatário possui contratos vinculados.");
      } else {
        toast.error(err.message);
      }
    }
  };

  const openNew = () => {
    setEditingTenant(null);
    setFormData({ ...emptyForm });
    setFieldErrors({});
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditingTenant(item);
    setFormData(item);
    setFieldErrors({});
    setShowModal(true);
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        icon={UserCheck}
        title="Locatários"
        description="Gestão de clientes e cadastros."
        actions={<Button icon={Plus} onClick={openNew}>Novo Locatário</Button>}
      />

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Buscar por nome ou documento..." className="max-w-sm" />

          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 outline-none cursor-pointer focus:border-indigo-500"
            aria-label="Ordenar locatários"
          >
            <option value="nome_asc">Nome: A-Z (Alfabética)</option>
            <option value="nome_desc">Nome: Z-A</option>
            <option value="recentes">Mais recentes</option>
          </select>
        </div>

        <Table>
          <Thead>
            <tr>
              <Th>Locatário / Doc</Th>
              <Th>Contato Principal</Th>
              <Th>Localização</Th>
              <Th className="text-center">Status</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </Thead>
          <Tbody>
            {loading ? <LoadingRow colSpan={5} /> : filteredTenants.map(item => (
              <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors group">
                <Td>
                  <div className="font-bold text-zinc-100">{item.nome_completo}</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{item.cpf}</div>
                </Td>
                <Td>
                  <div className="flex items-center gap-2 text-zinc-400 font-mono text-xs"><Phone size={14} className="text-indigo-500" /> {item.whatsapp}</div>
                  <div className="flex items-center gap-2 text-zinc-500 text-[10px] mt-1"><Mail size={14} /> {item.email || 'N/A'}</div>
                </Td>
                <Td>
                  <div className="flex items-start gap-2 text-zinc-400 text-xs italic"><MapPin size={14} className="text-red-500 shrink-0" /> {item.cidade}/{item.estado}</div>
                </Td>
                <Td className="text-center">
                  <button onClick={() => toggleStatus(item.id, item.ativo)} className={item.ativo ? 'text-emerald-500' : 'text-zinc-600'}>
                    {item.ativo ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                  </button>
                </Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => { setSelectedTenantForMessage(item); setIsMessageModalOpen(true); }}
                      className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all" title="Enviar WhatsApp"><MessageSquare size={18} /></button>
                    <button onClick={() => { setSelectedTenantForAgendamento(item); setIsAgendamentoModalOpen(true); }}
                      className="p-2 text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all" title="Agendamentos"><CalendarClock size={18} /></button>
                    <button onClick={() => openEdit(item)} className="p-2 text-zinc-500 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-xl transition-all" title="Editar"><Pencil size={18} /></button>
                    <button onClick={() => handleDelete(item.id)} className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all" title="Excluir"><Trash2 size={18} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>

        <div className="md:hidden grid grid-cols-1 divide-y divide-zinc-800">
          {loading ? (
            <div className="p-10 text-center"><div className="animate-spin mx-auto text-indigo-500 w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" /></div>
          ) : filteredTenants.map(item => (
            <div key={item.id} className="p-5 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-black text-white uppercase text-sm tracking-tight">{item.nome_completo}</h4>
                  <p className="text-[10px] text-zinc-500 font-mono">{item.cpf}</p>
                </div>
                <button onClick={() => toggleStatus(item.id, item.ativo)} className={item.ativo ? 'text-emerald-500' : 'text-zinc-600'}>
                  {item.ativo ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 border-l-2 border-zinc-800 pl-3">
                <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold"><Phone size={12} className="text-emerald-500" /> {item.whatsapp}</div>
                <div className="flex items-center gap-2 text-zinc-500 text-[10px]"><MapPin size={12} className="text-red-500" /> {item.cidade}/{item.estado}</div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon={MessageSquare} onClick={() => { setSelectedTenantForMessage(item); setIsMessageModalOpen(true); }}>Mensagem</Button>
                  <Button variant="ghost" size="sm" icon={CalendarClock} onClick={() => { setSelectedTenantForAgendamento(item); setIsAgendamentoModalOpen(true); }}>Agenda</Button>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(item)} className="p-2.5 bg-indigo-500/10 text-indigo-500 rounded-xl"><Pencil size={18} /></button>
                  <button onClick={() => handleDelete(item.id)} className="p-2.5 bg-red-500/10 text-red-500 rounded-xl"><Trash2 size={18} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingTenant ? 'Editar Perfil' : 'Novo Cadastro'}
        size="max-w-2xl"
      >
        <form onSubmit={handleSave}>
          <ModalBody>
            <div className="space-y-5">
              <SectionHeader>Dados de Identificação</SectionHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="md:col-span-2">
                  <Input label="Nome Completo" required value={formData.nome_completo}
                    onChange={e => setFormData({ ...formData, nome_completo: e.target.value })} />
                </div>
                <Input label="WhatsApp" required placeholder="5511999999999"
                  value={formData.whatsapp} onChange={e => handleInputChange('whatsapp', e.target.value)}
                  error={fieldErrors.whatsapp} />
                <Input label="E-mail" type="email" placeholder="cliente@exemplo.com"
                  value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                <Select label="Tipo Doc." value={formData.documento}
                  onChange={e => setFormData({ ...formData, documento: e.target.value, cpf: '' })}>
                  <option value="CPF">Pessoa Física (CPF)</option>
                  <option value="CNPJ">Pessoa Jurídica (CNPJ)</option>
                </Select>
                <Input label={`Número do ${formData.documento}`} required
                  value={formData.cpf} onChange={e => handleInputChange('cpf', e.target.value)}
                  error={fieldErrors.cpf} />
              </div>
            </div>

            <div className="space-y-5">
              <SectionHeader>Localização</SectionHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                <Input label="CEP" placeholder="00000-000" value={formData.cep}
                  onChange={e => handleInputChange('cep', e.target.value)} error={fieldErrors.cep} />
                <div className="sm:col-span-1 md:col-span-2">
                  <Input label="Rua / Logradouro" required value={formData.rua}
                    onChange={e => setFormData({ ...formData, rua: e.target.value })} />
                </div>
                <Input label="Nº" required value={formData.numero}
                  onChange={e => setFormData({ ...formData, numero: e.target.value })} />
                <Input label="Bairro" required value={formData.bairro}
                  onChange={e => setFormData({ ...formData, bairro: e.target.value })} />
                <div className="sm:col-span-2 md:col-span-1 space-y-2">
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Cidade/UF</label>
                  <div className="flex gap-2">
                    <input required type="text" className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 outline-none focus:border-indigo-500"
                      value={formData.cidade} onChange={e => setFormData({ ...formData, cidade: e.target.value })} />
                    <input required type="text" maxLength={2} className="w-14 bg-zinc-950 border border-zinc-800 rounded-xl py-3 text-center text-zinc-100 uppercase outline-none focus:border-indigo-500 font-bold"
                      value={formData.estado} onChange={e => setFormData({ ...formData, estado: e.target.value.toUpperCase() })} />
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>DESCARTAR</Button>
            <Button type="submit">SALVAR DADOS</Button>
          </ModalFooter>
        </form>
      </Modal>

      <MessageSelectorModal
        isOpen={isMessageModalOpen}
        onClose={() => setIsMessageModalOpen(false)}
        locatario={selectedTenantForMessage}
        usuario={profile}
      />

      {isAgendamentoModalOpen && (
        <AgendamentoModal
          isOpen={isAgendamentoModalOpen}
          onClose={() => setIsAgendamentoModalOpen(false)}
          locatario={selectedTenantForAgendamento}
          usuario={profile}
          mode="locatario"
        />
      )}
    </div>
  );
};

export default Locatarios;
