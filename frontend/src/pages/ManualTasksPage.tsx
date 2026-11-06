import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";

import type { Tarea } from "../types/tarea";
import type { Categoria } from "../types/categoria";
import { obtenerTareas, completarTarea, eliminarTarea } from "../services/tasks";
import { obtenerCategorias } from "../services/categories";
import {
  consultarEvaluacion,
  finalizarEvaluacion,
  type RegistroEvaluacion,
  type ResumenEvaluacion,
} from "../services/evaluacion";
import { useContadorClicks } from "../hooks/useContadorClicks";
import { useWorkspace } from "../components/workspace/WorkspaceLayout";
import EvaluationTrialBar from "../components/evaluation/EvaluationTrialBar";
import EvaluationTaskBrief from "../components/evaluation/EvaluationTaskBrief";
import TaskGroup from "../components/tasks/TaskGroup";
import CreateTaskModal from "../components/tasks/CreateTaskModal";
import EditTaskModal from "../components/tasks/EditTaskModal";

import "../styles/evaluation-grupos.css";

type Props = {
  accessToken: string;
  evaluacionActiva?: RegistroEvaluacion | null;
  onEstadoActualizado?: (estado: ResumenEvaluacion) => void;
};

export default function ManualTasksPage({
  accessToken,
  evaluacionActiva,
  onEstadoActualizado,
}: Props) {
  const navigate = useNavigate();
  const { busqueda, nombre } = useWorkspace();

  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [tareaEditando, setTareaEditando] = useState<Tarea | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [diaReferencia] = useState(() => new Date());

  const enPrueba = evaluacionActiva?.tipo_prueba === "tradicional"
    && evaluacionActiva.estado === "en_curso"
    && Boolean(evaluacionActiva.fecha_inicio);
  const fechaInicioPrueba = evaluacionActiva?.fecha_inicio;
  const clavePrueba = enPrueba ? `tradicional-${fechaInicioPrueba}` : "";
  const { clicks, obtenerClicks, limpiar } = useContadorClicks(enPrueba, clavePrueba);

  const recargarTareas = useCallback(async () => {
    setTareas(await obtenerTareas(accessToken));
  }, [accessToken]);

  useEffect(() => {
    const controlador = new AbortController();
    void Promise.all([
      obtenerTareas(accessToken, controlador.signal),
      obtenerCategorias(accessToken, controlador.signal),
    ]).then(([listaTareas, listaCategorias]) => {
      if (!controlador.signal.aborted) {
        setTareas(listaTareas);
        setCategorias(listaCategorias);
      }
    }).catch((fallo: unknown) => {
      if (!controlador.signal.aborted) {
        setError(fallo instanceof Error ? fallo.message : "Error al cargar las tareas.");
      }
    }).finally(() => {
      if (!controlador.signal.aborted) setCargando(false);
    });
    return () => controlador.abort();
  }, [accessToken]);

  async function completar(id: string) {
    if (procesandoId || finalizando) return;
    setError("");
    setMensaje("");
    setProcesandoId(id);
    try {
      await completarTarea(accessToken, id);
      await recargarTareas();
      setMensaje("Tarea completada correctamente.");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo completar la tarea.");
    } finally {
      setProcesandoId(null);
    }
  }

  async function eliminar(tarea: Tarea) {
    if (procesandoId || finalizando) return;
    setError("");
    setMensaje("");
    setProcesandoId(tarea.id_tarea);
    try {
      await eliminarTarea(accessToken, tarea.id_tarea);
      await recargarTareas();
      setMensaje("Tarea eliminada correctamente.");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo eliminar la tarea.");
    } finally {
      setProcesandoId(null);
    }
  }

  const tareasVisibles = useMemo(() => {
    const buscar = busqueda.trim().toLocaleLowerCase("es");
    return tareas.filter((t) => {
      if (t.estado === "eliminada") return false;
      // Durante la prueba manual ocultamos las tareas de otros métodos/etapas.
      if (enPrueba) {
        const inicio = Date.parse(fechaInicioPrueba ?? "");
        if (t.creada_por_ia !== false || !Number.isFinite(inicio)
          || !Number.isFinite(Date.parse(t.fecha_creacion))
          || Date.parse(t.fecha_creacion) < inicio) return false;
      }
      if (!buscar) return true;
      return [t.nombre, t.descripcion, t.categoria].some((v) =>
        (v ?? "").toLocaleLowerCase("es").includes(buscar)
      );
    });
  }, [tareas, busqueda, enPrueba, fechaInicioPrueba]);

  // Contamos únicamente tareas manuales creadas durante ESTA prueba,
  // no todas las tareas existentes del estudiante ni las creadas por IA.
  const tareasCreadasEnPrueba = useMemo(() => {
    if (!enPrueba || !fechaInicioPrueba) return [];
    const inicio = Date.parse(fechaInicioPrueba);
    if (!Number.isFinite(inicio)) return [];
    return tareas.filter((t) =>
      t.creada_por_ia === false &&
      t.estado !== "eliminada" &&
      Number.isFinite(Date.parse(t.fecha_creacion)) &&
      Date.parse(t.fecha_creacion) >= inicio
    );
  }, [tareas, enPrueba, fechaInicioPrueba]);

  const cantidadPrueba = tareasCreadasEnPrueba.length;

  async function terminarPruebaTradicional() {
    if (!enPrueba || finalizando || procesandoId || mostrarFormulario || tareaEditando) return;
    // El participante decide cuándo acabar. No comparamos cantidad, nombres o fechas.
    // No mostramos confirmación adicional: el clic en «Terminar prueba» es suficiente.

    setFinalizando(true);
    setError("");
    try {
      // El clic en «Terminar prueba» ya fue contabilizado en fase de captura.
      let estado: ResumenEvaluacion;
      try {
        estado = await finalizarEvaluacion(accessToken, obtenerClicks(), cantidadPrueba);
      } catch (fallo) {
        // Si se perdió la respuesta HTTP, la Lambda pudo haber terminado la prueba.
        const actual = await consultarEvaluacion(accessToken);
        const registro = actual.evaluaciones.find((item) => item.tipo_prueba === "tradicional");
        if (!registro || !["pendiente_tlx", "pendiente_sus", "completada"].includes(registro.estado)) {
          throw fallo;
        }
        estado = actual;
      }
      limpiar();
      onEstadoActualizado?.(estado);
      navigate("/evaluacion", { replace: true });
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo terminar la prueba.");
      // En un fallo dejamos intacto el contador para que pueda reintentarse.
    } finally {
      setFinalizando(false);
    }
  }

  const pendientes = tareasVisibles.filter((t) => t.estado === "pendiente");
  const completadas = tareasVisibles.filter((t) => t.estado === "completada");
  const grupos = useMemo(() => {
    const agrupadas = new Map<string, { titulo: string; tareas: Tarea[] }>();
    const porId = new Map(categorias.map((c) => [c.id_categoria, c.nombre]));
    for (const tarea of tareasVisibles) {
      if (tarea.estado !== "pendiente") continue;
      const titulo = (tarea.id_categoria && porId.get(tarea.id_categoria))
        || tarea.categoria || "Sin categoría";
      const grupo = agrupadas.get(titulo) ?? { titulo, tareas: [] };
      grupo.tareas.push(tarea);
      agrupadas.set(titulo, grupo);
    }
    return [...agrupadas.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
  }, [tareasVisibles, categorias]);

  const fechaTexto = new Intl.DateTimeFormat("es-PE", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/Lima",
  }).format(diaReferencia).toLocaleUpperCase("es");

  return (
    <div className="dt-page">
      {enPrueba && evaluacionActiva && (
        <>
          <EvaluationTrialBar
            metodo="tradicional"
            orden={evaluacionActiva.orden}
            fechaInicio={evaluacionActiva.fecha_inicio}
            clicks={clicks}
            onFinalizar={() => void terminarPruebaTradicional()}
            finalizando={finalizando || cargando || procesandoId !== null}
          />
          <EvaluationTaskBrief registro={evaluacionActiva} compacto />
          <p className="dt-eval-progress" role="status">
            Tareas registradas durante esta prueba: <strong>{cantidadPrueba}</strong>
          </p>
        </>
      )}

      <div className="dt-page__intro">
        <div className="dt-page__greeting">
          <span className="dt-page__eyebrow">{fechaTexto}</span>
          <h1>Sigamos avanzando{nombre ? `, ${nombre}` : ""}.</h1>
          <p>Un poco de concentración, nos lleva más lejos.</p>
        </div>
        <button
          type="button"
          className="dt-btn dt-btn--primary dt-page__add"
          onClick={() => setMostrarFormulario(true)}
          disabled={finalizando}
          title="Añadir tarea"
        >
          <Plus size={17} strokeWidth={2.1} /> Añadir tarea
        </button>
      </div>

      <div className="dt-page__tabs"><span>Mis tareas</span></div>
      {mensaje && <p className="dt-feedback dt-feedback--success" role="status">{mensaje}</p>}
      {error && <p className="dt-feedback dt-feedback--error" role="alert">{error}</p>}
      {cargando ? <p className="dt-page__empty">Cargando tareas y categorías...</p> : (
        <div className="dt-page__groups">
          {grupos.map((grupo) => (
            <TaskGroup
              key={grupo.titulo}
              titulo={grupo.titulo}
              tareas={grupo.tareas}
              procesandoId={procesandoId}
              onCompletar={(id) => { void completar(id); }}
              onEditar={setTareaEditando}
              onEliminar={(tarea) => { void eliminar(tarea); }}
            />
          ))}
          {pendientes.length === 0 && (!busqueda.trim() || tareasVisibles.length === 0) && (
            <p className="dt-page__empty">
              {busqueda.trim() ? "No encontramos tareas con esa búsqueda." : "Todavía no tienes tareas pendientes. ¡Añade la primera!"}
            </p>
          )}
          {completadas.length > 0 && (
            <TaskGroup
              titulo="Completadas"
              tareas={completadas}
              inicialmenteAbierto={false}
              procesandoId={procesandoId}
              onCompletar={() => {}}
              onEditar={setTareaEditando}
              onEliminar={(tarea) => { void eliminar(tarea); }}
            />
          )}
        </div>
      )}

      {mostrarFormulario && (
        <CreateTaskModal
          accessToken={accessToken}
          categorias={categorias}
          onCerrar={() => setMostrarFormulario(false)}
          onCreada={async () => {
            await recargarTareas();
            setMensaje("Tarea registrada correctamente.");
            setError("");
          }}
        />
      )}
      {tareaEditando && (
        <EditTaskModal
          key={tareaEditando.id_tarea}
          accessToken={accessToken}
          tarea={tareaEditando}
          categorias={categorias}
          onCerrar={() => setTareaEditando(null)}
          onActualizada={async () => {
            await recargarTareas();
            setMensaje("Tarea actualizada correctamente.");
            setError("");
          }}
        />
      )}
    </div>
  );
}
