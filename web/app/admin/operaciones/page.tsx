"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, History, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { getAuthHeaders } from "../../../lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type ApiList<T> = T[] | { data?: T[] };

const getApiList = <T,>(payload: ApiList<T>) =>
  Array.isArray(payload) ? payload : payload.data || [];

const readApiJson = async <T,>(response: Response, path: string): Promise<T> => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new Error(
      `La API devolvió HTML en ${path} (HTTP ${response.status}). Verifica NEXT_PUBLIC_API_URL y que el backend publicado tenga esta ruta.`
    );
  }

  let payload: T;
  try {
    payload = await response.json() as T;
  } catch {
    throw new Error(`La API devolvió JSON inválido en ${path} (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const errorMessage = typeof payload === "object" && payload !== null && "error" in payload
      && typeof payload.error === "string"
      ? payload.error
      : `La solicitud a ${path} falló (HTTP ${response.status}).`;
    throw new Error(errorMessage);
  }

  return payload;
};

type Operation = {
  id: number;
  reserva_id?: number | null;
  requerimiento_id?: number | null;
  grupo_numero?: number | null;
  unidad_numero?: number | null;
  tipo_servicio: string;
  tipo_vehiculo_solicitado?: string | null;
  fecha_programada: string;
  fecha_fin_programada?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  origen: string;
  destino: string;
  pasajeros: number;
  estado: string;
  vehiculo_id?: number | null;
  conductor_id?: number | null;
  conductor_usuario_id?: number | null;
  vehiculo_placa?: string | null;
  conductor_nombre?: string | null;
  conductor_apellido?: string | null;
  empresa_asociada_id?: number | null;
  vehiculo_asociado_id?: number | null;
  subcontratacion_estado?: "no_requerida" | "pendiente" | "confirmada";
  subcontratista_empresa?: string | null;
  subcontratista_contacto?: string | null;
  subcontratista_telefono?: string | null;
  subcontratista_vehiculo?: string | null;
  subcontratista_placa?: string | null;
  subcontratista_conductor?: string | null;
  subcontratista_conductor_telefono?: string | null;
  subcontratacion_costo?: string | number | null;
};

type ReservationReady = {
  id: number;
  fecha_reserva: string;
  fecha_servicio?: string | null;
  fecha_salida?: string | null;
  fecha_llegada?: string | null;
  origen?: string | null;
  destino?: string | null;
  num_personas: number;
  total: number;
  tipo_vehiculo?: string | null;
  vehiculo_id?: number | null;
  conductor_id?: number | null;
  operacion_cancelada_id?: number | null;
  cliente_nombre?: string | null;
  vehiculo_placa?: string | null;
};

type Vehicle = { id: number; placa: string; modelo: string; capacidad: number; estado: string; activo: boolean };
type Driver = { id: number; nombre: string; apellido?: string; estado: string; activo: boolean };
type PartnerVehicle = {
  id: number;
  empresa_id: number;
  placa: string;
  modelo: string;
  capacidad: number;
  conductor: string | null;
  conductor_telefono: string | null;
  activo: boolean;
};
type PartnerCompany = {
  id: number;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  activa: boolean;
  vehiculos: PartnerVehicle[];
};
type AssignmentRecommendation = {
  decisionId: number | null;
  fecha: string;
  fecha_fin: string;
  vehiculo: { vehiculo_id: number; conductor_id?: number | null; placa: string; puntaje: number; razones: string[] } | null;
  alternativas: Array<{ vehiculo_id: number; placa: string }>;
  evaluados: Array<{
    vehiculo_id: number;
    placa: string;
    modelo: string;
    capacidad: number;
    bloqueos: string[];
    advertencias: string[];
    elegible: boolean;
  }>;
  excluidos: Array<{
    vehiculo_id: number;
    placa: string;
    modelo: string;
    capacidad: number;
    bloqueos: string[];
    advertencias: string[];
    elegible: boolean;
  }>;
};
type OperationHistoryEntry = {
  id: number;
  accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  detalle: Record<string, unknown> | string | null;
  creado_en: string;
  usuario_nombre: string | null;
  usuario_apellido: string | null;
};

const stateLabels: Record<string, string> = {
  programada: "Programada",
  asignada: "Asignada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
  incidencia: "Incidencia",
};

const subcontractingLabels: Record<string, string> = {
  no_requerida: "No subcontratada",
  pendiente: "Pendiente de proveedor",
  confirmada: "Subcontratación confirmada",
};

const formatDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
};

const formatTime = (value?: string | null) => value?.slice(0, 5) || null;
const dateKey = (value?: string | null) => value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
const localToday = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};
const reservationServiceDate = (reservation: ReservationReady) =>
  dateKey(reservation.fecha_salida) || dateKey(reservation.fecha_servicio) || dateKey(reservation.fecha_reserva);
const reservationServiceTime = (reservation: ReservationReady) => {
  const dateTime = [reservation.fecha_salida, reservation.fecha_servicio, reservation.fecha_llegada]
    .find((value) => value && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value));
  return dateTime ? dateTime.slice(11, 16) : "";
};
const compareSchedule = (dateA: string, timeA: string, dateB: string, timeB: string) =>
  dateA.localeCompare(dateB) || timeA.localeCompare(timeB);

export default function OperacionesPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [reservations, setReservations] = useState<ReservationReady[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [partnerCompanies, setPartnerCompanies] = useState<PartnerCompany[]>([]);
  const [assignmentResourcesLoading, setAssignmentResourcesLoading] = useState(false);
  const [partnerCompaniesLoading, setPartnerCompaniesLoading] = useState(false);
  const [assignmentResourcesError, setAssignmentResourcesError] = useState("");
  const [partnerCompaniesError, setPartnerCompaniesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusedReservationId, setFocusedReservationId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [assignment, setAssignment] = useState<Operation | null>(null);
  const [subcontracting, setSubcontracting] = useState<Operation | null>(null);
  const [historyOperation, setHistoryOperation] = useState<Operation | null>(null);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [subcontractingForm, setSubcontractingForm] = useState({
    estado: "pendiente" as "no_requerida" | "pendiente" | "confirmada",
    empresa_asociada_id: "",
    vehiculo_asociado_id: "",
    empresa: "",
    contacto: "",
    telefono: "",
    vehiculo: "",
    placa: "",
    conductor: "",
    conductor_telefono: "",
    costo: "",
  });
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [assignmentRecommendation, setAssignmentRecommendation] = useState<AssignmentRecommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [form, setForm] = useState({
    tipo_servicio: "viaje",
    fecha_programada: new Date().toISOString().slice(0, 10),
    hora_inicio: "08:00",
    hora_fin: "10:00",
    origen: "",
    destino: "",
    pasajeros: "1",
  });
  const today = localToday();
  const sortedReservations = [...reservations].sort((a, b) => a.id - b.id);
  const activeOperationStates = ["programada", "asignada", "en_curso", "incidencia"];
  const sortedOperations = [...operations].sort((a, b) => {
    const activeRankA = activeOperationStates.includes(a.estado) ? 0 : 1;
    const activeRankB = activeOperationStates.includes(b.estado) ? 0 : 1;
    return activeRankA - activeRankB
      || compareSchedule(
        dateKey(a.fecha_programada),
        formatTime(a.hora_inicio) || "",
        dateKey(b.fecha_programada),
        formatTime(b.hora_inicio) || ""
      )
      || a.id - b.id;
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const headers = getAuthHeaders();
      const [operationsRes, reservationsRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/operaciones`, { headers }),
        fetch(`${API_URL}/api/admin/operaciones/reservas-pendientes`, { headers }),
      ]);
      const [operationsData, reservationsData] = await Promise.all([
        readApiJson<{ data?: Operation[] }>(operationsRes, "/api/admin/operaciones"),
        readApiJson<{ data?: ReservationReady[] }>(reservationsRes, "/api/admin/operaciones/reservas-pendientes"),
      ]);
      setOperations(operationsData.data || []);
      setReservations(reservationsData.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Error cargando datos operativos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const reservationId = Number(new URLSearchParams(window.location.search).get("reserva_id"));
    if (Number.isInteger(reservationId) && reservationId > 0) setFocusedReservationId(reservationId);
  }, []);

  useEffect(() => {
    if (loading || !focusedReservationId) return;
    const target = document.querySelector(`[data-reservation-id="${focusedReservationId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, focusedReservationId, reservations, operations]);

  const request = async (url: string, options: RequestInit) => {
    const response = await fetch(`${API_URL}${url}`, { ...options, headers: { ...getAuthHeaders(), "Content-Type": "application/json" } });
    return readApiJson<Record<string, unknown>>(response, url);
  };

  const openOperationHistory = async (operation: Operation) => {
    setHistoryOperation(operation);
    setOperationHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const payload = await request(`/api/admin/operaciones/${operation.id}/historial`, { method: "GET" });
      setOperationHistory(payload.data as OperationHistoryEntry[] || []);
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historial");
    } finally {
      setHistoryLoading(false);
    }
  };

  const sendReservationToDispatch = async (reservation: ReservationReady) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request(
        reservation.operacion_cancelada_id
          ? `/api/admin/operaciones/${reservation.operacion_cancelada_id}/reabrir`
          : `/api/admin/operaciones/reservas/${reservation.id}/despachar`,
        {
          method: reservation.operacion_cancelada_id ? "PATCH" : "POST",
          body: JSON.stringify({}),
        }
      );
      setMessage(reservation.operacion_cancelada_id
        ? `Se reabrió el despacho cancelado de la reserva #${reservation.id}.`
        : `La reserva #${reservation.id} quedó preparada para despacho.`);
      await load();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "No se pudo preparar el despacho");
    } finally {
      setSaving(false);
    }
  };

  const reopenOperation = async (operation: Operation) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await request(`/api/admin/operaciones/${operation.id}/reabrir`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      setMessage(`Se reabrió la unidad ${operation.unidad_numero || ""} del requerimiento #${operation.requerimiento_id || ""}.`);
      await load();
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "No se pudo reabrir la operación");
    } finally {
      setSaving(false);
    }
  };

  const createOperation = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request("/api/admin/operaciones", { method: "POST", body: JSON.stringify({ ...form, pasajeros: Number(form.pasajeros) }) });
      setMessage("Operación creada correctamente");
      setShowCreate(false);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo crear la operación");
    } finally {
      setSaving(false);
    }
  };

  const assignOperation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!assignment) return;
    const selectedVehicle = Number(selectedVehicleId);
    const selectedDriver = Number(selectedDriverId);
    const selectingAlternative = assignmentRecommendation !== null
      && selectedVehicle !== assignmentRecommendation.vehiculo?.vehiculo_id;
    if (selectingAlternative && !decisionReason.trim()) {
      setError("Indica por qué se eligió una alternativa a la recomendación.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request(`/api/admin/operaciones/${assignment.id}/asignar`, {
        method: "PATCH",
        body: JSON.stringify({
          vehiculo_id: selectedVehicle,
          conductor_id: selectedDriver,
          ...(assignmentRecommendation ? {
            decision_id: assignmentRecommendation.decisionId,
            decision_reason: decisionReason.trim(),
          } : {}),
        }),
      });
      setMessage("Recursos asignados. Las validaciones operativas fueron aprobadas.");
      setAssignment(null);
      setAssignmentRecommendation(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo asignar la operación");
    } finally {
      setSaving(false);
    }
  };

  const openSubcontracting = async (operation: Operation) => {
    setSubcontracting(operation);
    setPartnerCompaniesLoading(true);
    setPartnerCompaniesError("");
    setSubcontractingForm({
      estado: operation.subcontratacion_estado && operation.subcontratacion_estado !== "no_requerida"
        ? operation.subcontratacion_estado
        : "pendiente",
      empresa_asociada_id: operation.empresa_asociada_id ? String(operation.empresa_asociada_id) : "",
      vehiculo_asociado_id: operation.vehiculo_asociado_id ? String(operation.vehiculo_asociado_id) : "",
      empresa: operation.subcontratista_empresa || "",
      contacto: operation.subcontratista_contacto || "",
      telefono: operation.subcontratista_telefono || "",
      vehiculo: operation.subcontratista_vehiculo || "",
      placa: operation.subcontratista_placa || "",
      conductor: operation.subcontratista_conductor || "",
      conductor_telefono: operation.subcontratista_conductor_telefono || "",
      costo: operation.subcontratacion_costo == null ? "" : String(operation.subcontratacion_costo),
    });
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/admin/empresas-asociadas`, { headers: getAuthHeaders() });
      const payload = await readApiJson<{ data?: PartnerCompany[] }>(response, "/api/admin/empresas-asociadas");
      setPartnerCompanies(payload.data || []);
    } catch (loadError) {
      setPartnerCompaniesError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las empresas asociadas");
    } finally {
      setPartnerCompaniesLoading(false);
    }
  };

  const saveSubcontracting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subcontracting) return;
    setSaving(true);
    setError("");
    try {
      await request(`/api/admin/operaciones/${subcontracting.id}/subcontratacion`, {
        method: "PATCH",
        body: JSON.stringify(subcontractingForm),
      });
      setMessage(subcontractingForm.estado === "confirmada"
        ? "Subcontratación confirmada. La operación quedó lista para iniciar."
        : subcontractingForm.estado === "no_requerida"
          ? "Se retiró la subcontratación; la operación volvió a despacho propio."
          : "Se guardó la subcontratación pendiente.");
      setSubcontracting(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la subcontratación");
    } finally {
      setSaving(false);
    }
  };

  const selectedPartner = partnerCompanies.find((company) => String(company.id) === subcontractingForm.empresa_asociada_id);
  const partnerVehicles = selectedPartner?.vehiculos.filter((vehicle) => vehicle.activo) || [];

  const openAssignment = async (operation: Operation) => {
    setAssignment(operation);
    setAssignmentResourcesLoading(true);
    setAssignmentResourcesError("");
    setSelectedVehicleId(operation.vehiculo_id ? String(operation.vehiculo_id) : "");
    setSelectedDriverId(operation.conductor_usuario_id ? String(operation.conductor_usuario_id) : "");
    setAssignmentRecommendation(null);
    setDecisionReason("");
    setError("");
    try {
      const headers = getAuthHeaders();
      const [vehiclesResponse, driversResponse] = await Promise.all([
        fetch(`${API_URL}/api/admin/vehiculos`, { headers }),
        fetch(`${API_URL}/api/admin/conductores`, { headers }),
      ]);
      const [vehiclesData, driversData] = await Promise.all([
        readApiJson<ApiList<Vehicle>>(vehiclesResponse, "/api/admin/vehiculos"),
        readApiJson<ApiList<Driver>>(driversResponse, "/api/admin/conductores"),
      ]);
      setVehicles(getApiList(vehiclesData));
      setDrivers(getApiList(driversData));
    } catch (loadError) {
      setAssignmentResourcesError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los vehículos y conductores");
    } finally {
      setAssignmentResourcesLoading(false);
    }
  };

  const recommendAssignment = async () => {
    if (!assignment) return;
    setRecommendationLoading(true);
    setAssignmentRecommendation(null);
    setError("");
    try {
      const query = new URLSearchParams({
        fecha: assignment.fecha_programada,
        fecha_fin: assignment.fecha_fin_programada || assignment.fecha_programada,
        pasajeros: String(assignment.pasajeros),
        operacion_id: String(assignment.id),
      });
      if (assignment.hora_inicio) query.set("hora_inicio", assignment.hora_inicio.slice(0, 5));
      if (assignment.hora_fin) query.set("hora_fin", assignment.hora_fin.slice(0, 5));
      const payload = await request(`/api/admin/inteligencia/asignacion-recomendada?${query}`, { method: "GET" });
      const recommendation = payload.data as AssignmentRecommendation;
      setAssignmentRecommendation(recommendation);
      setSelectedVehicleId(recommendation.vehiculo ? String(recommendation.vehiculo.vehiculo_id) : "");
      if (recommendation.vehiculo?.conductor_id) {
        setSelectedDriverId(String(recommendation.vehiculo.conductor_id));
      }
      setDecisionReason("");
    } catch (recommendationError) {
      setError(recommendationError instanceof Error ? recommendationError.message : "No se pudo generar la recomendación");
    } finally {
      setRecommendationLoading(false);
    }
  };

  const changeState = async (operation: Operation, estado: string) => {
    setSaving(true);
    setError("");
    try {
      await request(`/api/admin/operaciones/${operation.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado }) });
      setMessage(`Operación ${stateLabels[estado].toLowerCase()}.`);
      await load();
    } catch (stateError) {
      setError(stateError instanceof Error ? stateError.message : "No se pudo cambiar el estado");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Gestión operativa</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Despacho de servicios</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Prepara reservas confirmadas, asigna recursos y supervisa cada servicio con validaciones operativas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300">
            <Plus size={17} /> Crear servicio manual
          </button>
        </div>
      </header>

      {(message || error) && (
        <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-semibold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || message}</span>
          <button className="ml-auto" onClick={() => { setMessage(""); setError(""); }} aria-label="Cerrar mensaje"><X size={16} /></button>
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/70 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Flujo principal</p>
            <h2 className="mt-1 font-black text-slate-900">Reservas confirmadas por despachar</h2>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{reservations.length}</span>
        </div>
        {loading ? <p className="p-6 text-center text-sm font-semibold text-slate-400">Buscando reservas confirmadas...</p> : reservations.length === 0 ? (
          <div className="p-7 text-center">
            <p className="text-sm font-black text-slate-600">No hay reservas pendientes de despacho</p>
            <p className="mt-1 text-xs text-slate-400">Toda reserva confirmada sin un despacho activo aparecerá aquí para asignar o verificar sus recursos.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedReservations.map((reservation) => {
              const serviceDate = reservationServiceDate(reservation);
              const serviceTime = reservationServiceTime(reservation);
              const overdue = Boolean(serviceDate && serviceDate < today);
              return (
              <article key={reservation.id} data-reservation-id={reservation.id} className={`grid gap-4 border-l-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5 ${focusedReservationId === reservation.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : overdue ? "border-l-red-400 bg-red-50/40" : "border-l-transparent"}`}>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black leading-snug text-slate-900">Reserva #{reservation.id}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {overdue ? "Fecha vencida" : "Por despachar"}
                    </span>
                    <span className="text-sm font-semibold text-slate-500">{reservation.cliente_nombre || "Cliente"}</span>
                  </div>
                  <p className="break-words rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                    <span className="font-semibold">{reservation.origen || "Origen pendiente"}</span>
                    <span className="px-2 text-slate-400">→</span>
                    <span className="font-semibold">{reservation.destino || "Destino pendiente"}</span>
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className={`font-bold ${overdue ? "text-red-700" : "text-slate-700"}`}>
                      {serviceDate ? formatDate(serviceDate) : "Fecha pendiente"}{serviceTime ? ` · ${serviceTime}` : ""}
                    </span>
                    <span>{reservation.num_personas} pasajeros</span>
                    <span>Vehículo: {reservation.vehiculo_placa || "pendiente"}</span>
                    {reservation.tipo_vehiculo && <span>Preferencia: {reservation.tipo_vehiculo}</span>}
                    <span>Conductor: {reservation.conductor_id ? "asignado" : "pendiente"}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void sendReservationToDispatch(reservation)}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reservation.operacion_cancelada_id ? "Reabrir despacho" : "Preparar despacho"} <ArrowRight size={15} />
                </button>
              </article>
            );})}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3"><ClipboardList className="text-cyan-600" size={20} /><h2 className="font-black text-slate-900">Servicios programados</h2></div>
          <button onClick={() => void load()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Actualizar operaciones"><RefreshCw size={17} /></button>
        </div>
        {loading ? <p className="p-8 text-center text-sm font-semibold text-slate-400">Cargando servicios...</p> : operations.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-black text-slate-500">No hay servicios programados</p><p className="mt-1 text-xs text-slate-400">Las reservas confirmadas aparecerán aquí para asignar conductor y vehículo.</p></div> : (
          <div className="space-y-3 p-3 sm:p-5">
            {sortedOperations.map((operation) => {
              const startTime = formatTime(operation.hora_inicio);
              const endTime = formatTime(operation.hora_fin);
              const scheduledDate = dateKey(operation.fecha_programada);
              const overdue = activeOperationStates.includes(operation.estado) && Boolean(scheduledDate && scheduledDate < today);
              const subcontractState = operation.subcontratacion_estado || "no_requerida";
              const canEditSubcontracting = activeOperationStates.includes(operation.estado);
              const dateRange = operation.fecha_fin_programada && dateKey(operation.fecha_fin_programada) !== scheduledDate
                ? `${formatDate(scheduledDate)} - ${formatDate(dateKey(operation.fecha_fin_programada))}`
                : formatDate(scheduledDate);
              const serviceTitle = operation.requerimiento_id
                ? `Requerimiento #${operation.requerimiento_id} · Grupo ${operation.grupo_numero} · Unidad ${operation.unidad_numero}`
                : operation.reserva_id ? `Reserva #${operation.reserva_id}` : operation.tipo_servicio;
              return (
                <article key={operation.id} data-reservation-id={operation.reserva_id || undefined} className={`rounded-2xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${focusedReservationId === operation.reserva_id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : overdue ? "border-l-red-400 bg-red-50/30" : "border-l-cyan-400"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black leading-snug text-slate-900">{serviceTitle}</h3>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">Operación #{operation.id}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${overdue ? "bg-red-100 text-red-700" : "bg-cyan-50 text-cyan-800"}`}>
                      {overdue ? "Fecha vencida" : stateLabels[operation.estado] || operation.estado}
                    </span>
                    {subcontractState !== "no_requerida" && (
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${subcontractState === "confirmada" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                        {subcontractingLabels[subcontractState]}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)]">
                    <div className="min-w-0 rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ruta</p>
                      <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-slate-800">{operation.origen || "Origen pendiente"}</p>
                      <p className="my-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">hasta</p>
                      <p className="break-words text-sm font-semibold leading-relaxed text-slate-900">{operation.destino || "Destino pendiente"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl border border-slate-100 p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Fecha y hora</p>
                        <p className={`mt-1 font-bold ${overdue ? "text-red-700" : "text-slate-800"}`}>{dateRange}</p>
                        <p className="mt-0.5 text-slate-500">{startTime || "Sin hora"}{endTime ? ` - ${endTime}` : ""}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Grupo</p>
                        <p className="mt-1 font-bold text-slate-800">{operation.pasajeros} pasajeros</p>
                        {operation.tipo_vehiculo_solicitado && <p className="mt-0.5 text-slate-500">{operation.tipo_vehiculo_solicitado} solicitado</p>}
                      </div>
                      <div className="col-span-2 rounded-xl border border-slate-100 p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Recursos</p>
                        {subcontractState !== "no_requerida" ? (
                          <div className="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-3">
                            <p className="font-bold text-slate-800">{operation.subcontratista_placa || "Proveedor pendiente"}</p>
                            <p className="text-slate-600">{operation.subcontratista_empresa || "Sin proveedor registrado"}</p>
                            <p className="text-slate-600">{operation.subcontratista_conductor || "Sin conductor registrado"}</p>
                          </div>
                        ) : (
                          <div className="mt-1 grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                            <p className="font-bold text-slate-800">{operation.vehiculo_placa || "Sin vehículo"}</p>
                            <p className="text-slate-600">{operation.conductor_nombre ? `${operation.conductor_nombre} ${operation.conductor_apellido || ""}` : "Sin conductor"}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <button onClick={() => void openOperationHistory(operation)} className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700">Historial</button>
                    {["programada", "asignada"].includes(operation.estado) && subcontractState === "no_requerida" && <button onClick={() => openAssignment(operation)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">{operation.vehiculo_id ? "Reasignar" : "Asignar"}</button>}
                    {canEditSubcontracting && <button onClick={() => openSubcontracting(operation)} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">{subcontractState === "no_requerida" ? "Subcontratar" : "Editar proveedor"}</button>}
                    {operation.estado === "asignada" && <button onClick={() => void changeState(operation, "en_curso")} disabled={saving} className="rounded-lg bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-700">Iniciar</button>}
                    {operation.estado === "en_curso" && <button onClick={() => void changeState(operation, "completada")} disabled={saving} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Finalizar</button>}
                    {operation.estado === "cancelada" && <button onClick={() => void reopenOperation(operation)} disabled={saving} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Reabrir unidad</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={createOperation} className="w-full max-w-2xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-slate-950">Nueva operación</h2><button type="button" onClick={() => setShowCreate(false)} aria-label="Cerrar formulario"><X /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-600">Tipo de servicio<input value={form.tipo_servicio} onChange={(e) => setForm({ ...form, tipo_servicio: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Pasajeros<input type="number" min="1" value={form.pasajeros} onChange={(e) => setForm({ ...form, pasajeros: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Fecha<input type="date" value={form.fecha_programada} onChange={(e) => setForm({ ...form, fecha_programada: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><div className="grid grid-cols-2 gap-2"><label className="text-sm font-bold text-slate-600">Inicio<input type="time" value={form.hora_inicio} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold text-slate-600">Fin<input type="time" value={form.hora_fin} onChange={(e) => setForm({ ...form, hora_fin: e.target.value })} className="mt-1 w-full rounded-xl border p-3" /></label></div><label className="text-sm font-bold text-slate-600">Origen<input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Destino<input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label></div><button disabled={saving} className="w-full rounded-xl bg-slate-950 py-3 font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Crear operación"}</button></form></div>}

      {assignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <form
            onSubmit={assignOperation}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-cyan-600">
                  Operación #{assignment.id}{assignment.reserva_id ? ` · Reserva #${assignment.reserva_id}` : ""}
                </p>
                <h2 className="text-xl font-black text-slate-950">Asignar recursos</h2>
              </div>
              <button type="button" onClick={() => { setAssignment(null); setAssignmentRecommendation(null); }} aria-label="Cerrar asignación">
                <X />
              </button>
            </div>
            {assignmentResourcesLoading && <p role="status" className="rounded-xl bg-cyan-50 p-3 text-xs font-semibold text-cyan-800">Cargando vehículos y conductores...</p>}
            {assignmentResourcesError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{assignmentResourcesError}</p>}
            <button
              type="button"
              onClick={() => void recommendAssignment()}
              disabled={recommendationLoading || saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-bold text-cyan-800 disabled:opacity-50"
            >
              <Sparkles size={16} />
              {recommendationLoading ? "Evaluando disponibilidad..." : assignmentRecommendation ? "Actualizar recomendación" : "Sugerir vehículo"}
            </button>
            {assignmentRecommendation && (
              <div className="space-y-3">
                {assignmentRecommendation.vehiculo ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <p className="font-black">Sugerido: {assignmentRecommendation.vehiculo.placa} · puntaje {assignmentRecommendation.vehiculo.puntaje}/100</p>
                    <ul className="mt-1 list-inside list-disc">
                      {assignmentRecommendation.vehiculo.razones.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                ) : (
                  <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
                    No hay vehículos elegibles para todo el período. Revisa los motivos antes de continuar.
                  </div>
                )}
                {assignmentRecommendation.excluidos.length > 0 && (
                  <details open className="rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-3 py-2.5 text-xs font-black text-slate-700">
                      Vehículos no elegibles ({assignmentRecommendation.excluidos.length})
                    </summary>
                    <ul className="max-h-52 space-y-2 overflow-y-auto border-t border-slate-100 p-3">
                      {assignmentRecommendation.excluidos.map((vehicle) => (
                        <li key={vehicle.vehiculo_id} className="rounded-lg border border-red-100 bg-red-50/70 p-2.5">
                          <p className="text-xs font-black text-slate-800">{vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} plazas</p>
                          <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-red-800">
                            {vehicle.bloqueos.map((reason) => <li key={reason}>{reason}</li>)}
                          </ul>
                          {vehicle.advertencias.length > 0 && (
                            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-800">
                              {vehicle.advertencias.map((warning) => <li key={warning}>{warning}</li>)}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {assignmentRecommendation.vehiculo
                  && (assignmentRecommendation.evaluados.find((vehicle) => vehicle.vehiculo_id === assignmentRecommendation.vehiculo?.vehiculo_id)?.advertencias.length || 0) > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-black">Advertencias de la opción sugerida</p>
                    <ul className="mt-1 list-inside list-disc">
                        {assignmentRecommendation.evaluados
                        .find((vehicle) => vehicle.vehiculo_id === assignmentRecommendation.vehiculo?.vehiculo_id)
                        ?.advertencias.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <label className="block text-sm font-bold text-slate-600">
              Vehículo
              <select
                name="vehiculo_id"
                value={selectedVehicleId}
                onChange={(event) => {
                  setSelectedVehicleId(event.target.value);
                  if (event.target.value === String(assignmentRecommendation?.vehiculo?.vehiculo_id)) setDecisionReason("");
                }}
                className="mt-1 w-full rounded-xl border p-3"
                disabled={assignmentResourcesLoading || Boolean(assignmentResourcesError)}
                required
              >
                <option value="">Selecciona un vehículo</option>
                {vehicles.filter((vehicle) => vehicle.activo && vehicle.estado === "disponible" && (!assignmentRecommendation || vehicle.id === assignmentRecommendation.vehiculo?.vehiculo_id || assignmentRecommendation.alternativas.some((option) => option.vehiculo_id === vehicle.id))).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} pax</option>
                ))}
              </select>
            </label>
            {assignmentRecommendation && selectedVehicleId !== String(assignmentRecommendation.vehiculo?.vehiculo_id) && (
              <label className="block text-sm font-bold text-slate-600">
                Motivo para elegir otra opción
                <textarea
                  value={decisionReason}
                  onChange={(event) => setDecisionReason(event.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-xl border p-3"
                  required
                  rows={2}
                />
              </label>
            )}
            <label className="block text-sm font-bold text-slate-600">
              Conductor
              <select name="conductor_id" value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)} className="mt-1 w-full rounded-xl border p-3" disabled={assignmentResourcesLoading || Boolean(assignmentResourcesError)} required>
                <option value="">Selecciona un conductor</option>
                {drivers.filter((driver) => driver.activo && !["inactivo", "mantenimiento"].includes(driver.estado)).map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.nombre} {driver.apellido || ""}</option>
                ))}
              </select>
            </label>
            <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              La sugerencia es una ayuda para decidir, no una asignación automática. El backend valida capacidad, mantenimiento, licencia y conflictos de horario antes de confirmar.
            </p>
            <button disabled={saving || assignmentResourcesLoading || Boolean(assignmentResourcesError)} className="w-full rounded-xl bg-cyan-500 py-3 font-black text-slate-950 disabled:opacity-50">
              {saving ? "Validando..." : "Confirmar asignación"}
            </button>
          </form>
        </div>
      )}

      {subcontracting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4">
          <form
            onSubmit={saveSubcontracting}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl space-y-4 overflow-y-auto overscroll-contain rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-amber-700">
                  Operación #{subcontracting.id}{subcontracting.reserva_id ? ` · Reserva #${subcontracting.reserva_id}` : ""}
                </p>
                <h2 className="text-xl font-black text-slate-950">Gestionar subcontratación</h2>
              </div>
              <button type="button" onClick={() => setSubcontracting(null)} aria-label="Cerrar subcontratación"><X /></button>
            </div>
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Registra aquí los datos que el administrador acuerde directamente con el proveedor. No se creará una cuenta externa ni se añadirá su vehículo a la flota.
            </p>
            {partnerCompaniesLoading && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Cargando empresas y vehículos asociados...</p>}
            {partnerCompaniesError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{partnerCompaniesError}</p>}
            <label className="block text-sm font-bold text-slate-600">
              Estado del servicio externo
              <select
                value={subcontractingForm.estado}
                onChange={(event) => {
                  const estado = event.target.value;
                  if (estado === "no_requerida" || estado === "pendiente" || estado === "confirmada") {
                    setSubcontractingForm({ ...subcontractingForm, estado });
                  }
                }}
                className="mt-1 w-full rounded-xl border p-3"
              >
                <option value="pendiente">Pendiente de proveedor</option>
                <option value="confirmada">Confirmada</option>
                {subcontracting.subcontratacion_estado !== "no_requerida" && (
                  <option value="no_requerida">Retirar subcontratación</option>
                )}
              </select>
            </label>
            {subcontractingForm.estado !== "no_requerida" && (
              <>
                <div className="grid gap-4 rounded-xl border border-amber-100 bg-amber-50/60 p-4 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-600">Empresa registrada
                    <select
                      value={subcontractingForm.empresa_asociada_id}
                      onChange={(event) => {
                        const companyId = event.target.value;
                        const company = partnerCompanies.find((item) => String(item.id) === companyId);
                        setSubcontractingForm({
                          ...subcontractingForm,
                          empresa_asociada_id: companyId,
                          vehiculo_asociado_id: "",
                          empresa: company?.nombre || "",
                          contacto: company?.contacto || "",
                          telefono: company?.telefono || "",
                          vehiculo: "",
                          placa: "",
                          conductor: "",
                          conductor_telefono: "",
                        });
                      }}
                      className="mt-1 w-full rounded-xl border bg-white p-3"
                      disabled={partnerCompaniesLoading || Boolean(partnerCompaniesError)}
                    >
                      <option value="">Selecciona empresa (o completa datos históricos abajo)</option>
                      {partnerCompanies.filter((company) => company.activa).map((company) => (
                        <option key={company.id} value={company.id}>{company.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-bold text-slate-600">Vehículo registrado
                    <select
                      value={subcontractingForm.vehiculo_asociado_id}
                      onChange={(event) => {
                        const vehicleId = event.target.value;
                        const vehicle = partnerVehicles.find((item) => String(item.id) === vehicleId);
                        setSubcontractingForm({
                          ...subcontractingForm,
                          vehiculo_asociado_id: vehicleId,
                          vehiculo: vehicle?.modelo || "",
                          placa: vehicle?.placa || "",
                          conductor: vehicle?.conductor || "",
                          conductor_telefono: vehicle?.conductor_telefono || "",
                        });
                      }}
                      disabled={!selectedPartner}
                      className="mt-1 w-full rounded-xl border bg-white p-3 disabled:bg-slate-100"
                    >
                      <option value="">Selecciona un vehículo</option>
                      {partnerVehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>{vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} plazas</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs leading-relaxed text-slate-600 sm:col-span-2">
                    Administra empresas y vehículos en <a href="/admin/empresas-asociadas" className="font-bold text-[#E31E24] underline">Empresas asociadas</a>. Las asignaciones registradas comprueban capacidad y cruces de horario.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-600">Empresa proveedora
                    <input maxLength={160} value={subcontractingForm.empresa} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, empresa: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Persona de contacto
                    <input maxLength={120} value={subcontractingForm.contacto} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, contacto: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Teléfono del proveedor
                    <input maxLength={40} type="tel" value={subcontractingForm.telefono} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, telefono: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Vehículo / modelo
                    <input maxLength={120} value={subcontractingForm.vehiculo} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, vehiculo: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Placa
                    <input maxLength={30} value={subcontractingForm.placa} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, placa: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Nombre del conductor
                    <input maxLength={120} value={subcontractingForm.conductor} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, conductor: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Teléfono del conductor
                    <input maxLength={40} type="tel" value={subcontractingForm.conductor_telefono} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, conductor_telefono: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                  <label className="text-sm font-bold text-slate-600">Costo acordado
                    <input min="0" max="99999999.99" step="0.01" type="number" value={subcontractingForm.costo} onChange={(event) => setSubcontractingForm({ ...subcontractingForm, costo: event.target.value })} className="mt-1 w-full rounded-xl border p-3" required={subcontractingForm.estado === "confirmada"} />
                  </label>
                </div>
                {subcontractingForm.estado === "pendiente" && (
                  <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    Puedes guardar la operación como pendiente mientras buscas proveedor. Para confirmarla, completa todos los datos y el costo acordado.
                  </p>
                )}
              </>
            )}
            {subcontractingForm.estado === "no_requerida" && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                Se quitarán los datos del proveedor y la operación volverá a la asignación con recursos propios.
              </p>
            )}
            <button disabled={saving} className="w-full rounded-xl bg-slate-950 py-3 font-black text-white disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar subcontratación"}
            </button>
          </form>
        </div>
      )}
      {historyOperation && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <section className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-widest text-violet-700">Auditoría del despacho</p><h2 className="mt-1 text-lg font-black text-slate-900">Operación #{historyOperation.id}</h2></div>
              <button type="button" onClick={() => setHistoryOperation(null)} aria-label="Cerrar historial" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            {historyLoading ? <p className="py-12 text-center text-sm font-bold text-slate-400">Cargando historial...</p>
              : historyError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{historyError}</p>
                : operationHistory.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Aún no hay cambios registrados.</p>
                  : <ol className="mt-5 space-y-3">{operationHistory.map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="font-black capitalize text-slate-800">{entry.accion.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{entry.estado_anterior || "—"} → {entry.estado_nuevo || "—"} · {entry.usuario_nombre || "Usuario eliminado"} {entry.usuario_apellido || ""}</p></div>
                        <time className="text-xs font-semibold text-slate-400">{new Date(entry.creado_en).toLocaleString("es-EC")}</time>
                      </div>
                      {entry.detalle && <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(typeof entry.detalle === "string" ? JSON.parse(entry.detalle) : entry.detalle, null, 2)}</pre>}
                    </li>
                  ))}</ol>}
          </section>
        </div>
      )}
    </main>
  );
}
