"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { Calculator, CheckCircle2, Loader2, Save, XCircle } from "lucide-react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";

const API = API_BASE_URL;
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-[#E31E24] focus:ring-2 focus:ring-[#E31E24]/10";

type Tarifas = {
  tarifa_diaria: number; precio_km: number; tarifa_viaje: number; recargo_peajes: number; minimo_km: number;
  tarifa_van: number; tarifa_bus: number; tarifa_suv: number; tarifa_minibus: number; tarifa_sedan: number;
  traslado_van: number; traslado_bus: number; traslado_suv: number; traslado_minibus: number; traslado_sedan: number;
  hora_van: number; hora_bus: number; hora_suv: number; hora_minibus: number; hora_sedan: number;
  medio_dia_van: number; medio_dia_bus: number; medio_dia_suv: number; medio_dia_minibus: number; medio_dia_sedan: number;
  oferta_activa: boolean; oferta_dia: string; descuento_oferta_pct: number; oferta_descripcion: string;
};

const tarifasIniciales: Tarifas = {
  tarifa_diaria: 80, precio_km: 0.8, tarifa_viaje: 15, recargo_peajes: 0, minimo_km: 0,
  tarifa_van: 80, tarifa_bus: 120, tarifa_suv: 110, tarifa_minibus: 95, tarifa_sedan: 70,
  traslado_van: 35, traslado_bus: 55, traslado_suv: 50, traslado_minibus: 42, traslado_sedan: 30,
  hora_van: 15, hora_bus: 25, hora_suv: 22, hora_minibus: 19, hora_sedan: 14,
  medio_dia_van: 55, medio_dia_bus: 85, medio_dia_suv: 78, medio_dia_minibus: 68, medio_dia_sedan: 50,
  oferta_activa: false, oferta_dia: "lunes", descuento_oferta_pct: 0, oferta_descripcion: "Oferta del día",
};

const normalizarTarifas = (data: Partial<Tarifas>): Tarifas => ({
  tarifa_diaria: Number(data.tarifa_diaria ?? 80), precio_km: Number(data.precio_km ?? 0.8), tarifa_viaje: Number(data.tarifa_viaje ?? 15),
  recargo_peajes: Number(data.recargo_peajes ?? 0), minimo_km: Number(data.minimo_km ?? 0),
  tarifa_van: Number(data.tarifa_van ?? data.tarifa_diaria ?? 80), tarifa_bus: Number(data.tarifa_bus ?? data.tarifa_diaria ?? 120),
  tarifa_suv: Number(data.tarifa_suv ?? data.tarifa_diaria ?? 110), tarifa_minibus: Number(data.tarifa_minibus ?? data.tarifa_diaria ?? 95),
  tarifa_sedan: Number(data.tarifa_sedan ?? data.tarifa_diaria ?? 70), oferta_activa: Boolean(data.oferta_activa),
  traslado_van: Number(data.traslado_van ?? 35), traslado_bus: Number(data.traslado_bus ?? 55), traslado_suv: Number(data.traslado_suv ?? 50), traslado_minibus: Number(data.traslado_minibus ?? 42), traslado_sedan: Number(data.traslado_sedan ?? 30),
  hora_van: Number(data.hora_van ?? 15), hora_bus: Number(data.hora_bus ?? 25), hora_suv: Number(data.hora_suv ?? 22), hora_minibus: Number(data.hora_minibus ?? 19), hora_sedan: Number(data.hora_sedan ?? 14),
  medio_dia_van: Number(data.medio_dia_van ?? 55), medio_dia_bus: Number(data.medio_dia_bus ?? 85), medio_dia_suv: Number(data.medio_dia_suv ?? 78), medio_dia_minibus: Number(data.medio_dia_minibus ?? 68), medio_dia_sedan: Number(data.medio_dia_sedan ?? 50),
  oferta_dia: String(data.oferta_dia || "lunes"), descuento_oferta_pct: Number(data.descuento_oferta_pct || 0),
  oferta_descripcion: String(data.oferta_descripcion || "Oferta del día"),
});

export default function AdminTarifasPage() {
  const { checkingSession } = useAdminGuard();
  const [tarifas, setTarifas] = useState<Tarifas>(tarifasIniciales);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (checkingSession) return;
    fetch(`${API}/api/admin/tarifas`, { headers: getAuthHeaders(), cache: "no-store" })
      .then(async res => {
        if (handleUnauthorized(res.status)) return null;
        return res.ok ? res.json() : null;
      })
      .then(data => { if (data) setTarifas(normalizarTarifas(data)); })
      .catch(() => setErr("No se pudieron cargar las tarifas"))
      .finally(() => setLoading(false));
  }, [checkingSession]);

  const handleSave = async () => {
    setMsg(""); setErr(""); setSaving(true);
    try {
      const res = await fetch(`${API}/api/admin/tarifas`, {
        method: "PUT", headers: getAuthHeaders(), body: JSON.stringify(tarifas),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudieron guardar las tarifas");
      setTarifas(normalizarTarifas(data));
      setMsg("Tarifas actualizadas. Los clientes verán los cambios automáticamente.");
    } catch (e) { setErr(e instanceof Error ? e.message : "No se pudieron guardar las tarifas"); }
    finally { setSaving(false); }
  };

  if (checkingSession || loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-red-50 p-3 text-[#E31E24]"><Calculator size={22} /></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Configuración comercial</p><h1 className="text-2xl font-black text-slate-900">Tarifas de cotización</h1><p className="mt-1 text-sm text-slate-500">Define la fórmula que se aplica según el vehículo, la distancia, los viajes y las ofertas.</p></div>
        </div>
      </div>

      {msg && <div className="flex items-center gap-2 rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 p-4 text-sm font-medium text-emerald-700"><CheckCircle2 size={16} />{msg}</div>}
      {err && <div className="flex items-center gap-2 rounded-r-lg border-l-4 border-red-500 bg-red-50 p-4 text-sm font-medium text-red-700"><XCircle size={16} />{err}</div>}

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            ["tarifa_diaria", "Tarifa base por día ($)"], ["precio_km", "Precio por kilómetro ($)"], ["tarifa_viaje", "Tarifa por viaje ($)"], ["recargo_peajes", "Peajes / recargo fijo ($)"], ["minimo_km", "Kilómetros mínimos cobrables"],
            ["tarifa_van", "Van por día ($)"], ["tarifa_bus", "Bus por día ($)"], ["tarifa_suv", "SUV por día ($)"], ["tarifa_minibus", "Minibus por día ($)"], ["tarifa_sedan", "Sedan por día ($)"],
            ["traslado_van", "Traslado Van ($)"], ["traslado_bus", "Traslado Bus ($)"], ["traslado_suv", "Traslado SUV ($)"], ["traslado_minibus", "Traslado Minibus ($)"], ["traslado_sedan", "Traslado Sedan ($)"],
            ["hora_van", "Hora Van ($)"], ["hora_bus", "Hora Bus ($)"], ["hora_suv", "Hora SUV ($)"], ["hora_minibus", "Hora Minibus ($)"], ["hora_sedan", "Hora Sedan ($)"],
            ["medio_dia_van", "Medio día Van ($)"], ["medio_dia_bus", "Medio día Bus ($)"], ["medio_dia_suv", "Medio día SUV ($)"], ["medio_dia_minibus", "Medio día Minibus ($)"], ["medio_dia_sedan", "Medio día Sedan ($)"],
          ] as const).map(([field, label]) => <div key={field} className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">{label}</label><input type="number" min="0" step="0.01" value={tarifas[field]} onChange={e => setTarifas(p => ({ ...p, [field]: Number(e.target.value) }))} className={INPUT} /></div>)}
        </div>

        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Oferta activa</label><button type="button" onClick={() => setTarifas(p => ({ ...p, oferta_activa: !p.oferta_activa }))} className={`w-full rounded-xl border px-4 py-3 text-sm font-bold transition-all ${tarifas.oferta_activa ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{tarifas.oferta_activa ? "Oferta activada" : "Oferta desactivada"}</button></div>
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Día de oferta</label><select value={tarifas.oferta_dia} onChange={e => setTarifas(p => ({ ...p, oferta_dia: e.target.value }))} className={INPUT}>{["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].map(day => <option key={day} value={day}>{day}</option>)}</select></div>
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Descuento de oferta (%)</label><input type="number" min="0" max="100" step="0.1" value={tarifas.descuento_oferta_pct} onChange={e => setTarifas(p => ({ ...p, descuento_oferta_pct: Number(e.target.value) }))} className={INPUT} /></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-xs font-semibold text-slate-500">Descripción de la oferta</label><input value={tarifas.oferta_descripcion} onChange={e => setTarifas(p => ({ ...p, oferta_descripcion: e.target.value }))} className={INPUT} placeholder="Oferta del día, paquete especial, etc." /></div>
        </div>

        <button onClick={handleSave} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-bold text-white transition-all hover:bg-black disabled:opacity-60">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}{saving ? "Guardando tarifas..." : "Guardar tarifas"}</button>
      </div>
    </div>
  );
}