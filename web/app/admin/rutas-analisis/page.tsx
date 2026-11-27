"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import {
  Loader2, MapPin, ArrowRight, Route,
  DollarSign, Users, Award, Flame,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const API = API_BASE_URL;

type Ruta = {
  origen: string; destino: string; viajes: number; pasajeros: number;
  ingresos: number; prom_pasajeros: number; cancelados: number;
};
type Resumen = {
  total_rutas: number; total_viajes: number; total_ingresos: number;
  ruta_mas_demandada: Ruta | null; ruta_mas_rentable: Ruta | null;
};

const fmt = (n: number) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const corto = (s: string) => (s.length > 22 ? s.slice(0, 20) + "…" : s);

export default function AdminRutasAnalisisPage() {
  const { checkingSession } = useAdminGuard();
  const [rutas, setRutas] = useState<Ruta[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/rutas-analisis/dinamico`, { headers: getAuthHeaders() });
      if (res.ok) { const j = await res.json(); setRutas(j.data || []); setResumen(j.resumen || null); }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>;

  const chartData = rutas.slice(0, 8).map(r => ({
    name: `${corto(r.origen)} → ${corto(r.destino)}`,
    Viajes: Number(r.viajes),
    Ingresos: Number(r.ingresos),
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
      ) : rutas.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <Route size={42} className="text-slate-200 mx-auto mb-3" />
          <p className="font-black text-slate-300 uppercase italic text-sm">Aún no hay rutas con datos</p>
          <p className="text-xs text-slate-400 mt-1">El análisis aparecerá cuando existan reservas con origen y destino.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          {resumen && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rutas analizadas</p>
                <p className="text-3xl font-black italic tracking-tighter text-slate-900 mt-1">{resumen.total_rutas}</p>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div className="bg-blue-500/10 p-3 rounded-xl"><Flame size={22} className="text-blue-600" /></div>
                <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Ruta más demandada</p>
                  {resumen.ruta_mas_demandada ? (<p className="text-sm font-black text-slate-800 truncate">{resumen.ruta_mas_demandada.origen} → {resumen.ruta_mas_demandada.destino}<span className="text-blue-600 ml-2">{resumen.ruta_mas_demandada.viajes} viajes</span></p>) : <p className="text-sm text-slate-300 italic">—</p>}
                </div>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div className="bg-emerald-500/10 p-3 rounded-xl"><Award size={22} className="text-emerald-600" /></div>
                <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Ruta con más cobro neto</p>
                  {resumen.ruta_mas_rentable ? (<p className="text-sm font-black text-slate-800 truncate">{resumen.ruta_mas_rentable.origen} → {resumen.ruta_mas_rentable.destino}<span className="text-emerald-600 ml-2">{fmt(Number(resumen.ruta_mas_rentable.ingresos))}</span></p>) : <p className="text-sm text-slate-300 italic">—</p>}
                </div>
              </div>
            </div>
          )}

          {/* GRÁFICA */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-[13px] font-black text-slate-700 mb-4 tracking-tight">Top rutas por número de viajes</p>
            <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 38)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} width={170} />
                <Tooltip formatter={(v: any, n) => n === "Ingresos" ? fmt(Number(v)) : v} />
                <Bar dataKey="Viajes" fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* TABLA */}
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
            <div className="overflow-x-auto">
              <table className="min-w-[680px] w-full text-left border-collapse">
                <thead><tr className="bg-slate-50/60 border-b border-slate-100">
                  {["Ruta", "Viajes", "Pasajeros", "Prom. pax", "Cobrado neto", "Cancelados"].map(h => (
                    <th key={h} className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {rutas.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <MapPin size={12} className="text-[#E31E24] flex-shrink-0" /><span className="truncate max-w-[120px]">{r.origen}</span>
                          <ArrowRight size={11} className="text-slate-300 flex-shrink-0" /><span className="truncate max-w-[120px]">{r.destino}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-black text-blue-600">{r.viajes}</td>
                      <td className="px-5 py-4 text-xs text-slate-600 flex items-center gap-1"><Users size={12} className="text-slate-400" />{r.pasajeros}</td>
                      <td className="px-5 py-4 text-xs text-slate-600">{r.prom_pasajeros}</td>
                      <td className="px-5 py-4 text-sm font-black text-emerald-600 whitespace-nowrap"><DollarSign size={12} className="inline -mt-0.5" />{Number(r.ingresos).toFixed(0)}</td>
                      <td className="px-5 py-4 text-xs font-bold text-red-400">{r.cancelados || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
