import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Car,
  CreditCard,
  FileText,
  MessageSquare,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';

const features = [
  {
    icon: Users,
    title: 'Gestão de locatários',
    description: 'Cadastros organizados, validação de documentos e histórico de atividade em um só lugar.',
  },
  {
    icon: Car,
    title: 'Controle de frota',
    description: 'Acompanhe veículos, disponibilidade e vínculos com contratos ativos.',
  },
  {
    icon: FileText,
    title: 'Contratos recorrentes',
    description: 'Configure ciclos, horários de cobrança e geração automática de faturas.',
  },
  {
    icon: CreditCard,
    title: 'Cobranças por PIX',
    description: 'Gere cobranças com Mercado Pago e acompanhe pagamentos no painel.',
  },
  {
    icon: MessageSquare,
    title: 'WhatsApp oficial',
    description: 'Conecte o canal pela Zernio e envie templates aprovados pela Meta.',
  },
  {
    icon: ShieldCheck,
    title: 'Acesso e auditoria',
    description: 'Gerencie permissões e consulte os registros das principais operações.',
  },
];

const Landing = () => (
  <div className="min-h-screen bg-white text-[#1d1d1f] antialiased">
    <header className="sticky top-0 z-40 border-b border-black/10 bg-white/85 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Navegação principal">
        <Link to="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight sm:text-lg">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0066cc] text-white"><Zap size={17} aria-hidden="true" /></span>
          Painel SGA
        </Link>
        <div className="flex items-center gap-3 sm:gap-6">
          <a href="#features" className="hidden text-sm text-[#333333] transition hover:text-[#0066cc] sm:inline">Funcionalidades</a>
          <a href="#technology" className="hidden text-sm text-[#333333] transition hover:text-[#0066cc] sm:inline">Tecnologia</a>
          <Link to="/login" className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#0066cc] px-5 text-sm font-normal text-white transition-transform hover:bg-[#005ab4] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0071e3]">
            Acessar sistema
          </Link>
        </div>
      </nav>
    </header>

    <main>
      <section className="bg-[#f5f5f7] px-5 py-20 text-center sm:py-28 lg:py-32">
        <div className="mx-auto max-w-4xl">
          <p className="mb-5 text-sm font-semibold text-[#0066cc]">Gestão de frotas e contratos</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-[-0.03em] text-[#1d1d1f] sm:text-5xl lg:text-[56px] lg:leading-[1.07]">
            Mais clareza para cuidar do seu negócio de aluguel.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 tracking-[-0.01em] text-[#555559] sm:text-[17px] sm:leading-[1.47]">
            Organize locatários, veículos, contratos e cobranças em um painel integrado, com automações pelo WhatsApp.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/login" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[#0066cc] px-6 text-[17px] font-normal text-white transition-transform hover:bg-[#005ab4] active:scale-95 sm:w-auto">
              Começar agora <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a href="#features" className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#0066cc] px-6 text-[17px] text-[#0066cc] transition-colors hover:bg-blue-50 sm:w-auto">
              Conhecer recursos
            </a>
          </div>
        </div>
      </section>

      <section id="features" className="scroll-mt-16 bg-white px-5 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-9 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight text-[#1d1d1f] sm:text-[34px]">Tudo conectado à sua operação.</h2>
            <p className="mt-3 text-base leading-7 text-[#66666a] sm:text-[17px]">As rotinas principais da locação ficam organizadas em um único fluxo.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-[18px] border border-[#e0e0e0] bg-[#fafafc] p-5 sm:p-6">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-[#0066cc]">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-[#1d1d1f]">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#66666a]">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="technology" className="scroll-mt-14 bg-[#272729] px-5 py-14 text-white sm:py-16">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-sm font-semibold text-[#2997ff]">Tecnologia integrada</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Uma base confiável para a sua rotina.</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            {['React', 'Tailwind CSS', 'Node.js · SQLite', 'Mercado Pago', 'Zernio · WhatsApp API oficial'].map((technology) => (
              <span key={technology} className="rounded-full border border-white/15 px-4 py-2 text-sm text-[#cccccc]">{technology}</span>
            ))}
          </div>
        </div>
      </section>
    </main>

    <footer className="bg-[#f5f5f7] px-5 py-8 text-sm text-[#66666a]">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 Painel SGA. Todos os direitos reservados.</span>
        <span>Desenvolvido por Douglas Cuimar</span>
      </div>
    </footer>
  </div>
);

export default Landing;
