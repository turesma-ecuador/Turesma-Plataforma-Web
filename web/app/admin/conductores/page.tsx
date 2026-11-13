"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { descargarExcel } from "../../../lib/download";
import { WhatsAppButton } from "../../../components/whatsapp-button";
import { useConfirm } from "../../../components/confirm-dialog";
import {
  UserCircle, Plus, Edit3, Trash2, X, Search, FileSpreadsheet,
  CheckCircle, AlertCircle, Star, Loader2, Car, UploadCloud
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Conductor = {
  id: number;
  nombre: string;
  email: string;
  telefono?: string | null;
  licencia?: string | null;
  licencia_tipo?: string | null;
  estado?: string;
  rating_promedio?: number | null;
  viajes_completados?: number;
  viajes_cancelados?: number;
  horas_conduccion?: number;
  fecha_licencia_vencimiento?: string | null;
  estado_documentos?: string;
  activo: boolean;
  creado_en: string;
};

const ESTADO_OPTIONS = ["disponible", "en_servicio", "mantenimiento", "inactivo"];

const ESTADO_BADGE: Record<string, string> = {
  disponible: "bg-emerald-100 text-emerald-700 border-emerald-200",
  en_servicio: "bg-blue-100 text-blue-700 border-blue-200",
  mantenimiento: "bg-amber-100 text-amber-700 border-amber-200",
  inactivo: "bg-gray-100 text-gray-500 border-gray-200",
};

const DOC_BADGE: Record<string, string> = {
  completos: "bg-green-100 text-green-700",
  pendientes: "bg-yellow-100 text-yellow-700",
  vencidos: "bg-red-100 text-red-700",
};

const INPUT_CLS = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";

export default function AdminConductoresPage() {
  const { checkingSession } = useAdminGuard();
  const confirmar = useConfirm();
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const LIC_TYPES = ["A","A1","B","C1","C","D","D1","E1","E","F","G"];

  const emptyForm = {
    nombre: "", email: "", password: "", telefono: "",
    licencia_tipo: "", foto_conductor: "", estado: "disponible",
    fecha_licencia_vencimiento: "", estado_documentos: "completos",
    rating_promedio: "5.0",
  };
  const [form, setForm] = useState(emptyForm);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      // Intentar endpoint de desempeño que trae datos más ricos, sino el básico
      const res = await fetch(`${API_URL}/api/admin/conductores`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los conductores");
      setConductores(Array.isArray(data) ? data : []);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los conductores. Revisa tu conexión e inténtalo otra vez.");
    }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const filtered = conductores.filter((c) => {
    const matchSearch = !search ||
      c.nombre.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      (c.licencia || "").toLowerCase().includes(search.toLowerCase());
    const matchEstado = filtroEstado === "todos" || (c.estado || "disponible") === filtroEstado;
    return matchSearch && matchEstado && c.activo !== false;
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const exportarExcel = async () => {
    setExportandoExcel(true); setErr("");
    const result = await descargarExcel("/api/admin/reportes/exportar-csv?tipo=conductores&formato=xlsx", "reporte_conductores.xlsx");
    if (!result.ok) setErr(result.error || "No se pudo exportar");
    setExportandoExcel(false);
  };

  const openEdit = (c: Conductor) => {
    setEditingId(c.id);
    setForm({
      nombre: c.nombre,
      email: c.email,
      password: "",
      telefono: c.telefono || "",
      licencia_tipo: c.licencia_tipo || c.licencia || "",
      foto_conductor: (c as any).foto_conductor || "",
      estado: c.estado || "disponible",
      fecha_licencia_vencimiento: c.fecha_licencia_vencimiento
        ? String(c.fecha_licencia_vencimiento).slice(0, 10)
        : "",
      estado_documentos: c.estado_documentos || "completos",
      rating_promedio: String(c.rating_promedio ?? "5.0"),
    });
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const handleFileUpload = async (file: File | null, route: string, setUploading: (v: boolean) => void) => {
    if (!file) return "";
    // Validación cliente: tipo y tamaño
    if (!file.type || !file.type.startsWith("image/")) {
      setErr("Formato no válido: sube una imagen JPG/PNG");
      return "";
    }
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      setErr("Archivo demasiado grande: máximo 5MB");
      return "";
    }
    setErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      // El backend espera el campo 'imagen' en los handlers existentes
      fd.append("imagen", file);
      const res = await fetch(`${API_URL}${route}`, { method: "POST", body: fd, headers: { "Authorization": getAuthHeaders().Authorization } });
      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error || "Error al subir archivo");
        return "";
      }
      return json.imageUrl || json.url || "";
    } catch {
      setErr("No se pudo subir el archivo");
      return "";
    } finally {
      setUploading(false);
    }
  };

  const handleDriverPhotoUpload = async (file: File | null) => {
    // Reutilizamos el endpoint existente de vehiculos para subir imágenes
    const url = await handleFileUpload(file, "/api/admin/uploads/vehiculo-imagen", setUploadingPhoto);
    if (url) setForm(p => ({ ...p, foto_conductor: url }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");

    if (!editingId && !form.password) {
      setErr("La contraseña es obligatoria para nuevos conductores");
      return;
    }
    if (!editingId && !form.licencia_tipo) {
      setErr("Debes seleccionar el tipo de licencia");
      return;
    }

    const payload: Record<string, unknown> = {
      nombre: form.nombre,
      email: form.email,
      telefono: form.telefono || null,
      estado: form.estado,
      foto_conductor: form.foto_conductor || null,
    };
    if (form.password) payload.password = form.password;
    // Añadir tipo de licencia y foto del conductor si existen
    if (form.licencia_tipo) payload.licencia_tipo = form.licencia_tipo;
    if (form.fecha_licencia_vencimiento) payload.fecha_licencia_vencimiento = form.fecha_licencia_vencimiento;
    if (form.estado_documentos) payload.estado_documentos = form.estado_documentos;
    if (form.rating_promedio) payload.rating_promedio = Number(form.rating_promedio);

    if (editingId) {
      // EDITAR vía endpoint de conductores para persistir licencia y estado
      const res = await fetch(`${API_URL}/api/admin/conductores/${editingId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Error al actualizar"); return; }
      setMsg("Conductor actualizado correctamente");
    } else {
      // CREAR via endpoint de conductores
      const res = await fetch(`${API_URL}/api/admin/conductores`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || "Error al registrar"); return; }
      setMsg("Conductor registrado correctamente");
    }

    setModalOpen(false);
    load();
  };

  const handleDelete = async (c: Conductor) => {
    if (!(await confirmar({ title: "Dar de baja", message: `¿Dar de baja al conductor ${c.nombre}?`, confirmText: "Dar de baja", tone: "danger" }))) return;
    const res = await fetch(`${API_URL}/api/admin/conductores/${c.id}`, { method: "DELETE", headers: getAuthHeaders() });
    if (res.ok) { setMsg("Conductor dado de baja"); load(); }
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <Star key={i} size={12} className={i < Math.round(rating) ? "text-yellow-400 fill-yellow-400" : "text-slate-200 fill-slate-200"} />
    ));
  };

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button onClick={exportarExcel} disabled={exportandoExcel} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
          {exportandoExcel ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Excel con diseño
        </button>
        <button onClick={openCreate} className="flex items-center gap-2 bg-[#E31E24] hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20">
          <Plus size={16} />
          Nuevo Conductor
        </button>
      </div>

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Total conductores", val: conductores.filter(c => c.activo !== false).length, icon: UserCircle, color: "text-slate-900", bg: "bg-white" },
          { label: "Disponibles", val: conductores.filter(c => c.activo !== false && (c.estado === "disponible" || !c.estado)).length, icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "En servicio", val: conductores.filter(c => c.activo !== false && c.estado === "en_servicio").length, icon: Car, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Rating promedio", val: conductores.length > 0 ? (conductores.reduce((acc, c) => acc + (c.rating_promedio || 5), 0) / conductores.length).toFixed(1) : "5.0", icon: Star, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((k) => (
          <div key={k.label} className={`${k.bg} rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm flex items-start justify-between`}>
            <div>
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
              <p className={`text-2xl sm:text-4xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
            </div>
            <k.icon size={20} className={k.color} />
          </div>
        ))}
      </div>

      {/* MENSAJES */}
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><span>{loadError}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-red-700 shadow-sm">Reintentar</button></div>}

      {/* FILTROS */}
      <div className="flex flex-wrap gap-3 items-center bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, email o licencia..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-bold outline-none focus:border-[#E31E24] transition-all" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["todos", ...ESTADO_OPTIONS].map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtroEstado === e ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {e === "todos" ? "Todos" : e.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* TABLA */}
      <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-[#E31E24]" size={36} />
          </div>
        ) : filtered.length === 0 && loadError ? (
          <div className="flex h-64 items-center justify-center p-6 text-center text-sm font-bold text-red-700">No se pudo determinar si hay conductores registrados.</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <UserCircle size={48} className="text-slate-200" />
            <p className="text-sm font-black uppercase text-slate-300 italic tracking-tighter">Sin conductores registrados</p>
          </div>
        ) : (
          <>
          {/* MÓVIL: tarjetas */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filtered.map((c) => (
              <div key={c.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                      {((c as any).foto_conductor) ? (
                        <Image src={(c as any).foto_conductor} alt={c.nombre} fill sizes="80px" unoptimized className="object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[#E31E24]/10 flex items-center justify-center text-[#E31E24] font-black text-sm">
                          {c.nombre.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{c.nombre}</p>
                      <p className="text-[11px] text-slate-400 truncate">{c.telefono || "Sin teléfono"}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase border ${ESTADO_BADGE[c.estado || "disponible"] || ESTADO_BADGE.disponible}`}>
                    {(c.estado || "disponible").replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <div className="flex gap-0.5">{renderStars(c.rating_promedio || 5)}</div>
                  <span>{c.viajes_completados || 0} viajes · {c.horas_conduccion || 0}h</span>
                </div>
                <p className="text-[11px] text-slate-500">Licencia: <span className="font-semibold text-slate-700">{c.licencia || c.licencia_tipo || "No registrada"}</span></p>
                <div className="flex gap-2 pt-1 items-center">
                  <WhatsAppButton telefono={c.telefono} title={`WhatsApp de ${c.nombre}`} mensaje={`Hola ${c.nombre}, le saludamos de Turesma S.A.`} />
                  <button onClick={() => openEdit(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase text-blue-600 bg-blue-50 rounded-lg">
                    <Edit3 size={14} /> Editar
                  </button>
                  <button onClick={() => handleDelete(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase text-red-500 bg-red-50 rounded-lg">
                    <Trash2 size={14} /> Baja
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* ESCRITORIO: tabla */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-[920px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  {["Conductor", "Contacto", "Licencia", "Desempeño", "Estado", "Acciones"].map(h => (
                    <th key={h} className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
                          {((c as any).foto_conductor) ? (
                            <Image src={(c as any).foto_conductor} alt={c.nombre} fill sizes="80px" unoptimized className="object-cover" />
                          ) : (
                            <div className="w-full h-full bg-[#E31E24]/10 flex items-center justify-center text-[#E31E24] font-black text-sm">
                              {c.nombre.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-black text-slate-900 italic tracking-tighter uppercase text-sm">{c.nombre}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{new Date(c.creado_en).toLocaleDateString("es-ES")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-bold text-slate-600">{c.email}</p>
                      <p className="text-[10px] text-slate-400">{c.telefono || "Sin teléfono"}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-bold text-slate-700">{c.licencia || c.licencia_tipo || "No registrada"}</p>
                      {c.fecha_licencia_vencimiento && (
                        <p className="text-[10px] text-slate-400">Vence: {new Date(c.fecha_licencia_vencimiento).toLocaleDateString("es-ES")}</p>
                      )}
                      {c.estado_documentos && (
                        <span className={`mt-1 inline-block text-[9px] font-black uppercase px-2 py-0.5 rounded ${DOC_BADGE[c.estado_documentos] || DOC_BADGE.completos}`}>
                          {c.estado_documentos}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-0.5 mb-1">{renderStars(c.rating_promedio || 5)}</div>
                      <p className="text-[10px] font-bold text-slate-400">{c.viajes_completados || 0} viajes · {c.horas_conduccion || 0}h</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-black uppercase border ${ESTADO_BADGE[c.estado || "disponible"] || ESTADO_BADGE.disponible}`}>
                        {c.estado === "disponible" || !c.estado ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                        {(c.estado || "disponible").replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <WhatsAppButton telefono={c.telefono} title={`WhatsApp de ${c.nombre}`} mensaje={`Hola ${c.nombre}, le saludamos de Turesma S.A.`} />
                        <button onClick={() => openEdit(c)} className="p-2.5 text-blue-500 hover:bg-blue-50 rounded-xl transition-all" title="Editar">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleDelete(c)} className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Dar de baja">
                          <Trash2 size={16} />
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

      {/* MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-[2.5rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 my-4">
            <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[#E31E24] p-2 rounded-xl"><UserCircle size={20} /></div>
                <h2 className="text-lg font-black italic tracking-tighter uppercase">
                  {editingId ? "Editar Conductor" : "Registrar Conductor"}
                </h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-7 grid gap-4 max-h-[75vh] overflow-y-auto">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nombre completo *</label>
                  <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} className={INPUT_CLS} placeholder="Juan Pérez" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={INPUT_CLS} placeholder="conductor@turesma.com" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Teléfono</label>
                  <input value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} className={INPUT_CLS} placeholder="099 123 4567" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tipo de licencia</label>
                  <select value={form.licencia_tipo} onChange={e => setForm(p => ({ ...p, licencia_tipo: e.target.value }))} className={INPUT_CLS}>
                    <option value="">Selecciona tipo</option>
                    {LIC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Estado del conductor</label>
                  <select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))} className={INPUT_CLS}>
                    {ESTADO_OPTIONS.map(estado => <option key={estado} value={estado}>{estado.replace("_", " ")}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Foto del conductor</label>
                  <div className="relative rounded-2xl border-2 border-dashed border-slate-200 p-3 bg-slate-50">
                    <input type="file" accept="image/*" onChange={e => handleDriverPhotoUpload(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    <div className="flex items-center gap-3">
                      <UploadCloud className="text-slate-400" />
                      <div>
                        <p className="text-xs font-bold text-slate-500">Sube una foto del conductor (rostro claro)</p>
                        <p className="text-[10px] text-slate-400">Formato JPG/PNG, máximo 5MB</p>
                      </div>
                    </div>
                    {uploadingPhoto && <Loader2 className="animate-spin absolute right-3 top-3 text-[#E31E24]" size={16} />}
                    {form.foto_conductor && (
                      <Image src={form.foto_conductor} alt="Conductor" width={96} height={96} unoptimized className="mt-3 w-24 h-24 object-cover rounded-md" />
                    )}
                  </div>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">
                    {editingId ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña *"}
                  </label>
                  <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} className={INPUT_CLS} placeholder="••••••••" required={!editingId} minLength={6} />
                </div>
              </div>

              {err && <p className="text-red-600 text-sm font-bold">{err}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-3 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest hover:border-slate-300 transition-all">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 py-3 rounded-2xl bg-[#E31E24] text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-red-200">
                  {editingId ? "Guardar Cambios" : "Registrar Conductor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
