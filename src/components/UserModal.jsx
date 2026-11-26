import React, { useState, useEffect } from 'react';
import { X, Loader2, User, Key, Shield, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getSegmentPresetList } from '../utils/segmentConfig';
import { usuariosService } from '../services/usuarios';
import { toast } from 'react-toastify';
import { formatWhatsAppToAPI } from '../utils/formatters';

const UserModal = ({ isOpen, onClose, onSuccess, userToEdit = null }) => {
  const { profile } = useAuth();
  const isSelf = Boolean(userToEdit?.id && profile?.id && userToEdit.id === profile.id);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nome_completo: '',
    email: '',
    whatsapp: '',
    role: 'locatario',
    segmento: 'geral',
    ativo: true,
    password: ''
  });

  useEffect(() => {
    if (userToEdit) {
      setFormData({
        nome_completo: userToEdit.nome_completo || '',
        email: userToEdit.email || '',
        whatsapp: userToEdit.whatsapp || '',
        role: userToEdit.role || 'locatario',
        segmento: userToEdit.segmento || 'geral',
        ativo: Boolean(userToEdit.ativo),
        password: ''
      });
    } else {
      setFormData({ 
        nome_completo: '', 
        email: '', 
        whatsapp: '', 
        role: 'locatario', 
        segmento: 'geral',
        ativo: true, 
        password: ''
      });
    }
  }, [userToEdit, isOpen]);

  const handleWhatsAppBlur = () => {
    const formatted = formatWhatsAppToAPI(formData.whatsapp);
    setFormData(prev => ({ ...prev, whatsapp: formatted }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const cleanWhatsApp = formatWhatsAppToAPI(formData.whatsapp);
    
    try {
      if (userToEdit?.id) {
        await usuariosService.adminUpdate(userToEdit.id, {
          nome_completo: formData.nome_completo,
          whatsapp: cleanWhatsApp,
          role: formData.role,
          segmento: formData.segmento,
          ativo: Boolean(formData.ativo),
        });
        toast.success("Perfil atualizado!");
      } else {
        if (formData.password.length < 6) {
          throw new Error("A senha deve ter pelo menos 6 caracteres.");
        }

        await usuariosService.createUserAdmin(formData, cleanWhatsApp);
        toast.success('Acesso criado com sucesso!');
      }

      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error.message || "Erro na operação");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-xl border border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <User className="text-accent" size={20} />
            {userToEdit ? 'Editar Usuário' : 'Novo Usuário'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome Completo</label>
            <input
              required
              className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
              value={formData.nome_completo}
              onChange={e => setFormData({...formData, nome_completo: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">E-mail</label>
              <input
                type="email"
                required
                disabled={!!userToEdit}
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none disabled:opacity-50 font-mono text-sm"
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                <Smartphone size={12} /> WhatsApp
              </label>
              <input
                placeholder="DDD + Número"
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none font-mono text-sm"
                value={formData.whatsapp}
                onChange={e => setFormData({...formData, whatsapp: e.target.value})}
                onBlur={handleWhatsAppBlur}
              />
            </div>
          </div>

          {!userToEdit && (
            <div className="bg-indigo-500/5 p-3 rounded-lg border border-indigo-500/10">
              <label className="block text-xs font-bold text-indigo-400 uppercase mb-1 flex items-center gap-1">
                <Key size={12} /> Senha de Acesso
              </label>
              <input
                type="password"
                required={!userToEdit}
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none font-mono"
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de Usuário</label>
            <select
              disabled={isSelf}
              className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              value={formData.role}
              onChange={e => setFormData({...formData, role: e.target.value})}
            >
              <option value="locatario">Cliente / Final (Locatário)</option>
              <option value="locador">Operador / Empresa (Locador)</option>
              <option value="admin">Administrador do Sistema</option>
            </select>
            {isSelf && (
              <p className="mt-1 text-[11px] text-slate-500">Você não pode alterar o seu próprio tipo de usuário.</p>
            )}
          </div>

          {formData.role === 'locador' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Segmento de Atuação</label>
              <select
                className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                value={formData.segmento}
                onChange={e => setFormData({ ...formData, segmento: e.target.value })}
              >
                {getSegmentPresetList().map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="user-active"
              disabled={isSelf}
              className="w-4 h-4 rounded bg-input border-slate-600 text-accent focus:ring-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              checked={formData.ativo}
              onChange={e => setFormData({...formData, ativo: e.target.checked})}
            />
            <label htmlFor="user-active" className={`text-sm text-slate-300 font-medium ${isSelf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
              Conta Ativa{isSelf ? ' (não é possível desativar a própria conta)' : ''}
            </label>
          </div>

          <div className="flex justify-end gap-3 mt-8">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white">Cancelar</button>
            <button
              type="submit"
              disabled={loading}
              className="bg-accent hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/20"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Shield size={18}/>}
              {userToEdit ? 'Salvar Perfil' : 'Criar Acesso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
