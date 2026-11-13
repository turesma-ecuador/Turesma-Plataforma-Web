"use client";

import React, { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  MapPin, Calendar, Users, Car, FileText, Clock, CheckCircle2,
  XCircle, Loader2, RefreshCw, Send, ArrowRight,
  DollarSign, ChevronDown, ChevronUp, Zap, Minus, Plus, Bus,
  Navigation, AlertCircle,
} from "lucide-react";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { useClienteGuard } from "../../../lib/use-cliente-guard";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { MapPicker, Punto } from "../../../components/map-picker";
import { VehiculoCalendario } from "../../../components/vehiculo-calendario";
import { calcularRuta, formatDuracion, reverseGeocode, RutaCalculada } from "../../../lib/leaflet";
import { formatLocalizedDate, LocalizedContent, useLocale } from "../../../lib/i18n";
import { ClientGuidedTour } from "../_components/client-guided-tour";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Vehiculo = { id: number; placa: string; tipo: string; modelo?: string | null; capacidad?: number; imagen_url?: string | null };
type Cotizacion = {
  id: number; origen: string; destino: string; fecha_servicio: string; fecha_fin?: string | null;
  fecha_regreso?: string | null; hora_regreso?: string | null;
  num_personas: number; tipo_vehiculo?: string | null; notas?: string | null;
  estado: string; precio_final?: number | null; valor_ofrecido?: number | null;
  turno?: string | null;
  duracion_valor?: number | null; duracion_unidad?: string | null; hora_salida?: string | null;
  respuesta_admin?: string | null; reserva_id?: number | null; creado_en: string;
  vehiculo_placa?: string | null; vehiculo_modelo?: string | null;
  num_viajes?: number | null; distancia_km?: number | null; precio_desglose?: any;
};
type CustomServiceGroup = {
  cantidad_vehiculos: string;
  tipo_vehiculo: string;
  pasajeros_por_vehiculo: string;
  fecha_servicio: string;
  fecha_fin: string;
  hora_salida: string;
  origen: string;
  destino: string;
  paradas: string;
  detalles: string;
  simultaneo: boolean;
};
type ServiceGroupView = {
  cantidad_vehiculos: number;
  tipo_vehiculo?: string | null;
  pasajeros_por_vehiculo?: number | null;
  fecha_servicio?: string | null;
  fecha_fin?: string | null;
  hora_salida?: string | null;
  origen?: string | null;
  destino?: string | null;
  paradas?: string | null;
  detalles?: string | null;
  simultaneo?: boolean;
};
type RequerimientoPersonalizado = {
  id: number;
  organizacion?: string | null;
  cantidad_vehiculos: number;
  tipo_vehiculo?: string | null;
  pasajeros_por_vehiculo?: number | null;
  service_groups?: ServiceGroupView[];
  fecha_servicio?: string | null;
  fecha_fin?: string | null;
  hora_salida?: string | null;
  origen?: string | null;
  destino?: string | null;
  detalles: string;
  estado: string;
  respuesta_admin?: string | null;
  precio_final?: number | null;
  creado_en: string;
};
const ESTADO_INFO: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pendiente: { label: "En revisión", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: <Clock size={14} className="text-amber-600" /> },
  aprobada: { label: "Aprobada ✓", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle2 size={14} className="text-emerald-600" /> },
  rechazada: { label: "No disponible", color: "text-red-600", bg: "bg-red-50 border-red-200", icon: <XCircle size={14} className="text-red-500" /> },
};

const INPUT = "w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:text-slate-300 placeholder:font-normal";

// Tope de días seguidos que puede reservar el cliente en un solo servicio.
const MAX_DIAS = 365;
const createEmptyServiceGroup = (): CustomServiceGroup => ({
  cantidad_vehiculos: "1",
  tipo_vehiculo: "",
  pasajeros_por_vehiculo: "",
  fecha_servicio: "",
  fecha_fin: "",
  hora_salida: "",
  origen: "",
  destino: "",
  paradas: "",
  detalles: "",
  simultaneo: false,
});
const WIZARD_STEPS = [
  { label: "Ruta", title: "¿A dónde necesitas viajar?", guidance: "Indica tu punto de salida y destino. Puedes buscar una dirección o ajustar el marcador en el mapa." },
  { label: "Fechas", title: "¿Cuándo será tu viaje?", guidance: "Elige la fecha, horario y pasajeros. Si necesitas varios días o regresar después, selecciona la opción correspondiente." },
  { label: "Vehículo", title: "Elige una categoría", guidance: "Selecciona la categoría que prefieres. La unidad específica se asignará después de confirmar el pago." },
  { label: "Resumen", title: "Revisa antes de enviar", guidance: "Confirma que los datos del viaje sean correctos. Administración revisará tu solicitud y te enviará el precio." },
];

// Cantidad de días que abarca un rango (ambos extremos incluidos).
const diasEntre = (a: string, b: string) => {
  if (!a || !b) return 1;
  const d1 = new Date(a + "T00:00"), d2 = new Date(b + "T00:00");
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
};

