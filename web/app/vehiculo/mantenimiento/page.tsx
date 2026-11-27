"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { FormEvent, useEffect, useState } from "react";
import {
  Wrench, Plus, Loader2, Bus, Calendar, DollarSign,
  CheckCircle2, X, FileText, ClipboardList, Gauge,
  AlertTriangle, Clock, ChevronDown, ChevronUp, UserCircle2,
} from "lucide-react";
import { getAuthHeaders, getStoredUser, handleUnauthorized } from "../../../lib/session";

const API = API_BASE_URL;

type Vehiculo = {
  id: number; placa: string; modelo?: string | null; tipo?: string | null;
  kilometraje?: number | null;
  fecha_proximo_mantenimiento?: string | null;
  proximo_km_mantenimiento?: number | null;
};
type Mant = {
  id: number; tipo: string; descripcion?: string | null;
  fecha_realizada?: string | null; fecha_programada?: string | null;
  costo?: number | null; estado: string; tecnico?: string | null; observaciones?: string | null;
  kilometraje?: number | null; conductor_usuario_id?: number | null;
};
type Indisponibilidad = {
  id: number; vehiculo_id: number; tipo: "preventivo" | "correctivo" | "otro";
  urgente: boolean; fecha_inicio: string; fecha_fin: string | null;
  hora_inicio: string | null; hora_fin: string | null; motivo: string;
  estado: "activa" | "cerrada"; creado_por_nombre?: string;
};
type Proximo = {
  fecha_proximo_mantenimiento: string | null;
  proximo_km_mantenimiento: number | null;
  dias_restantes: number | null;
  km_restantes: number | null;
  urgencia: "vencido" | "urgente" | "proximo" | "programado";
};

const TIPOS = ["preventivo", "correctivo", "cambio_aceite", "frenos", "llantas", "motor", "revision_general", "otro"];
const INPUT = "w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white";

const URGENCIA_STYLE: Record<string, { bg: string; text: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; }> = {
  vencido: { bg: "bg-red-50 border-red-200", text: "text-red-600", label: "Vencido", icon: AlertTriangle },
  urgente: { bg: "bg-amber-50 border-amber-200", text: "text-amber-600", label: "Urgente", icon: Clock },
  proximo: { bg: "bg-blue-50 border-blue-200", text: "text-blue-600", label: "Próximo", icon: Calendar },
  programado: { bg: "bg-slate-50 border-slate-200", text: "text-slate-500", label: "Programado", icon: Calendar },
};

