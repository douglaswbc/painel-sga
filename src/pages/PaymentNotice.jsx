import React from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, MessageCircle, XCircle } from 'lucide-react';

const notices = {
  pago: {
    icon: CheckCircle2,
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    title: 'Pagamento já confirmado',
    message: 'Esta cobrança já foi registrada como paga. Se você pagou mais de uma vez, fale com o locador para conferir um possível reembolso.',
  },
  expirado: {
    icon: Clock3,
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    title: 'Link expirado',
    message: 'O código PIX deste link expirou. Responda a mensagem recebida no WhatsApp para o locador gerar um novo link de pagamento.',
  },
  cancelado: {
    icon: XCircle,
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    title: 'Cobrança cancelada',
    message: 'Esta cobrança foi cancelada pelo locador. Se você ainda precisa pagar, solicite uma nova cobrança pelo WhatsApp.',
  },
  indisponivel: {
    icon: AlertTriangle,
    tone: 'border-amber-200 bg-amber-50 text-amber-700',
    title: 'Link indisponível',
    message: 'Não foi possível abrir o pagamento agora. Tente novamente em alguns instantes ou responda a mensagem no WhatsApp.',
  },
  invalido: {
    icon: AlertTriangle,
    tone: 'border-red-200 bg-red-50 text-red-700',
    title: 'Link inválido',
    message: 'Este link de pagamento não existe. Confira a mensagem recebida no WhatsApp ou peça um novo link ao locador.',
  },
};

const PaymentNotice = () => {
  const { motivo } = useParams();
  const notice = notices[motivo] || notices.invalido;
  const Icon = notice.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">SGA</p>
          <h1 className="mt-1 text-lg font-bold text-slate-900">Gestão de Aluguéis</h1>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${notice.tone}`}>
            <Icon size={26} aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-slate-900">{notice.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{notice.message}</p>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <MessageCircle size={14} aria-hidden="true" />
            Atendimento pelo WhatsApp
          </p>
        </div>
      </div>
    </div>
  );
};

export default PaymentNotice;
