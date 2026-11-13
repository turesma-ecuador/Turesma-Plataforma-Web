"use client";

import { useConductorPanel, type ReservaConductor } from "../_components/use-conductor-panel";
import { LocationSharing } from "../_components/location-sharing";
import { WhatsAppButton } from "../../../components/whatsapp-button";
import {
  User, MapPin, Users, Zap, Clock, Check, X,
  Loader2, Bus, CheckCircle, Calendar, Navigation, Flag
} from "lucide-react";

// Fecha larga en español (ej. "lunes, 21 de julio de 2026").
const fmtFechaLarga = (f?: string | null) => {
  if (!f) return "—";
  const dateOnly = String(f).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)
    ? new Date(`${dateOnly}T12:00:00`)
    : new Date(f);
  if (Number.isNaN(d.getTime())) return String(f);
  return d.toLocaleDateString("es-EC", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
};

type NavPunto = { lat?: number | null; lng?: number | null; texto?: string | null };

const navTarget = (r: ReservaConductor): NavPunto => {
  const regresando = Boolean(r.ida_finalizada && r.fecha_regreso);
  if (regresando) {
    return !r.recogido
      ? { lat: r.destino_lat, lng: r.destino_lng, texto: r.destino || r.tour_ubicacion }
      : { lat: r.origen_lat, lng: r.origen_lng, texto: r.origen };
  }
  return !r.recogido
    ? { lat: r.origen_lat, lng: r.origen_lng, texto: r.origen }
    : { lat: r.destino_lat, lng: r.destino_lng, texto: r.destino || r.tour_ubicacion };
};

const regresoDisponible = (r: ReservaConductor) => {
  if (!r.fecha_regreso) return true;
  const inicio = new Date(`${String(r.fecha_regreso).slice(0, 10)}T${r.hora_regreso || "00:00"}`);
  return Number.isFinite(inicio.getTime()) && Date.now() >= inicio.getTime();
};

// ¿Hay algo a lo que navegar? (coordenadas o al menos una dirección de texto)
const tieneDestino = (t: NavPunto) => (t.lat != null && t.lng != null) || !!(t.texto && String(t.texto).trim());

// URL de Google Maps "cómo llegar" desde la ubicación actual hasta el objetivo.
const gmapsDir = (t: NavPunto) => {
  const dest = (t.lat != null && t.lng != null) ? `${t.lat},${t.lng}` : encodeURIComponent(String(t.texto || ""));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
};

const formatEstadoLabel = (estado: string) => {
  switch (estado) {
    case "confirmada": return "Confirmada";
    case "reprogramacion_pendiente": return "Cambio pendiente";
    case "en_curso": return "Viajando";
    case "finalizada": return "Finalizada";
    case "cancelada": return "Cancelada";
    case "pendiente": return "Pendiente";
    default: return estado || "Pendiente";
  }
};

const ESTADO_BADGE: Record<string, string> = {
  confirmada: "bg-blue-100 text-blue-700 border-blue-200",
  en_curso: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
};

const ESTADO_ICON: Record<string, React.ReactNode> = {
  confirmada: <Clock size={12} />,
  en_curso: <Zap size={12} />,
};

