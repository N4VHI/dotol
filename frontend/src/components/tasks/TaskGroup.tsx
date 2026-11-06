import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Tarea } from "../../types/tarea";
import TaskRow from "./TaskRow";

type Props = {
  titulo: string;
  tareas: Tarea[];
  inicialmenteAbierto?: boolean;
  procesandoId: string | null;
  onCompletar: (id: string) => void;
  onEditar: (tarea: Tarea) => void;
  onEliminar: (tarea: Tarea) => void;
};

export default function TaskGroup({ titulo, tareas, inicialmenteAbierto = true, procesandoId,
  onCompletar, onEditar, onEliminar }: Props) {
  const [abierto, setAbierto] = useState(inicialmenteAbierto);
  return (
    <section className="dt-task-group" aria-label={titulo}>
      <button type="button" className="dt-task-group__toggle" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>{titulo}</strong><span>{tareas.length}</span>
      </button>
      {abierto && <div className="dt-task-group__list">
        {tareas.map((tarea) => <TaskRow key={tarea.id_tarea} tarea={tarea}
          procesando={procesandoId === tarea.id_tarea} bloqueado={procesandoId !== null}
          onCompletar={onCompletar} onEditar={onEditar} onEliminar={onEliminar} />)}
      </div>}
    </section>
  );
}
