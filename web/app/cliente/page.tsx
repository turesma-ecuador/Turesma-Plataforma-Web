"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  FileText, History, ArrowRight, Clock, CheckCircle2,
  Loader2, User, Navigation, MapPin,
} from "lucide-react";
import { getAuthHeaders, handleUnauthorized } from "../../lib/session";
import { useClienteGuard } from "../../lib/use-cliente-guard";
import { LiveTripMap } from "../../components/live-trip-map";
import { MapPicker, Punto } from "../../components/map-picker";
import { formatLocalizedDate, LocalizedContent, useLocale } from "../../lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function ClienteInicioPage() {
  const { language } = useLocale();
  const { user, checkingSession } = useClienteGuard();
  const [cotPendientes, setCotPendientes] = useState(0);
  const [cotAprobadas, setCotAprobadas] = useState(0);
  const [viajes, setViajes] = useState(0);
  const [viajeActivo, setViajeActivo] = useState<{ id: number; estado: string; origen?: string | null; destino?: string | null } | null>(null);
  const [catalogoViajes, setCatalogoViajes] = useState<any[]>([]);
  const [viajesMessage, setViajesMessage] = useState("");
  const [viajesError, setViajesError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [viajeCompra, setViajeCompra] = useState<any | null>(null);
  const [compraForm, setCompraForm] = useState({ pasajeros: "1", fecha: "", hora: "", ubicacion: "", referencia: "" });
  const [pickupPoint, setPickupPoint] = useState<Punto | null>(null);
  const [comprando, setComprando] = useState(false);

  useEffect(() => {
    if (checkingSession || !user?.id) return;
    let cancelled = false;
    setLoadingDashboard(true);
    setLoadError("");
    (async () => {
      try {
        const [cRes, rRes] = await Promise.all([
          fetch(`${API}/api/cotizaciones/mias`, { headers: getAuthHeaders() }),
          fetch(`${API}/api/usuarios/mis-reservas`, { headers: getAuthHeaders() }),
        ]);
        if (handleUnauthorized(cRes.status) || handleUnauthorized(rRes.status)) return;
        const [cotizacionesData, reservasData] = await Promise.all([cRes.json(), rRes.json()]);
        if (!cRes.ok || !rRes.ok) throw new Error(cotizacionesData.error || reservasData.error || "No se pudo cargar el portal");
        const catalogoRes = await fetch(`${API}/api/usuarios/viajes`, { headers: getAuthHeaders() });
        const catalogoData = await catalogoRes.json();
        if (!catalogoRes.ok) throw new Error(catalogoData.error || "No se pudo cargar el catálogo de viajes");
        if (cancelled) return;
        const cots = Array.isArray(cotizacionesData) ? cotizacionesData : [];
        setCotPendientes(cots.filter((c: any) => c.estado === "pendiente" || c.estado === "negociacion").length);
        setCotAprobadas(cots.filter((c: any) => c.estado === "aprobada").length);
        const arr = Array.isArray(reservasData) ? reservasData : [];
        setViajes(arr.length);
        const activo = arr.find((r: any) => r.estado === "en_curso") || arr.find((r: any) => r.estado === "confirmada");
        setViajeActivo(activo ? { id: activo.id, estado: activo.estado, origen: activo.origen, destino: activo.destino } : null);
        setCatalogoViajes(Array.isArray(catalogoData.data) ? catalogoData.data : []);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "No se pudo cargar el portal");
      } finally {
        if (!cancelled) setLoadingDashboard(false);
      }
    })();
    return () => { cancelled = true; };
  }, [checkingSession, user?.id, reloadKey]);

  const reservarViaje = async () => {
    if (!viajeCompra) return;
    const cantidad = Number(compraForm.pasajeros);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || !compraForm.fecha || !compraForm.hora || !compraForm.ubicacion.trim()) return;
    setComprando(true);
    setViajesError("");
    setViajesMessage("");
    try {
      const response = await fetch(`${API}/api/usuarios/viajes/${viajeCompra.id}/reservar`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          num_personas: cantidad,
          fecha_viaje: compraForm.fecha,
          hora_viaje: compraForm.hora,
          ubicacion_recogida: compraForm.ubicacion,
          referencia_recogida: compraForm.referencia || null,
          recogida_lat: pickupPoint?.lat ?? null,
          recogida_lng: pickupPoint?.lng ?? null,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: (await response.text()).slice(0, 240) };
      if (!response.ok) throw new Error(data.error || "No se pudo reservar el viaje");
      setViajesMessage(`${data.message} Total: $${Number(data.data?.total || 0).toFixed(2)}.`);
      setViajeCompra(null);
      setPickupPoint(null);
      const reservaId = Number(data.data?.id);
      window.location.assign(reservaId > 0 ? `/cliente/historial?abrir_pago=${reservaId}` : "/cliente/historial");
    } catch (error) {
      setViajesError(error instanceof Error ? error.message : "No se pudo reservar el viaje. Revisa tu conexión e inténtalo otra vez.");
    } finally {
      setComprando(false);
    }
  };

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>;

  return (
    <LocalizedContent>
    <div className="animate-in space-y-4 fade-in duration-500 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "En revisión", val: cotPendientes, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
          { label: "Aprobadas", val: cotAprobadas, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
          { label: "Mis viajes", val: viajes, color: "text-slate-900", bg: "bg-white border-slate-200" },
        ].map(k => (
          <div key={k.label} className={`${k.bg} flex min-h-24 flex-col justify-center rounded-2xl border p-2.5 text-center shadow-sm sm:p-4`}>
            <p className={`text-2xl font-black italic ${k.color}`}>{k.val}</p>
            <p className="mt-1 text-[8px] font-black uppercase leading-tight tracking-[0.08em] text-slate-400 sm:text-[9px] sm:tracking-widest">{k.label}</p>
          </div>
        ))}
      </div>

      <section data-tour-target="portal-home-services" className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:space-y-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 sm:items-end">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#E31E24]">Compra directa</p>
            <h2 className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">Viajes disponibles</h2>
            {catalogoViajes.length > 0 && <p className="mt-1 text-sm text-slate-500">Selecciona un viaje con precio y capacidad de personas definida.</p>}
          </div>
          <Link href="/cliente/historial" className="shrink-0 whitespace-nowrap pt-1 text-xs font-black text-slate-400 hover:text-[#E31E24]">Mis pagos</Link>
        </div>
        {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><span>{loadError}</span><button type="button" onClick={() => setReloadKey((key) => key + 1)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-red-700 shadow-sm">Reintentar</button></div>}
        {viajesMessage && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{viajesMessage}</p>}
        {viajesError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{viajesError}</p>}
        {loadingDashboard && <p className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-500">Cargando tus viajes y cotizaciones…</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {catalogoViajes.map((viaje) => {
            const images = [
              ...(viaje.vehiculo_imagen_url ? [{ src: viaje.vehiculo_imagen_url, alt: `Vehículo ${viaje.vehiculo_placa || ""}` }] : []),
              ...(Array.isArray(viaje.imagenes)
                ? viaje.imagenes.slice(0, 3).map((src: string) => ({ src, alt: `Destino ${viaje.destino}` }))
                : []),
            ];

            return (
            <article key={viaje.id} className="overflow-hidden rounded-2xl border border-slate-200">
              {images.length > 0 && (
                <div className="grid grid-cols-2 gap-1">
                  {images.map((image) => (
                    <Image
                      key={image.src}
                      src={image.src}
                      alt={image.alt}
                      width={320}
                      height={144}
                      sizes={images.length === 1 ? "(max-width: 768px) 100vw, 640px" : "(max-width: 768px) 50vw, 320px"}
                      className={`h-36 w-full object-cover ${images.length === 1 ? "col-span-2" : ""}`}
                    />
                  ))}
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 data-no-translate className="font-black text-slate-900">{viaje.titulo}</h3>
                  <span className="text-lg font-black text-[#E31E24]">${Number(viaje.precio).toFixed(2)}</span>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-600">
                  <MapPin size={15} className="text-[#E31E24]" /><span data-no-translate>{viaje.origen}</span> <ArrowRight size={13} /> <span data-no-translate>{viaje.destino}</span>
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {viaje.vehiculo_placa ? `Vehículo ${viaje.vehiculo_placa} · ${viaje.vehiculo_modelo || ""}` : "Vehículo por confirmar"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                  <span className="rounded-lg bg-slate-50 px-2 py-1">{formatLocalizedDate(String(viaje.fecha_servicio || ""), language)}</span>
                  <span className="rounded-lg bg-slate-50 px-2 py-1">{viaje.hora_salida || "Hora por definir"}</span>
                  <span className="rounded-lg bg-slate-50 px-2 py-1">Vehículo: {viaje.capacidad_personas} personas</span>
                  <span className="rounded-lg bg-slate-50 px-2 py-1">{viaje.cupos_disponibles} disponibles</span>
                </div>
                <button
                  onClick={() => {
                    setViajeCompra(viaje);
                    setPickupPoint(null);
                    setCompraForm({
                      pasajeros: "1",
                      fecha: viaje.fecha_servicio?.slice(0, 10) || "",
                      hora: viaje.hora_salida || "",
                      ubicacion: viaje.origen || "",
                      referencia: "",
                    });
                  }}
                  disabled={!viaje.cupos_disponibles}
                  className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {viaje.cupos_disponibles ? "Reservar este viaje" : "Sin personas disponibles"}
                </button>
              </div>
            </article>
            );
          })}
        </div>
        {!loadingDashboard && !loadError && !catalogoViajes.length && <p className="rounded-2xl bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-400 sm:p-6">No hay viajes publicados en este momento.</p>}
      </section>

      {viajeCompra && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"><form onSubmit={(event) => { event.preventDefault(); void reservarViaje(); }} className="my-4 w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-widest text-[#E31E24]">Confirmar compra</p><h2 className="mt-1 text-xl font-black text-slate-900">{viajeCompra.titulo}</h2></div><button type="button" onClick={() => setViajeCompra(null)} className="text-2xl text-slate-400">×</button></div>      <p className="text-sm font-semibold text-slate-600">{viajeCompra.origen} → {viajeCompra.destino} · ${Number(viajeCompra.precio).toFixed(2)} por persona</p><p className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">Capacidad del vehículo: {viajeCompra.capacidad_personas} personas</p><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Personas que van<input type="number" min="1" max={viajeCompra.cupos_disponibles} value={compraForm.pasajeros} onChange={(e) => setCompraForm({ ...compraForm, pasajeros: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm" required /></label><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Fecha del viaje<input type="date" value={compraForm.fecha} onChange={(e) => setCompraForm({ ...compraForm, fecha: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm" required /></label><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Hora de salida<input type="time" value={compraForm.hora} onChange={(e) => setCompraForm({ ...compraForm, hora: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm" required /></label><div className="space-y-2"><p className="text-xs font-black uppercase tracking-wider text-slate-500">Ubicación de recogida</p>      <MapPicker localized pickupOnly origin={pickupPoint} destination={null} onChange={(which, point) => { if (which === "origin") { setPickupPoint(point); setCompraForm((current) => ({ ...current, ubicacion: point.label })); } }} /><input value={compraForm.ubicacion} onChange={(e) => setCompraForm({ ...compraForm, ubicacion: e.target.value })} className="w-full rounded-xl border p-3 text-sm normal-case" placeholder="Dirección o punto de encuentro" required /><label className="block text-xs font-black uppercase tracking-wider text-slate-500">Referencia (opcional)<textarea value={compraForm.referencia} onChange={(e) => setCompraForm({ ...compraForm, referencia: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" rows={2} placeholder="Ej.: junto a la farmacia, puerta azul..." /></label></div><button disabled={comprando} className="w-full rounded-xl bg-[#E31E24] py-3 font-black text-white disabled:opacity-50">{comprando ? "Registrando..." : "Confirmar reserva"}</button></form></div>}

      {/* VIAJE ACTIVO — SEGUIMIENTO EN VIVO */}
      {viajeActivo && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black italic tracking-tighter uppercase text-slate-900 flex items-center gap-2">
              <Navigation size={18} className="text-blue-600" />
              {viajeActivo.estado === "en_curso" ? "Tu viaje en curso" : "Tu próximo viaje"}
            </h2>
            <Link href="/cliente/historial" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#E31E24]">Ver historial</Link>
          </div>
          {(viajeActivo.origen || viajeActivo.destino) && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-1.5 gap-y-1 text-xs font-bold text-slate-500 sm:flex sm:items-center sm:gap-1.5">
              <MapPin size={13} className="row-span-2 row-start-1 mt-0.5 text-[#E31E24] sm:mt-0" />
              <span className="col-start-2 row-start-1 min-w-0 break-words sm:flex-1 sm:truncate">{viajeActivo.origen || "—"}</span>
              <ArrowRight size={12} className="col-start-1 row-start-2 mt-0.5 rotate-90 text-slate-300 sm:mt-0 sm:rotate-0" />
              <span className="col-start-2 row-start-2 min-w-0 break-words sm:flex-1 sm:truncate">{viajeActivo.destino || "—"}</span>
            </div>
          )}
          {viajeActivo.estado === "en_curso" ? (
            <LiveTripMap reservaId={viajeActivo.id} />
          ) : (
            <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-700">
              El seguimiento en vivo estará disponible cuando el conductor inicie el viaje.
            </p>
          )}
        </div>
      )}

      {/* ACCIONES RÁPIDAS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/cliente/cotizar" className="group bg-[#E31E24] text-white rounded-2xl p-5 shadow-lg shadow-red-200 hover:bg-red-700 transition-all flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="bg-white/20 p-2.5 rounded-xl"><FileText size={20} /></div><span className="font-black text-sm uppercase tracking-widest">Cotizar viaje</span></div>
          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
        </Link>
        <Link href="/cliente/historial" className="group bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-[#E31E24] transition-all flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="bg-slate-100 p-2.5 rounded-xl"><History size={20} className="text-slate-600" /></div><span className="font-black text-sm uppercase tracking-widest text-slate-700">Mi historial</span></div>
          <ArrowRight size={18} className="text-slate-300 group-hover:text-[#E31E24] transition-colors" />
        </Link>
        <Link href="/cliente/perfil" className="group bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-[#E31E24] transition-all flex items-center justify-between">
          <div className="flex items-center gap-3"><div className="bg-slate-100 p-2.5 rounded-xl"><User size={20} className="text-slate-600" /></div><span className="font-black text-sm uppercase tracking-widest text-slate-700">Mi perfil</span></div>
          <ArrowRight size={18} className="text-slate-300 group-hover:text-[#E31E24] transition-colors" />
        </Link>
      </div>

      {/* CÓMO FUNCIONA */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-700 mb-4">¿Cómo funciona?</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: "1", icon: <FileText size={18} className="text-[#E31E24]" />, t: "Cotiza", d: "Elige vehículo, fecha, duración y propón un valor." },
            { n: "2", icon: <Clock size={18} className="text-amber-500" />, t: "Acuerdo", d: "El administrador revisa y define el precio final." },
            { n: "3", icon: <CheckCircle2 size={18} className="text-emerald-500" />, t: "Viaja", d: "Se crea tu reserva con vehículo y conductor asignados." },
          ].map(s => (
            <div key={s.n} className="bg-slate-50 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Paso {s.n}</span></div>
              <p className="font-black text-slate-800 uppercase italic">{s.t}</p>
              <p className="text-xs text-slate-500 mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
    </LocalizedContent>
  );
}
