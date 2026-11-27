"use client";

import { API_BASE_URL } from "@/lib/api-url";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Building2, Loader2, Plus, RefreshCw, Truck, X } from "lucide-react";
import { getAuthHeaders, normalizeRole } from "../../../lib/session";
import { useAdminGuard } from "../../../lib/use-admin-guard";

const API = API_BASE_URL;

type PartnerVehicle = {
  id: number;
  empresa_id: number;
  placa: string;
  modelo: string;
  capacidad: number;
  conductor: string | null;
  conductor_telefono: string | null;
  activo: boolean;
};

type PartnerCompany = {
  id: number;
  nombre: string;
  identificacion: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  activa: boolean;
  notas: string | null;
  vehiculos: PartnerVehicle[];
};

type PartnerCompanyForm = {
  nombre: string;
  identificacion: string;
  contacto: string;
  telefono: string;
  email: string;
};

type VehicleForm = {
  placa: string;
  modelo: string;
  capacidad: string;
  conductor: string;
  conductor_telefono: string;
};

type DeactivationPrompt = {
  kind: "company" | "vehicle";
  id: number;
  name: string;
  affectedServices: number;
};

const EMPTY_COMPANY: PartnerCompanyForm = {
  nombre: "",
  identificacion: "",
  contacto: "",
  telefono: "",
  email: "",
};

const EMPTY_VEHICLE: VehicleForm = {
  placa: "",
  modelo: "",
  capacidad: "",
  conductor: "",
  conductor_telefono: "",
};

const readJson = async (response: Response) => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo completar la solicitud");
  return data;
};

