"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, CreditCard, Download, FileText, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { useClienteGuard } from "../../../lib/use-cliente-guard";
import { CommunicationPanel } from "../../../components/communication-panel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const INPUT = "w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:text-slate-300";

type Group = {
  cantidad_vehiculos: string; tipo_vehiculo: string; pasajeros_por_vehiculo: string;
  fecha_servicio: string; fecha_fin: string; hora_salida: string; origen: string;
  destino: string; paradas: string; detalles: string; simultaneo: boolean;
  itinerario: Array<{ destino: string; fecha_llegada: string; dias_estadia: number; hora_salida: string }>;
};
type Request = {
  id: number; organizacion?: string | null; cantidad_vehiculos: number; estado: string;
  precio_final?: number | null; reserva_id?: number | null; respuesta_admin?: string | null;
  estado_despacho?: string | null; reserva_estado_pago?: string | null;
  service_groups?: Array<{
    cantidad_vehiculos: number; tipo_vehiculo?: string | null; pasajeros_por_vehiculo?: number | null;
    fecha_servicio?: string | null; fecha_fin?: string | null; hora_salida?: string | null;
    origen?: string | null; destino?: string | null; precio_total?: number | null;
    itinerario?: Array<{ destino: string; fecha_llegada?: string | null; dias_estadia: number; hora_salida?: string | null }>;
    incluido_en_propuesta?: boolean; motivo_no_inclusion?: string | null;
  }>;
  unidades_despacho?: Array<{
    grupo_numero: number; unidad_numero: number; estado: string;
    fecha_programada: string; fecha_fin_programada?: string | null; vehiculo_placa?: string | null;
  }>;
  creado_en: string;
};
const emptyGroup = (): Group => ({
  cantidad_vehiculos: "1", tipo_vehiculo: "", pasajeros_por_vehiculo: "",
  fecha_servicio: "", fecha_fin: "", hora_salida: "", origen: "", destino: "",
  paradas: "", detalles: "", simultaneo: false, itinerario: [],
});

