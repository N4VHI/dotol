import { useCallback, useEffect, useRef, useState } from "react";
import ConversationPanel from "../components/ai/ConversationPanel";
import ProposalPanel from "../components/ai/ProposalPanel";
import { useWorkspace } from "../components/workspace/WorkspaceLayout";
import { obtenerCategorias } from "../services/categories";
import { obtenerTareas } from "../services/tasks";
import {
  aceptarPropuesta,
  cancelarPropuesta,
  generarPropuesta,
  obtenerPropuestas,
} from "../services/proposals";
import { ApiError } from "../services/api";
import type { Categoria } from "../types/categoria";
import type { Tarea } from "../types/tarea";
import type { AccionPropuesta, MensajeChat } from "../types/propuesta";
import { normalizarMensajes } from "../types/propuesta";

import "../styles/ai.css";

type Props = { accessToken: string };
type Operacion = "enviar" | "aceptar" | "cancelar" | null;

export default function AiTasksPage({ accessToken }: Props) {
  const { nombre } = useWorkspace();
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [acciones, setAcciones] = useState<AccionPropuesta[]>([]);
  const [idPropuesta, setIdPropuesta] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [operacion, setOperacion] = useState<Operacion>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const ocupadoRef = useRef(false);

  const recargarTodo = useCallback(async (signal?: AbortSignal) => {
    // Primero se inicializan las categorías para que el agente pueda clasificarlas.
    const listaCategorias = await obtenerCategorias(accessToken, signal);
    const [listaTareas, hilo] = await Promise.all([
      obtenerTareas(accessToken, signal),
      obtenerPropuestas(accessToken, signal),
    ]);
    if (signal?.aborted) return;
    setCategorias(listaCategorias);
    setTareas(listaTareas);
    if (hilo.status === "sin_hilo" || !hilo.id_propuesta_actual) {
      setMensajes([]);
      setAcciones([]);
      setIdPropuesta(null);
    } else {
      setMensajes(normalizarMensajes(hilo.mensajes));
      setAcciones(hilo.acciones ?? []);
      setIdPropuesta(hilo.id_propuesta_actual);
    }
  }, [accessToken]);

  useEffect(() => {
    const controlador = new AbortController();
    void Promise.resolve()
      .then(() => recargarTodo(controlador.signal))
      .catch((fallo: unknown) => {
        if (!controlador.signal.aborted) {
          setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el chat.");
        }
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargando(false);
      });
    return () => controlador.abort();
  }, [recargarTodo]);

  async function enviarMensaje(texto: string): Promise<boolean> {
    if (ocupadoRef.current || cargando) return false;
    ocupadoRef.current = true;
    setOperacion("enviar");
    setError("");
    setAviso("");
    try {
      const resultado = await generarPropuesta(accessToken, texto, idPropuesta);
      setMensajes((actuales) => [
        ...actuales,
        { rol: "usuario", texto },
        { rol: "asistente", texto: resultado.respuesta },
      ]);
      setAcciones(resultado.acciones);
      setIdPropuesta(resultado.id_propuesta);
      return true;
    } catch (fallo) {
      const detalle = fallo instanceof Error ? fallo.message : "No se pudo generar la propuesta.";
      if (fallo instanceof ApiError && fallo.status === 409) {
        try { await recargarTodo(); }
        catch { /* La falla original se informa igualmente. */ }
        setError(`${detalle} Se ha intentado actualizar el chat. Revisa las acciones antes de continuar.`);
      } else {
        setError(detalle);
      }
      return false;
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  async function aceptar() {
    if (!idPropuesta || acciones.length === 0 || ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOperacion("aceptar");
    setError("");
    setAviso("");
    try {
      await aceptarPropuesta(accessToken, idPropuesta);
      // Solo después del HTTP 200 se limpia el hilo. No hay cambios optimistas en tareas.
      setMensajes([]);
      setAcciones([]);
      setIdPropuesta(null);
      setAviso("Cambios aplicados correctamente. Ya puedes verlos en Método Tradicional.");
    } catch (fallo) {
      const detalle = fallo instanceof Error ? fallo.message : "No se pudo aceptar la propuesta.";
      if (fallo instanceof ApiError && fallo.status === 409) {
        try { await recargarTodo(); }
        catch { /* Se mantiene el mensaje de error. */ }
      }
      setError(detalle);
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  async function cancelar() {
    if (!idPropuesta || ocupadoRef.current) return;
    if (!window.confirm("¿Descartar todas las acciones pendientes de este chat?")) return;
    ocupadoRef.current = true;
    setOperacion("cancelar");
    setError("");
    setAviso("");
    try {
      await cancelarPropuesta(accessToken, idPropuesta);
      setMensajes([]);
      setAcciones([]);
      setIdPropuesta(null);
      setAviso("Propuesta cancelada. No se modificó ninguna tarea.");
    } catch (fallo) {
      const detalle = fallo instanceof Error ? fallo.message : "No se pudo cancelar la propuesta.";
      if (fallo instanceof ApiError && fallo.status === 409) {
        try { await recargarTodo(); }
        catch { /* Se mantiene el mensaje de error. */ }
      }
      setError(detalle);
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  return (
    <div className="dt-ai-page">
      <div className="dt-ai-page__conversation">
        {error && <div className="dt-ai-page__alert dt-ai-page__alert--error" role="alert">{error}</div>}
        {aviso && <div className="dt-ai-page__alert dt-ai-page__alert--success" role="status">{aviso}</div>}
        {cargando ? (
          <p className="dt-ai-page__loading">Recuperando conversación y categorías…</p>
        ) : (
          <ConversationPanel
            mensajes={mensajes}
            nombre={nombre}
            enviando={operacion === "enviar"}
            bloqueado={operacion !== null}
            onEnviar={enviarMensaje}
          />
        )}
      </div>
      <ProposalPanel
        acciones={acciones}
        categorias={categorias}
        tareas={tareas}
        propuestaPendiente={idPropuesta !== null}
        procesando={cargando || operacion !== null}
        onAceptar={() => { void aceptar(); }}
        onCancelar={() => { void cancelar(); }}
      />
    </div>
  );
}
