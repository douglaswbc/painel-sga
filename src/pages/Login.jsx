import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { toast } from 'react-toastify';
import { Mail, Lock, Loader2 } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');
  const destination = redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
    ? redirectTo
    : '/dashboard';

  // Verifica se o usuário já está logado ao carregar a página
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate(destination, { replace: true });
    };
    checkUser();
  }, [destination, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Autenticação no Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw new Error("E-mail ou senha inválidos.");

      // 2. Verificação de status na tabela 'usuarios'
      const { data: profile, error: profileError } = await supabase
        .from('usuarios')
        .select('ativo')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile.ativo) {
        await supabase.auth.signOut();
        throw new Error("Usuário inativo. Entre em contato com o suporte.");
      }

      toast.success("Login realizado com sucesso!");
      navigate(destination, { replace: true });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-4 sm:p-6">
      <section className="w-full max-w-md rounded-[18px] border border-black/10 bg-white p-6 sm:p-8">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#0066cc] text-white"><span className="text-lg font-semibold">SGA</span></div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-[#1d1d1f]">Acessar painel</h1>
          <p className="text-sm leading-5 text-[#7a7a7a]">Bem-vindo de volta. Entre para continuar.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" size={18} aria-hidden="true" />
            <label htmlFor="login-email" className="sr-only">E-mail</label>
            <input
              id="login-email"
              type="email"
              placeholder="Seu e-mail"
              autoComplete="username"
              className="min-h-12 w-full rounded-lg border border-[#e0e0e0] bg-white py-3 pl-11 pr-4 text-sm text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0066cc]/15"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a7a7a]" size={18} aria-hidden="true" />
            <label htmlFor="login-password" className="sr-only">Senha</label>
            <input
              id="login-password"
              type="password"
              placeholder="Sua senha"
              autoComplete="current-password"
              className="min-h-12 w-full rounded-lg border border-[#e0e0e0] bg-white py-3 pl-11 pr-4 text-sm text-[#1d1d1f] outline-none transition placeholder:text-[#7a7a7a] focus:border-[#0066cc] focus:ring-2 focus:ring-[#0066cc]/15"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0066cc] px-6 py-3 text-[17px] font-normal text-white transition-transform hover:bg-[#005ab4] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071e3] disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
};

export default Login;
