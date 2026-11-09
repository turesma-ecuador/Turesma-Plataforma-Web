"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import {
  deleteAdminUser,
  listAdminUsers,
  saveAdminUser,
} from "../../../lib/admin-users";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { WhatsAppButton } from "../../../components/whatsapp-button";
import { useConfirm } from "../../../components/confirm-dialog";
import { descargarExcel } from "../../../lib/download";
import {
  Users, Plus, X, Search, Loader2, Trash2,
  Edit3, Eye, ShoppingCart, DollarSign, Mail, FileText, FileSpreadsheet, CalendarPlus,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Cliente = {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  cedula?: string | null;
  tipo_identificacion?: "cedula" | "pasaporte" | "ruc" | null;
  imagen_url?: string | null;
  pending_email?: string | null;
  email_verified_at?: string | null;
  activo: boolean;
  creado_en: string;
  total_reservas?: number;
  total_gastado?: number;
};

type ReservaCliente = {
  id: number; origen?: string | null; destino?: string | null;
  fecha_reserva?: string | null; num_personas?: number; total?: number;
  estado?: string; vehiculo_placa?: string | null; conductor_nombre?: string | null;
};

const INPUT = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";

const EMPTY: Partial<Cliente> = { nombre: "", email: "", telefono: "", tipo_identificacion: "cedula", cedula: "", imagen_url: null };

export default function AdminClientesPage() {
  const { user, checkingSession } = useAdminGuard();
  const puedeRecuperarCorreo = user?.rol === "admin";
  const confirmar = useConfirm();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [detalle, setDetalle] = useState<Cliente | null>(null);
  const [recuperacionCorreo, setRecuperacionCorreo] = useState<Cliente | null>(null);
  const [correoNuevo, setCorreoNuevo] = useState("");
  const [motivoCambioCorreo, setMotivoCambioCorreo] = useState("");
  const [identidadConfirmada, setIdentidadConfirmada] = useState(false);
  const [procesandoCorreo, setProcesandoCorreo] = useState(false);
  const [reenviandoVerificacion, setReenviandoVerificacion] = useState(false);
  const [detalleReservas, setDetalleReservas] = useState<ReservaCliente[]>([]);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [form, setForm] = useState<Partial<Cliente>>(EMPTY);
  const [formPass, setFormPass] = useState("");
  const [formConfirmPass, setFormConfirmPass] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [exportandoExcel, setExportandoExcel] = useState(false);
  const [reenviandoFacturaId, setReenviandoFacturaId] = useState<number | null>(null);
  const openDetalle = async (c: Cliente) => {
    setDetalle(c); setDetalleReservas([]);
    setLoadingDetalle(true);
    try {
      const res = await fetch(`${API}/api/admin/reservas?usuario_id=${c.id}`, { headers: getAuthHeaders() });
      const data = res.ok ? await res.json() : [];
      const arr = Array.isArray(data) ? data : (data?.data ?? []);
      setDetalleReservas(arr.filter((r: any) => r.usuario_id === c.id));
    } catch { /* silencio */ }
    finally { setLoadingDetalle(false); }
  };

  const reenviarFactura = async (reservaId: number) => {
    setReenviandoFacturaId(reservaId);
    setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/reservas/${reservaId}/factura/reenviar`, {
        method: "POST", headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo reenviar la factura");
      setMsg(data.message || "Factura reenviada correctamente");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo reenviar la factura");
    } finally {
      setReenviandoFacturaId(null);
    }
  };

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      // Cargamos usuarios con rol cliente
      const raw = await listAdminUsers("cliente");
      // Para cada cliente, intentamos obtener sus reservas
      const clientesConStats = await Promise.all(
        raw
          .filter((u) => u.rol === "cliente")
          .map(async (u) => {
            try {
              const rRes = await fetch(`${API}/api/admin/reservas?usuario_id=${u.id}`, { headers: getAuthHeaders() });
              const reservas: any[] = rRes.ok ? await rRes.json() : [];
              const arr = Array.isArray(reservas) ? reservas : (reservas as any).data ?? [];
              return {
                ...u,
                total_reservas: arr.length,
                total_gastado: arr
                  .filter((r: any) => r.estado !== "cancelada")
                  .reduce((s: number, r: any) => s + Number(r.total || 0), 0),
              };
            } catch {
              return { ...u, total_reservas: 0, total_gastado: 0 };
            }
          })
      );
      setClientes(clientesConStats);
    } catch {
      setErr("Error al cargar clientes");
    } finally {
      setLoading(false);
    }
  };

  const abrirRecuperacionCorreo = (cliente: Cliente) => {
    setDetalle(null);
    setRecuperacionCorreo(cliente);
    setCorreoNuevo(cliente.pending_email || "");
    setMotivoCambioCorreo("");
    setIdentidadConfirmada(false);
    setErr("");
    setMsg("");
  };

  const handleCambiarCorreo = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!recuperacionCorreo) return;
    setProcesandoCorreo(true);
    setErr("");
    setMsg("");
    try {
      const response = await fetch(`${API}/api/admin/usuarios/${recuperacionCorreo.id}/correo`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          email: correoNuevo,
          motivo: motivoCambioCorreo,
          identidad_confirmada: identidadConfirmada,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo iniciar la recuperación");
      const delivery = [
        data.verification_sent ? "enlace enviado al correo nuevo" : "no se pudo enviar el enlace",
        data.old_email_notified ? "aviso enviado al correo anterior" : "no se pudo enviar aviso al correo anterior",
        data.delivery_audit_saved ? "" : "no se pudo guardar el resultado de los envíos en la auditoría",
      ].filter(Boolean).join("; ");
      setMsg(`${data.message} ${delivery}.`);
      setRecuperacionCorreo(null);
      await load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo iniciar la recuperación");
    } finally {
      setProcesandoCorreo(false);
    }
  };

  const reenviarVerificacionCorreo = async (cliente: Cliente) => {
    setReenviandoVerificacion(true);
    setErr("");
    setMsg("");
    try {
      const response = await fetch(`${API}/api/admin/usuarios/${cliente.id}/correo/verificacion`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo reenviar la verificación");
      setMsg(`${data.message || "Enlace de verificación reenviado"}${data.delivery_audit_saved ? "" : " No se pudo guardar el resultado del envío en la auditoría."}`);
      await load();
      setDetalle((current) => current?.id === cliente.id ? { ...current, pending_email: cliente.pending_email } : current);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo reenviar la verificación");
    } finally {
      setReenviandoVerificacion(false);
    }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const openNew = () => { setForm(EMPTY); setFormPass(""); setFormConfirmPass(""); setEditId(null); setModal(true); };
  const openEdit = (c: Cliente) => {
    setForm({ nombre: c.nombre, email: c.email, telefono: c.telefono ?? "", tipo_identificacion: c.tipo_identificacion ?? "cedula", cedula: c.cedula ?? "", imagen_url: c.imagen_url ?? null });
    setFormPass("");
    setFormConfirmPass("");
    setEditId(c.id);
    setModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");

    // La contraseña es obligatoria al crear (el cliente la usará para ingresar).
    if (!editId && (!formPass || formPass.length < 6)) {
      setErr("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (formPass && formPass !== formConfirmPass) {
      setErr("Las contraseñas no coinciden");
      return;
    }

    setSaving(true);
    try {
      await saveAdminUser(editId, {
        nombre: form.nombre || "",
        email: form.email || "",
        telefono: form.telefono || "",
        cedula: form.cedula || "",
        tipo_identificacion: form.tipo_identificacion || "cedula",
        imagen_url: form.imagen_url || null,
        rol: "cliente",
        ...(!editId ? { password: formPass } : {}),
      });
      setMsg(editId
        ? "Cliente actualizado"
        : `Cliente creado. Ingresa con el correo ${form.email} y la contraseña asignada.`);
      setModal(false);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSaving(false); }
  };

  const handleFotoUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingFoto(true);
    setErr("");
    try {
      const body = new FormData();
      body.append("imagen", file);
      const response = await fetch(`${API}/api/auth/upload-perfil`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "No se pudo subir la foto");
      setForm((current) => ({ ...current, imagen_url: data.imageUrl }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setUploadingFoto(false);
    }
  };

  const exportarExcel = async () => {
    setExportandoExcel(true);
    setErr("");
    const result = await descargarExcel(
      "/api/admin/reportes/exportar-csv?tipo=clientes&formato=xlsx",
      "reporte_clientes.xlsx"
    );
    if (!result.ok) setErr(result.error || "No se pudo exportar");
    setExportandoExcel(false);
  };

  const handleDelete = async (id: number) => {
    if (!(await confirmar({ title: "Eliminar cliente", message: "¿Eliminar este cliente?", confirmText: "Eliminar", tone: "danger" }))) return;
    try {
      await deleteAdminUser(id);
      setMsg("Cliente eliminado");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
  };

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={32} /></div>;

  const filtrados = clientes.filter((c) =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalGastado = clientes.reduce((s, c) => s + (c.total_gastado ?? 0), 0);
  const totalReservas = clientes.reduce((s, c) => s + (c.total_reservas ?? 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex justify-end gap-3">
        <button onClick={exportarExcel} disabled={exportandoExcel} className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
          {exportandoExcel ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Excel con diseño
        </button>
        <button onClick={openNew} className="flex items-center gap-2 bg-[#E31E24] hover:bg-[#c0181e] text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/30">
          <Plus size={14} /> Nuevo Cliente
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">Total Clientes</p>
          <p className="text-3xl sm:text-4xl font-black text-blue-700 mt-1">{clientes.length}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-amber-400 tracking-widest">Total Reservas</p>
          <p className="text-3xl sm:text-4xl font-black text-amber-700 mt-1">{totalReservas}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Total Facturado</p>
          <p className="text-3xl font-black text-emerald-700 mt-1">
            ${totalGastado.toLocaleString("es-EC", { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}

      {/* BÚSQUEDA */}
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3">
        <Search size={16} className="text-slate-400" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="flex-1 text-sm font-bold outline-none text-slate-700 bg-transparent placeholder:font-normal placeholder:text-slate-400"
        />
      </div>

      {/* TABLA */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
        {loading ? (
          <div className="flex items-center justify-center h-56"><Loader2 className="animate-spin text-[#E31E24]" size={32} /></div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-56 gap-3">
            <Users size={42} className="text-slate-200" />
            <p className="text-sm font-black uppercase text-slate-300 italic">Sin clientes registrados</p>
          </div>
        ) : (
          <>
          {/* MÓVIL: tarjetas */}
          <div className="lg:hidden divide-y divide-slate-100">
            {filtrados.map((c) => (
              <div key={c.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {c.imagen_url ? (
                      <Image src={c.imagen_url} alt={c.nombre} width={44} height={44} unoptimized className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-[#E31E24] flex items-center justify-center text-white font-black text-sm shrink-0">
                        {c.nombre.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 text-sm truncate">{c.nombre}</p>
                      <p className="text-[11px] text-slate-400 truncate">{c.email}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black border ${c.activo ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                    {c.activo ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5"><ShoppingCart size={13} className="text-blue-500" /> {c.total_reservas ?? 0} reservas</span>
                  <span className="flex items-center gap-1.5"><DollarSign size={13} className="text-emerald-500" /> ${(c.total_gastado ?? 0).toLocaleString("es-EC", { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex gap-2 pt-1 items-center">
                  <WhatsAppButton telefono={c.telefono} title={`WhatsApp de ${c.nombre}`} mensaje={`Hola ${c.nombre}, le saludamos de Turesma S.A.`} />
                  <Link href={`/admin/reservas?usuario_id=${c.id}`} className="flex items-center justify-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-black uppercase text-[#E31E24]" aria-label={`Crear reserva para ${c.nombre}`}>
                    <CalendarPlus size={14} /> Reserva
                  </Link>
                  <button onClick={() => openDetalle(c)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-black uppercase text-blue-600 bg-blue-50 rounded-lg"><Eye size={14} /> Ver</button>
                  <button onClick={() => openEdit(c)} className="p-2 rounded-lg bg-slate-100 text-slate-600" aria-label="Editar"><Edit3 size={16} /></button>
                  <button onClick={() => handleDelete(c.id)} className="p-2 rounded-lg bg-red-50 text-red-500" aria-label="Eliminar"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
          {/* ESCRITORIO: tabla */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-[700px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {["Cliente", "Email", "Reservas", "Facturado", "Estado", "Acciones"].map((h) => (
                    <th key={h} className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtrados.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {c.imagen_url ? (
                          <Image src={c.imagen_url} alt={c.nombre} width={36} height={36} unoptimized className="w-9 h-9 rounded-xl object-cover border border-slate-200" />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-[#E31E24] flex items-center justify-center text-white font-black text-sm">
                            {c.nombre.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-black text-slate-800 text-sm">{c.nombre}</p>
                          <p className="text-[10px] text-slate-400">Registrado: {new Date(c.creado_en).toLocaleDateString("es-EC")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{c.email}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <ShoppingCart size={13} className="text-blue-500" />
                        <span className="font-black text-slate-700">{c.total_reservas ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <DollarSign size={13} className="text-emerald-500" />
                        <span className="font-black text-slate-700">
                          ${(c.total_gastado ?? 0).toLocaleString("es-EC", { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black border ${c.activo ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <WhatsAppButton telefono={c.telefono} title={`WhatsApp de ${c.nombre}`} mensaje={`Hola ${c.nombre}, le saludamos de Turesma S.A.`} />
                        <Link href={`/admin/reservas?usuario_id=${c.id}`} className="rounded-xl bg-red-50 p-2 text-[#E31E24] hover:bg-red-100 transition-colors" aria-label={`Crear reserva para ${c.nombre}`} title="Crear reserva">
                          <CalendarPlus size={14} />
                        </Link>
                        <button onClick={() => openDetalle(c)} className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                          <Eye size={14} />
                        </button>
                        <button onClick={() => openEdit(c)} className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => handleDelete(c.id)} className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
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

      {/* MODAL CREAR / EDITAR */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border-b-8 border-[#E31E24] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black uppercase italic tracking-tight">{editId ? "Editar Cliente" : "Nuevo Cliente"}</h3>
              <button onClick={() => setModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Nombre completo</label>
                <input className={INPUT} required value={form.nombre ?? ""} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. María García" />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Email</label>
                <input className={INPUT} type="email" required disabled={Boolean(editId)} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@ejemplo.com" />
                {editId && <p className="mt-1 text-[10px] text-slate-500">Para cambiar el correo, usa la recuperación desde el detalle del cliente. El nuevo correo deberá verificarse.</p>}
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Teléfono</label>
                <input className={INPUT} required value={form.telefono ?? ""} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="0999999999" />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Tipo de identificación</label>
                <select className={INPUT} value={form.tipo_identificacion ?? "cedula"} onChange={(e) => setForm({ ...form, tipo_identificacion: e.target.value as NonNullable<Cliente["tipo_identificacion"]>, cedula: "" })}>
                  <option value="cedula">Cédula ecuatoriana</option>
                  <option value="pasaporte">Pasaporte</option>
                  <option value="ruc">RUC ecuatoriano</option>
                </select>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">
                  {form.tipo_identificacion === "cedula" ? "Número de cédula" : form.tipo_identificacion === "ruc" ? "Número de RUC" : "Número de pasaporte"}
                </label>
                <input className={INPUT} required maxLength={form.tipo_identificacion === "cedula" ? 10 : form.tipo_identificacion === "ruc" ? 13 : 20} inputMode={form.tipo_identificacion === "pasaporte" ? "text" : "numeric"} value={form.cedula ?? ""} onChange={(e) => setForm({ ...form, cedula: form.tipo_identificacion === "pasaporte" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) : e.target.value.replace(/\D/g, "").slice(0, form.tipo_identificacion === "cedula" ? 10 : 13) })} placeholder={form.tipo_identificacion === "cedula" ? "10 dígitos" : form.tipo_identificacion === "ruc" ? "13 dígitos" : "5 a 20 letras o números"} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Foto de perfil (opcional)</label>
                <input type="file" accept="image/*" disabled={uploadingFoto} onChange={(e) => handleFotoUpload(e.target.files?.[0] || null)} className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-red-50 file:px-3 file:py-2 file:font-bold file:text-[#E31E24]" />
                {uploadingFoto && <p className="mt-1 text-[10px] font-bold text-slate-400">Subiendo foto…</p>}
              </div>
              {!editId && (
                <>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Contraseña</label>
                    <input
                      className={INPUT}
                      type="password"
                      required
                      value={formPass}
                      onChange={(e) => setFormPass(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">El cliente ingresará con su correo y esta contraseña. Compártesela.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Confirmar contraseña</label>
                    <input className={INPUT} type="password" required value={formConfirmPass} onChange={(e) => setFormConfirmPass(e.target.value)} placeholder="Repite la contraseña" />
                  </div>
                </>
              )}
              {err && <p className="text-red-600 text-xs font-bold">{err}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-sm font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className="flex-1 py-3 rounded-xl bg-[#E31E24] text-white text-sm font-black uppercase tracking-wide hover:bg-[#c0181e] disabled:opacity-60 transition-all shadow-lg shadow-red-600/20">
                  {saving ? "Guardando…" : editId ? "Actualizar" : "Crear Cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {recuperacionCorreo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <form onSubmit={handleCambiarCorreo} className="my-4 w-full max-w-lg space-y-4 rounded-3xl border-b-8 border-[#E31E24] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black uppercase italic">Recuperar correo del cliente</h3>
                <p className="mt-1 text-xs text-slate-500">{recuperacionCorreo.nombre} · correo actual: {recuperacionCorreo.email}</p>
              </div>
              <button type="button" onClick={() => setRecuperacionCorreo(null)} className="rounded-xl p-2 hover:bg-slate-100" aria-label="Cerrar"><X size={18} /></button>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              Confirma la identidad del titular antes de continuar. El correo actual no cambiará hasta que el cliente verifique el enlace enviado al nuevo correo. La acción quedará registrada y se intentará avisar al correo anterior.
            </div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Nuevo correo
              <input className={`${INPUT} mt-1.5`} type="email" required maxLength={100} value={correoNuevo} onChange={(event) => setCorreoNuevo(event.target.value)} placeholder="cliente@ejemplo.com" />
            </label>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Motivo de la recuperación
              <textarea className={`${INPUT} mt-1.5 normal-case`} required minLength={8} maxLength={500} rows={3} value={motivoCambioCorreo} onChange={(event) => setMotivoCambioCorreo(event.target.value)} placeholder="Indica cómo confirmaste la identidad y por qué solicita el cambio." />
            </label>
            <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
              <input className="mt-0.5" type="checkbox" required checked={identidadConfirmada} onChange={(event) => setIdentidadConfirmada(event.target.checked)} />
              Confirmo que verifiqué la identidad del titular por un medio confiable.
            </label>
            {err && <p className="text-xs font-bold text-red-600">{err}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setRecuperacionCorreo(null)} className="flex-1 rounded-xl border-2 border-slate-200 py-3 text-sm font-black uppercase text-slate-600">Cancelar</button>
              <button type="submit" disabled={procesandoCorreo || !identidadConfirmada} className="flex-1 rounded-xl bg-[#E31E24] py-3 text-sm font-black uppercase text-white disabled:opacity-50">
                {procesandoCorreo ? "Procesando…" : "Enviar verificación"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL DETALLE */}
      {detalle && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 sm:p-8 border-b-8 border-blue-500 my-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-black uppercase italic tracking-tight">Detalle Cliente</h3>
              <button onClick={() => setDetalle(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-4 mb-5">
              {detalle.imagen_url ? (
                <Image src={detalle.imagen_url} alt={detalle.nombre} width={64} height={64} unoptimized className="w-16 h-16 rounded-2xl object-cover border-2 border-blue-200" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-[#E31E24] flex items-center justify-center text-white font-black text-2xl">{detalle.nombre.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="min-w-0">
                <p className="font-black text-lg text-slate-800 truncate">{detalle.nombre}</p>
                <p className="text-sm text-slate-500 truncate">{detalle.email}</p>
                {detalle.telefono && <p className="text-xs text-slate-400">{detalle.telefono}</p>}
              </div>
            </div>

            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-700">Correo de la cuenta</p>
                  {detalle.pending_email ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700">Pendiente de verificar: {detalle.pending_email}</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">{detalle.email_verified_at ? "Verificado" : "Sin verificar"}</p>
                  )}
                </div>
                {puedeRecuperarCorreo && detalle.pending_email && (
                  <button type="button" onClick={() => reenviarVerificacionCorreo(detalle)} disabled={reenviandoVerificacion}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 disabled:opacity-50">
                    {reenviandoVerificacion ? "Enviando…" : "Reenviar enlace"}
                  </button>
                )}
              </div>
              {puedeRecuperarCorreo && <button type="button" onClick={() => abrirRecuperacionCorreo(detalle)}
                className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[10px] font-black uppercase text-blue-700 hover:bg-blue-100">
                Recuperar / cambiar correo
              </button>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-amber-700">{detalle.total_reservas ?? 0}</p>
                <p className="text-[10px] font-black uppercase text-amber-400 mt-1">Reservas</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-700">${(detalle.total_gastado ?? 0).toLocaleString()}</p>
                <p className="text-[10px] font-black uppercase text-emerald-400 mt-1">Facturado</p>
              </div>
            </div>

            {/* RESERVAS REALES CON # Y FACTURA */}
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1"><FileText size={12} /> Reservas del cliente</p>
            {loadingDetalle ? (
              <div className="flex justify-center py-6"><Loader2 className="animate-spin text-[#E31E24]" size={24} /></div>
            ) : detalleReservas.length === 0 ? (
              <p className="text-center text-xs text-slate-300 font-black uppercase italic py-6">Sin reservas registradas</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {detalleReservas.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800">Reserva #{String(r.id).padStart(6, "0")}</p>
                      <p className="text-[10px] text-slate-400 truncate">{r.origen || "—"} → {r.destino || "—"} · {r.fecha_reserva ? new Date(r.fecha_reserva).toLocaleDateString("es-EC") : "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-black text-emerald-600">${Number(r.total || 0).toFixed(0)}</span>
                      <button onClick={() => reenviarFactura(r.id)} disabled={reenviandoFacturaId === r.id} className="p-2 rounded-lg bg-[#0b0f1a] text-white hover:bg-slate-700 transition-colors disabled:opacity-60" title="Reenviar factura al correo">
                        {reenviandoFacturaId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-slate-400 text-center mt-4">Registrado: {new Date(detalle.creado_en).toLocaleDateString("es-EC")}</p>
          </div>
        </div>
      )}

    </div>
  );
}
