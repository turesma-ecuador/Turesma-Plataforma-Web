"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  User, Mail, Phone, Lock, Camera, Loader2, Save,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, getStoredUser, setStoredUser, handleUnauthorized } from "../../../lib/session";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Perfil = { id: number; nombre: string; email: string; rol: string; telefono?: string | null; imagen_url?: string | null };
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-[#E31E24] focus:ring-2 focus:ring-[#E31E24]/10 disabled:bg-slate-50 disabled:text-slate-400";

export default function AdminConfiguracionPage() {
  const { checkingSession } = useAdminGuard();
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [imagenUrl, setImagenUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/me`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) {
        const u: Perfil = (await res.json()).user;
        const stored = getStoredUser();
        setStoredUser(stored ? { ...stored, ...u } : u);
        setPerfil(u); setNombre(u.nombre || ""); setTelefono(u.telefono || ""); setImagenUrl(u.imagen_url || null);
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (checkingSession) return;
    load();
     
  }, [checkingSession]);

  const handlePhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true); setErr("");
    try {
      const fd = new FormData(); fd.append("imagen", file);
      const res = await fetch(`${API}/api/auth/upload-perfil`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Error al subir la foto");
      setImagenUrl(data.imageUrl);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    setErr(""); setMsg("");
    if (password && password !== password2) { setErr("Las contraseñas no coinciden"); return; }
    if (password && password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres"); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { nombre, telefono, imagen_url: imagenUrl };
      if (password) body.password = password;
      const res = await fetch(`${API}/api/auth/me`, { method: "PUT", headers: getAuthHeaders(), body: JSON.stringify(body) });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
      setMsg("Perfil actualizado correctamente");
      setPassword(""); setPassword2("");
      const stored = getStoredUser();
      if (stored) setStoredUser({ ...stored, nombre: data.user.nombre, imagen_url: data.user.imagen_url });
      setPerfil(data.user);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSaving(false); }
  };

  if (checkingSession || loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* CABECERA */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
        <div className="relative shrink-0">
          {imagenUrl ? (
            <Image src={imagenUrl} alt="Perfil" width={96} height={96} unoptimized className="w-24 h-24 rounded-2xl object-cover border border-slate-200" />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-slate-100 flex items-center justify-center"><User size={38} className="text-slate-300" /></div>
          )}
          <label className="absolute -bottom-2 -right-2 bg-[#E31E24] hover:bg-[#b3141a] p-2.5 rounded-xl cursor-pointer shadow-md transition-all text-white">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            <input type="file" accept="image/*" className="hidden" onChange={e => handlePhoto(e.target.files?.[0] || null)} disabled={uploading} />
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Administrador</p>
          <h1 className="text-2xl font-black text-slate-900 truncate">{perfil?.nombre}</h1>
          <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5 justify-center sm:justify-start"><Mail size={13} /> {perfil?.email}</p>
        </div>
      </div>

      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-medium rounded-r-lg flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-medium rounded-r-lg flex items-center gap-2"><XCircle size={16} />{err}</div>}

      {/* DATOS PERSONALES (incluye cambio de contraseña) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><User size={16} className="text-[#E31E24]" /> Datos personales</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Nombre</label>
            <div className="relative"><User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input value={nombre} onChange={e => setNombre(e.target.value)} className={INPUT + " pl-9"} /></div></div>
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Teléfono</label>
            <div className="relative"><Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input value={telefono} onChange={e => setTelefono(e.target.value)} className={INPUT + " pl-9"} placeholder="099 123 4567" /></div></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-xs font-semibold text-slate-500">Correo (no editable)</label>
            <div className="relative"><Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input value={perfil?.email || ""} disabled className={INPUT + " pl-9"} /></div></div>
        </div>

        {/* Cambio de contraseña (opcional) */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex items-center gap-2">
            <Lock size={15} className="text-[#E31E24]" />
            <h3 className="text-xs font-bold text-slate-700">Cambiar contraseña</h3>
            <span className="text-[11px] text-slate-400">(opcional — déjalo en blanco si no la cambias)</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={INPUT} placeholder="Nueva contraseña" />
            <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} className={INPUT} placeholder="Confirmar" />
          </div>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="w-full py-3.5 bg-[#E31E24] hover:bg-[#b3141a] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}{saving ? "Guardando..." : "Guardar cambios"}
      </button>

    </div>
  );
}
