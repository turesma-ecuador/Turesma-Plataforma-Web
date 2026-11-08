"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  BarChart3,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  User,
  Users,
  X,
  Bus,
  ShieldCheck,
  Zap,
  TrendingUp,
  UserCircle,
  Car,
  Calendar,
  CalendarDays,
  Wrench,
  FileText,
  Route,
  Brain,
  MapPin,
  ClipboardList,
  ClipboardCheck,
  CreditCard,
  IdCard,
  Images,
  ImagePlus,
  Ticket,
  Building2,
} from "lucide-react";
import { clearStoredUser } from "../../../lib/session";
import { NotificationBell } from "../../../components/notification-bell";
import { useAdminBadges } from "./use-admin-badges";
import { AdminChatbot } from "./admin-chatbot";
import { useMobileMenuAccessibility } from "../../../lib/use-mobile-menu-accessibility";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { normalizeRole } from "../../../lib/session";

type AdminShellProps = {
  children: React.ReactNode;
};

type MenuItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  adminOnly?: boolean;
};

type MenuGroup = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  items: MenuItem[];
};

// Agrupa la navegación por categoría (en vez de una lista plana de 14 ítems)
// para que el sidebar sea más corto y fácil de escanear.
const menuGroups: MenuGroup[] = [
  {
    id: "general", label: "General", icon: LayoutDashboard, items: [
      { href: "/admin", label: "Reporte", icon: LayoutDashboard },
      { href: "/admin/inteligencia", label: "Toma de decisiones", icon: Brain },
    ],
  },
  {
    id: "operaciones", label: "Operaciones", icon: Route, items: [
      { href: "/admin/operaciones", label: "Despacho", icon: ClipboardList },
      { href: "/admin/empresas-asociadas", label: "Empresas asociadas", icon: Building2, adminOnly: true },
      { href: "/admin/calendario-flota", label: "Calendario de flota", icon: CalendarDays, adminOnly: true },
      { href: "/admin/viajes", label: "Viajes publicados", icon: Ticket },
      { href: "/admin/cotizaciones", label: "Cotizaciones", icon: FileText },
      { href: "/admin/reservas", label: "Reservas", icon: Calendar },
      { href: "/admin/pagos", label: "Pagos", icon: CreditCard },
      { href: "/admin/ruta", label: "Seguimiento en vivo", icon: MapPin },
    ],
  },
  {
    id: "personas", label: "Personas", icon: Users, items: [
      { href: "/admin/clientes", label: "Clientes", icon: Users },
      { href: "/admin/verificaciones", label: "Verificaciones", icon: IdCard },
      { href: "/admin/conductores", label: "Conductores", icon: UserCircle },
      { href: "/admin/administrador", label: "Administradores", icon: ShieldCheck },
    ],
  },
  {
    id: "flota", label: "Flota", icon: Bus, items: [
      { href: "/admin/vehiculos", label: "Vehículos", icon: Car },
      { href: "/admin/mantenimiento", label: "Mantenimiento", icon: Wrench },
      { href: "/admin/cumplimiento", label: "Documentos y cumplimiento", icon: ClipboardCheck },
    ],
  },
  {
    id: "reportes", label: "Reportes", icon: TrendingUp, items: [
      { href: "/admin/historial", label: "Balance anual", icon: BarChart3 },
      { href: "/admin/rutas-analisis", label: "Rendimiento de rutas", icon: TrendingUp },
    ],
  },
  {
    id: "sistema", label: "Sistema", icon: Settings, items: [
      { href: "/admin/galeria", label: "Galería Web", icon: Images },
      { href: "/admin/imagenes-portada", label: "Imágenes de portada", icon: ImagePlus },
      { href: "/admin/configuracion", label: "Mi perfil", icon: User },
    ],
  },
];

const menuItems: MenuItem[] = menuGroups.flatMap((g) => g.items);

