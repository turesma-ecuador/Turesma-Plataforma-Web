import { getAuthHeaders } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type AdminUserInput = {
  nombre: string;
  email: string;
  telefono?: string;
  cedula?: string;
  tipo_identificacion?: "cedula" | "pasaporte" | "ruc";
  imagen_url?: string | null;
  rol: "admin" | "cliente" | "operativo" | "vehiculo";
  password?: string;
};

const readResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || "La operación de usuario no pudo completarse");
  }
  return data as T;
};

export const listAdminUsers = async (role?: AdminUserInput["rol"]) => {
  const query = role ? `?rol=${encodeURIComponent(role)}` : "";
  const response = await fetch(`${API_URL}/api/admin/usuarios${query}`, {
    headers: getAuthHeaders(),
  });
  return readResponse<any[]>(response);
};

export const saveAdminUser = async (userId: number | null, input: AdminUserInput) => {
  const response = await fetch(
    `${API_URL}/api/admin/usuarios${userId ? `/${userId}` : ""}`,
    {
      method: userId ? "PUT" : "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    }
  );
  return readResponse<{ user?: any; message?: string }>(response);
};

export const deleteAdminUser = async (userId: number) => {
  const response = await fetch(`${API_URL}/api/admin/usuarios/${userId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  return readResponse<{ message?: string }>(response);
};

export const resetAdminUserPassword = async (userId: number, password: string) => {
  const response = await fetch(
    `${API_URL}/api/admin/usuarios/${userId}/recuperar-password`,
    {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ nueva_password: password }),
    }
  );
  return readResponse<{ message?: string }>(response);
};
