"use client";

import Image from "next/image";
import Link from "next/link";
import { useConductorPanel } from "./_components/use-conductor-panel";
import {
  Zap, History, TrendingUp,
  MapPin, Loader2, CheckCircle, Bus, ChevronRight,
} from "lucide-react";
export default function ConductorInicioPage() {
  const {
    checkingSession, panel, vehiculo,
    err: panelErr,
  } = useConductorPanel();

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  const totalIngresos = panel.historial.reduce((s, r) => s + (Number(r.total) || 0), 0);
  const totalFinalizados = panel.historial.filter(r => r.estado === "finalizada").length;
  const activasCount = panel.activas.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Activos",     val: activasCount,     color: "text-blue-600",   bg: "bg-blue-50 border-blue-200",   icon: <Zap size={18} className="text-blue-500" />,   href: "/vehiculo/activas" },
          { label: "Completados", val: totalFinalizados, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle size={18} className="text-emerald-500" />, href: "/vehiculo/historial" },
          { label: "Ingresos",    val: `$${totalIngresos.toFixed(0)}`, color: "text-slate-900", bg: "bg-white border-slate-200", icon: <TrendingUp size={18} className="text-[#E31E24]" />, href: "/vehiculo/historial" },
        ].map(k => (
          <Link key={k.label} href={k.href}
            className={`${k.bg} border rounded-2xl p-4 shadow-sm flex items-start justify-between hover:shadow-md transition-all group`}>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
              <p className={`text-2xl sm:text-3xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {k.icon}
              <ChevronRight size={12} className="text-gray-300 group-hover:text-[#E31E24] transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* ── VEHÍCULO ASIGNADO ───────────────────────────────────────────── */}
      {vehiculo ? (
        <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-xl overflow-hidden">
          {/* Header del card */}
          <div className="bg-[#0b0f1a] px-5 sm:px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="bg-[#E31E24] p-2 rounded-xl">
                <Bus size={18} className="text-white" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-500">Mi Vehículo Asignado</p>
                <p className="text-lg font-black italic tracking-tighter text-white uppercase">{vehiculo.placa}</p>
              </div>
            </div>
          </div>

          {/* Grid de datos del vehículo */}
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                { label: "Modelo",    val: vehiculo.modelo || "—" },
                { label: "Tipo",      val: vehiculo.tipo || "—" },
                { label: "Capacidad", val: vehiculo.capacidad ? `${vehiculo.capacidad} pasajeros` : "—" },
                { label: "Color",     val: vehiculo.color || "—" },
                ...(vehiculo.marca ? [{ label: "Marca", val: vehiculo.marca }] : []),
                ...(vehiculo.anio  ? [{ label: "Año",   val: String(vehiculo.anio) }] : []),
                ...(vehiculo.kilometraje ? [{ label: "Kilometraje", val: `${vehiculo.kilometraje.toLocaleString()} km` }] : []),
              ].map(item => (
                <div key={item.label} className="bg-slate-50 rounded-2xl p-3.5 border border-slate-100">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{item.label}</p>
                  <p className="text-sm font-bold text-slate-700 capitalize">{item.val}</p>
                </div>
              ))}
            </div>

            {vehiculo.descripcion && (
              <div className="mt-3 bg-blue-50 border border-blue-100 rounded-2xl p-3.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-400 mb-1">Descripción</p>
                <p className="text-sm text-blue-700">{vehiculo.descripcion}</p>
              </div>
            )}

            {vehiculo.imagen_url && (
              <div className="relative mx-auto mt-3 h-48 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:h-64">
                <Image
                  src={vehiculo.imagen_url}
                  alt={vehiculo.placa}
                  fill
                  sizes="(max-width: 512px) 100vw, 512px"
                  unoptimized
                  className="object-contain"
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-3xl p-8 text-center">
          <div className="w-16 h-16 bg-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Bus size={28} className="text-slate-400" />
          </div>
          <p className="font-black text-slate-400 uppercase italic text-sm">Sin vehículo asignado</p>
          <p className="text-xs text-slate-400 mt-1">Contacta al administrador para que te asigne un vehículo</p>
        </div>
      )}

      {/* ── ACCIONES RÁPIDAS ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { href: "/vehiculo/activas",     label: "Activos",     icon: Zap,     bg: "bg-[#E31E24]",  text: "text-white" },
          { href: "/vehiculo/historial",   label: "Historial",   icon: History, bg: "bg-[#0b0f1a]",  text: "text-white" },
          { href: "/vehiculo/ruta",        label: "Registrar Ruta", icon: MapPin, bg: "bg-white border border-slate-200", text: "text-slate-900" },
        ].map(item => (
          <Link key={item.href} href={item.href}
            className={`${item.bg} ${item.text} group flex flex-col items-center justify-center gap-2 p-5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5 relative`}>
            <item.icon size={22} />
            {item.label}
          </Link>
        ))}
      </div>

      {/* Errores */}
      {panelErr && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-xs font-black uppercase tracking-wider rounded-r-xl">{panelErr}</div>}

    </div>
  );
}