export const AdminShell = ({ children }: AdminShellProps) => {
  const pathname = usePathname();
  const isFleetCalendar = pathname === "/admin/calendario-flota";
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { user, checkingSession } = useAdminGuard();
  const isAdmin = normalizeRole(user?.rol) === "admin";
  const profileInitials = (user?.nombre || "Admin")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  const profileRole = isAdmin ? "Administrador" : "Operativo";

  const badges = useAdminBadges(!checkingSession);
  useMobileMenuAccessibility(isMobileMenuOpen, setIsMobileMenuOpen, mobileMenuRef, mobileMenuTriggerRef);

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  const currentSection = (() => {
    const active = menuItems.find((item) => isActive(item.href));
    return active?.label || "Administración";
  })();

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const activeGroup = menuGroups.find((g) => g.items.some((i) => isActive(i.href)));
    return new Set(activeGroup ? [activeGroup.id] : ["general"]);
  });

  // Si la ruta activa cambia de grupo, ese grupo se abre automáticamente
  // (sin cerrar los que el usuario ya haya abierto manualmente).
  useEffect(() => {
    const activeGroup = menuGroups.find((g) => g.items.some((i) => isActive(i.href)));
    if (activeGroup) setOpenGroups((prev) => (prev.has(activeGroup.id) ? prev : new Set(prev).add(activeGroup.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLogout = () => {
    clearStoredUser();
    window.location.assign("/api/auth/logout");
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex font-sans text-[#1a1a1a]">
      
      {/* SIDEBAR ESCRITORIO - ESTILO PREMIUM DARK */}
      <aside className="hidden lg:flex w-72 flex-col bg-[#0b0f1a] text-white fixed h-full shadow-[10px_0_30px_rgba(0,0,0,0.1)] z-50">
        <div className="p-8 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[#E31E24] rounded-2xl flex items-center justify-center shadow-lg shadow-red-600/20 transform -rotate-3">
              <Bus size={28} className="text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-black italic tracking-tighter leading-none text-white">
                TURESMA <span className="text-[10px] not-italic text-yellow-400">S.A</span>
              </h1>
              <span className="text-[9px] text-gray-500 uppercase tracking-[0.3em] font-bold mt-1">Panel Administrativo</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto custom-scrollbar">
          <p className="px-4 text-[10px] font-black text-gray-600 uppercase tracking-widest mb-4">Navegación Sistema</p>
          {menuGroups.map((group) => {
            const visibleItems = group.items.filter((item) => !item.adminOnly || isAdmin);
            if (visibleItems.length === 0) return null;
            const GroupIcon = group.icon;
            const isOpen = openGroups.has(group.id);
            const groupHasActive = visibleItems.some((i) => isActive(i.href));
            return (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={`admin-desktop-group-${group.id}`}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-300 ${
                    groupHasActive ? "text-white" : "text-gray-500 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <GroupIcon size={17} strokeWidth={2} />
                    <span className="text-[11px] font-black uppercase tracking-widest">{group.label}</span>
                  </div>
                  <ChevronRight size={14} className={`transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`} />
                </button>
                <div id={`admin-desktop-group-${group.id}`} inert={!isOpen} className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"}`}>
                  <div className="pl-2 pb-1 space-y-1">
                    {visibleItems.map((item) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      const pendientes = badges[item.href] || 0;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`group w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-300 ${
                            active
                              ? "bg-[#E31E24] text-white shadow-xl shadow-red-600/20"
                              : "text-gray-500 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-xl transition-colors ${active ? "bg-white/20" : "group-hover:bg-white/5"}`}>
                              <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                            </div>
                            <span className={`text-sm font-bold tracking-tight ${active ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`}>
                              {item.label}
                            </span>
                          </div>
                          {pendientes > 0 ? (
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white shadow-lg shadow-red-500/30 animate-pulse">
                              {pendientes > 99 ? "99+" : pendientes}
                            </span>
                          ) : (
                            active && <Zap size={14} className="text-yellow-400 fill-yellow-400 animate-pulse" />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* PERFIL ADMIN SIDEBAR */}
        <div className="p-4 bg-[#080b14] border-t border-white/5">
          <div className="bg-white/5 rounded-[1.5rem] p-4 border border-white/5 shadow-inner">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative">
                {user?.imagen_url ? (
                  <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-slate-800">
                    <Image src={user.imagen_url} alt={user.nombre || profileRole} fill sizes="40px" className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-tr from-gray-700 to-gray-800 text-sm font-black text-white" suppressHydrationWarning>
                    {profileInitials}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-[#0b0f1a] rounded-full shadow-lg"></div>
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold truncate text-white">
                  <span title={user?.nombre || profileRole}>{user?.nombre || profileRole}</span>
                </p>
                <p className="text-[10px] text-gray-400 truncate">{profileRole}</p>
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

      {/* MOBILE HEADER Y MENU (Se mantiene la lógica pero con nuevos colores) */}
      <aside
        id="admin-mobile-navigation"
        ref={mobileMenuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación del administrador"
        aria-hidden={!isMobileMenuOpen}
        inert={!isMobileMenuOpen}
        className={`fixed inset-y-0 left-0 z-[70] flex h-dvh w-72 max-w-[85vw] flex-col bg-[#0b0f1a] text-white transform transition-transform duration-500 ease-in-out lg:hidden ${isMobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <div className="p-8 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E31E24] rounded-lg flex items-center justify-center font-bold">T</div>
            <span className="font-black italic tracking-tighter uppercase">Turesma</span>
          </div>
          <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="Cerrar menú" className="flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 transition-colors hover:bg-white/5"><X size={20} /></button>
        </div>
        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-6 custom-scrollbar">
          {menuGroups.map((group) => {
            const visibleItems = group.items.filter((item) => !item.adminOnly || isAdmin);
            if (visibleItems.length === 0) return null;
            const GroupIcon = group.icon;
            const isOpen = openGroups.has(group.id);
            const groupHasActive = visibleItems.some((i) => isActive(i.href));
            return (
              <div key={group.id}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={`admin-mobile-group-${group.id}`}
                  className={`w-full flex items-center justify-between px-5 py-3.5 rounded-2xl transition-all ${groupHasActive ? "text-white" : "text-gray-300 hover:bg-white/5"}`}
                >
                  <div className="flex items-center gap-3">
                    <GroupIcon size={18} />
                    <span className="font-black text-xs uppercase tracking-widest">{group.label}</span>
                  </div>
                  <ChevronRight size={16} className={`transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`} />
                </button>
                <div id={`admin-mobile-group-${group.id}`} inert={!isOpen} className={`overflow-hidden transition-all duration-300 ${isOpen ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"}`}>
                  <div className="pl-2 pb-1 space-y-1">
                    {visibleItems.map((item) => {
                      const pendientes = badges[item.href] || 0;
                      return (
                        <Link key={item.href} href={item.href} onClick={() => setIsMobileMenuOpen(false)} className={`w-full flex items-center justify-between gap-4 px-5 py-4 rounded-2xl transition-all ${isActive(item.href) ? "bg-[#E31E24] text-white" : "text-gray-300 hover:bg-white/5"}`}>
                          <div className="flex items-center gap-4">
                            <item.icon size={20} />
                            <span className="font-bold text-sm uppercase tracking-tight">{item.label}</span>
                          </div>
                          {pendientes > 0 && (
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                              {pendientes > 99 ? "99+" : pendientes}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="mt-auto shrink-0 border-t border-white/5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-gray-300 hover:bg-white/5 hover:text-red-400 transition-all"
            type="button"
          >
            <LogOut size={20} />
            <span className="font-bold text-sm uppercase tracking-tight">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-[60] bg-black/45" aria-hidden="true" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col lg:ml-72 h-screen relative min-w-0 overflow-hidden">
        
        {/* HEADER SUPERIOR - GLASSMORPHISM */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-200 px-3 py-2 sm:px-6 sm:py-4 flex items-center justify-between shadow-sm h-14 sm:h-16">
          <div className="flex items-center gap-3">
            <button ref={mobileMenuTriggerRef} className="lg:hidden flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 text-[#E31E24] transition-all hover:bg-red-50" onClick={() => setIsMobileMenuOpen(true)} type="button" aria-label="Abrir menú" aria-expanded={isMobileMenuOpen} aria-controls="admin-mobile-navigation">
              <Menu size={24} />
            </button>
            {/* Logo + sección (visible en móvil, donde el sidebar está oculto) */}
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-8 h-8 bg-[#E31E24] rounded-lg flex items-center justify-center">
                <Bus size={18} className="text-white" />
              </div>
              <span className="text-sm font-bold text-gray-900">{currentSection}</span>
            </div>
            <h2 className="hidden lg:block text-sm font-semibold text-gray-500">{currentSection}</h2>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            <NotificationBell userId={user?.id} accent="red" portal="admin" />

            <div className="flex items-center gap-3 border-l border-gray-200 pl-3 md:pl-6">
              <div className="hidden sm:block text-right">
                <p className="max-w-48 truncate text-sm font-semibold leading-tight text-gray-900" title={user?.nombre || profileRole}>{user?.nombre || profileRole}</p>
                <p className="text-[11px] text-gray-400">{profileRole}</p>
              </div>
              {user?.imagen_url ? (
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
                  <Image src={user.imagen_url} alt={user?.nombre || "Administrador"} fill sizes="40px" className="object-cover" unoptimized />
                </div>
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E31E24] text-xs font-black text-white shadow-sm" aria-label={`Iniciales de ${user?.nombre || profileRole}`}>
                  {profileInitials}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* SECTION CONTENT */}
        <section className={`min-w-0 min-h-0 overflow-x-hidden flex-1 overflow-y-auto ${isFleetCalendar ? "p-2 sm:p-3 lg:p-4" : "p-3 md:p-10"}`}>
          <div className={`w-full mx-auto ${isFleetCalendar ? "max-w-none space-y-4" : "max-w-7xl px-2 sm:px-4 space-y-8"}`}>
            
            {/* TÍTULO SECCIÓN CON INDICADOR ROJO */}
            {!isFleetCalendar && (
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-l-4 border-[#E31E24] pl-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-[#1a1a1a] tracking-tighter uppercase italic">{currentSection}</h1>
                </div>
              </div>
            )}

            {/* CONTENEDOR PRINCIPAL - DISEÑO LIMPIO Y MODERNO */}
            <div className={`min-w-0 w-full ${isFleetCalendar ? "min-h-0 overflow-visible" : "bg-white rounded-lg md:rounded-[2.5rem] border border-gray-200 shadow-sm md:shadow-2xl min-h-[420px] md:min-h-[600px] overflow-hidden p-4 md:p-8 border-b-4 md:border-b-8 border-[#E31E24]"}`}>
              {children}
            </div>
            <AdminChatbot />
          </div>
        </section>
      </main>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .custom-scrollbar::-webkit-scrollbar { width: 5px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: #E31E24; border-radius: 10px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #b3141a; }
          `,
        }}
      />
    </div>
  );
};
