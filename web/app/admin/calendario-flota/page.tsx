"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Bus, CalendarDays, Car, CheckCircle2,
  ChevronLeft, ChevronRight, Clock3, Loader2, RefreshCw, Wrench,
} from "lucide-react";
import { getAuthHeaders, normalizeRole } from "../../../lib/session";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

type FleetVehicle = {
  id: number;
  placa: string;
  tipo: string | null;
  modelo: string;
  estado: string;
};

type FleetEvent = {
  id: number | string;
  vehiculo_id: number;
  fecha_inicio: string;
  fecha_fin: string;
  tipo: "operacion" | "reserva" | "mantenimiento" | "externo";
  estado: string;
  tipo_servicio?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  origen?: string | null;
  destino?: string | null;
  descripcion?: string | null;
  cliente_empresa?: string | null;
  conductor_nombre?: string | null;
  notas?: string | null;
};

type UnassignedReservation = {
  id: number;
  fecha_salida: string | null;
  fecha_servicio: string | null;
  fecha_reserva: string;
  fecha_llegada: string | null;
  fecha_fin: string | null;
  fecha_regreso: string | null;
  hora_regreso: string | null;
  origen: string | null;
  destino: string | null;
  tipo_vehiculo: string | null;
  num_personas: number;
  cliente_nombre: string;
  operacion_id: number | null;
  subcontratacion_estado: string | null;
};

type FleetCalendarData = {
  vehicles: FleetVehicle[];
  events: FleetEvent[];
  unassignedReservations: UnassignedReservation[];
};

type CalendarEventLayout = FleetEvent & {
  gridStart: number;
  gridEnd: number;
  lane: number;
  visibleStart: string;
  visibleEnd: string;
};

type FleetConflict = {
  vehicle: FleetVehicle;
  first: FleetEvent;
  second: FleetEvent;
};

const asIsoDate = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");

const addDays = (date: Date, amount: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
};

const fromIsoDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (value: string) => fromIsoDate(value).toLocaleDateString("es-EC", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const eventName = (event: FleetEvent) => {
  if (event.tipo === "mantenimiento") return event.tipo_servicio?.startsWith("Urgente") ? "Bloqueo urgente" : "Mantenimiento";
  if (event.tipo === "externo") return event.tipo_servicio === "fuera_de_servicio" ? "Fuera de servicio" : "Viaje externo";
  if (event.tipo_servicio === "Regreso de reserva") return "Regreso";
  if (event.tipo === "reserva") return "Reserva";
  return event.tipo_servicio || "Viaje";
};

const eventStyle = (event: FleetEvent) => {
  if (event.tipo === "mantenimiento") return "border-amber-200 bg-amber-50 text-amber-800";
  if (event.tipo === "externo") return "border-violet-200 bg-violet-50 text-violet-800";
  if (event.estado === "en_curso") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (event.estado === "incidencia") return "border-red-200 bg-red-50 text-red-700";
  if (event.estado === "completada") return "border-slate-200 bg-slate-100 text-slate-600";
  if (event.tipo === "reserva") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
};

const eventSummary = (event: FleetEvent) => {
  const time = event.hora_inicio ? ` · ${event.hora_inicio.slice(0, 5)}${event.hora_fin ? `–${event.hora_fin.slice(0, 5)}` : ""}` : "";
  const route = [event.origen, event.destino].filter(Boolean).join(" → ");
  return `${eventName(event)}${time}${route ? ` · ${route}` : ""}`;
};

const eventTimeLabel = (event: FleetEvent) => {
  const start = event.hora_inicio?.slice(0, 5);
  const end = event.hora_fin?.slice(0, 5);
  if (!start) return end ? `Hasta ${end}` : null;
  return end ? `${start}–${end}` : start;
};

const eventStatusLabel = (event: FleetEvent) => {
  if (event.tipo === "mantenimiento") {
    if (event.tipo_servicio?.startsWith("Urgente")) return "Urgencia activa · pendiente de liberar";
    return event.estado === "en_progreso" ? "Mantenimiento en curso" : "Mantenimiento programado";
  }
  if (event.tipo === "externo") return `Bloqueo externo${event.conductor_nombre ? ` · ${event.conductor_nombre}` : ""}`;
  if (event.tipo === "reserva") return "Reserva confirmada · vehículo asignado";
  const labels: Record<string, string> = {
    programada: "Viaje programado",
    asignada: "Viaje asignado",
    en_curso: "Viaje en curso",
    completada: "Viaje finalizado",
    incidencia: "Viaje con incidencia",
  };
  return labels[event.estado] || "Viaje registrado";
};

const eventKey = (event: FleetEvent) => `event:${event.tipo}:${event.id}`;

const eventTimeRange = (event: FleetEvent) => {
  const start = fromIsoDate(event.fecha_inicio);
  const [startHour = "00", startMinute = "00"] = event.hora_inicio?.slice(0, 5).split(":") || [];
  start.setHours(Number(startHour), Number(startMinute), 0, 0);

  const end = fromIsoDate(event.fecha_fin);
  if (event.hora_fin) {
    const [endHour, endMinute] = event.hora_fin.slice(0, 5).split(":");
    end.setHours(Number(endHour), Number(endMinute), 0, 0);
    if (event.fecha_fin === event.fecha_inicio && end <= start) end.setDate(end.getDate() + 1);
  } else {
    end.setDate(end.getDate() + 1);
  }
  return { start: start.getTime(), end: end.getTime() };
};

const sameReservation = (first: FleetEvent, second: FleetEvent) =>
  first.tipo === "reserva"
  && second.tipo === "reserva"
  && String(first.id).replace(/-regreso$/, "") === String(second.id).replace(/-regreso$/, "");

export default function CalendarioFlotaPage() {
  const { checkingSession, user } = useAdminGuard();
  const router = useRouter();
  const isAdmin = normalizeRole(user?.rol) === "admin";
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => asIsoDate(new Date()));
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedReservation[]>([]);
  const [typeFilter, setTypeFilter] = useState("todos");
  const [vehicleFilter, setVehicleFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const calendarHeaderScrollRef = useRef<HTMLDivElement>(null);
  const calendarBodyScrollRef = useRef<HTMLDivElement>(null);

  const monthStart = asIsoDate(month);
  const monthEnd = asIsoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const weekStart = asIsoDate(addDays(fromIsoDate(selectedDate), -fromIsoDate(selectedDate).getDay()));
  const weekEnd = asIsoDate(addDays(fromIsoDate(weekStart), 6));
  const visibleStart = viewMode === "week" ? weekStart : monthStart;
  const visibleEnd = viewMode === "week" ? weekEnd : monthEnd;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/admin/calendario-flota?desde=${visibleStart}&hasta=${visibleEnd}`,
        { headers: getAuthHeaders(), cache: "no-store" }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar el calendario de flota");
      if (!data || !Array.isArray(data.vehicles) || !Array.isArray(data.events) || !Array.isArray(data.unassignedReservations)) {
        throw new Error("La respuesta del calendario de flota no es válida");
      }
      const calendar = data as FleetCalendarData;
      setVehicles(calendar.vehicles);
      setEvents(calendar.events);
      setUnassigned(calendar.unassignedReservations);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el calendario de flota");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [visibleEnd, visibleStart]);

  useEffect(() => {
    if (!checkingSession && user && !isAdmin) router.replace("/admin");
  }, [checkingSession, isAdmin, router, user]);

  useEffect(() => {
    if (checkingSession || !isAdmin) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [checkingSession, isAdmin, load]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession && isAdmin, immediate: false });

  const monthDays = useMemo(() => {
    const offset = fromIsoDate(monthStart).getDay();
    const count = fromIsoDate(monthEnd).getDate();
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: count }, (_, index) => asIsoDate(new Date(month.getFullYear(), month.getMonth(), index + 1))),
    ];
  }, [month, monthEnd, monthStart]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => asIsoDate(addDays(fromIsoDate(weekStart), index))),
    [weekStart]
  );
  const days = viewMode === "week" ? weekDays : monthDays;
  const calendarDays = days.filter((day): day is string => day !== null);
  const dayOffset = viewMode === "month" ? fromIsoDate(monthStart).getDay() : 0;
  const dayColumnWidth = viewMode === "week" ? 113 : 49;
  const calendarTableWidth = 220 + days.length * dayColumnWidth;
  const types = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.tipo).filter((type): type is string => Boolean(type)))].sort(), [vehicles]);
  const filteredVehicles = useMemo(
    () => vehicles.filter((vehicle) =>
      (typeFilter === "todos" || vehicle.tipo === typeFilter)
      && (vehicleFilter === "todos" || String(vehicle.id) === vehicleFilter)
    ),
    [typeFilter, vehicleFilter, vehicles]
  );
  const filteredVehicleIds = useMemo(() => new Set(filteredVehicles.map((vehicle) => vehicle.id)), [filteredVehicles]);
  const filteredEvents = useMemo(
    () => events.filter((event) => {
      const matchesStatus = statusFilter === "todos"
        || (["mantenimiento", "externo", "reserva"].includes(statusFilter)
          ? event.tipo === statusFilter
          : event.estado === statusFilter);
      return matchesStatus && filteredVehicleIds.has(event.vehiculo_id);
    }),
    [events, filteredVehicleIds, statusFilter]
  );
  const selectedEvents = useMemo(
    () => events.filter((event) => event.fecha_inicio <= selectedDate && event.fecha_fin >= selectedDate),
    [events, selectedDate]
  );
  const visibleSelectedEvents = useMemo(
    () => filteredEvents.filter((event) => event.fecha_inicio <= selectedDate && event.fecha_fin >= selectedDate),
    [filteredEvents, selectedDate]
  );
  const selectedDayEvents = useMemo(
    () => events.filter((event) => event.fecha_inicio <= selectedDate
      && event.fecha_fin >= selectedDate
      && filteredVehicleIds.has(event.vehiculo_id)),
    [events, filteredVehicleIds, selectedDate]
  );
  const outOfServiceIds = new Set([
    ...filteredVehicles
      .filter((vehicle) => ["mantenimiento", "inactivo"].includes(vehicle.estado.toLowerCase()))
      .map((vehicle) => vehicle.id),
    ...selectedDayEvents
      .filter((event) => event.tipo === "mantenimiento" || event.tipo_servicio === "fuera_de_servicio")
      .map((event) => event.vehiculo_id),
  ]);
  const busyVehicleIds = new Set(
    selectedDayEvents
      .filter((event) => event.tipo !== "mantenimiento" && event.tipo_servicio !== "fuera_de_servicio")
      .map((event) => event.vehiculo_id)
      .filter((vehicleId) => !outOfServiceIds.has(vehicleId))
  );
  const outOfServiceCount = outOfServiceIds.size;
  const occupiedCount = busyVehicleIds.size;
  const availableCount = Math.max(0, filteredVehicles.length - outOfServiceCount - occupiedCount);
  const conflicts = useMemo(() => {
    const conflictsForDay: FleetConflict[] = [];
    const activeEvents = selectedDayEvents.filter((event) => !["completada", "finalizada"].includes(event.estado.toLowerCase()));
    for (let firstIndex = 0; firstIndex < activeEvents.length; firstIndex += 1) {
      const first = activeEvents[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < activeEvents.length; secondIndex += 1) {
        const second = activeEvents[secondIndex];
        if (first.vehiculo_id !== second.vehiculo_id || sameReservation(first, second)) continue;
        const firstRange = eventTimeRange(first);
        const secondRange = eventTimeRange(second);
        if (firstRange.start < secondRange.end && secondRange.start < firstRange.end) {
          const vehicle = filteredVehicles.find((entry) => entry.id === first.vehiculo_id);
          if (vehicle) conflictsForDay.push({ vehicle, first, second });
        }
      }
    }
    return conflictsForDay;
  }, [filteredVehicles, selectedDayEvents]);
  const conflictEventKeys = useMemo(
    () => new Set(conflicts.flatMap(({ first, second }) => [eventKey(first), eventKey(second)])),
    [conflicts]
  );
  const selectedReservations = unassigned.filter((reservation) => {
    const start = (reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva).slice(0, 10);
    const end = (reservation.fecha_llegada || reservation.fecha_fin || reservation.fecha_reserva).slice(0, 10);
    return (start <= selectedDate && end >= selectedDate) || reservation.fecha_regreso === selectedDate;
  });
  const selectedEvent = selectedItemKey?.startsWith("event:")
    ? events.find((event) => `event:${event.tipo}:${event.id}` === selectedItemKey) || null
    : null;
  const selectedUnassignedReservation = selectedItemKey?.startsWith("reservation:")
    ? unassigned.find((reservation) => `reservation:${reservation.id}` === selectedItemKey) || null
    : null;

  const calendarEventsByVehicle = useMemo(() => {
    const result = new Map<number, CalendarEventLayout[]>();
    for (const vehicle of filteredVehicles) {
      const laneEnds: number[] = [];
      const vehicleEvents = filteredEvents
        .filter((event) => event.vehiculo_id === vehicle.id && event.fecha_inicio <= visibleEnd && event.fecha_fin >= visibleStart)
        .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio) || a.fecha_fin.localeCompare(b.fecha_fin));
      const layouts = vehicleEvents.map((event) => {
        const eventStart = event.fecha_inicio < visibleStart ? visibleStart : event.fecha_inicio;
        const eventEnd = event.fecha_fin > visibleEnd ? visibleEnd : event.fecha_fin;
        const gridStart = dayOffset + calendarDays.indexOf(eventStart);
        const gridEnd = dayOffset + calendarDays.indexOf(eventEnd);
        let lane = laneEnds.findIndex((lastDay) => lastDay < gridStart);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = gridEnd;
        return { ...event, visibleStart: eventStart, visibleEnd: eventEnd, gridStart, gridEnd, lane };
      });
      result.set(vehicle.id, layouts);
    }
    return result;
  }, [calendarDays, dayOffset, filteredEvents, filteredVehicles, visibleEnd, visibleStart]);

  const mobileAgenda = useMemo(
    () => calendarDays.map((day) => ({
      day,
      events: filteredEvents.filter((event) => event.fecha_inicio <= day && event.fecha_fin >= day),
      reservations: unassigned.filter((reservation) => {
        const start = (reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva).slice(0, 10);
        const end = (reservation.fecha_llegada || reservation.fecha_fin || reservation.fecha_reserva).slice(0, 10);
        return (start <= day && end >= day) || reservation.fecha_regreso === day;
      }),
    })).filter((group) => viewMode === "week" || group.events.length > 0 || group.reservations.length > 0),
    [calendarDays, filteredEvents, unassigned, viewMode]
  );

  const navigateCalendar = (amount: number) => {
    const nextDate = viewMode === "week"
      ? addDays(fromIsoDate(selectedDate), amount * 7)
      : new Date(month.getFullYear(), month.getMonth() + amount, 1);
    const nextIso = asIsoDate(nextDate);
    setMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    setSelectedDate(nextIso);
    setSelectedItemKey(null);
  };

  const goToToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(asIsoDate(today));
    setSelectedItemKey(null);
  };

  if (checkingSession || (user && !isAdmin)) {
    return (
      <div role="status" className="flex h-64 items-center justify-center gap-3 text-sm font-semibold text-slate-600">
        <Loader2 className="animate-spin text-[#E31E24]" size={24} />
        {checkingSession ? "Comprobando sesión..." : "Verificando permisos..."}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#E31E24]">
            <CalendarDays size={24} />
          </span>
          <div>
            <h1 className="text-xl font-black text-slate-900 sm:text-2xl">Calendario de flota</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
              Consulta viajes, reservas y mantenimientos para planificar la asignación o subcontratación de vehículos.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          <span className="flex items-center gap-2"><AlertTriangle size={17} />{error}</span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-bold hover:bg-red-100">
            <RefreshCw size={14} /> Reintentar
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-5">
        {[
          { label: `Disponibles · ${formatDate(selectedDate)}`, value: availableCount, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Con servicio asignado", value: occupiedCount, icon: Bus, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Fuera de servicio", value: outOfServiceCount, icon: Wrench, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Reservas sin vehículo", value: selectedReservations.length, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
          { label: "Posibles cruces", value: conflicts.length, icon: AlertTriangle, color: conflicts.length ? "text-red-600" : "text-slate-400", bg: conflicts.length ? "bg-red-50" : "bg-slate-50" },
        ].map((item) => (
          <article key={item.label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.bg} ${item.color}`}><item.icon size={20} /></span>
            <div><p className="text-2xl font-black text-slate-900">{loading ? "—" : item.value}</p><p className="text-[11px] font-semibold text-slate-500">{item.label}</p></div>
          </article>
        ))}
      </div>

      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div>
            <h2 className="text-lg font-black capitalize text-slate-900">
              {viewMode === "week"
                ? `${formatDate(visibleStart)} – ${formatDate(visibleEnd)}`
                : `${MONTHS[month.getMonth()]} ${month.getFullYear()}`}
            </h2>
            <p className="text-xs text-slate-500">Selecciona un día para consultar sus servicios y vehículos disponibles.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1" role="group" aria-label="Navegar por el calendario">
              <button type="button" onClick={() => navigateCalendar(-1)} aria-label={viewMode === "week" ? "Semana anterior" : "Mes anterior"} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
                <ChevronLeft size={18} />
              </button>
              <button type="button" onClick={goToToday} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Hoy
              </button>
              <button type="button" onClick={() => navigateCalendar(1)} aria-label={viewMode === "week" ? "Semana siguiente" : "Mes siguiente"} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Vista del calendario">
              {(["week", "month"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setViewMode(mode); setSelectedItemKey(null); }}
                  aria-pressed={viewMode === mode}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${viewMode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {mode === "week" ? "Semana" : "Mes"}
                </button>
              ))}
            </div>
            <label htmlFor="fleet-type-filter" className="text-xs font-bold text-slate-500">Tipo</label>
            <select id="fleet-type-filter" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setVehicleFilter("todos"); setSelectedItemKey(null); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <option value="todos">Toda la flota</option>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <label htmlFor="fleet-vehicle-filter" className="text-xs font-bold text-slate-500">Vehículo</label>
            <select id="fleet-vehicle-filter" value={vehicleFilter} onChange={(event) => { setVehicleFilter(event.target.value); setSelectedItemKey(null); }} className="max-w-44 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <option value="todos">Todos</option>
              {vehicles
                .filter((vehicle) => typeFilter === "todos" || vehicle.tipo === typeFilter)
                .map((vehicle) => <option key={vehicle.id} value={String(vehicle.id)}>{vehicle.placa} · {vehicle.tipo || vehicle.modelo}</option>)}
            </select>
            <label htmlFor="fleet-status-filter" className="text-xs font-bold text-slate-500">Estado</label>
            <select id="fleet-status-filter" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setSelectedItemKey(null); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <option value="todos">Todos</option>
              <option value="programada">Programada</option>
              <option value="asignada">Asignada</option>
              <option value="en_curso">En curso</option>
              <option value="incidencia">Incidencia</option>
              <option value="completada">Finalizada</option>
              <option value="mantenimiento">Mantenimiento</option>
              <option value="externo">Viaje externo</option>
              <option value="reserva">Reserva</option>
            </select>
            {(typeFilter !== "todos" || vehicleFilter !== "todos" || statusFilter !== "todos") && (
              <button
                type="button"
                onClick={() => { setTypeFilter("todos"); setVehicleFilter("todos"); setStatusFilter("todos"); setSelectedItemKey(null); }}
                className="rounded-xl px-3 py-2 text-xs font-bold text-[#E31E24] hover:bg-red-50"
              >
                Limpiar filtros
              </button>
            )}
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Actualizar calendario" className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {conflicts.length > 0 && (
          <div className="border-b border-red-100 bg-red-50/70 p-3 sm:p-4" role="status" aria-live="polite">
            <div className="mb-2 flex items-start gap-2 text-red-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-black">{conflicts.length} posible{conflicts.length === 1 ? "" : "s"} cruce de horario el {formatDate(selectedDate)}</p>
                <p className="text-xs text-red-700">Revisa que los servicios de cada vehículo no se superpongan. Si falta una hora, se considera ocupado todo el día.</p>
              </div>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {conflicts.map(({ vehicle, first, second }) => (
                <li key={`${eventKey(first)}:${eventKey(second)}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedItemKey(eventKey(first))}
                    className="w-full rounded-xl border border-red-200 bg-white p-3 text-left text-xs text-slate-700 transition hover:border-red-400 hover:bg-red-50"
                  >
                    <span className="block font-black text-red-800">{vehicle.placa} · {eventName(first)} y {eventName(second)}</span>
                    <span className="mt-1 block">{eventSummary(first)}</span>
                    <span className="block">{eventSummary(second)}</span>
                    <span className="mt-1 block font-bold text-red-700">{eventStatusLabel(first)} · {eventStatusLabel(second)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="hidden lg:block">
          <div className="sticky top-0 z-30 bg-white">
            <div ref={calendarHeaderScrollRef} className="overflow-hidden">
              <table className="table-fixed border-collapse text-center" style={{ width: `${calendarTableWidth}px` }}>
                <colgroup>
                  <col style={{ width: "220px" }} />
                  {days.map((day, index) => <col key={day || `blank-${index}`} style={{ width: `${dayColumnWidth}px` }} />)}
                </colgroup>
                <thead>
                  <tr className="bg-slate-50">
                    <th scope="col" className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">Vehículo</th>
                    {days.map((day, index) => (
                      <th key={day || `blank-${index}`} scope="col" className="border-b border-l border-slate-200 bg-slate-50 px-1 py-2">
                        {day && (
                          <button type="button" onClick={() => { setSelectedDate(day); setSelectedItemKey(null); }} aria-label={`Ver disponibilidad del ${formatDate(day)}`} aria-pressed={selectedDate === day} className={`flex w-full flex-col items-center rounded-lg py-2 text-[11px] font-bold ${selectedDate === day ? "bg-[#E31E24] text-white" : day === asIsoDate(new Date()) ? "bg-red-50 text-[#E31E24]" : "text-slate-600 hover:bg-slate-100"}`}>
                            <span className="capitalize">{fromIsoDate(day).toLocaleDateString("es-EC", { weekday: "short" }).replace(".", "")}</span><span className="mt-0.5 text-sm font-black">{Number(day.slice(8, 10))}</span>
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>
          <div
            ref={calendarBodyScrollRef}
            onScroll={(event) => {
              if (calendarHeaderScrollRef.current) calendarHeaderScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }}
            className="overflow-x-auto"
          >
            <table className="table-fixed border-collapse text-center" style={{ width: `${calendarTableWidth}px` }}>
              <colgroup>
                <col style={{ width: "220px" }} />
                {days.map((day, index) => <col key={day || `blank-${index}`} style={{ width: `${dayColumnWidth}px` }} />)}
              </colgroup>
            <tbody>
              {loading ? (
                <tr><td colSpan={days.length + 1} className="py-16 text-center text-sm font-semibold text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin text-[#E31E24]" size={24} />Cargando calendario…</td></tr>
              ) : filteredVehicles.length === 0 ? (
                <tr><td colSpan={days.length + 1} className="py-12 text-center text-sm font-medium text-slate-500">No hay vehículos activos para mostrar.</td></tr>
              ) : filteredVehicles.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-slate-50/60">
                  <th scope="row" className="sticky left-0 z-[1] min-w-[220px] border-b border-r border-slate-200 bg-white px-4 py-2 text-left">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Car size={17} /></span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-slate-800">{vehicle.placa}</span>
                        <span className="block truncate text-[10px] font-medium text-slate-500">{vehicle.tipo || vehicle.modelo}</span>
                        {vehicle.estado.toLowerCase() === "mantenimiento" && <span className="text-[9px] font-bold text-amber-700">En mantenimiento</span>}
                      </span>
                    </div>
                  </th>
                  <td colSpan={days.length} className="border-b border-slate-100 p-0">
                    {(() => {
                      const vehicleEvents = calendarEventsByVehicle.get(vehicle.id) || [];
                      const laneCount = Math.max(1, ...vehicleEvents.map((event) => event.lane + 1));
                      return (
                        <div
                          className="grid gap-x-1 gap-y-1 py-1"
                          style={{
                            gridTemplateColumns: `repeat(${days.length}, ${dayColumnWidth}px)`,
                            gridTemplateRows: `6px repeat(${laneCount}, ${viewMode === "week" ? "64px" : "34px"})`,
                            minWidth: `${days.length * dayColumnWidth}px`,
                          }}
                        >
                          {days.map((day, index) => day ? (
                            <span
                              key={day}
                              aria-hidden="true"
                              style={{ gridColumn: index + 1, gridRow: 1 }}
                              className={`border-l border-slate-100 ${selectedDate === day ? "border-b-2 border-b-[#E31E24] bg-red-50/50" : day === asIsoDate(new Date()) ? "bg-slate-50/70" : ""}`}
                            />
                          ) : <span key={`blank-${index}`} aria-hidden="true" style={{ gridColumn: index + 1, gridRow: 1 }} />)}
                          {vehicleEvents.map((event) => {
                            const itemKey = `event:${event.tipo}:${event.id}`;
                            const timeLabel = eventTimeLabel(event);
                            return (
                              <button
                                key={itemKey}
                                type="button"
                                onClick={() => {
                                  setSelectedDate(event.visibleStart);
                                  setSelectedItemKey(itemKey);
                                }}
                                aria-pressed={selectedItemKey === itemKey}
                                aria-label={`${vehicle.placa}, ${formatDate(event.visibleStart)}${event.visibleEnd !== event.visibleStart ? ` al ${formatDate(event.visibleEnd)}` : ""}, ${eventSummary(event)}, ${eventStatusLabel(event)}${conflictEventKeys.has(itemKey) ? ", posible cruce de horario" : ""}`}
                                title={`${eventStatusLabel(event)} · ${formatDate(event.visibleStart)}${event.visibleEnd !== event.visibleStart ? ` al ${formatDate(event.visibleEnd)}` : ""} · ${eventSummary(event)}`}
                                style={{
                                  gridColumn: `${event.gridStart + 1} / ${event.gridEnd + 2}`,
                                  gridRow: event.lane + 2,
                                }}
                                className={`z-[1] flex min-w-0 flex-col justify-center overflow-hidden rounded-lg border px-2 text-left transition hover:brightness-95 ${viewMode === "week" ? "gap-1 py-1 text-[10px]" : "truncate text-[9px]"} ${eventStyle(event)} ${conflictEventKeys.has(itemKey) ? "ring-2 ring-red-500 ring-offset-1" : ""} ${selectedItemKey === itemKey ? "ring-2 ring-[#E31E24] ring-offset-1" : ""}`}
                              >
                                <span className="flex min-w-0 items-center justify-between gap-1">
                                  <span className="truncate font-black">{event.tipo === "mantenimiento" ? "Mantenimiento" : eventName(event)}</span>
                                  <span className="flex shrink-0 items-center gap-1">
                                    {conflictEventKeys.has(itemKey) && <AlertTriangle size={11} aria-hidden="true" />}
                                    {viewMode === "week" && timeLabel && (
                                      <span className="rounded bg-white/70 px-1 font-black tabular-nums">{timeLabel}</span>
                                    )}
                                  </span>
                                </span>
                                {viewMode === "week" && (
                                  <span className="line-clamp-2 block min-w-0 whitespace-normal break-words text-[9px] leading-3 font-semibold opacity-80">
                                    {event.tipo === "mantenimiento" || event.tipo === "externo"
                                      ? eventStatusLabel(event)
                                      : [event.origen, event.destino].filter(Boolean).join(" → ") || eventStatusLabel(event)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-[10px] font-semibold text-slate-600 sm:px-5">
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-blue-200 bg-blue-50" /> Viaje</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-cyan-200 bg-cyan-50" /> Reserva</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-emerald-200 bg-emerald-50" /> En curso</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-red-200 bg-red-50" /> Incidencia</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-amber-200 bg-amber-50" /> Mantenimiento</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-violet-200 bg-violet-50" /> Bloqueo externo</span>
          <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="h-3 w-3 rounded border border-slate-200 bg-slate-100" /> Finalizado</span>
        </div>

        <div className="divide-y divide-slate-100 lg:hidden">
          {loading ? (
            <div className="py-12 text-center text-sm font-semibold text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin text-[#E31E24]" size={22} />Cargando agenda…</div>
          ) : mobileAgenda.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No hay viajes ni reservas pendientes en este período.</p>
          ) : mobileAgenda.map(({ day, events: dayEvents, reservations: dayReservations }) => (
            <section key={day} className={selectedDate === day ? "bg-red-50/40" : ""}>
              <button
                type="button"
                onClick={() => { setSelectedDate(day); setSelectedItemKey(null); }}
                aria-pressed={selectedDate === day}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm font-black capitalize text-slate-800">{formatDate(day)}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                  {dayEvents.length + dayReservations.length} {dayEvents.length + dayReservations.length === 1 ? "servicio" : "servicios"}
                </span>
              </button>
              <ul className="space-y-2 px-4 pb-3">
                {dayEvents.map((event) => {
                  const vehicle = vehicles.find((entry) => entry.id === event.vehiculo_id);
                  const itemKey = `event:${event.tipo}:${event.id}`;
                  return (
                    <li key={itemKey}>
                      <button
                        type="button"
                        onClick={() => { setSelectedDate(day); setSelectedItemKey(itemKey); }}
                        aria-pressed={selectedItemKey === itemKey}
                        className={`w-full rounded-xl border p-3 text-left ${eventStyle(event)} ${selectedItemKey === itemKey ? "ring-2 ring-[#E31E24] ring-offset-1" : ""}`}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-black">{vehicle ? `${vehicle.placa} · ${vehicle.modelo}` : eventName(event)}</span>
                          <span className="flex items-center gap-1 text-[9px] font-bold">
                            {conflictEventKeys.has(itemKey) && <><AlertTriangle size={12} /> Posible cruce ·</>}
                            {eventStatusLabel(event)}
                          </span>
                        </span>
                        <span className="mt-1 block text-[11px] font-semibold">{eventSummary(event)}</span>
                      </button>
                    </li>
                  );
                })}
                {dayReservations.map((reservation) => {
                  const itemKey = `reservation:${reservation.id}`;
                  return (
                    <li key={itemKey}>
                      <button
                        type="button"
                        onClick={() => { setSelectedDate(day); setSelectedItemKey(itemKey); }}
                        aria-pressed={selectedItemKey === itemKey}
                        className={`w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-900 ${selectedItemKey === itemKey ? "ring-2 ring-amber-500 ring-offset-1" : ""}`}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-black">Reserva #{reservation.id} · {reservation.cliente_nombre}</span>
                          <span className="text-[9px] font-black uppercase">Requiere vehículo</span>
                        </span>
                        <span className="mt-1 block text-[11px] font-semibold">{[reservation.origen, reservation.destino].filter(Boolean).join(" → ") || "Ruta pendiente"}</span>
                        {reservation.fecha_regreso && <span className="mt-1 block text-[10px] font-bold">Regreso: {formatDate(reservation.fecha_regreso)}{reservation.hora_regreso ? ` · ${reservation.hora_regreso}` : ""}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Agenda del {formatDate(selectedDate)}</h2>
              <p className="mt-1 text-xs text-slate-500">Servicios asignados al día seleccionado.</p>
            </div>
            <Clock3 size={19} className="shrink-0 text-slate-400" />
          </div>
          {selectedEvents.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No hay viajes ni mantenimientos registrados para este día.</p>
          ) : visibleSelectedEvents.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No hay servicios que coincidan con los filtros seleccionados.</p>
          ) : (
            <ul className="space-y-2">
              {visibleSelectedEvents.map((event) => {
                const vehicle = vehicles.find((entry) => entry.id === event.vehiculo_id);
                const itemKey = `event:${event.tipo}:${event.id}`;
                return (
                  <li key={itemKey}>
                    <button
                      type="button"
                      onClick={() => setSelectedItemKey(itemKey)}
                      aria-pressed={selectedItemKey === itemKey}
                      className={`w-full rounded-xl border p-3 text-left ${eventStyle(event)} ${selectedItemKey === itemKey ? "ring-2 ring-[#E31E24] ring-offset-1" : ""}`}
                    >
                      <p className="text-sm font-black">{vehicle ? `${vehicle.placa} · ${vehicle.modelo}` : "Vehículo"}</p>
                      <p className="mt-1 text-xs font-semibold">{eventSummary(event)}</p>
                      {event.tipo === "mantenimiento" && event.descripcion && <p className="mt-1 text-xs">{event.descripcion}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">Reservas confirmadas sin vehículo</h2>
              <p className="mt-1 text-xs text-slate-600">Revisa si requieren asignación o subcontratación.</p>
            </div>
            <AlertTriangle size={19} className="shrink-0 text-amber-600" />
          </div>
          {selectedReservations.length === 0 ? (
            <p className="rounded-xl border border-amber-200 bg-white/70 p-4 text-sm text-slate-600">No hay reservas confirmadas sin vehículo para este día.</p>
          ) : (
            <ul className="mb-4 space-y-2">
              {selectedReservations.map((reservation) => (
                <li key={reservation.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedItemKey(`reservation:${reservation.id}`)}
                    aria-pressed={selectedItemKey === `reservation:${reservation.id}`}
                    className={`w-full rounded-xl border border-amber-200 bg-white p-3 text-left ${selectedItemKey === `reservation:${reservation.id}` ? "ring-2 ring-amber-500 ring-offset-1" : ""}`}
                  >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-black text-slate-800">Reserva #{reservation.id} · {reservation.cliente_nombre}</p>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">{reservation.num_personas} pasajeros · requiere vehículo</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{[reservation.origen, reservation.destino].filter(Boolean).join(" → ") || "Ruta pendiente"}</p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-500">{reservation.tipo_vehiculo || "Tipo de vehículo por definir"} · {formatDate((reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva).slice(0, 10))}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/operaciones" className="inline-flex items-center gap-2 rounded-xl bg-[#E31E24] px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700">
            Ir a despacho <ArrowRight size={15} />
          </Link>
        </section>
      </div>

      <section aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays size={18} className="text-slate-500" />
          <h2 className="text-base font-black text-slate-900">Detalle seleccionado</h2>
        </div>
        {selectedEvent ? (
          <div className={`rounded-xl border p-4 ${eventStyle(selectedEvent)}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black">{eventName(selectedEvent)} · {vehicles.find((vehicle) => vehicle.id === selectedEvent.vehiculo_id)?.placa || "Vehículo"}</p>
                <p className="mt-1 text-xs font-semibold">{eventStatusLabel(selectedEvent)}</p>
              </div>
              <span className="rounded-full border border-current/20 bg-white/70 px-3 py-1 text-[10px] font-black">
                {formatDate(selectedEvent.fecha_inicio)}{selectedEvent.fecha_fin !== selectedEvent.fecha_inicio ? ` – ${formatDate(selectedEvent.fecha_fin)}` : ""}
              </span>
            </div>
            <p className="mt-3 text-xs font-semibold">{eventSummary(selectedEvent)}</p>
            {conflictEventKeys.has(eventKey(selectedEvent)) && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-100 px-2.5 py-1.5 text-xs font-black text-red-800">
                <AlertTriangle size={14} /> Este servicio coincide en horario con otro del mismo vehículo.
              </p>
            )}
            {(selectedEvent.tipo === "operacion" || selectedEvent.tipo === "reserva" || selectedEvent.tipo === "externo") && (
              <p className="mt-1 text-xs"><span className="font-bold">Conductor:</span> {selectedEvent.conductor_nombre || "Pendiente de asignación"}</p>
            )}
            {selectedEvent.tipo === "mantenimiento" && selectedEvent.descripcion && <p className="mt-1 text-xs">{selectedEvent.descripcion}</p>}
            {selectedEvent.tipo === "externo" && (selectedEvent.cliente_empresa || selectedEvent.notas) && (
              <p className="mt-1 text-xs">{[selectedEvent.cliente_empresa, selectedEvent.notas].filter(Boolean).join(" · ")}</p>
            )}
            {selectedEvent.tipo !== "mantenimiento" && <p className="mt-2 text-xs font-bold">Unidad asignada a este servicio.</p>}
          </div>
        ) : selectedUnassignedReservation ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black">Reserva #{selectedUnassignedReservation.id} · {selectedUnassignedReservation.cliente_nombre}</p>
                <p className="mt-1 text-xs font-semibold">Requiere asignar un vehículo o confirmar una subcontratación.</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black">{selectedUnassignedReservation.num_personas} pasajeros</span>
            </div>
            <p className="mt-3 text-xs font-semibold">{[selectedUnassignedReservation.origen, selectedUnassignedReservation.destino].filter(Boolean).join(" → ") || "Ruta pendiente"}</p>
            <p className="mt-1 text-xs">{selectedUnassignedReservation.tipo_vehiculo || "Tipo de vehículo por definir"} · {formatDate((selectedUnassignedReservation.fecha_salida || selectedUnassignedReservation.fecha_servicio || selectedUnassignedReservation.fecha_reserva).slice(0, 10))}</p>
            {selectedUnassignedReservation.fecha_regreso && <p className="mt-1 text-xs font-bold">Regreso: {formatDate(selectedUnassignedReservation.fecha_regreso)}{selectedUnassignedReservation.hora_regreso ? ` · ${selectedUnassignedReservation.hora_regreso}` : ""} · {selectedUnassignedReservation.destino} → {selectedUnassignedReservation.origen}</p>}
            <Link href="/admin/operaciones" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#E31E24] px-3 py-2 text-xs font-black text-white hover:bg-red-700">
              Revisar en despacho <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Selecciona una barra de viaje, mantenimiento o reserva para ver sus detalles y estado de asignación.</p>
        )}
      </section>
    </div>
  );
}
