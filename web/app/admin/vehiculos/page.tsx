"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { descargarExcel } from "../../../lib/download";
import { useConfirm } from "../../../components/confirm-dialog";
import {
  Bus, Plus, Edit3, Trash2, X, Search, FileSpreadsheet,
  CheckCircle, AlertCircle, Wrench, Car,
  Users, Loader2, UploadCloud, GripVertical
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Vehiculo = {
  id: number;
  placa: string;
  tipo: string;
  modelo: string;
  capacidad: number;
  color: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  dias_servicio: number[];
  estado: string;
  activo: boolean;
  fecha_creacion: string;
  conductor_id: number | null;
  conductor_nombre: string | null;
  conductor_email: string | null;
  conductor_imagen_url: string | null;
};

type ConductorOpt = { id: number; nombre: string; email: string };

const TIPO_OPTIONS = ["van", "bus", "suv", "minibus", "sedan"];
const ESTADO_OPTIONS = ["disponible", "en_servicio", "mantenimiento", "inactivo"];
const DIAS_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const ESTADO_BADGE: Record<string, string> = {
  disponible: "bg-emerald-100 text-emerald-700 border-emerald-200",
  en_servicio: "bg-blue-100 text-blue-700 border-blue-200",
  mantenimiento: "bg-amber-100 text-amber-700 border-amber-200",
  inactivo: "bg-gray-100 text-gray-500 border-gray-200",
};

const ESTADO_ICON: Record<string, React.ReactNode> = {
  disponible: <CheckCircle size={12} />,
  en_servicio: <Bus size={12} />,
  mantenimiento: <Wrench size={12} />,
  inactivo: <AlertCircle size={12} />,
};

const INPUT_CLS = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";

const drawVehicleCrop = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  position: { x: number; y: number },
  zoom: number,
  frameWidth: number,
) => {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la vista previa");

  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const positionScale = canvas.width / frameWidth;
  context.drawImage(
    image,
    (canvas.width - width) / 2 + position.x * positionScale,
    (canvas.height - height) / 2 + position.y * positionScale,
    width,
    height,
  );
};

