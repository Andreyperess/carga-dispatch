import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from './supabaseClient';

/* ============================================================================
   CONSTANTES / HELPERS
============================================================================ */

const ROLE_LABEL = {
  passador: 'Passador de Carga',
  programador: 'Programador de Carga',
  admin: 'Administrador',
};

const STATUS_LABEL = {
  pendente: 'Aguardando Programador',
  concluida: 'Concluída',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

function formatDateTime(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function todayISODate() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

/* ----------------------------------------------------------------------
   NOTIFICAÇÕES DO NAVEGADOR (estilo WhatsApp Web)
   Funciona enquanto a aba estiver aberta (pode estar minimizada ou em
   segundo plano). Se o navegador estiver fechado, não dispara — isso é
   uma limitação de qualquer sistema web sem push notification via
   service worker, não é um bug.
---------------------------------------------------------------------- */

function playNotificationBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // navegador sem suporte a Web Audio — ignora silenciosamente
  }
}

function notifyNewCarga(carga) {
  playNotificationBeep();
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const n = new Notification('Nova carga recebida', {
    body: `Rota ${carga.route_number} — motorista ${carga.driver_name}`,
    tag: `carga-${carga.id}`,
    requireInteraction: false,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

/* ============================================================================
   UI ATOMS
============================================================================ */

function StatusBadge({ status }) {
  const styles = status === 'concluida'
    ? 'bg-success/10 text-success border-success/30'
    : 'bg-pending/10 text-pending border-pending/40';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'concluida' ? 'bg-success' : 'bg-pending'}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

function EmptyState({ title, hint }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white/40 px-6 py-14 text-center">
      <p className="font-display text-xl text-asphalt">{title}</p>
      {hint && <p className="mt-1 text-sm text-steel">{hint}</p>}
    </div>
  );
}

/* Card estilo "canhoto de manifesto" — o elemento assinatura do sistema */
function CargaCard({ carga, children }) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      <div className="stub-edge w-2 shrink-0" />
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-wide text-steel">ROTA</p>
            <p className="font-display text-2xl leading-none text-asphalt">{carga.route_number}</p>
          </div>
          <StatusBadge status={carga.status} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div>
            <p className="text-steel">Motorista</p>
            <p className="font-medium text-asphalt">{carga.driver_name}</p>
          </div>
          <div>
            <p className="text-steel">Carregamento</p>
            <p className="font-medium text-asphalt">{formatDate(carga.load_date)}</p>
          </div>
          {carga.has_schedule && (
            <div className="col-span-2">
              <p className="text-steel">Agendamento</p>
              <p className="font-medium text-asphalt">{formatDateTime(carga.schedule_at)}</p>
            </div>
          )}
        </div>

        {carga.observations && (
          <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm text-asphalt/80">{carga.observations}</p>
        )}

        {children}
      </div>
    </div>
  );
}

