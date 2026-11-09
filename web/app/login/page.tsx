"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ChevronRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Bus,
} from "lucide-react";
import {
  clearStoredUser,
  getRolePath,
  getStoredToken,
  getStoredUser,
  isTokenExpired,
  setStoredUser,
  setStoredToken,
} from "../../lib/session";
import AuthCarousel from "../../components/auth-carousel";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");
  const registrationNotice = searchParams.get("registro") === "exitoso"
    ? "Cuenta creada correctamente. Revisa tu correo y verifica la cuenta antes de iniciar sesión."
    : "";
  const [fieldErrors, setFieldErrors] = useState<{ email: string; password: string }>({ email: "", password: "" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const sessionRedirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const checkSession = () => {
      if (sessionRedirectTimeoutRef.current) {
        clearTimeout(sessionRedirectTimeoutRef.current);
        sessionRedirectTimeoutRef.current = null;
      }

      try {
        const storedUser = getStoredUser();
        const storedToken = getStoredToken();
        if (storedUser && storedToken && !isTokenExpired()) {
          router.replace(getRolePath(storedUser.rol));
          sessionRedirectTimeoutRef.current = setTimeout(() => {
            setError("No se pudo abrir tu sesión. Puedes volver a ingresar con tu correo y contraseña.");
            setCheckingSession(false);
          }, 12_000);
          return;
        }
        if (storedUser || storedToken) clearStoredUser();
        setCheckingSession(false);
      } catch {
        setError("El navegador no permitió comprobar la sesión. Ingresa tus credenciales para continuar.");
        setCheckingSession(false);
      }
    };

    checkSession();
    return () => {
      if (sessionRedirectTimeoutRef.current) clearTimeout(sessionRedirectTimeoutRef.current);
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextFieldErrors = {
      email: !email.trim()
        ? "Ingresa tu correo electrónico."
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          ? "Escribe un correo electrónico válido."
          : "",
      password: password.length === 0 ? "Ingresa tu contraseña." : "",
    };
    setFieldErrors(nextFieldErrors);
    setError("");

    if (nextFieldErrors.email || nextFieldErrors.password) {
      if (nextFieldErrors.email) emailInputRef.current?.focus();
      else passwordInputRef.current?.focus();
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        signal: AbortSignal.timeout(25_000),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error((data?.error as string) || "No se pudo iniciar sesion");
      }

      const user = (data?.user ?? {}) as Record<string, unknown>;
      const token = data?.token as string | undefined;
      setStoredUser(user);
      if (token) setStoredToken(token);
      router.replace(getRolePath(String(user.rol || "")));
    } catch (submitError) {
      const storageBlocked =
        submitError instanceof DOMException &&
        ["SecurityError", "QuotaExceededError"].includes(submitError.name);
      setError(
        storageBlocked
          ? "El navegador bloqueó el almacenamiento de sesión. Permite el almacenamiento del sitio e inténtalo de nuevo."
          : submitError instanceof Error && submitError.name === "TimeoutError"
          ? "El inicio de sesión está tardando demasiado. Revisa tu conexión e inténtalo de nuevo."
          : submitError instanceof Error
            ? submitError.message
            : "Ocurrio un error inesperado",
      );
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center p-6">
        <Loader2 size={28} className="animate-spin text-[#E31E24]" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen bg-slate-50 font-sans">
      <AuthCarousel />

      <div className="login-content flex min-h-screen flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="login-content-inner auth-form-scroll-inner w-full max-w-[440px]">
          <div className="mb-5 flex items-center justify-between sm:mb-6">
            <Link href="/" className="inline-flex items-center gap-2 rounded-lg text-sm font-bold text-slate-500 transition-colors hover:text-[#E31E24] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100 group">
              <ArrowLeft size={17} className="transition-transform group-hover:-translate-x-1" />
              Volver al inicio
            </Link>
            <span className="hidden text-xs font-bold uppercase tracking-[0.16em] text-slate-400 sm:inline">Acceso seguro</span>
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
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-[#E31E24]">Bienvenido de nuevo</p>
              <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Inicia sesión</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Ingresa tus credenciales para acceder a tu cuenta de Turesma.
              </p>
            </div>

            {error && (
              <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {registrationNotice && (
              <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                <Mail size={18} className="mt-0.5 shrink-0" />
                <span>{registrationNotice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-xs font-bold text-slate-700">Correo electrónico</label>
                <div className="group relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#E31E24]" />
                  <input
                    id="login-email"
                    ref={emailInputRef}
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={email}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldErrors((current) => ({ ...current, email: "" }));
                      setError("");
                    }}
                    placeholder="usuario@turesma.com"
                    className={`w-full rounded-xl border bg-slate-50 py-3.5 pl-12 pr-4 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-4 sm:text-sm ${
                      fieldErrors.email
                        ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                        : "border-slate-200 focus:border-[#E31E24] focus:ring-red-100"
                    }`}
                  />
                </div>
                {fieldErrors.email && <p id="login-email-error" className="text-xs font-semibold text-red-600" role="alert">{fieldErrors.email}</p>}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="login-password" className="text-xs font-bold text-slate-700">Contraseña</label>
                  <Link href="/recuperar" className="rounded text-xs font-bold text-[#E31E24] transition-colors hover:text-red-800 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
                    ¿Olvidaste tu clave?
                  </Link>
                </div>
                <div className="group relative">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#E31E24]" />
                  <input
                    id="login-password"
                    ref={passwordInputRef}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((current) => ({ ...current, password: "" }));
                      setError("");
                    }}
                    placeholder="Ingresa tu contraseña"
                    className={`w-full rounded-xl border bg-slate-50 py-3.5 pl-12 pr-12 text-base text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:bg-white focus:ring-4 sm:text-sm ${
                      fieldErrors.password
                        ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                        : "border-slate-200 focus:border-[#E31E24] focus:ring-red-100"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {fieldErrors.password && <p id="login-password-error" className="text-xs font-semibold text-red-600" role="alert">{fieldErrors.password}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-live="polite"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#E31E24] py-3.5 text-sm font-black text-white shadow-lg shadow-red-200/70 transition-all hover:-translate-y-0.5 hover:bg-[#b3141a] hover:shadow-red-300/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200 active:translate-y-0 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 size={19} className="animate-spin" />
                    Validando sesión...
                  </>
                ) : (
                  <>
                    Iniciar sesión
                    <ChevronRight size={18} />
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-500">
              ¿No tienes cuenta?{" "}
              <Link href="/registro" className="rounded font-bold text-[#E31E24] transition-colors hover:text-red-800 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">
                Regístrate
              </Link>
            </p>
          </div>
          <p className="mt-6 text-center text-[11px] font-medium text-slate-400">Turesma S.A. · Transporte turístico y ejecutivo</p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-white flex items-center justify-center p-6"><Loader2 size={28} className="animate-spin text-[#E31E24]" /></main>}>
      <LoginPageContent />
    </Suspense>
  );
}
