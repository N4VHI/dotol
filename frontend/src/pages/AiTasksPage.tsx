import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ConversationPanel from "../components/ai/ConversationPanel";
import ProposalPanel from "../components/ai/ProposalPanel";
import EvaluationTrialBar from "../components/evaluation/EvaluationTrialBar";
import EvaluationTaskBrief from "../components/evaluation/EvaluationTaskBrief";
import { useContadorClicks } from "../hooks/useContadorClicks";
import { useWorkspace } from "../components/workspace/WorkspaceLayout";
import { obtenerCategorias } from "../services/categories";
import { obtenerTareas } from "../services/tasks";
import {
  aceptarPropuesta,
  cancelarPropuesta,
  generarPropuesta,
  obtenerPropuestas,
} from "../services/proposals";
import { consultarEvaluacion, finalizarEvaluacion, type RegistroEvaluacion, type ResumenEvaluacion } from "../services/evaluacion";
import { ApiError } from "../services/api";
import type { Categoria } from "../types/categoria";
import type { Tarea } from "../types/tarea";
import type { AccionPropuesta, MensajeChat } from "../types/propuesta";
import { normalizarMensajes } from "../types/propuesta";
import "../styles/ai.css";

import "../styles/evaluation-grupos.css";

type Props = {
  accessToken: string;
  evaluacionActiva?: RegistroEvaluacion | null;
  onEstadoActualizado?: (estado: ResumenEvaluacion) => void;
};
type Operacion = "enviar" | "aceptar" | "cancelar" | "finalizar" | null;