export default function ConductorMantenimientoPage() {
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [items, setItems] = useState<Mant[]>([]);
  const [proximo, setProximo] = useState<Proximo | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [showProgramar, setShowProgramar] = useState(false);
  const [indisponibilidades, setIndisponibilidades] = useState<Indisponibilidad[]>([]);

  const [form, setForm] = useState({
    tipo: "preventivo", descripcion: "",
    fecha_realizada: new Date().toISOString().slice(0, 10),
    costo: "", observaciones: "", kilometraje: "",
    proxima_fecha: "", proximo_km: "", cumple_programado: true,
  });

  const user = getStoredUser();
  const userId = user?.id;

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [res, availabilityRes] = await Promise.all([
        fetch(`${API}/api/conductor/${userId}/mantenimiento`, { headers: getAuthHeaders() }),
        fetch(`${API}/api/conductor/${userId}/indisponibilidades-mantenimiento`, { headers: getAuthHeaders() }),
      ]);
      if (handleUnauthorized(res.status) || handleUnauthorized(availabilityRes.status)) return;
      if (res.ok) {
        const data = await res.json();
        setVehiculo(data.vehiculo || null);
        setItems(Array.isArray(data.mantenimientos) ? data.mantenimientos : []);
        setProximo(data.proximo || null);
      }
      if (availabilityRes.ok) {
        const data = await availabilityRes.json();
        setIndisponibilidades(Array.isArray(data) ? data : []);
      } else {
        const data = await availabilityRes.json().catch(() => ({}));
        throw new Error(data?.error || "No se pudieron cargar los avisos de disponibilidad");
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo cargar la información de mantenimiento");
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load();   }, [userId]);

  const openModal = () => {
    setForm({
      tipo: "preventivo", descripcion: "",
      fecha_realizada: new Date().toISOString().slice(0, 10),
      costo: "", observaciones: "",
      kilometraje: vehiculo?.kilometraje ? String(vehiculo.kilometraje) : "",
      proxima_fecha: "", proximo_km: "", cumple_programado: true,
    });
    setShowProgramar(false);
    setErr(""); setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg(""); setSaving(true);
    try {
      const res = await fetch(`${API}/api/conductor/${userId}/mantenimiento`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          ...form,
          costo: Number(form.costo) || 0,
          kilometraje: Number(form.kilometraje) || 0,
          proximo_km: form.proximo_km ? Number(form.proximo_km) : null,
          proxima_fecha: form.proxima_fecha || null,
          cumple_programado: form.cumple_programado,
        }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo registrar");
      setMsg("Mantenimiento registrado correctamente");
      setModalOpen(false);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSaving(false); }
  };

  const totalGasto = items.reduce((s, m) => s + (Number(m.costo) || 0), 0);
  const urgStyle = proximo ? URGENCIA_STYLE[proximo.urgencia] : null;

  if (loading) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {vehiculo && (
        <div className="flex justify-end">
          <button onClick={openModal}
            className="flex items-center gap-2 bg-[#E31E24] hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
            <Plus size={16} /> Registrar mantenimiento
          </button>
        </div>
      )}

      {msg &&<div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}

      {!vehiculo ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-3xl p-10 text-center">
          <Bus size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="font-black text-slate-400 uppercase italic text-sm">No tienes vehículo asignado</p>
          <p className="text-xs text-slate-400 mt-1">El administrador debe asignarte un vehículo para registrar mantenimientos.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Registros</p>
              <p className="text-3xl font-black italic tracking-tighter text-slate-900 mt-1">{items.length}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Gasto total</p>
              <p className="text-3xl font-black italic tracking-tighter text-[#E31E24] mt-1">${totalGasto.toFixed(0)}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><Gauge size={11} /> Kilometraje actual</p>
                <p className="text-2xl font-black italic tracking-tighter text-slate-900 mt-1">{(vehiculo.kilometraje || 0).toLocaleString()} km</p>
              </div>
            </div>
          </div>

          {/* PRÓXIMO SERVICIO PROGRAMADO */}
          {proximo && urgStyle ? (
            <div className={`rounded-2xl p-4 border-2 ${urgStyle.bg} flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between`}>
              <div className="flex items-start gap-3 min-w-0">
                <urgStyle.icon size={20} className={`${urgStyle.text} flex-shrink-0 mt-0.5`} />
                <div className="min-w-0">
                  <p className={`text-xs font-black uppercase tracking-widest ${urgStyle.text}`}>{urgStyle.label} · Próximo servicio</p>
                  <p className="text-sm font-bold text-slate-700 mt-1">
                    {proximo.fecha_proximo_mantenimiento && (
                      <>Antes del {new Date(proximo.fecha_proximo_mantenimiento).toLocaleDateString("es-EC")}
                        {proximo.dias_restantes !== null && (proximo.dias_restantes >= 0 ? ` (en ${proximo.dias_restantes} días)` : ` (vencido hace ${Math.abs(proximo.dias_restantes)} días)`)}
                      </>
                    )}
                    {proximo.fecha_proximo_mantenimiento && proximo.proximo_km_mantenimiento ? " · " : ""}
                    {proximo.proximo_km_mantenimiento && (
                      <>a los {proximo.proximo_km_mantenimiento.toLocaleString()} km
                        {proximo.km_restantes !== null && (proximo.km_restantes >= 0 ? ` (faltan ${proximo.km_restantes.toLocaleString()} km)` : ` (excedido por ${Math.abs(proximo.km_restantes).toLocaleString()} km)`)}
                      </>
                    )}
                  </p>
                </div>
              </div>
              {vehiculo && (
                <button onClick={openModal}
                  className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0">
                  <CheckCircle2 size={14} /> Ya lo hice
                </button>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
              <Calendar size={16} className="text-slate-300 flex-shrink-0" />
              <p className="text-xs font-bold text-slate-400">No hay un próximo servicio programado. Al registrar un mantenimiento puedes indicar cuándo o a qué kilometraje toca el siguiente.</p>
            </div>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">Disponibilidad por mantenimiento</h2>
                <p className="mt-1 text-xs text-slate-500">Consulta los bloqueos registrados por Administración. Si detectas una falla o no puedes operar, informa a Administración por llamada o WhatsApp para que gestione el bloqueo.</p>
              </div>
            </div>
            {err && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{err}</p>}
            {indisponibilidades.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {indisponibilidades.map(item => (
                  <li key={item.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 ${item.estado === "activa" ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase text-slate-800">
                        {item.urgente ? "Urgencia correctiva" : `Mantenimiento ${item.tipo}`} · {item.estado === "activa" ? "No disponible" : "Cerrado"}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">{item.motivo}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-500">
                        {new Date(`${item.fecha_inicio}T00:00:00`).toLocaleDateString("es-EC")}
                        {item.fecha_fin ? ` – ${new Date(`${item.fecha_fin}T00:00:00`).toLocaleDateString("es-EC")}` : " – hasta volver a estar operativo"}
                        {item.hora_inicio ? ` · ${item.hora_inicio.slice(0, 5)}–${item.hora_fin?.slice(0, 5)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-xs text-slate-400">Todavía no hay avisos de indisponibilidad.</p>}
          </section>

          {/* LISTA */}
          {items.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center shadow-sm">
              <ClipboardList size={36} className="text-slate-200 mx-auto mb-3" />
              <p className="font-black text-slate-300 uppercase italic text-sm">Sin mantenimientos registrados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map(m => {
                const esMio = m.conductor_usuario_id != null && m.conductor_usuario_id === userId;
                return (
                  <div key={m.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-amber-50 p-2.5 rounded-xl flex-shrink-0"><Wrench size={16} className="text-amber-500" /></div>
                        <div className="min-w-0">
                          <p className="font-black text-slate-800 uppercase text-sm capitalize">{m.tipo.replace(/_/g, " ")}</p>
                          {m.descripcion && <p className="text-xs text-slate-500 truncate">{m.descripcion}</p>}
                        </div>
                      </div>
                      {Number(m.costo) > 0 && <p className="font-black text-[#E31E24] flex-shrink-0">${Number(m.costo).toFixed(2)}</p>}
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-400 font-bold flex-wrap">
                      <span className="flex items-center gap-1"><Calendar size={11} />{new Date(m.fecha_realizada || m.fecha_programada || "").toLocaleDateString("es-EC")}</span>
                      {m.kilometraje ? <span className="flex items-center gap-1"><Gauge size={11} />{Number(m.kilometraje).toLocaleString()} km</span> : null}
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 border ${esMio ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
                        <UserCircle2 size={11} />{esMio ? "Tú" : (m.tecnico || "Otro conductor")}
                      </span>
                      {m.observaciones && <span className="flex items-center gap-1 truncate"><FileText size={11} />{m.observaciones}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-[2rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 my-4">
            <div className="bg-slate-900 p-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[#E31E24] p-2 rounded-xl"><Wrench size={18} /></div>
                <h2 className="text-base font-black italic tracking-tighter uppercase">Registrar Mantenimiento</h2>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tipo *</label>
                  <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))} className={INPUT}>
                    {TIPOS.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Fecha</label>
                  <input type="date" value={form.fecha_realizada} max={new Date().toISOString().slice(0, 10)} onChange={e => setForm(p => ({ ...p, fecha_realizada: e.target.value }))} className={INPUT} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><Gauge size={12} /> Kilometraje actual *</label>
                <input type="number" min="0" value={form.kilometraje} onChange={e => setForm(p => ({ ...p, kilometraje: e.target.value }))} className={INPUT} placeholder="Ej: 45000" required />
                {vehiculo?.kilometraje ? <p className="text-[10px] text-slate-400 ml-1">Último registrado: {Number(vehiculo.kilometraje).toLocaleString()} km</p> : null}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Descripción</label>
                <input value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} className={INPUT} placeholder="Ej. Cambio de aceite y filtro" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Costo ($)</label>
                <div className="relative">
                  <DollarSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="number" min="0" step="0.01" value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} className={INPUT + " pl-9"} placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Observaciones</label>
                <textarea value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} rows={2} className={INPUT + " resize-none"} placeholder="Notas adicionales..." />
              </div>

              {/* ¿ESTE SERVICIO CUMPLE EL MANTENIMIENTO PROGRAMADO? */}
              {proximo && (
                <label className="flex items-start gap-3 rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.cumple_programado}
                    onChange={e => setForm(p => ({ ...p, cumple_programado: e.target.checked }))}
                    className="mt-0.5 w-5 h-5 accent-[#E31E24] cursor-pointer"
                  />
                  <span className="text-xs text-slate-700 font-bold leading-snug">
                    Este servicio cumple el mantenimiento que estaba programado.
                    <span className="block font-medium text-slate-500 mt-0.5">Al marcarlo, el aviso se quita (o se mueve a la nueva fecha si programas el próximo abajo). Desmárcalo solo si fue un servicio extra.</span>
                  </span>
                </label>
              )}

              {/* PROGRAMAR PRÓXIMO SERVICIO (opcional) */}
              <div className="rounded-2xl border-2 border-dashed border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setShowProgramar(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 text-slate-600 text-xs font-black uppercase tracking-widest">
                  <span className="flex items-center gap-2"><Calendar size={14} /> Programar el próximo servicio (opcional)</span>
                  {showProgramar ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showProgramar && (
                  <div className="p-4 grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Próxima fecha estimada</label>
                      <input type="date" value={form.proxima_fecha} min={new Date().toISOString().slice(0, 10)} onChange={e => setForm(p => ({ ...p, proxima_fecha: e.target.value }))} className={INPUT} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Próximo kilometraje</label>
                      <input type="number" min="0" value={form.proximo_km} onChange={e => setForm(p => ({ ...p, proximo_km: e.target.value }))} className={INPUT} placeholder="Ej: 50000" />
                    </div>
                  </div>
                )}
              </div>

              {err && <p className="text-red-600 text-sm font-bold">{err}</p>}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-3 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest hover:border-slate-300 transition-all">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 py-3 rounded-2xl bg-[#E31E24] text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