export default function ConductorActivasPage() {
  const { checkingSession, panel, msg, err, user, callAction, actionLoadingId } = useConductorPanel();

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  // Viaje en curso y a dónde debe ir el conductor AHORA:
  //  - si aún no recoge al cliente → al ORIGEN (punto de recogida)
  //  - si ya lo recogió → al DESTINO (donde lo lleva)
  const enCursoTrip = panel.activas.find(r => r.estado === "en_curso") || null;
  const mapTarget = (() => {
    const t = enCursoTrip;
    if (!t || t.requerimiento_id) return null;
    if (!t.recogido && t.origen_lat != null && t.origen_lng != null) {
      return { lat: Number(t.origen_lat), lng: Number(t.origen_lng), texto: `Recoger a ${t.usuario_nombre || "cliente"}` };
    }
    if (t.destino_lat != null && t.destino_lng != null) {
      return { lat: Number(t.destino_lat), lng: Number(t.destino_lng), texto: t.destino || t.tour_ubicacion || "Destino" };
    }
    return null;
  })();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* COMPARTIR UBICACIÓN EN TIEMPO REAL (ruta a recoger o al destino) */}
      <LocationSharing
        userId={user?.id ? Number(user.id) : undefined}
        destino={mapTarget}
      />

      {/* MENSAJES */}
      {msg && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl flex items-center gap-2">
          <Check size={16} /> {msg}
        </div>
      )}
      {err && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl flex items-center gap-2">
          <X size={16} /> {err}
        </div>
      )}

      {/* CONTENIDO */}
      {panel.activas.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-20 h-20 rounded-[1.5rem] bg-slate-100 flex items-center justify-center">
              <Zap size={40} className="text-slate-200" />
            </div>
            <p className="text-sm font-black uppercase text-slate-300 italic">Sin viajes activos</p>
            <p className="text-xs text-slate-400 font-bold">Los viajes en curso aparecerán aquí</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-5">
          {panel.activas.map((r) => {
            const isCustomOperation = Boolean(r.requerimiento_id);
            const actionId = r.operation_id || r.id;
            const badgeCls = ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente;
            const badgeIcon = ESTADO_ICON[r.estado] || null;
            const regresoEnCurso = Boolean(r.ida_finalizada && r.fecha_regreso);
            const regresoHabilitado = regresoDisponible(r);
            const destinoFinal = regresoEnCurso ? r.origen : (r.destino || r.tour_ubicacion);

            return (
              <article
                key={r.operation_id || r.id}
                className="bg-white rounded-2xl md:rounded-[2rem] border-2 border-red-200 shadow-sm overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                {/* Card Header */}
                <div className="bg-red-50/60 border-b border-red-100 px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#E31E24] text-white flex items-center justify-center">
                      <Zap size={18} />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900 text-base uppercase italic tracking-tighter">
                        {isCustomOperation
                          ? `Requerimiento #${r.requerimiento_id} · Reserva #${r.id}`
                          : `Reserva #${r.id}`}
                      </h3>
                      {isCustomOperation && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Grupo {r.grupo_numero} · Unidad {r.unidad_numero}
                        </p>
                      )}
                      {r.tour_titulo && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{r.tour_titulo}</p>
                      )}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-[9px] font-black uppercase border ${badgeCls}`}>
                    {badgeIcon} {formatEstadoLabel(r.estado || "pendiente")}
                  </span>
                </div>

                <div className="p-6 space-y-4">
                  {/* FECHA Y HORA DEL VIAJE */}
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
                    <div className="bg-blue-500/10 p-2.5 rounded-xl shrink-0"><Calendar size={18} className="text-blue-600" /></div>
                    <div>
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Fecha y hora del viaje</p>
                      <p className="text-sm font-black text-slate-900 capitalize">
                        {fmtFechaLarga(r.fecha_reserva)}
                        {r.hora_salida ? <span className="text-blue-600"> · {r.hora_salida}</span> : null}
                      </p>
                      {r.fecha_fin && r.fecha_fin !== r.fecha_reserva && (
                        <p className="text-[11px] font-bold text-blue-600 capitalize mt-0.5">Hasta el {fmtFechaLarga(r.fecha_fin)} (varios días)</p>
                      )}
                      {r.fecha_regreso && (
                        <p className="mt-1 text-[11px] font-bold capitalize text-emerald-700">
                          Regresar a recoger: {fmtFechaLarga(r.fecha_regreso)}{r.hora_regreso ? ` · ${r.hora_regreso}` : ""}
                        </p>
                      )}
                      {regresoEnCurso && r.estado === "confirmada" && (
                        <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                          Ida completada · regreso {regresoHabilitado ? "listo para iniciar" : "programado"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <User size={10} /> Cliente
                      </p>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <p className="font-black text-slate-900 text-sm truncate">{r.usuario_nombre || "—"}</p>
                        <WhatsAppButton telefono={r.usuario_telefono} title={`WhatsApp de ${r.usuario_nombre || "cliente"}`} mensaje={`Hola, soy su conductor de Turesma para la reserva #${r.id}.`} />
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <Users size={10} /> Pasajeros
                      </p>
                      <p className="font-black text-red-600 text-sm mt-2">{r.num_personas}</p>
                    </div>

                    {r.vehiculo_placa && (
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <Bus size={10} /> Vehículo
                        </p>
                        <p className="font-black text-slate-900 text-sm mt-2 uppercase italic tracking-tighter">{r.vehiculo_placa}</p>
                      </div>
                    )}
                  </div>

                  {/* Destino */}
                  {destinoFinal && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                      <p className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-2">
                        <MapPin size={12} /> {regresoEnCurso ? "Punto de llegada" : "Destino"}
                      </p>
                      <p className="text-sm font-bold text-red-900 mt-2">{destinoFinal}</p>
                    </div>
                  )}

                  {/* FASE DEL VIAJE EN CURSO: recoger primero, luego llevar */}
                  {r.estado === "en_curso" && !isCustomOperation && (
                    r.recogido ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
                        <Flag size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                            Ahora lleva al cliente {regresoEnCurso ? "de regreso a" : "a"}
                          </p>
                          <p className="text-sm font-black text-slate-900">{destinoFinal || "Destino"}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
                        <Navigation size={18} className="text-blue-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                            Primero ve a recoger al cliente {regresoEnCurso ? "en el destino" : "en"}
                          </p>
                          <p className="text-sm font-black text-slate-900">
                            {regresoEnCurso ? (r.destino || r.tour_ubicacion || "Destino") : (r.origen || "Punto de recogida")}
                          </p>
                          {!regresoEnCurso && r.referencia_recogida && (
                            <p className="mt-2 text-xs font-semibold text-blue-800">
                              Referencia: {r.referencia_recogida}
                            </p>
                          )}
                          {!regresoEnCurso && r.recogida_lat != null && r.recogida_lng != null && (
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${r.recogida_lat},${r.recogida_lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-700"
                            >
                              <Navigation size={12} /> Abrir punto de recogida
                            </a>
                          )}
                          <p className="text-[10px] text-slate-400 mt-1">Activa &ldquo;Compartir ubicación&rdquo; arriba para ver la ruta en el mapa.</p>
                        </div>
                      </div>
                    )
                  )}

                  {/* CÓMO LLEGAR EN GOOGLE MAPS (según la fase: recoger o destino) */}
                  {!isCustomOperation && (r.estado === "confirmada" || r.estado === "en_curso")
                    && (!regresoEnCurso || regresoHabilitado)
                    && tieneDestino(navTarget(r)) && (
                    <a
                      href={gmapsDir(navTarget(r))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 hover:bg-black text-white font-black text-[11px] uppercase tracking-widest transition-all"
                    >
                      <Navigation size={14} /> Cómo llegar {r.recogido
                        ? (regresoEnCurso ? "al origen" : "al destino")
                        : (regresoEnCurso ? "al cliente en el destino" : "al cliente")} (Google Maps)
                    </a>
                  )}

                  {/* ACCIONES DEL CONDUCTOR */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    {r.estado === "confirmada" && (
                      <button
                        onClick={() => callAction(actionId, "estado", { estado: "en_curso" }, isCustomOperation ? "operaciones" : "reservas")}
                        disabled={actionLoadingId === actionId || (!isCustomOperation && regresoEnCurso && !regresoHabilitado)}
                        className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actionLoadingId === actionId ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {isCustomOperation ? "Iniciar servicio" : regresoEnCurso && !regresoHabilitado ? "Regreso programado" : regresoEnCurso ? "Iniciar regreso" : "Iniciar viaje"}
                      </button>
                    )}
                    {r.estado === "en_curso" && isCustomOperation && (
                      <button
                        onClick={() => callAction(actionId, "estado", { estado: "completada" }, "operaciones")}
                        disabled={actionLoadingId === actionId}
                        className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                      >
                        {actionLoadingId === actionId ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Completar unidad
                      </button>
                    )}
                    {r.estado === "en_curso" && !isCustomOperation && !r.recogido && (
                      <button
                        onClick={() => callAction(r.id, "recoger")}
                        disabled={actionLoadingId === actionId}
                        className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                      >
                        {actionLoadingId === actionId ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Ya recogí al cliente
                      </button>
                    )}
                    {r.estado === "en_curso" && !isCustomOperation && r.recogido && (
                      <button
                        onClick={() => callAction(r.id, "estado", { estado: "finalizada" })}
                        disabled={actionLoadingId === actionId}
                        className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                      >
                        {actionLoadingId === actionId ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Finalizar viaje
                      </button>
                    )}
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-2">
                    <CheckCircle size={14} className="text-[#E31E24] flex-shrink-0" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {isCustomOperation
                        ? "El cliente recibirá una actualización al iniciar y cuando todas las unidades del servicio estén completas."
                        : r.fecha_regreso && !regresoEnCurso
                        ? "Al finalizar la ida, el regreso seguirá programado en esta reserva."
                        : "Al finalizar, el cliente podrá calificar su viaje"}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
