"use client";


import { API_BASE_URL } from "@/lib/api-url";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

const API = API_BASE_URL;

export default function VerificarCorreoPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const verificationStarted = useRef(false);

  useEffect(() => {
    if (verificationStarted.current) return;
    verificationStarted.current = true;

    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      Promise.resolve().then(() => {
        setStatus("error");
        setMessage("El enlace de verificación no contiene un token válido.");
      });
      return;
    }
    fetch(`${API}/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo verificar el correo");
        setStatus("success");
        setMessage(data.message || "Tu correo fue verificado correctamente. Ya puedes iniciar sesión.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "No se pudo verificar el correo");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        {status === "loading" && <Loader2 className="mx-auto animate-spin text-[#E31E24]" size={42} />}
        {status === "success" && <CheckCircle2 className="mx-auto text-emerald-500" size={48} />}
        {status === "error" && <XCircle className="mx-auto text-red-500" size={48} />}
        <h1 className="mt-4 text-2xl font-black text-slate-900">
          {status === "loading" ? "Verificando correo..." : status === "success" ? "Correo verificado" : "Enlace no válido"}
        </h1>
        <p className="mt-3 text-sm text-slate-500">{message || "Espera un momento."}</p>
        {status !== "loading" && (
          <Link href="/login" className="mt-6 inline-block rounded-xl bg-[#E31E24] px-5 py-3 text-sm font-bold text-white">
            Ir al inicio de sesión
          </Link>
        )}
      </div>
    </main>
  );
}
