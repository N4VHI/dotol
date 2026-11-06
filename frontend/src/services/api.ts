const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

export class ApiError extends Error {
  public status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T>(
  ruta: string,
  accessToken: string,
  opciones: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  if (!API_URL) throw new Error("Falta VITE_API_URL en .env.local");
 
  const respuesta = await fetch(`${API_URL}${ruta}`, {
    method: opciones.method ?? "GET",
    signal: opciones.signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(opciones.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(opciones.body !== undefined ? { body: JSON.stringify(opciones.body) } : {}),
  });

  const contenido: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const mensaje =
      contenido && typeof contenido === "object" && "error" in contenido &&
      typeof contenido.error === "string"
        ? contenido.error
        : `La solicitud falló (HTTP ${respuesta.status}).`;
    throw new ApiError(respuesta.status, mensaje);
  }
  return contenido as T;
}
