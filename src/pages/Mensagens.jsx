import React, { useState } from 'react';
import { CalendarClock, MessageSquareQuote } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ZernioTemplatesCard from '../components/ZernioTemplatesCard';
import ZernioSchedulesCard from '../components/ZernioSchedulesCard';

const tabs = [
  { id: 'templates', label: 'Templates Meta', icon: MessageSquareQuote },
  { id: 'schedules', label: 'Agendamentos Ativos', icon: CalendarClock },
];

export default function Mensagens() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState('templates');

  return (
    <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-7xl flex-col gap-6 px-1 pb-12">
      <header>
        <h1 className="flex items-center gap-3 text-2xl font-black text-white">
          <span className="rounded-xl bg-indigo-500/20 p-2"><MessageSquareQuote className="text-indigo-400" size={24} /></span>
          Mensagens WhatsApp
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Gerencie templates da Meta e agendamentos enviados pelo canal Zernio.</p>
      </header>

      <nav className="flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-zinc-900 bg-zinc-950/50 p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${activeTab === id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </nav>

      {profile?.role !== 'locador' ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">A gestão de mensagens está disponível para contas de locador.</div>
      ) : activeTab === 'templates' ? (
        <ZernioTemplatesCard />
      ) : (
        <ZernioSchedulesCard />
      )}
    </main>
  );
}
