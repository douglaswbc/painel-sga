import React, { useState, useEffect } from 'react';
import { X, Loader2, User, Key, Shield, Smartphone } from 'lucide-react';
import { supabase } from '../services/supabase';
import { toast } from 'react-toastify';
import { formatWhatsAppToAPI } from '../utils/formatters';

const UserModal = ({ isOpen, onClose, onSuccess, userToEdit = null }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    nome_completo: '',
    email: '',
    whatsapp: '',
    role: 'locatario',
    ativo: true,
    password: ''
  });

  useEffect(() => {
    if (userToEdit) {
      setFormData({
        ...userToEdit,
        password: ''
      });
    } else {
      setFormData({ 
        nome_completo: '', 
        email: '', 
        whatsapp: '', 
        role: 'locatario', 
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
        const { error: err } = await supabase.rpc('admin_update_usuario', {
          p_user_id: userToEdit.id,
          p_nome_completo: formData.nome_completo,
          p_whatsapp: cleanWhatsApp,
          p_role: formData.role,
          p_ativo: formData.ativo,
        });
        
        if (err) throw err;
        toast.success("Perfil atualizado!");
      } else {
        if (formData.password.length < 6) {
          throw new Error("A senha deve ter pelo menos 6 caracteres.");
        }

        const { data, error: funcError } = await supabase.functions.invoke('admin-create-user', {
          body: { ...formData, whatsapp: cleanWhatsApp }
        });

        if (funcError) throw funcError;
        if (data?.error) throw new Error(data.error);

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
              className="w-full bg-input border border-slate-600 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
              value={formData.role}
              onChange={e => setFormData({...formData, role: e.target.value})}
            >
              <option value="locatario">Locatário (Cliente)</option>
              <option value="locador">Locador (Dono de Frota)</option>
              <option value="admin">Administrador do Sistema</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="user-active"
              className="w-4 h-4 rounded bg-input border-slate-600 text-accent focus:ring-accent cursor-pointer"
              checked={formData.ativo}
              onChange={e => setFormData({...formData, ativo: e.target.checked})}
            />
            <label htmlFor="user-active" className="text-sm text-slate-300 font-medium cursor-pointer">Conta Ativa</label>
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