const siguienteFecha = (fecha: string) => {
  const date = new Date(`${fecha}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function ClienteCotizarPage() {
  const { language } = useLocale();
  const { user, checkingSession } = useClienteGuard();
  const dateLocale = language === "en" ? "en-US" : "es-EC";
  const userId = user?.id;
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(true);
  const [sending, setSending] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [formErr, setFormErr] = useState("");
  const [route, setRoute] = useState<RutaCalculada | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const categorias = Array.from(
    vehiculos.reduce((result, vehiculo) => {
      const tipo = String(vehiculo.tipo || "van").trim().toLowerCase();
      const current = result.get(tipo);
      result.set(tipo, {
        tipo,
        capacidad: Math.max(current?.capacidad || 0, Number(vehiculo.capacidad) || 0),
        imagen_url: current?.imagen_url || vehiculo.imagen_url || null,
      });
      return result;
    }, new Map<string, { tipo: string; capacidad: number; imagen_url: string | null }>())
      .values()
  );

  const [form, setForm] = useState({
    fecha_servicio: "", fecha_fin: "", fecha_regreso: "", hora_regreso: "", num_personas: "1",
    num_viajes: "1", tipo_vehiculo: "van", hora_salida: "", notas: "", modalidad_servicio: "dia", duracion_horas: "2",
  });
  const [customRequest, setCustomRequest] = useState({
    organizacion: "",
    detalles: "",
    grupos_servicio: [createEmptyServiceGroup()],
  });
  const [customRequests, setCustomRequests] = useState<RequerimientoPersonalizado[]>([]);
  const [showCustomRequest, setShowCustomRequest] = useState(false);
  const [sendingCustomRequest, setSendingCustomRequest] = useState(false);
  const [customRequestError, setCustomRequestError] = useState("");
  const [customRequestMessage, setCustomRequestMessage] = useState("");
  const [wizardStep, setWizardStep] = useState(1);
  const wizardHeaderRef = useRef<HTMLDivElement>(null);
  // false = servicio de un solo día · true = reserva de varios días (rango)
  const [variosDias, setVariosDias] = useState(false);
  const [regresoOtraFecha, setRegresoOtraFecha] = useState(false);
  const [origin, setOrigin] = useState<Punto | null>(null);
  const [destination, setDestination] = useState<Punto | null>(null);
  const [locatingOrigin, setLocatingOrigin] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const onMapChange = (which: "origin" | "destination", val: Punto) => {
    if (which === "origin") setOrigin(val); else setDestination(val);
  };
  const step = (field: "num_personas", delta: number, min: number) =>
    setForm(p => ({ ...p, [field]: String(Math.max(min, (Number(p[field]) || min) + delta)) }));

  // Detecta la ubicación actual del cliente y la usa como punto de salida por
  // defecto, así solo tiene que marcar el destino en el mapa.
  const locateMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Tu dispositivo no soporta ubicación automática. Marca la salida manualmente en el mapa.");
      return;
    }
    setLocatingOrigin(true); setLocationError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const label = await reverseGeocode(latitude, longitude);
        setOrigin({ lat: latitude, lng: longitude, label });
        setFocusSignal((s) => s + 1);
        setLocatingOrigin(false);
      },
      () => {
        setLocationError("No se pudo detectar tu ubicación. Marca la salida manualmente en el mapa.");
        setLocatingOrigin(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // Al abrir la página, intenta ubicar al cliente automáticamente.
  useEffect(() => { locateMyLocation();   }, []);

  const loadVehiculos = async () => {
    try {
      const res = await fetch(`${API}/api/usuarios/vehiculos`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setVehiculos(list);
        const tipos = Array.from(new Set(list.map((vehiculo: Vehiculo) => String(vehiculo.tipo || "van").trim().toLowerCase())));
        setForm(current => {
          const tipoVehiculo = tipos.includes(current.tipo_vehiculo) ? current.tipo_vehiculo : tipos[0] || "";
          return tipoVehiculo === current.tipo_vehiculo ? current : { ...current, tipo_vehiculo: tipoVehiculo };
        });
      }
    } catch { /* silencio */ }
  };

  const loadCotizaciones = async (silencioso = false) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API}/api/cotizaciones/mias`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) setCotizaciones(await res.json());
    } catch { /* silencio */ }
  };

  const loadCustomRequests = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API}/api/requerimientos-personalizados/mios`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los requerimientos");
      setCustomRequests(Array.isArray(data) ? data : []);
      setCustomRequestError("");
    } catch (error) {
      setCustomRequestError(error instanceof Error ? error.message : "No se pudieron cargar los requerimientos");
    }
  };

  const submitCustomRequest = async (event: FormEvent) => {
    event.preventDefault();
    setSendingCustomRequest(true);
    setCustomRequestError("");
    setCustomRequestMessage("");
    try {
      const res = await fetch(`${API}/api/requerimientos-personalizados`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...customRequest,
          grupos_servicio: customRequest.grupos_servicio.map(group => ({
            ...group,
            cantidad_vehiculos: Number(group.cantidad_vehiculos),
            pasajeros_por_vehiculo: group.pasajeros_por_vehiculo
              ? Number(group.pasajeros_por_vehiculo)
              : null,
          })),
        }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el requerimiento");
      setCustomRequestMessage(`Requerimiento #${data.id} enviado. El equipo revisará los detalles y responderá desde aquí.`);
      setCustomRequest({
        organizacion: "",
        detalles: "",
        grupos_servicio: [createEmptyServiceGroup()],
      });
      await loadCustomRequests();
    } catch (error) {
      setCustomRequestError(error instanceof Error ? error.message : "No se pudo enviar el requerimiento");
    } finally {
      setSendingCustomRequest(false);
    }
  };

  const updateCustomServiceGroup = (index: number, patch: Partial<CustomServiceGroup>) => {
    setCustomRequest(current => ({
      ...current,
      grupos_servicio: current.grupos_servicio.map((group, groupIndex) =>
        groupIndex === index ? { ...group, ...patch } : group
      ),
    }));
  };

  const copyPreviousServiceGroup = (index: number) => {
    if (index < 1) return;
    const previous = customRequest.grupos_servicio[index - 1];
    updateCustomServiceGroup(index, {
      fecha_servicio: previous.fecha_servicio,
      fecha_fin: previous.fecha_fin,
      hora_salida: previous.hora_salida,
      origen: previous.origen,
      destino: previous.destino,
      paradas: previous.paradas,
      simultaneo: previous.simultaneo,
    });
  };

  useEffect(() => {
    if (checkingSession || !userId) return;
    loadVehiculos(); loadCotizaciones(); loadCustomRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingSession, userId]);

  useEffect(() => {
    if (!origin || !destination) { setRoute(null); return; }
    let cancelled = false;
    setRouteLoading(true);
    calcularRuta(origin, destination).then(result => { if (!cancelled) setRoute(result); }).finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [origin, destination]);

  useAutoRefresh(() => {
    loadVehiculos();
    loadCotizaciones(true);
    loadCustomRequests();
  }, { enabled: !checkingSession && !!userId, intervalMs: 5000, immediate: false });

  const getStepError = (stepNumber: number) => {
    if (stepNumber === 1 && (!origin || !destination)) {
      return "Marca el punto de salida y el destino en el mapa.";
    }
    if (stepNumber === 2) {
      if (!form.fecha_servicio) return "Selecciona la fecha de inicio del servicio.";
      if (variosDias && !form.fecha_fin) return "Toca también el último día del viaje en el calendario.";
      if (!form.hora_salida) return "Indica la hora de salida que prefieres.";
      if (regresoOtraFecha && (!form.fecha_regreso || !form.hora_regreso)) {
        return "Indica la fecha y hora para recoger al regreso.";
      }
      if (regresoOtraFecha && form.fecha_regreso <= form.fecha_servicio) {
        return "La fecha de regreso debe ser posterior a la fecha de salida.";
      }
      if (variosDias && form.fecha_fin && diasEntre(form.fecha_servicio, form.fecha_fin) > MAX_DIAS) {
        return `El servicio no puede superar los ${MAX_DIAS} días seguidos.`;
      }
    }
    if (stepNumber === 3) {
      const capacity = categorias.find(({ tipo }) => tipo === form.tipo_vehiculo)?.capacidad || 0;
      if (!capacity) return "Selecciona una categoría de vehículo disponible.";
      if (Number(form.num_personas) > capacity) {
        return `La categoría seleccionada admite hasta ${capacity} pasajeros. Elige otra categoría.`;
      }
    }
    return "";
  };

  const goToStep = (stepNumber: number) => {
    setWizardStep(stepNumber);
    setFormErr("");
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => wizardHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const advanceStep = () => {
    const error = getStepError(wizardStep);
    if (error) { setFormErr(error); return; }
    goToStep(Math.min(4, wizardStep + 1));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (wizardStep < 4) { advanceStep(); return; }
    for (const stepNumber of [1, 2, 3]) {
      const error = getStepError(stepNumber);
      if (error) {
        setWizardStep(stepNumber);
        setFormErr(error);
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => wizardHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }
        return;
      }
    }
    if (!origin || !destination) {
      setWizardStep(1);
      setFormErr("Marca el punto de salida y el destino en el mapa.");
      return;
    }
    setSending(true); setFormErr(""); setFormMsg("");
    try {
      const res = await fetch(`${API}/api/cotizaciones`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          ...form,
          fecha_fin: variosDias ? form.fecha_fin || null : null,
          origen: origin.label,
          destino: destination.label,
          origen_lat: origin.lat, origen_lng: origin.lng,
          destino_lat: destination.lat, destino_lng: destination.lng,
          num_personas: Number(form.num_personas) || 1,
          num_viajes: Number(form.num_viajes) || 1,
          tipo_vehiculo: form.tipo_vehiculo,
          modalidad_servicio: variosDias ? "varios_dias" : form.modalidad_servicio,
          duracion_horas: form.modalidad_servicio === "horas" ? Number(form.duracion_horas) || 1 : null,
          hora_salida: form.hora_salida || null,
          fecha_regreso: regresoOtraFecha ? form.fecha_regreso : null,
          hora_regreso: regresoOtraFecha ? form.hora_regreso : null,
        }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar");
      if (data.approval_url) {
        window.location.assign(data.approval_url);
        return;
      }
      setFormMsg("Solicitud de cotización enviada. Administración revisará tu destino y datos, definirá el precio y te avisará cuando puedas aceptarlo y pagar el anticipo desde Historial.");
      setForm({ fecha_servicio: "", fecha_fin: "", fecha_regreso: "", hora_regreso: "", num_personas: "1", num_viajes: "1", tipo_vehiculo: categorias[0]?.tipo || "van", hora_salida: "", notas: "", modalidad_servicio: "dia", duracion_horas: "2" });
      setWizardStep(1);
      setVariosDias(false);
      setRegresoOtraFecha(false);
      setOrigin(null); setDestination(null);
      locateMyLocation();
      loadCotizaciones();
    } catch (e) { setFormErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSending(false); }
  };

  const tipoSeleccionado = form.tipo_vehiculo.toString().trim().toLowerCase();
  const selectedDays = form.fecha_servicio && variosDias && form.fecha_fin ? diasEntre(form.fecha_servicio, form.fecha_fin) : 1;
  const selectedTrips = Math.max(1, Number(form.num_viajes) || 1);
  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>
  );

  return (
    <LocalizedContent>
    <div className="space-y-6">

      <div className="flex justify-end">
        <ClientGuidedTour variant="booking" />
      </div>

      {false && <section className="overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-lg">
        <button type="button" onClick={() => { setShowCustomRequest(value => !value); setCustomRequestError(""); }}
          aria-expanded={showCustomRequest}
          className="flex w-full items-center justify-between gap-4 bg-[linear-gradient(115deg,#312e81,#6d28d9)] p-5 text-left text-white transition hover:brightness-110 sm:p-6">
          <span className="flex min-w-0 items-center gap-3">
            <span className="rounded-2xl bg-white/15 p-3"><FileText size={20} /></span>
            <span>
              <span className="block text-sm font-black uppercase tracking-wide">Requerimiento personalizado</span>
              <span className="mt-1 block text-xs font-medium text-violet-100">¿Necesitas varios vehículos o un servicio especial? Cuéntanos todos los detalles.</span>
            </span>
          </span>
          {showCustomRequest ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>

        {showCustomRequest && (
          <div className="space-y-5 p-5 sm:p-6">
            <div className="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-xs leading-relaxed text-violet-900">
              Describe aquí solicitudes que requieren coordinación especial, por ejemplo, grupos grandes, varios buses, más de una ruta, horarios escalonados, paradas o servicios para una empresa. Enviar el requerimiento no confirma disponibilidad ni reserva unidades.
            </div>
            <form onSubmit={submitCustomRequest} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="custom-organization" className="text-[10px] font-black uppercase tracking-widest text-slate-500">Empresa u organización (opcional)</label>
                  <input id="custom-organization" maxLength={200} value={customRequest.organizacion}
                    onChange={event => setCustomRequest(current => ({ ...current, organizacion: event.target.value }))}
                    className={INPUT} placeholder="Nombre de la empresa" />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-700">Grupos de servicio</h3>
                    <p className="mt-1 text-[11px] text-slate-500">Cada grupo reúne vehículos que comparten tipo, ruta y horario. Agrega otro grupo si cambia alguno de esos datos.</p>
                  </div>
                  <button type="button" disabled={customRequest.grupos_servicio.length >= 20}
                    onClick={() => setCustomRequest(current => ({ ...current, grupos_servicio: [...current.grupos_servicio, createEmptyServiceGroup()] }))}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-violet-800 hover:bg-violet-100 disabled:opacity-50">
                    <Plus size={14} /> Agregar grupo
                  </button>
                </div>
                {customRequest.grupos_servicio.map((group, index) => (
                  <section key={index} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-black text-slate-800">Grupo {index + 1}</h4>
                      <div className="flex items-center gap-2">
                        {index > 0 && (
                          <button type="button" onClick={() => copyPreviousServiceGroup(index)}
                            className="rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wide text-violet-700 hover:bg-violet-100">
                            Copiar ruta y horario anterior
                          </button>
                        )}
                        {customRequest.grupos_servicio.length > 1 && (
                          <button type="button" onClick={() => setCustomRequest(current => ({
                            ...current,
                            grupos_servicio: current.grupos_servicio.filter((_, groupIndex) => groupIndex !== index),
                          }))}
                            className="rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wide text-red-600 hover:bg-red-50">
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-count-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cantidad de vehículos *</label>
                        <input id={`custom-count-${index}`} type="number" min={1} max={1000} required value={group.cantidad_vehiculos}
                          onChange={event => updateCustomServiceGroup(index, { cantidad_vehiculos: event.target.value })}
                          className={INPUT} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-type-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tipo de vehículo</label>
                        <input id={`custom-type-${index}`} maxLength={100} value={group.tipo_vehiculo}
                          onChange={event => updateCustomServiceGroup(index, { tipo_vehiculo: event.target.value })}
                          className={INPUT} placeholder="Ej: SUV, bus" />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-passengers-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pasajeros por vehículo</label>
                        <input id={`custom-passengers-${index}`} type="number" min={1} max={1000} value={group.pasajeros_por_vehiculo}
                          onChange={event => updateCustomServiceGroup(index, { pasajeros_por_vehiculo: event.target.value })}
                          className={INPUT} placeholder="Ej: 40" />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-date-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Fecha de inicio</label>
                        <input id={`custom-date-${index}`} type="date" value={group.fecha_servicio}
                          onChange={event => updateCustomServiceGroup(index, { fecha_servicio: event.target.value })}
                          className={INPUT} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-end-date-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Fecha final</label>
                        <input id={`custom-end-date-${index}`} type="date" min={group.fecha_servicio || undefined} value={group.fecha_fin}
                          onChange={event => updateCustomServiceGroup(index, { fecha_fin: event.target.value })}
                          className={INPUT} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`custom-time-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Hora de salida</label>
                        <input id={`custom-time-${index}`} type="time" value={group.hora_salida}
                          onChange={event => updateCustomServiceGroup(index, { hora_salida: event.target.value })}
                          className={INPUT} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor={`custom-origin-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Punto de salida</label>
                        <input id={`custom-origin-${index}`} maxLength={300} value={group.origen}
                          onChange={event => updateCustomServiceGroup(index, { origen: event.target.value })}
                          className={INPUT} placeholder="Ciudad, dirección o lugar de encuentro" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor={`custom-destination-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Destino o destinos</label>
                        <input id={`custom-destination-${index}`} maxLength={300} value={group.destino}
                          onChange={event => updateCustomServiceGroup(index, { destino: event.target.value })}
                          className={INPUT} placeholder="Puedes incluir varios destinos" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor={`custom-stops-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Paradas</label>
                        <input id={`custom-stops-${index}`} maxLength={1000} value={group.paradas}
                          onChange={event => updateCustomServiceGroup(index, { paradas: event.target.value })}
                          className={INPUT} placeholder="Opcional" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <label htmlFor={`custom-group-notes-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">Indicaciones para este grupo</label>
                        <input id={`custom-group-notes-${index}`} maxLength={2000} value={group.detalles}
                          onChange={event => updateCustomServiceGroup(index, { detalles: event.target.value })}
                          className={INPUT} placeholder="Horarios escalonados, equipaje, necesidades especiales..." />
                      </div>
                      <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">
                        <input type="checkbox" checked={group.simultaneo}
                          onChange={event => updateCustomServiceGroup(index, { simultaneo: event.target.checked })}
                          className="mt-0.5 accent-violet-700" />
                        Los vehículos de este grupo deben operar simultáneamente
                      </label>
                    </div>
                  </section>
                ))}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="custom-details" className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cuéntanos qué necesitas *</label>
                <textarea id="custom-details" required minLength={10} maxLength={5000} rows={6}
                  value={customRequest.detalles}
                  onChange={event => setCustomRequest(current => ({ ...current, detalles: event.target.value }))}
                  className={INPUT + " resize-y"}
                  placeholder="Incluye todo lo importante: cantidad y tipo de vehículos, horarios de cada grupo, rutas, paradas, duración, equipaje, necesidades especiales y cualquier otro detalle para preparar la propuesta." />
                <p className="text-right text-[10px] font-semibold text-slate-400">{customRequest.detalles.length}/5000</p>
              </div>
              {customRequestError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{customRequestError}</p>}
              {customRequestMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{customRequestMessage}</p>}
              <button type="submit" disabled={sendingCustomRequest}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-700 px-5 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-md transition hover:bg-violet-900 disabled:opacity-60 sm:w-auto">
                {sendingCustomRequest ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sendingCustomRequest ? "Enviando requerimiento..." : "Enviar requerimiento"}
              </button>
            </form>

            {customRequests.length > 0 && (
              <div className="space-y-3 border-t border-slate-100 pt-5">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-700">Mis requerimientos personalizados</h2>
                {customRequests.map(request => (
                  <article key={request.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-800">Requerimiento #{request.id}</p>
                      <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase ${
                        request.estado === "respondido" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : request.estado === "cerrado" ? "border-slate-200 bg-white text-slate-500"
                            : request.estado === "en_revision" ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}>
                        {request.estado === "en_revision" ? "En revisión" : request.estado === "respondido" ? "Respondido" : request.estado === "cerrado" ? "Cerrado" : "Pendiente"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      {request.cantidad_vehiculos} vehículo(s)
                      {request.organizacion ? ` · ${request.organizacion}` : ""}
                    </p>
                    {request.precio_final != null && (
                      <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">
                        Precio propuesto: ${Number(request.precio_final).toFixed(2)}
                      </p>
                    )}
                    {(request.service_groups?.length ? request.service_groups : [{
                      cantidad_vehiculos: request.cantidad_vehiculos,
                      tipo_vehiculo: request.tipo_vehiculo,
                      pasajeros_por_vehiculo: request.pasajeros_por_vehiculo,
                      fecha_servicio: request.fecha_servicio,
                      fecha_fin: request.fecha_fin,
                      hora_salida: request.hora_salida,
                      origen: request.origen,
                      destino: request.destino,
                      paradas: null,
                      detalles: null,
                      simultaneo: false,
                    }]).map((group, groupIndex) => (
                      <div key={groupIndex} className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Grupo {groupIndex + 1}</p>
                        <p className="mt-1 text-xs font-bold text-slate-700">
                          {group.cantidad_vehiculos} vehículo(s)
                          {group.tipo_vehiculo ? ` · ${group.tipo_vehiculo}` : ""}
                          {group.pasajeros_por_vehiculo ? ` · ${group.pasajeros_por_vehiculo} pasajeros por unidad` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {group.origen || "Salida por definir"} → {group.destino || "Destino por definir"}
                          {group.fecha_servicio ? ` · ${new Date(`${String(group.fecha_servicio).slice(0, 10)}T00:00:00`).toLocaleDateString(dateLocale)}` : ""}
                          {group.hora_salida ? ` · ${group.hora_salida}` : ""}
                        </p>
                        {group.paradas && <p className="mt-1 text-xs text-slate-500">Paradas: {group.paradas}</p>}
                        {group.detalles && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{group.detalles}</p>}
                        {group.simultaneo && <p className="mt-1 text-[10px] font-bold text-violet-700">Operación simultánea solicitada</p>}
                      </div>
                    ))}
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{request.detalles}</p>
                    {request.respuesta_admin && (
                      <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-blue-700">Respuesta de Turesma</p>
                        <p className="mt-1 whitespace-pre-line text-sm text-blue-900">{request.respuesta_admin}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>}

      {/* TOGGLE FORM */}
      <button onClick={() => { setShowForm(f => !f); setFormErr(""); setFormMsg(""); }}
        className={`w-full flex items-center justify-between p-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg ${showForm ? "bg-slate-800 text-white" : "bg-[#E31E24] text-white hover:bg-red-700"}`}>
        <span className="flex items-center gap-3"><div className="bg-white/20 p-2 rounded-xl"><FileText size={18} /></div>{showForm ? "Ocultar formulario" : "Nueva solicitud de servicio"}</span>
        {showForm ? <ChevronUp size={18} /> : <ArrowRight size={18} />}
      </button>

      {/* FORM */}
      {showForm && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6">

            <div ref={wizardHeaderRef} className="scroll-mt-24 rounded-2xl bg-slate-50 p-4" aria-label="Progreso de solicitud">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-slate-700">Paso {wizardStep} de 4</p>
                <p className="text-[10px] font-bold text-slate-400">{wizardStep === 2 ? "Fecha y pasajeros" : WIZARD_STEPS[wizardStep - 1].label}</p>
              </div>
              <ol className="grid grid-cols-4 gap-2" aria-label="Pasos de la solicitud">
                {WIZARD_STEPS.map(({ label }, index) => {
                  const stepNumber = index + 1;
                  const completed = stepNumber < wizardStep;
                  const current = stepNumber === wizardStep;
                  return (
                    <li key={label}>
                      <button type="button" disabled={!completed} onClick={() => goToStep(stepNumber)}
                        aria-current={current ? "step" : undefined}
                        className={`w-full rounded-xl px-1 py-2 text-[10px] font-black transition sm:text-xs ${current ? "bg-red-50 text-[#E31E24]" : completed ? "text-slate-600 hover:bg-white" : "cursor-default text-slate-400"}`}>
                        <span className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] ${current ? "bg-[#E31E24] text-white" : completed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                          {completed ? <CheckCircle2 size={14} /> : stepNumber}
                        </span>
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <h2 className="text-sm font-black text-slate-800">{WIZARD_STEPS[wizardStep - 1].title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{WIZARD_STEPS[wizardStep - 1].guidance}</p>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden="true">
                {WIZARD_STEPS.map(({ label }, index) => (
                  <div key={label} className={`h-1 rounded-full ${index < wizardStep ? "bg-[#E31E24]" : "bg-slate-200"}`} />
                ))}
              </div>
            </div>

            <div className={`space-y-6 ${wizardStep === 3 ? "" : "hidden"}`}>
            {/* PASO 1: PREFERENCIA DE CATEGORÍA */}
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><Car size={12} /> 3. Elige una categoría de vehículo</p>
              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-blue-700" />
                <p>Las fotos son referenciales. Elegir una categoría indica tu preferencia, pero <strong>no reserva un vehículo ni una placa específica</strong>. Despacho asignará una unidad disponible después de confirmar el pago.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {categorias.map(({ tipo, capacidad, imagen_url }) => {
                  const selected = tipoSeleccionado === tipo;
                  const exceedsCapacity = Number(form.num_personas) > capacidad;
                  return (
                    <button key={tipo} type="button" disabled={exceedsCapacity}
                      onClick={() => setForm(p => ({ ...p, tipo_vehiculo: tipo }))}
                      aria-pressed={selected}
                      className={`flex h-full flex-col overflow-hidden rounded-2xl border-2 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 ${selected ? "border-[#E31E24] bg-red-50/70 ring-4 ring-red-100 shadow-md shadow-red-100" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"} ${exceedsCapacity ? "cursor-not-allowed opacity-45" : ""}`}>
                      <span className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100">
                        {imagen_url ? (
                          <Image
                            src={imagen_url}
                            alt={`Foto referencial de la flota: categoría ${tipo}`}
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                            unoptimized
                            className="object-cover"
                          />
                        ) : (
                          <span className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                            <Bus size={30} />
                            <span className="text-[10px] font-bold">Foto de esta categoría no disponible</span>
                          </span>
                        )}
                        <span className="absolute bottom-2 left-2 rounded-full bg-slate-950/75 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white">
                          Foto referencial
                        </span>
                        {selected && (
                          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#E31E24] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-white shadow">
                            <CheckCircle2 size={12} /> Seleccionado
                          </span>
                        )}
                      </span>
                      <span className="block flex-1 p-4">
                      <span className="flex items-center justify-between">
                        <span className="flex items-center gap-2 font-black capitalize text-slate-800"><Bus size={18} className="text-[#E31E24]" />{tipo}</span>
                      </span>
                      <span className="mt-2 block text-xs font-semibold text-slate-500">Hasta {capacidad} pasajeros</span>
                      <span className="mt-1 block text-xs font-bold text-slate-700">Precio según cotización del administrador</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {categorias.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">No hay categorías de vehículos disponibles en este momento.</p>}
            </div>

            </div>

            {/* PASO 2: FECHA (calendario con días reservados bloqueados) */}
            <div className={`space-y-4 ${wizardStep === 2 ? "" : "hidden"}`}>
              <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><Calendar size={12} /> 2. Fecha del servicio</p>
              <p className="text-xs text-slate-500">
                {variosDias
                  ? "Selecciona la fecha de salida y luego el último día del servicio. La disponibilidad se confirma al revisar tu solicitud."
                  : regresoOtraFecha
                    ? "Elige la fecha del viaje. Después seleccionarás la fecha de recogida de regreso."
                    : "Elige la fecha de salida que prefieres. La disponibilidad final se confirma después de revisar tu solicitud."}
              </p>

              {/* Un día o varios días */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100 rounded-2xl p-1">
                <button type="button"
                  onClick={() => { setVariosDias(false); setForm(p => ({ ...p, fecha_fin: "" })); }}
                  className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${!variosDias ? "bg-white text-[#E31E24] shadow" : "text-slate-400"}`}>
                  Un día
                </button>
                <button type="button"
                  onClick={() => {
                    setVariosDias(true);
                    setRegresoOtraFecha(false);
                    setForm(p => ({ ...p, fecha_regreso: "", hora_regreso: "" }));
                  }}
                  disabled={regresoOtraFecha}
                  className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40 ${variosDias ? "bg-white text-[#E31E24] shadow" : "text-slate-400"}`}>
                  Varios días
                </button>
              </div>

              <VehiculoCalendario
                localized
                vehiculoId={null}
                value={form.fecha_servicio}
                onSelect={(f) => setForm(p => ({
                  ...p,
                  fecha_servicio: f,
                  ...(p.fecha_regreso && p.fecha_regreso <= f ? { fecha_regreso: "", hora_regreso: "" } : {}),
                }))}
                range={variosDias}
                endValue={form.fecha_fin}
                onSelectEnd={(f) => setForm(p => ({ ...p, fecha_fin: f }))}
                maxDays={MAX_DIAS}
                allowUnassigned
              />

              {/* Resumen del rango elegido */}
              {form.fecha_servicio && (
                <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-slate-500 bg-emerald-50 border border-emerald-200 rounded-xl py-2 px-3">
                  <Calendar size={13} className="text-emerald-600" />
                  {variosDias && form.fecha_fin
                    ? <span>Del <b className="text-slate-700">{new Date(form.fecha_servicio + "T00:00").toLocaleDateString(dateLocale)}</b> al <b className="text-slate-700">{new Date(form.fecha_fin + "T00:00").toLocaleDateString(dateLocale)}</b> · {diasEntre(form.fecha_servicio, form.fecha_fin)} días</span>
                    : <span><b className="text-slate-700">{new Date(form.fecha_servicio + "T00:00").toLocaleDateString(dateLocale)}</b>{variosDias ? " — elige el último día" : " · 1 día"}</span>}
                </div>
              )}
              </div>
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                <label htmlFor="hora-salida" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
                  <Clock size={14} className="text-[#E31E24]" /> Hora de salida <span className="text-[#E31E24]">*</span>
                </label>
                <input
                  id="hora-salida"
                  type="time"
                  value={form.hora_salida}
                  onChange={e => setForm(p => ({ ...p, hora_salida: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#E31E24] sm:w-auto"
                />
                <p className="text-[11px] text-slate-500">Indica la hora en que deseas iniciar el viaje.</p>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={regresoOtraFecha}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setRegresoOtraFecha(enabled);
                      if (enabled) {
                        setVariosDias(false);
                        setForm(current => ({ ...current, fecha_fin: "" }));
                      } else {
                        setForm(current => ({ ...current, fecha_regreso: "", hora_regreso: "" }));
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300 accent-[#E31E24]"
                  />
                  Regreso en otra fecha
                </label>
                {regresoOtraFecha && (
                  <>
                    <p className="text-xs leading-relaxed text-slate-500">
                      Te llevamos al destino y regresamos a recogerte en la fecha acordada para volver al punto de salida.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <p className="text-xs font-black uppercase tracking-wide text-slate-600">Fecha de recogida <span className="text-[#E31E24]">*</span></p>
                        <VehiculoCalendario
                          localized
                          vehiculoId={null}
                          value={form.fecha_regreso}
                          onSelect={(fecha) => setForm(current => ({ ...current, fecha_regreso: fecha }))}
                          minDate={form.fecha_servicio ? siguienteFecha(form.fecha_servicio) : ""}
                          selectionLabel="Fecha de recogida"
                          allowUnassigned
                        />
                      </div>
                      <label htmlFor="hora-regreso" className="space-y-1 text-xs font-black uppercase tracking-wide text-slate-600">
                        Hora de recogida <span className="text-[#E31E24]">*</span>
                        <input
                          id="hora-regreso"
                          type="time"
                          required
                          value={form.hora_regreso}
                          onChange={event => setForm(current => ({ ...current, hora_regreso: event.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold normal-case text-slate-700 outline-none focus:border-[#E31E24]"
                        />
                      </label>
                    </div>
                    <p className="text-[11px] font-medium text-slate-500">El regreso será desde el destino hasta el punto de salida original. No se cobrará como espera de varios días.</p>
                  </>
                )}
              </div>
              <div className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-500 flex items-center gap-1.5"><Users size={14} /> Personas</span>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => step("num_personas", -1, 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Minus size={14} /></button>
                  <span className="w-6 text-center font-black text-slate-800">{form.num_personas}</span>
                  <button type="button" onClick={() => step("num_personas", 1, 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Plus size={14} /></button>
                </div>
              </div>
            </div>

            {/* PASO 3: MAPA origen/destino */}
            <div className={`space-y-2 ${wizardStep === 1 ? "" : "hidden"}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><MapPin size={12} /> 1. Indica la ruta</p>
                <button type="button" onClick={locateMyLocation} disabled={locatingOrigin}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 disabled:opacity-50">
                  {locatingOrigin ? <Loader2 size={12} className="animate-spin" /> : <Navigation size={12} />} Usar mi ubicación actual
                </button>
              </div>

              {locatingOrigin && (
                <p className="text-[11px] text-blue-500 font-bold flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Detectando tu ubicación actual…</p>
              )}
              {!locatingOrigin && origin && !locationError && (
                <p className="text-[11px] text-emerald-600 font-bold flex items-center gap-1.5"><CheckCircle2 size={12} /> Salida: <span className="truncate">{origin.label}</span></p>
              )}
              {locationError && (
                <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1.5"><AlertCircle size={12} /> {locationError}</p>
              )}

              <MapPicker
                localized
                addressSearch
                origin={origin}
                destination={destination}
                onChange={onMapChange}
                onClear={(which) => (which === "origin" ? setOrigin(null) : setDestination(null))}
                focusDestinationSignal={focusSignal}
              />
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">
                {routeLoading ? "Calculando distancia por carretera…" : route ? `Distancia estimada: ${route.distanciaKm.toFixed(1)} km · Duración: ${formatDuracion(route.duracionMin)}` : "Marca ambos puntos para calcular la distancia."}
              </div>
            </div>

            {/* PASO 4: detalles por selección */}
            <div className={`space-y-4 ${wizardStep === 4 ? "" : "hidden"}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><Users size={12} /> 4. Detalles y resumen</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-slate-500 flex items-center gap-1.5"><RefreshCw size={14} /> Viajes</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setForm(p => ({ ...p, num_viajes: String(Math.max(1, Number(p.num_viajes) - 1)) }))} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Minus size={14} /></button>
                    <span className="w-6 text-center font-black text-slate-800">{form.num_viajes}</span>
                    <button type="button" onClick={() => setForm(p => ({ ...p, num_viajes: String(Number(p.num_viajes) + 1) }))} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Plus size={14} /></button>
                  </div>
                </div>
                {/* Mensaje / detalles opcional para el administrador */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><FileText size={12} /> Mensaje para el administrador (opcional)</label>
                  <textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} rows={3}
                    className={INPUT + " resize-none"}
                    placeholder="Detalla lo que necesitas: equipaje especial, paradas, aire acondicionado, guía turístico, hora de regreso, etc." />
                </div>
              </div>
              <section aria-labelledby="request-summary-title" className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 id="request-summary-title" className="mb-3 text-xs font-black uppercase tracking-widest text-slate-700">Resumen del viaje</h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Salida</dt>
                    <dd className="truncate font-bold text-slate-700">{origin?.label || "Pendiente"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Destino</dt>
                    <dd className="truncate font-bold text-slate-700">{destination?.label || "Pendiente"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha y horario</dt>
                    <dd className="font-bold text-slate-700">
                      {form.fecha_servicio
                        ? new Date(`${form.fecha_servicio}T00:00:00`).toLocaleDateString(dateLocale)
                        : "Pendiente"}
                      {form.hora_salida ? ` · ${form.hora_salida}` : ""}
                      {variosDias && form.fecha_fin
                        ? ` — ${new Date(`${form.fecha_fin}T00:00:00`).toLocaleDateString(dateLocale)}`
                        : ""}
                    </dd>
                  </div>
                  {regresoOtraFecha && (
                    <div>
                      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Recogida de regreso</dt>
                      <dd className="font-bold text-slate-700">
                        {form.fecha_regreso ? new Date(`${form.fecha_regreso}T00:00:00`).toLocaleDateString(dateLocale) : "Pendiente"}
                        {form.hora_regreso ? ` · ${form.hora_regreso}` : ""}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pasajeros y categoría</dt>
                    <dd className="font-bold capitalize text-slate-700">{form.num_personas} · {form.tipo_vehiculo}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-black uppercase tracking-wider text-slate-400">Modalidad y viajes</dt>
                    <dd className="font-bold text-slate-700">
                      {variosDias ? `${selectedDays} días` : form.modalidad_servicio === "horas" ? `Por horas · ${form.duracion_horas} h` : "Por día"}
                      {` · ${form.num_viajes} viaje${Number(form.num_viajes) === 1 ? "" : "s"}`}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
                  Esta solicitud no confirma una reserva ni asigna un vehículo todavía. Recibirás el precio para revisarlo y, si lo aceptas, podrás pagar el anticipo; Despacho asignará la unidad después de confirmar el pago.
                </p>
              </section>
            </div>

            {formErr && <div role="alert" aria-live="assertive" className="p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-600 font-bold">{formErr}</div>}
            {formMsg && (
              <div role="status" aria-live="polite" className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <p className="flex items-start gap-2 font-bold"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{formMsg}</p>
                <p className="pl-6 text-xs leading-relaxed">Podrás seguir el estado y aceptar la cotización desde tu historial. No necesitas elegir una unidad ahora; se asignará después de confirmar el pago.</p>
                <a href="/cliente/historial" className="ml-6 inline-flex font-black text-emerald-800 underline underline-offset-2 hover:text-emerald-950">Ir a mi historial</a>
              </div>
            )}

            {wizardStep === 4 && (
              <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
                El administrador revisará tu solicitud y definirá el precio final antes de que realices el pago.
              </div>
            )}

            <div className="flex justify-between gap-3">
              {wizardStep > 1 && (
                <button type="button" onClick={() => goToStep(wizardStep - 1)}
                  className="rounded-2xl border-2 border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50">
                  Volver
                </button>
              )}
              {wizardStep < 4 ? (
                <button type="button" onClick={advanceStep}
                  className="ml-auto inline-flex items-center gap-2 rounded-2xl bg-[#E31E24] px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-200 hover:bg-black">
                  Continuar <ArrowRight size={15} />
                </button>
              ) : (
                <button type="submit" disabled={sending || categorias.length === 0}
                  className="ml-auto w-full py-4 bg-[#E31E24] hover:bg-black text-white font-black text-sm uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-red-200 flex items-center justify-center gap-2 disabled:opacity-60">
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}{sending ? "Enviando cotización..." : "Solicitar cotización"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* MIS COTIZACIONES */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black italic tracking-tighter uppercase text-slate-900">Mis Cotizaciones</h2>
        </div>

        {cotizaciones.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center shadow-sm">
            <FileText size={32} className="text-slate-200 mx-auto mb-3" />
            <p className="font-black text-slate-300 uppercase italic text-sm">Aún no has cotizado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cotizaciones.map(cot => {
              const info = ESTADO_INFO[cot.estado] || ESTADO_INFO.pendiente;
              const isOpen = expandedId === cot.id;
              return (
                <div key={cot.id} className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden ${cot.estado === "aprobada" ? "border-emerald-200" : cot.estado === "rechazada" ? "border-red-100" : "border-slate-200"}`}>
                  <button onClick={() => setExpandedId(isOpen ? null : cot.id)} className="w-full text-left p-4 sm:p-5 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${info.bg} ${info.color}`}>{info.icon}{info.label}</span>
                        <span className="text-[9px] text-slate-400 font-bold">#{cot.id}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <MapPin size={13} className="text-[#E31E24] flex-shrink-0" />                        <span data-no-translate className="truncate">{cot.origen}</span>
                        <ArrowRight size={13} className="text-slate-400 flex-shrink-0" /><span data-no-translate className="truncate">{cot.destino}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><Calendar size={10} />
                          {formatLocalizedDate(cot.fecha_servicio, language)}
                          {cot.fecha_fin && <> → {formatLocalizedDate(cot.fecha_fin, language)}</>}
                          {cot.fecha_regreso && <> · Regreso: {formatLocalizedDate(cot.fecha_regreso, language)}</>}
                          </span>
                          {cot.hora_salida && <span className="flex items-center gap-1"><Clock size={10} />Ida {cot.hora_salida}</span>}
                          {cot.hora_regreso && <span className="flex items-center gap-1"><Clock size={10} />Regreso {cot.hora_regreso}</span>}
                        <span className="flex items-center gap-1"><Users size={10} />{cot.num_personas}</span>
                        {cot.vehiculo_placa && <span className="flex items-center gap-1"><Car size={10} />{cot.vehiculo_placa}</span>}
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-2">
                      {cot.precio_final && <p className="text-lg font-black text-emerald-600">${Number(cot.precio_final).toFixed(0)}</p>}
                      {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-4 sm:px-5 py-4 space-y-3">
                      {cot.valor_ofrecido && (
                        <div className="flex items-center gap-2 text-xs text-slate-500"><DollarSign size={13} className="text-slate-400" />Valor ofrecido: <b className="text-slate-700">${Number(cot.valor_ofrecido).toFixed(2)}</b></div>
                      )}
                      {cot.notas && <div className="bg-slate-50 rounded-xl p-3"><p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Tus notas</p><p data-no-translate className="text-sm text-slate-600">{cot.notas}</p></div>}
                      {cot.precio_final && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3"><DollarSign size={20} className="text-emerald-600 flex-shrink-0" />
                          <div><p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Precio acordado</p><p className="text-xl font-black text-emerald-700">${Number(cot.precio_final).toFixed(2)}</p></div></div>
                      )}
                      {cot.respuesta_admin && <div className={`rounded-xl p-4 border ${info.bg}`}><p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${info.color}`}>Respuesta de Turesma</p><p data-no-translate className="text-sm text-slate-700">{cot.respuesta_admin}</p></div>}
                      {cot.reserva_id && (
                        <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 flex items-center gap-3"><Zap size={18} className="text-orange-600" />
                          <div><p className="text-xs font-black text-orange-700">Reserva #{cot.reserva_id} creada — pendiente de pago</p><p className="text-[10px] text-orange-600">Paga el total en tu Historial. Tras confirmar el pago, asignaremos el vehículo desde Despacho.</p></div></div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </LocalizedContent>
  );
}
