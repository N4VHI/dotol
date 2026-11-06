import { apiRequest } from "./api";

export type MetodoEvaluacion = "ia" | "tradicional";
export type EstadoEvaluacion =
  | "pendiente"
  | "en_curso"
  | "pendiente_tlx"
  | "pendiente_sus"
  | "completada";
export type PantallaEvaluacion =
  | "instrucciones"
  | "metodo"
  | "nasa_tlx"
  | "sus"
  | "finalizado";

export type TareaObjetivo = {
  nombre: string;
  descripcion?: string;
  fecha_dia?: string;
};

export type GruposEvaluacion = { A: string; B: string };

export type RegistroEvaluacion = {
  tipo_prueba: MetodoEvaluacion;
  orden: 1 | 2;
  estado: EstadoEvaluacion;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  cant_clicks: number | null;
  cant_tareas: number | null;
  duracion_segundos: number | null;
  puntaje_sus: number | null;
  puntaje_raw_tlx: number | null;
  grupo_asignado?: "A" | "B";
  cantidad_objetivo?: number;
  tareas_objetivo?: TareaObjetivo[]; // Compatibilidad: sesiones antiguas
  texto_grupo?: string | null; // Consigna libre, solo visible durante el método asignado
};

export type ResumenEvaluacion = {
  estado_global: "no_iniciada" | "en_progreso" | "completada";
  pantalla: PantallaEvaluacion;
  metodo_actual: MetodoEvaluacion | null;
  orden_actual: 1 | 2 | null;
  evaluaciones: RegistroEvaluacion[];
};

export function consultarEvaluacion(token: string, signal?: AbortSignal) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/estado", token, { signal });
}

export function prepararEvaluacion(token: string, grupos: GruposEvaluacion) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/preparar", token, {
    method: "POST",
    body: { grupos },
  });
}

export function iniciarEvaluacion(token: string) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/iniciar", token, {
    method: "POST",
  });
}

export function finalizarEvaluacion(token: string, cantClicks: number, cantTareas?: number) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/finalizar", token, {
    method: "POST",
    body: {
      cant_clicks: cantClicks,
      ...(cantTareas !== undefined ? { cant_tareas: cantTareas } : {}),
    },
  });
}

export function enviarNASA_TLX(token: string, respuestas: number[]) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/raw-tlx", token, {
    method: "POST",
    body: { respuestas },
  });
}

export function enviarSUS(token: string, respuestas: number[]) {
  return apiRequest<ResumenEvaluacion>("/evaluacion/sus", token, {
    method: "POST",
    body: { respuestas },
  });
}
