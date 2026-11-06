/** Acción propuesta por el agente. No se ejecuta hasta aceptar la propuesta. */
export type OperacionPropuesta = "create" | "update" | "complete" | "delete";

export type AccionPropuesta = {
  op: OperacionPropuesta;
  id: string | null;
  title: string | null;
  due: string | null; // YYYY-MM-DD, sin hora
  category_id: string | null;
};

export type MensajeChat = {
  rol: "usuario" | "asistente";
  texto: string;
};

export type RespuestaGenerarPropuesta = {
  id_hilo: string;
  id_propuesta: string;
  respuesta: string;
  acciones: AccionPropuesta[];
  status: "pendiente";
  tokens_in?: number;
  tokens_out?: number;
  latencia_ms?: number;
};

/** El backend devuelve solo el hilo pendiente, no el historial de hilos cerrados. */
export type RespuestaObtenerPropuestas = {
  id_hilo: string | null;
  id_propuesta_actual: string | null;
  mensajes: unknown[];
  acciones: AccionPropuesta[];
  status: "pendiente" | "sin_hilo";
};

export type RespuestaResolverPropuesta = {
  mensaje: string;
  id_propuesta: string;
  status: "aceptada" | "cancelada";
  cantidad_acciones?: number;
  ids_tareas_creadas?: string[];
};

/** Admite los formatos más comunes de mensajes al restaurar el hilo. */
export function normalizarMensajes(origen: unknown): MensajeChat[] {
  if (!Array.isArray(origen)) {
    throw new Error("El historial de propuestas no contiene una lista de mensajes válida.");
  }

  const salida: MensajeChat[] = [];
  for (const item of origen) {
    if (!item || typeof item !== "object") continue;
    const datos = item as Record<string, unknown>;

    // Compatibilidad con intercambios almacenados como par usuario/asistente.
    if (typeof datos.mensaje_usuario === "string") {
      salida.push({ rol: "usuario", texto: datos.mensaje_usuario });
      if (typeof datos.respuesta_bot === "string") {
        salida.push({ rol: "asistente", texto: datos.respuesta_bot });
      }
      continue;
    }

    const rolOriginal = datos.rol ?? datos.role ?? datos.tipo ?? datos.emisor ?? datos.autor;
    const textoOriginal = datos.texto ?? datos.contenido ?? datos.mensaje ?? datos.content ?? datos.text;
    const rol = typeof rolOriginal === "string" ? rolOriginal.toLowerCase() : "";
    const texto = typeof textoOriginal === "string" ? textoOriginal : "";
    if (!texto) continue;

    if (["usuario", "user", "human", "estudiante"].includes(rol)) {
      salida.push({ rol: "usuario", texto });
    } else if (["asistente", "assistant", "bot", "ia", "dotol"].includes(rol)) {
      salida.push({ rol: "asistente", texto });
    }
  }

  if (origen.length > 0 && salida.length === 0) {
    throw new Error("No se pudo interpretar el formato de mensajes devuelto por GET /propuestas.");
  }
  return salida;
}