export default function AdminVehiculosPage() {
  const { checkingSession } = useAdminGuard();
  const confirmar = useConfirm();
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [conductores, setConductores] = useState<ConductorOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [arrastrandoId, setArrastrandoId] = useState<number | null>(null);
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [draggingCrop, setDraggingCrop] = useState(false);
  const cropDragStart = useRef({ x: 0, y: 0 });
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const cropPreviewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const image = cropImageRef.current;
    const frame = cropFrameRef.current;
    const canvas = cropPreviewRef.current;
    if (!image || !frame || !canvas || !image.complete || !image.naturalWidth) return;
    drawVehicleCrop(canvas, image, cropPosition, cropZoom, frame.clientWidth);
  }, [imageToCrop, cropPosition, cropZoom]);

  const emptyForm = {
    placa: "", tipo: "van", modelo: "", capacidad: "",
    color: "", imagen_url: "", descripcion: "",
    conductor_id: "", estado: "disponible",
    dias_servicio: [1, 2, 3, 4, 5] as number[],
  };
  const [form, setForm] = useState(emptyForm);

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const headers = getAuthHeaders();
      const [vRes, cRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/vehiculos`, { headers }),
        fetch(`${API_URL}/api/admin/conductores`, { headers }),
      ]);
      const [vehiclesData, driversData] = await Promise.all([vRes.json(), cRes.json()]);
      if (!vRes.ok || !cRes.ok) throw new Error(vehiclesData.error || driversData.error || "No se pudieron cargar los vehículos y conductores");
      setVehiculos(Array.isArray(vehiclesData) ? vehiclesData : []);
      setConductores(Array.isArray(driversData) ? driversData : []);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los vehículos. Revisa tu conexión e inténtalo otra vez.");
    }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const filtered = vehiculos.filter((v) => {
    const matchSearch = !search ||
      v.placa.toLowerCase().includes(search.toLowerCase()) ||
      v.modelo.toLowerCase().includes(search.toLowerCase()) ||
      (v.conductor_nombre || "").toLowerCase().includes(search.toLowerCase());
    const matchEstado = filtroEstado === "todos" || v.estado === filtroEstado;
    return matchSearch && matchEstado && v.activo;
  });
  const canReorder = !search && filtroEstado === "todos";

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const exportarExcel = async () => {
    setExportandoExcel(true); setErr("");
    const result = await descargarExcel("/api/admin/reportes/exportar-csv?tipo=vehiculos&formato=xlsx", "reporte_vehiculos.xlsx");
    if (!result.ok) setErr(result.error || "No se pudo exportar");
    setExportandoExcel(false);
  };

  const openEdit = (v: Vehiculo) => {
    setEditingId(v.id);
    setForm({
      placa: v.placa,
      tipo: v.tipo || "van",
      modelo: v.modelo,
      capacidad: String(v.capacidad),
      color: v.color || "",
      imagen_url: v.imagen_url || "",
      descripcion: v.descripcion || "",
      conductor_id: v.conductor_id ? String(v.conductor_id) : "",
      estado: v.estado || "disponible",
      dias_servicio: v.dias_servicio || [1, 2, 3, 4, 5],
    });
    setMsg(""); setErr("");
    setModalOpen(true);
  };

  const handleImgUpload = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Selecciona una imagen válida");
      return;
    }
    setImageToCrop(URL.createObjectURL(file));
    setCropPosition({ x: 0, y: 0 });
    setCropZoom(0.75);
    setErr("");
  };

  const uploadCroppedImage = async () => {
    if (!imageToCrop) return;
    setUploadingImg(true);
    try {
      const image = cropImageRef.current;
      const frame = cropFrameRef.current;
      if (!image || !frame || !image.complete) throw new Error("La imagen aún no está lista");

      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      drawVehicleCrop(canvas, image, cropPosition, cropZoom, frame.clientWidth);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("No se pudo procesar la imagen");
      const fd = new FormData();
      fd.append("imagen", blob, "vehiculo.jpg");
      const authToken = getAuthHeaders()["Authorization"];
      const res = await fetch(`${API_URL}/api/admin/uploads/vehiculo-imagen`, {
        method: "POST",
        body: fd,
        headers: authToken ? { Authorization: authToken } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al subir imagen");
      setForm((p) => ({ ...p, imagen_url: json.imageUrl || "" }));
      setImageToCrop(null);
    } catch { setErr("No se pudo procesar o subir la imagen"); }
    finally { setUploadingImg(false); }
  };

  const startCropDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDragStart.current = { x: event.clientX - cropPosition.x, y: event.clientY - cropPosition.y };
    setDraggingCrop(true);
  };

  const moveCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingCrop) return;
    setCropPosition({ x: event.clientX - cropDragStart.current.x, y: event.clientY - cropDragStart.current.y });
  };

  const renderVehicleCardPreview = (showCropCanvas: boolean) => {
    const previewStatus = form.estado === "disponible"
      ? "Disponible"
      : form.estado === "en_servicio"
        ? "En Servicio"
        : form.estado === "mantenimiento"
          ? "Mantenimiento"
          : "Inactivo";
    const statusColor = form.estado === "disponible"
      ? "text-green-600"
      : form.estado === "en_servicio"
        ? "text-blue-600"
        : "text-amber-600";

    return (
      <div className="w-full">
        <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Vista previa en la web principal</p>
        <div className="mx-auto flex w-full max-w-[360px] flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl">
          {showCropCanvas ? (
            <canvas ref={cropPreviewRef} width={960} height={540} className="h-56 w-full bg-slate-100 object-cover sm:h-64" />
          ) : (
            <Image
              src={form.imagen_url}
              alt={`${form.tipo || "Vehículo"} ${form.placa}`}
              width={720}
              height={512}
              sizes="(max-width: 640px) 85vw, 360px"
              unoptimized
              className="h-56 w-full object-cover sm:h-64"
            />
          )}
          <div className="flex flex-1 flex-col p-7">
            <span className="text-[10px] font-black uppercase tracking-widest text-green-600">
              {form.capacidad ? `${form.capacidad} Pasajeros` : "Transporte"}
            </span>
            <h4 className="mt-2 text-2xl font-black italic text-gray-900">
              {form.modelo || form.tipo || "Vehículo"}
            </h4>
            {form.descripcion && (
              <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">{form.descripcion}</p>
            )}
            <div className="mt-6 flex items-center justify-between border-t pt-6">
              <span className={`text-xs font-bold uppercase ${statusColor}`}>Estado: {previewStatus}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-gray-50 px-2 py-1 text-xs font-bold uppercase text-gray-400">{form.placa || "PLACA"}</span>
                <Bus size={20} className="text-[#E31E24]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");
    const payload = {
      placa: form.placa.toUpperCase(),
      tipo: form.tipo,
      modelo: form.modelo,
      capacidad: Number(form.capacidad),
      color: form.color || null,
      imagen_url: form.imagen_url || null,
      descripcion: form.descripcion || null,
      usuario_id: form.conductor_id ? Number(form.conductor_id) : null,
      estado: form.estado,
      dias_servicio: form.dias_servicio,
    };
    const url = editingId ? `${API_URL}/api/admin/vehiculos/${editingId}` : `${API_URL}/api/admin/vehiculos`;
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Error al guardar"); return; }
    setMsg(editingId ? "Vehículo actualizado correctamente" : "Vehículo registrado correctamente");
    setModalOpen(false);
    load();
  };

  const handleDelete = async (v: Vehiculo) => {
    if (!(await confirmar({ title: "Desactivar vehículo", message: `¿Desactivar el vehículo ${v.placa} — ${v.modelo}?`, confirmText: "Desactivar", tone: "danger" }))) return;
    const res = await fetch(`${API_URL}/api/admin/vehiculos/${v.id}`, { method: "DELETE", headers: getAuthHeaders() });
    if (res.ok) { setMsg("Vehículo desactivado"); load(); }
  };

  const handleDrop = async (targetId: number) => {
    if (!canReorder || arrastrandoId === null || arrastrandoId === targetId) return;

    const next = [...filtered];
    const sourceIndex = next.findIndex((v) => v.id === arrastrandoId);
    const targetIndex = next.findIndex((v) => v.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setVehiculos((current) => {
      const activeIds = new Set(next.map((v) => v.id));
      const reordered = new Map(next.map((v, index) => [v.id, index]));
      return [...current].sort((a, b) => {
        if (activeIds.has(a.id) && activeIds.has(b.id)) {
          return reordered.get(a.id)! - reordered.get(b.id)!;
        }
        return activeIds.has(a.id) ? -1 : activeIds.has(b.id) ? 1 : 0;
      });
    });
    setArrastrandoId(null);

    const res = await fetch(`${API_URL}/api/admin/vehiculos/orden`, {
      method: "PATCH",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ vehiculoIds: next.map((v) => v.id) }),
    });
    if (!res.ok) {
      setErr("No se pudo guardar el orden de los vehículos");
      load();
      return;
    }
    setMsg("Orden de vehículos actualizado");
  };

  const toggleDia = (d: number) => {
    const next = form.dias_servicio.includes(d)
      ? form.dias_servicio.filter((x) => x !== d)
      : [...form.dias_servicio, d].sort();
    setForm((p) => ({ ...p, dias_servicio: next }));
  };

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ACCIONES */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button onClick={exportarExcel} disabled={exportandoExcel} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
          {exportandoExcel ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Excel con diseño
        </button>
        <button onClick={openCreate} className="flex items-center gap-2 bg-[#E31E24] hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20">
          <Plus size={16} />
          Nuevo Vehículo
        </button>
      </div>

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Total flota", val: vehiculos.filter(v => v.activo).length, color: "text-slate-900", bg: "bg-white" },
          { label: "Disponibles", val: vehiculos.filter(v => v.activo && v.estado === "disponible").length, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "En servicio", val: vehiculos.filter(v => v.activo && v.estado === "en_servicio").length, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Mantenimiento", val: vehiculos.filter(v => v.activo && v.estado === "mantenimiento").length, color: "text-amber-600", bg: "bg-amber-50" },
        ].map((k) => (
          <div key={k.label} className={`${k.bg} rounded-2xl p-4 sm:p-5 border border-gray-100 shadow-sm`}>
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
            <p className={`text-2xl sm:text-4xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* MENSAJES */}
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><span>{loadError}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-red-700 shadow-sm">Reintentar</button></div>}

      {/* FILTROS */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="relative min-w-0 flex-1 xl:max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input aria-label="Buscar vehículos" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar placa, modelo o conductor..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-bold outline-none focus:border-[#E31E24] transition-all" />
        </div>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 xl:pb-0" role="group" aria-label="Filtrar por estado">
          {["todos", ...ESTADO_OPTIONS].map(e => (
            <button key={e} type="button" aria-pressed={filtroEstado === e} onClick={() => setFiltroEstado(e)} className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${filtroEstado === e ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
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
          <div className="flex h-64 items-center justify-center p-6 text-center text-sm font-bold text-red-700">No se pudo determinar si hay vehículos registrados.</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Bus size={48} className="text-slate-200" />
            <p className="text-sm font-black uppercase text-slate-300 italic tracking-tighter">Sin vehículos registrados</p>
          </div>
        ) : (
          <>
          {/* MÓVIL: tarjetas */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filtered.map((v) => (
              <div key={v.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {v.imagen_url ? (
                      <Image src={v.imagen_url} alt={v.placa} width={44} height={44} unoptimized className="w-11 h-11 rounded-xl object-cover border border-slate-100 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                        <Car size={20} className="text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{v.placa}</p>
                      <p className="text-[11px] text-slate-400 truncate">{v.modelo || v.tipo} · {v.capacidad} pax</p>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase border ${ESTADO_BADGE[v.estado] || ESTADO_BADGE.inactivo}`}>
                    {v.estado.replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <Users size={13} className="text-slate-400 shrink-0" />
                  {v.conductor_nombre ? <span className="truncate">{v.conductor_nombre}</span> : <span className="italic text-slate-300">Sin conductor asignado</span>}
                </div>
                {(v.dias_servicio || []).length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {(v.dias_servicio || []).map(d => (
                      <span key={d} className="text-[9px] font-black bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{DIAS_LABEL[d]}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => openEdit(v)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase text-blue-600 bg-blue-50 rounded-lg">
                    <Edit3 size={14} /> Editar
                  </button>
                  <button onClick={() => handleDelete(v)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase text-red-500 bg-red-50 rounded-lg">
                    <Trash2 size={14} /> Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* ESCRITORIO: tabla */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-[840px] w-full table-fixed text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  <th className="w-8 px-1 py-2" aria-label="Orden" />
                  <th className="w-[185px] px-1.5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vehículo</th>
                  <th className="w-[175px] px-1.5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Conductor</th>
                  <th className="w-[200px] px-1.5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Días servicio</th>
                  <th className="w-[150px] px-1.5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
                  <th className="w-[90px] px-1.5 py-2 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    draggable={canReorder}
                    onDragStart={() => canReorder && setArrastrandoId(v.id)}
                    onDragOver={(event) => canReorder && event.preventDefault()}
                    onDrop={() => handleDrop(v.id)}
                    onDragEnd={() => setArrastrandoId(null)}
                    className={`hover:bg-slate-50/80 transition-colors group ${arrastrandoId === v.id ? "opacity-40" : ""}`}
                  >
                    <td className="w-8 px-1 py-2.5">
                      <GripVertical size={16} className={canReorder ? "cursor-grab text-slate-300 active:cursor-grabbing" : "text-transparent"} />
                    </td>
                    <td className="px-1.5 py-2.5">
                      <div className="flex items-center gap-2">
                        {v.imagen_url ? (
                          <Image src={v.imagen_url} alt={v.placa} width={48} height={48} unoptimized className="h-12 w-12 shrink-0 rounded-lg object-cover border border-slate-100" />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                            <Car size={24} className="text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-base font-black italic uppercase tracking-tighter text-slate-900">{v.placa}</p>
                          <p className="max-w-[155px] truncate text-xs font-bold text-slate-600">{v.modelo || "Modelo sin especificar"}</p>
                          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{v.tipo} <span className="font-bold normal-case text-slate-400">· {v.capacidad} pax</span></p>
                        </div>
                      </div>
                    </td>
                    <td className="px-1.5 py-2.5">
                      {v.conductor_nombre ? (
                        <div className="flex min-w-0 items-center gap-2">
                          {v.conductor_imagen_url ? (
                            <Image src={v.conductor_imagen_url} alt={v.conductor_nombre} width={34} height={34} unoptimized className="h-[34px] w-[34px] shrink-0 rounded-md object-cover border border-slate-200" />
                          ) : (
                            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-[#E31E24]/10">
                              <Users size={14} className="text-[#E31E24]" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="max-w-[140px] truncate text-sm font-black text-slate-700">{v.conductor_nombre}</p>
                            <p className="max-w-[140px] truncate text-[11px] text-slate-400">{v.conductor_email}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] font-bold italic text-slate-400">Sin asignar</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5">
                      <div className="flex flex-nowrap gap-1 whitespace-nowrap">
                        {(v.dias_servicio || []).map(d => (
                          <span key={d} className="rounded bg-blue-50 px-1.5 py-1 text-center text-[11px] font-black text-blue-700">{DIAS_LABEL[d]}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-1.5 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-black uppercase border ${ESTADO_BADGE[v.estado] || ESTADO_BADGE.inactivo}`}>
                        {ESTADO_ICON[v.estado]}
                        {v.estado.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-1.5 py-2.5">
                      <div className="flex justify-center gap-0.5">
                        <button onClick={() => openEdit(v)} className="rounded-lg p-2 text-blue-500 transition-all hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500" title="Editar" aria-label={`Editar vehículo ${v.placa}`}>
                          <Edit3 size={17} />
                        </button>
                        <button onClick={() => handleDelete(v)} className="rounded-lg p-2 text-red-500 transition-all hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500" title="Eliminar" aria-label={`Eliminar vehículo ${v.placa}`}>
                          <Trash2 size={17} />
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

      {/* MODAL CREAR / EDITAR */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-[2.5rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 my-4">
            <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[#E31E24] p-2 rounded-xl"><Bus size={20} /></div>
                <h2 className="text-lg font-black italic tracking-tighter uppercase">
                  {editingId ? "Editar Vehículo" : "Registrar Nuevo Vehículo"}
                </h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-7 grid gap-5 max-h-[75vh] overflow-y-auto">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Placa *</label>
                  <input value={form.placa} onChange={e => setForm(p => ({ ...p, placa: e.target.value.toUpperCase() }))} className={INPUT_CLS} placeholder="ABC-1234" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Modelo *</label>
                  <input value={form.modelo} onChange={e => setForm(p => ({ ...p, modelo: e.target.value }))} className={INPUT_CLS} placeholder="Toyota Hiace 2022" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tipo</label>
                  <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))} className={INPUT_CLS}>
                    {TIPO_OPTIONS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Capacidad (pasajeros) *</label>
                  <input type="number" min="1" value={form.capacidad} onChange={e => setForm(p => ({ ...p, capacidad: e.target.value }))} className={INPUT_CLS} placeholder="12" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Color</label>
                  <input value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} className={INPUT_CLS} placeholder="Blanco" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Estado</label>
                  <select value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))} className={INPUT_CLS}>
                    {ESTADO_OPTIONS.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>

              {/* Conductor */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Conductor asignado</label>
                <select value={form.conductor_id} onChange={e => setForm(p => ({ ...p, conductor_id: e.target.value }))} className={INPUT_CLS}>
                  <option value="">Sin asignar</option>
                  {conductores.map(c => <option key={c.id} value={c.id}>{c.nombre} — {c.email}</option>)}
                </select>
              </div>

              {/* Imagen */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Imagen del vehículo</label>
                <div className="relative rounded-2xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-[#E31E24] transition-all cursor-pointer bg-slate-50">
                  <input type="file" accept="image/*" onChange={e => handleImgUpload(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <UploadCloud className="mx-auto text-slate-300 mb-2" size={28} />
                  <p className="text-xs font-bold text-slate-400">Haz clic para cargar foto</p>
                  {uploadingImg && <Loader2 className="animate-spin mx-auto mt-2 text-[#E31E24]" size={18} />}
                </div>
                {imageToCrop && (
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white">
                      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-300">Ajusta el encuadre</p>
                      <div
                        ref={cropFrameRef}
                        className="relative mx-auto aspect-video max-w-lg cursor-grab overflow-hidden rounded-xl bg-black active:cursor-grabbing"
                        onPointerDown={startCropDrag}
                        onPointerMove={moveCrop}
                        onPointerUp={() => setDraggingCrop(false)}
                        onPointerCancel={() => setDraggingCrop(false)}
                      >
                        <Image
                          ref={cropImageRef}
                          src={imageToCrop}
                          alt="Vista previa del encuadre"
                          fill
                          sizes="640px"
                          unoptimized
                          onLoad={(event) => {
                            const frame = cropFrameRef.current;
                            const canvas = cropPreviewRef.current;
                            if (frame && canvas) {
                              drawVehicleCrop(canvas, event.currentTarget, cropPosition, cropZoom, frame.clientWidth);
                            }
                          }}
                          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                          style={{ transform: `translate(${cropPosition.x}px, ${cropPosition.y}px) scale(${cropZoom})` }}
                        />
                        <div className="pointer-events-none absolute inset-0 border-2 border-white/70" />
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-xs text-slate-300">Zoom</span>
                        <input type="range" min="0.5" max="2" step="0.05" value={cropZoom} onChange={e => setCropZoom(Number(e.target.value))} className="w-full accent-[#E31E24]" />
                        <button type="button" onClick={uploadCroppedImage} disabled={uploadingImg} className="shrink-0 rounded-xl bg-[#E31E24] px-3 py-2 text-[10px] font-black uppercase tracking-widest disabled:opacity-60">
                          {uploadingImg ? "Subiendo..." : "Usar foto"}
                        </button>
                      </div>
                    </div>
                    {renderVehicleCardPreview(true)}
                  </div>
                )}
                {!imageToCrop && form.imagen_url && renderVehicleCardPreview(false)}
              </div>

              {/* Días de servicio */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Días de servicio</label>
                <div className="flex gap-2 flex-wrap">
                  {DIAS_LABEL.map((label, i) => (
                    <button key={i} type="button" onClick={() => toggleDia(i)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${form.dias_servicio.includes(i) ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descripción */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Descripción / Notas</label>
                <textarea value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} rows={2} className={INPUT_CLS + " resize-none"} placeholder="Observaciones del vehículo..." />
              </div>

              {err && <p className="text-red-600 text-sm font-bold">{err}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-3 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest hover:border-slate-300 transition-all">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 py-3 rounded-2xl bg-[#E31E24] text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-red-200">
                  {editingId ? "Guardar Cambios" : "Registrar Vehículo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
