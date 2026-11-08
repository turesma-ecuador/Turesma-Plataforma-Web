"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { descargarExcel } from "../../../lib/download";
import { useRouter } from "next/navigation";
import {
  Calendar, Plus, Edit3, Trash2, X, Search,
  CheckCircle, Clock, AlertCircle, Loader2, User, Car,
  MapPin, ArrowRight, CreditCard, FileSpreadsheet, History
} from "lucide-react";
import { MapPicker, Punto } from "../../../components/map-picker";
import { VehiculoCalendario } from "../../../components/vehiculo-calendario";
import { useConfirm } from "../../../components/confirm-dialog";

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
  num_personas: number | null;
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

const ESTADOS = ["pendiente", "pendiente_pago", "confirmada", "en_curso", "finalizada", "cancelada"];
const createEmptyForm = () => ({
  usuario_id: "",
  fecha_reserva: new Date().toISOString().slice(0, 10),
  fecha_salida: "",
  fecha_llegada: "",
  num_personas: "1",
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
  confirmada: ["en_curso", "cancelada"],
  en_curso: ["finalizada"],
  finalizada: [],
  cancelada: [],
};

const INPUT_CLS = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";

export default function AdminReservasPage() {
  const { checkingSession } = useAdminGuard();
  const router = useRouter();
  const confirmar = useConfirm();
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Modal crear/editar
  const [modalOpen, setModalOpen] = useState(false);
  const [adminOrigin, setAdminOrigin] = useState<Punto | null>(null);
  const [adminDestination, setAdminDestination] = useState<Punto | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(createEmptyForm);
  const [prefilledClientId, setPrefilledClientId] = useState<string | null>(null);

  // Modal cambio de estado
  const [estadoModal, setEstadoModal] = useState<Reserva | null>(null);
  const [nuevoEstado, setNuevoEstado] = useState("");
  const [estadoLoading, setEstadoLoading] = useState(false);
  const [historyReservation, setHistoryReservation] = useState<Reserva | null>(null);
  const [reservationHistory, setReservationHistory] = useState<ReservaHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const h = getAuthHeaders();

  useEffect(() => {
    const clientId = new URLSearchParams(window.location.search).get("usuario_id");
    if (clientId && /^\d+$/.test(clientId)) setPrefilledClientId(clientId);
  }, []);

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
      const [rRes, uRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/reservas`, { headers: h }),
        fetch(`${API_URL}/api/admin/usuarios`, { headers: h }),
      ]);
      if (rRes.ok) setReservas(await rRes.json());
      if (uRes.ok) {
        const usuarios = await uRes.json();
        setClientes(usuarios.filter((u: any) => u.rol === "cliente"));
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const filtered = reservas.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      String(r.id).includes(q) ||
      (r.cliente_nombre || "").toLowerCase().includes(q) ||
      (r.vehiculo_placa || "").toLowerCase().includes(q) ||
      (r.destino || "").toLowerCase().includes(q) ||
      (r.origen || "").toLowerCase().includes(q);
    const matchEstado = filtroEstado === "todos" || r.estado === filtroEstado;
    return matchSearch && matchEstado;
  });

  const exportarExcel = async () => {
    setExportandoExcel(true);
    setErr("");
    const query = new URLSearchParams({ tipo: "reservas", formato: "xlsx" });
    if (filtroEstado !== "todos") query.set("estado", filtroEstado);
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
    setForm({
      usuario_id: String(r.usuario_id || ""),
      fecha_reserva: r.fecha_reserva?.slice(0, 10) || "",
      fecha_salida: r.fecha_salida?.slice(0, 16) || "",
      fecha_llegada: r.fecha_llegada?.slice(0, 16) || "",
      num_personas: String(r.num_personas || "1"),
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
    const payload: Record<string, any> = {
      usuario_id: Number(form.usuario_id),
      fecha_reserva: form.fecha_reserva,
      fecha_salida: form.fecha_salida || null,
      fecha_llegada: form.fecha_llegada || null,
      num_personas: Number(form.num_personas),
      total: form.total ? Number(form.total) : null,
      origen: adminOrigin ? adminOrigin.label : (form.origen || null),
      destino: adminDestination ? adminDestination.label : (form.destino || null),
      notas: form.notas || null,
      estado: editingId ? form.estado : "pendiente_pago",
    };
    const url = editingId ? `${API_URL}/api/admin/reservas/${editingId}` : `${API_URL}/api/admin/reservas`;
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: h, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Error al guardar"); return; }
    setMsg(editingId ? "Reserva actualizada correctamente" : "Reserva creada correctamente");
    setModalOpen(false);
    setAdminOrigin(null); setAdminDestination(null);
    load();
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
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cambiar estado");
      setMsg(`Estado actualizado a "${nuevoEstado}"`);
      setEstadoModal(null);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al cambiar estado");
    } finally {
      setEstadoLoading(false);
    }
  };

  const formatFecha = (v?: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // Stats
  const stats = {
    total: reservas.length,
    pendientes: reservas.filter(r => r.estado === "pendiente").length,
    confirmadas: reservas.filter(r => r.estado === "confirmada").length,
    en_curso: reservas.filter(r => r.estado === "en_curso").length,
    finalizadas: reservas.filter(r => r.estado === "finalizada").length,
  };
  const editingReservation = reservas.find((reserva) => reserva.id === editingId);

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
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
        Aquí se gestionan las solicitudes y sus datos. La asignación o cambio de vehículo y conductor se realiza desde Despacho.
      </div>

      {/* FILTROS */}
      <div className="flex flex-wrap gap-3 items-center bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por ID, cliente, vehículo, destino..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-bold outline-none focus:border-[#E31E24] transition-all" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["todos", ...ESTADOS].map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtroEstado === e ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {e === "todos" ? "Todos" : (ESTADO_LABEL[e] || e.replace("_", " "))}
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
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{formatFecha(r.fecha_reserva)}{r.num_personas ? ` · ${r.num_personas} pers.` : ""}</span>
                  <span className="text-right font-semibold text-slate-700">
                    {r.vehiculo_placa || "Vehículo pendiente"}
                    <br /><span className="text-[10px] text-slate-400">Chofer: {r.conductor_nombre || "pendiente"}</span>
                    <br /><span className="text-[10px] text-slate-400">Preferencia: {r.tipo_vehiculo || "Sin preferencia"}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
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
            <table className="min-w-[1100px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  {["#ID", "Cliente", "Vehículo / Conductor (solo lectura)", "Origen → Destino", "Fecha Reserva", "Estado", "Acciones"].map(h => (
                    <th key={h} className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-4">
                      <span className="font-black text-slate-700 text-sm">#{r.id}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
                          <User size={12} className="text-[#E31E24]" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-700">{r.cliente_nombre || `Usuario #${r.usuario_id}`}</p>
                          <p className="text-[10px] text-slate-400">{r.cliente_email || ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        {r.vehiculo_placa ? (
                          <div className="flex items-center gap-1">
                            <Car size={11} className="text-slate-400" />
                            <span className="text-xs font-black text-slate-700">{r.vehiculo_placa}</span>
                            {r.vehiculo_modelo && <span className="text-[10px] text-slate-400">· {r.vehiculo_modelo}</span>}
                          </div>
                        ) : (
                          <span className="text-[10px] text-amber-500 font-bold">Preferencia: {r.tipo_vehiculo || "Sin indicar"} · unidad pendiente</span>
                        )}
                        {r.vehiculo_placa && <span className="block text-[10px] text-slate-400">Preferencia: {r.tipo_vehiculo || "Sin indicar"}</span>}
                        {r.conductor_nombre && (
                          <div className="flex items-center gap-1">
                            <User size={11} className="text-slate-400" />
                            <span className="text-[10px] text-slate-500">{r.conductor_nombre}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        {r.origen && (
                          <div className="flex items-center gap-1">
                            <MapPin size={10} className="text-emerald-500" />
                            <span className="text-[10px] text-slate-600 max-w-[140px] truncate">{r.origen}</span>
                          </div>
                        )}
                        {r.destino && (
                          <div className="flex items-center gap-1">
                            <MapPin size={10} className="text-[#E31E24]" />
                            <span className="text-[10px] text-slate-600 max-w-[140px] truncate">{r.destino}</span>
                          </div>
                        )}
                        {!r.origen && !r.destino && <span className="text-[10px] text-slate-300 italic">Sin ruta</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs text-slate-600">{formatFecha(r.fecha_reserva)}</p>
                      {r.num_personas && <p className="text-[10px] text-slate-400">{r.num_personas} persona(s)</p>}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase border ${ESTADO_BADGE[r.estado] || ESTADO_BADGE.pendiente}`}>
                        {ESTADO_ICON[r.estado]}
                        {ESTADO_LABEL[r.estado] || r.estado.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-1 flex-wrap">
                        <button onClick={() => void openHistory(r)} className="rounded-lg p-1.5 text-violet-600 hover:bg-violet-50" title="Ver historial"><History size={14} /></button>
                        <button
                          onClick={() => {
                            setEstadoModal(r);
                            setNuevoEstado(TRANSICIONES_VALIDAS[r.estado]?.[0] || "");
                          }}
                          className="px-2 py-1.5 text-[10px] font-black uppercase bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all"
                          title="Cambiar estado"
                        >
                          Estado
                        </button>
                        <button onClick={() => openEdit(r)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-all" title="Editar">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => handleDelete(r)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Eliminar">
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
                        <div><p className="font-black text-slate-800">{entry.accion.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{entry.estado_anterior || "—"} → {entry.estado_nuevo || "—"} · {entry.usuario_nombre || "Usuario eliminado"} {entry.usuario_apellido || ""}</p></div>
                        <time className="text-xs font-semibold text-slate-400">{new Date(entry.creado_en).toLocaleString("es-EC")}</time>
                      </div>
                      {entry.detalle && <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(typeof entry.detalle === "string" ? JSON.parse(entry.detalle) : entry.detalle, null, 2)}</pre>}
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
                    <option key={s} value={s}>{ESTADO_LABEL[s] || s.replace("_", " ")}</option>
                  ))}
                </select>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setEstadoModal(null)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-black text-xs uppercase">Cancelar</button>
                  <button
                    onClick={handleCambiarEstado}
                    disabled={estadoLoading || !nuevoEstado}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl my-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[#E31E24] p-2 rounded-xl"><Calendar size={18} /></div>
                <h2 className="font-black italic uppercase text-lg">{editingId ? "Editar Reserva" : "Nueva Reserva"}</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full"><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 grid gap-4 max-h-[75vh] overflow-y-auto">
              <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
                El vehículo y el conductor se asignan o cambian únicamente desde Despacho, después de confirmar la reserva.
                {editingReservation && (
                  <span className="mt-1 block text-blue-700">
                    Asignación actual: {editingReservation.vehiculo_placa || "sin vehículo"} · {editingReservation.conductor_nombre || "sin conductor"}.
                  </span>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Cliente *</label>
                  <select value={form.usuario_id} onChange={e => setForm(p => ({ ...p, usuario_id: e.target.value }))} className={INPUT_CLS} required>
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} — {c.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Estado</label>
                  {editingId ? (
                    <select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))} className={INPUT_CLS}>
                      {ESTADOS.map(s => <option key={s} value={s}>{ESTADO_LABEL[s] || s.replace("_", " ")}</option>)}
                    </select>
                  ) : (
                    <div className={`${INPUT_CLS} cursor-not-allowed text-orange-700`}>Pendiente de pago</div>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Fecha reserva * {form.fecha_reserva && <span className="text-[#E31E24]">({form.fecha_reserva})</span>}</label>
                  <VehiculoCalendario vehiculoId={null} value={form.fecha_reserva} onSelect={(f) => setForm(p => ({ ...p, fecha_reserva: f }))} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Num. personas</label>
                  <input type="number" min="1" value={form.num_personas} onChange={e => setForm(p => ({ ...p, num_personas: e.target.value }))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Fecha salida</label>
                  <input type="datetime-local" value={form.fecha_salida} onChange={e => setForm(p => ({ ...p, fecha_salida: e.target.value }))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Fecha llegada</label>
                  <input type="datetime-local" value={form.fecha_llegada} onChange={e => setForm(p => ({ ...p, fecha_llegada: e.target.value }))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Total ($)</label>
                  <input type="number" step="0.01" min="0" value={form.total} onChange={e => setForm(p => ({ ...p, total: e.target.value }))} className={INPUT_CLS} placeholder="0.00" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Origen y destino (selecciona en el mapa)</label>
                {(form.origen || form.destino) && !adminOrigin && !adminDestination && (
                  <p className="text-[11px] text-slate-500 mb-2 bg-slate-50 rounded-lg px-3 py-2">
                    Actual: <b>{form.origen || "—"}</b> → <b>{form.destino || "—"}</b>. Marca en el mapa para cambiar.
                  </p>
                )}
                <MapPicker origin={adminOrigin} destination={adminDestination} onChange={(which, val) => which === "origin" ? setAdminOrigin(val) : setAdminDestination(val)} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1 block mb-1">Notas</label>
                <textarea value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} rows={2} className={INPUT_CLS + " resize-none"} placeholder="Observaciones..." />
              </div>

              {err && <p className="text-red-600 text-sm font-bold">{err}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-3 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest hover:border-slate-300 transition-all">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 py-3 rounded-2xl bg-[#E31E24] text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-red-200">
                  {editingId ? "Guardar Cambios" : "Crear Reserva"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
