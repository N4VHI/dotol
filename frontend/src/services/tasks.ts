import type { Tarea } from "../types/tarea";
import { apiRequest } from "./api";

export type RegistrarTareaDatos = {
  nombre: string;
  descripcion?: string;
  id_categoria?: string;
  fecha_dia?: string;
  fecha_hacer?: string;
};

export type ActualizarTareaDatos = {
  nombre?: string;
  descripcion?: string | null;
  id_categoria?: string | null;
  fecha_dia?: string | null;
  fecha_hacer?: string | null;
};

export async function obtenerTareas(accessToken: string, signal?: AbortSignal): Promise<Tarea[]> {
  const datos = await apiRequest<Tarea[]>("/obtener_tareas", accessToken, { signal });
  if (!Array.isArray(datos)) throw new Error("Formato inesperado al consultar las tareas.");
  return datos;
}

export async function registrarTarea(accessToken: string, datos: RegistrarTareaDatos) {
  return apiRequest<{ mensaje: string; tarea: Tarea }>("/registrar_tareas", accessToken, {
    method: "POST", body: datos,
  });
}

export async function actualizarTarea(accessToken: string, idTarea: string, datos: ActualizarTareaDatos) {
  return apiRequest<{ mensaje: string; tarea: Tarea }>(
    `/tareas/${encodeURIComponent(idTarea)}`, accessToken, { method: "PATCH", body: datos }
  );
}

export async function completarTarea(accessToken: string, idTarea: string) {
  return apiRequest<{ mensaje: string; tarea: Tarea }>(
    `/tareas/${encodeURIComponent(idTarea)}/completar`, accessToken, { method: "PATCH" }
  );
}

/** Eliminación lógica: el backend cambia estado a "eliminada". */
export async function eliminarTarea(accessToken: string, idTarea: string) {
  return apiRequest<{ mensaje: string; tarea: Tarea }>(
    `/tareas/${encodeURIComponent(idTarea)}/eliminar`, accessToken, { method: "PATCH" }
  );
}
