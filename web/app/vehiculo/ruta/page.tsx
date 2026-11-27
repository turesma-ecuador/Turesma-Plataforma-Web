"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, Calendar, DollarSign, FileText, CheckCircle2,
  Loader2, Save, Minus, Plus, Bus, User, History, MapPin,
} from "lucide-react";
import { useConductorPanel } from "../_components/use-conductor-panel";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { MapPicker, Punto } from "../../../components/map-picker";

const API = API_BASE_URL;

type Cliente = { id: number; nombre: string; email: string; telefono?: string | null };

const INPUT = "w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:text-slate-300 placeholder:font-normal";
const hoyISO = () => new Date().toISOString().slice(0, 10);

export default function ConductorRegistrarRutaPage() {
  const { checkingSession, user, vehiculo } = useConductorPanel();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [origin, setOrigin] = useState<Punto | null>(null);
  const [destination, setDestination] = useState<Punto | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [ultimaReserva, setUltimaReserva] = useState<number | null>(null);

  const [form, setForm] = useState({
    cliente_id: "", fecha_viaje: hoyISO(), num_personas: "1",
    valor_cobrado: "", notas: "",
  });

  const step = (delta: number) =>
    setForm(p => ({ ...p, num_personas: String(Math.max(1, (Number(p.num_personas) || 1) + delta)) }));

  useEffect(() => {
    if (checkingSession || !user?.id) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/conductor/${user.id}/clientes`, { headers: getAuthHeaders() });
        if (handleUnauthorized(res.status)) return;
        if (res.ok) setClientes(await res.json());
      } catch { /* silencio */ }
    })();
  }, [checkingSession, user?.id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");
    if (!form.cliente_id) { setErr("Selecciona el cliente del viaje."); return; }
    if (!origin || !destination) { setErr("Marca la salida y el destino en el mapa."); return; }
    if (!form.valor_cobrado || Number(form.valor_cobrado) <= 0) { setErr("Indica el valor cobrado (ya acordado con el cliente)."); return; }

    setSending(true);
    try {
      const res = await fetch(`${API}/api/conductor/${user?.id}/registrar-viaje`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          cliente_id: Number(form.cliente_id),
          fecha_viaje: form.fecha_viaje,
          num_personas: Number(form.num_personas) || 1,
          valor_cobrado: Number(form.valor_cobrado),
          origen: origin.label,
          destino: destination.label,
          notas: form.notas || null,
        }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo registrar el viaje");
      setMsg(data.message || "Viaje registrado correctamente");
      setUltimaReserva(data.reserva?.id || null);
      setForm({ cliente_id: "", fecha_viaje: hoyISO(), num_personas: "1", valor_cobrado: "", notas: "" });
      setOrigin(null); setDestination(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSending(false); }
  };

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* VEHÍCULO ASIGNADO (automático) */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
        <Bus size={18} className="text-blue-500 flex-shrink-0" />
        <p className="text-xs font-bold text-blue-700">
          {vehiculo && vehiculo.placa !== "SIN VEHÍCULO"
            ? <>El viaje se registrará con tu vehículo asignado: <span className="uppercase italic font-black">{vehiculo.placa}</span>{vehiculo.modelo && vehiculo.modelo !== "-" ? ` · ${vehiculo.modelo}` : ""}</>
            : "No tienes vehículo asignado — contacta al administrador antes de registrar viajes."}
        </p>
      </div>

      {msg && (
        <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded-r-xl space-y-2">
          <p className="text-emerald-700 text-sm font-bold flex items-center gap-2"><CheckCircle2 size={16} />{msg}{ultimaReserva ? ` (Reserva #${ultimaReserva})` : ""}</p>
          <Link href="/vehiculo/historial" className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600 underline underline-offset-4">
            <History size={12} /> Ver en mi historial
          </Link>
        </div>
      )}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}

      {/* FORMULARIO */}
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-slate-200 shadow-xl p-5 sm:p-6 space-y-6">

        {/* PASO 1: CLIENTE */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><User size={12} /> 1. Elige el cliente</p>
          <select value={form.cliente_id} onChange={e => setForm(p => ({ ...p, cliente_id: e.target.value }))} className={INPUT + " cursor-pointer"} required>
            <option value="">Seleccionar cliente…</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre} — {c.email}</option>)}
          </select>
        </div>

        {/* PASO 2: FECHA Y PERSONAS */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><Calendar size={12} /> 2. Fecha y pasajeros</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-slate-500 flex items-center gap-1.5"><Calendar size={14} /> Fecha</span>
              <input type="date" value={form.fecha_viaje} max={hoyISO()} onChange={e => setForm(p => ({ ...p, fecha_viaje: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-[#E31E24]" />
            </div>
            <div className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-500 flex items-center gap-1.5"><Users size={14} /> Personas</span>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => step(-1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Minus size={14} /></button>
                <span className="w-6 text-center font-black text-slate-800">{form.num_personas}</span>
                <button type="button" onClick={() => step(1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600"><Plus size={14} /></button>
              </div>
            </div>
          </div>
        </div>

        {/* PASO 3: MAPA */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><MapPin size={12} /> 3. Marca la salida y el destino</p>
          <MapPicker origin={origin} destination={destination} onChange={(w, v) => (w === "origin" ? setOrigin(v) : setDestination(v))} />
        </div>

        {/* PASO 4: VALOR Y NOTAS */}
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><DollarSign size={12} /> 4. Valor acordado</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor cobrado ($) *</label>
              <div className="relative"><DollarSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                <input type="number" min="0" step="0.01" value={form.valor_cobrado} onChange={e => setForm(p => ({ ...p, valor_cobrado: e.target.value }))} className={INPUT + " pl-9"} placeholder="Ej: 150.00" required /></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1"><FileText size={12} /> Notas (opcional)</label>
              <input value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} className={INPUT} placeholder="Detalles del viaje…" />
            </div>
          </div>
        </div>

        <button type="submit" disabled={sending}
          className="w-full py-4 bg-[#E31E24] hover:bg-black text-white font-black text-sm uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-red-200 flex items-center justify-center gap-2 disabled:opacity-60">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {sending ? "Guardando…" : "Guardar viaje"}
        </button>
      </form>
    </div>
  );
}
