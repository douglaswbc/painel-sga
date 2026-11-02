import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2, PauseCircle } from 'lucide-react';
import { useMetaAlerts } from '../hooks/useMetaAlerts';

const TONES = {
  critical: {
    container: 'border-red-500/30 bg-red-500/10',
    title: 'text-red-300',
    detail: 'text-red-300/80',
    button: 'bg-red-600 hover:bg-red-700 text-white',
    icon: AlertOctagon,
  },
  error: {
    container: 'border-rose-500/30 bg-rose-500/10',
    title: 'text-rose-300',
    detail: 'text-rose-300/80',
    button: 'bg-rose-600 hover:bg-rose-700 text-white',
    icon: AlertTriangle,
  },
  warning: {
    container: 'border-amber-500/30 bg-amber-500/10',
    title: 'text-amber-300',
    detail: 'text-amber-300/80',
    button: 'bg-amber-600 hover:bg-amber-700 text-white',
    icon: AlertTriangle,
  },
  info: {
    container: 'border-sky-500/30 bg-sky-500/10',
    title: 'text-sky-300',
    detail: 'text-sky-300/80',
    button: 'bg-sky-600 hover:bg-sky-700 text-white',
    icon: Info,
  },
};

const isExternal = (url) => /^https?:\/\//i.test(String(url || ''));

/**
 * Banner global com os alertas acionáveis da Meta. Fica acima do conteúdo de
 * todas as telas autenticadas do locador. A confirmação "Já regularizei"
 * encerra o alerta (e retoma os lembretes automáticos, quando bloqueante).
 */
export default function MetaAlertBanner({ enabled = true, className = '' }) {
  const navigate = useNavigate();
  const { alerts, loading, clearAlert } = useMetaAlerts(enabled);
  const [busyType, setBusyType] = useState(null);
  const [hidden, setHidden] = useState([]);

  if (!enabled || loading || !alerts.length) return null;

  const visible = alerts.filter((alert) => !hidden.includes(alert.tipo));
  if (!visible.length) return null;

  const confirm = async (alert) => {
    const question = alert.bloqueante
      ? 'Confirmar que o problema na Meta foi regularizado? Os lembretes automáticos serão retomados.'
      : 'Marcar este aviso como resolvido? Ele volta a aparecer se a Meta repetir o erro.';
    if (!window.confirm(question)) return;
    setBusyType(alert.tipo);
    try {
      await clearAlert(alert.tipo);
      setHidden((current) => [...current, alert.tipo]);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setBusyType(null);
    }
  };

  const openAction = (alert) => {
    if (!alert.acaoUrl) return;
    if (isExternal(alert.acaoUrl)) {
      window.open(alert.acaoUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(alert.acaoUrl);
  };

  return (
    <section className={`space-y-2 ${className}`} aria-live="polite">
      {visible.map((alert) => {
        const tone = TONES[alert.severidade] || TONES.warning;
        const Icon = tone.icon;
        const busy = busyType === alert.tipo;
        return (
          <div
            key={alert.tipo}
            className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start ${tone.container}`}
            role="alert"
          >
            <Icon className={`mt-0.5 shrink-0 ${tone.title}`} size={22} />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${tone.title}`}>{alert.titulo}</p>
              <p className={`mt-1 text-xs leading-relaxed ${tone.detail}`}>{alert.descricao}</p>
              {(alert.detalhe || alert.codigo) && (
                <p className={`mt-1 break-words text-[11px] ${tone.detail}`}>
                  {alert.codigo ? `Código ${alert.codigo}` : 'Detalhe'}
                  {alert.detalhe ? `: ${alert.detalhe}` : ''}
                </p>
              )}
              {alert.bloqueante && (
                <p className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold ${tone.title}`}>
                  <PauseCircle size={13} /> Lembretes automáticos pausados até a regularização.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-stretch">
              {alert.acaoUrl && (
                <button
                  type="button"
                  onClick={() => openAction(alert)}
                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] font-semibold text-[#1d1d1f] transition hover:border-black/20"
                >
                  {alert.acaoLabel || 'Abrir'}
                </button>
              )}
              <button
                type="button"
                onClick={() => confirm(alert)}
                disabled={busy}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition disabled:opacity-60 ${tone.button}`}
              >
                {busy ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                Já regularizei
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
