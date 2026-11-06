import type { Categoria } from "../types/categoria";
import { apiRequest } from "./api";

type RespuestaCategorias = { categorias: Categoria[]; cantidad: number; limite: number };

/** Este GET también inicializa las categorías predeterminadas en el primer ingreso. */
export async function obtenerCategorias(accessToken: string, signal?: AbortSignal) {
  const datos = await apiRequest<RespuestaCategorias>("/categorias", accessToken, { signal });
  if (!Array.isArray(datos.categorias)) throw new Error("Formato inesperado al consultar categorías.");
  return datos.categorias;
}
