const PRODUCTION_BACKEND_ORIGIN = "https://api.turesma.com";

const getOriginWithoutProxyPath = (value: string | undefined) => {
  if (!value) return null;

  const parsed = new URL(value);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  return parsed.origin;
};

export const getBackendApiUrl = () => {
  const proxyTarget = process.env.API_PROXY_TARGET;
  if (proxyTarget) {
    const origin = getOriginWithoutProxyPath(proxyTarget);
    if (!origin) {
      throw new Error("API_PROXY_TARGET debe ser el origen del backend, no una ruta del frontend");
    }
    return origin;
  }

  const configuredApiUrl = getOriginWithoutProxyPath(process.env.API_URL);
  if (configuredApiUrl) return configuredApiUrl;

  const publicApiUrl = getOriginWithoutProxyPath(process.env.NEXT_PUBLIC_API_URL);
  if (publicApiUrl) return publicApiUrl;

  return process.env.NODE_ENV === "production"
    ? PRODUCTION_BACKEND_ORIGIN
    : "http://localhost:4000";
};
