"use client";

import { useConductorPanel } from "../_components/use-conductor-panel";
import {
  History, Loader2, Users,
  DollarSign, CalendarDays, CheckCircle, XCircle, Clock,
} from "lucide-react";

const ESTADO_STYLE: Record<string, { color: string; icon: React.ComponentType<{ size?: number }>; label: string }> = {
  finalizada: { color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle, label: "Finalizada" },
  cancelada:  { color: "bg-red-100 text-red-600 border-red-200",             icon: XCircle,    label: "Cancelada"  },
  en_curso:   { color: "bg-purple-100 text-purple-700 border-purple-200",    icon: Clock,      label: "En curso"   },
  confirmada: { color: "bg-blue-100 text-blue-700 border-blue-200",          icon: CheckCircle, label: "Confirmada" },
  pendiente:  { color: "bg-amber-100 text-amber-700 border-amber-200",       icon: Clock,      label: "Pendiente"  },
};

export default function HistorialPage() {
  const {
    panel, loadingPanel, checkingSession,
    formatFecha,
  } = useConductorPanel();

  if (checkingSession) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-[#E31E24]" size={32} />
      </div>
    );
  }

  const historial = panel.historial;

  const totalIngresos = historial
    .filter((r) => r.estado === "finalizada" && !r.requerimiento_id)
    .reduce((s, r) => s + Number(r.total ?? 0), 0);

  const totalViajes = historial.filter((r) => r.estado === "finalizada").length;
  const totalCanceladas = historial.filter((r) => r.estado === "cancelada").length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black text-emerald-700">{totalViajes}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mt-1">Finalizados</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
          <p className="text-2xl font-black text-blue-700">${totalIngresos.toLocaleString("es-EC", { maximumFractionDigits: 0 })}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 mt-1">Generado</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
          <p className="text-3xl font-black text-red-600">{totalCanceladas}</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mt-1">Cancelados</p>
        </div>
      </div>

      {/* LISTA */}
      {loadingPanel ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="animate-spin text-[#E31E24]" size={32} />
        </div>
      ) : historial.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-56 gap-3 bg-white rounded-2xl border border-slate-200">
          <History size={44} className="text-slate-200" />
          <p className="text-sm font-black uppercase text-slate-300 italic">Sin historial aún</p>
          <p className="text-xs text-slate-400">Aquí aparecerán tus viajes completados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {historial.map((r) => {
            const estilo = ESTADO_STYLE[r.estado] ?? ESTADO_STYLE.finalizada;
            const IconEstado = estilo.icon;
            return (
              <div key={r.operation_id || r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="font-black text-slate-800">
                      {r.usuario_nombre ?? "Cliente"}
                      {r.requerimiento_id ? ` · Requerimiento #${r.requerimiento_id} · Grupo ${r.grupo_numero}, unidad ${r.unidad_numero}` : ""}
                    </p>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <CalendarDays size={11} />
                      {formatFecha(r.fecha_reserva)}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${estilo.color}`}>
                    <IconEstado size={10} />
                    {estilo.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-slate-50 rounded-xl px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Origen</p>
                    <p className="text-xs font-bold text-slate-700 truncate">{r.origen ?? "—"}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Destino</p>
                    <p className="text-xs font-bold text-slate-700 truncate">{r.destino ?? "—"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Users size={11} /> {r.num_personas} pers.</span>
                  {!r.requerimiento_id && <span className="flex items-center gap-1"><DollarSign size={11} /> ${Number(r.total).toFixed(2)}</span>}
                  {r.vehiculo_placa && (
                    <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {r.vehiculo_placa}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