export default function AiTasksPage({ accessToken, evaluacionActiva, onEstadoActualizado }: Props) {
  const navigate = useNavigate();
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

  const enPrueba = evaluacionActiva?.tipo_prueba === "ia"
    && evaluacionActiva.estado === "en_curso"
    && Boolean(evaluacionActiva.fecha_inicio);
  const clavePrueba = enPrueba ? `ia-${evaluacionActiva?.fecha_inicio}` : "";
  const claveAceptada = enPrueba ? `dotol:evaluacion:ia-aceptada:${evaluacionActiva?.fecha_inicio}` : "";
  const { clicks, obtenerClicks, limpiar } = useContadorClicks(enPrueba, clavePrueba);

  // Si aceptar la propuesta funcionó pero falló registrar el cierre,
  // recordamos ese hecho durante la pestaña para no ejecutar la propuesta dos veces.
  // El valor es el número de tareas creadas, o 0 si todas fueron otras operaciones.
  const [creadasAceptadas, setCreadasAceptadas] = useState<number | null>(() => {
    if (!claveAceptada) return null;
    const guardado = sessionStorage.getItem(claveAceptada);
    if (guardado === null) return null;
    const numero = Number(guardado);
    return Number.isInteger(numero) && numero >= 0 && numero <= 6 ? numero : null;
  });

  const recargarTodo = useCallback(async (signal?: AbortSignal) => {
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
    void obtenerCategorias(accessToken, controlador.signal)
      .then(async (listaCategorias) => {
        const [listaTareas, hilo] = await Promise.all([
          obtenerTareas(accessToken, controlador.signal),
          obtenerPropuestas(accessToken, controlador.signal),
        ]);
        if (controlador.signal.aborted) return;
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
      })
      .catch((fallo: unknown) => {
        if (!controlador.signal.aborted) {
          setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el chat.");
        }
      })
      .finally(() => {
        if (!controlador.signal.aborted) setCargando(false);
      });
    return () => controlador.abort();
  }, [accessToken]);

  async function enviarMensaje(texto: string): Promise<boolean> {
    if (ocupadoRef.current || cargando || creadasAceptadas !== null) return false;
    ocupadoRef.current = true;
    setOperacion("enviar");
    setError("");
    setAviso("");

    // Mostrar el mensaje del estudiante ANTES de esperar la respuesta de AWS.
    setMensajes((actuales) => [...actuales, { rol: "usuario", texto }]);

    try {
      const resultado = await generarPropuesta(accessToken, texto, idPropuesta);
      // El mensaje del estudiante ya esta en pantalla: agregar SOLO la respuesta.
      setMensajes((actuales) => [
        ...actuales,
        { rol: "asistente", texto: resultado.respuesta },
      ]);
      setAcciones(resultado.acciones);
      setIdPropuesta(resultado.id_propuesta);
      return true;
    } catch (fallo) {
      // Si la peticion falla, quitar la burbuja provisional (y recuperar el borrador).
      // Una respuesta 409 puede recuperar despues la conversacion real del servidor.
      setMensajes((actuales) => actuales.slice(0, -1));
      const detalle = fallo instanceof Error ? fallo.message : "No se pudo generar la propuesta.";
      if (fallo instanceof ApiError && fallo.status === 409) {
        try { await recargarTodo(); }
        catch { /* Se mantiene el error de generación. */ }
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

  async function registrarFinPrueba(cantCreadas: number) {
    let resultado: ResumenEvaluacion;
    try {
      resultado = await finalizarEvaluacion(
        accessToken,
        obtenerClicks(),
        cantCreadas
      );
    } catch (fallo) {
      // La aceptación ya ocurrió. Si se perdió la respuesta de finalizar,
      // consultamos el estado real antes de pedir al usuario que reintente.
      const actual = await consultarEvaluacion(accessToken);
      const registro = actual.evaluaciones.find((item) => item.tipo_prueba === "ia");
      if (!registro || !["pendiente_tlx", "pendiente_sus", "completada"].includes(registro.estado)) {
        throw fallo;
      }
      resultado = actual;
    }
    limpiar();
    if (claveAceptada) sessionStorage.removeItem(claveAceptada);
    onEstadoActualizado?.(resultado);
    navigate("/evaluacion", { replace: true });
  }

  async function aceptar() {
    if (!idPropuesta || acciones.length === 0 || ocupadoRef.current || creadasAceptadas !== null) return;
    ocupadoRef.current = true;
    setOperacion("aceptar");
    setError("");
    setAviso("");
    try {
      // Primero se aplican realmente las operaciones en DynamoDB.
      await aceptarPropuesta(accessToken, idPropuesta);
      const cantidadCreadas = acciones.filter((accion) => accion.op === "create").length;
      setMensajes([]);
      setAcciones([]);
      setIdPropuesta(null);

      if (enPrueba) {
        // Se guarda ANTES de solicitar /evaluacion/finalizar: si falla,
        // evitamos ejecutar nuevamente la propuesta ya aceptada.
        if (claveAceptada) sessionStorage.setItem(claveAceptada, String(cantidadCreadas));
        setCreadasAceptadas(cantidadCreadas);
        try {
          await registrarFinPrueba(cantidadCreadas);
        } catch (fallo) {
          setError(
            `Las tareas se guardaron correctamente, pero no se pudo cerrar la prueba: ${
              fallo instanceof Error ? fallo.message : "error de conexión"
            }. Pulsa «Reintentar cierre».`
          );
        }
      } else {
        setAviso("Cambios aplicados correctamente. Ya puedes verlos en Método Tradicional.");
      }
    } catch (fallo) {
      const detalle = fallo instanceof Error ? fallo.message : "No se pudo aceptar la propuesta.";
      if (fallo instanceof ApiError && fallo.status === 409) {
        try { await recargarTodo(); }
        catch { /* Se mantiene el error de aceptación. */ }
      }
      setError(detalle);
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  async function reintentarCierre() {
    if (!enPrueba || creadasAceptadas === null || ocupadoRef.current) return;
    ocupadoRef.current = true;
    setOperacion("finalizar");
    setError("");
    try {
      await registrarFinPrueba(creadasAceptadas);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo cerrar la evaluación.");
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  async function cancelar() {
    if (!idPropuesta || ocupadoRef.current || creadasAceptadas !== null) return;
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
        catch { /* Se mantiene el error. */ }
      }
      setError(detalle);
    } finally {
      ocupadoRef.current = false;
      setOperacion(null);
    }
  }

  return (
    <div className={`dt-ai-page ${enPrueba ? "dt-ai-page--evaluation" : ""}`}>
      {enPrueba && evaluacionActiva && (
        <div className="dt-ai-page__evaluation">
          <EvaluationTrialBar
            metodo="ia"
            orden={evaluacionActiva.orden}
            fechaInicio={evaluacionActiva.fecha_inicio}
            clicks={clicks}
          />
          <EvaluationTaskBrief registro={evaluacionActiva} compacto />
        </div>
      )}

      <div className="dt-ai-page__conversation">
        {error && <div className="dt-ai-page__alert dt-ai-page__alert--error" role="alert">{error}</div>}
        {aviso && <div className="dt-ai-page__alert dt-ai-page__alert--success" role="status">{aviso}</div>}
        {enPrueba && creadasAceptadas !== null && (
          <div className="dt-eval-retry" role="status">
            <p>Ya aceptaste las acciones. Falta registrar el fin de la prueba.</p>
            <button
              className="dt-btn dt-btn--primary"
              type="button"
              onClick={() => void reintentarCierre()}
              disabled={operacion !== null}
            >
              {operacion === "finalizar" ? "Registrando..." : "Reintentar cierre"}
            </button>
          </div>
        )}
        {cargando ? (
          <p className="dt-ai-page__loading">Recuperando conversación y categorías…</p>
        ) : (
          <ConversationPanel
            mensajes={mensajes}
            nombre={nombre}
            enviando={operacion === "enviar"}
            bloqueado={operacion !== null || creadasAceptadas !== null}
            onEnviar={enviarMensaje}
          />
        )}
      </div>
      <ProposalPanel
        acciones={acciones}
        categorias={categorias}
        tareas={tareas}
        propuestaPendiente={idPropuesta !== null}
        procesando={cargando || operacion !== null || creadasAceptadas !== null}
        onAceptar={() => { void aceptar(); }}
        onCancelar={() => { void cancelar(); }}
      />
    </div>
  );
}
