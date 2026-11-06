import { useState } from "react";
import { ChevronDown, ChevronRight, Leaf, Plus } from "lucide-react";
import type { AccionPropuesta } from "../../types/propuesta";
import type { Categoria } from "../../types/categoria";
import type { Tarea } from "../../types/tarea";

type Props = {
  acciones: AccionPropuesta[];
  categorias: Categoria[];
  tareas: Tarea[];
  propuestaPendiente: boolean;
  procesando: boolean;
  onAceptar: () => void;
  onCancelar: () => void;
};

type Fila = {
  accion: AccionPropuesta;
  indice: number;
  nombre: string;
  detalle: string;
  fecha: string;
  grupo: string;
};

const etiquetas = {
  create: "Crear",
  update: "Actualizar",
  complete: "Completar",
  delete: "Eliminar",
} as const;

function fechaVisual(dia: string | null) {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "--/--/----";
  const [anio, mes, fecha] = dia.split("-");
  return `${fecha}/${mes}/${anio}`;
}

function GrupoAcciones({ titulo, filas }: { titulo: string; filas: Fila[] }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <section className="dt-ai-group">
      <button
        className="dt-ai-group__heading"
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
      >
        {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <strong>{titulo}</strong>
        <small>{filas.length}</small>
      </button>
      {abierto && (
        <div className="dt-ai-group__rows">
          {filas.map((fila) => (
            <div className="dt-ai-proposal-row" key={fila.indice}>
              {/* Indicador visual: estas casillas NO ejecutan acciones en la base de datos. */}
              <span className="dt-ai-proposal-row__box" aria-hidden="true" />
              <div className="dt-ai-proposal-row__content">
                <strong>{fila.nombre}</strong>
                <span>{fila.detalle}</span>
              </div>
              <div className="dt-ai-proposal-row__meta">
                <span className={`dt-ai-tag dt-ai-tag--${fila.accion.op}`}>{etiquetas[fila.accion.op]}</span>
                <time>{fila.fecha}</time>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ProposalPanel({ acciones, categorias, tareas, propuestaPendiente, procesando, onAceptar, onCancelar }: Props) {
  const categoriasPorId = new Map(categorias.map((c) => [c.id_categoria, c.nombre]));
  const tareasPorId = new Map(tareas.map((t) => [t.id_tarea, t]));
  const grupos = new Map<string, Fila[]>();

  acciones.forEach((accion, indice) => {
    const tarea = accion.id ? tareasPorId.get(accion.id) : undefined;
    // En update, category_id no nulo es la categoría de DESTINO propuesta.
    // category_id null significa que la categoría actual se conserva.
    const categoriaDestino = accion.op === "create" || accion.op === "update"
      ? accion.category_id : null;
    const grupo = (categoriaDestino && categoriasPorId.get(categoriaDestino))
      || (tarea?.id_categoria && categoriasPorId.get(tarea.id_categoria))
      || tarea?.categoria || "Sin categoría";
    const nombre = accion.title || tarea?.nombre || "Tarea no disponible";
    const detalle = accion.op === "create"
      ? "Nueva tarea propuesta"
      : tarea?.descripcion || "Tarea existente";
    const fecha = fechaVisual(
      accion.op === "create" || accion.op === "update"
        ? accion.due
        : tarea?.fecha_dia ?? null
    );
    const fila: Fila = { accion, indice, nombre, detalle, fecha, grupo };
    grupos.set(grupo, [...(grupos.get(grupo) || []), fila]);
  });

  return (
    <section className="dt-ai-proposals" aria-label="Acciones propuestas pendientes">
      <header className="dt-ai-proposals__intro">
        <h1>Tareas</h1>
        <p>Puedes ajustar las acciones continuando la conversación antes de aceptarlas.</p>
      </header>

      <div className="dt-ai-proposals__scroll">
        {acciones.length === 0 ? (
          <div className="dt-ai-proposals__empty">
            {propuestaPendiente
              ? "No hay acciones pendientes en esta propuesta. Continúa conversando o cancela el hilo."
              : "Las acciones que proponga Dotol aparecerán aquí antes de guardarse."}
          </div>
        ) : (
          Array.from(grupos.entries()).map(([titulo, filas]) => (
            <GrupoAcciones key={titulo} titulo={titulo} filas={filas} />
          ))
        )}
      </div>

      <div className="dt-ai-proposals__footer">
        <p><Leaf size={15} strokeWidth={1.8} aria-hidden="true" /> Revisa las acciones y luego selecciona «Aceptar cambios».</p>
        <div className="dt-ai-proposals__buttons">
          <button
            type="button"
            className="dt-ai-btn dt-ai-btn--cancel"
            disabled={!propuestaPendiente || procesando}
            onClick={onCancelar}
          >
            Cancelar cambios
          </button>
          <button
            type="button"
            className="dt-ai-btn dt-ai-btn--accept"
            disabled={!propuestaPendiente || acciones.length === 0 || procesando}
            onClick={onAceptar}
          >
            <Plus size={21} aria-hidden="true" /> Aceptar cambios
          </button>
        </div>
        <span className="dt-ai-proposals__count">{acciones.length} de 6 acciones propuestas</span>
      </div>
    </section>
  );
}
