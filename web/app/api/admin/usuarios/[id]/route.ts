import { NextRequest, NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../../../lib/backend-url";

const API_BASE_URL = getBackendApiUrl();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json(
        { error: "ID de usuario no proporcionado" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Body JSON inválido" },
        { status: 400 }
      );
    }

    console.log(`[API PUT] Enviando PUT a ${API_BASE_URL}/api/admin/usuarios/${id}`);
    console.log(`[API PUT] Body:`, body);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/admin/usuarios/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error("[API PUT] Error de conexión al backend:", fetchError);
      return NextResponse.json(
        { error: `No se puede conectar al servidor backend en ${API_BASE_URL}: ${message}` },
        { status: 503 }
      );
    }

    console.log(`[API PUT] Response status:`, response.status);
    console.log(`[API PUT] Content-Type:`, response.headers.get("content-type"));

    let data: Record<string, unknown>;
    try {
      const text = await response.text();
      console.log(`[API PUT] Response text:`, text);
      
      if (!text || text.trim() === "") {
        console.warn(`[API PUT] Response body is empty!`);
        data = { error: "El servidor devolvió una respuesta vacía" };
      } else {
        data = JSON.parse(text);
      }
    } catch (parseError: unknown) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("[API PUT] Error parsing JSON:", message);
      data = { error: `Error al parsear respuesta del servidor: ${message}` };
    }

    if (!response.ok) {
      console.error(`[API PUT] Error from backend (status ${response.status}):`, data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log(`[API PUT] Success:`, data);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error("[API PUT] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor", details: String(error) },
      { status: 500 }
    );
  }
}
