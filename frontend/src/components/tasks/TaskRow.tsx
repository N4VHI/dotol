import { Clock3, Pencil, Trash2 } from "lucide-react";
import type { Tarea } from "../../types/tarea";

type Props = {
  tarea: Tarea;
  procesando: boolean;
  bloqueado: boolean;
  onCompletar: (id: string) => void;
  onEditar: (tarea: Tarea) => void;
  onEliminar: (tarea: Tarea) => void;
};

function vencimiento(tarea: Tarea) {
  const dia = tarea.fecha_dia;
  if (!dia) return { fecha: "Sin fecha", hora: "--:--" };
  const [anio, mes, fecha] = dia.split("-");
  let hora = "--:--";
  if (tarea.fecha_hacer) {
    const instante = new Date(tarea.fecha_hacer);
    if (!Number.isNaN(instante.getTime())) {
      hora = new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(instante);
    }
  }
  return { fecha: `${fecha}/${mes}/${anio}`, hora };
}

export default function TaskRow({ tarea, procesando, bloqueado, onCompletar, onEditar, onEliminar }: Props) {
  const completada = tarea.estado === "completada";
  const fecha = vencimiento(tarea);
  return (
    <div className={`dt-task ${completada ? "dt-task--done" : ""}`}>
      <label className="dt-task__check-label" title={completada ? "Tarea completada" : "Completar tarea"}>
        <input type="checkbox" checked={completada} disabled={completada || bloqueado || procesando}
          onChange={() => onCompletar(tarea.id_tarea)}
          aria-label={completada ? `${tarea.nombre} completada` : `Completar ${tarea.nombre}`} />
      </label>
      <div className="dt-task__body">
        <p className="dt-task__name">{tarea.nombre}</p>
        {tarea.descripcion && <p className="dt-task__description">{tarea.descripcion}</p>}
      </div>
      <div className="dt-task__date" aria-label="Fecha programada">
        <span><Clock3 size={12} strokeWidth={1.8} /> {fecha.hora}</span>
        <span>{fecha.fecha}</span>
      </div>
      <div className="dt-task__actions">
        {!completada && <button type="button" className="dt-task__icon-btn" disabled={bloqueado}
          onClick={() => onEditar(tarea)} title="Editar tarea" aria-label={`Editar ${tarea.nombre}`}><Pencil size={15}/></button>}
        <button type="button" className="dt-task__icon-btn dt-task__icon-btn--danger" disabled={bloqueado}
          onClick={() => onEliminar(tarea)} title="Eliminar tarea" aria-label={`Eliminar ${tarea.nombre}`}><Trash2 size={15}/></button>
      </div>
    </div>
  );
}
