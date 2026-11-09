"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Bus
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function RecuperarPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pinRequested, setPinRequested] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRequestPin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo enviar el PIN");
      }

      setPinRequested(true);
      setMessage(data.message || "Si el correo existe, enviamos el PIN.");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Ocurrió un error inesperado"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          pin,
          new_password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar la contraseña");
      }

      router.replace("/login");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Ocurrió un error inesperado"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-5 py-8 font-sans sm:px-8">
      <div className="w-full max-w-[440px]">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
        <Link href="/login" className="mb-7 inline-flex items-center gap-2 rounded-lg text-sm font-bold text-slate-500 transition-colors hover:text-[#E31E24] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
          <ArrowLeft size={17} />
          Volver al inicio de sesión
        </Link>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E31E24] text-white shadow-md shadow-red-200">
            <Bus size={22} />
          </div>
          <div>
            <p className="text-base font-black italic tracking-tight text-slate-900">TURESMA <span className="text-[10px] not-italic text-[#E31E24]">S.A.</span></p>
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Acceso seguro</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#E31E24]">Recuperar acceso</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">¿Olvidaste tu contraseña?</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">Te enviaremos un PIN para verificar tu correo y crear una contraseña nueva.</p>
        </div>

          {error ? (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {message ? (
            <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              <ShieldCheck size={16} className="shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}

          {!pinRequested ? (
            <form onSubmit={handleRequestPin} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="recovery-email" className="text-xs font-bold text-slate-700">Correo electrónico</label>
                <div className="relative group">
                  <Mail size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#E31E24] transition-colors" />
                  <input
                    id="recovery-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                    placeholder="correo@turesma.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E31E24] py-3.5 text-sm font-black text-white shadow-lg shadow-red-200/70 transition-all hover:bg-[#b3141a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : "Enviar PIN de Seguridad"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="recovery-email-confirm" className="text-xs font-bold text-slate-700">Correo electrónico</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input
                    id="recovery-email-confirm"
                    type="email"
                    value={email}
                    disabled
                    className="w-full rounded-xl border border-slate-200 bg-slate-100 py-3.5 pl-12 pr-4 text-sm text-slate-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="recovery-pin" className="text-xs font-bold text-slate-700">PIN de 6 dígitos</label>
                <div className="relative group">
                  <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#E31E24]" />
                  <input
                    id="recovery-pin"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 text-sm font-black tracking-[0.5em] text-slate-900 outline-none transition-all focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                    placeholder="000000"
                    maxLength={6}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="recovery-new-password" className="text-xs font-bold text-slate-700">Nueva contraseña</label>
                <div className="relative group">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#E31E24]" />
                  <input
                    id="recovery-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3.5 pl-12 text-sm text-slate-900 outline-none transition-all focus:border-[#E31E24] focus:bg-white focus:ring-4 focus:ring-red-100"
                    minLength={6}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E31E24] py-3.5 text-sm font-black text-white shadow-lg shadow-red-200/70 transition-all hover:bg-[#b3141a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : "Actualizar Contraseña"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPinRequested(false);
                  setPin("");
                  setNewPassword("");
                  setError("");
                  setMessage("");
                }}
                className="w-full rounded-lg py-2 text-xs font-bold text-slate-500 transition-colors hover:text-[#E31E24] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
              >
                ¿No recibiste el PIN? Intentar de nuevo
              </button>
            </form>
          )}

      </section>
      <p className="mt-5 text-center text-[11px] font-medium text-slate-400">Turesma S.A. · Transporte turístico y ejecutivo</p>
      </div>
    </main>
  );
}