export default function ClienteRequerimientoPersonalizadoPage() {
  const { user, checkingSession } = useClienteGuard();
  const [organizacion, setOrganizacion] = useState("");
  const [detalles, setDetalles] = useState("");
  const [groups, setGroups] = useState<Group[]>([emptyGroup()]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [vehicleTypesLoading, setVehicleTypesLoading] = useState(true);
  const [vehicleTypesError, setVehicleTypesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState<number | null>(null);

  const load = async () => {
    if (!user?.id) return;
    try {
      const response = await fetch(`${API}/api/requerimientos-personalizados/mios`, { headers: getAuthHeaders() });
      if (handleUnauthorized(response.status)) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar tus requerimientos");
      setRequests(Array.isArray(data) ? data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar tus requerimientos");
    } finally { setLoading(false); }
  };
  useEffect(() => { if (!checkingSession) void load(); }, [checkingSession, user?.id]);

  useEffect(() => {
    let active = true;
    const loadVehicleTypes = async () => {
      try {
        const response = await fetch(`${API}/api/usuarios/vehiculos`);
        if (!response.ok) throw new Error("No se pudieron cargar las categorías de vehículos");
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error("La respuesta de categorías de vehículos no es válida");
        const types = Array.from(new Set(data.flatMap((vehicle: unknown) => {
          if (typeof vehicle !== "object" || vehicle === null || !("tipo" in vehicle)) return [];
          const type = String(vehicle.tipo || "").trim().toLowerCase();
          return type ? [type] : [];
        })));
        if (active) setVehicleTypes(types);
      } catch (reason) {
        if (active) setVehicleTypesError(reason instanceof Error ? reason.message : "No se pudieron cargar las categorías de vehículos");
      } finally {
        if (active) setVehicleTypesLoading(false);
      }
    };
    void loadVehicleTypes();
    return () => { active = false; };
  }, []);

  const updateGroup = (index: number, patch: Partial<Group>) =>
    setGroups(current => current.map((group, i) => i === index ? { ...group, ...patch } : group));

  const acceptProposal = async (request: Request) => {
    setPayingId(request.id); setError("");
    try {
      const response = await fetch(`${API}/api/requerimientos-personalizados/${request.id}/aceptar`, {
        method: "POST", headers: getAuthHeaders(),
      });
      if (handleUnauthorized(response.status)) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo aceptar la propuesta");
      window.location.assign(`/cliente/historial?abrir_pago=${data.reserva_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo aceptar la propuesta");
    } finally { setPayingId(null); }
  };

  const downloadProforma = async (request: Request) => {
    setPayingId(request.id); setError("");
    try {
      const response = await fetch(`${API}/api/requerimientos-personalizados/${request.id}/proforma`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "No se pudo descargar la proforma");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `proforma_requerimiento_${request.id}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo descargar la proforma");
    } finally { setPayingId(null); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    const invalidStay = groups.some(group => group.itinerario.some(stop =>
      stop.dias_estadia > 0 && (
        !group.fecha_servicio
        || !group.fecha_fin
        || !stop.fecha_llegada
        || stop.fecha_llegada < group.fecha_servicio
        || stop.fecha_llegada > group.fecha_fin
      )
    ));
    if (invalidStay) {
      setError("Para indicar estadías, completa las fechas de inicio y fin del grupo y la fecha de llegada a cada destino.");
      return;
    }
    setSending(true);
    try {
      const response = await fetch(`${API}/api/requerimientos-personalizados`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          organizacion, detalles,
          grupos_servicio: groups.map(group => ({
            ...group,
            cantidad_vehiculos: Number(group.cantidad_vehiculos),
            pasajeros_por_vehiculo: group.pasajeros_por_vehiculo ? Number(group.pasajeros_por_vehiculo) : null,
          })),
        }),
      });
      if (handleUnauthorized(response.status)) return;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar el requerimiento");
      setMessage("Solicitud enviada. Administración revisará los detalles y te enviará una propuesta desde esta página.");
      setOrganizacion(""); setDetalles(""); setGroups([emptyGroup()]); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar el requerimiento");
    } finally { setSending(false); }
  };

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header data-tour-target="portal-custom-request" className="rounded-3xl bg-[#0b0f1a] p-6 text-white shadow-xl sm:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-[#E31E24] p-3"><FileText size={24} /></div>
          <div><h1 className="text-xl font-black uppercase tracking-tight sm:text-2xl">Requerimiento personalizado</h1>
            <p className="mt-2 text-sm text-slate-300">Solicita varios vehículos, rutas especiales o servicios para tu empresa. Administración lo recibirá en Cotizaciones para revisar disponibilidad y definir el precio.</p>
          </div>
        </div>
      </header>
      <form onSubmit={submit} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-xl sm:p-7">
        <div><label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Empresa u organización (opcional)</label>
          <input value={organizacion} maxLength={200} onChange={e => setOrganizacion(e.target.value)} className={INPUT} placeholder="Nombre de la empresa" /></div>
        {vehicleTypesError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{vehicleTypesError}</p>}
        {groups.map((group, index) => <section key={index} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-widest text-slate-700">Grupo {index + 1}</h2>
            {groups.length > 1 && <button type="button" onClick={() => setGroups(current => current.filter((_, i) => i !== index))} className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-red-600"><Trash2 size={13} /> Quitar</button>}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ["cantidad_vehiculos", "Cantidad de vehículos *", "number", "1"],
              ["tipo_vehiculo", "Tipo de vehículo", "select", ""],
              ["pasajeros_por_vehiculo", "Pasajeros por vehículo", "number", "Ej: 40"],
              ["fecha_servicio", "Fecha de inicio", "date", ""],
              ["fecha_fin", "Fecha final", "date", ""],
              ["hora_salida", "Hora de salida", "time", ""],
              ["origen", "Origen", "text", "Ciudad o dirección"],
              ["destino", "Destino final", "text", "Destino final del grupo"],
            ] as const).map(([field, label, type, placeholder]) => <div key={field} className="space-y-1.5 sm:col-span-1">
              <label htmlFor={`custom-${field}-${index}`} className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
              {field === "tipo_vehiculo" ? (
                <select id={`custom-${field}-${index}`} value={group.tipo_vehiculo}
                  onChange={event => updateGroup(index, { tipo_vehiculo: event.target.value })} className={INPUT + " capitalize"}>
                  <option value="">
                    {vehicleTypesLoading ? "Cargando opciones..." : vehicleTypesError ? "Opciones no disponibles" : vehicleTypes.length ? "Selecciona una opción (opcional)" : "No hay categorías disponibles"}
                  </option>
                  {vehicleTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              ) : (
                <input id={`custom-${field}-${index}`} type={type} value={group[field]} placeholder={placeholder} min={type === "number" ? 1 : undefined}
                  required={["cantidad_vehiculos", "pasajeros_por_vehiculo", "fecha_servicio", "origen", "destino"].includes(field)}
                  onChange={e => updateGroup(index, { [field]: e.target.value })} className={INPUT} />
              )}
            </div>)}
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-900">Destinos intermedios (opcional)</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-blue-800">Agrégalos en el orden del recorrido. No hace falta marcar cada punto en el mapa.</p>
                </div>
                <button type="button" disabled={group.itinerario.length >= 10}
                  onClick={() => updateGroup(index, {
                    itinerario: [...group.itinerario, { destino: "", fecha_llegada: "", dias_estadia: 0, hora_salida: "" }],
                  })}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-2 text-[9px] font-black uppercase text-blue-800 disabled:opacity-50">
                  <Plus size={13} /> Agregar destino
                </button>
              </div>
              {group.itinerario.map((stop, stopIndex) => (
                <div key={stopIndex} className="grid gap-2 rounded-lg border border-blue-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto]">
                  <label className="text-[9px] font-black uppercase tracking-wide text-slate-500">
                    Destino {stopIndex + 1}
                    <input maxLength={300} required value={stop.destino}
                      onChange={event => updateGroup(index, {
                        itinerario: group.itinerario.map((item, itemIndex) => itemIndex === stopIndex ? { ...item, destino: event.target.value } : item),
                      })}
                      className={`${INPUT} mt-1`} placeholder="Ciudad o lugar" />
                  </label>
                  <label className="text-[9px] font-black uppercase tracking-wide text-slate-500">
                    Llegada (opcional)
                    <input type="date" min={group.fecha_servicio || undefined} max={group.fecha_fin || undefined}
                      value={stop.fecha_llegada}
                      onChange={event => updateGroup(index, {
                        itinerario: group.itinerario.map((item, itemIndex) => itemIndex === stopIndex ? { ...item, fecha_llegada: event.target.value } : item),
                      })}
                      className={`${INPUT} mt-1`} />
                  </label>
                  <label className="text-[9px] font-black uppercase tracking-wide text-slate-500">
                    Estadía (días)
                    <input type="number" min={0} max={365} value={stop.dias_estadia}
                      onChange={event => updateGroup(index, {
                        itinerario: group.itinerario.map((item, itemIndex) => itemIndex === stopIndex ? { ...item, dias_estadia: Math.max(0, Math.min(365, Number(event.target.value) || 0)) } : item),
                      })}
                      className={`${INPUT} mt-1`} />
                  </label>
                  <label className="text-[9px] font-black uppercase tracking-wide text-slate-500">
                    Hora de salida
                    <input type="time" value={stop.hora_salida}
                      onChange={event => updateGroup(index, {
                        itinerario: group.itinerario.map((item, itemIndex) => itemIndex === stopIndex ? { ...item, hora_salida: event.target.value } : item),
                      })}
                      className={`${INPUT} mt-1`} />
                  </label>
                  <div className="flex items-end gap-1">
                    <button type="button" disabled={stopIndex === 0}
                      onClick={() => {
                        const itinerary = [...group.itinerario];
                        [itinerary[stopIndex - 1], itinerary[stopIndex]] = [itinerary[stopIndex], itinerary[stopIndex - 1]];
                        updateGroup(index, { itinerario: itinerary });
                      }}
                      aria-label={`Mover destino ${stopIndex + 1} arriba`}
                      className="rounded-lg p-2 text-slate-500 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" disabled={stopIndex === group.itinerario.length - 1}
                      onClick={() => {
                        const itinerary = [...group.itinerario];
                        [itinerary[stopIndex], itinerary[stopIndex + 1]] = [itinerary[stopIndex + 1], itinerary[stopIndex]];
                        updateGroup(index, { itinerario: itinerary });
                      }}
                      aria-label={`Mover destino ${stopIndex + 1} abajo`}
                      className="rounded-lg p-2 text-slate-500 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button"
                      onClick={() => updateGroup(index, { itinerario: group.itinerario.filter((_, itemIndex) => itemIndex !== stopIndex) })}
                      aria-label={`Quitar destino ${stopIndex + 1}`}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700 sm:col-span-2 lg:col-span-4"><input type="checkbox" checked={group.simultaneo} onChange={e => updateGroup(index, { simultaneo: e.target.checked })} className="accent-[#E31E24]" /> Los vehículos deben operar simultáneamente</label>
          </div>
          <input value={group.detalles} maxLength={2000} onChange={e => updateGroup(index, { detalles: e.target.value })} className={INPUT} placeholder="Indicaciones para este grupo (horarios, equipaje, necesidades especiales)" />
        </section>)}
        <button type="button" onClick={() => setGroups(current => [...current, emptyGroup()])} disabled={groups.length >= 20} className="inline-flex items-center gap-2 rounded-xl border border-[#E31E24]/30 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#E31E24] disabled:opacity-50"><Plus size={14} /> Agregar grupo</button>
        <div><label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">Cuéntanos qué necesitas *</label>
          <textarea required minLength={10} maxLength={5000} rows={6} value={detalles} onChange={e => setDetalles(e.target.value)} className={INPUT + " resize-y"} placeholder="Describe el servicio completo para preparar tu propuesta." />
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p>}
        <button type="submit" disabled={sending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E31E24] px-5 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-200 transition hover:bg-red-700 disabled:opacity-60 sm:w-auto"><Send size={16} /> {sending ? "Enviando..." : "Enviar a cotizaciones"}</button>
      </form>
      <section className="space-y-3"><h2 className="text-xs font-black uppercase tracking-widest text-slate-700">Mis requerimientos</h2>
        {loading ? <Loader2 className="animate-spin text-[#E31E24]" size={24} /> : requests.map(request => {
          const hasProposal = ["propuesta_enviada", "pago_pendiente", "pagado"].includes(request.estado);
          const groups = request.service_groups || [];
          const excludedGroupCount = groups.filter(group => group.incluido_en_propuesta === false).length;
          return <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-black text-slate-800">Requerimiento #{request.id}{request.organizacion ? ` · ${request.organizacion}` : ""}</p>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[9px] font-black uppercase text-slate-600">{request.estado.replace(/_/g, " ")}</span>
            </div>
            {!hasProposal && groups.map((group, index) => <div key={index} className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-black">Grupo {index + 1} · {group.cantidad_vehiculos} vehículo(s){group.tipo_vehiculo ? ` · ${group.tipo_vehiculo}` : ""}</p>
              <p className="mt-1">{group.origen || "Salida"} → {group.destino || "Destino"}{group.fecha_servicio ? ` · ${group.fecha_servicio.slice(0, 10)}` : ""}{group.hora_salida ? ` · ${group.hora_salida}` : ""}</p>
              {group.itinerario?.length ? <ol className="mt-2 list-inside list-decimal space-y-0.5 text-slate-600">
                {group.itinerario.map((stop, stopIndex) => <li key={stopIndex}>
                  {stop.destino}{stop.fecha_llegada ? ` · llegada ${stop.fecha_llegada.slice(0, 10)}` : ""}{stop.dias_estadia ? ` · estadía ${stop.dias_estadia} día(s)` : ""}
                </li>)}
              </ol> : null}
            </div>)}
            {hasProposal && <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-emerald-700">Total de la propuesta{excludedGroupCount ? " parcial" : ""}: ${Number(request.precio_final || 0).toFixed(2)}</p>
                <button type="button" onClick={() => void downloadProforma(request)} disabled={payingId === request.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 disabled:opacity-60">
                  {payingId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Proforma PDF
                </button>
              </div>
              {groups.map((group, index) => <div key={index} className="rounded-lg bg-white/80 p-3 text-xs text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black">Grupo {index + 1} · {group.cantidad_vehiculos} vehículo(s){group.tipo_vehiculo ? ` · ${group.tipo_vehiculo}` : ""}</p>
                  <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${group.incluido_en_propuesta === false ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>
                    {group.incluido_en_propuesta === false ? "No incluido" : "Incluido"}
                  </span>
                </div>
                <p className="mt-1">{group.origen || "Salida"} → {group.destino || "Destino"}{group.fecha_servicio ? ` · ${group.fecha_servicio.slice(0, 10)}` : ""}{group.hora_salida ? ` · ${group.hora_salida}` : ""}</p>
                {group.itinerario?.length ? <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50 p-2.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-violet-700">Destinos intermedios · en orden</p>
                  <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs text-violet-950">
                    {group.itinerario.map((stop, stopIndex) => <li key={stopIndex}>
                      {stop.destino}{stop.fecha_llegada ? ` · llegada ${stop.fecha_llegada.slice(0, 10)}` : ""}{stop.dias_estadia ? ` · estadía ${stop.dias_estadia} día(s)` : ""}{stop.hora_salida ? ` · salida ${stop.hora_salida}` : ""}
                    </li>)}
                  </ol>
                </div> : null}
                {group.incluido_en_propuesta === false
                  ? <p className="mt-1 font-semibold text-slate-500">{group.motivo_no_inclusion || "Este grupo no forma parte de la propuesta ni de la reserva."}</p>
                  : <p className="mt-1 font-bold text-emerald-700">Subtotal del grupo: ${Number(group.precio_total || 0).toFixed(2)}</p>}
                {group.incluido_en_propuesta !== false && !!request.unidades_despacho?.filter(unit => unit.grupo_numero === index + 1).length && <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {request.unidades_despacho.filter(unit => unit.grupo_numero === index + 1).map(unit => (
                    <p key={unit.unidad_numero} className="rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-[10px] font-semibold text-slate-600">
                      Unidad {unit.unidad_numero}: <span className="font-black text-slate-800">{unit.estado.replace(/_/g, " ")}</span>
                      {unit.vehiculo_placa ? ` · ${unit.vehiculo_placa}` : ""}
                    </p>
                  ))}
                </div>}
              </div>)}
              {request.reserva_id && request.estado === "pago_pendiente" && <a href={`/cliente/historial?abrir_pago=${request.reserva_id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E31E24] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-700">
                <CreditCard size={14} /> Continuar al pago
              </a>}
              {!request.reserva_id && request.estado === "propuesta_enviada" && <button type="button" onClick={() => void acceptProposal(request)} disabled={payingId === request.id}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E31E24] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-60">
                {payingId === request.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {excludedGroupCount ? "Aceptar propuesta parcial y continuar al pago" : "Aceptar y continuar al pago"}
              </button>}
              {request.estado === "pagado" && <p className="inline-flex items-center gap-2 text-xs font-black text-emerald-700"><CheckCircle2 size={15} /> Pago confirmado · Despacho: {request.estado_despacho || "pendiente"}</p>}
            </div>}
            {request.estado_despacho === "error" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">El pago está confirmado. Estamos revisando la preparación del despacho y te avisaremos cuando esté listo.</p>}
            {request.respuesta_admin && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-700">Respuesta de Turesma</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-blue-950">{request.respuesta_admin}</p>
            </div>}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <CommunicationPanel
                contextType="requerimiento"
                contextId={request.id}
                contextTitle={`Requerimiento #${request.id}`}
              />
            </div>
          </article>;
        })}
      </section>
    </div>
  );
}
