import { apiRequest } from "./api";
import type {
  RespuestaGenerarPropuesta,
  RespuestaObtenerPropuestas,
  RespuestaResolverPropuesta,
} from "../types/propuesta";

export function obtenerPropuestas(accessToken: string, signal?: AbortSignal) {
  return apiRequest<RespuestaObtenerPropuestas>("/propuestas", accessToken, { signal });
}

export function generarPropuesta(
  accessToken: string,
  mensaje: string,
  idPropuestaAnterior: string | null
) {
  return apiRequest<RespuestaGenerarPropuesta>("/propuestas/generar", accessToken, {
    method: "POST",
    body: {
      mensaje,
      ...(idPropuestaAnterior ? { id_propuesta_anterior: idPropuestaAnterior } : {}),
    },
  });
}

export function aceptarPropuesta(accessToken: string, idPropuesta: string) {
  return apiRequest<RespuestaResolverPropuesta>(
    `/propuestas/${encodeURIComponent(idPropuesta)}/aceptar`,
    accessToken,
    { method: "POST" }
  );
}

export function cancelarPropuesta(accessToken: string, idPropuesta: string) {
  return apiRequest<RespuestaResolverPropuesta>(
    `/propuestas/${encodeURIComponent(idPropuesta)}/cancelar`,
    accessToken,
    { method: "POST" }
  );
}
