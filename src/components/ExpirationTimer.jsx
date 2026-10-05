import React, { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

const formatRemaining = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainingSeconds).padStart(2, '0')}s`;
};

const ExpirationTimer = ({ expiresAt }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (new Date(expiresAt).getTime() <= currentTime) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (!expiresAt) return null;

  const expiration = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiration)) return null;

  const remaining = expiration - now;
  const expired = remaining <= 0;
  const urgent = !expired && remaining <= 30 * 60 * 1000;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${
        expired
          ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
          : urgent
            ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
            : 'border-zinc-700 bg-zinc-950/70 text-zinc-300'
      }`}
      aria-label={expired ? 'O PIX expirou' : `PIX expira em ${formatRemaining(remaining)}`}
    >
      <Clock3 size={13} aria-hidden="true" />
      <span>{expired ? 'PIX expirado' : formatRemaining(remaining)}</span>
    </div>
  );
};

export default ExpirationTimer;
