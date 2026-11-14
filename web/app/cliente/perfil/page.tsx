"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  User, Mail, Phone, Lock, Camera, Loader2, Save,
  CheckCircle2, ShieldCheck, IdCard, Clock, XCircle,
} from "lucide-react";
import { getAuthHeaders, getStoredUser, setStoredUser, handleUnauthorized } from "../../../lib/session";
import { useClienteGuard } from "../../../lib/use-cliente-guard";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { LocalizedContent } from "../../../lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Perfil = { id: number; nombre: string; email: string; pending_email?: string | null; rol: string; telefono?: string | null; imagen_url?: string | null };
type Verif = { estado_verificacion: string; cedula: string | null; tipo_identificacion?: string | null; cedula_url?: string | null; selfie_cedula_url?: string | null; email_verified_at?: string | null; pending_email?: string | null; notas_verificacion: string | null };

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-[#E31E24] focus:ring-2 focus:ring-[#E31E24]/10 disabled:bg-slate-50 disabled:text-slate-400";

const ESTADO = {
  verificado: { label: "Verificado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  pendiente: { label: "En revisión", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  rechazado: { label: "Rechazado", cls: "bg-red-100 text-red-600 border-red-200" },
  no_verificado: { label: "Sin verificar", cls: "bg-slate-100 text-slate-500 border-slate-200" },
} as const;

export default function ClientePerfilPage() {
  const { checkingSession } = useClienteGuard();
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

  // Verificación de identidad
  const [verif, setVerif] = useState<Verif | null>(null);
  const [cedula, setCedula] = useState("");
  const [tipoIdentificacion, setTipoIdentificacion] = useState("cedula");
  const [cedulaFile, setCedulaFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [enviandoVerif, setEnviandoVerif] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/me`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) {
        const u: Perfil = (await res.json()).user;
        setPerfil(u); setNombre(u.nombre || ""); setTelefono(u.telefono || ""); setImagenUrl(u.imagen_url || null);
      }
      const vres = await fetch(`${API}/api/usuarios/verificacion`, { headers: getAuthHeaders() });
      if (vres.ok) {
        const vd: Verif = await vres.json();
        setVerif(vd); setCedula(vd.cedula || ""); setTipoIdentificacion(vd.tipo_identificacion || "cedula");
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (checkingSession) return;
    load();
     
  }, [checkingSession]);

  // Refresco silencioso: solo actualiza el estado de verificación (no toca los
  // campos que el usuario podría estar editando), para reflejar en vivo cuando
  // el administrador aprueba o rechaza sin recargar la página.
  useAutoRefresh(() => {
    fetch(`${API}/api/usuarios/verificacion`, { headers: getAuthHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((vd) => { if (vd) setVerif(vd); })
      .catch(() => {});
  }, { enabled: !checkingSession, immediate: false });

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

  const enviarVerif = async () => {
    setErr(""); setMsg("");
    const validIdentification = tipoIdentificacion === "cedula"
      ? /^\d{10}$/.test(cedula.trim())
      : tipoIdentificacion === "ruc"
        ? /^\d{13}$/.test(cedula.trim())
        : /^[A-Z0-9]{5,20}$/.test(cedula.trim().toUpperCase());
    if (!validIdentification) { setErr("Revisa el tipo y formato de tu identificación"); return; }
    if (!cedulaFile || !selfieFile) { setErr("Debes adjuntar una foto de tu documento de identificación y una selfie sosteniéndolo"); return; }
    setEnviandoVerif(true);
    try {
      const subir = async (file: File, tipo: string) => {
        const fd = new FormData(); fd.append("imagen", file); fd.append("tipo", tipo);
        const headers = getAuthHeaders();
        delete headers["Content-Type"];
        const upload = await fetch(`${API}/api/usuarios/verificacion/documento`, { method: "POST", headers, body: fd });
        const result = await upload.json();
        if (!upload.ok) throw new Error(result?.error || "No se pudo subir el documento");
        return result.imageUrl as string;
      };
      const cedulaUrl = await subir(cedulaFile, "cedula");
      const selfieUrl = await subir(selfieFile, "selfie");
      const res = await fetch(`${API}/api/usuarios/verificacion`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ cedula: cedula.trim(), tipo_identificacion: tipoIdentificacion, cedula_url: cedulaUrl, selfie_cedula_url: selfieUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudo enviar");
      setMsg(data.message || "Documento enviado para verificación");
      setVerif({ estado_verificacion: "pendiente", cedula: cedula.trim(), tipo_identificacion: tipoIdentificacion, cedula_url: cedulaUrl, selfie_cedula_url: selfieUrl, notas_verificacion: null });
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setEnviandoVerif(false); }
  };

  if (checkingSession || loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>;

  const estado = (verif?.estado_verificacion || "no_verificado") as keyof typeof ESTADO;
  const estadoInfo = ESTADO[estado] || ESTADO.no_verificado;

  return (
    <LocalizedContent>
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* CABECERA */}
      <div data-tour-target="portal-profile" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
        <div className="relative shrink-0">
          {imagenUrl ? (
            <Image src={imagenUrl} alt="Perfil" width={96} height={96} sizes="96px" className="w-24 h-24 rounded-2xl object-cover border border-slate-200" />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-slate-100 flex items-center justify-center"><User size={38} className="text-slate-300" /></div>
          )}
          <label className="absolute -bottom-2 -right-2 bg-[#E31E24] hover:bg-[#b3141a] p-2.5 rounded-xl cursor-pointer shadow-md transition-all text-white">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            <input type="file" accept="image/*" className="hidden" onChange={e => handlePhoto(e.target.files?.[0] || null)} disabled={uploading} />
          </label>
        </div>
        <div className="w-full min-w-0 flex-1 sm:w-auto">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Cliente</p>
          <h1 data-no-translate className="whitespace-normal break-words text-xl font-black text-slate-900 sm:truncate sm:text-2xl">{perfil?.nombre}</h1>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center justify-center gap-1.5 text-sm text-slate-500 sm:justify-start">
            <Mail size={13} className="shrink-0" />
            <span className="min-w-0 break-all">{perfil?.email}</span>
          </p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border ${estadoInfo.cls}`}>
          <ShieldCheck size={13} /> {estadoInfo.label}
        </span>
      </div>

      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-medium rounded-r-lg flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-medium rounded-r-lg flex items-center gap-2"><XCircle size={16} />{err}</div>}

      {/* VERIFICACIÓN DE IDENTIDAD */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><IdCard size={16} className="text-[#E31E24]" /> Verificación de identidad</h2>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${estadoInfo.cls}`}>{estadoInfo.label}</span>
        </div>

        {estado === "verificado" ? (
          <div className="flex items-center gap-3 bg-emerald-50 rounded-xl p-4 text-emerald-700">
            <CheckCircle2 size={22} className="shrink-0" />
            <p className="text-sm font-medium">Tu identidad está verificada. Ya puedes solicitar y confirmar tus servicios sin restricciones.</p>
          </div>
        ) : estado === "pendiente" ? (
          <div className="flex items-center gap-3 bg-amber-50 rounded-xl p-4 text-amber-700">
            <Clock size={22} className="shrink-0" />
            <p className="text-sm font-medium">Tus fotos están en revisión. El administrador verificará tu documento y tu selfie.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500">Para solicitar servicios necesitas verificar tu identidad. Sube una foto clara de tu documento y una selfie sosteniéndolo; luego confirma tu correo electrónico.</p>
            {estado === "rechazado" && verif?.notas_verificacion && (
              <div className="flex items-start gap-2 bg-red-50 rounded-lg p-3 text-red-600 text-xs font-medium">
                <XCircle size={16} className="shrink-0 mt-0.5" /> Rechazado: {verif.notas_verificacion}. Vuelve a intentarlo.
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500">Tipo de identificación</label>
              <select value={tipoIdentificacion} onChange={e => setTipoIdentificacion(e.target.value)} className={INPUT}>
                <option value="cedula">Cédula ecuatoriana</option>
                <option value="pasaporte">Pasaporte</option>
                <option value="ruc">RUC ecuatoriano</option>
              </select>
              <label className="text-xs font-semibold text-slate-500">
                {tipoIdentificacion === "cedula" ? "Número de cédula" : tipoIdentificacion === "ruc" ? "Número de RUC" : "Número de pasaporte"}
              </label>
              <div className="relative"><IdCard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                <input value={cedula} onChange={e => setCedula(tipoIdentificacion === "pasaporte" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) : e.target.value.replace(/\D/g, "").slice(0, tipoIdentificacion === "cedula" ? 10 : 13))} className={INPUT + " pl-9"} placeholder={tipoIdentificacion === "cedula" ? "10 dígitos" : tipoIdentificacion === "ruc" ? "13 dígitos" : "5 a 20 letras o números"} inputMode={tipoIdentificacion === "pasaporte" ? "text" : "numeric"} />
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3">
                {verif?.email_verified_at ? <CheckCircle2 className="text-emerald-500" size={20} /> : <Clock className="text-amber-500" size={20} />}
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Verificación de correo</h2>
                  <p className="text-xs text-slate-500">
                    {verif?.pending_email
                      ? `Cambio pendiente de verificación para ${verif.pending_email}.`
                      : verif?.email_verified_at
                        ? "Tu correo electrónico está verificado."
                        : "Debes confirmar el enlace enviado a tu correo electrónico."}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 cursor-pointer hover:border-[#E31E24]">
                <span className="font-semibold block mb-1">Foto frontal del documento</span>
                <span>{cedulaFile?.name || "Seleccionar imagen"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => setCedulaFile(e.target.files?.[0] || null)} />
              </label>
              <label className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 cursor-pointer hover:border-[#E31E24]">
                <span className="font-semibold block mb-1">Selfie sosteniendo el documento</span>
                <span>{selfieFile?.name || "Seleccionar imagen"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => setSelfieFile(e.target.files?.[0] || null)} />
              </label>
            </div>
            <button onClick={enviarVerif} disabled={enviandoVerif} className="w-full py-3 bg-[#E31E24] hover:bg-[#b3141a] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {enviandoVerif ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Enviar documentos para revisión
            </button>
          </>
        )}
      </div>

      {/* DATOS PERSONALES (incluye cambio de contraseña) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><User size={16} className="text-[#E31E24]" /> Datos personales</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Nombre</label>
            <div className="relative"><User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input value={nombre} onChange={e => setNombre(e.target.value)} className={INPUT + " pl-9"} /></div></div>
          <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-500">Teléfono</label>
            <div className="relative"><Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" /><input value={telefono} onChange={e => setTelefono(e.target.value)} className={INPUT + " pl-9"} placeholder="099 123 4567" /></div></div>
          <div className="space-y-1.5 sm:col-span-2"><label className="text-xs font-semibold text-slate-500">Correo (cambio solo por administración y con verificación)</label>
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
    </LocalizedContent>
  );
}
