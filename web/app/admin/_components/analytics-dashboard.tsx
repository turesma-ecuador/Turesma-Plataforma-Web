"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState, useCallback } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, DollarSign, ShoppingCart, Users, Car,
  Loader2, UserCircle, AlertTriangle, FileSpreadsheet,
} from "lucide-react";
import { descargarExcel } from "../../../lib/download";

const API = API_BASE_URL;

const fmt = (n: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtAxis = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const formatMonth = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("es-EC", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
};

const COLORS_PIE = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#7C3AED"];
const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  en_curso: "En Curso",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

type DashData = {
  kpi: {
    ingresos: number; ganancias: number; gastos: number; margen: number;
    total_reservas: number; pasajeros: number; pendientes: number;
    confirmadas: number; en_curso: number; finalizadas: number; canceladas: number;
    total_vehiculos: number; total_conductores: number; total_clientes: number;
  };
  reservaEstados: { estado: string; total: number }[];
  mensual: { mes: string; ingresos: number; gastos: number; ganancias: number; reservas: number }[];
  vehiculos: { placa: string; modelo: string; ingresos: number; reservas: number; pasajeros: number }[];
  mantenimientoVehiculos: { placa: string; modelo: string; gasto: number; servicios: number }[];
  vehiculoMasUsado: { placa: string; modelo: string; reservas: number; ingresos: number } | null;
  vehiculoMayorGasto: { placa: string; modelo: string; gasto: number; servicios: number } | null;
};

type FiltroFecha = "todo" | "hoy" | "mes" | "rango";

const hoyISO = () => new Date().toISOString().slice(0, 10);
const inicioMesISO = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };

const KPICard = ({
  label, value, sub, color, icon: Icon,
}: {
  label: string; value: string; sub?: string; color: string; icon: any;
}) => (
  <div className={`rounded-xl border-2 ${color} p-4 flex flex-col gap-1 shadow-sm`}>
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-black uppercase tracking-widest opacity-60">{label}</p>
      <Icon size={16} className="opacity-50" />
    </div>
    <p className="text-2xl font-black tracking-tight">{value}</p>
    {sub && <p className="text-[10px] font-bold opacity-50">{sub}</p>}
  </div>
);

const ChartCard = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
    <p className="text-[13px] font-black text-slate-700 mb-4 tracking-tight">{title}</p>
    {description && <p className="-mt-2 mb-4 text-[11px] text-slate-500">{description}</p>}
    {children}
  </div>
);