/* Modal com todos os detalhes de uma carga — usado no Histórico e no Relatório */
function CargaDetailModal({ carga, onClose }) {
  if (!carga) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-asphalt/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <p className="font-mono text-xs tracking-wide text-steel">ROTA</p>
            <p className="font-display text-3xl leading-none text-asphalt">{carga.route_number}</p>
          </div>
          <button onClick={onClose} className="text-steel hover:text-asphalt">✕</button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <StatusBadge status={carga.status} />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-steel">Motorista</p>
              <p className="font-medium text-asphalt">{carga.driver_name}</p>
            </div>
            <div>
              <p className="text-steel">Data de carregamento</p>
              <p className="font-medium text-asphalt">{formatDate(carga.load_date)}</p>
            </div>
            <div>
              <p className="text-steel">Passador</p>
              <p className="font-medium text-asphalt">{carga.passador?.full_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-steel">Programador</p>
              <p className="font-medium text-asphalt">{carga.programador?.full_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-steel">Enviada em</p>
              <p className="font-medium text-asphalt">{formatDateTime(carga.created_at)}</p>
            </div>
            <div>
              <p className="text-steel">Concluída em</p>
              <p className="font-medium text-asphalt">{formatDateTime(carga.completed_at)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-steel">Agendamento</p>
            <p className="mt-0.5 text-sm font-medium text-asphalt">
              {carga.has_schedule ? formatDateTime(carga.schedule_at) : 'Sem agendamento'}
            </p>
          </div>

          <div>
            <p className="text-sm text-steel">Observações</p>
            <p className="mt-0.5 rounded-lg bg-paper px-3 py-2 text-sm text-asphalt/80">
              {carga.observations || 'Nenhuma observação.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('E-mail ou senha inválidos.');
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-asphalt px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <p className="font-mono text-xs tracking-widest text-accent">CONTROLE DE CARGA</p>
        <h1 className="mt-1 font-display text-4xl text-asphalt">Entrar</h1>
        <p className="mt-1 text-sm text-steel">Acesse com seu e-mail cadastrado pelo Admin.</p>

        <div className="mt-6 space-y-3">
          <input
            type="email" required placeholder="seu.email@empresa.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <input
            type="password" required placeholder="Senha"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button
          type="submit" disabled={loading}
          className="mt-5 w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition hover:bg-accent-dark disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

/* ============================================================================
   LAYOUT (sidebar + topbar)
============================================================================ */

function Layout({ profile, activeTab, setActiveTab, tabs, children }) {
  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="flex w-60 shrink-0 flex-col bg-asphalt text-white">
        <div className="px-5 py-6">
          <p className="font-mono text-[11px] tracking-widest text-accent">CONTROLE DE</p>
          <p className="font-display text-2xl leading-tight">Repasse de Carga</p>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                activeTab === t.key
                  ? 'bg-accent text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-sm font-semibold">{profile.full_name}</p>
          <p className="text-xs text-white/50">{ROLE_LABEL[profile.role]}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-3 text-xs font-medium text-white/60 hover:text-accent"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
    </div>
  );
}

/* ============================================================================
   A. TELA DE REPASSE DE CARGA (Passador)
============================================================================ */

function RepasseCarga({ profile }) {
  const [programadores, setProgramadores] = useState([]);
  const [form, setForm] = useState({
    route_number: '', driver_name: '', load_date: '',
    has_schedule: false, schedule_at: '', observations: '', programador_id: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'programador')
      .eq('active', true)
      .order('full_name')
      .then(({ data }) => setProgramadores(data || []));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);

    const payload = {
      route_number: form.route_number,
      driver_name: form.driver_name,
      load_date: form.load_date,
      has_schedule: form.has_schedule,
      schedule_at: form.has_schedule && form.schedule_at ? form.schedule_at : null,
      observations: form.observations || null,
      passador_id: profile.id,
      programador_id: form.programador_id,
    };

    const { error } = await supabase.from('cargas').insert(payload);
    setSubmitting(false);

    if (error) {
      setFeedback({ type: 'error', text: 'Não foi possível enviar a carga. Tente novamente.' });
      return;
    }
    setFeedback({ type: 'success', text: 'Carga enviada com sucesso.' });
    setForm({
      route_number: '', driver_name: '', load_date: '',
      has_schedule: false, schedule_at: '', observations: '', programador_id: '',
    });
  }

  const inputClass = 'w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-mono text-xs tracking-widest text-accent">NOVO REPASSE</p>
      <h1 className="font-display text-4xl text-asphalt">Repassar Carga</h1>
      <p className="mt-1 text-steel">Preencha os dados e delegue para um programador.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-2xl border border-border bg-white p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-asphalt">Número da rota</label>
            <input required className={inputClass} value={form.route_number}
              onChange={(e) => setForm({ ...form, route_number: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-asphalt">Nome do motorista</label>
            <input required className={inputClass} value={form.driver_name}
              onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-asphalt">Data de carregamento</label>
          <input required type="date" className={inputClass} value={form.load_date}
            onChange={(e) => setForm({ ...form, load_date: e.target.value })} />
        </div>

        <div className="rounded-lg bg-paper p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-asphalt">
            <input type="checkbox" checked={form.has_schedule}
              onChange={(e) => setForm({ ...form, has_schedule: e.target.checked })}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent" />
            Tem agendamento?
          </label>
          {form.has_schedule && (
            <input required type="datetime-local" className={`${inputClass} mt-2`}
              value={form.schedule_at}
              onChange={(e) => setForm({ ...form, schedule_at: e.target.value })} />
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-asphalt">Observações</label>
          <textarea rows={3} className={inputClass} value={form.observations}
            onChange={(e) => setForm({ ...form, observations: e.target.value })} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-asphalt">Delegar para</label>
          <select required className={inputClass} value={form.programador_id}
            onChange={(e) => setForm({ ...form, programador_id: e.target.value })}>
            <option value="">Selecione um programador…</option>
            {programadores.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>

        {feedback && (
          <p className={`text-sm font-medium ${feedback.type === 'success' ? 'text-success' : 'text-danger'}`}>
            {feedback.text}
          </p>
        )}

        <button type="submit" disabled={submitting}
          className="w-full rounded-lg bg-accent py-3 font-semibold text-white transition hover:bg-accent-dark disabled:opacity-60">
          {submitting ? 'Enviando…' : 'Enviar Carga'}
        </button>
      </form>
    </div>
  );
}

/* ============================================================================
   B. FILA DE TRABALHO (Programador)
============================================================================ */

function FilaTrabalho({ profile }) {
  const [cargas, setCargas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('cargas')
      .select('*')
      .eq('programador_id', profile.id)
      .eq('status', 'pendente')
      .order('created_at', { ascending: true });
    setCargas(data || []);
    setLoading(false);
  }, [profile.id]);

  useEffect(() => {
    load();
    // Atualiza a fila em tempo real quando novas cargas chegam.
    // No INSERT, dispara notificação + som; nos demais eventos, só recarrega.
    const channel = supabase
      .channel('fila-trabalho')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'cargas',
        filter: `programador_id=eq.${profile.id}`,
      }, (payload) => {
        notifyNewCarga(payload.new);
        load();
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'cargas',
        filter: `programador_id=eq.${profile.id}`,
      }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, profile.id]);

  async function concluir(id) {
    setBusyId(id);
    await supabase.from('cargas').update({ status: 'concluida' }).eq('id', id);
    setCargas((prev) => prev.filter((c) => c.id !== id));
    setBusyId(null);
  }

  async function ativarNotificacoes() {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  return (
    <div>
      <p className="font-mono text-xs tracking-widest text-accent">FILA DE TRABALHO</p>
      <h1 className="font-display text-4xl text-asphalt">Cargas Pendentes</h1>

      {notifPermission === 'default' && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
          <p className="text-sm text-asphalt">Ative as notificações pra saber na hora quando uma carga nova chegar, mesmo com a aba minimizada.</p>
          <button onClick={ativarNotificacoes}
            className="ml-4 shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-dark">
            Ativar notificações
          </button>
        </div>
      )}
      {notifPermission === 'denied' && (
        <div className="mt-4 rounded-xl border border-pending/30 bg-pending/5 px-4 py-3">
          <p className="text-sm text-asphalt">Notificações bloqueadas pelo navegador. Pra ativar, clique no cadeado ao lado da URL e permita notificações pra este site.</p>
        </div>
      )}
      {notifPermission === 'granted' && (
        <button
          onClick={() => notifyNewCarga({ id: 'teste', route_number: '000', driver_name: 'Teste' })}
          className="mt-3 text-xs font-medium text-steel underline hover:text-accent"
        >
          Testar notificação agora
        </button>
      )}
      <p className="mt-1 text-steel">{cargas.length} carga(s) aguardando seu processamento.</p>

      {loading ? <Spinner /> : cargas.length === 0 ? (
        <div className="mt-6"><EmptyState title="Fila vazia" hint="Nenhuma carga pendente para você no momento." /></div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cargas.map((carga) => (
            <CargaCard key={carga.id} carga={carga}>
              <button
                onClick={() => concluir(carga.id)}
                disabled={busyId === carga.id}
                className="mt-4 w-full rounded-lg bg-success py-2.5 text-sm font-semibold text-white transition hover:bg-success/90 disabled:opacity-60"
              >
                {busyId === carga.id ? 'Concluindo…' : 'OK / Concluir Carga'}
              </button>
            </CargaCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   C1. ACOMPANHAMENTO (Passador) — o que eu enviei
============================================================================ */

function AcompanhamentoPassador({ profile }) {
  const [cargas, setCargas] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('cargas')
      .select('*, programador:programador_id(full_name)')
      .eq('passador_id', profile.id)
      .order('created_at', { ascending: false });
    setCargas(data || []);
    setLoading(false);
  }, [profile.id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('acompanhamento-passador')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'cargas',
        filter: `passador_id=eq.${profile.id}`,
      }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, profile.id]);

  return (
    <div>
      <p className="font-mono text-xs tracking-widest text-accent">ACOMPANHAMENTO</p>
      <h1 className="font-display text-4xl text-asphalt">Minhas Cargas Enviadas</h1>
      <p className="mt-1 text-steel">Status em tempo real, sem precisar perguntar.</p>

      {loading ? <Spinner /> : cargas.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nenhuma carga enviada ainda" /></div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Rota</th>
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Carregamento</th>
                <th className="px-4 py-3">Delegado para</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cargas.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono font-medium text-asphalt">{c.route_number}</td>
                  <td className="px-4 py-3">{c.driver_name}</td>
                  <td className="px-4 py-3">{formatDate(c.load_date)}</td>
                  <td className="px-4 py-3">{c.programador?.full_name ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   C2. HISTÓRICO (Programador) — o que eu já processei
============================================================================ */

function HistoricoProgramador({ profile }) {
  const [cargas, setCargas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState('mes'); // 'semana' | 'mes' | 'tudo'
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState(null);

  useEffect(() => {
    setLoading(true);
    let query = supabase
      .from('cargas')
      .select('*, passador:passador_id(full_name)')
      .eq('programador_id', profile.id)
      .eq('status', 'concluida')
      .order('completed_at', { ascending: false });

    const now = new Date();
    if (periodo === 'semana') {
      query = query.gte('completed_at', startOfWeek(now).toISOString());
    } else if (periodo === 'mes') {
      query = query.gte('completed_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    }

    query.then(({ data }) => {
      setCargas(data || []);
      setLoading(false);
    });
  }, [profile.id, periodo]);

  const filtros = [
    { key: 'semana', label: 'Esta semana' },
    { key: 'mes', label: 'Este mês' },
    { key: 'tudo', label: 'Tudo' },
  ];

  const buscaNormalizada = busca.trim().toLowerCase();
  const cargasFiltradas = buscaNormalizada
    ? cargas.filter((c) =>
        c.route_number.toLowerCase().includes(buscaNormalizada) ||
        c.driver_name.toLowerCase().includes(buscaNormalizada) ||
        (c.passador?.full_name ?? '').toLowerCase().includes(buscaNormalizada)
      )
    : cargas;

  return (
    <div>
      <p className="font-mono text-xs tracking-widest text-accent">HISTÓRICO</p>
      <h1 className="font-display text-4xl text-asphalt">Cargas Processadas</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {filtros.map((f) => (
            <button key={f.key} onClick={() => setPeriodo(f.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                periodo === f.key ? 'bg-asphalt text-white' : 'bg-white text-steel border border-border hover:border-asphalt/30'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text" placeholder="Buscar por rota, motorista ou passador…"
          value={busca} onChange={(e) => setBusca(e.target.value)}
          className="ml-auto w-72 rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {loading ? <Spinner /> : cargasFiltradas.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nada por aqui" hint={busca ? 'Nenhum resultado pra essa busca.' : 'Nenhuma carga concluída nesse período.'} /></div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Rota</th>
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Recebido de</th>
                <th className="px-4 py-3">Concluída em</th>
              </tr>
            </thead>
            <tbody>
              {cargasFiltradas.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelecionada({ ...c, programador: { full_name: profile.full_name } })}
                  className="cursor-pointer border-t border-border hover:bg-paper"
                >
                  <td className="px-4 py-3 font-mono font-medium text-asphalt">{c.route_number}</td>
                  <td className="px-4 py-3">{c.driver_name}</td>
                  <td className="px-4 py-3">{c.passador?.full_name ?? '—'}</td>
                  <td className="px-4 py-3">{formatDateTime(c.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CargaDetailModal carga={selecionada} onClose={() => setSelecionada(null)} />
    </div>
  );
}

/* ============================================================================
   E. RELATÓRIO (Admin) — cargas por período, com busca e detalhes
============================================================================ */

function RelatorioAdmin() {
  const [dateFrom, setDateFrom] = useState(todayISODate());
  const [dateTo, setDateTo] = useState(todayISODate());
  const [cargas, setCargas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('cargas')
      .select('*, passador:passador_id(full_name), programador:programador_id(full_name)')
      .gte('load_date', dateFrom)
      .lte('load_date', dateTo)
      .order('load_date', { ascending: false })
      .order('created_at', { ascending: false });
    setCargas(data || []);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  function irParaHoje() {
    setDateFrom(todayISODate());
    setDateTo(todayISODate());
  }

  const buscaNormalizada = busca.trim().toLowerCase();
  const cargasFiltradas = buscaNormalizada
    ? cargas.filter((c) =>
        c.route_number.toLowerCase().includes(buscaNormalizada) ||
        c.driver_name.toLowerCase().includes(buscaNormalizada) ||
        (c.passador?.full_name ?? '').toLowerCase().includes(buscaNormalizada) ||
        (c.programador?.full_name ?? '').toLowerCase().includes(buscaNormalizada)
      )
    : cargas;

  const totalConcluidas = cargasFiltradas.filter((c) => c.status === 'concluida').length;
  const totalPendentes = cargasFiltradas.filter((c) => c.status === 'pendente').length;

  const inputClass = 'rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div>
      <p className="font-mono text-xs tracking-widest text-accent">RELATÓRIO</p>
      <h1 className="font-display text-4xl text-asphalt">Cargas por Período</h1>
      <p className="mt-1 text-steel">Abre sempre no dia de hoje — ajuste o período abaixo pra ver outras datas.</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-steel">De</label>
          <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-steel">Até</label>
          <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button onClick={irParaHoje}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-asphalt hover:border-asphalt/30">
          Hoje
        </button>
        <input
          type="text" placeholder="Buscar por rota, motorista, passador ou programador…"
          value={busca} onChange={(e) => setBusca(e.target.value)}
          className={`${inputClass} ml-auto w-80`}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-steel">Total no período</p>
          <p className="font-display text-3xl text-asphalt">{cargasFiltradas.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-steel">Concluídas</p>
          <p className="font-display text-3xl text-success">{totalConcluidas}</p>
        </div>
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-steel">Pendentes</p>
          <p className="font-display text-3xl text-pending">{totalPendentes}</p>
        </div>
      </div>

      {loading ? <Spinner /> : cargasFiltradas.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nenhuma carga encontrada" hint="Tente ajustar o período ou a busca." /></div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Rota</th>
                <th className="px-4 py-3">Motorista</th>
                <th className="px-4 py-3">Carregamento</th>
                <th className="px-4 py-3">Passador</th>
                <th className="px-4 py-3">Programador</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cargasFiltradas.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelecionada(c)}
                  className="cursor-pointer border-t border-border hover:bg-paper"
                >
                  <td className="px-4 py-3 font-mono font-medium text-asphalt">{c.route_number}</td>
                  <td className="px-4 py-3">{c.driver_name}</td>
                  <td className="px-4 py-3">{formatDate(c.load_date)}</td>
                  <td className="px-4 py-3">{c.passador?.full_name ?? '—'}</td>
                  <td className="px-4 py-3">{c.programador?.full_name ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CargaDetailModal carga={selecionada} onClose={() => setSelecionada(null)} />
    </div>
  );
}

/* ============================================================================
   D. PAINEL ADMINISTRATIVO
============================================================================ */

function AdminPainel() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: 'passador' });
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('role').order('full_name');
    setUsuarios(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ full_name: '', email: '', password: '', role: 'passador' });
    setFeedback(null);
    setShowForm(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    // Cria o login (Supabase Auth) e, em seguida, o profile de negócio.
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
    });

    if (error || !data.user) {
      setFeedback({ type: 'error', text: error?.message || 'Não foi possível criar o login.' });
      setSubmitting(false);
      return;
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      full_name: form.full_name,
      role: form.role,
      active: true,
    });

    setSubmitting(false);
    if (profileError) {
      setFeedback({ type: 'error', text: 'Login criado, mas houve erro ao salvar o perfil.' });
      return;
    }
    setFeedback({ type: 'success', text: 'Usuário criado com sucesso.' });
    setShowForm(false);
    load();
  }

  async function toggleActive(u) {
    await supabase.from('profiles').update({ active: !u.active }).eq('id', u.id);
    load();
  }

  async function removeUser(u) {
    if (!window.confirm(`Remover ${u.full_name} definitivamente?`)) return;
    await supabase.from('profiles').delete().eq('id', u.id);
    load();
  }

  async function saveRoleEdit(u, newRole, newName) {
    await supabase.from('profiles').update({ role: newRole, full_name: newName }).eq('id', u.id);
    setEditing(null);
    load();
  }

  const inputClass = 'w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
  const grouped = useMemo(() => ({
    passador: usuarios.filter((u) => u.role === 'passador'),
    programador: usuarios.filter((u) => u.role === 'programador'),
    admin: usuarios.filter((u) => u.role === 'admin'),
  }), [usuarios]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs tracking-widest text-accent">ADMINISTRAÇÃO</p>
          <h1 className="font-display text-4xl text-asphalt">Equipe</h1>
        </div>
        <button onClick={openNew}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark">
          + Novo usuário
        </button>
      </div>

      {loading ? <Spinner /> : (
        <div className="mt-6 space-y-8">
          {Object.entries(grouped).map(([role, list]) => (
            <div key={role}>
              <h2 className="font-display text-xl text-asphalt">{ROLE_LABEL[role]}s</h2>
              <div className="mt-2 overflow-hidden rounded-xl border border-border bg-white">
                {list.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-steel">Nenhum usuário cadastrado.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {list.map((u) => (
                        <tr key={u.id} className="border-t border-border first:border-t-0">
                          {editing === u.id ? (
                            <EditRow u={u} onCancel={() => setEditing(null)} onSave={saveRoleEdit} />
                          ) : (
                            <>
                              <td className="px-4 py-3 font-medium text-asphalt">{u.full_name}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.active ? 'bg-success/10 text-success' : 'bg-steel/10 text-steel'}`}>
                                  {u.active ? 'Ativo' : 'Inativo'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right space-x-3">
                                <button onClick={() => setEditing(u.id)} className="text-sm font-medium text-asphalt hover:text-accent">Editar</button>
                                <button onClick={() => toggleActive(u)} className="text-sm font-medium text-pending hover:text-pending/70">
                                  {u.active ? 'Inativar' : 'Ativar'}
                                </button>
                                <button onClick={() => removeUser(u)} className="text-sm font-medium text-danger hover:text-danger/70">Remover</button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-asphalt/50 px-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="font-display text-2xl text-asphalt">Novo usuário</h3>
            <div className="mt-4 space-y-3">
              <input required placeholder="Nome completo" className={inputClass}
                value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              <input required type="email" placeholder="E-mail" className={inputClass}
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input required type="password" placeholder="Senha temporária" className={inputClass}
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select className={inputClass} value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="passador">Passador de Carga</option>
                <option value="programador">Programador de Carga</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            {feedback && (
              <p className={`mt-3 text-sm font-medium ${feedback.type === 'success' ? 'text-success' : 'text-danger'}`}>{feedback.text}</p>
            )}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-asphalt">Cancelar</button>
              <button type="submit" disabled={submitting}
                className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-60">
                {submitting ? 'Criando…' : 'Criar usuário'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function EditRow({ u, onCancel, onSave }) {
  const [name, setName] = useState(u.full_name);
  const [role, setRole] = useState(u.role);
  return (
    <td colSpan={3} className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-border px-2 py-1.5 text-sm">
          <option value="passador">Passador de Carga</option>
          <option value="programador">Programador de Carga</option>
          <option value="admin">Administrador</option>
        </select>
        <button onClick={() => onSave(u, role, name)} className="text-sm font-semibold text-success">Salvar</button>
        <button onClick={onCancel} className="text-sm font-medium text-steel">Cancelar</button>
      </div>
    </td>
  );
}

/* ============================================================================
   APP RAIZ — sessão, perfil e roteamento por papel
============================================================================ */

const TABS_BY_ROLE = {
  passador: [
    { key: 'repasse', label: 'Repasse de Carga' },
    { key: 'acompanhamento', label: 'Acompanhamento' },
    { key: 'relatorio', label: 'Relatório' },
  ],
  programador: [
    { key: 'fila', label: 'Fila de Trabalho' },
    { key: 'historico', label: 'Histórico' },
    { key: 'relatorio', label: 'Relatório' },
  ],
  admin: [
    { key: 'equipe', label: 'Equipe' },
    { key: 'relatorio', label: 'Relatório' },
  ],
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = carregando
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => {
        setProfile(data);
        setActiveTab(TABS_BY_ROLE[data?.role]?.[0]?.key ?? null);
      });
  }, [session]);

  if (session === undefined) return <Spinner />;
  if (!session) return <AuthScreen />;
  if (!profile) return <Spinner />;

  const tabs = TABS_BY_ROLE[profile.role] || [];

  return (
    <Layout profile={profile} activeTab={activeTab} setActiveTab={setActiveTab} tabs={tabs}>
      {profile.role === 'passador' && activeTab === 'repasse' && <RepasseCarga profile={profile} />}
      {profile.role === 'passador' && activeTab === 'acompanhamento' && <AcompanhamentoPassador profile={profile} />}
      {profile.role === 'programador' && activeTab === 'fila' && <FilaTrabalho profile={profile} />}
      {profile.role === 'programador' && activeTab === 'historico' && <HistoricoProgramador profile={profile} />}
      {profile.role === 'admin' && activeTab === 'equipe' && <AdminPainel />}
      {activeTab === 'relatorio' && <RelatorioAdmin />}
    </Layout>
  );
}