export default function EmpresasAsociadasPage() {
  const { user, checkingSession } = useAdminGuard();
  const isAdmin = normalizeRole(user?.rol) === "admin";
  const [companies, setCompanies] = useState<PartnerCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY);
  const [editingCompany, setEditingCompany] = useState<PartnerCompany | null>(null);
  const [editCompanyForm, setEditCompanyForm] = useState(EMPTY_COMPANY);
  const [vehicleForms, setVehicleForms] = useState<Record<number, VehicleForm>>({});
  const [editingVehicle, setEditingVehicle] = useState<PartnerVehicle | null>(null);
  const [editVehicleForm, setEditVehicleForm] = useState<VehicleForm>(EMPTY_VEHICLE);
  const [deactivationPrompt, setDeactivationPrompt] = useState<DeactivationPrompt | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`${API}/api/admin/empresas-asociadas`, { headers: getAuthHeaders() });
      const payload = await readJson(response);
      setCompanies(payload.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las empresas asociadas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!checkingSession && isAdmin) void load(true);
  }, [checkingSession, isAdmin, load]);

  const saveCompany = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API}/api/admin/empresas-asociadas`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(companyForm),
      });
      await readJson(response);
      setCompanyForm(EMPTY_COMPANY);
      setMessage("Empresa asociada registrada.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo registrar la empresa");
    } finally {
      setSaving(false);
    }
  };

  const saveVehicle = async (event: FormEvent, companyId: number) => {
    event.preventDefault();
    const form = vehicleForms[companyId] || EMPTY_VEHICLE;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API}/api/admin/empresas-asociadas/${companyId}/vehiculos`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, capacidad: Number(form.capacidad) }),
      });
      await readJson(response);
      setVehicleForms((current) => ({ ...current, [companyId]: EMPTY_VEHICLE }));
      setMessage("Vehículo asociado registrado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo registrar el vehículo");
    } finally {
      setSaving(false);
    }
  };

  const updateAvailability = async (
    target: { kind: "company"; id: number; name: string; active: boolean } | { kind: "vehicle"; id: number; name: string; active: boolean },
    confirmedServiceCount?: number,
  ) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(target.kind === "company"
        ? `${API}/api/admin/empresas-asociadas/${target.id}`
        : `${API}/api/admin/empresas-asociadas/vehiculos/${target.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          [target.kind === "company" ? "activa" : "activo"]: !target.active,
          ...(confirmedServiceCount === undefined ? {} : {
            confirmar_servicios_afectados: true,
            servicios_afectados_confirmados: confirmedServiceCount,
          }),
        }),
      });
      const payload = await response.json();
      if (response.status === 409 && payload.confirmacion_requerida === true) {
        setDeactivationPrompt({
          kind: target.kind,
          id: target.id,
          name: target.name,
          affectedServices: Number(payload.servicios_afectados),
        });
        return;
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar la disponibilidad");
      setDeactivationPrompt(null);
      setMessage(target.active
        ? `${target.kind === "company" ? "La empresa quedó desactivada" : "El vehículo quedó desactivado"} para nuevas asignaciones. Los servicios existentes se conservaron.`
        : `${target.kind === "company" ? "Empresa" : "Vehículo"} activado.`);
      await load();
    } catch (availabilityError) {
      setError(availabilityError instanceof Error ? availabilityError.message : "No se pudo actualizar la disponibilidad");
    } finally {
      setSaving(false);
    }
  };

  const toggleCompany = (company: PartnerCompany) => updateAvailability({
    kind: "company",
    id: company.id,
    name: company.nombre,
    active: company.activa,
  });

  const editCompany = (company: PartnerCompany) => {
    setEditingCompany(company);
    setEditCompanyForm({
      nombre: company.nombre,
      identificacion: company.identificacion || "",
      contacto: company.contacto || "",
      telefono: company.telefono || "",
      email: company.email || "",
    });
  };

  const saveCompanyEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingCompany) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API}/api/admin/empresas-asociadas/${editingCompany.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(editCompanyForm),
      });
      await readJson(response);
      setEditingCompany(null);
      setMessage("Datos de empresa actualizados.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar la empresa");
    } finally {
      setSaving(false);
    }
  };

  const toggleVehicle = (vehicle: PartnerVehicle) => updateAvailability({
    kind: "vehicle",
    id: vehicle.id,
    name: `${vehicle.placa} · ${vehicle.modelo}`,
    active: vehicle.activo,
  });

  const editVehicle = (vehicle: PartnerVehicle) => {
    setEditingVehicle(vehicle);
    setEditVehicleForm({
      placa: vehicle.placa,
      modelo: vehicle.modelo,
      capacidad: String(vehicle.capacidad),
      conductor: vehicle.conductor || "",
      conductor_telefono: vehicle.conductor_telefono || "",
    });
  };

  const saveVehicleEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingVehicle) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${API}/api/admin/empresas-asociadas/vehiculos/${editingVehicle.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...editVehicleForm, capacidad: Number(editVehicleForm.capacidad) }),
      });
      await readJson(response);
      setEditingVehicle(null);
      setMessage("Vehículo asociado actualizado.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo actualizar el vehículo");
    } finally {
      setSaving(false);
    }
  };

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" /></div>;
  if (!isAdmin) return <div className="rounded-2xl border border-red-100 bg-white p-8 text-center font-bold text-red-700">Solo administración puede gestionar empresas asociadas.</div>;

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 rounded-3xl bg-slate-950 p-6 text-white sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">Proveedores de transporte</p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">Empresas asociadas</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Administra empresas y vehículos externos disponibles para asignaciones de Turesma. No se crean cuentas de acceso para los proveedores.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 self-start rounded-xl bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20"><RefreshCw size={16} />Actualizar</button>
      </header>

      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}

      <form onSubmit={saveCompany} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <h2 className="flex items-center gap-2 font-black text-slate-900 md:col-span-2 xl:col-span-5"><Building2 size={18} className="text-[#E31E24]" />Registrar empresa</h2>
        <input required maxLength={160} placeholder="Nombre de la empresa" aria-label="Nombre de la empresa" value={companyForm.nombre} onChange={(event) => setCompanyForm({ ...companyForm, nombre: event.target.value })} className="rounded-xl border p-3 text-sm" />
        <input maxLength={30} placeholder="RUC / identificación" aria-label="RUC o identificación" value={companyForm.identificacion} onChange={(event) => setCompanyForm({ ...companyForm, identificacion: event.target.value })} className="rounded-xl border p-3 text-sm" />
        <input maxLength={120} placeholder="Persona de contacto" aria-label="Persona de contacto" value={companyForm.contacto} onChange={(event) => setCompanyForm({ ...companyForm, contacto: event.target.value })} className="rounded-xl border p-3 text-sm" />
        <input maxLength={40} type="tel" placeholder="Teléfono de contacto" aria-label="Teléfono de contacto" value={companyForm.telefono} onChange={(event) => setCompanyForm({ ...companyForm, telefono: event.target.value })} className="rounded-xl border p-3 text-sm" />
        <input maxLength={160} type="email" placeholder="Correo" aria-label="Correo de la empresa" value={companyForm.email} onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })} className="rounded-xl border p-3 text-sm" />
        <button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E31E24] p-3 text-sm font-black text-white disabled:opacity-50 md:col-span-2 xl:col-span-5"><Plus size={17} />Agregar empresa</button>
      </form>

      {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" /></div> : companies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm font-semibold text-slate-500">Aún no hay empresas asociadas registradas.</div>
      ) : (
        <div className="space-y-4">
          {companies.map((company) => (
            <section key={company.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><h2 className="text-lg font-black text-slate-900">{company.nombre}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${company.activa ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{company.activa ? "Activa" : "Inactiva"}</span></div>
                  <p className="mt-1 text-sm text-slate-600">{[company.identificacion, company.contacto, company.telefono, company.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
                </div>
                <div className="flex gap-2">
                  <button disabled={saving} onClick={() => editCompany(company)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Editar datos</button>
                  <button disabled={saving} onClick={() => void toggleCompany(company)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">{company.activa ? "Desactivar empresa" : "Activar empresa"}</button>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
                <div className="space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500"><Truck size={15} />Vehículos ({company.vehiculos.length})</h3>
                  {company.vehiculos.length === 0 ? <p className="text-sm text-slate-400">Sin vehículos registrados.</p> : company.vehiculos.map((vehicle) => (
                    <div key={vehicle.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
                      <div><p className="text-sm font-black text-slate-800">{vehicle.placa} · {vehicle.modelo}</p><p className="text-xs text-slate-500">{vehicle.capacidad} pasajeros{vehicle.conductor ? ` · ${vehicle.conductor}` : ""}{vehicle.conductor_telefono ? ` · ${vehicle.conductor_telefono}` : ""}</p></div>
                      <div className="flex gap-2">
                        <button disabled={saving} onClick={() => editVehicle(vehicle)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Editar</button>
                        <button disabled={saving} onClick={() => void toggleVehicle(vehicle)} className={`rounded-lg px-3 py-2 text-xs font-bold ${vehicle.activo ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{vehicle.activo ? "Activo" : "Inactivo"}</button>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={(event) => void saveVehicle(event, company.id)} className="grid content-start gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 sm:col-span-2">Agregar vehículo externo</h3>
                  <input required maxLength={30} placeholder="Placa" aria-label={`Placa para ${company.nombre}`} value={(vehicleForms[company.id] || EMPTY_VEHICLE).placa} onChange={(event) => setVehicleForms({ ...vehicleForms, [company.id]: { ...(vehicleForms[company.id] || EMPTY_VEHICLE), placa: event.target.value } })} className="rounded-lg border p-2.5 text-sm" />
                  <input required maxLength={120} placeholder="Modelo / tipo" aria-label={`Modelo para ${company.nombre}`} value={(vehicleForms[company.id] || EMPTY_VEHICLE).modelo} onChange={(event) => setVehicleForms({ ...vehicleForms, [company.id]: { ...(vehicleForms[company.id] || EMPTY_VEHICLE), modelo: event.target.value } })} className="rounded-lg border p-2.5 text-sm" />
                  <input required type="number" min="1" max="300" placeholder="Capacidad" aria-label={`Capacidad para ${company.nombre}`} value={(vehicleForms[company.id] || EMPTY_VEHICLE).capacidad} onChange={(event) => setVehicleForms({ ...vehicleForms, [company.id]: { ...(vehicleForms[company.id] || EMPTY_VEHICLE), capacidad: event.target.value } })} className="rounded-lg border p-2.5 text-sm" />
                  <input maxLength={120} placeholder="Conductor habitual" aria-label={`Conductor de ${company.nombre}`} value={(vehicleForms[company.id] || EMPTY_VEHICLE).conductor} onChange={(event) => setVehicleForms({ ...vehicleForms, [company.id]: { ...(vehicleForms[company.id] || EMPTY_VEHICLE), conductor: event.target.value } })} className="rounded-lg border p-2.5 text-sm" />
                  <input maxLength={40} type="tel" placeholder="Teléfono del conductor" aria-label={`Teléfono del conductor de ${company.nombre}`} value={(vehicleForms[company.id] || EMPTY_VEHICLE).conductor_telefono} onChange={(event) => setVehicleForms({ ...vehicleForms, [company.id]: { ...(vehicleForms[company.id] || EMPTY_VEHICLE), conductor_telefono: event.target.value } })} className="rounded-lg border p-2.5 text-sm sm:col-span-2" />
                  <button disabled={saving || !company.activa} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 p-2.5 text-sm font-bold text-white disabled:opacity-40 sm:col-span-2"><Plus size={15} />Registrar vehículo</button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
      {editingCompany && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={saveCompanyEdit} className="w-full max-w-xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-widest text-[#E31E24]">Empresa asociada</p><h2 className="mt-1 text-xl font-black text-slate-950">Editar datos</h2></div><button type="button" onClick={() => setEditingCompany(null)} aria-label="Cerrar edición"><X size={20} /></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input required maxLength={160} aria-label="Nombre de la empresa" value={editCompanyForm.nombre} onChange={(event) => setEditCompanyForm({ ...editCompanyForm, nombre: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={30} aria-label="RUC o identificación" placeholder="RUC / identificación" value={editCompanyForm.identificacion} onChange={(event) => setEditCompanyForm({ ...editCompanyForm, identificacion: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={120} aria-label="Contacto" placeholder="Persona de contacto" value={editCompanyForm.contacto} onChange={(event) => setEditCompanyForm({ ...editCompanyForm, contacto: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={40} type="tel" aria-label="Teléfono" placeholder="Teléfono" value={editCompanyForm.telefono} onChange={(event) => setEditCompanyForm({ ...editCompanyForm, telefono: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={160} type="email" aria-label="Correo" placeholder="Correo" value={editCompanyForm.email} onChange={(event) => setEditCompanyForm({ ...editCompanyForm, email: event.target.value })} className="rounded-xl border p-3 text-sm sm:col-span-2" />
            </div>
            <div className="flex gap-3"><button type="button" onClick={() => setEditingCompany(null)} className="flex-1 rounded-xl border py-3 text-sm font-bold text-slate-600">Cancelar</button><button disabled={saving} className="flex-1 rounded-xl bg-slate-950 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar cambios"}</button></div>
          </form>
        </div>
      )}
      {editingVehicle && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <form onSubmit={saveVehicleEdit} className="w-full max-w-xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-widest text-[#E31E24]">Vehículo externo</p><h2 className="mt-1 text-xl font-black text-slate-950">Editar datos</h2></div><button type="button" onClick={() => setEditingVehicle(null)} aria-label="Cerrar edición"><X size={20} /></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <input required maxLength={30} aria-label="Placa" value={editVehicleForm.placa} onChange={(event) => setEditVehicleForm({ ...editVehicleForm, placa: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input required maxLength={120} aria-label="Modelo o tipo" value={editVehicleForm.modelo} onChange={(event) => setEditVehicleForm({ ...editVehicleForm, modelo: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input required type="number" min="1" max="300" aria-label="Capacidad" value={editVehicleForm.capacidad} onChange={(event) => setEditVehicleForm({ ...editVehicleForm, capacidad: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={120} aria-label="Conductor habitual" placeholder="Conductor habitual" value={editVehicleForm.conductor} onChange={(event) => setEditVehicleForm({ ...editVehicleForm, conductor: event.target.value })} className="rounded-xl border p-3 text-sm" />
              <input maxLength={40} type="tel" aria-label="Teléfono del conductor" placeholder="Teléfono del conductor" value={editVehicleForm.conductor_telefono} onChange={(event) => setEditVehicleForm({ ...editVehicleForm, conductor_telefono: event.target.value })} className="rounded-xl border p-3 text-sm sm:col-span-2" />
            </div>
            <div className="flex gap-3"><button type="button" onClick={() => setEditingVehicle(null)} className="flex-1 rounded-xl border py-3 text-sm font-bold text-slate-600">Cancelar</button><button disabled={saving} className="flex-1 rounded-xl bg-slate-950 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Guardando..." : "Guardar cambios"}</button></div>
          </form>
        </div>
      )}
      {deactivationPrompt && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="deactivation-title" className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-amber-700">Revisión operativa</p>
              <h2 id="deactivation-title" className="mt-1 text-xl font-black text-slate-950">Confirmar desactivación</h2>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              <strong>{deactivationPrompt.name}</strong> tiene <strong>{deactivationPrompt.affectedServices} {deactivationPrompt.affectedServices === 1 ? "servicio futuro asignado" : "servicios futuros asignados"}</strong>.
              Desactivarlo impedirá nuevas asignaciones, pero no cancelará ni reasignará los servicios existentes. Revisa esos compromisos después de confirmar.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" disabled={saving} onClick={() => setDeactivationPrompt(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void updateAvailability({
                  kind: deactivationPrompt.kind,
                  id: deactivationPrompt.id,
                  name: deactivationPrompt.name,
                  active: true,
                }, deactivationPrompt.affectedServices)}
                className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {saving ? "Confirmando..." : "Desactivar y revisar servicios"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
