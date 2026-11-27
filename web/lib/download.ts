import { API_BASE_URL } from "@/lib/api-url";
import { getAuthHeaders } from "./session";

const API_URL = API_BASE_URL;

export const descargarArchivo = async (path: string, filenameFallback: string): Promise<{ ok: boolean; error?: string }> => {
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: getAuthHeaders() });
    if (!res.ok) {
      let error = "No se pudo generar el archivo";
      try {
        const payload = await res.json();
        if (typeof payload.error === "string") error = payload.error;
      } catch {
        // Keep the generic message when the server response is not JSON.
      }
      return { ok: false, error };
    }

    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : filenameFallback;

    const blob = await res.blob();
    if (filename.toLowerCase().endsWith(".xlsx")) {
      const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      const hasZipSignature = bytes.length === 4
        && bytes[0] === 0x50 && bytes[1] === 0x4b
        && bytes[2] === 0x03 && bytes[3] === 0x04;
      if (!hasZipSignature) {
        return { ok: false, error: "El servidor no devolvió un Excel válido. Actualiza el backend e inténtalo nuevamente." };
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo descargar el archivo" };
  }
};

// CSV y XLSX requieren token de sesión, por eso se descargan usando fetch.
export const descargarCSV = descargarArchivo;
export const descargarExcel = (path: string, filenameFallback: string) =>
  descargarArchivo(path, filenameFallback);
