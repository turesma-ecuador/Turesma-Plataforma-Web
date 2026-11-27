"use client";

import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { escapeReportHtml, openPrintableReport } from "../../../lib/print-report";
import {
  Loader2, FileDown, TrendingUp, TrendingDown, DollarSign, Bus, Wallet, Calendar,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const API = API_BASE_URL;

type Mes = {
  mes: number; nombre: string; viajes: number; pasajeros: number;
  ingresos: number; gastos: number; utilidad: number; cancelados: number;
  ticket_promedio: number; crecimiento: number | null;
};
type Resumen = {
  viajes: number; pasajeros: number; ingresos: number; gastos: number;
  utilidad: number; cancelados: number; mejorMes: string | null; peorMes: string | null;
};

const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("es-EC");

export default function AdminHistorialPage() {
  const { checkingSession } = useAdminGuard();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [anios, setAnios] = useState<number[]>([]);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (a: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/historial/mensual?anio=${a}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const j = await res.json();
        setMeses(j.meses || []);
        setResumen(j.resumen || null);
        setAnios(j.anios || []);
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(anio); }, [checkingSession, anio]);

  // Genera el reporte formal imprimible (PDF vía navegador) con el logo.
  const generarReporte = () => {
    if (!resumen) return;
    const logoUrl = `${window.location.origin}/logo.png`;
    const hoy = new Date();
    const filas = meses.map(m => `
      <tr>
        <td><b>${escapeReportHtml(m.nombre)}</b></td>
        <td style="text-align:center">${m.viajes}</td>
        <td style="text-align:center">${m.pasajeros}</td>
        <td style="text-align:right;color:#047857;font-weight:700">${fmt(m.ingresos)}</td>
        <td style="text-align:right;color:#b45309">${fmt(m.gastos)}</td>
        <td style="text-align:right;font-weight:700;color:${m.utilidad >= 0 ? "#0369a1" : "#b91c1c"}">${fmt(m.utilidad)}</td>
        <td style="text-align:center;color:#b91c1c">${m.cancelados}</td>
        <td style="text-align:center">${m.crecimiento == null ? "—" : (m.crecimiento >= 0 ? "▲ +" : "▼ ") + m.crecimiento + "%"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Balance ${anio} — Turesma</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        body{padding:36px;color:#1a1a1a}
        .head{text-align:center;border-bottom:3px solid #0b0f1a;padding-bottom:16px;margin-bottom:24px}
        .head img{max-height:70px;margin-bottom:10px}
        .head h1{font-size:20px;text-transform:uppercase;letter-spacing:1px}
        .head p{font-size:12px;color:#666;margin-top:5px}
        .kpis{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
        .kpi{flex:1;min-width:150px;border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center}
        .kpi .t{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:6px}
        .kpi .v{font-size:19px;font-weight:800}
        h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:20px 0 10px}
        table{width:100%;border-collapse:collapse}
        th{background:#0b0f1a;color:#fff;text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase}
        td{padding:8px 10px;font-size:11px;border-bottom:1px solid #eee}
        tfoot td{font-weight:800;background:#f8fafc;border-top:2px solid #0b0f1a}
        .ft{margin-top:34px;text-align:center;font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:2px;line-height:1.8}
        @media print{.noprint{display:none}}
      </style></head><body>
      <div class="head">
        <img class="report-logo" src="${logoUrl}" alt="Turesma" onerror="this.style.display='none'"/>
        <h1>Balance anual de operaciones ${anio}</h1>
        <p>Generado el ${hoy.toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" })} a las ${hoy.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
      <div class="kpis">
        <div class="kpi"><p class="t">Viajes del año</p><p class="v">${resumen.viajes}</p></div>
        <div class="kpi"><p class="t">Ingresos</p><p class="v" style="color:#047857">${fmt(resumen.ingresos)}</p></div>
        <div class="kpi"><p class="t">Gastos mantenimiento</p><p class="v" style="color:#b45309">${fmt(resumen.gastos)}</p></div>
        <div class="kpi"><p class="t">Utilidad</p><p class="v" style="color:#0369a1">${fmt(resumen.utilidad)}</p></div>
      </div>
      <p style="font-size:12px;color:#475569;margin-bottom:14px">Mejor mes: <b>${escapeReportHtml(resumen.mejorMes || "—")}</b> · Mes más bajo: <b>${escapeReportHtml(resumen.peorMes || "—")}</b> · Pasajeros transportados: <b>${resumen.pasajeros}</b></p>
      <h2>Detalle mes a mes</h2>
      <table>
        <thead><tr><th>Mes</th><th style="text-align:center">Viajes</th><th style="text-align:center">Pasajeros</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Gastos</th><th style="text-align:right">Utilidad</th><th style="text-align:center">Cancelados</th><th style="text-align:center">Crecim.</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr>
          <td>TOTAL ${anio}</td>
          <td style="text-align:center">${resumen.viajes}</td>
          <td style="text-align:center">${resumen.pasajeros}</td>
          <td style="text-align:right;color:#047857">${fmt(resumen.ingresos)}</td>
          <td style="text-align:right;color:#b45309">${fmt(resumen.gastos)}</td>
          <td style="text-align:right;color:#0369a1">${fmt(resumen.utilidad)}</td>
          <td style="text-align:center;color:#b91c1c">${resumen.cancelados}</td>
          <td></td>
        </tr></tfoot>
      </table>
      <div class="ft">Reporte generado automáticamente por el sistema de gestión Turesma<br/>© ${anio} Turesma S.A. — Todos los derechos reservados</div>
      <div class="noprint" style="text-align:center;margin-top:26px"><button onclick="window.print()" style="background:#E31E24;color:#fff;border:none;padding:12px 30px;border-radius:10px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:1px">Descargar / Imprimir PDF</button></div>
      </body></html>`;

    const win = openPrintableReport(html);
    if (!win) return;
  };

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
  );

  const chartData = meses.map(m => ({ mes: m.nombre.slice(0, 3), Ingresos: m.ingresos, Gastos: m.gastos }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* CONTROLES */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-slate-400" />
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            className="px-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-black outline-none focus:border-[#E31E24] transition-all cursor-pointer">
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={generarReporte} disabled={loading || !resumen}
          className="flex items-center gap-2 bg-[#0b0f1a] hover:bg-black text-white px-5 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg disabled:opacity-50">
          <FileDown size={16} /> Descargar reporte {anio}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
      ) : (
        <>
          {/* RESUMEN DEL AÑO */}
          {resumen && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: "Viajes del año", val: String(resumen.viajes), icon: Bus, color: "text-slate-900", bg: "bg-white" },
                { label: "Ingresos", val: fmt(resumen.ingresos), icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
                { label: "Gastos mant.", val: fmt(resumen.gastos), icon: Wallet, color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
                { label: "Utilidad", val: fmt(resumen.utilidad), icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50 border-blue-200" },
              ].map(k => (
                <div key={k.label} className={`${k.bg} border border-gray-100 rounded-2xl p-4 sm:p-5 shadow-sm flex items-start justify-between`}>
                  <div>
                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
                    <p className={`text-xl sm:text-2xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
                  </div>
                  <k.icon size={20} className={k.color} />
                </div>
              ))}
            </div>
          )}

          {resumen && (resumen.mejorMes || resumen.peorMes) && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-600">🏆 Mejor mes: <b className="text-emerald-700">{resumen.mejorMes || "—"}</b></span>
              <span className="text-slate-600">📉 Mes más bajo: <b className="text-slate-700">{resumen.peorMes || "—"}</b></span>
              <span className="text-slate-600">👥 Pasajeros: <b className="text-slate-700">{resumen.pasajeros}</b></span>
            </div>
          )}

          {/* GRÁFICA */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-[13px] font-black text-slate-700 mb-4 tracking-tight">Ingresos y gastos por mes · {anio}</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Bar dataKey="Ingresos" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Gastos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* TABLA MES A MES */}
          <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left border-collapse">
                <thead><tr className="bg-slate-50/60 border-b border-slate-100">
                  {["Mes", "Viajes", "Pasajeros", "Ingresos", "Gastos", "Utilidad", "Cancelados", "Crecim."].map(h => (
                    <th key={h} className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {meses.map(m => (
                    <tr key={m.mes} className={`hover:bg-slate-50/80 transition-colors ${m.viajes === 0 && m.ingresos === 0 ? "opacity-50" : ""}`}>
                      <td className="px-5 py-3.5 text-sm font-black text-slate-800">{m.nombre}</td>
                      <td className="px-5 py-3.5 text-sm font-bold text-slate-600">{m.viajes}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">{m.pasajeros}</td>
                      <td className="px-5 py-3.5 text-sm font-black text-emerald-600 whitespace-nowrap">{fmt(m.ingresos)}</td>
                      <td className="px-5 py-3.5 text-xs font-bold text-amber-600 whitespace-nowrap">{fmt(m.gastos)}</td>
                      <td className={`px-5 py-3.5 text-sm font-black whitespace-nowrap ${m.utilidad >= 0 ? "text-blue-600" : "text-red-600"}`}>{fmt(m.utilidad)}</td>
                      <td className="px-5 py-3.5 text-xs font-bold text-red-400">{m.cancelados}</td>
                      <td className="px-5 py-3.5 text-xs font-black whitespace-nowrap">
                        {m.crecimiento == null ? <span className="text-slate-300">—</span> : (
                          <span className={`inline-flex items-center gap-1 ${m.crecimiento >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {m.crecimiento >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {m.crecimiento >= 0 ? "+" : ""}{m.crecimiento}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {resumen && (
                  <tfoot>
                    <tr className="bg-slate-900 text-white">
                      <td className="px-5 py-4 text-sm font-black uppercase">Total {anio}</td>
                      <td className="px-5 py-4 text-sm font-black">{resumen.viajes}</td>
                      <td className="px-5 py-4 text-xs">{resumen.pasajeros}</td>
                      <td className="px-5 py-4 text-sm font-black text-emerald-400 whitespace-nowrap">{fmt(resumen.ingresos)}</td>
                      <td className="px-5 py-4 text-sm font-black text-amber-400 whitespace-nowrap">{fmt(resumen.gastos)}</td>
                      <td className="px-5 py-4 text-sm font-black text-blue-300 whitespace-nowrap">{fmt(resumen.utilidad)}</td>
                      <td className="px-5 py-4 text-xs text-red-300">{resumen.cancelados}</td>
                      <td className="px-5 py-4"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
