"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Phone,
  IdCard,
  User,
  Upload,
  X,
  ArrowLeft,
  Bus
} from "lucide-react";
import AuthCarousel from "../../components/auth-carousel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function RegistroPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [verificationDeliveryFailed, setVerificationDeliveryFailed] = useState(false);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    nombre: "",
    email: "",
    telefono: "",
    tipoIdentificacion: "cedula",
    cedula: "",
    password: "",
    confirmarPassword: "",
  });

  const passwordMatch = useMemo(() => {
    if (!form.password || !form.confirmarPassword) return true;
    return form.password === form.confirmarPassword;
  }, [form.password, form.confirmarPassword]);

  const handleFotoUpload = async (file: File | null) => {
    if (!file) return;

    setUploadingFoto(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("imagen", file);

      const response = await fetch(`${API_URL}/api/auth/upload-perfil`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Error al subir la foto");
      }

      setFotoUrl(data.imageUrl);
      setFotoPreview(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir la foto");
    } finally {
      setUploadingFoto(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setVerificationDeliveryFailed(false);

    if (!passwordMatch) {
      setError("Las contrasenas no coinciden");
      return;
    }

    if (form.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (!form.telefono.trim()) {
      setError("Debes ingresar un numero de telefono");
      return;
    }
    const identification = form.cedula.trim();
    const validIdentification = form.tipoIdentificacion === "cedula"
      ? /^\d{10}$/.test(identification)
      : form.tipoIdentificacion === "ruc"
        ? /^\d{13}$/.test(identification)
        : /^[A-Z0-9]{5,20}$/.test(identification);
    if (!validIdentification) {
      setError(form.tipoIdentificacion === "cedula"
        ? "La cédula debe tener 10 dígitos"
        : form.tipoIdentificacion === "ruc"
          ? "El RUC debe tener 13 dígitos"
          : "El pasaporte debe tener entre 5 y 20 letras o números");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          email: form.email.trim().toLowerCase(),
          telefono: form.telefono.trim(),
          tipo_identificacion: form.tipoIdentificacion,
          cedula: form.cedula.trim(),
          password: form.password,
          foto_url: fotoUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "No se pudo crear la cuenta");
      }

      if (data.verification_sent === false) {
        setVerificationDeliveryFailed(true);
        setSuccess(data.message || "La cuenta se creó, pero no se pudo enviar el enlace de verificación. Contacta al administrador.");
        return;
      }

      setSuccess(data.message || "Cuenta creada correctamente. Revisa tu correo para verificarla.");

      setTimeout(() => {
        router.push("/login?registro=exitoso");
      }, 1800);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ocurrio un error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen bg-slate-50 font-sans">
      <AuthCarousel />

      <div className="auth-form-scroll flex min-h-screen flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
        <div className="auth-form-scroll-inner my-6 w-full max-w-[440px]">
          <div className="mb-5 flex items-center justify-between sm:mb-6">
            <Link href="/" className="group inline-flex items-center gap-2 rounded-lg text-sm font-bold text-slate-500 transition-colors hover:text-[#E31E24] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
              <ArrowLeft size={17} className="transition-transform group-hover:-translate-x-1" />
              Volver al inicio
            </Link>
            <span className="hidden text-xs font-bold uppercase tracking-[0.16em] text-slate-400 sm:inline">Crear cuenta</span>
          </div>

          <div className="rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
            <div className="mb-5 lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E31E24] text-white shadow-md shadow-red-200">
                  <Bus size={21} />
                </span>
                <span className="text-lg font-black italic tracking-tight text-slate-900">TURESMA <span className="text-[10px] not-italic text-[#E31E24]">S.A.</span></span>
              </Link>
            </div>
            <div className="mb-6">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#E31E24]">Únete a Turesma</p>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">Crea tu cuenta</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Regístrate para cotizar y reservar tus viajes con Turesma.
              </p>
          </div>

          {error && (
            <div role="alert" className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
              <AlertCircle size={18} className="shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div role="status" className={`mb-6 flex items-center gap-3 rounded-xl border p-4 text-sm font-medium ${verificationDeliveryFailed ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {verificationDeliveryFailed ? <AlertCircle size={18} className="shrink-0" /> : <CheckCircle2 size={18} className="shrink-0" />}
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* NOMBRE */}
            <div className="space-y-1.5">
              <label htmlFor="register-name" className="text-xs font-bold text-slate-700">
                {form.tipoIdentificacion === "ruc" ? "Nombre o razón social" : "Nombre completo"}
              </label>
              <div className="relative group">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                <input
                  type="text"
                  id="register-name"
                  autoComplete="name"
                  required
                  value={form.nombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej. Maria Zambrano"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                />
              </div>
            </div>

            {/* EMAIL */}
            <div className="space-y-1.5">
              <label htmlFor="register-email" className="text-xs font-bold text-slate-700">Correo electrónico</label>
              <div className="relative group">
                <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                <input
                  type="email"
                  id="register-email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="usuario@turesma.com"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                />
              </div>
            </div>

            {/* TELEFONO */}
            <div className="space-y-1.5">
              <label htmlFor="register-phone" className="text-xs font-bold text-slate-700">Número de teléfono</label>
              <div className="relative group">
                <Phone size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                <input
                  type="tel"
                  id="register-phone"
                  autoComplete="tel"
                  required
                  value={form.telefono}
                  onChange={(e) => setForm((prev) => ({ ...prev, telefono: e.target.value }))}
                  placeholder="Ej. 099 123 4567"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="register-id-type" className="text-xs font-bold text-slate-700">Tipo de identificación</label>
                <select
                  id="register-id-type"
                  value={form.tipoIdentificacion}
                  onChange={(e) => setForm((prev) => ({
                    ...prev,
                    tipoIdentificacion: e.target.value,
                    cedula: "",
                  }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-900 outline-none focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                >
                  <option value="cedula">Cédula ecuatoriana</option>
                  <option value="pasaporte">Pasaporte</option>
                  <option value="ruc">RUC ecuatoriano</option>
                </select>
                <label htmlFor="register-id" className="text-xs font-bold text-slate-700">
                  {form.tipoIdentificacion === "cedula" ? "Número de cédula" : form.tipoIdentificacion === "ruc" ? "Número de RUC" : "Número de pasaporte"}
                </label>
                <div className="relative group">
                  <IdCard size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                  <input id="register-id" type="text" required inputMode={form.tipoIdentificacion === "pasaporte" ? "text" : "numeric"} maxLength={form.tipoIdentificacion === "cedula" ? 10 : form.tipoIdentificacion === "ruc" ? 13 : 20} value={form.cedula}
                    onChange={(e) => setForm((prev) => ({ ...prev, cedula: prev.tipoIdentificacion === "pasaporte" ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) : e.target.value.replace(/\D/g, "").slice(0, prev.tipoIdentificacion === "cedula" ? 10 : 13) }))}
                    placeholder={form.tipoIdentificacion === "cedula" ? "10 dígitos" : form.tipoIdentificacion === "ruc" ? "13 dígitos" : "5 a 20 letras o números"}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100" />
                </div>
              </div>
            </div>

            {/* PASSWORD */}
            <div className="space-y-1.5">
              <label htmlFor="register-password" className="text-xs font-bold text-slate-700">Contraseña</label>
              <div className="relative group">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  id="register-password"
                  autoComplete="new-password"
                  required
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="********"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-12 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* CONFIRMAR PASSWORD */}
            <div className="space-y-1.5">
              <label htmlFor="register-confirm-password" className="text-xs font-bold text-slate-700">Confirmar contraseña</label>
              <div className="relative group">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#E31E24] transition-colors" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  id="register-confirm-password"
                  autoComplete="new-password"
                  required
                  value={form.confirmarPassword}
                  onChange={(e) => setForm((prev) => ({ ...prev, confirmarPassword: e.target.value }))}
                  placeholder="********"
                  className={`w-full rounded-xl border bg-slate-50 py-3.5 pl-12 pr-12 text-sm text-slate-900 outline-none transition-all focus:ring-4 ${!passwordMatch ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-slate-200 focus:border-[#E31E24] focus:bg-white focus:ring-red-100'}`}
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Ocultar confirmación de contraseña" : "Mostrar confirmación de contraseña"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* FOTO PERFIL (OPCIONAL) */}
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-700">Foto de perfil (opcional)</p>
              <div className="relative">
                {fotoPreview ? (
                  <div className="relative w-full h-28 rounded-lg overflow-hidden border border-emerald-300 bg-gray-50 flex items-center justify-center">
                    <Image
                      src={fotoPreview}
                      alt="preview"
                      width={200}
                      height={112}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFotoPreview(null);
                        setFotoUrl(null);
                      }}
                      className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <div className="w-full h-28 rounded-lg border border-dashed border-gray-300 bg-gray-50 hover:border-[#E31E24] transition-all flex flex-col items-center justify-center gap-2">
                      {uploadingFoto ? (
                        <>
                          <Loader2 size={22} className="text-[#E31E24] animate-spin" />
                          <span className="text-xs text-gray-500 font-medium">Subiendo...</span>
                        </>
                      ) : (
                        <>
                          <Upload size={22} className="text-gray-400" />
                          <span className="text-xs text-gray-500 font-medium">Selecciona una foto</span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFotoUpload(e.target.files?.[0] || null)}
                      className="hidden"
                      disabled={uploadingFoto}
                    />
                  </label>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E31E24] py-3.5 text-sm font-black text-white shadow-lg shadow-red-200/70 transition-all hover:bg-[#b3141a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? <Loader2 size={20} className="animate-spin" /> : (
                <>Registrarse <ChevronRight size={18} /></>
              )}
            </button>
          </form>

        </div>
          <p className="mt-5 text-center text-sm text-slate-500">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="rounded font-bold text-[#E31E24] transition-colors hover:text-red-800 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
              Inicia sesión
            </Link>
          </p>
          <p className="mt-4 text-center text-[11px] font-medium text-slate-400">Turesma S.A. · Transporte turístico y ejecutivo</p>
        </div>
      </div>
    </main>
  );
}
