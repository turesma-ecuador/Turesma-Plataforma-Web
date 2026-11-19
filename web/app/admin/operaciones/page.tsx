"use client";

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Plus, RefreshCw, X } from "lucide-react";
import { getAuthHeaders } from "../../../lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

class ApiResponseError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
    this.name = "ApiResponseError";
  }
}

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
    const errorCode = typeof payload === "object" && payload !== null && "code" in payload
      && typeof payload.code === "string"
      ? payload.code
      : null;
    throw new ApiResponseError(errorMessage, errorCode);
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
  eta_actualizada?: string | null;
  incidencia_detalle?: string | null;
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

type DispatchView = "por_asignar" | "proximos" | "en_curso" | "vencidos" | "historial" | "todos";
type GroupAssignmentItem = {
  operation: Operation;
  vehicleId: string;
  driverId: string;
  confirmVehicleSubstitution: boolean;
  error?: string;
};
type GroupAssignmentState = {
  requerimientoId: number;
  groupNumber: number;
  operations: Operation[];
  items: GroupAssignmentItem[];
  requestedVehicleType: string;
  assignedCount: number;
  unavailableVehicleIds: string[];
  unavailableDriverIds: string[];
};

type ReservationReady = {
  id: number;
  fecha_reserva: string;
  fecha_servicio?: string | null;
  fecha_salida?: string | null;
  fecha_llegada?: string | null;
  fecha_fin?: string | null;
  fecha_regreso?: string | null;
  hora_regreso?: string | null;
  duracion_estimada_minutos?: number | null;
  hora_salida?: string | null;
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

type Vehicle = { id: number; placa: string; modelo: string; tipo?: string | null; capacidad: number; estado: string; activo: boolean };
type Driver = {
  id: number;
  nombre: string;
  apellido?: string;
  estado: string | null;
  activo: boolean;
  licencia?: string | null;
  fecha_licencia_vencimiento?: string | null;
};
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
type OperationHistoryEntry = {
  id: number;
  accion: string;
  estado_anterior: string | null;
  estado_nuevo: string | null;
  detalle: Record<string, unknown> | string | null;
  creado_en: string;
  usuario_nombre: string | null;
  usuario_apellido: string | null;
  usuario_id?: number | null;
  vehiculo_placa?: string | null;
  vehiculo_modelo?: string | null;
  conductor_asignado_nombre?: string | null;
};

const stateLabels: Record<string, string> = {
  programada: "Programada",
  asignada: "Asignada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
  incidencia: "Incidencia",
};

const stateBadgeStyles: Record<string, string> = {
  programada: "border-sky-200 bg-sky-50 text-sky-800",
  asignada: "border-emerald-200 bg-emerald-50 text-emerald-800",
  en_curso: "border-amber-200 bg-amber-50 text-amber-800",
  completada: "border-slate-200 bg-slate-100 text-slate-700",
  cancelada: "border-slate-200 bg-slate-50 text-slate-500",
  incidencia: "border-red-200 bg-red-50 text-red-700",
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
const ecuadorDateTime = (value?: string | null) => {
  if (!value) return { date: "", time: null };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: null };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
};
const normalizeVehicleType = (value?: string | null) =>
  value?.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "";
const reservationTimestampParts = (value?: string | null) => {
  if (!value) return { date: "", time: "" };
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const localDateTime = ecuadorDateTime(value);
    return { date: localDateTime.date, time: localDateTime.time || "" };
  }
  return {
    date: dateKey(value),
    time: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : "",
  };
};
const reservationServiceDate = (reservation: ReservationReady) =>
  reservationTimestampParts(reservation.fecha_salida).date
  || reservationTimestampParts(reservation.fecha_servicio).date
  || dateKey(reservation.fecha_reserva);
const reservationServiceTime = (reservation: ReservationReady) => {
  if (reservation.hora_salida) return formatTime(reservation.hora_salida);
  return reservationTimestampParts(reservation.fecha_salida).time
    || reservationTimestampParts(reservation.fecha_servicio).time
    || reservationTimestampParts(reservation.fecha_llegada).time;
};
const reservationServiceEnd = (reservation: ReservationReady) => {
  const startDate = reservationServiceDate(reservation);
  const returnDate = dateKey(reservation.fecha_regreso);
  const arrival = reservationTimestampParts(reservation.fecha_llegada);
  const arrivalDate = arrival.date;
  const endDate = [
    dateKey(reservation.fecha_fin),
    returnDate,
    arrivalDate,
    startDate,
  ].filter(Boolean).sort().at(-1) || "";
  const arrivalTime = arrival.time;
  const endTime = returnDate === endDate
    ? formatTime(reservation.hora_regreso) || (arrivalDate === endDate ? arrivalTime : "")
    : arrivalDate === endDate ? arrivalTime : "";
  return { date: endDate, time: endTime };
};
const operationServiceEnd = (operation: Operation) => {
  const scheduledEndDate = dateKey(operation.fecha_fin_programada) || dateKey(operation.fecha_programada);
  const eta = ecuadorDateTime(operation.eta_actualizada);
  const etaDate = eta.date;
  const endDate = [scheduledEndDate, etaDate].filter(Boolean).sort().at(-1) || "";
  const endTime = etaDate === endDate
    ? eta.time
    : scheduledEndDate === endDate ? formatTime(operation.hora_fin) : "";
  return { date: endDate, time: endTime };
};
const isScheduleOverdue = (end: { date: string; time: string | null }, today: string, currentTime: string) =>
  Boolean(end.date && (end.date < today || (end.date === today && end.time && end.time <= currentTime)));
const compareSchedule = (dateA: string, timeA: string, dateB: string, timeB: string) =>
  dateA.localeCompare(dateB) || timeA.localeCompare(timeB);
const assignmentScheduleLabel = (operation: Operation) => {
  const startDate = formatDate(operation.fecha_programada);
  const endDate = operation.fecha_fin_programada
    ? formatDate(operation.fecha_fin_programada)
    : startDate;
  const startTime = formatTime(operation.hora_inicio) || "hora pendiente";
  const endTime = formatTime(operation.hora_fin) || "sin hora registrada";
  return endDate === startDate
    ? `Salida ${startDate} ${startTime} · llegada ${endTime}`
    : `Salida ${startDate} ${startTime} · llegada ${endDate} ${endTime}`;
};

