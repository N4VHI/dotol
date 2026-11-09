import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import type { RegistroEvaluacion } from "../../services/evaluacion";
import "../../styles/evaluation-texto.css";

type Props = { registro: RegistroEvaluacion; compacto?: boolean };

export default function EvaluationTaskBrief({ registro, compacto = false }: Props) {
  const [abierto, setAbierto] = useState(!compacto);
  const texto = registro.texto_grupo?.trim() ?? "";
  const tareasAnteriores = registro.tareas_objetivo ?? [];
  return (
    <section className={`dt-eval-brief ${compacto ? "dt-eval-brief--compact" : ""}`}>
      <button type="button" className="dt-eval-brief__toggle"
        onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <span><ClipboardList size={17} /> Grupo {registro.grupo_asignado ?? "asignado"} · Tareas a registrar</span>
        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {abierto && (texto ? (
        <p className="dt-eval-brief__text">{texto}</p>
      ) : tareasAnteriores.length ? (
        <ol className="dt-eval-brief__tasks">
          {tareasAnteriores.map((tarea, i) => (
            <li key={`${i}-${tarea.nombre}`}>
              <strong>{tarea.nombre}</strong>
              {tarea.descripcion && <p>{tarea.descripcion}</p>}
              {tarea.fecha_dia && <span className="dt-eval-brief__date"><CalendarDays size={13} /> {tarea.fecha_dia}</span>}
            </li>
          ))}
        </ol>
      ) : <p className="dt-eval-brief__text">No se encontraron las instrucciones del grupo.</p>)}
    </section>
  );
}
