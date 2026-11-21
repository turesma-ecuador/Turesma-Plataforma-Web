"use client";

import Link from "next/link";
import { Bus } from "lucide-react";
import { LocalizedContent } from "../lib/i18n";

export default function AuthCarousel() {
  const page = (
    <aside className="relative hidden h-screen w-[42%] shrink-0 overflow-hidden bg-[#081126] lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,#263b60,#081126_70%)]" />

      <Link
        href="/"
        className="absolute left-10 top-10 z-10 flex items-center gap-3 rounded-full border border-white/15 bg-[#071126]/35 px-4 py-3 transition-colors hover:bg-[#071126]/60"
      >
        <div className="rounded-full border border-yellow-400/70 bg-white p-2 shadow-lg">
          <Bus size={22} className="text-[#E31E24]" />
        </div>
        <div>
          <p className="font-black italic leading-none tracking-tighter text-white">
            TURESMA <span className="align-top text-[10px] not-italic">S.A</span>
          </p>
          <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-yellow-400">
            Transporte Turístico
          </p>
        </div>
      </Link>

      <div className="auth-carousel-copy absolute inset-x-8 top-[31%] z-10 max-w-lg rounded-3xl border border-white/10 bg-[#071126]/35 p-6 shadow-2xl shadow-black/10 backdrop-blur-sm sm:inset-x-10 sm:p-8">
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.25em] text-yellow-400">
          Turesma S.A.
        </p>
        <h2 className="text-3xl font-black italic leading-[1.08] tracking-tight text-white xl:text-5xl">
          Tu próximo viaje empieza aquí.
        </h2>
        <p className="mt-4 max-w-md text-sm font-medium leading-relaxed text-white/85">
          Transporte turístico y ejecutivo con comodidad, puntualidad y seguridad.
        </p>
      </div>
    </aside>
  );
  return <LocalizedContent>{page}</LocalizedContent>;
}