const operationHistoryActionLabels: Record<string, string> = {
  creacion_desde_reserva: "Despacho creado desde una reserva",
  creacion_requerimiento: "Unidad creada desde un requerimiento",
  creacion: "Operación creada",
  asignacion: "Vehículo y conductor asignados",
  asignacion_tramo_reserva: "Asignación sincronizada con otro tramo",
  cambio_estado: "Estado de la operación actualizado",
  actualizacion_conductor: "Actualización reportada por el conductor",
  retraso_reportado_conductor: "Retraso informado por el conductor",
  cancelacion_reserva: "Operación cancelada por el cliente",
  cancelacion_reserva_admin: "Operación cancelada por administración",
  reapertura_despacho: "Despacho reabierto",
  actualizar_subcontratacion: "Subcontratación actualizada",
};

const operationHistoryDetailLabels: Record<string, string> = {
  reserva_id: "Reserva",
  tramo: "Tramo",
  requerimiento_id: "Requerimiento",
  grupo_numero: "Grupo",
  unidad_numero: "Unidad",
  origen: "Origen",
  destino: "Destino",
  tipo_vehiculo_solicitado: "Categoría solicitada",
  tipo_vehiculo_asignado: "Categoría asignada",
  categoria_sustituida: "Categoría alternativa",
  motivo: "Motivo",
  nueva_eta: "Nueva llegada estimada",
  estado_reserva: "Estado de la reserva",
  ida_finalizada: "Tramo de ida",
  empresa: "Proveedor",
  vehiculo: "Vehículo del proveedor",
  placa: "Placa",
  conductor: "Conductor",
  costo: "Costo acordado",
  accion: "Acción",
};