export const AnalyticsDashboard = () => {
  const { checkingSession } = useAdminGuard();
  const [compactCharts, setCompactCharts] = useState(false);
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [exportandoExcel, setExportandoExcel] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateCompactCharts = () => setCompactCharts(mediaQuery.matches);
    updateCompactCharts();
    mediaQuery.addEventListener("change", updateCompactCharts);
    return () => mediaQuery.removeEventListener("change", updateCompactCharts);
  }, []);

  // Filtro de fechas
  const [filtro, setFiltro] = useState<FiltroFecha>("todo");
  const [desde, setDesde] = useState(inicioMesISO());
  const [hasta, setHasta] = useState(hoyISO());

  const rango = useCallback((): { desde: string; hasta: string } | null => {
    if (filtro === "todo") return null;
    if (filtro === "hoy") return { desde: hoyISO(), hasta: hoyISO() };
    if (filtro === "mes") return { desde: inicioMesISO(), hasta: hoyISO() };
    return { desde, hasta }; // rango personalizado
  }, [filtro, desde, hasta]);

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    setErr("");
    try {
      const r = rango();
      const qs = r ? `?desde=${r.desde}&hasta=${r.hasta}` : "";
      const res = await fetch(`${API}/api/admin/dashboard${qs}`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (!res.ok) throw new Error("Error al cargar datos");
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }, [rango]);

  useEffect(() => {
    if (!checkingSession) load();
  }, [checkingSession, load]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const exportarExcel = async () => {
    setExportandoExcel(true);
    const r = rango();
    const qs = r ? `&desde=${r.desde}&hasta=${r.hasta}` : "";
    const result = await descargarExcel(`/api/admin/reportes/exportar-csv?tipo=reservas&formato=xlsx${qs}`, "reporte_reservas.xlsx");
    if (!result.ok) setErr(result.error || "No se pudo exportar");
    setExportandoExcel(false);
  };

  if (checkingSession || loading) {
    return (
      <div className="flex h-72 items-center justify-center gap-3">
        <Loader2 className="animate-spin text-[#E31E24]" size={32} />
        <span className="font-bold text-slate-500 text-sm">Cargando dashboard…</span>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="flex flex-col h-72 items-center justify-center gap-3 text-center">
        <AlertTriangle size={36} className="text-amber-400" />
        <p className="font-black text-slate-600 text-sm">No se pudieron cargar los datos</p>
        <p className="text-xs text-slate-400">{err}</p>
        <button onClick={() => load()} className="mt-2 px-4 py-2 bg-[#E31E24] text-white text-xs font-black rounded-xl">
          Reintentar
        </button>
      </div>
    );
  }

  const { kpi, reservaEstados, mensual, vehiculos, mantenimientoVehiculos, vehiculoMasUsado, vehiculoMayorGasto } = data;

  const pieData = reservaEstados.map((r) => ({
    name: ESTADO_LABEL[r.estado] ?? r.estado,
    value: r.total,
  }));
  const totalReservasPorEstado = pieData.reduce((total, estado) => total + estado.value, 0);

  const vehiculosBar = vehiculos.map((v) => ({
    name: v.placa,
    "Ingresos": Number(v.ingresos),
    "Reservas": v.reservas,
    "Pasajeros": v.pasajeros,
  }));

  const mantenimientoBar = (mantenimientoVehiculos || []).map((m) => ({
    name: m.placa,
    "Gasto": Number(m.gasto),
    "Servicios": m.servicios,
  }));

  const mensualChart = mensual.map((m) => ({
    mes: formatMonth(m.mes),
    "Ingresos": Number(m.ingresos),
    "Ganancia neta": Number(m.ganancias),
    "Reservas": m.reservas,
  }));

  const gastosChart = mensual.map((m) => ({
    mes: formatMonth(m.mes),
    "Ingresos": Number(m.ingresos),
    "Gastos": Number(m.gastos),
    "Ganancia neta": Number(m.ganancias),
  }));

  return (
    <div className="space-y-5 pb-24 sm:pb-0 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black uppercase italic tracking-tight text-slate-800">
            Dashboard de Rendimiento
          </h2>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
            Datos en tiempo real · TURESMA S.A.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportarExcel} disabled={exportandoExcel}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
            {exportandoExcel ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Excel con diseño
          </button>
        </div>
      </div>

      {/* ── FILTRO DE FECHAS ───────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
        <div className="flex gap-2 flex-wrap">
          {([
            { k: "todo", label: "Todo" },
            { k: "hoy", label: "Hoy" },
            { k: "mes", label: "Este mes" },
            { k: "rango", label: "Rango" },
          ] as { k: FiltroFecha; label: string }[]).map((f) => (
            <button key={f.k} onClick={() => setFiltro(f.k)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtro === f.k ? "bg-[#E31E24] text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {filtro === "rango" && (
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)}
              className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#E31E24]" />
            <span className="text-slate-400 font-bold text-xs">a</span>
            <input type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => setHasta(e.target.value)}
              className="rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-[#E31E24]" />
          </div>
        )}
        <span className="sm:ml-auto text-[10px] font-black uppercase tracking-widest text-slate-400">
          {filtro === "todo" ? "Histórico completo" : filtro === "hoy" ? "Solo hoy" : filtro === "mes" ? "Mes actual" : `${desde} → ${hasta}`}
        </span>
      </div>

      {/* ── DESTACADOS DEL PERÍODO ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-4 flex items-center gap-4">
          <div className="bg-blue-500/10 p-3 rounded-xl"><Car size={22} className="text-blue-600" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Vehículo más utilizado</p>
            {vehiculoMasUsado ? (
              <p className="text-lg font-black text-slate-800 truncate">{vehiculoMasUsado.placa}
                <span className="text-xs font-bold text-slate-400 ml-2">{Number(vehiculoMasUsado.reservas)} viajes</span>
              </p>
            ) : <p className="text-sm font-bold text-slate-300 italic">Sin datos en el período</p>}
          </div>
        </div>
        <div className="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-2xl p-4 flex items-center gap-4">
          <div className="bg-red-500/10 p-3 rounded-xl"><AlertTriangle size={22} className="text-red-600" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-400">Mayor gasto en mantenimiento</p>
            {vehiculoMayorGasto ? (
              <p className="text-lg font-black text-slate-800 truncate">{vehiculoMayorGasto.placa}
                <span className="text-xs font-bold text-[#E31E24] ml-2">{fmt(Number(vehiculoMayorGasto.gasto))}</span>
              </p>
            ) : <p className="text-sm font-bold text-slate-300 italic">Sin datos en el período</p>}
          </div>
        </div>
      </div>

      {/* ── KPI PRINCIPAL ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard
          label="Ingresos netos"
          value={fmt(kpi.ingresos)}
          sub="Cobros netos tras devoluciones"
          color="border-blue-200 bg-blue-50 text-blue-800"
          icon={DollarSign}
        />
        <KPICard
          label="Ganancias"
          value={fmt(kpi.ganancias)}
          sub="Ingresos netos menos gastos"
          color="border-emerald-200 bg-emerald-50 text-emerald-800"
          icon={TrendingUp}
        />
        <KPICard
          label="Reservas"
          value={kpi.total_reservas.toLocaleString()}
          sub={`${kpi.pendientes} pendientes`}
          color="border-amber-200 bg-amber-50 text-amber-800"
          icon={ShoppingCart}
        />
        <KPICard
          label="Gastos"
          value={fmt(kpi.gastos)}
          sub="Mantenimiento registrado"
          color="border-red-200 bg-red-50 text-red-800"
          icon={AlertTriangle}
        />
        <KPICard
          label="Margen"
          value={`${kpi.margen}%`}
          sub="Rentabilidad operativa"
          color="border-purple-200 bg-purple-50 text-purple-800"
          icon={TrendingUp}
        />
      </div>

      {/* ── KPI SECUNDARIO ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="flex min-w-0 min-h-32 flex-col items-start gap-2 rounded-2xl bg-gradient-to-br from-[#0b0f1a] to-[#1e2740] p-3 text-white shadow-lg sm:min-h-0 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
          <div className="shrink-0 rounded-xl bg-[#E31E24]/20 p-2.5"><Car size={20} className="text-[#E31E24]" /></div>
          <div className="min-w-0">
            <p className="break-words text-[9px] font-black uppercase leading-tight tracking-[0.08em] text-gray-300 sm:text-[10px] sm:tracking-widest">Vehículos activos</p>
            <p className="text-2xl font-black sm:text-3xl">{kpi.total_vehiculos}</p>
          </div>
        </div>
        <div className="flex min-w-0 min-h-32 flex-col items-start gap-2 rounded-2xl bg-gradient-to-br from-[#0b0f1a] to-[#1e2740] p-3 text-white shadow-lg sm:min-h-0 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
          <div className="shrink-0 rounded-xl bg-blue-500/20 p-2.5"><UserCircle size={20} className="text-blue-400" /></div>
          <div className="min-w-0">
            <p className="break-words text-[9px] font-black uppercase leading-tight tracking-[0.08em] text-gray-300 sm:text-[10px] sm:tracking-widest">Conductores</p>
            <p className="text-2xl font-black sm:text-3xl">{kpi.total_conductores}</p>
          </div>
        </div>
        <div className="flex min-w-0 min-h-32 flex-col items-start gap-2 rounded-2xl bg-gradient-to-br from-[#0b0f1a] to-[#1e2740] p-3 text-white shadow-lg sm:col-span-2 sm:min-h-0 sm:flex-row sm:items-center sm:gap-3 sm:p-4 md:col-span-1">
          <div className="shrink-0 rounded-xl bg-emerald-500/20 p-2.5"><Users size={20} className="text-emerald-400" /></div>
          <div className="min-w-0">
            <p className="break-words text-[9px] font-black uppercase leading-tight tracking-[0.08em] text-gray-300 sm:text-[10px] sm:tracking-widest">Clientes registrados</p>
            <p className="text-2xl font-black sm:text-3xl">{kpi.total_clientes}</p>
          </div>
        </div>
      </div>

      {/* ── FILA 1: Ingresos & Ganancias | Reservas por Estado ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Ingresos y ganancia neta por mes" description="Cobros netos agrupados por fecha de reserva; la ganancia descuenta el mantenimiento registrado.">
          {mensualChart.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin datos mensuales aún</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={mensualChart} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" interval={compactCharts ? "preserveStartEnd" : 0} minTickGap={compactCharts ? 24 : 12} tick={{ fontSize: compactCharts ? 9 : 10, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend iconSize={compactCharts ? 8 : 12} wrapperStyle={{ fontSize: compactCharts ? 9 : 11, fontWeight: 700, width: "100%" }} />
                <Line type="monotone" dataKey="Ingresos" stroke="#2563EB" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Ganancia neta" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Reservas por Estado">
          {pieData.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin reservas aún</div>
          ) : (
            <div>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS_PIE[i % COLORS_PIE.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-2 pt-1">
                {pieData.map((estado, i) => (
                  <div key={estado.name} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: COLORS_PIE[i % COLORS_PIE.length] }} />
                    <span>{estado.name}</span>
                    <span className="text-slate-900">
                      {totalReservasPorEstado > 0 ? `${Math.round((estado.value / totalReservasPorEstado) * 100)}%` : "0%"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      {/* ── FILA 2: Ingresos por Vehículo | Ingresos por Conductor ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Ingresos por Vehículo" description="Montos en USD y cantidad de reservas; cada dato usa su propia escala.">
          {vehiculosBar.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin vehículos</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={vehiculosBar} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis xAxisId="ingresos" type="number" tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <XAxis xAxisId="reservas" type="number" orientation="top" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} width={72} />
                <Tooltip formatter={(v: any, name) => name === "Ingresos" ? fmt(Number(v)) : v} />
                <Legend iconSize={compactCharts ? 8 : 12} wrapperStyle={{ fontSize: compactCharts ? 9 : 11, fontWeight: 700, width: "100%" }} />
                <Bar xAxisId="ingresos" dataKey="Ingresos" fill="#2563EB" radius={[0, 4, 4, 0]} />
                <Bar xAxisId="reservas" dataKey="Reservas" fill="#16A34A" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Gasto de Mantenimiento por Vehículo" description="Solo flota activa; cada barra compara monto en USD o número de servicios.">
          {mantenimientoBar.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin gastos de mantenimiento</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mantenimientoBar} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis xAxisId="gasto" type="number" tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <XAxis xAxisId="servicios" type="number" orientation="top" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fontWeight: 700 }} width={72} />
                <Tooltip formatter={(v: any, name) => name === "Gasto" ? fmt(Number(v)) : v} />
                <Legend iconSize={compactCharts ? 8 : 12} wrapperStyle={{ fontSize: compactCharts ? 9 : 11, fontWeight: 700, width: "100%" }} />
                <Bar xAxisId="gasto" dataKey="Gasto" fill="#DC2626" radius={[0, 4, 4, 0]} />
                <Bar xAxisId="servicios" dataKey="Servicios" fill="#D97706" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ── FILA 3: Reservas Mensuales | Ingresos vs Gastos ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Volumen de Reservas por Mes">
          {mensualChart.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin datos</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mensualChart} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" interval={compactCharts ? "preserveStartEnd" : 0} minTickGap={compactCharts ? 24 : 12} tick={{ fontSize: compactCharts ? 9 : 10, fontWeight: 700 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <Tooltip formatter={(v: any, name) => name === "Ingresos" ? fmt(Number(v)) : v} />
                <Legend iconSize={compactCharts ? 8 : 12} wrapperStyle={{ fontSize: compactCharts ? 9 : 11, fontWeight: 700, width: "100%" }} />
                <Bar yAxisId="left" dataKey="Reservas" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="Ingresos" stroke="#E31E24" strokeWidth={2.5} dot={{ r: 3 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Ingresos vs Gastos" description="Ganancia neta = ingresos menos mantenimiento reconocido en el mismo período.">
          {gastosChart.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-xs text-slate-300 font-bold">Sin datos de gastos</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={gastosChart} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gGastos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#DC2626" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gGanancias" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" interval={compactCharts ? "preserveStartEnd" : 0} minTickGap={compactCharts ? 24 : 12} tick={{ fontSize: compactCharts ? 9 : 10, fontWeight: 700 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} />
                <Legend iconSize={compactCharts ? 8 : 12} wrapperStyle={{ fontSize: compactCharts ? 9 : 11, fontWeight: 700, width: "100%" }} />
                <Area type="monotone" dataKey="Ingresos" stroke="#2563EB" strokeWidth={2} fill="url(#gIngresos)" />
                <Area type="monotone" dataKey="Gastos" stroke="#DC2626" strokeWidth={2} fill="url(#gGastos)" />
                <Area type="monotone" dataKey="Ganancia neta" stroke="#16A34A" strokeWidth={2} fill="url(#gGanancias)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ── TABLA ESTADO RESERVAS ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-[13px] font-black text-slate-700 tracking-tight">Resumen por Estado de Reserva</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          {[
            { label: "Pendientes",  value: kpi.pendientes,  color: "text-amber-600 bg-amber-50"   },
            { label: "Confirmadas", value: kpi.confirmadas, color: "text-blue-600 bg-blue-50"     },
            { label: "En Curso",    value: kpi.en_curso,    color: "text-purple-600 bg-purple-50" },
            { label: "Finalizadas", value: kpi.finalizadas, color: "text-emerald-600 bg-emerald-50" },
            { label: "Canceladas",  value: kpi.canceladas,  color: "text-red-600 bg-red-50"       },
          ].map((s) => (
            <div key={s.label} className={`flex min-w-0 flex-col items-center justify-center gap-1 px-2 py-4 text-center sm:py-6 ${s.color}`}>
              <p className="text-2xl font-black sm:text-3xl">{s.value}</p>
              <p className="max-w-full break-words text-[9px] font-black uppercase leading-tight tracking-[0.06em] opacity-70 sm:text-[10px] sm:tracking-widest">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
