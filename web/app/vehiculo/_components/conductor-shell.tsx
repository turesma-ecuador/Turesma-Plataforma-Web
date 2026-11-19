"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useRef } from "react";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  MapPinned,
  Zap,
  X,
  User,
  Truck,
  History,
  Wrench,
  CalendarClock,
} from "lucide-react";
import { clearStoredUser } from "../../../lib/session";
import { ConductorPanelProvider, useConductorPanelState } from "./use-conductor-panel";
import { NotificationBell } from "../../../components/notification-bell";
import { useMobileMenuAccessibility } from "../../../lib/use-mobile-menu-accessibility";

type MenuItemType = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
};

type ConductorShellProps = {
  children: React.ReactNode;
};

const menuItems: MenuItemType[] = [
  { href: "/vehiculo", label: "Inicio", icon: LayoutDashboard },
  { href: "/vehiculo/activas", label: "Viajes Activos", icon: Truck },
  { href: "/vehiculo/historial", label: "Historial", icon: History },
  { href: "/vehiculo/mantenimiento", label: "Mantenimiento", icon: Wrench },
  { href: "/vehiculo/disponibilidad", label: "Mi disponibilidad", icon: CalendarClock },
  { href: "/vehiculo/ruta", label: "Registrar Ruta", icon: MapPinned },
  { href: "/vehiculo/perfil", label: "Perfil", icon: User },
];

