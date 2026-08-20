import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

const DIVISIONS = {
  logica: { name: 'Lógica y Control', desc: 'PLCs, programación, HMI y sistemas de control industrial.' },
  instrumentacion: { name: 'Instrumentación de Procesos', desc: 'Válvulas, transmisores y lazos de control de proceso.' },
  potencia: { name: 'Potencia', desc: 'Motores, transformadores y sistemas eléctricos de potencia.' },
  sensorica: { name: 'Sensórica y Medición', desc: 'Sensores, calibración y equipos de medición.' },
};

const STATUS_STYLE = {
  Pendiente: { bg: 'rgba(0,163,224,0.12)', color: '#0087bd' },
  Asignado: { bg: 'rgba(0,45,98,0.1)', color: '#002D62' },
  'En Calibración': { bg: 'rgba(230,126,34,0.14)', color: '#c9690f' },
  Resuelto: { bg: 'rgba(39,174,96,0.14)', color: '#1e8449' },
};

const PRIORITY_STYLE = {
  Alta: { bg: 'rgba(214,69,69,0.14)', color: '#b3372f' },
  Media: { bg: 'rgba(230,168,23,0.14)', color: '#a8790f' },
  Baja: { bg: 'rgba(0,163,224,0.12)', color: '#0087bd' },
};

const TYPE_STYLE = {
  Falla: { bg: 'rgba(214,69,69,0.12)', color: '#b3372f' },
  Calibración: { bg: 'rgba(0,163,224,0.12)', color: '#0087bd' },
  Mantenimiento: { bg: 'rgba(155,89,182,0.14)', color: '#7d3c98' },
  Consulta: { bg: 'rgba(39,174,96,0.12)', color: '#1e8449' },
};

const STATUS_ORDER = ['Pendiente', 'Asignado', 'En Calibración', 'Resuelto'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Demo "acceso rápido" users seeded by sql/schema.sql — this build has no
// credentialed login, so the two quick-access buttons map to fixed rows
// in `usuarios` (see sql/schema.sql for the matching INSERTs).
const DEMO_CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_ADMIN_ID = '00000000-0000-4000-8000-000000000002';

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Hoy';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function rowToTicket(row) {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    equipo: row.equipo,
    sintomas: row.sintomas,
    divisionKey: row.division_key,
    status: row.status,
    priority: row.priority,
    tipo: row.tipo,
    ai: row.ai_clasificado,
    date: formatDate(row.created_at),
  };
}

function classify(text) {
  const t = text.toLowerCase();
  const kw = {
    sensorica: ['sensor', 'calibra', 'medición', 'medicion', 'termopar', 'presostato'],
    logica: ['plc', 'programa', 'lógica', 'logica', 'software', 'hmi', 'scada'],
    potencia: ['motor', 'transformador', 'voltaje', 'eléctric', 'electric', 'breaker', 'potencia', 'variador'],
    instrumentacion: ['válvula', 'valvula', 'flujo', 'presión', 'presion', 'instrumentación', 'instrumentacion', 'actuador'],
  };
  for (const key of Object.keys(kw)) {
    if (kw[key].some((w) => t.includes(w))) return key;
  }
  return 'instrumentacion';
}

function priorityFor(text) {
  const t = text.toLowerCase();
  if (['urgente', 'parada total', 'detenido', 'crítico', 'critico', 'falla total', 'no funciona', 'parado'].some((w) => t.includes(w))) return 'Alta';
  if (['leve', 'menor', 'cosmético', 'cosmetico', 'ocasional'].some((w) => t.includes(w))) return 'Baja';
  return 'Media';
}

function classifyTipo(text) {
  const t = text.toLowerCase();
  if (['calibra'].some((w) => t.includes(w))) return 'Calibración';
  if (['mantenimiento', 'preventiv', 'revisión', 'revision'].some((w) => t.includes(w))) return 'Mantenimiento';
  if (['consulta', 'duda', 'pregunta', 'información', 'informacion'].some((w) => t.includes(w))) return 'Consulta';
  return 'Falla';
}