const parseOperationHistoryDetail = (detail: OperationHistoryEntry["detalle"]) => {
  if (!detail) return null;
  if (typeof detail !== "string") return detail;
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const operationHistoryDetailRows = (entry: OperationHistoryEntry) => {
  const detail = parseOperationHistoryDetail(entry.detalle);
  if (!detail) return [];

  const rows = Object.entries(operationHistoryDetailLabels).flatMap(([key, label]) => {
    const value = detail[key];
    if (value === null || value === undefined || value === "") return [];

    let displayValue: string;
    if (key === "tramo") {
      displayValue = ({
        reserva: "Servicio",
        reserva_ida: "Ida",
        reserva_regreso: "Regreso",
      } as Record<string, string>)[String(value)] || String(value);
    } else if (key === "categoria_sustituida" || key === "ida_finalizada") {
      displayValue = value ? "Sí" : "No";
    } else if (key === "nueva_eta") {
      const eta = new Date(String(value));
      displayValue = Number.isNaN(eta.getTime()) ? String(value) : eta.toLocaleString("es-EC");
    } else if (key === "estado_reserva") {
      displayValue = stateLabels[String(value)] || String(value).replaceAll("_", " ");
    } else if (key === "reserva_id" || key === "requerimiento_id") {
      displayValue = `#${String(value)}`;
    } else if (key === "costo" && Number.isFinite(Number(value))) {
      displayValue = `$${Number(value).toFixed(2)}`;
    } else {
      displayValue = String(value);
    }

    return [{ label, value: displayValue }];
  });

  const vehicleLabel = [entry.vehiculo_placa, entry.vehiculo_modelo].filter(Boolean).join(" · ");
  if (vehicleLabel) rows.push({ label: "Vehículo asignado", value: vehicleLabel });
  if (entry.conductor_asignado_nombre) {
    rows.push({ label: "Conductor asignado", value: entry.conductor_asignado_nombre });
  }
  return rows;
};

const operationHistoryStateLabel = (state: string | null) =>
  state ? stateLabels[state] || state.replaceAll("_", " ") : "";

const assignmentAvailabilityMessage = (error: unknown) => {
  if (!(error instanceof ApiResponseError)) {
    return "No fue posible consultar la disponibilidad en este momento. Intenta nuevamente.";
  }

  switch (error.code) {
    case "INVALID_ASSIGNMENT_DATE_RANGE":
      return "Revisa la fecha de salida y regreso del servicio antes de consultar disponibilidad.";
    case "INVALID_ASSIGNMENT_PASSENGER_COUNT":
      return "La cantidad de pasajeros de esta reserva no es válida. Corrige la reserva e inténtalo de nuevo.";
    case "INVALID_ASSIGNMENT_TIME_RANGE":
      return "Revisa las horas de salida y llegada. La hora de llegada debe ser posterior a la de salida.";
    case "INVALID_ASSIGNMENT_OPERATION":
      return "No se pudo identificar esta operación. Actualiza la página e inténtalo de nuevo.";
    default:
      return "No fue posible consultar la disponibilidad en este momento. Intenta nuevamente.";
  }
};

export default function OperacionesPage() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [reservations, setReservations] = useState<ReservationReady[]>([]);
  const [dispatchView, setDispatchView] = useState<DispatchView>("por_asignar");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [partnerCompanies, setPartnerCompanies] = useState<PartnerCompany[]>([]);
  const [assignmentResourcesLoading, setAssignmentResourcesLoading] = useState(false);
  const [partnerCompaniesLoading, setPartnerCompaniesLoading] = useState(false);
  const [assignmentResourcesError, setAssignmentResourcesError] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [groupAssignmentResourcesLoading, setGroupAssignmentResourcesLoading] = useState(false);
  const [groupAssignmentResourcesError, setGroupAssignmentResourcesError] = useState("");
  const [groupAssignmentError, setGroupAssignmentError] = useState("");
  const [groupAssignmentVehicles, setGroupAssignmentVehicles] = useState<Vehicle[]>([]);
  const [groupAssignmentDrivers, setGroupAssignmentDrivers] = useState<Driver[]>([]);
  const [groupAssignment, setGroupAssignment] = useState<GroupAssignmentState | null>(null);
  const [partnerCompaniesError, setPartnerCompaniesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusedReservationId, setFocusedReservationId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
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
  const [confirmVehicleSubstitution, setConfirmVehicleSubstitution] = useState(false);
  const [form, setForm] = useState({
    tipo_servicio: "viaje",
    fecha_programada: new Date().toISOString().slice(0, 10),
    hora_inicio: "08:00",
    hora_fin: "10:00",
    origen: "",
    destino: "",
    pasajeros: "1",
  });
  const nowInEcuador = ecuadorDateTime(clockNow.toISOString());
  const today = nowInEcuador.date;
  const currentTime = nowInEcuador.time || "00:00";
  const sortedReservations = [...reservations].sort((a, b) =>
    compareSchedule(reservationServiceDate(a), reservationServiceTime(a) || "", reservationServiceDate(b), reservationServiceTime(b) || "")
    || a.id - b.id
  );
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
  const isAttendedOperation = (operation: Operation) => ["completada", "cancelada"].includes(operation.estado);
  const isInProgressOperation = (operation: Operation) => ["en_curso", "incidencia"].includes(operation.estado);
  const isOverdueOperation = (operation: Operation) =>
    activeOperationStates.includes(operation.estado)
    && isScheduleOverdue(operationServiceEnd(operation), today, currentTime);
  const hasAssignedResources = (operation: Operation) =>
    Boolean(operation.vehiculo_id && operation.conductor_id)
    || operation.subcontratacion_estado === "confirmada";
  const needsAssignment = (operation: Operation) =>
    !isAttendedOperation(operation)
    && !isInProgressOperation(operation)
    && !isOverdueOperation(operation)
    && !hasAssignedResources(operation);
  const isUpcomingOperation = (operation: Operation) =>
    !isAttendedOperation(operation)
    && !isInProgressOperation(operation)
    && !isOverdueOperation(operation)
    && hasAssignedResources(operation);
  const isReservationOverdue = (reservation: ReservationReady) =>
    isScheduleOverdue(reservationServiceEnd(reservation), today, currentTime);
  const visibleReservations = sortedReservations.filter((reservation) => {
    if (dispatchView === "todos") return true;
    if (dispatchView === "vencidos") return isReservationOverdue(reservation);
    return dispatchView === "por_asignar" && !isReservationOverdue(reservation);
  });
  const dispatchCounts = {
    por_asignar: operations.filter(needsAssignment).length + reservations.filter((reservation) => !isReservationOverdue(reservation)).length,
    proximos: operations.filter(isUpcomingOperation).length,
    en_curso: operations.filter((operation) => isInProgressOperation(operation) && !isOverdueOperation(operation)).length,
    vencidos: operations.filter(isOverdueOperation).length + reservations.filter(isReservationOverdue).length,
    historial: operations.filter(isAttendedOperation).length,
    todos: operations.length + reservations.length,
  };
  const visibleOperations = sortedOperations.filter((operation) => {
    if (dispatchView === "todos") return true;
    if (dispatchView === "historial") return isAttendedOperation(operation);
    if (dispatchView === "vencidos") return isOverdueOperation(operation);
    if (dispatchView === "en_curso") return isInProgressOperation(operation) && !isOverdueOperation(operation);
    if (dispatchView === "proximos") return isUpcomingOperation(operation);
    return needsAssignment(operation);
  });
  const specialOperationGroups = new Map<string, Operation[]>();
  for (const operation of operations) {
    if (!operation.requerimiento_id || !operation.grupo_numero) continue;
    const key = `${operation.requerimiento_id}:${operation.grupo_numero}`;
    const group = specialOperationGroups.get(key) || [];
    group.push(operation);
    specialOperationGroups.set(key, group);
  }
  const specialGroupByOperationId = new Map<number, Operation[]>();
  const assignableSpecialGroups = Array.from(specialOperationGroups.values())
    .map((group) => group.sort((a, b) => (a.unidad_numero || 0) - (b.unidad_numero || 0) || a.id - b.id))
    .filter((group) => group.length > 1 && group.some(needsAssignment));
  const visibleAssignableSpecialGroups = dispatchView === "por_asignar" || dispatchView === "todos"
    ? assignableSpecialGroups
    : [];
  for (const group of specialOperationGroups.values()) {
    for (const operation of group) specialGroupByOperationId.set(operation.id, group);
  }
  const selectedAvailableVehicle = vehicles.find((vehicle) => String(vehicle.id) === selectedVehicleId);
  const requestedVehicleType = assignment?.tipo_vehiculo_solicitado?.trim() || "";
  const hasRequestedVehicleTypeAvailable = Boolean(
    requestedVehicleType
    && vehicles.some((vehicle) => normalizeVehicleType(vehicle.tipo) === normalizeVehicleType(requestedVehicleType))
  );
  const selectedVehicleIsSubstitution = Boolean(
    requestedVehicleType && selectedAvailableVehicle
    && normalizeVehicleType(selectedAvailableVehicle?.tipo) !== normalizeVehicleType(requestedVehicleType)
  );

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
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
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60000);
    return () => window.clearInterval(timer);
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
    if (selectedVehicleIsSubstitution && !confirmVehicleSubstitution) {
      setAssignmentError("Confirma la sustitución de la categoría solicitada antes de asignar.");
      return;
    }
    const selectedVehicle = Number(selectedVehicleId);
    const selectedDriver = Number(selectedDriverId);
    setSaving(true);
    setAssignmentError("");
    try {
      await request(`/api/admin/operaciones/${assignment.id}/asignar`, {
        method: "PATCH",
        body: JSON.stringify({
          vehiculo_id: selectedVehicle,
          conductor_id: selectedDriver,
          confirmar_sustitucion: selectedVehicleIsSubstitution && confirmVehicleSubstitution,
        }),
      });
      setMessage("Recursos asignados. Las validaciones operativas fueron aprobadas.");
      setAssignment(null);
      await load();
    } catch (saveError) {
      setAssignmentError(saveError instanceof Error ? saveError.message : "No se pudo asignar la operación");
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

  const loadAvailableAssignmentResources = async (operation: Operation) => {
    const startDate = dateKey(operation.fecha_programada);
    const endDate = dateKey(operation.fecha_fin_programada) || startDate;
    if (!startDate || !endDate) {
      throw new ApiResponseError(
        "La operación no tiene un rango de fechas válido.",
        "INVALID_ASSIGNMENT_DATE_RANGE",
      );
    }
    const query = new URLSearchParams({
      fecha: startDate,
      fecha_fin: endDate,
      pasajeros: String(operation.pasajeros),
      operacion_id: String(operation.id),
      solo_disponibles: "true",
    });
    if (operation.hora_inicio) query.set("hora_inicio", operation.hora_inicio.slice(0, 5));
    if (operation.hora_fin) query.set("hora_fin", operation.hora_fin.slice(0, 5));
    const availabilityPath = `/api/admin/inteligencia/asignacion-recomendada?${query}`;
    const availability = await readApiJson<{
      data?: { tipo_vehiculo_solicitado?: string | null; vehiculos?: Vehicle[]; conductores?: Driver[] };
    }>(await fetch(`${API_URL}${availabilityPath}`, { headers: getAuthHeaders() }), availabilityPath);
    const resources = availability.data;
    if (!resources || !Array.isArray(resources.vehiculos) || !Array.isArray(resources.conductores)) {
      throw new Error("La API no devolvió la lista de recursos disponibles.");
    }
    const requestedType = resources.tipo_vehiculo_solicitado || operation.tipo_vehiculo_solicitado || "";
    const availableVehicles = [...resources.vehiculos].sort((a, b) =>
      Number(normalizeVehicleType(b.tipo) === normalizeVehicleType(requestedType))
      - Number(normalizeVehicleType(a.tipo) === normalizeVehicleType(requestedType))
    );
    return { requestedType, availableVehicles, availableDrivers: resources.conductores };
  };

  const openAssignment = async (operation: Operation) => {
    setAssignment(operation);
    setAssignmentResourcesLoading(true);
    setAssignmentResourcesError("");
    setAssignmentError("");
    setSelectedVehicleId("");
    setSelectedDriverId("");
    setConfirmVehicleSubstitution(false);
    setError("");
    try {
      const resources = await loadAvailableAssignmentResources(operation);
      if (resources.requestedType && !operation.tipo_vehiculo_solicitado) {
        setAssignment({ ...operation, tipo_vehiculo_solicitado: resources.requestedType });
      }
      setVehicles(resources.availableVehicles);
      setDrivers(resources.availableDrivers);
      setSelectedVehicleId(
        resources.availableVehicles.some((vehicle) => vehicle.id === operation.vehiculo_id)
          ? String(operation.vehiculo_id)
          : "",
      );
      setSelectedDriverId(
        resources.availableDrivers.some((driver) => driver.id === operation.conductor_usuario_id)
          ? String(operation.conductor_usuario_id)
          : "",
      );
    } catch (loadError) {
      console.error("No se pudo consultar la disponibilidad para la operación.", loadError);
      setAssignmentResourcesError(assignmentAvailabilityMessage(loadError));
    } finally {
      setAssignmentResourcesLoading(false);
    }
  };

  const updateGroupAssignmentItem = (operationId: number, patch: Partial<GroupAssignmentItem>) => {
    setGroupAssignment((current) => current && ({
      ...current,
      items: current.items.map((item) => item.operation.id === operationId
        ? { ...item, ...patch, error: undefined }
        : item),
    }));
    setGroupAssignmentError("");
  };

  const openGroupAssignment = async (operationsInGroup: Operation[]) => {
    const operationsToAssign = operationsInGroup.filter(needsAssignment);
    if (!operationsInGroup[0]?.requerimiento_id || !operationsInGroup[0]?.grupo_numero || !operationsToAssign.length) return;
    const pendingIds = new Set(operationsToAssign.map((operation) => operation.id));
    setGroupAssignment({
      requerimientoId: operationsInGroup[0].requerimiento_id,
      groupNumber: operationsInGroup[0].grupo_numero,
      operations: operationsInGroup,
      items: operationsToAssign.map((operation) => ({
        operation,
        vehicleId: "",
        driverId: "",
        confirmVehicleSubstitution: false,
      })),
      requestedVehicleType: "",
      assignedCount: operationsInGroup.filter(hasAssignedResources).length,
      unavailableVehicleIds: operationsInGroup
        .filter((operation) => !pendingIds.has(operation.id) && operation.vehiculo_id)
        .map((operation) => String(operation.vehiculo_id)),
      unavailableDriverIds: operationsInGroup
        .filter((operation) => !pendingIds.has(operation.id) && operation.conductor_usuario_id)
        .map((operation) => String(operation.conductor_usuario_id)),
    });
    setGroupAssignmentResourcesLoading(true);
    setGroupAssignmentResourcesError("");
    setGroupAssignmentError("");
    setGroupAssignmentVehicles([]);
    setGroupAssignmentDrivers([]);
    setError("");
    try {
      const resources = await loadAvailableAssignmentResources(operationsToAssign[0]);
      setGroupAssignmentVehicles(resources.availableVehicles);
      setGroupAssignmentDrivers(resources.availableDrivers);
      setGroupAssignment((current) => current && ({
        ...current,
        requestedVehicleType: resources.requestedType,
        items: current.items.map((item) => ({
          ...item,
          operation: {
            ...item.operation,
            tipo_vehiculo_solicitado: item.operation.tipo_vehiculo_solicitado || resources.requestedType,
          },
        })),
      }));
    } catch (loadError) {
      console.error("No se pudo consultar la disponibilidad para el grupo del requerimiento.", loadError);
      setGroupAssignmentResourcesError(assignmentAvailabilityMessage(loadError));
    } finally {
      setGroupAssignmentResourcesLoading(false);
    }
  };

  const assignOperationGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!groupAssignment) return;
    const vehicleIds = groupAssignment.items.map((item) => item.vehicleId);
    const driverIds = groupAssignment.items.map((item) => item.driverId);
    if (vehicleIds.some((id) => !id) || driverIds.some((id) => !id)) {
      setGroupAssignmentError("Selecciona un vehículo y un conductor para cada unidad.");
      return;
    }
    if (new Set(vehicleIds).size !== vehicleIds.length || new Set(driverIds).size !== driverIds.length) {
      setGroupAssignmentError("Cada unidad debe tener un vehículo y un conductor distintos.");
      return;
    }
    const substitutionUnconfirmed = groupAssignment.items.some((item) => {
      const vehicle = groupAssignmentVehicles.find((candidate) => String(candidate.id) === item.vehicleId);
      const requestedType = item.operation.tipo_vehiculo_solicitado || groupAssignment.requestedVehicleType;
      return Boolean(
        requestedType && vehicle
        && normalizeVehicleType(vehicle.tipo) !== normalizeVehicleType(requestedType)
        && !item.confirmVehicleSubstitution
      );
    });
    if (substitutionUnconfirmed) {
      setGroupAssignmentError("Confirma la sustitución de categoría para cada unidad que use un vehículo alternativo.");
      return;
    }

    setSaving(true);
    setGroupAssignmentError("");
    const successfulItems: GroupAssignmentItem[] = [];
    const failedItems: GroupAssignmentItem[] = [];
    try {
      for (const item of groupAssignment.items) {
        const vehicle = groupAssignmentVehicles.find((candidate) => String(candidate.id) === item.vehicleId);
        const requestedType = item.operation.tipo_vehiculo_solicitado || groupAssignment.requestedVehicleType;
        const categorySubstitution = Boolean(
          requestedType && vehicle
          && normalizeVehicleType(vehicle.tipo) !== normalizeVehicleType(requestedType)
        );
        try {
          await request(`/api/admin/operaciones/${item.operation.id}/asignar`, {
            method: "PATCH",
            body: JSON.stringify({
              vehiculo_id: Number(item.vehicleId),
              conductor_id: Number(item.driverId),
              confirmar_sustitucion: categorySubstitution && item.confirmVehicleSubstitution,
            }),
          });
          successfulItems.push(item);
        } catch (saveError) {
          failedItems.push({
            ...item,
            error: saveError instanceof Error ? saveError.message : "No se pudo asignar esta unidad.",
          });
        }
      }

      if (successfulItems.length) await load(true);
      if (failedItems.length) {
        setGroupAssignment((current) => current && ({
          ...current,
          items: failedItems,
          assignedCount: current.assignedCount + successfulItems.length,
          unavailableVehicleIds: Array.from(new Set([
            ...current.unavailableVehicleIds,
            ...successfulItems.map((item) => item.vehicleId),
          ])),
          unavailableDriverIds: Array.from(new Set([
            ...current.unavailableDriverIds,
            ...successfulItems.map((item) => item.driverId),
          ])),
        }));
        setGroupAssignmentError(
          `Se asignaron ${successfulItems.length} de ${groupAssignment.items.length} unidades. Revisa los conflictos indicados para completar el grupo.`
        );
      } else {
        setGroupAssignment(null);
        setMessage(`Se asignaron correctamente ${successfulItems.length} unidades del grupo ${groupAssignment.groupNumber}.`);
        await load(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">Gestión operativa</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Despacho de servicios</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Prepara reservas confirmadas, asigna recursos y supervisa cada servicio. El conductor registra el inicio y la finalización desde su portal.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">
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

      <nav aria-label="Filtrar despachos" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {([
          ["por_asignar", "Por asignar"],
          ["proximos", "Próximos"],
          ["en_curso", "En curso"],
          ["vencidos", "Vencidos"],
          ["historial", "Historial"],
          ["todos", "Todos"],
        ] as const).map(([view, label]) => (
          <button
            key={view}
            type="button"
            onClick={() => setDispatchView(view)}
            aria-pressed={dispatchView === view}
            className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${
              dispatchView === view ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label} <span className="ml-1 opacity-70">{dispatchCounts[view]}</span>
          </button>
        ))}
      </nav>

      {(dispatchView === "por_asignar" || dispatchView === "vencidos" || dispatchView === "todos")
        && (loading || visibleReservations.length > 0) && <section className="overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/70 px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">Flujo principal</p>
            <h2 className="mt-1 font-black text-slate-900">{dispatchView === "vencidos" ? "Reservas vencidas por despachar" : "Reservas confirmadas por despachar"}</h2>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{visibleReservations.length}</span>
        </div>
        {loading ? <p className="p-6 text-center text-sm font-semibold text-slate-400">Buscando reservas confirmadas...</p> : (
          <div className="divide-y divide-slate-100">
            {visibleReservations.map((reservation) => {
              const serviceDate = reservationServiceDate(reservation);
              const serviceTime = reservationServiceTime(reservation);
              const overdue = isReservationOverdue(reservation);
              return (
              <article key={reservation.id} data-reservation-id={reservation.id} className={`grid gap-4 border-l-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5 ${focusedReservationId === reservation.id ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100" : overdue ? "border-l-red-400 bg-red-50/40" : "border-l-transparent"}`}>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black leading-snug text-slate-900">Reserva #{reservation.id}</p>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800">Sin despacho</span>
                    {overdue && <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-red-700">Vencida · revisar</span>}
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
                    {reservation.fecha_fin && <span>Servicio continuo hasta {formatDate(reservation.fecha_fin)}</span>}
                    {reservation.fecha_regreso && <span>Regreso: {formatDate(reservation.fecha_regreso)}{reservation.hora_regreso ? ` · ${formatTime(reservation.hora_regreso)}` : ""}</span>}
                    {reservation.duracion_estimada_minutos && <span>Duración estimada: {Math.floor(reservation.duracion_estimada_minutos / 60)} h {reservation.duracion_estimada_minutos % 60} min por tramo</span>}
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
      </section>}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <ClipboardList className="text-red-600" size={20} />
            <h2 className="font-black text-slate-900">
              {dispatchView === "por_asignar" ? "Servicios por asignar"
                : dispatchView === "proximos" ? "Próximos servicios"
                  : dispatchView === "en_curso" ? "Servicios en curso"
                    : dispatchView === "vencidos" ? "Servicios vencidos por revisar"
                      : dispatchView === "historial" ? "Historial de despachos"
                        : "Todos los servicios"}
            </h2>
          </div>
          <button onClick={() => void load()} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Actualizar operaciones"><RefreshCw size={17} /></button>
        </div>
        {visibleAssignableSpecialGroups.length > 0 && (
          <div className="space-y-3 border-b border-slate-100 bg-slate-50/70 p-4">
            {visibleAssignableSpecialGroups.map((group) => {
              const pendingCount = group.filter(needsAssignment).length;
              const first = group[0];
              return (
                <article key={`${first.requerimiento_id}-${first.grupo_numero}`} className="flex flex-col gap-3 rounded-2xl border border-violet-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">
                      Requerimiento #{first.requerimiento_id} · Grupo {first.grupo_numero}
                    </p>
                    <p className="mt-1 text-sm font-black text-slate-900">
                      {pendingCount} de {group.length} unidades por asignar
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Cada unidad tendrá su propio vehículo y conductor; se validará la disponibilidad al guardar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openGroupAssignment(group)}
                    disabled={saving}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-xs font-black text-white transition hover:bg-violet-800 disabled:opacity-50"
                  >
                    <CheckCircle2 size={15} /> Asignar grupo
                  </button>
                </article>
              );
            })}
          </div>
        )}
        {loading ? <p className="p-8 text-center text-sm font-semibold text-slate-400">Cargando servicios...</p> : visibleOperations.length === 0 ? <div className="p-10 text-center">
          <p className="text-sm font-black text-slate-500">
            {dispatchView === "por_asignar" ? "No hay operaciones por asignar"
              : dispatchView === "proximos" ? "No hay próximos servicios asignados"
                : dispatchView === "en_curso" ? "No hay servicios en curso"
                  : dispatchView === "vencidos" ? "No hay servicios vencidos por revisar"
                    : dispatchView === "historial" ? "No hay despachos en el historial"
                      : "No hay servicios en esta vista"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {dispatchView === "por_asignar" ? "Las operaciones sin recursos asignados aparecerán aquí."
              : dispatchView === "vencidos" ? "Se mostrarán aquí cuando haya pasado la fecha y hora de finalización."
                : "Prueba otra categoría para consultar otros despachos."}
          </p>
        </div> : (
          <div className="space-y-3 p-3 sm:p-5">
            {visibleOperations.map((operation) => {
              const startTime = formatTime(operation.hora_inicio);
              const endTime = formatTime(operation.hora_fin);
              const scheduledDate = dateKey(operation.fecha_programada);
              const startPending = operation.estado === "asignada"
                && !isOverdueOperation(operation)
                && Boolean(scheduledDate && (scheduledDate < today || (scheduledDate === today && startTime && startTime <= currentTime)));
              const overdue = isOverdueOperation(operation);
              const subcontractState = operation.subcontratacion_estado || "no_requerida";
              const canEditSubcontracting = activeOperationStates.includes(operation.estado);
              const isMultiUnitSpecialOperation = (specialGroupByOperationId.get(operation.id)?.length || 0) > 1;
              const dateRange = operation.fecha_fin_programada && dateKey(operation.fecha_fin_programada) !== scheduledDate
                ? `${formatDate(scheduledDate)} - ${formatDate(dateKey(operation.fecha_fin_programada))}`
                : formatDate(scheduledDate);
              const serviceTitle = operation.requerimiento_id
                ? `Requerimiento #${operation.requerimiento_id} · Grupo ${operation.grupo_numero} · Unidad ${operation.unidad_numero}`
                : operation.reserva_id ? `Reserva #${operation.reserva_id}` : operation.tipo_servicio;
              return (
                <article key={operation.id} data-reservation-id={operation.reserva_id || undefined} className={`rounded-2xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${focusedReservationId === operation.reserva_id ? "border-red-500 bg-red-50/40 ring-2 ring-red-100" : overdue ? "border-l-red-400 bg-red-50/30" : "border-l-red-500"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black leading-snug text-slate-900">{serviceTitle}</h3>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">Operación #{operation.id}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${stateBadgeStyles[operation.estado] || "border-slate-200 bg-slate-50 text-slate-700"}`}>
                      {stateLabels[operation.estado] || operation.estado}
                    </span>
                    {overdue && <span className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[10px] font-black text-red-700">Vencida · revisar</span>}
                    {startPending && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">Inicio pendiente del conductor</span>}
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
                    {operation.eta_actualizada && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Retraso reportado por el conductor</p>
                        <p className="mt-1 text-sm font-bold text-amber-950">
                          Nueva llegada estimada: {new Date(operation.eta_actualizada).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                        {operation.incidencia_detalle && <p className="mt-1 text-xs text-amber-900">{operation.incidencia_detalle}</p>}
                      </div>
                    )}
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
                    {["programada", "asignada"].includes(operation.estado)
                      && subcontractState === "no_requerida"
                      && (!isMultiUnitSpecialOperation || hasAssignedResources(operation))
                      && <button onClick={() => openAssignment(operation)} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700">{operation.vehiculo_id ? "Reasignar" : "Asignar"}</button>}
                    {canEditSubcontracting && <button onClick={() => openSubcontracting(operation)} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">{subcontractState === "no_requerida" ? "Subcontratar" : "Editar proveedor"}</button>}
                    {operation.estado === "cancelada" && <button onClick={() => void reopenOperation(operation)} disabled={saving} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Reabrir unidad</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={createOperation} className="w-full max-w-2xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-slate-950">Nueva operación</h2><button type="button" onClick={() => setShowCreate(false)} aria-label="Cerrar formulario"><X /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-600">Tipo de servicio<input value={form.tipo_servicio} onChange={(e) => setForm({ ...form, tipo_servicio: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Pasajeros<input type="number" min="1" value={form.pasajeros} onChange={(e) => setForm({ ...form, pasajeros: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Fecha<input type="date" value={form.fecha_programada} onChange={(e) => setForm({ ...form, fecha_programada: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><div className="grid grid-cols-2 gap-2"><label className="text-sm font-bold text-slate-600">Inicio<input type="time" value={form.hora_inicio} onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })} className="mt-1 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold text-slate-600">Fin<input type="time" value={form.hora_fin} onChange={(e) => setForm({ ...form, hora_fin: e.target.value })} className="mt-1 w-full rounded-xl border p-3" /></label></div><label className="text-sm font-bold text-slate-600">Origen<input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label><label className="text-sm font-bold text-slate-600">Destino<input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className="mt-1 w-full rounded-xl border p-3" required /></label></div><button disabled={saving} className="w-full rounded-xl bg-red-600 py-3 font-black text-white transition hover:bg-red-700 disabled:opacity-50">{saving ? "Guardando..." : "Crear operación"}</button></form></div>}

      {assignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5">
          <form
            onSubmit={assignOperation}
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-white/70 bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red-600">
                  Operación #{assignment.id}{assignment.reserva_id ? ` · Reserva #${assignment.reserva_id}` : ""}
                </p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Asignar recursos</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Selecciona el vehículo y el conductor para este servicio.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignment(null)}
                aria-label="Cerrar asignación"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
              >
                <X size={18} />
              </button>
            </header>

            <section aria-label="Resumen del servicio" className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Horario del servicio</p>
                <p className="mt-1 text-sm font-bold leading-relaxed text-slate-800">
                  {assignmentScheduleLabel(assignment)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pasajeros</p>
                <p className="mt-1 text-sm font-bold text-slate-800">
                  {assignment.pasajeros} {assignment.pasajeros === 1 ? "persona" : "personas"}
                </p>
              </div>
              <div className="col-span-2 border-t border-slate-200 pt-2.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ruta</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold leading-relaxed text-slate-800">
                  <span>{assignment.origen || "Origen pendiente"}</span>
                  <ArrowRight size={14} className="shrink-0 text-slate-400" />
                  <span>{assignment.destino || "Destino pendiente"}</span>
                </p>
              </div>
              {requestedVehicleType && (
                <div className="col-span-2 border-t border-slate-200 pt-2.5">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Categoría solicitada</p>
                  <p className="mt-1 text-sm font-bold capitalize text-slate-800">{requestedVehicleType}</p>
                </div>
              )}
            </section>

            {assignmentResourcesLoading && (
              <div role="status" className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3.5 text-sm font-semibold text-blue-800">
                <RefreshCw size={17} className="shrink-0 animate-spin" />
                Buscando vehículos y conductores disponibles...
              </div>
            )}
            {assignmentResourcesError && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="font-black">No fue posible consultar la disponibilidad</p>
                  <p className="mt-0.5 leading-relaxed">{assignmentResourcesError}</p>
                </div>
              </div>
            )}
            {assignmentError && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                <p className="leading-relaxed">{assignmentError}</p>
              </div>
            )}

            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700">
                <span className="mb-1.5 flex items-center justify-between gap-3">
                  <span>Vehículo</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                    {assignmentResourcesLoading ? "Buscando..." : assignmentResourcesError ? "No consultado" : `${vehicles.length} disponible${vehicles.length === 1 ? "" : "s"}`}
                  </span>
                </span>
                <select
                  name="vehiculo_id"
                  value={selectedVehicleId}
                  onChange={(event) => {
                    setSelectedVehicleId(event.target.value);
                    setConfirmVehicleSubstitution(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  disabled={assignmentResourcesLoading || Boolean(assignmentResourcesError)}
                  required
                >
                  <option value="">
                    {assignmentResourcesLoading
                      ? "Buscando vehículos..."
                      : assignmentResourcesError
                        ? "Disponibilidad no consultada"
                        : vehicles.length ? "Selecciona un vehículo" : "Sin vehículos disponibles"}
                  </option>
                  {vehicles.map((vehicle) => {
                    const isAlternative = requestedVehicleType
                      && normalizeVehicleType(vehicle.tipo) !== normalizeVehicleType(requestedVehicleType);
                    return (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} pax · {vehicle.tipo || "tipo no registrado"}
                        {isAlternative ? " · alternativa" : ""}
                      </option>
                    );
                  })}
                </select>
                {!assignmentResourcesLoading && !assignmentResourcesError && vehicles.length === 0 && (
                  <span className="mt-1.5 block text-xs font-medium text-slate-500">
                    No se encontraron vehículos disponibles para este servicio.
                  </span>
                )}
                {!assignmentResourcesLoading && !assignmentResourcesError && vehicles.length > 0
                  && requestedVehicleType && !hasRequestedVehicleTypeAvailable && (
                  <span className="mt-1.5 block text-xs font-semibold text-amber-800">
                    No hay vehículos disponibles de la categoría solicitada. Elegir otra categoría requerirá confirmación.
                  </span>
                )}
                {selectedVehicleIsSubstitution && (
                  <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                    <p>
                      La cotización solicita <strong className="capitalize">{requestedVehicleType}</strong>, pero elegiste
                      {" "}<strong className="capitalize">{selectedAvailableVehicle?.tipo || "una categoría no registrada"}</strong>.
                    </p>
                    <label className="flex items-start gap-2 font-semibold">
                      <input
                        type="checkbox"
                        checked={confirmVehicleSubstitution}
                        onChange={(event) => setConfirmVehicleSubstitution(event.target.checked)}
                        className="mt-0.5 accent-amber-700"
                      />
                      Confirmo esta sustitución de categoría.
                    </label>
                  </div>
                )}
              </label>

              <label className="block text-sm font-bold text-slate-700">
                <span className="mb-1.5 flex items-center justify-between gap-3">
                  <span>Conductor</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                    {assignmentResourcesLoading ? "Buscando..." : assignmentResourcesError ? "No consultado" : `${drivers.length} disponible${drivers.length === 1 ? "" : "s"}`}
                  </span>
                </span>
                <select
                  name="conductor_id"
                  value={selectedDriverId}
                  onChange={(event) => setSelectedDriverId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  disabled={assignmentResourcesLoading || Boolean(assignmentResourcesError)}
                  required
                >
                  <option value="">
                    {assignmentResourcesLoading
                      ? "Buscando conductores..."
                      : assignmentResourcesError
                        ? "Disponibilidad no consultada"
                        : drivers.length ? "Selecciona un conductor" : "Sin conductores disponibles"}
                  </option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.nombre} {driver.apellido || ""} · {driver.licencia || "sin licencia"}
                    </option>
                  ))}
                </select>
                {!assignmentResourcesLoading && !assignmentResourcesError && drivers.length === 0 && (
                  <span className="mt-1.5 block text-xs font-medium text-slate-500">
                    No se encontraron conductores disponibles para este servicio.
                  </span>
                )}
              </label>
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setAssignment(null)}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || assignmentResourcesLoading || Boolean(assignmentResourcesError)
                  || (selectedVehicleIsSubstitution && !confirmVehicleSubstitution)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={17} />}
                {saving ? "Validando..." : "Confirmar asignación"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {groupAssignment && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm sm:p-5">
          <form
            onSubmit={assignOperationGroup}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-assignment-title"
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl space-y-5 overflow-y-auto overscroll-contain rounded-3xl border border-white/70 bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">
                  Requerimiento #{groupAssignment.requerimientoId} · Grupo {groupAssignment.groupNumber}
                </p>
                <h2 id="group-assignment-title" className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                  Asignar unidades en grupo
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Selecciona un vehículo y un conductor para cada unidad. Cada recurso se valida al guardar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { if (!saving) setGroupAssignment(null); }}
                aria-label="Cerrar asignación grupal"
                disabled={saving}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </header>

            <div className="flex flex-wrap gap-2 rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs font-bold text-violet-900">
              <span>{groupAssignment.operations.length} unidades en el grupo</span>
              <span aria-hidden="true">·</span>
              <span>{groupAssignment.assignedCount} ya asignadas</span>
              <span aria-hidden="true">·</span>
              <span>{groupAssignment.items.length} pendientes de asignación</span>
            </div>

            {groupAssignmentResourcesLoading && (
              <div role="status" className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3.5 text-sm font-semibold text-blue-800">
                <RefreshCw size={17} className="shrink-0 animate-spin" />
                Consultando disponibilidad para el grupo...
              </div>
            )}
            {groupAssignmentResourcesError && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="font-black">No fue posible consultar la disponibilidad</p>
                  <p className="mt-0.5 leading-relaxed">{groupAssignmentResourcesError}</p>
                </div>
              </div>
            )}
            {groupAssignmentError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold leading-relaxed text-red-800">
                {groupAssignmentError}
              </div>
            )}

            <div className="space-y-3">
              {groupAssignment.items.map((item) => {
                const requestedType = item.operation.tipo_vehiculo_solicitado || groupAssignment.requestedVehicleType;
                const selectedVehicle = groupAssignmentVehicles.find((vehicle) => String(vehicle.id) === item.vehicleId);
                const isSubstitution = Boolean(
                  requestedType && selectedVehicle
                  && normalizeVehicleType(selectedVehicle.tipo) !== normalizeVehicleType(requestedType)
                );
                const availableVehicles = groupAssignmentVehicles.filter((vehicle) => {
                  const id = String(vehicle.id);
                  const selectedByOtherUnit = groupAssignment.items.some(
                    (other) => other.operation.id !== item.operation.id && other.vehicleId === id
                  );
                  return !groupAssignment.unavailableVehicleIds.includes(id)
                    && (!selectedByOtherUnit || item.vehicleId === id);
                });
                const availableDrivers = groupAssignmentDrivers.filter((driver) => {
                  const id = String(driver.id);
                  const selectedByOtherUnit = groupAssignment.items.some(
                    (other) => other.operation.id !== item.operation.id && other.driverId === id
                  );
                  return !groupAssignment.unavailableDriverIds.includes(id)
                    && (!selectedByOtherUnit || item.driverId === id);
                });
                return (
                  <section key={item.operation.id} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-black text-slate-900">
                          Unidad {item.operation.unidad_numero || "—"} de {groupAssignment.operations.length}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Operación #{item.operation.id} · {formatDate(dateKey(item.operation.fecha_programada))}
                          {item.operation.hora_inicio ? ` · ${formatTime(item.operation.hora_inicio)}` : ""}
                          {` · ${item.operation.pasajeros} pasajeros`}
                        </p>
                      </div>
                      {requestedType && (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black capitalize text-slate-600">
                          Solicita {requestedType}
                        </span>
                      )}
                    </div>
                    {item.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold leading-relaxed text-red-700">{item.error}</p>}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-black text-slate-700">
                        Vehículo
                        <select
                          value={item.vehicleId}
                          onChange={(event) => updateGroupAssignmentItem(item.operation.id, { vehicleId: event.target.value, confirmVehicleSubstitution: false })}
                          disabled={groupAssignmentResourcesLoading || Boolean(groupAssignmentResourcesError) || saving}
                          required
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800 focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:bg-slate-100"
                        >
                          <option value="">
                            {groupAssignmentResourcesLoading ? "Buscando vehículos..." : availableVehicles.length ? "Selecciona un vehículo" : "Sin vehículos disponibles"}
                          </option>
                          {availableVehicles.map((vehicle) => {
                            const isAlternative = requestedType
                              && normalizeVehicleType(vehicle.tipo) !== normalizeVehicleType(requestedType);
                            return (
                              <option key={vehicle.id} value={vehicle.id}>
                                {vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} pax · {vehicle.tipo || "tipo no registrado"}
                                {isAlternative ? " · alternativa" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <label className="block text-xs font-black text-slate-700">
                        Conductor
                        <select
                          value={item.driverId}
                          onChange={(event) => updateGroupAssignmentItem(item.operation.id, { driverId: event.target.value })}
                          disabled={groupAssignmentResourcesLoading || Boolean(groupAssignmentResourcesError) || saving}
                          required
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-800 focus:border-red-500 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:bg-slate-100"
                        >
                          <option value="">
                            {groupAssignmentResourcesLoading ? "Buscando conductores..." : availableDrivers.length ? "Selecciona un conductor" : "Sin conductores disponibles"}
                          </option>
                          {availableDrivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                              {driver.nombre} {driver.apellido || ""} · {driver.licencia || "sin licencia"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {isSubstitution && (
                      <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-900">
                        <input
                          type="checkbox"
                          checked={item.confirmVehicleSubstitution}
                          onChange={(event) => updateGroupAssignmentItem(item.operation.id, { confirmVehicleSubstitution: event.target.checked })}
                          className="mt-0.5 accent-amber-700"
                        />
                        Confirmo sustituir la categoría solicitada ({requestedType}) por {selectedVehicle?.tipo || "una categoría no registrada"} para esta unidad.
                      </label>
                    )}
                  </section>
                );
              })}
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setGroupAssignment(null)}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || groupAssignmentResourcesLoading || Boolean(groupAssignmentResourcesError) || !groupAssignment.items.length}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={17} />}
                {saving ? "Validando unidades..." : `Asignar ${groupAssignment.items.length} unidades`}
              </button>
            </footer>
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
              <div><p className="text-xs font-black uppercase tracking-widest text-violet-700">Seguimiento del despacho</p><h2 className="mt-1 text-lg font-black text-slate-900">Historial de la operación #{historyOperation.id}</h2></div>
              <button type="button" onClick={() => setHistoryOperation(null)} aria-label="Cerrar historial" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            {historyLoading ? <p className="py-12 text-center text-sm font-bold text-slate-400">Cargando historial...</p>
              : historyError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{historyError}</p>
                : operationHistory.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Todavía no hay eventos registrados para esta operación.</p>
                  : <ol className="mt-6 space-y-3">{operationHistory.map((entry) => {
                    const previousState = operationHistoryStateLabel(entry.estado_anterior);
                    const nextState = operationHistoryStateLabel(entry.estado_nuevo);
                    const stateChange = previousState && nextState
                      ? `${previousState} → ${nextState}`
                      : nextState
                        ? `Estado: ${nextState}`
                        : previousState
                          ? `Estado anterior: ${previousState}`
                          : "";
                    const actor = [entry.usuario_nombre, entry.usuario_apellido].filter(Boolean).join(" ")
                      || (entry.usuario_id ? "Usuario no disponible" : "Sistema");
                    const detailRows = operationHistoryDetailRows(entry);

                    return (
                      <li key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-black text-slate-800">{operationHistoryActionLabels[entry.accion] || "Actualización de la operación"}</p>
                            {stateChange && <p className="mt-1 text-sm font-semibold text-slate-600">{stateChange}</p>}
                          </div>
                          <time className="text-xs font-semibold text-slate-400">{new Date(entry.creado_en).toLocaleString("es-EC")}</time>
                        </div>
                        {detailRows.length > 0 && (
                          <dl className="mt-4 grid gap-x-5 gap-y-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
                            {detailRows.map(({ label, value }) => (
                              <div key={label}>
                                <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
                                <dd className="mt-0.5 break-words text-sm font-semibold text-slate-700">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <p className="mt-3 text-xs text-slate-500">Registrado por <span className="font-semibold text-slate-700">{actor}</span></p>
                      </li>
                    );
                  })}</ol>}
          </section>
        </div>
      )}
    </main>
  );
}
