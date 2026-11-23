"use client";

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { getAuthHeaders } from "../lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type CommunicationContextType = "cotizacion" | "requerimiento" | "reserva";

type CommunicationMessage = {
  id: number;
  sender_user_id: number;
  recipient_user_id: number;
  mensaje: string;
  creado_en: string;
  leido: boolean;
  sender_nombre: string | null;
  sender_rol: string | null;
  es_mio: boolean;
};

type CommunicationPanelProps = {
  contextType: CommunicationContextType;
  contextId: number;
  contextTitle: string;
  className?: string;
  initiallyOpen?: boolean;
  hideTrigger?: boolean;
  onClose?: () => void;
};

const isCommunicationMessage = (value: unknown): value is CommunicationMessage => {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === "number"
    && typeof message.sender_user_id === "number"
    && typeof message.recipient_user_id === "number"
    && typeof message.mensaje === "string"
    && typeof message.creado_en === "string"
    && typeof message.leido === "boolean"
    && (message.sender_nombre === null || typeof message.sender_nombre === "string")
    && (message.sender_rol === null || typeof message.sender_rol === "string")
    && typeof message.es_mio === "boolean";
};

const messageTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function CommunicationPanel({
  contextType,
  contextId,
  contextTitle,
  className = "",
  initiallyOpen = false,
  hideTrigger = false,
  onClose,
}: CommunicationPanelProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const dialogTitleId = useId();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const keepScrolledToBottom = useRef(true);
  const hasLoadedMessages = useRef(false);
  const contextKey = `${contextType}:${contextId}`;

  const loadMessages = useCallback(async (active: () => boolean) => {
    const params = new URLSearchParams({ link_type: contextType, link_id: String(contextId) });
    const response = await fetch(`${API_URL}/api/comunicacion/mensajes?${params}`, {
      headers: getAuthHeaders(),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : "No se pudo cargar la conversación";
      throw new Error(message);
    }
    if (!Array.isArray(data)) throw new Error("La respuesta de la conversación no es válida");
    const parsedMessages = data.filter(isCommunicationMessage);
    if (parsedMessages.length !== data.length) throw new Error("La respuesta de la conversación contiene mensajes inválidos");
    if (active()) {
      setMessages(parsedMessages);
      hasLoadedMessages.current = true;
      setError("");
      requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (element && keepScrolledToBottom.current) element.scrollTop = element.scrollHeight;
      });
    }
  }, [contextId, contextType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("chat") !== contextKey) return;
    // Notification deep links intentionally synchronize the dialog with the URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
    params.delete("chat");
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, [contextKey]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let requestInProgress = false;
    const load = async () => {
      if (requestInProgress) return;
      requestInProgress = true;
      setLoading(!hasLoadedMessages.current);
      try {
        await loadMessages(() => active);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar la conversación");
      } finally {
        if (active) setLoading(false);
        requestInProgress = false;
      }
    };
    void load();
    const interval = window.setInterval(() => { void load(); }, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loadMessages, open]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const mensaje = draft.trim();
    if (!mensaje || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/comunicacion/mensajes`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ link_type: contextType, link_id: contextId, mensaje }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error
          : "No se pudo enviar el mensaje";
        throw new Error(message);
      }
      setDraft("");
      keepScrolledToBottom.current = true;
      await loadMessages(() => true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  };

  const closeConversation = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeConversation();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeConversation, open]);

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800 transition hover:bg-blue-100 ${className}`}
        >
          <MessageCircle size={15} aria-hidden="true" />
          Conversación
        </button>
      )}
      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConversation();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-700">Conversación del servicio</p>
                <h2 id={dialogTitleId} className="mt-1 text-sm font-black text-slate-900">{contextTitle}</h2>
                <p className="mt-1 text-[11px] text-slate-500">La conversación queda guardada en este servicio.</p>
              </div>
              <button
                type="button"
                onClick={closeConversation}
                aria-label="Cerrar conversación"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200"
              >
                <X size={18} />
              </button>
            </header>

            <div
              ref={messagesRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                keepScrolledToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
              }}
              className="min-h-40 flex-1 space-y-3 overflow-y-auto bg-white p-4 sm:p-5"
              aria-live="polite"
              aria-label="Mensajes de la conversación"
            >
              {loading && messages.length === 0 ? (
                <div role="status" className="flex h-32 items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                  <Loader2 size={18} className="animate-spin text-blue-600" /> Cargando mensajes...
                </div>
              ) : messages.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                  Aún no hay mensajes. Escribe aquí para iniciar la conversación sobre este servicio.
                </p>
              ) : messages.map((message) => (
                <article key={message.id} className={`flex ${message.es_mio ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-3 py-2.5 ${
                    message.es_mio ? "rounded-br-sm bg-blue-700 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                  }`}>
                    <p className={`mb-1 text-[9px] font-black uppercase tracking-wide ${message.es_mio ? "text-blue-100" : "text-slate-500"}`}>
                      {message.es_mio ? "Tú" : ["admin", "operativo"].includes(message.sender_rol || "") ? "Turesma" : message.sender_nombre || "Cliente"}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">{message.mensaje}</p>
                    <time className={`mt-1 block text-right text-[9px] ${message.es_mio ? "text-blue-100" : "text-slate-400"}`}>
                      {messageTime(message.creado_en)}
                    </time>
                  </div>
                </article>
              ))}
            </div>

            {error && <p role="alert" className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 sm:mx-5">{error}</p>}

            <form onSubmit={sendMessage} className="flex items-end gap-2 border-t border-slate-100 bg-slate-50 p-3 sm:p-4">
              <label className="sr-only" htmlFor={`${dialogTitleId}-message`}>Escribe un mensaje</label>
              <textarea
                id={`${dialogTitleId}-message`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Escribe tu mensaje..."
                className="min-h-11 flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-blue-700 px-3 text-xs font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Enviar
              </button>
            </form>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