function buildTicketView(t) {
  const st = STATUS_STYLE[t.status] || STATUS_STYLE.Pendiente;
  const pri = PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.Media;
  return {
    ...t,
    statusBg: st.bg,
    statusColor: st.color,
    priorityDot: pri.color,
    divisionName: (DIVISIONS[t.divisionKey] || {}).name || '',
    isNotResolved: t.status !== 'Resuelto',
  };
}

function BackArrow({ onClick }) {
  return (
    <div onClick={onClick} style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <svg width="10" height="17" viewBox="0 0 10 17">
        <path d="M8.5 1L1 8.5l7.5 7.5" stroke="#002D62" strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('login');
  const [prevScreen, setPrevScreen] = useState('client');
  const [role, setRole] = useState(null); // 'cliente' | 'admin'

  const [form, setForm] = useState({ equipo: '', sintomas: '' });
  const [aiResult, setAiResult] = useState(null);
  const [divisionOverride, setDivisionOverride] = useState('instrumentacion');
  const [submitting, setSubmitting] = useState(false);

  const [hoveredDiv, setHoveredDiv] = useState(null);
  const [adminTab, setAdminTab] = useState('resumen');
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  const [notifications, setNotifications] = useState([
    { id: 1, ticketId: null, message: 'Tu solicitud "Sensor de presión línea 2" pasó a En Calibración.', date: 'Hace 2h', read: false },
    { id: 2, ticketId: null, message: 'Tu ticket "PLC línea de empaque" fue marcado como Resuelto.', date: 'Ayer', read: false },
    { id: 3, ticketId: null, message: 'Un ingeniero fue asignado a "Transmisor de flujo".', date: 'Hace 3 días', read: true },
  ]);

  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState(null);

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2600);
  }

  async function fetchTickets() {
    setTicketsLoading(true);
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });
    setTicketsLoading(false);
    if (error) {
      setTicketsError(error.message);
      return;
    }
    setTicketsError(null);
    setTickets((data || []).map(rowToTicket));
  }

  // Admin dashboard: SELECT all tickets on login, then keep the table and
  // the treemap live via a Supabase Realtime subscription on `tickets`.
  useEffect(() => {
    if (role !== 'admin') return undefined;
    fetchTickets();
    const channel = supabase
      .channel('tickets-admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        fetchTickets();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [role]);

  function loginAsClient() {
    setRole('cliente');
    setScreen('client');
    fetchTickets();
  }

  function loginAsAdmin() {
    setRole('admin');
    setScreen('admin');
  }

  function logout() {
    setRole(null);
    setScreen('login');
    setTickets([]);
  }

  function openForm() {
    setForm({ equipo: '', sintomas: '' });
    setScreen('form1');
  }

  const canContinue1 = form.equipo.trim().length > 0;
  const canContinue2 = form.sintomas.trim().length > 0;

  function startTriage() {
    if (!canContinue2) return;
    setScreen('loading');
    const divKey = classify(form.equipo + ' ' + form.sintomas);
    const pri = priorityFor(form.sintomas);
    const tipo = classifyTipo(form.equipo + ' ' + form.sintomas);
    setTimeout(() => {
      setAiResult({ divisionKey: divKey, priority: pri, tipo });
      setDivisionOverride(divKey);
      setScreen('result');
    }, 2000);
  }

  // Typeform-style incident form: persist the ticket to Supabase instead of
  // only pushing it into local state.
  async function confirmSubmit() {
    setSubmitting(true);
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        usuario_id: DEMO_CLIENT_ID,
        equipo: form.equipo || 'Incidencia sin título',
        sintomas: form.sintomas,
        division_key: divisionOverride,
        status: 'Pendiente',
        priority: aiResult ? aiResult.priority : 'Media',
        tipo: aiResult ? aiResult.tipo : 'Falla',
        ai_clasificado: true,
      })
      .select()
      .single();
    setSubmitting(false);

    if (error) {
      showToast('No se pudo guardar el ticket: ' + error.message);
      return;
    }

    setTickets((prev) => [rowToTicket(data), ...prev]);
    setForm({ equipo: '', sintomas: '' });
    setAiResult(null);
    setScreen('client');
    showToast('Ticket enviado ✓');
  }

  async function changeStatus(id, newStatus) {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    const { error } = await supabase.from('tickets').update({ status: newStatus }).eq('id', id);
    if (error) showToast('No se pudo actualizar el estado: ' + error.message);
  }

  function resolveTicket(id) {
    changeStatus(id, 'Resuelto');
  }

  function toggleGroup(status) {
    setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }));
  }

  function openNotifications() {
    setScreen('notifications');
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function openTicketDetail(id, fromNotif) {
    if (!tickets.some((t) => t.id === id)) {
      showToast('Ese ticket ya no está disponible.');
      return;
    }
    setPrevScreen(fromNotif ? 'notifications' : 'client');
    setSelectedTicketId(id);
    setScreen('ticketDetail');
  }

  function requestUpdate(ticket) {
    const notif = { id: Date.now(), ticketId: ticket.id, message: `Enviaste una solicitud de seguimiento para "${ticket.equipo}". El ingeniero responderá pronto.`, date: 'Ahora', read: true };
    setNotifications((prev) => [notif, ...prev]);
    showToast('Solicitud de seguimiento enviada ✓');
  }

  async function markUrgent(ticket) {
    setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, priority: 'Alta' } : t)));
    const { error } = await supabase.from('tickets').update({ priority: 'Alta' }).eq('id', ticket.id);
    if (error) {
      showToast('No se pudo marcar como urgente: ' + error.message);
      return;
    }
    const notif = { id: Date.now(), ticketId: ticket.id, message: `Marcaste "${ticket.equipo}" como urgente. El equipo de soporte fue notificado.`, date: 'Ahora', read: true };
    setNotifications((prev) => [notif, ...prev]);
    showToast('Ticket marcado como urgente ✓');
  }

  const ticketsView = useMemo(() => tickets.map(buildTicketView), [tickets]);

  const kpiTotal = tickets.length;
  const kpiCritical = tickets.filter((t) => t.priority === 'Alta' && t.status !== 'Resuelto').length;
  const countLogica = tickets.filter((t) => t.divisionKey === 'logica').length;
  const countInstrumentacion = tickets.filter((t) => t.divisionKey === 'instrumentacion').length;
  const countPotencia = tickets.filter((t) => t.divisionKey === 'potencia').length;
  const countSensorica = tickets.filter((t) => t.divisionKey === 'sensorica').length;

  const statusChart = useMemo(() => {
    const counts = STATUS_ORDER.map((st) => tickets.filter((t) => t.status === st).length);
    const max = Math.max(1, ...counts);
    return STATUS_ORDER.map((st, i) => ({ name: st, count: counts[i], pct: Math.max(4, Math.round((counts[i] / max) * 100)), color: STATUS_STYLE[st].color }));
  }, [tickets]);

  const typeChart = useMemo(() => {
    const keys = Object.keys(TYPE_STYLE);
    const counts = keys.map((k) => tickets.filter((t) => t.tipo === k).length);
    const max = Math.max(1, ...counts);
    return keys.map((k, i) => ({ name: k, count: counts[i], pct: Math.max(4, Math.round((counts[i] / max) * 100)), color: TYPE_STYLE[k].color }));
  }, [tickets]);

  const kanbanGroups = useMemo(
    () =>
      STATUS_ORDER.map((st) => {
        const stStyle = STATUS_STYLE[st];
        const groupTickets = ticketsView.filter((t) => t.status === st);
        const collapsed = !!collapsedGroups[st];
        return { status: st, count: groupTickets.length, color: stStyle.color, tickets: groupTickets, isEmpty: groupTickets.length === 0, isExpanded: !collapsed, chevron: collapsed ? '›' : '⌄' };
      }),
    [ticketsView, collapsedGroups]
  );

  const hoverInfo = hoveredDiv ? DIVISIONS[hoveredDiv] : null;
  const resultDiv = aiResult ? DIVISIONS[aiResult.divisionKey] : null;
  const resultPriStyle = aiResult ? PRIORITY_STYLE[aiResult.priority] || PRIORITY_STYLE.Media : PRIORITY_STYLE.Media;

  const selectedTicketRaw = tickets.find((t) => t.id === selectedTicketId);
  const selectedTicket = selectedTicketRaw ? buildTicketView(selectedTicketRaw) : null;
  const selectedTicketIdx = selectedTicketRaw ? STATUS_ORDER.indexOf(selectedTicketRaw.status) : -1;

  const pageStyle = { width: '100%', maxWidth: 430, margin: '0 auto', minHeight: '100vh', position: 'relative', background: '#F4F6F9', fontFamily: "'Satoshi',-apple-system,system-ui,sans-serif", overflow: 'hidden' };

  return (
    <div style={pageStyle}>
      {screen === 'login' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 24px 40px', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: '#002D62', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#00A3E0' }} />
            </div>
          </div>
          <div style={{ marginTop: 16, fontSize: 22, fontWeight: 800, color: '#002D62', letterSpacing: 1 }}>COLSEIN</div>
          <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: 'rgba(0,45,98,0.5)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Sistema de Gestión de Casos TI</div>

          <div style={{ marginTop: 32, width: '100%', background: '#fff', borderRadius: 24, padding: 24, boxSizing: 'border-box', border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#00243f', marginBottom: 6 }}>Correo corporativo</div>
              <div style={{ height: 44, borderRadius: 12, border: '1px solid rgba(0,45,98,0.14)', background: '#F4F6F9', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 14, color: 'rgba(0,45,98,0.4)', boxSizing: 'border-box' }}>nombre@colsein.com</div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#00243f', marginBottom: 6 }}>Contraseña</div>
              <div style={{ height: 44, borderRadius: 12, border: '1px solid rgba(0,45,98,0.14)', background: '#F4F6F9', display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 14, color: 'rgba(0,45,98,0.4)', boxSizing: 'border-box' }}>••••••••••</div>
            </div>

            <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(0,45,98,0.45)', marginTop: 6 }}>— Acceso rápido de prueba —</div>

            <button onClick={loginAsClient} style={{ height: 52, borderRadius: 14, background: '#002D62', color: '#fff', fontSize: 14.5, fontWeight: 700, border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit' }}>Entrar como Cliente de Planta</button>
            <button onClick={loginAsAdmin} style={{ height: 52, borderRadius: 14, background: '#fff', color: '#002D62', fontSize: 14.5, fontWeight: 700, border: '2px solid #00A3E0', width: '100%', cursor: 'pointer', fontFamily: 'inherit' }}>Entrar como Ingeniero de Soporte Colsein</button>
          </div>
        </div>
      )}

      {screen === 'client' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ padding: '58px 20px 0', display: 'flex', flexDirection: 'column', gap: 18, flex: 1, overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(0,45,98,0.55)' }}>Bienvenido de vuelta,</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#002D62' }}>Ing. Carlos</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <div title="Notificaciones" onClick={openNotifications} style={{ position: 'relative', width: 40, height: 40, borderRadius: 20, background: '#fff', border: '1px solid #E7EAF0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 17 }}>
                  🔔
                  {notifications.some((n) => !n.read) && (
                    <div style={{ position: 'absolute', top: 5, right: 6, width: 9, height: 9, borderRadius: '50%', background: '#c0392b', border: '1.5px solid #fff' }} />
                  )}
                </div>
                <div title="Cerrar sesión" onClick={logout} style={{ width: 44, height: 44, borderRadius: 22, background: '#00A3E0', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>CM</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(0,45,98,0.5)', marginTop: -10 }}>Cliente de Planta · Línea 3</div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>Tus tickets</div>

            {ticketsLoading && <div style={{ fontSize: 12.5, color: 'rgba(0,45,98,0.4)' }}>Cargando tickets…</div>}
            {ticketsError && <div style={{ fontSize: 12.5, color: '#b3372f' }}>Error al cargar tickets: {ticketsError}</div>}

            {ticketsView.map((ticket) => (
              <div key={ticket.id} onClick={() => openTicketDetail(ticket.id, false)} style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#002D62' }}>{ticket.equipo}</div>
                  <div style={{ borderRadius: 999, padding: '4px 10px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: ticket.statusBg, color: ticket.statusColor }}>{ticket.status}</div>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(0,45,98,0.5)' }}>{ticket.divisionName} · {ticket.date}</div>
                <div style={{ fontSize: 11.5, color: '#00A3E0', fontWeight: 700, marginTop: 2 }}>Ver seguimiento ›</div>
              </div>
            ))}
            <div style={{ height: 8 }} />
          </div>
          <div style={{ padding: '14px 20px 30px', background: 'linear-gradient(180deg,rgba(244,246,249,0),#F4F6F9 30%)', boxSizing: 'border-box' }}>
            <button onClick={openForm} style={{ width: '100%', height: 54, borderRadius: 16, background: '#002D62', color: '#fff', fontSize: 14.5, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>➕ Reportar Incidencia / Solicitar Calibración</button>
          </div>
        </div>
      )}

      {screen === 'notifications' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ padding: '58px 20px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <BackArrow onClick={() => setScreen('client')} />
            <div style={{ fontSize: 18, fontWeight: 800, color: '#002D62' }}>Notificaciones</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 20px 30px', display: 'flex', flexDirection: 'column', gap: 8, boxSizing: 'border-box' }}>
            {notifications.map((notif) => (
              <div key={notif.id} onClick={() => openTicketDetail(notif.ticketId, true)} style={{ display: 'flex', gap: 10, background: '#fff', borderRadius: 14, padding: 13, border: '1px solid #E7EAF0', cursor: 'pointer' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00A3E0', flexShrink: 0, marginTop: 5, opacity: notif.read ? 0 : 1 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 13, color: '#002D62', lineHeight: 1.45 }}>{notif.message}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,45,98,0.4)' }}>{notif.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === 'ticketDetail' && selectedTicket && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ padding: '58px 20px 0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <BackArrow onClick={() => setScreen(prevScreen)} />
            <div style={{ fontSize: 18, fontWeight: 800, color: '#002D62' }}>Seguimiento</div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 30px', display: 'flex', flexDirection: 'column', gap: 16, boxSizing: 'border-box' }}>
            <div style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#002D62' }}>{selectedTicket.equipo}</div>
                <div style={{ borderRadius: 999, padding: '4px 10px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: selectedTicket.statusBg, color: selectedTicket.statusColor }}>{selectedTicket.status}</div>
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(0,45,98,0.5)' }}>{selectedTicket.divisionName} · {selectedTicket.tipo} · {selectedTicket.date}</div>
            </div>

            <div style={{ background: '#fff', borderRadius: 18, padding: '18px 16px', border: '1px solid #E7EAF0' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>Estado de tu solicitud</div>
              {STATUS_ORDER.map((st, i) => (
                <div key={st} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {i < selectedTicketIdx && (
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: STATUS_STYLE[st].color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>✓</div>
                    )}
                    {i === selectedTicketIdx && (
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', border: `3px solid ${STATUS_STYLE[st].color}`, flexShrink: 0 }} />
                    )}
                    {i > selectedTicketIdx && (
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,45,98,0.08)', flexShrink: 0 }} />
                    )}
                    <div style={{ width: 2, flex: 1, background: 'rgba(0,45,98,0.1)', margin: '2px 0', minHeight: 20 }} />
                  </div>
                  <div style={{ paddingBottom: 20 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#002D62' }}>{st}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => requestUpdate(selectedTicketRaw)} style={{ height: 50, borderRadius: 14, background: '#fff', border: '2px solid #00A3E0', color: '#002D62', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬 Solicitar actualización</button>
              <button disabled={selectedTicket.priority === 'Alta'} onClick={() => markUrgent(selectedTicketRaw)} style={{ height: 50, borderRadius: 14, background: 'rgba(214,69,69,0.1)', border: 'none', color: '#b3372f', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🚨 Marcar como urgente</button>
            </div>
          </div>
        </div>
      )}

      {screen === 'form1' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '58px 24px 32px', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BackArrow onClick={() => setScreen('client')} />
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,45,98,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#002D62,#00A3E0)', width: '33%' }} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,45,98,0.45)', fontWeight: 600, flexShrink: 0 }}>1 de 3</div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
            <div style={{ fontSize: 23, fontWeight: 800, color: '#002D62', lineHeight: 1.3 }}>¿Qué equipo o proceso está presentando la novedad?</div>
            <input
              type="text"
              value={form.equipo}
              onChange={(e) => setForm((f) => ({ ...f, equipo: e.target.value }))}
              placeholder="Ej. Sensor de presión línea 2"
              style={{ height: 52, borderRadius: 14, border: '2px solid #00A3E0', background: '#fff', padding: '0 16px', fontSize: 15.5, color: '#002D62', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
            />
            <div style={{ fontSize: 12.5, color: 'rgba(0,45,98,0.5)', lineHeight: 1.5 }}>Sé específico: incluye el código del equipo o la línea de producción si lo conoces.</div>
          </div>

          <button disabled={!canContinue1} onClick={() => canContinue1 && setScreen('form2')} style={{ height: 52, borderRadius: 14, color: '#fff', fontSize: 14.5, fontWeight: 700, border: 'none', width: '100%', fontFamily: 'inherit', background: canContinue1 ? '#002D62' : 'rgba(0,45,98,0.25)', cursor: canContinue1 ? 'pointer' : 'not-allowed' }}>Continuar</button>
        </div>
      )}

      {screen === 'form2' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '58px 24px 32px', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <BackArrow onClick={() => setScreen('form1')} />
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,45,98,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,#002D62,#00A3E0)', width: '66%' }} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,45,98,0.45)', fontWeight: 600, flexShrink: 0 }}>2 de 3</div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
            <div style={{ fontSize: 23, fontWeight: 800, color: '#002D62', lineHeight: 1.3 }}>Describe detalladamente los síntomas o la desviación detectada.</div>
            <textarea
              value={form.sintomas}
              onChange={(e) => setForm((f) => ({ ...f, sintomas: e.target.value }))}
              placeholder="Ej. El sensor muestra lecturas intermitentes desde ayer en la tarde..."
              style={{ height: 140, borderRadius: 14, border: '2px solid #00A3E0', background: '#fff', padding: '14px 16px', fontSize: 15, color: '#002D62', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', outline: 'none' }}
            />
            <div style={{ fontSize: 12.5, color: 'rgba(0,45,98,0.5)', lineHeight: 1.5 }}>Cuanto más detalle brindes, más precisa será la clasificación automática del Agente de IA.</div>
          </div>

          <button disabled={!canContinue2} onClick={startTriage} style={{ height: 52, borderRadius: 14, color: '#fff', fontSize: 14.5, fontWeight: 700, border: 'none', width: '100%', fontFamily: 'inherit', background: canContinue2 ? '#002D62' : 'rgba(0,45,98,0.25)', cursor: canContinue2 ? 'pointer' : 'not-allowed' }}>Analizar con IA</button>
        </div>
      )}

      {screen === 'loading' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24, boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', border: '4px solid rgba(0,45,98,0.12)', borderTopColor: '#00A3E0', animation: 'colsein-spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#002D62', textAlign: 'center', lineHeight: 1.6, maxWidth: 260 }}>El Agente de IA de Colsein está analizando tu solicitud en base a nuestras divisiones...</div>
        </div>
      )}

      {screen === 'result' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '58px 24px 32px', boxSizing: 'border-box', background: '#F4F6F9', overflowY: 'auto', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#00A3E0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="16" viewBox="0 0 20 16"><path d="M1 8l6 6L19 1" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#002D62' }}>Análisis completado</div>
          </div>

          <div style={{ background: '#fff', borderRadius: 20, padding: 20, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,45,98,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>División asignada automáticamente</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#002D62' }}>{resultDiv ? resultDiv.name : ''}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,45,98,0.5)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Prioridad sugerida</div>
              <div style={{ display: 'inline-block', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, background: resultPriStyle.bg, color: resultPriStyle.color }}>{aiResult ? aiResult.priority : ''}</div>
            </div>
            <div style={{ height: 1, background: 'rgba(0,45,98,0.08)' }} />
            <div style={{ fontSize: 12.5, color: '#002D62', lineHeight: 1.6 }}>Hemos clasificado tu ticket. Si crees que pertenece a otra división, puedes cambiarla manualmente aquí antes de enviar:</div>
            <select value={divisionOverride} onChange={(e) => setDivisionOverride(e.target.value)} style={{ height: 48, borderRadius: 12, border: '1.5px solid rgba(0,45,98,0.15)', padding: '0 12px', fontSize: 14, color: '#002D62', background: '#fff', boxSizing: 'border-box' }}>
              {Object.keys(DIVISIONS).map((key) => (
                <option key={key} value={key}>{DIVISIONS[key].name}</option>
              ))}
            </select>
          </div>

          <button disabled={submitting} onClick={confirmSubmit} style={{ height: 52, borderRadius: 14, background: '#002D62', color: '#fff', fontSize: 14.5, fontWeight: 700, border: 'none', width: '100%', cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Enviando…' : 'Confirmar y Enviar Ticket'}</button>
        </div>
      )}

      {screen === 'admin' && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#F4F6F9' }}>
          <div style={{ padding: '58px 20px 40px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1, overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#002D62' }}>Panel de Soporte</div>
                <div style={{ fontSize: 12.5, color: 'rgba(0,45,98,0.5)' }}>Ing. Colsein · Turno AM</div>
              </div>
              <div title="Cerrar sesión" onClick={logout} style={{ width: 44, height: 44, borderRadius: 22, background: '#002D62', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>IC</div>
            </div>

            {ticketsError && <div style={{ fontSize: 12.5, color: '#b3372f' }}>Error al cargar tickets: {ticketsError}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, background: '#fff', borderRadius: 16, padding: 14, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#002D62' }}>{ticketsLoading ? '…' : kpiTotal}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(0,45,98,0.5)', fontWeight: 600, textTransform: 'uppercase' }}>Total casos</div>
              </div>
              <div style={{ flex: 1, background: '#fff', borderRadius: 16, padding: 14, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#002D62' }}>3.5h</div>
                <div style={{ fontSize: 10.5, color: 'rgba(0,45,98,0.5)', fontWeight: 600, textTransform: 'uppercase' }}>Tiempo medio</div>
              </div>
              <div style={{ flex: 1, background: '#fff', borderRadius: 16, padding: 14, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#c0392b' }}>{ticketsLoading ? '…' : kpiCritical}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(0,45,98,0.5)', fontWeight: 600, textTransform: 'uppercase' }}>SLA crítico</div>
              </div>
            </div>

            <div style={{ display: 'flex', background: 'rgba(0,45,98,0.06)', borderRadius: 14, padding: 4, gap: 4, position: 'sticky', top: 0, zIndex: 2 }}>
              <button onClick={() => setAdminTab('resumen')} style={{ flex: 1, height: 38, borderRadius: 11, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: adminTab === 'resumen' ? '#002D62' : 'transparent', color: adminTab === 'resumen' ? '#fff' : '#002D62' }}>📊 Resumen</button>
              <button onClick={() => setAdminTab('tablero')} style={{ flex: 1, height: 38, borderRadius: 11, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: adminTab === 'tablero' ? '#002D62' : 'transparent', color: adminTab === 'tablero' ? '#fff' : '#002D62' }}>🗂 Tablero</button>
            </div>

            {adminTab === 'resumen' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tickets por estado</div>
                  {statusChart.map((bar) => (
                    <div key={bar.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 88, fontSize: 11.5, color: 'rgba(0,45,98,0.6)', fontWeight: 600, flexShrink: 0 }}>{bar.name}</div>
                      <div style={{ flex: 1, height: 14, borderRadius: 7, background: 'rgba(0,45,98,0.06)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 7, background: bar.color, width: `${bar.pct}%` }} />
                      </div>
                      <div style={{ width: 20, textAlign: 'right', fontSize: 12.5, fontWeight: 800, color: '#002D62', flexShrink: 0 }}>{bar.count}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tickets por tipo</div>
                  {typeChart.map((bar) => (
                    <div key={bar.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 88, fontSize: 11.5, color: 'rgba(0,45,98,0.6)', fontWeight: 600, flexShrink: 0 }}>{bar.name}</div>
                      <div style={{ flex: 1, height: 14, borderRadius: 7, background: 'rgba(0,45,98,0.06)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 7, background: bar.color, width: `${bar.pct}%` }} />
                      </div>
                      <div style={{ width: 20, textAlign: 'right', fontSize: 12.5, fontWeight: 800, color: '#002D62', flexShrink: 0 }}>{bar.count}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#fff', borderRadius: 18, padding: 16, border: '1px solid #E7EAF0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#002D62', textTransform: 'uppercase', letterSpacing: 0.5 }}>Carga por división</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gridTemplateRows: '1fr 0.9fr 0.75fr', gap: 6, height: 170, borderRadius: 14, overflow: 'hidden' }}>
                    <div onMouseEnter={() => setHoveredDiv('logica')} onClick={() => setHoveredDiv('logica')} style={{ gridColumn: '1', gridRow: '1 / 4', background: '#002D62', padding: 12, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Lógica y Control</div>
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{countLogica}</div>
                    </div>
                    <div onMouseEnter={() => setHoveredDiv('instrumentacion')} onClick={() => setHoveredDiv('instrumentacion')} style={{ gridColumn: '2', gridRow: '1', background: '#0B4A85', padding: 10, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>Instrumentación</div>
                      <div style={{ fontSize: 17, fontWeight: 800 }}>{countInstrumentacion}</div>
                    </div>
                    <div onMouseEnter={() => setHoveredDiv('potencia')} onClick={() => setHoveredDiv('potencia')} style={{ gridColumn: '2', gridRow: '2', background: '#12639C', padding: 10, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>Potencia</div>
                      <div style={{ fontSize: 15, fontWeight: 800 }}>{countPotencia}</div>
                    </div>
                    <div onMouseEnter={() => setHoveredDiv('sensorica')} onClick={() => setHoveredDiv('sensorica')} style={{ gridColumn: '2', gridRow: '3', background: '#00A3E0', padding: '8px 10px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontSize: 10, fontWeight: 700 }}>Sensórica</div>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>{countSensorica}</div>
                    </div>
                  </div>
                  {hoverInfo ? (
                    <div style={{ background: '#F4F6F9', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#002D62' }}>{hoverInfo.name}</div>
                      <div style={{ fontSize: 11.5, color: 'rgba(0,45,98,0.55)', lineHeight: 1.5 }}>{hoverInfo.desc}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'rgba(0,45,98,0.4)', textAlign: 'center' }}>Toca un bloque para ver el detalle</div>
                  )}
                </div>
              </div>
            )}

            {adminTab === 'tablero' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {kanbanGroups.map((group) => (
                  <div key={group.status} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #E7EAF0' }}>
                    <div onClick={() => toggleGroup(group.status)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', cursor: 'pointer', borderLeft: `5px solid ${group.color}` }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: '#002D62', flex: 1 }}>{group.status}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', background: group.color, borderRadius: 999, padding: '2px 9px', minWidth: 20, textAlign: 'center' }}>{group.count}</div>
                      <div style={{ fontSize: 15, color: 'rgba(0,45,98,0.4)', width: 16, textAlign: 'center' }}>{group.chevron}</div>
                    </div>

                    {group.isExpanded && (
                      <div>
                        {group.isEmpty && <div style={{ padding: '16px 14px 18px', fontSize: 12, color: 'rgba(0,45,98,0.35)' }}>Sin tickets en este estado</div>}
                        {group.tickets.map((ticket) => (
                          <div key={ticket.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: '1px solid rgba(0,45,98,0.06)' }}>
                            <div title={ticket.priority} style={{ width: 8, height: 8, borderRadius: '50%', background: ticket.priorityDot, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#002D62', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.equipo}</div>
                              <div style={{ fontSize: 11, color: 'rgba(0,45,98,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.divisionName} · {ticket.tipo} · {ticket.date}</div>
                            </div>
                            {ticket.isNotResolved && (
                              <button onClick={() => resolveTicket(ticket.id)} title="Marcar como resuelto" style={{ width: 32, height: 32, borderRadius: 10, border: 'none', background: 'rgba(39,174,96,0.12)', color: '#1e8449', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>✓</button>
                            )}
                            <select value={ticket.status} onChange={(e) => changeStatus(ticket.id, e.target.value)} style={{ appearance: 'none', border: 'none', borderRadius: 9, padding: '7px 10px', fontSize: 11.5, fontWeight: 700, background: ticket.statusBg, color: ticket.statusColor, flexShrink: 0 }}>
                              {STATUS_ORDER.map((st) => (
                                <option key={st} value={st}>{st}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toastMsg && (
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 34, background: '#002D62', color: '#fff', fontSize: 13, fontWeight: 600, borderRadius: 12, padding: '13px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', textAlign: 'center', zIndex: 50 }}>{toastMsg}</div>
      )}
    </div>
  );
}
