import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Tarea } from "../types/tarea";
import type { Categoria } from "../types/categoria";
import { obtenerTareas, completarTarea, eliminarTarea } from "../services/tasks";
import { obtenerCategorias } from "../services/categories";
import { useWorkspace } from "../components/workspace/WorkspaceLayout";
import TaskGroup from "../components/tasks/TaskGroup";
import CreateTaskModal from "../components/tasks/CreateTaskModal";
import EditTaskModal from "../components/tasks/EditTaskModal";

type Props = { accessToken: string };

export default function ManualTasksPage({ accessToken }: Props) {
  const { busqueda, nombre } = useWorkspace();
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [tareaEditando, setTareaEditando] = useState<Tarea | null>(null);
  const [diaReferencia] = useState(() => new Date());

  const cargarTodo = useCallback(async (signal?: AbortSignal) => {
    const [tareas, categorias] = await Promise.all([
      obtenerTareas(accessToken, signal), obtenerCategorias(accessToken, signal),
    ]);
    return { tareas, categorias };
  }, [accessToken]);

  const recargarTareas = useCallback(async () => {
    setTareas(await obtenerTareas(accessToken));
  }, [accessToken]);

  useEffect(() => {
    const controlador = new AbortController();
    void cargarTodo(controlador.signal)
      .then(({ tareas, categorias }) => {
        if (!controlador.signal.aborted) { setTareas(tareas); setCategorias(categorias); }
      })
      .catch((fallo) => {
        if (!controlador.signal.aborted) setError(fallo instanceof Error ? fallo.message : "Error al cargar las tareas.");
      })
      .finally(() => { if (!controlador.signal.aborted) setCargando(false); });
    return () => controlador.abort();
  }, [cargarTodo]);

  async function completar(id: string) {
    if (procesandoId) return;
    setError(""); setMensaje(""); setProcesandoId(id);
    try {
      await completarTarea(accessToken, id);
      await recargarTareas();
      setMensaje("Tarea completada correctamente.");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo completar la tarea.");
    } finally { setProcesandoId(null); }
  }

  async function eliminar(tarea: Tarea) {
    if (procesandoId) return;
    if (!window.confirm(`¿Eliminar «${tarea.nombre}»? Esta acción quitará la tarea de la lista.`)) return;
    setError(""); setMensaje(""); setProcesandoId(tarea.id_tarea);
    try {
      await eliminarTarea(accessToken, tarea.id_tarea);
      await recargarTareas();
      setMensaje("Tarea eliminada correctamente.");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo eliminar la tarea.");
    } finally { setProcesandoId(null); }
  }

  const tareasVisibles = useMemo(() => {
    const buscar = busqueda.trim().toLocaleLowerCase("es");
    return tareas.filter((t) => {
      if (t.estado === "eliminada") return false;
      if (!buscar) return true;
      return [t.nombre, t.descripcion, t.categoria].some((v) =>
        (v ?? "").toLocaleLowerCase("es").includes(buscar));
    });
  }, [tareas, busqueda]);
  const pendientes = tareasVisibles.filter((t) => t.estado === "pendiente");
  const completadas = tareasVisibles.filter((t) => t.estado === "completada");
  const grupos = useMemo(() => {
    const agrupadas = new Map<string, { titulo: string; tareas: Tarea[] }>();
    const porId = new Map(categorias.map((c) => [c.id_categoria, c.nombre]));
    for (const tarea of tareasVisibles) {
      if (tarea.estado !== "pendiente") continue;
      const titulo = (tarea.id_categoria && porId.get(tarea.id_categoria)) || tarea.categoria || "Sin categoría";
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
      <div className="dt-page__intro">
        <div className="dt-page__greeting">
          <span className="dt-page__eyebrow">{fechaTexto}</span>
          <h1>Sigamos avanzando{nombre ? `, ${nombre}` : ""}.</h1>
          <p>Un poco de concentración, nos lleva más lejos.</p>
        </div>
        <button type="button" className="dt-btn dt-btn--primary dt-page__add" onClick={() => setMostrarFormulario(true)}>
          <Plus size={17} strokeWidth={2.1} /> Añadir tarea
        </button>
      </div>
      <div className="dt-page__tabs"><span>Mis tareas</span></div>
      {mensaje && <p className="dt-feedback dt-feedback--success" role="status">{mensaje}</p>}
      {error && <p className="dt-feedback dt-feedback--error" role="alert">{error}</p>}
      {cargando ? <p className="dt-page__empty">Cargando tareas y categorías...</p> : (
        <div className="dt-page__groups">
          {grupos.map((grupo) => <TaskGroup key={grupo.titulo} titulo={grupo.titulo} tareas={grupo.tareas}
            procesandoId={procesandoId} onCompletar={(id) => { void completar(id); }}
            onEditar={setTareaEditando} onEliminar={(tarea) => { void eliminar(tarea); }} />)}
          {pendientes.length === 0 && (!busqueda.trim() || tareasVisibles.length === 0) && (
            <p className="dt-page__empty">{busqueda.trim() ? "No encontramos tareas con esa búsqueda." : "Todavía no tienes tareas pendientes. ¡Añade la primera!"}</p>
          )}
          {completadas.length > 0 && <TaskGroup titulo="Completadas" tareas={completadas}
            inicialmenteAbierto={false} procesandoId={procesandoId} onCompletar={() => {}}
            onEditar={setTareaEditando} onEliminar={(tarea) => { void eliminar(tarea); }} />}
        </div>
      )}
      {mostrarFormulario && <CreateTaskModal accessToken={accessToken} categorias={categorias}
        onCerrar={() => setMostrarFormulario(false)}
        onCreada={async () => { await recargarTareas(); setMensaje("Tarea registrada correctamente."); setError(""); }} />}
      {tareaEditando && <EditTaskModal key={tareaEditando.id_tarea} accessToken={accessToken}
        tarea={tareaEditando} categorias={categorias} onCerrar={() => setTareaEditando(null)}
        onActualizada={async () => { await recargarTareas(); setMensaje("Tarea actualizada correctamente."); setError(""); }} />}
    </div>
  );
}
