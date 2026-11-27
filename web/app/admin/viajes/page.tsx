"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { Edit3, MapPin, Plus, Trash2, X } from "lucide-react";
import { getAuthHeaders } from "../../../lib/session";

const API = API_BASE_URL;
type Vehicle = { id: number; placa: string; modelo: string; capacidad: number; imagen_url?: string | null; estado: string; activo: boolean };
type Trip = { id: number; titulo: string; origen: string; destino: string; precio: number; cupos_totales: number; cupos_disponibles: number; capacidad_personas: number; activo: boolean; vehiculo_id?: number | null; vehiculo_placa?: string | null; vehiculo_modelo?: string | null; vehiculo_imagen_url?: string | null; imagenes?: string[] };
type FormState = { titulo: string; origen: string; destino: string; precio: string; tipo_servicio: string; descripcion: string; vehiculo_id: string; imagenes: string[] };
const emptyForm = (): FormState => ({ titulo: "", origen: "", destino: "", precio: "", tipo_servicio: "viaje", descripcion: "", vehiculo_id: "", imagenes: [] });

const readResponse = async (response: Response) => {
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : { error: (await response.text()).slice(0, 300) };
};

export default function AdminViajesPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const headers = getAuthHeaders();
    const [tripResponse, vehicleResponse] = await Promise.all([
      fetch(`${API}/api/admin/viajes`, { headers }),
      fetch(`${API}/api/admin/vehiculos`, { headers }),
    ]);
    const trips = await readResponse(tripResponse);
    const vehicles = await readResponse(vehicleResponse);
    if (tripResponse.ok) setTrips(trips.data || []); else setError(trips.error || "No se pudieron cargar los viajes");
    if (vehicleResponse.ok) setVehicles(Array.isArray(vehicles) ? vehicles : vehicles.data || []);
  };

  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const input = event.currentTarget.elements.namedItem("imagenes") as HTMLInputElement | null;
      let images = form.imagenes;
      if (input?.files?.length) {
        const authToken = getAuthHeaders().Authorization;
        const uploaded: string[] = [];
        for (const file of Array.from(input.files).slice(0, 8)) {
          const body = new FormData();
          body.append("imagen", file);
          const upload = await fetch(`${API}/api/admin/uploads/galeria-imagen`, { method: "POST", headers: authToken ? { Authorization: authToken } : {}, body });
          const uploadData = await readResponse(upload);
          if (!upload.ok) throw new Error(uploadData.error || "No se pudo guardar una imagen");
          if (uploadData.imageUrl) uploaded.push(uploadData.imageUrl);
        }
        images = uploaded;
      }
      const response = await fetch(`${API}/api/admin/viajes${editing ? `/${editing}` : ""}`, {
        method: editing ? "PUT" : "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, imagenes: images, precio: Number(form.precio), vehiculo_id: Number(form.vehiculo_id) }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el viaje");
      setMessage(editing ? "Viaje actualizado" : "Viaje publicado"); setOpen(false); setEditing(null); setForm(emptyForm()); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el viaje"); }
    finally { setSaving(false); }
  };

  const edit = (trip: Trip) => {
    setEditing(trip.id); setForm({ titulo: trip.titulo, origen: trip.origen, destino: trip.destino, precio: String(trip.precio), tipo_servicio: "viaje", descripcion: "", vehiculo_id: String(trip.vehiculo_id || ""), imagenes: trip.imagenes || [] }); setOpen(true);
  };

  const remove = async (trip: Trip) => {
    if (!window.confirm(`¿Retirar el viaje ${trip.origen} - ${trip.destino}?`)) return;
    const response = await fetch(`${API}/api/admin/viajes/${trip.id}`, { method: "DELETE", headers: getAuthHeaders() });
    if (response.ok) { setMessage("Viaje retirado"); await load(); }
  };

  return <main className="space-y-6">
    <header className="flex flex-col justify-between gap-4 rounded-3xl bg-[#111827] p-6 text-white sm:flex-row sm:items-end"><div><p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">Catálogo comercial</p><h1 className="mt-2 text-3xl font-black">Viajes publicados</h1><p className="mt-2 text-sm text-slate-300">Publica una ruta con vehículo, precio y fotografías.</p></div><button onClick={() => { setEditing(null); setForm(emptyForm()); setOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E31E24] px-4 py-3 text-sm font-black text-white"><Plus size={17} /> Publicar viaje</button></header>
    {(message || error) && <p className={`rounded-xl p-3 text-sm font-bold ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{error || message}</p>}
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{trips.map((trip) => <article key={trip.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">{trip.vehiculo_imagen_url && <Image src={trip.vehiculo_imagen_url} alt={`Vehículo ${trip.vehiculo_placa || ""}`} width={640} height={160} unoptimized className="h-40 w-full object-cover" />}<div className="p-5"><div className="flex justify-between"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${trip.activo ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>{trip.activo ? "Publicado" : "Retirado"}</span><span className="text-xs font-bold text-slate-400">#{trip.id}</span></div><h2 className="mt-4 text-xl font-black text-slate-900">{trip.titulo}</h2><p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-600"><MapPin size={15} className="text-[#E31E24]" />{trip.origen} <span>→</span> {trip.destino}</p><p className="mt-2 text-xs font-bold text-slate-500">Vehículo: {trip.vehiculo_placa || "Sin asignar"} · {trip.vehiculo_modelo || ""}</p><div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500"><span className="rounded-xl bg-red-50 p-3">Precio de ruta<br /><b className="text-lg text-red-700">${Number(trip.precio).toFixed(2)}</b></span><span className="rounded-xl bg-slate-50 p-3">Capacidad del vehículo<br /><b>{trip.capacidad_personas} personas</b></span><span className="rounded-xl bg-slate-50 p-3">Disponibles para reservar<br /><b>{trip.cupos_disponibles} personas</b></span><span className="rounded-xl bg-slate-50 p-3">Fotos destino<br /><b>{trip.imagenes?.length || 0}</b></span></div><div className="mt-4 flex gap-2"><button onClick={() => edit(trip)} className="flex-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700"><Edit3 size={14} className="mr-1 inline" /> Editar</button><button onClick={() => void remove(trip)} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600"><Trash2 size={14} /></button></div></div></article>)}</section>
    {!trips.length && <div className="rounded-3xl border border-dashed border-slate-300 p-12 text-center text-sm font-bold text-slate-400">Todavía no hay viajes publicados.</div>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><form onSubmit={save} className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-3xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-black">{editing ? "Editar viaje" : "Publicar viaje"}</h2><button type="button" onClick={() => setOpen(false)}><X /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Título<input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" placeholder="Ej. Manta a Puerto López" required /></label><label className="text-xs font-black uppercase text-slate-500">Lugar de salida<input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" required /></label><label className="text-xs font-black uppercase text-slate-500">Lugar de destino<input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" required /></label><label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Vehículo<select value={form.vehiculo_id} onChange={(e) => setForm({ ...form, vehiculo_id: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" required><option value="">Selecciona el vehículo</option>{vehicles.filter((vehicle) => vehicle.activo && vehicle.estado !== "inactivo").map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.placa} · {vehicle.modelo} · {vehicle.capacidad} personas</option>)}</select>{form.vehiculo_id && <span className="mt-1 block text-[10px] normal-case text-slate-400">Capacidad del vehículo: {vehicles.find((vehicle) => String(vehicle.id) === form.vehiculo_id)?.capacidad || "—"} personas</span>}</label><label className="text-xs font-black uppercase text-slate-500">Precio de la ruta<input type="number" min="0" step="0.01" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} className="mt-1 w-full rounded-xl border p-3 text-sm" required /></label><label className="text-xs font-black uppercase text-slate-500 sm:col-span-2">Fotos del destino<input name="imagenes" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 w-full rounded-xl border p-3 text-sm normal-case" /><span className="mt-1 block text-[10px] normal-case text-slate-400">Hasta 8 fotos. El cliente elegirá fecha, hora y ubicación al comprar.</span></label></div><button disabled={saving} className="w-full rounded-xl bg-[#E31E24] py-3 font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar y publicar"}</button></form></div>}
  </main>;
}
