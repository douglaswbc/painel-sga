import React from 'react';
import { Link } from 'react-router-dom';
import { 
  Users, 
  Car, 
  FileText, 
  CreditCard, 
  MessageSquare, 
  ShieldCheck,
  ChevronRight,
  ArrowRight,
  Zap
} from 'lucide-react';

const Landing = () => {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white selection:bg-blue-500/30">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-[#0f172a]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
                Painel SGA
              </span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">Funcionalidades</a>
              <a href="#tech" className="text-sm text-gray-400 hover:text-white transition-colors">Tecnologia</a>
              <Link to="/login" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-500/20">
                Acessar Sistema
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-8 animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            Gestão inteligente de frotas e contratos
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight animate-slide-up">
            Controle total do seu <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500">
              Negócio de Aluguel
            </span>
          </h1>
          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up [animation-delay:200ms]">
            Sistema completo para gestão de frotas, contratos e cobrança automatizada via WhatsApp. 
            Desenvolvido para oferecer controle financeiro total.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up [animation-delay:400ms]">
            <Link to="/login" className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-all hover:shadow-2xl hover:shadow-blue-500/40">
              Começar Agora <ArrowRight className="w-5 h-5" />
            </Link>
            <a href="#features" className="w-full sm:w-auto px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-semibold transition-all">
              Ver Funcionalidades
            </a>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-[#0d121f]">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Soluções Completas</h2>
            <p className="text-gray-400">Tudo o que você precisa para escalar sua gestão</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard 
              icon={<Users className="w-6 h-6 text-blue-400" />}
              title="Gestão de Locatários"
              description="Cadastro completo com integração ViaCEP, validação de documentos e histórico de atividade."
            />
            <FeatureCard 
              icon={<Car className="w-6 h-6 text-indigo-400" />}
              title="Controle de Frota"
              description="Gerenciamento eficiente de veículos com status em tempo real e vínculos de contratos."
            />
            <FeatureCard 
              icon={<FileText className="w-6 h-6 text-cyan-400" />}
              title="Contratos Inteligentes"
              description="Configuração de cobrança com recorrência flexível (semanal ou diária) automatizada."
            />
            <FeatureCard 
              icon={<CreditCard className="w-6 h-6 text-emerald-400" />}
              title="Pagamentos via PIX"
              description="Geração automática de QR Code e Copia-e-Cola integrado ao Mercado Pago."
            />
            <FeatureCard 
              icon={<MessageSquare className="w-6 h-6 text-purple-400" />}
              title="Régua de WhatsApp"
              description="Disparo automático de lembretes e notificações inteligentes para seus clientes."
            />
            <FeatureCard 
              icon={<ShieldCheck className="w-6 h-6 text-rose-400" />}
              title="Segurança & Auditoria"
              description="Controle de acessos detalhado e logs de atividades para total transparência."
            />
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section id="tech" className="py-24 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-12 text-gray-300">Tecnologias de Ponta</h2>
          <div className="flex flex-wrap justify-center gap-8 md:gap-16 opacity-50 grayscale hover:grayscale-0 transition-all">
            <TechItem label="React 19" />
            <TechItem label="Tailwind CSS" />
            <TechItem label="Supabase" />
            <TechItem label="Mercado Pago" />
            <TechItem label="Zernio · WhatsApp API oficial" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 text-gray-400">
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">© 2026 Painel SGA. Todos os direitos reservados.</span>
          </div>
          <div className="flex gap-6 text-sm text-gray-500">
            <span>Desenvolvido para Emove Entregas</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }) => (
  <div className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-all hover:-translate-y-1 group">
    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-gray-400 leading-relaxed text-sm">
      {description}
    </p>
  </div>
);

const TechItem = ({ label }) => (
  <span className="text-lg font-semibold tracking-wider text-white whitespace-nowrap">{label}</span>
);

export default Landing;
