import { NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../lib/backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "Cache-Control": "no-store" };
const FORWARDED_REQUEST_HEADERS = ["accept", "authorization", "content-type", "origin", "user-agent"];
const FORWARDED_DOWNLOAD_HEADERS = [
  "content-type",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "last-modified",
];

const jsonError = (
  error: string,
  code: string,
  status: number,
  upstreamStatus?: number,
) => NextResponse.json(
  {
    error,
    code,
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
  },
  { status, headers: JSON_HEADERS },
);

const isJsonContentType = (contentType: string) =>
  contentType === "application/json" || contentType.endsWith("+json");

const isDownloadResponse = (contentType: string, disposition: string) =>
  disposition.toLowerCase().includes("attachment")
  || contentType === "application/pdf"
  || contentType === "application/octet-stream"
  || contentType === "text/csv"
  || contentType.startsWith("image/")
  || contentType.startsWith("video/")
  || contentType.startsWith("audio/")
  || contentType.includes("spreadsheetml");

async function proxy(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const apiPath = incomingUrl.pathname.slice("/api-proxy".length);

  if (!apiPath.startsWith("/api/")) {
    return jsonError("La ruta solicitada no pertenece a la API.", "INVALID_API_PATH", 404);
  }

  let upstreamUrl: URL;
  try {
    const backendOrigin = getBackendApiUrl();
    upstreamUrl = new URL(`${apiPath}${incomingUrl.search}`, backendOrigin);
    if (upstreamUrl.origin !== backendOrigin || !upstreamUrl.pathname.startsWith("/api/")) {
      return jsonError("La ruta solicitada no es válida.", "INVALID_API_PATH", 400);
    }
  } catch (error) {
    console.error("[api-proxy] Configuración del backend inválida:", error);
    return jsonError("El servicio de API no está configurado correctamente.", "API_CONFIGURATION_ERROR", 500);
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };
  if (request.body && request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    console.error(`[api-proxy] No se pudo contactar ${request.method} ${apiPath}:`, error);
    return jsonError("No se pudo conectar con el servicio de API.", "API_UPSTREAM_UNAVAILABLE", 502);
  }

  if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 205) {
    return new Response(null, {
      status: upstream.status,
      headers: JSON_HEADERS,
    });
  }

  const contentType = (upstream.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const disposition = upstream.headers.get("content-disposition") || "";

  if (upstream.status === 304) {
    return jsonError("El servicio de API devolvió una respuesta sin contenido.", "API_EMPTY_RESPONSE", 502, 304);
  }

  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    console.error(
      `[api-proxy] El backend devolvió HTML para ${request.method} ${apiPath} (HTTP ${upstream.status}).`,
    );
    return jsonError(
      "El servidor de API devolvió HTML en lugar de JSON. Revisa la protección del hosting.",
      "API_NON_JSON_RESPONSE",
      502,
      upstream.status,
    );
  }

  if (!isJsonContentType(contentType) && isDownloadResponse(contentType, disposition)) {
    const downloadHeaders = new Headers(JSON_HEADERS);
    for (const name of FORWARDED_DOWNLOAD_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) downloadHeaders.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: downloadHeaders,
    });
  }

  let body: string;
  try {
    body = await upstream.text();
  } catch (error) {
    console.error(`[api-proxy] No se pudo leer la respuesta de ${request.method} ${apiPath}:`, error);
    return jsonError("No se pudo leer la respuesta del servicio de API.", "API_RESPONSE_READ_ERROR", 502);
  }

  try {
    return NextResponse.json(JSON.parse(body) as unknown, {
      status: upstream.status,
      headers: JSON_HEADERS,
    });
  } catch {
    console.error(
      `[api-proxy] El backend devolvió contenido no JSON para ${request.method} ${apiPath} (HTTP ${upstream.status}).`,
    );
    return jsonError(
      "El servidor de API devolvió una respuesta no JSON.",
      "API_NON_JSON_RESPONSE",
      502,
      upstream.status,
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