export function ConductorShell({ children }: ConductorShellProps) {
  const pathname = usePathname();
  const panelState = useConductorPanelState();
  const { user } = panelState;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  useMobileMenuAccessibility(isMobileMenuOpen, setIsMobileMenuOpen, mobileMenuRef, mobileMenuTriggerRef);

  const isActive = (href: string) => {
    if (href === "/vehiculo") return pathname === "/vehiculo";
    return pathname.startsWith(href);
  };

  const currentSection = (() => {
    const active = menuItems.find((item) => isActive(item.href));
    return active?.label || "Panel de Conductor";
  })();

  const handleLogout = () => {
    clearStoredUser();
    window.location.assign("/api/auth/logout");
  };

  return (
    <ConductorPanelProvider value={panelState}>
      <div className="min-h-screen bg-[#f8f9fa] flex font-sans text-[#1a1a1a]">

      {/* ═══════════ SIDEBAR DESKTOP — ESTILO PREMIUM DARK ═══════════ */}
      <aside className="hidden lg:flex w-72 flex-col bg-[#0b0f1a] text-white fixed h-full shadow-[10px_0_30px_rgba(0,0,0,0.1)] z-50">
        <div className="p-8 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#E31E24] rounded-2xl flex items-center justify-center shadow-lg shadow-red-600/20 transform -rotate-3">
              <Truck size={28} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black italic tracking-tighter leading-none text-white">
                TURESMA <span className="text-[10px] not-italic text-yellow-400">S.A</span>
              </h1>
              <span className="text-[9px] text-gray-500 uppercase tracking-[0.3em] font-bold mt-1">Panel Conductor</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto custom-scrollbar">
          <p className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-widest mb-4">Navegación</p>
          {menuItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all duration-300 ${
                  active
                    ? "bg-[#E31E24] text-white shadow-xl shadow-red-600/20"
                    : "text-gray-500 hover:bg-white/5 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-xl transition-colors ${active ? "bg-white/20" : "group-hover:bg-white/5"}`}>
                    <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                  </div>
                  <span className={`text-sm font-bold tracking-tight ${active ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`}>
                    {item.label}
                  </span>
                </div>
                {active && <Zap size={14} className="text-yellow-400 fill-yellow-400 animate-pulse" />}
              </Link>
            );
          })}
        </nav>

        {/* PERFIL CONDUCTOR SIDEBAR */}
        <div className="p-4 bg-[#080b14] border-t border-white/5">
          <div className="bg-white/5 rounded-[1.5rem] p-4 border border-white/5 shadow-inner">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-slate-700 to-slate-800 flex items-center justify-center text-sm font-black border border-white/10 text-white" suppressHydrationWarning>
                  {user ? String(user.nombre || "CO").slice(0, 2).toUpperCase() : "CO"}
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-[#0b0f1a] rounded-full shadow-lg"></div>
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold truncate text-white">
                  {user?.nombre || "Conductor"}
                </p>
                <p className="text-[10px] text-gray-400 truncate">Conductor</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#E31E24]/10 hover:bg-[#E31E24] text-[#E31E24] hover:text-white rounded-xl transition-all duration-300 text-[10px] font-black tracking-widest border border-[#E31E24]/20 group"
            >
              <LogOut size={14} className="group-hover:-translate-x-1 transition-transform" />
              CERRAR SESIÓN
            </button>
          </div>
        </div>
      </aside>

      {/* ═══════════ MOBILE SIDEBAR ═══════════ */}
      <aside
        id="conductor-mobile-navigation"
        ref={mobileMenuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación del conductor"
        aria-hidden={!isMobileMenuOpen}
        inert={!isMobileMenuOpen}
        className={`fixed inset-y-0 left-0 z-[70] flex h-dvh w-72 max-w-[85vw] flex-col bg-[#0b0f1a] text-white transform transition-transform duration-500 ease-in-out lg:hidden ${isMobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <div className="p-8 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E31E24] rounded-lg flex items-center justify-center font-bold">
              <Truck size={18} />
            </div>
            <span className="font-black italic tracking-tighter uppercase">Turesma</span>
          </div>
          <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="Cerrar menú" className="flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 transition-colors hover:bg-white/5"><X size={20} /></button>
        </div>
        <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
          {menuItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl transition-all ${isActive(item.href) ? "bg-[#E31E24] text-white" : "text-gray-300 hover:bg-white/5"}`}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span className="font-bold text-sm uppercase tracking-tight">{item.label}</span>
                </div>
              </Link>
          ))}
        </nav>
        <div className="mt-auto shrink-0 border-t border-white/5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-gray-300 hover:bg-white/5 hover:text-red-400 transition-all"
          >
            <LogOut size={20} />
            <span className="font-bold text-sm uppercase tracking-tight">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ═══════════ MAIN CONTENT AREA ═══════════ */}
      <main className="flex-1 flex flex-col lg:ml-72 h-screen relative min-w-0 overflow-hidden">

        {/* HEADER SUPERIOR — GLASSMORPHISM */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-200 px-3 py-2 sm:px-6 sm:py-4 flex items-center justify-between shadow-sm h-14 sm:h-16">
          <div className="flex items-center gap-3">
            <button ref={mobileMenuTriggerRef} className="lg:hidden flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 text-[#E31E24] transition-all hover:bg-red-50" onClick={() => setIsMobileMenuOpen(true)} type="button" aria-label="Abrir menú" aria-expanded={isMobileMenuOpen} aria-controls="conductor-mobile-navigation">
              <Menu size={24} />
            </button>
            {/* Logo + sección (visible en móvil, donde el sidebar está oculto) */}
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-8 h-8 bg-[#E31E24] rounded-lg flex items-center justify-center">
                <Truck size={18} className="text-white" />
              </div>
              <span className="text-sm font-bold text-gray-900">{currentSection}</span>
            </div>
            <h2 className="hidden lg:block text-sm font-semibold text-gray-500">{currentSection}</h2>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <NotificationBell userId={user?.id} accent="red" portal="vehiculo" />

            <div className="flex items-center gap-3 border-l border-gray-200 pl-3 md:pl-6">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-semibold text-gray-900 leading-tight">{user?.nombre || "Conductor"}</p>
                <p className="text-[11px] text-gray-400">Conductor</p>
              </div>
              {user?.imagen_url ? (
                <div className="w-11 h-11 rounded-2xl overflow-hidden shadow-lg shadow-red-600/20 transform transition-transform hover:scale-105 border-2 border-red-400">
                  <Image src={user.imagen_url} alt={user?.nombre || "Conductor"} fill sizes="40px" unoptimized className="object-cover" />
                </div>
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-[#E31E24] flex items-center justify-center text-white shadow-lg shadow-red-600/20 transform transition-transform hover:scale-105">
                  <User size={22} strokeWidth={2.5} />
                </div>
              )}
            </div>
          </div>
        </header>

        {/* SECTION CONTENT */}
        <section className="p-3 md:p-10 flex-1 overflow-y-auto">
          <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 space-y-8">

            {/* TÍTULO SECCIÓN CON INDICADOR ROJO */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-l-4 border-[#E31E24] pl-6">
              <div>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-[#1a1a1a] tracking-tighter uppercase italic">{currentSection}</h1>
              </div>
            </div>

            {/* CONTENEDOR PRINCIPAL */}
            <div className="bg-white rounded-lg md:rounded-[2.5rem] border border-gray-200 shadow-sm md:shadow-2xl min-h-[420px] md:min-h-[600px] overflow-hidden p-4 md:p-8 border-b-4 md:border-b-8 border-[#E31E24] w-full">
              {children}
            </div>
          </div>
        </section>
      </main>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-[60]"
          aria-hidden="true"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .custom-scrollbar::-webkit-scrollbar { width: 5px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #E31E24; border-radius: 10px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #b91c1c; }
          `,
        }}
      />
      </div>
    </ConductorPanelProvider>
  );
}
