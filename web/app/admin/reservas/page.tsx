"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, normalizeRole } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { descargarExcel } from "../../../lib/download";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar, Plus, Edit3, Trash2, X, Search,
  CheckCircle, Clock, AlertCircle, Loader2, User, Car,
  MapPin, ArrowRight, CreditCard, FileSpreadsheet, History, MessageCircle
} from "lucide-react";
import { MapPicker, Punto } from "../../../components/map-picker";
import { VehiculoCalendario } from "../../../components/vehiculo-calendario";
import { useConfirm } from "../../../components/confirm-dialog";
import { CommunicationPanel } from "../../../components/communication-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Reserva = {
  id: number;
  usuario_id: number;
  vehiculo_id: number | null;
  conductor_id: number | null;
  tour_id: number | null;
  estado: string;
  fecha_reserva: string | null;
  fecha_salida: string | null;
  fecha_llegada: string | null;
  fecha_fin: string | null;
  fecha_regreso: string | null;
  hora_salida: string | null;
  hora_regreso: string | null;
  origen_lat: number | string | null;
  origen_lng: number | string | null;
  destino_lat: number | string | null;
  destino_lng: number | string | null;
  num_personas: number | null;
  num_viajes: number | null;
  modalidad_servicio: string | null;
  duracion_horas: number | string | null;
  tipo_vehiculo: string | null;
  total: number | null;
  origen: string | null;
  destino: string | null;
  notas: string | null;
  creado_en: string;
  cliente_nombre: string | null;
  cliente_email: string | null;
  vehiculo_placa: string | null;
  vehiculo_modelo: string | null;
  conductor_nombre: string | null;
  tour_titulo: string | null;
};

type Cliente = { id: number; nombre: string; email: string };
type ReservaHistoryEntry = {
  id: number;
  accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  detalle: Record<string, unknown> | string | null;
  creado_en: string;
  usuario_nombre: string | null;
  usuario_apellido: string | null;
};
type CambioDestinoAdmin = {
  id: number;
  reserva_id: number;
  estado: string;
  origen_anterior: string | null;
  destino_anterior: string | null;
  origen_solicitado: string;
  destino_solicitado: string;
  total_anterior: number;
  total_propuesto: number | null;
  nota_admin: string | null;
  cliente_nombre: string;
  cliente_email: string;
  pago_id: number | null;
  despacho_preparado: boolean;
  despacho_operacion_id?: number | null;
  despacho_estado?: string | null;
  viaje_iniciado?: boolean | null;
  bloqueo_propuesta: string | null;
};
type CambioDestinoFeedback = { type: "success" | "error"; message: string };
type SolicitudReprogramacionAdmin = {
  id: number;
  reserva_id: number;
  grupo_numero: number | null;
  estado: string;
  fecha_anterior: string;
  hora_anterior: string | null;
  fecha_solicitada: string;
  hora_solicitada: string | null;
  fecha_propuesta: string | null;
  hora_propuesta: string | null;
  nota_admin: string | null;
  origen: string | null;
  destino: string | null;
  cliente_nombre: string;
  cliente_email: string;
  reserva_estado: string;
  estado_pago: string;
  operaciones: { id: number; estado: string; vehiculo_id: number | null; vehiculo_asociado_id: number | null; conductor_id: number | null }[];
};

const ESTADOS = ["pendiente", "pendiente_pago", "confirmada", "en_curso", "finalizada", "cancelada"];
type ReservationView = "por_atender" | "en_curso" | "atendidos" | "todas";

const createEmptyForm = () => ({
  usuario_id: "",
  fecha_reserva: new Date().toISOString().slice(0, 10),
  fecha_salida: "",
  fecha_llegada: "",
  fecha_fin: "",
  fecha_regreso: "",
  hora_regreso: "",
  regreso_otra_fecha: false,
  num_personas: "1",
  num_viajes: "1",
  modalidad_servicio: "dia",
  duracion_horas: "2",
  tipo_vehiculo: "",
  total: "",
  origen: "",
  destino: "",
  notas: "",
  estado: "pendiente_pago",
});

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  pendiente_pago: "bg-orange-100 text-orange-700 border-orange-200",
  confirmada: "bg-blue-100 text-blue-700 border-blue-200",
  en_curso: "bg-green-100 text-green-700 border-green-200",
  finalizada: "bg-slate-100 text-slate-600 border-slate-200",
  cancelada: "bg-red-100 text-red-600 border-red-200",
  reprogramacion_pendiente: "bg-purple-100 text-purple-700 border-purple-200",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente_pago: "Pendiente de pago",
};

const HISTORIAL_ACCION_LABEL: Record<string, string> = {
  reprogramacion_cliente: "Reprogramación realizada por el cliente",
};

const HISTORIAL_CAMPO_LABEL: Record<string, string> = {
  fecha: "Fecha de salida",
  fecha_fin: "Fecha final",
  hora: "Hora de salida",
  hora_inicio: "Hora de inicio",
  hora_fin: "Hora de fin",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getHistoryDetail(detail: ReservaHistoryEntry["detalle"]): Record<string, unknown> | null {
  if (typeof detail !== "string") return isRecord(detail) ? detail : null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return isRecord(parsed) ? parsed : { detalle: parsed };
  } catch {
    return { detalle: detail };
  }
}

function getHistoryDetailRows(detail: ReservaHistoryEntry["detalle"]) {
  const parsed = getHistoryDetail(detail);
  if (!parsed) return [];

  const rows: { label: string; previous?: string; current?: string; value?: string }[] = [];
  const consumed = new Set<string>();

  const formatValue = (value: unknown, key: string) => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value !== "string") {
      return isRecord(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
    }
    if (key.startsWith("fecha") && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split("-").map(Number);
      return new Intl.DateTimeFormat("es-EC", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
    if (key.startsWith("hora") && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
    return value;
  };

  const formatLabel = (key: string) => {
    const label = HISTORIAL_CAMPO_LABEL[key] || key.replaceAll("_", " ");
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (consumed.has(key)) continue;
    if (key.endsWith("_anterior")) {
      const prefix = key.slice(0, -"_anterior".length);
      const nextKey: string = `${prefix}_nueva` in parsed ? `${prefix}_nueva` : `${prefix}_nuevo`;
      if (nextKey in parsed) {
        rows.push({
          label: formatLabel(prefix),
          previous: formatValue(value, key),
          current: formatValue(parsed[nextKey], nextKey),
        });
        consumed.add(nextKey);
        continue;
      }
    }
    if (key.endsWith("_nueva") || key.endsWith("_nuevo")) {
      const prefix = key.replace(/_(nueva|nuevo)$/, "");
      const previousKey = `${prefix}_anterior`;
      if (previousKey in parsed) continue;
    }
    rows.push({ label: formatLabel(key), value: formatValue(value, key) });
  }

  return rows;
}

const ESTADO_ICON: Record<string, React.ReactNode> = {
  pendiente: <Clock size={11} />,
  pendiente_pago: <CreditCard size={11} />,
  confirmada: <CheckCircle size={11} />,
  en_curso: <ArrowRight size={11} />,
  finalizada: <CheckCircle size={11} />,
  cancelada: <AlertCircle size={11} />,
};

const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  pendiente: ["confirmada", "cancelada"],
  pendiente_pago: ["confirmada", "cancelada"],
  confirmada: ["cancelada"],
  en_curso: ["confirmada"],
  finalizada: [],
  cancelada: [],
};

const INPUT_CLS = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";
const STARTED_TRIP_CHANGE_CLOSURE_NOTE = "La ruta y el valor originales se mantienen. Los cambios después de iniciar el viaje se coordinan directamente con Turesma por llamada o WhatsApp; esta solicitud no se tramita desde el sistema.";

export default function AdminReservasPage() {
  const { user, checkingSession } = useAdminGuard();
  const isAdmin = normalizeRole(user?.rol) === "admin";
  const router = useRouter();
  const confirmar = useConfirm();
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [vistaReservas, setVistaReservas] = useState<ReservationView>("por_atender");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Modal crear/editar
  const [modalOpen, setModalOpen] = useState(false);
  const [adminOrigin, setAdminOrigin] = useState<Punto | null>(null);
  const [adminDestination, setAdminDestination] = useState<Punto | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(createEmptyForm);
  const [savingReservation, setSavingReservation] = useState(false);
  const [prefilledClientId, setPrefilledClientId] = useState<string | null>(null);

  // Modal cambio de estado
  const [estadoModal, setEstadoModal] = useState<Reserva | null>(null);
  const [nuevoEstado, setNuevoEstado] = useState("");
  const [motivoEstado, setMotivoEstado] = useState("");
  const [estadoLoading, setEstadoLoading] = useState(false);
  const [historyReservation, setHistoryReservation] = useState<Reserva | null>(null);
  const [reservationHistory, setReservationHistory] = useState<ReservaHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [focusedReservationId, setFocusedReservationId] = useState<number | null>(null);
  const [conversationReservationId, setConversationReservationId] = useState<number | null>(null);
  const [solicitudesCambioDestino, setSolicitudesCambioDestino] = useState<CambioDestinoAdmin[]>([]);
  const [propuestasCambio, setPropuestasCambio] = useState<Record<number, { total: string; nota: string; referencia: string }>>({});
  const [savingChangeIds, setSavingChangeIds] = useState<Set<number>>(() => new Set());
  const savingChangeIdsRef = useRef(new Set<number>());
  const [cambioDestinoFeedback, setCambioDestinoFeedback] = useState<Record<number, CambioDestinoFeedback>>({});
  const [solicitudesReprogramacion, setSolicitudesReprogramacion] = useState<SolicitudReprogramacionAdmin[]>([]);
  const [respuestasReprogramacion, setRespuestasReprogramacion] = useState<Record<number, { fecha: string; hora: string; nota: string }>>({});
  const [savingReprogramacionIds, setSavingReprogramacionIds] = useState<Set<number>>(() => new Set());
  const [reprogramacionFeedback, setReprogramacionFeedback] = useState<Record<number, CambioDestinoFeedback>>({});

  const h = getAuthHeaders();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientId = params.get("usuario_id");
    if (clientId && /^\d+$/.test(clientId)) setPrefilledClientId(clientId);
    const reservationId = Number(params.get("id"));
    if (Number.isInteger(reservationId) && reservationId > 0) {
      setFocusedReservationId(reservationId);
      setSearch(String(reservationId));
      setVistaReservas("todas");
    }
    const chatMatch = /^reserva:(\d+)$/.exec(params.get("chat") || "");
    if (chatMatch) {
      const chatReservationId = Number(chatMatch[1]);
      setConversationReservationId(chatReservationId);
      setFocusedReservationId(chatReservationId);
      setSearch(String(chatReservationId));
      setVistaReservas("todas");
    }
  }, []);

  const openReservationConversation = (reservation: Reserva) => {
    setFocusedReservationId(reservation.id);
    setConversationReservationId(reservation.id);
    setSearch(String(reservation.id));
    setVistaReservas("todas");
    setFiltroEstado("todos");
  };

  useEffect(() => {
    if (!prefilledClientId || loading) return;
    const client = clientes.find((item) => String(item.id) === prefilledClientId);
    if (!client) {
      setErr("No se encontró el cliente seleccionado para crear la reserva");
      setPrefilledClientId(null);
      router.replace("/admin/reservas");
      return;
    }

    setEditingId(null);
    setForm({ ...createEmptyForm(), usuario_id: String(client.id) });
    setAdminOrigin(null);
    setAdminDestination(null);
    setMsg("");
    setErr("");
    setModalOpen(true);
    setPrefilledClientId(null);
    router.replace("/admin/reservas");
  }, [clientes, loading, prefilledClientId, router]);

  const openHistory = async (reserva: Reserva) => {
    setHistoryReservation(reserva);
    setReservationHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/admin/reservas/${reserva.id}/historial`, { headers: h });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial");
      setReservationHistory(data.data || []);
    } catch (historyLoadError) {
      setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : "No se pudo cargar el historial");
    } finally {
      setHistoryLoading(false);
    }
  };

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [rRes, uRes, cambiosRes, reprogramacionesRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/reservas`, { headers: h }),
        fetch(`${API_URL}/api/admin/usuarios`, { headers: h }),
        isAdmin ? fetch(`${API_URL}/api/admin/solicitudes-cambio-destino`, { headers: h }) : Promise.resolve(null),
        isAdmin ? fetch(`${API_URL}/api/admin/solicitudes-reprogramacion`, { headers: h }) : Promise.resolve(null),
      ]);
      if (rRes.ok) setReservas(await rRes.json());
      if (uRes.ok) {
        const usuarios = await uRes.json();
        setClientes(usuarios.filter((u: any) => u.rol === "cliente"));
      }
      if (cambiosRes?.ok) {
        const changes = await cambiosRes.json();
        setSolicitudesCambioDestino(changes);
        setPropuestasCambio((previous) => {
          const next = { ...previous };
          for (const change of changes as CambioDestinoAdmin[]) {
            next[change.id] ||= { total: String(change.total_anterior || ""), nota: "", referencia: "" };
          }
          return next;
        });
      }
      if (reprogramacionesRes?.ok) {
        const requests = await reprogramacionesRes.json() as SolicitudReprogramacionAdmin[];
        setSolicitudesReprogramacion(requests);
        setRespuestasReprogramacion((previous) => {
          const next = { ...previous };
          for (const request of requests) {
            next[request.id] ||= { fecha: request.fecha_solicitada?.slice(0, 10) || "", hora: request.hora_solicitada?.slice(0, 5) || "", nota: "" };
          }
          return next;
        });
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load();   }, [checkingSession, isAdmin]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const filtered = reservas.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      String(r.id).includes(q) ||
      (r.cliente_nombre || "").toLowerCase().includes(q) ||
      (r.vehiculo_placa || "").toLowerCase().includes(q) ||
      (r.destino || "").toLowerCase().includes(q) ||
      (r.origen || "").toLowerCase().includes(q);
    const attended = ["finalizada", "cancelada"].includes(r.estado);
    const inProgress = r.estado === "en_curso";
    const matchView = vistaReservas === "todas"
      || (vistaReservas === "atendidos" && attended)
      || (vistaReservas === "en_curso" && inProgress)
      || (vistaReservas === "por_atender" && !attended && !inProgress);
    const matchEstado = filtroEstado === "todos" || r.estado === filtroEstado;
    return matchSearch && matchView && matchEstado;
  });

  const exportarExcel = async () => {
    setExportandoExcel(true);
    setErr("");
    const query = new URLSearchParams({ tipo: "reservas", formato: "xlsx" });
    if (filtroEstado !== "todos") query.set("estado", filtroEstado);
    if (vistaReservas !== "todas") query.set("grupo_estado", vistaReservas);
    if (search.trim()) query.set("busqueda", search.trim());
    const result = await descargarExcel(
      `/api/admin/reportes/exportar-csv?${query.toString()}`,
      "reporte_reservas.xlsx"
    );
    if (!result.ok) setErr(result.error || "No se pudo exportar");
    setExportandoExcel(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(createEmptyForm());
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const openEdit = (r: Reserva) => {
    setEditingId(r.id);
    setAdminOrigin(r.origen_lat != null && r.origen_lng != null
      ? { lat: Number(r.origen_lat), lng: Number(r.origen_lng), label: r.origen || "" }
      : null);
    setAdminDestination(r.destino_lat != null && r.destino_lng != null
      ? { lat: Number(r.destino_lat), lng: Number(r.destino_lng), label: r.destino || "" }
      : null);
    setForm({
      usuario_id: String(r.usuario_id || ""),
      fecha_reserva: r.fecha_reserva?.slice(0, 10) || "",
      fecha_salida: r.fecha_salida?.slice(0, 16) || "",
      fecha_llegada: r.fecha_llegada?.slice(0, 16) || "",
      fecha_fin: r.fecha_fin?.slice(0, 10) || "",
      fecha_regreso: r.fecha_regreso?.slice(0, 10) || "",
      hora_regreso: r.hora_regreso?.slice(0, 5) || "",
      regreso_otra_fecha: Boolean(r.fecha_regreso),
      num_personas: String(r.num_personas || "1"),
      num_viajes: String(r.num_viajes || "1"),
      modalidad_servicio: r.fecha_fin ? "varios_dias" : r.modalidad_servicio === "horas" ? "horas" : "dia",
      duracion_horas: String(r.duracion_horas || "2"),
      tipo_vehiculo: r.tipo_vehiculo || "",
      total: String(r.total || ""),
      origen: r.origen || "",
      destino: r.destino || "",
      notas: r.notas || "",
      estado: r.estado || "pendiente",
    });
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");
    const origin = adminOrigin?.label || form.origen.trim();
    const destination = adminDestination?.label || form.destino.trim();
    if (!form.usuario_id) {
      setErr("Selecciona un cliente para continuar");
      return;
    }
    if (!form.fecha_reserva) {
      setErr("Selecciona la fecha de reserva");
      return;
    }
    if (!Number.isInteger(Number(form.num_personas)) || Number(form.num_personas) < 1) {
      setErr("El número de personas debe ser al menos 1");
      return;
    }
    if (!Number.isInteger(Number(form.num_viajes)) || Number(form.num_viajes) < 1) {
      setErr("El número de viajes debe ser al menos 1");
      return;
    }
    if (form.modalidad_servicio === "horas" && (!Number.isFinite(Number(form.duracion_horas)) || Number(form.duracion_horas) <= 0)) {
      setErr("Indica una duración válida en horas");
      return;
    }
    if (!origin || !destination) {
      setErr("Marca la salida y el destino en el mapa para continuar");
      return;
    }
    if (form.modalidad_servicio === "varios_dias") {
      if (!form.fecha_salida || !form.fecha_fin) {
        setErr("Indica la salida y la fecha final para un servicio de varios días");
        return;
      }
      if (form.fecha_fin <= form.fecha_salida.slice(0, 10)) {
        setErr("La fecha final debe ser posterior al día de salida");
        return;
      }
    }
    if (form.regreso_otra_fecha) {
      if (!form.fecha_salida || !form.fecha_regreso || !form.hora_regreso) {
        setErr("Indica la fecha y hora de salida y de regreso");
        return;
      }
      if (form.fecha_regreso <= form.fecha_salida.slice(0, 10)) {
        setErr("La fecha de regreso debe ser posterior al día de salida");
        return;
      }
    }
    if (form.fecha_salida && form.fecha_llegada && form.fecha_llegada < form.fecha_salida) {
      setErr("La fecha de llegada no puede ser anterior a la fecha de salida");
      return;
    }
    setSavingReservation(true);
    const payload: Record<string, any> = {
      usuario_id: Number(form.usuario_id),
      fecha_reserva: form.fecha_reserva,
      fecha_salida: form.fecha_salida || null,
      fecha_llegada: form.fecha_llegada || null,
      fecha_servicio: form.fecha_salida || null,
      hora_salida: form.fecha_salida ? form.fecha_salida.slice(11, 16) : null,
      fecha_fin: form.modalidad_servicio === "varios_dias" ? form.fecha_fin || null : null,
      fecha_regreso: form.regreso_otra_fecha ? form.fecha_regreso || null : null,
      hora_regreso: form.regreso_otra_fecha ? form.hora_regreso || null : null,
      duracion_estimada_minutos: form.modalidad_servicio === "horas" ? Math.round(Number(form.duracion_horas) * 60) : null,
      num_personas: Number(form.num_personas),
      num_viajes: Number(form.num_viajes),
      modalidad_servicio: form.modalidad_servicio,
      duracion_horas: form.modalidad_servicio === "horas" ? Number(form.duracion_horas) : null,
      tipo_vehiculo: form.tipo_vehiculo.trim() || null,
      total: form.total ? Number(form.total) : null,
      origen: origin,
      destino: destination,
      ...(adminOrigin ? { origen_lat: adminOrigin.lat, origen_lng: adminOrigin.lng } : {}),
      ...(adminDestination ? { destino_lat: adminDestination.lat, destino_lng: adminDestination.lng } : {}),
      notas: form.notas || null,
      ...(editingId ? {} : { estado: "pendiente_pago" }),
    };
    const url = editingId ? `${API_URL}/api/admin/reservas/${editingId}` : `${API_URL}/api/admin/reservas`;
    const method = editingId ? "PUT" : "POST";
    try {
      const res = await fetch(url, { method, headers: h, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Error al guardar"); return; }
      setMsg(editingId ? "Reserva actualizada correctamente" : "Reserva creada correctamente");
      setModalOpen(false);
      setAdminOrigin(null); setAdminDestination(null);
      load();
    } catch (saveError) {
      setErr(saveError instanceof Error ? saveError.message : "No se pudo guardar la reserva");
    } finally {
      setSavingReservation(false);
    }
  };

  const handleDelete = async (r: Reserva) => {
    if (!(await confirmar({ title: "Eliminar reserva", message: `¿Eliminar reserva #${r.id}?`, confirmText: "Eliminar", tone: "danger" }))) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/reservas/${r.id}`, { method: "DELETE", headers: h });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar la reserva");
      setMsg("Reserva eliminada");
      load();
    } catch (deleteError) {
      setErr(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar la reserva");
    }
  };

  const handleCambiarEstado = async () => {
    if (!estadoModal || !nuevoEstado) return;
    setEstadoLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/reservas/${estadoModal.id}/estado-viaje`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ estado: nuevoEstado, motivo: motivoEstado }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cambiar estado");
      setMsg(`Estado actualizado a "${nuevoEstado}"`);
      setEstadoModal(null);
      setMotivoEstado("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cambiar estado");
    } finally {
      setEstadoLoading(false);
    }
  };

  const actualizarSolicitudCambio = async (id: number, action: "propuesta" | "rechazar" | "devolucion", defaultRejectionNote = "") => {
    if (savingChangeIdsRef.current.has(id)) return;
    savingChangeIdsRef.current.add(id);
    setSavingChangeIds(new Set(savingChangeIdsRef.current));
    setCambioDestinoFeedback((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    const form = propuestasCambio[id] || { total: "", nota: "", referencia: "" };
    const endpoint = action === "devolucion"
      ? `/api/admin/solicitudes-cambio-destino/${id}/devolucion`
      : `/api/admin/solicitudes-cambio-destino/${id}/${action}`;
    const payload = action === "propuesta"
      ? { total_propuesto: Number(form.total), nota_admin: form.nota }
      : action === "devolucion"
        ? { referencia_externa: form.referencia }
        : { nota_admin: form.nota.trim() || defaultRejectionNote };
    setErr(""); setMsg("");
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const responseText = await response.text();
      let data: { error?: string; message?: string } = {};
      try {
        data = responseText ? JSON.parse(responseText) as { error?: string; message?: string } : {};
      } catch {
        data = {};
      }
      if (!response.ok) {
        if (response.status === 409) await load(true);
        throw new Error(data.error || `No se pudo procesar la solicitud (HTTP ${response.status})`);
      }
      const successMessage = action === "rechazar" && defaultRejectionNote
        ? "Solicitud cerrada y cliente notificado. La reserva conserva la ruta original."
        : data.message || "Solicitud actualizada";
      setCambioDestinoFeedback((previous) => ({ ...previous, [id]: { type: "success", message: successMessage } }));
      setMsg(successMessage);
      await load(true);
    } catch (requestError) {
      const errorMessage = requestError instanceof Error ? requestError.message : "No se pudo procesar la solicitud";
      setCambioDestinoFeedback((previous) => ({ ...previous, [id]: { type: "error", message: errorMessage } }));
      setErr(errorMessage);
    } finally {
      savingChangeIdsRef.current.delete(id);
      setSavingChangeIds(new Set(savingChangeIdsRef.current));
    }
  };

  const actualizarSolicitudReprogramacion = async (id: number, action: "propuesta" | "rechazar") => {
    if (savingReprogramacionIds.has(id)) return;
    setSavingReprogramacionIds((previous) => new Set(previous).add(id));
    setErr("");
    setMsg("");
    setReprogramacionFeedback((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    const form = respuestasReprogramacion[id] || { fecha: "", hora: "", nota: "" };
    const payload = action === "propuesta"
      ? { fecha_propuesta: form.fecha, hora_propuesta: form.hora, nota_admin: form.nota }
      : { nota_admin: form.nota };
    try {
      const response = await fetch(`${API_URL}/api/admin/solicitudes-reprogramacion/${id}/${action}`, {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo responder a la solicitud");
      setMsg(data.message || "Solicitud respondida");
      await load(true);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "No se pudo responder a la solicitud";
      setErr(message);
      setReprogramacionFeedback((previous) => ({ ...previous, [id]: { type: "error", message } }));
    } finally {
      setSavingReprogramacionIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };

  const formatFecha = (v?: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  const formatFechaCorta = (v?: string | null) => {
    if (!v) return "—";
    const [year, month, day] = v.slice(0, 10).split("-");
    return year && month && day ? `${day}/${month}/${year}` : v;
  };

  // Stats
  const stats = {
    total: reservas.length,
    pendientes: reservas.filter(r => r.estado === "pendiente").length,
    confirmadas: reservas.filter(r => r.estado === "confirmada").length,
    en_curso: reservas.filter(r => r.estado === "en_curso").length,
    finalizadas: reservas.filter(r => r.estado === "finalizada").length,
  };
  const reservationViewCounts = {
    por_atender: reservas.filter((r) => !["finalizada", "cancelada", "en_curso"].includes(r.estado)).length,
    en_curso: reservas.filter((r) => r.estado === "en_curso").length,
    atendidos: reservas.filter((r) => ["finalizada", "cancelada"].includes(r.estado)).length,
    todas: reservas.length,
  };
  const estadosDeVista = vistaReservas === "por_atender"
    ? ESTADOS.filter((estado) => !["en_curso", "finalizada", "cancelada"].includes(estado))
    : vistaReservas === "en_curso"
      ? ["en_curso"]
      : vistaReservas === "atendidos"
        ? ["finalizada", "cancelada"]
        : ESTADOS;
  const editingReservation = reservas.find((reserva) => reserva.id === editingId);
  const canSubmitReservation = Boolean(
    form.usuario_id
    && form.fecha_reserva
    && Number.isInteger(Number(form.num_personas))
    && Number(form.num_personas) >= 1
    && Number.isInteger(Number(form.num_viajes))
    && Number(form.num_viajes) >= 1
    && (adminOrigin?.label || form.origen.trim())
    && (adminDestination?.label || form.destino.trim())
    && (form.modalidad_servicio !== "horas" || (Number.isFinite(Number(form.duracion_horas)) && Number(form.duracion_horas) > 0))
    && (form.modalidad_servicio !== "varios_dias" || (Boolean(form.fecha_salida && form.fecha_fin) && form.fecha_fin > form.fecha_salida.slice(0, 10)))
    && (!form.regreso_otra_fecha || (Boolean(form.fecha_salida && form.fecha_regreso && form.hora_regreso) && form.fecha_regreso > form.fecha_salida.slice(0, 10)))
    && (!form.fecha_salida || !form.fecha_llegada || form.fecha_llegada >= form.fecha_salida)
  );

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={exportarExcel}
          disabled={exportandoExcel || loading}
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition-all hover:bg-emerald-100 disabled:opacity-60"
        >
          {exportandoExcel ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
          {exportandoExcel ? "Generando Excel..." : "Exportar Excel"}
        </button>
        <button onClick={openCreate} className="flex items-center gap-2 bg-[#E31E24] hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20">
          <Plus size={16} />
          Nueva Reserva
        </button>
      </div>

      {isAdmin && solicitudesReprogramacion.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
            <h2 className="font-black text-amber-950">Solicitudes de cambio de fecha u hora</h2>
            <p className="mt-1 text-xs text-amber-800">La fecha original sigue confirmada. Si la fecha solicitada no tiene disponibilidad, propone una alternativa; el cambio solo se aplica si el cliente la acepta.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {solicitudesReprogramacion.map((request) => {
              const form = respuestasReprogramacion[request.id] || { fecha: "", hora: "", nota: "" };
              return (
                <article key={request.id} className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">Reserva #{request.reserva_id}{request.grupo_numero ? ` · Grupo ${request.grupo_numero}` : ""} · {request.cliente_nombre}</p>
                      <p className="text-xs text-slate-500">{request.cliente_email} · {request.origen || "—"} → {request.destino || "—"}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-600">{request.estado.replaceAll("_", " ")}</span>
                  </div>
                  {reprogramacionFeedback[request.id] && (
                    <p role={reprogramacionFeedback[request.id].type === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm font-semibold ${reprogramacionFeedback[request.id].type === "error" ? "border border-red-200 bg-red-50 text-red-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                      {reprogramacionFeedback[request.id].message}
                    </p>
                  )}
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p className="rounded-lg bg-slate-50 p-3"><span className="text-xs font-bold text-slate-500">Fecha original (se conserva):</span><br />{formatFechaCorta(request.fecha_anterior)}{request.hora_anterior ? ` · ${request.hora_anterior.slice(0, 5)}` : ""}</p>
                    <p className="rounded-lg bg-blue-50 p-3 text-blue-900"><span className="text-xs font-bold text-blue-700">Solicitada por el cliente:</span><br />{formatFechaCorta(request.fecha_solicitada)}{request.hora_solicitada ? ` · ${request.hora_solicitada.slice(0, 5)}` : ""}</p>
                  </div>
                  {request.estado === "pendiente_admin" && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-500">Confirma disponibilidad para todas las unidades del servicio. Si no está disponible, cambia la fecha/hora propuesta; el servidor validará los recursos antes de enviarla.</p>
                      <div className="grid gap-2 sm:grid-cols-[minmax(150px,1fr)_minmax(130px,0.7fr)_minmax(0,2fr)_auto_auto]">
                        <label className="text-[10px] font-black uppercase text-slate-500">Alternativa · fecha
                          <input type="date" min={new Date().toISOString().slice(0, 10)} value={form.fecha} disabled={savingReprogramacionIds.has(request.id)} onChange={(event) => setRespuestasReprogramacion((previous) => ({ ...previous, [request.id]: { ...form, fecha: event.target.value } }))} className={`${INPUT_CLS} mt-1`} />
                        </label>
                        <label className="text-[10px] font-black uppercase text-slate-500">Hora
                          <input type="time" value={form.hora} disabled={savingReprogramacionIds.has(request.id)} onChange={(event) => setRespuestasReprogramacion((previous) => ({ ...previous, [request.id]: { ...form, hora: event.target.value } }))} className={`${INPUT_CLS} mt-1`} />
                        </label>
                        <label className="text-[10px] font-black uppercase text-slate-500">Mensaje para el cliente
                          <input maxLength={500} minLength={5} value={form.nota} disabled={savingReprogramacionIds.has(request.id)} onChange={(event) => setRespuestasReprogramacion((previous) => ({ ...previous, [request.id]: { ...form, nota: event.target.value } }))} className={`${INPUT_CLS} mt-1`} placeholder="Explica la alternativa propuesta" />
                        </label>
                        <button type="button" onClick={() => void actualizarSolicitudReprogramacion(request.id, "propuesta")} disabled={savingReprogramacionIds.has(request.id) || !form.fecha || form.nota.trim().length < 5} className="self-end rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50">{savingReprogramacionIds.has(request.id) ? "Enviando..." : "Enviar alternativa"}</button>
                        <button type="button" onClick={() => void actualizarSolicitudReprogramacion(request.id, "rechazar")} disabled={savingReprogramacionIds.has(request.id) || form.nota.trim().length < 5} className="self-end rounded-xl bg-red-50 px-4 py-3 text-xs font-black uppercase text-red-700 disabled:opacity-50">No disponible</button>
                      </div>
                    </div>
                  )}
                  {request.estado === "propuesta_cliente" && (
                    <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                      Alternativa enviada: {formatFechaCorta(request.fecha_propuesta)}{request.hora_propuesta ? ` · ${request.hora_propuesta.slice(0, 5)}` : ""}. Esperando que el cliente acepte o mantenga la fecha original.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {isAdmin && solicitudesCambioDestino.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-4">
            <h2 className="font-black text-amber-950">Solicitudes de cambio de destino</h2>
            <p className="mt-1 text-xs text-amber-800">El cliente acepta el nuevo precio antes de cualquier cambio. Una devolución se registra solo después de ejecutarla fuera del sistema.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {solicitudesCambioDestino.map((change) => {
              const proposalForm = propuestasCambio[change.id] || { total: "", nota: "", referencia: "" };
              const difference = Number(change.total_propuesto || 0) - Number(change.total_anterior || 0);
              const tripAlreadyStarted = Boolean(change.viaje_iniciado || change.despacho_estado === "en_curso");
              return (
                <article key={change.id} className="space-y-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900">Reserva #{change.reserva_id} · {change.cliente_nombre}</p>
                      <p className="text-xs text-slate-500">{change.cliente_email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {change.despacho_operacion_id && change.despacho_estado && (
                        <span className="rounded-full bg-orange-100 px-3 py-1 text-[10px] font-black uppercase text-orange-800">
                          Operación #{change.despacho_operacion_id} · {change.despacho_estado.replaceAll("_", " ")}
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-600">{change.estado.replaceAll("_", " ")}</span>
                    </div>
                  </div>
                  {cambioDestinoFeedback[change.id] && (
                    <p
                      role={cambioDestinoFeedback[change.id].type === "error" ? "alert" : "status"}
                      className={`rounded-lg p-3 text-sm font-semibold ${
                        cambioDestinoFeedback[change.id].type === "error"
                          ? "border border-red-200 bg-red-50 text-red-700"
                          : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {cambioDestinoFeedback[change.id].message}
                    </p>
                  )}
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p className="rounded-lg bg-slate-50 p-3"><span className="text-xs font-bold text-slate-500">Ruta actual:</span><br />{change.origen_anterior || "—"} → {change.destino_anterior || "—"}</p>
                    <p className="rounded-lg bg-blue-50 p-3 text-blue-900"><span className="text-xs font-bold text-blue-700">Solicitada:</span><br />{change.origen_solicitado} → {change.destino_solicitado}</p>
                  </div>
                  {change.estado === "pendiente_admin" && change.bloqueo_propuesta && (
                    <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                      {tripAlreadyStarted
                        ? change.despacho_estado === "en_curso"
                          ? `La Operación #${change.despacho_operacion_id} está en curso. No cambies la ruta ni el precio desde esta solicitud. Para un ajuste urgente, coordínalo por llamada o WhatsApp; la reserva conserva sus datos originales.`
                          : "El viaje ya comenzó o terminó. No cambies su ruta ni precio desde esta solicitud; coordina cualquier ajuste directamente por llamada o WhatsApp."
                        : change.bloqueo_propuesta}
                      {change.despacho_preparado && (
                        <Link href="/admin/operaciones" className="inline-flex items-center gap-1 font-black underline underline-offset-2">
                          Revisar despacho <ArrowRight size={14} />
                        </Link>
                      )}
                    </p>
                  )}
                  {change.estado === "pendiente_admin" && tripAlreadyStarted && (
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-relaxed text-slate-700">
                        Al cerrar, el cliente recibirá: “{STARTED_TRIP_CHANGE_CLOSURE_NOTE}”
                      </p>
                      <button
                        type="button"
                        onClick={() => void actualizarSolicitudCambio(change.id, "rechazar", STARTED_TRIP_CHANGE_CLOSURE_NOTE)}
                        disabled={savingChangeIds.has(change.id)}
                        className="shrink-0 rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        {savingChangeIds.has(change.id) ? "Cerrando..." : "Cerrar y notificar"}
                      </button>
                    </div>
                  )}
                  {change.estado === "pendiente_admin" && !tripAlreadyStarted && (
                    <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto_auto]">
                      <label className="text-[10px] font-black uppercase text-slate-500">Nuevo total ($)
                        <input type="number" min="0.01" step="0.01" value={proposalForm.total} disabled={savingChangeIds.has(change.id)} onChange={(event) => setPropuestasCambio((old) => ({ ...old, [change.id]: { ...proposalForm, total: event.target.value } }))} className={`${INPUT_CLS} mt-1`} />
                      </label>
                      <label className="text-[10px] font-black uppercase text-slate-500">Detalle para el cliente
                        <input
                          id={`cambio-destino-nota-${change.id}`}
                          maxLength={500}
                          minLength={5}
                          value={proposalForm.nota}
                          disabled={savingChangeIds.has(change.id)}
                          onChange={(event) => setPropuestasCambio((old) => ({ ...old, [change.id]: { ...proposalForm, nota: event.target.value } }))}
                          aria-describedby={`cambio-destino-nota-ayuda-${change.id}`}
                          className={`${INPUT_CLS} mt-1`}
                          placeholder="Motivo del precio propuesto"
                        />
                        <span id={`cambio-destino-nota-ayuda-${change.id}`} className="mt-1 block normal-case tracking-normal text-slate-500">
                          Escribe al menos 5 caracteres para habilitar el envío.
                        </span>
                      </label>
                      <button type="button" onClick={() => void actualizarSolicitudCambio(change.id, "propuesta")} disabled={savingChangeIds.has(change.id) || Boolean(change.bloqueo_propuesta) || Number(proposalForm.total) <= 0 || proposalForm.nota.trim().length < 5} className="self-end rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50">{savingChangeIds.has(change.id) ? "Enviando..." : "Enviar propuesta"}</button>
                      <button type="button" onClick={() => void actualizarSolicitudCambio(change.id, "rechazar")} disabled={savingChangeIds.has(change.id) || proposalForm.nota.trim().length < 5} className="self-end rounded-xl bg-red-50 px-4 py-3 text-xs font-black uppercase text-red-700 disabled:opacity-50">{savingChangeIds.has(change.id) ? "Procesando..." : "Rechazar"}</button>
                    </div>
                  )}
                  {change.estado === "pendiente_admin" && !tripAlreadyStarted && <p className="text-xs text-slate-500">Reserva pagada: ${Number(change.total_anterior).toFixed(2)}. Revisa ruta, disponibilidad y despacho antes de proponer.</p>}
                  {change.estado === "propuesta_cliente" && (
                    <p className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                      Esperando respuesta del cliente: ${Number(change.total_anterior).toFixed(2)} → ${Number(change.total_propuesto).toFixed(2)}. {change.nota_admin}
                    </p>
                  )}
                  {change.estado === "pago_pendiente" && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                      El cliente aceptó el aumento de ${difference.toFixed(2)}. La nueva ruta se aplicará cuando el pago quede confirmado.
                    </p>
                  )}
                  {change.estado === "devolucion_pendiente" && (
                    <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50 p-3">
                      <p className="text-sm font-bold text-orange-900">Devolver ${Math.abs(difference).toFixed(2)} externamente antes de registrar. El sistema solo guardará la referencia y aplicará el cambio.</p>
                      <div className="flex flex-wrap gap-2">
                        <input maxLength={120} value={proposalForm.referencia} onChange={(event) => setPropuestasCambio((old) => ({ ...old, [change.id]: { ...proposalForm, referencia: event.target.value } }))} className={`${INPUT_CLS} min-w-[220px] flex-1`} placeholder="Referencia de la transferencia de devolución" />
                        <button type="button" onClick={() => void actualizarSolicitudCambio(change.id, "devolucion")} disabled={proposalForm.referencia.trim().length < 3} className="rounded-xl bg-orange-700 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-50">Registrar devolución aplicada</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", val: stats.total, color: "text-slate-900", bg: "bg-white" },
          { label: "Pendientes", val: stats.pendientes, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Confirmadas", val: stats.confirmadas, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "En Curso", val: stats.en_curso, color: "text-green-600", bg: "bg-green-50" },
          { label: "Finalizadas", val: stats.finalizadas, color: "text-slate-500", bg: "bg-slate-50" },
        ].map((k) => (
          <div key={k.label} className={`${k.bg} rounded-2xl p-4 border border-gray-100 shadow-sm`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
            <p className={`text-2xl sm:text-3xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* MENSAJES */}
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}
      {focusedReservationId && (() => {
        const reservation = reservas.find((item) => item.id === focusedReservationId);
        if (!reservation) return null;
        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-bold text-blue-900">Reserva #{reservation.id} · Estado: {ESTADO_LABEL[reservation.estado] || reservation.estado.replace("_", " ")}.</p>
            {conversationReservationId === reservation.id && (
              <CommunicationPanel
                contextType="reserva"
                contextId={reservation.id}
                contextTitle={`Reserva #${reservation.id} · ${reservation.cliente_nombre || `Cliente #${reservation.usuario_id}`}`}
                initiallyOpen
                hideTrigger
                onClose={() => setConversationReservationId(null)}
              />
            )}
            {reservation.estado === "confirmada" && (
              <button type="button" onClick={() => router.push(`/admin/operaciones?reserva_id=${reservation.id}`)} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-700">
                Continuar a despacho
              </button>
            )}
          </div>
        );
      })()}
      {/* FILTROS */}
      <div className="flex flex-wrap gap-3 items-center bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <nav aria-label="Filtrar reservas" className="flex w-full flex-wrap gap-2 border-b border-slate-100 pb-3">
          {([
            ["por_atender", "Por atender"],
            ["en_curso", "En curso"],
            ["atendidos", "Atendidos"],
            ["todas", "Todas"],
          ] as const).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => { setVistaReservas(view); setFiltroEstado("todos"); }}
              aria-pressed={vistaReservas === view}
              className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                vistaReservas === view ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {label} <span className="ml-1 opacity-70">{reservationViewCounts[view]}</span>
            </button>
          ))}
        </nav>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por ID, cliente, vehículo, destino..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-bold outline-none focus:border-[#E31E24] transition-all" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["todos", ...estadosDeVista].map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtroEstado === e ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {e === "todos" ? "Todos los estados" : (ESTADO_LABEL[e] || e.replace("_", " "))}
            </button>
          ))}
        </div>
      </div>

      {/* TABLA */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-[#E31E24]" size={36} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Calendar size={48} className="text-slate-200" />
            <p className="text-sm font-black uppercase text-slate-300 italic tracking-tighter">Sin reservas</p>
          </div>
        ) : (
          <>
          {/* MÓVIL: tarjetas */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filtered.map((r) => (
              <div key={r.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 text-sm">#{r.id}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase border ${ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente}`}>
                    {ESTADO_ICON[r.estado]}
                    {ESTADO_LABEL[r.estado] || r.estado.replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                    <User size={14} className="text-[#E31E24]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{r.cliente_nombre || `Usuario #${r.usuario_id}`}</p>
                    <p className="text-[11px] text-slate-400 truncate">{r.cliente_email || ""}</p>
                  </div>
                </div>
                {(r.origen || r.destino) && (
                  <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                    <MapPin size={12} className="text-[#E31E24] shrink-0 mt-0.5" />
                    <span className="min-w-0 truncate">{r.origen || "—"} → {r.destino || "—"}</span>
                  </div>
                )}
                {(r.fecha_salida || r.fecha_llegada || r.fecha_fin || r.fecha_regreso) && (
                  <div className="space-y-0.5 text-[10px] text-slate-500">
                    {r.fecha_salida && <p>Salida: {formatFecha(r.fecha_salida)}</p>}
                    {r.fecha_llegada && <p>Llegada estimada: {formatFecha(r.fecha_llegada)}</p>}
                    {r.fecha_fin && <p>Servicio hasta: {formatFechaCorta(r.fecha_fin)}</p>}
                    {r.fecha_regreso && <p>Regreso: {formatFechaCorta(r.fecha_regreso)}{r.hora_regreso ? ` · ${r.hora_regreso.slice(0, 5)}` : ""}</p>}
                    <p>{r.num_viajes || 1} viaje(s) · {r.modalidad_servicio === "varios_dias" || r.fecha_fin ? "Varios días" : r.modalidad_servicio === "horas" ? `Por horas${r.duracion_horas ? ` · ${r.duracion_horas} h` : ""}` : "Por día"}</p>
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{formatFecha(r.fecha_reserva)}{r.num_personas ? ` · ${r.num_personas} pers.` : ""}</span>
                  <span className="text-right font-semibold text-slate-700">
                    {r.vehiculo_placa || "Vehículo pendiente"}
                    <br /><span className="text-[10px] text-slate-400">Chofer: {r.conductor_nombre || "pendiente"}</span>
                    <br /><span className="text-[10px] text-slate-400">Preferencia: {r.tipo_vehiculo || "Sin preferencia"}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => openReservationConversation(r)} className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-black uppercase text-blue-800 hover:bg-blue-100">Conversación</button>
                  <button onClick={() => void openHistory(r)} className="flex-1 rounded-lg bg-violet-50 px-3 py-2 text-[11px] font-black uppercase text-violet-700">Historial</button>
                  <button
                    onClick={() => { setEstadoModal(r); setNuevoEstado(TRANSICIONES_VALIDAS[r.estado]?.[0] || ""); }}
                    className="flex-1 px-3 py-2 text-[11px] font-black uppercase bg-slate-100 text-slate-600 rounded-lg"
                  >Estado</button>
                  <button onClick={() => openEdit(r)} className="p-2 text-blue-500 bg-blue-50 rounded-lg" aria-label="Editar"><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(r)} className="p-2 text-red-500 bg-red-50 rounded-lg" aria-label="Eliminar"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
          {/* ESCRITORIO: tabla */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[885px] table-fixed border-collapse text-left">
              <colgroup>
                <col style={{ width: "45px" }} />
                <col style={{ width: "145px" }} />
                <col style={{ width: "125px" }} />
                <col style={{ width: "125px" }} />
                <col style={{ width: "195px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "140px" }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  {["#", "Cliente", "Unidad / conductor", "Ruta", "Fechas", "Estado", "Acciones"].map(h => (
                    <th key={h} className="px-2.5 py-3 text-[9px] font-black uppercase tracking-wide text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-2.5 py-3">
                      <span className="font-black text-slate-700 text-sm">#{r.id}</span>
                    </td>
                    <td className="px-2.5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50">
                          <User size={12} className="text-[#E31E24]" />
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 break-words text-[11px] font-black leading-tight text-slate-700" title={r.cliente_nombre || `Usuario #${r.usuario_id}`}>{r.cliente_nombre || `Usuario #${r.usuario_id}`}</p>
                          <p className="truncate text-[10px] text-slate-400" title={r.cliente_email || ""}>{r.cliente_email || ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-3">
                      <div className="space-y-1">
                        {r.vehiculo_placa ? (
                          <div className="flex min-w-0 items-center gap-1">
                            <Car size={11} className="text-slate-400" />
                            <span className="truncate text-[11px] font-black text-slate-700" title={`${r.vehiculo_placa}${r.vehiculo_modelo ? ` · ${r.vehiculo_modelo}` : ""}`}>
                              {r.vehiculo_placa}{r.vehiculo_modelo ? ` · ${r.vehiculo_modelo}` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="block truncate text-[10px] font-bold text-amber-600" title={`Preferencia: ${r.tipo_vehiculo || "Sin indicar"} · unidad pendiente`}>
                            {r.tipo_vehiculo || "Sin preferencia"} · pendiente
                          </span>
                        )}
                        {r.vehiculo_placa && <span className="block truncate text-[10px] text-slate-400" title={`Preferencia: ${r.tipo_vehiculo || "Sin indicar"}`}>Pref.: {r.tipo_vehiculo || "Sin indicar"}</span>}
                        {r.conductor_nombre && (
                          <div className="flex min-w-0 items-center gap-1">
                            <User size={11} className="text-slate-400" />
                            <span className="truncate text-[10px] text-slate-500" title={r.conductor_nombre}>{r.conductor_nombre}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2.5 py-3">
                      <div className="space-y-1">
                        {r.origen && (
                          <div className="flex min-w-0 items-center gap-1">
                            <MapPin size={10} className="text-emerald-500" />
                            <span className="min-w-0 truncate text-[10px] text-slate-600" title={r.origen}>{r.origen}</span>
                          </div>
                        )}
                        {r.destino && (
                          <div className="flex min-w-0 items-center gap-1">
                            <MapPin size={10} className="text-[#E31E24]" />
                            <span className="min-w-0 truncate text-[10px] text-slate-600" title={r.destino}>{r.destino}</span>
                          </div>
                        )}
                        {!r.origen && !r.destino && <span className="text-[10px] text-slate-300 italic">Sin ruta</span>}
                      </div>
                    </td>
                    <td className="px-2.5 py-3">
                      <p className="truncate whitespace-nowrap text-[11px] font-semibold text-slate-700" title={`Reserva: ${formatFecha(r.fecha_reserva)}`}>
                        <span className="text-slate-400">Reserva · </span>{formatFecha(r.fecha_reserva)}
                      </p>
                      {r.num_personas && <p className="text-[10px] text-slate-400">{r.num_personas} persona(s)</p>}
                      {r.fecha_salida && <p className="truncate whitespace-nowrap text-[10px] text-slate-600" title={`Salida: ${formatFecha(r.fecha_salida)}`}>Salida · {formatFecha(r.fecha_salida)}</p>}
                      {r.fecha_llegada && <p className="truncate whitespace-nowrap text-[10px] text-slate-600" title={`Llegada: ${formatFecha(r.fecha_llegada)}`}>Llegada · {formatFecha(r.fecha_llegada)}</p>}
                      {r.fecha_fin && <p className="text-[10px] text-slate-500">Hasta · {formatFechaCorta(r.fecha_fin)}</p>}
                      {r.fecha_regreso && <p className="text-[10px] text-slate-500">Regreso · {formatFechaCorta(r.fecha_regreso)}{r.hora_regreso ? ` · ${r.hora_regreso.slice(0, 5)}` : ""}</p>}
                      <p className="text-[10px] text-slate-400">{r.num_viajes || 1} viaje(s) · {r.modalidad_servicio === "varios_dias" || r.fecha_fin ? "Varios días" : r.modalidad_servicio === "horas" ? `Por horas${r.duracion_horas ? ` · ${r.duracion_horas} h` : ""}` : "Por día"}</p>
                    </td>
                    <td className="px-1 py-3">
                      <span className={`inline-flex whitespace-nowrap items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase ${ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente}`}>
                        {ESTADO_ICON[r.estado]}
                        {ESTADO_LABEL[r.estado] || r.estado.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-2.5 py-3">
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => openReservationConversation(r)} aria-label={`Conversación de reserva ${r.id}`} title="Conversación" className="rounded-lg p-1 text-blue-700 hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-[#E31E24]"><MessageCircle size={14} /></button>
                        <button type="button" onClick={() => void openHistory(r)} aria-label={`Historial de reserva ${r.id}`} className="rounded-lg p-1 text-violet-600 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-[#E31E24]" title="Ver historial"><History size={14} /></button>
                        <button
                          type="button"
                          onClick={() => {
                            setEstadoModal(r);
                            setNuevoEstado(TRANSICIONES_VALIDAS[r.estado]?.[0] || "");
                          }}
                          aria-label={`Cambiar estado de reserva ${r.id}`}
                          className="rounded-lg p-1 text-slate-600 transition-all hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#E31E24]"
                          title="Cambiar estado"
                        >
                          <Clock size={14} />
                        </button>
                        <button type="button" onClick={() => openEdit(r)} aria-label={`Editar reserva ${r.id}`} className="rounded-lg p-1 text-blue-500 transition-all hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-[#E31E24]" title="Editar">
                          <Edit3 size={14} />
                        </button>
                        <button type="button" onClick={() => handleDelete(r)} aria-label={`Eliminar reserva ${r.id}`} className="rounded-lg p-1 text-red-500 transition-all hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-[#E31E24]" title="Eliminar">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* MODAL CAMBIAR ESTADO */}
      {historyReservation && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4">
          <section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-widest text-violet-700">Auditoría</p><h2 className="mt-1 text-lg font-black text-slate-900">Historial de reserva #{historyReservation.id}</h2></div>
              <button type="button" onClick={() => setHistoryReservation(null)} aria-label="Cerrar historial" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            {historyLoading ? <div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin text-violet-600" /></div>
              : historyError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{historyError}</p>
                : reservationHistory.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Aún no hay cambios registrados para esta reserva.</p>
                  : <ol className="mt-5 space-y-3">{reservationHistory.map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="font-black text-slate-800">{HISTORIAL_ACCION_LABEL[entry.accion] || entry.accion.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{entry.estado_anterior || "—"} → {entry.estado_nuevo || "—"} · {entry.usuario_nombre || "Usuario eliminado"} {entry.usuario_apellido || ""}</p></div>
                        <time className="text-xs font-semibold text-slate-400">{new Date(entry.creado_en).toLocaleString("es-EC")}</time>
                      </div>
                      {entry.detalle && (
                        <div className="mt-3 rounded-lg bg-slate-50 p-3">
                          <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Detalle del cambio</p>
                          <dl className="space-y-2">
                            {getHistoryDetailRows(entry.detalle).map((row, index) => (
                              <div key={`${row.label}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <dt className="font-semibold text-slate-600">{row.label}</dt>
                                <dd className="font-bold text-slate-800">
                                  {row.previous !== undefined ? <>{row.previous} <ArrowRight className="mx-1 inline-block" size={12} /> {row.current}</> : row.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </li>
                  ))}</ol>}
          </section>
        </div>
      )}

      {/* MODAL CAMBIAR ESTADO */}
      {estadoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-lg text-slate-900 uppercase italic">Cambiar Estado</h3>
              <button onClick={() => setEstadoModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">Reserva <strong>#{estadoModal.id}</strong> — Estado actual: <strong className="capitalize">{estadoModal.estado}</strong></p>

            {TRANSICIONES_VALIDAS[estadoModal.estado]?.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-xl text-sm text-slate-500 font-semibold text-center">
                Este estado no permite más transiciones.
              </div>
            ) : (
              <>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Nuevo estado</label>
                <select
                  value={nuevoEstado}
                  onChange={e => setNuevoEstado(e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">Seleccionar...</option>
                  {(TRANSICIONES_VALIDAS[estadoModal.estado] || []).map(s => (
                    <option key={s} value={s}>
                      {estadoModal.estado === "en_curso" && s === "confirmada"
                        ? "Corregir a confirmada (solo si fue un error)"
                        : ESTADO_LABEL[s] || s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {estadoModal.estado === "en_curso" && nuevoEstado === "confirmada" && (
                  <label className="mt-4 block text-[10px] font-black uppercase text-slate-400">
                    Motivo obligatorio de corrección
                    <textarea
                      value={motivoEstado}
                      onChange={(event) => setMotivoEstado(event.target.value)}
                      maxLength={500}
                      minLength={10}
                      rows={3}
                      className={`${INPUT_CLS} mt-1 resize-none normal-case`}
                      placeholder="Ej.: Se marcó en curso por error; el conductor confirma que el servicio no ha iniciado."
                    />
                  </label>
                )}
                <div className="flex gap-3 mt-5">
                  <button onClick={() => { setEstadoModal(null); setMotivoEstado(""); }} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-black text-xs uppercase">Cancelar</button>
                  <button
                    onClick={handleCambiarEstado}
                    disabled={estadoLoading || !nuevoEstado || (estadoModal.estado === "en_curso" && nuevoEstado === "confirmada" && motivoEstado.trim().length < 10)}
                    className="flex-1 py-3 rounded-xl bg-[#E31E24] text-white font-black text-xs uppercase disabled:opacity-60"
                  >
                    {estadoLoading ? "Guardando..." : "Confirmar cambio"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL CREAR / EDITAR RESERVA */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-5">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-slate-900 p-4 text-white sm:p-5">
              <div className="flex items-center gap-3">
                <div className="bg-[#E31E24] p-2 rounded-xl"><Calendar size={18} /></div>
                <h2 className="font-black italic uppercase text-lg">{editingId ? "Editar Reserva" : "Nueva Reserva"}</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold leading-relaxed text-blue-800">
                <span className="font-black">Fechas y disponibilidad:</span> puedes registrar la fecha sin asignar un vehículo. La disponibilidad final y la asignación del vehículo y conductor se revisan desde Despacho, después de confirmar la reserva.
                {editingReservation && (
                  <span className="mt-1 block text-blue-700">
                    Asignación actual: {editingReservation.vehiculo_placa || "sin vehículo"} · {editingReservation.conductor_nombre || "sin conductor"}.
                  </span>
                )}
              </div>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                <div className="space-y-5">
                  <section>
                    <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">1. Cliente y datos básicos</p>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Cliente *</label>
                        <select value={form.usuario_id} onChange={e => setForm(p => ({ ...p, usuario_id: e.target.value }))} className={INPUT_CLS} required>
                          <option value="">Seleccionar cliente...</option>
                          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} — {c.email}</option>)}
                        </select>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Estado</label>
                          <div className={`${INPUT_CLS} flex cursor-not-allowed items-center text-orange-700`}>
                            {ESTADO_LABEL[editingReservation?.estado || form.estado] || (editingReservation?.estado || form.estado).replace("_", " ")}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Num. personas *</label>
                          <input type="number" min="1" value={form.num_personas} onChange={e => setForm(p => ({ ...p, num_personas: e.target.value }))} className={INPUT_CLS} required />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">2. Fechas y detalles del viaje</p>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Fecha de reserva *</label>
                        <VehiculoCalendario compact allowUnassigned vehiculoId={null} value={form.fecha_reserva} onSelect={(f) => setForm(p => ({ ...p, fecha_reserva: f }))} />
                        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">La fecha se puede elegir aquí; la disponibilidad del vehículo se verifica en Despacho.</p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Salida — fecha y hora</label>
                          <input type="datetime-local" value={form.fecha_salida} onChange={e => setForm(p => ({ ...p, fecha_salida: e.target.value }))} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Llegada estimada — fecha y hora</label>
                          <input type="datetime-local" value={form.fecha_llegada} onChange={e => setForm(p => ({ ...p, fecha_llegada: e.target.value }))} className={INPUT_CLS} />
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Modalidad del servicio</label>
                          <select
                            value={form.modalidad_servicio}
                            onChange={e => {
                              const modalidad = e.target.value;
                              setForm(current => ({
                                ...current,
                                modalidad_servicio: modalidad,
                                fecha_fin: modalidad === "varios_dias" ? current.fecha_fin : "",
                                regreso_otra_fecha: modalidad === "varios_dias" ? false : current.regreso_otra_fecha,
                                fecha_regreso: modalidad === "varios_dias" ? "" : current.fecha_regreso,
                                hora_regreso: modalidad === "varios_dias" ? "" : current.hora_regreso,
                              }));
                            }}
                            className={INPUT_CLS}
                          >
                            <option value="dia">Por día</option>
                            <option value="horas">Por horas</option>
                            <option value="varios_dias">Varios días</option>
                          </select>
                        </div>
                        {form.modalidad_servicio === "horas" && (
                          <div>
                            <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Duración (horas)</label>
                            <input
                              type="number"
                              min="0.5"
                              step="0.5"
                              value={form.duracion_horas}
                              onChange={e => setForm(p => ({ ...p, duracion_horas: e.target.value }))}
                              className={INPUT_CLS}
                            />
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Número de viajes</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={form.num_viajes}
                          onChange={e => setForm(p => ({ ...p, num_viajes: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </div>
                      {form.modalidad_servicio === "varios_dias" ? (
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Último día del servicio *</label>
                          <input
                            type="date"
                            min={form.fecha_salida ? form.fecha_salida.slice(0, 10) : undefined}
                            value={form.fecha_fin}
                            onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))}
                            className={INPUT_CLS}
                          />
                        </div>
                      ) : (
                        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                            <input
                              type="checkbox"
                              checked={form.regreso_otra_fecha}
                              onChange={e => setForm(current => ({
                                ...current,
                                regreso_otra_fecha: e.target.checked,
                                fecha_regreso: e.target.checked ? current.fecha_regreso : "",
                                hora_regreso: e.target.checked ? current.hora_regreso : "",
                              }))}
                              className="h-4 w-4 rounded border-slate-300 accent-[#E31E24]"
                            />
                            Regreso en otra fecha
                          </label>
                          {form.regreso_otra_fecha && (
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Fecha de regreso *</label>
                                <input
                                  type="date"
                                  min={form.fecha_salida ? form.fecha_salida.slice(0, 10) : undefined}
                                  value={form.fecha_regreso}
                                  onChange={e => setForm(p => ({ ...p, fecha_regreso: e.target.value }))}
                                  className={INPUT_CLS}
                                />
                              </div>
                              <div>
                                <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Hora de regreso *</label>
                                <input
                                  type="time"
                                  value={form.hora_regreso}
                                  onChange={e => setForm(p => ({ ...p, hora_regreso: e.target.value }))}
                                  className={INPUT_CLS}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Preferencia de vehículo</label>
                          <input
                            type="text"
                            maxLength={60}
                            value={form.tipo_vehiculo}
                            onChange={e => setForm(p => ({ ...p, tipo_vehiculo: e.target.value }))}
                            className={INPUT_CLS}
                            placeholder="Ej. van, minibus, bus"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section>
                    <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">3. Valor y observaciones</p>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Total ($)</label>
                        <input type="number" step="0.01" min="0" value={form.total} onChange={e => setForm(p => ({ ...p, total: e.target.value }))} className={INPUT_CLS} placeholder="0.00" />
                      </div>
                      <div>
                        <label className="mb-1 ml-1 block text-[10px] font-black uppercase text-slate-400">Notas para despacho</label>
                        <textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} rows={3} className={INPUT_CLS + " resize-none"} placeholder="Observaciones para despacho..." />
                      </div>
                    </div>
                  </section>
                </div>

                <section className="min-w-0">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Ruta del viaje</p>
                  {(form.origen || form.destino) && !adminOrigin && !adminDestination && (
                    <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      Ruta actual: <b>{form.origen || "—"}</b> → <b>{form.destino || "—"}</b>
                    </p>
                  )}
                  <MapPicker
                    origin={adminOrigin}
                    destination={adminDestination}
                    addressSearch
                    onChange={(which, val) => which === "origin" ? setAdminOrigin(val) : setAdminDestination(val)}
                  />
                </section>
              </div>

              {err && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{err}</p>}
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-100 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-2xl border-2 border-slate-100 px-6 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-all hover:border-slate-300">
                  Cancelar
                </button>
                <button type="submit" disabled={savingReservation || !canSubmitReservation} className="rounded-2xl bg-[#E31E24] px-8 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-200 transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-50">
                  {savingReservation ? "Guardando..." : editingId ? "Guardar cambios" : "Crear reserva"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
