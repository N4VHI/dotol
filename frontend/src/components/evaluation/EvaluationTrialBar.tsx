import { useEffect, useState } from "react";
import { Bot, Clock3, Flag, MousePointerClick, SquareCheckBig } from "lucide-react";
import type { MetodoEvaluacion } from "../../services/evaluacion";

type Props = {
  metodo: MetodoEvaluacion;
  orden: 1 | 2;
  fechaInicio: string | null;
  clicks: number;
  onFinalizar?: () => void;
  finalizando?: boolean;
  finalizarDeshabilitado?: boolean;
};

function formatearSegundos(total: number) {
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

export default function EvaluationTrialBar({
  metodo,
  orden,
  fechaInicio,
  clicks,
  onFinalizar,
  finalizando = false,
  finalizarDeshabilitado = false,
}: Props) {
  // Date.now() solo se ejecuta en un efecto; nunca durante el render de React.
  const [ahora, setAhora] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const comienzo = fechaInicio ? Date.parse(fechaInicio) : NaN;
  const segundos = Number.isFinite(comienzo) && ahora > 0
    ? Math.max(0, Math.floor((ahora - comienzo) / 1000))
    : 0;

  return (
    <section className="dt-eval-bar" aria-label="Control de la prueba">
      <div className="dt-eval-bar__main">
        <span className="dt-eval-bar__pill">
          {metodo === "ia" ? <Bot size={15} /> : <SquareCheckBig size={15} />}
          {metodo === "ia" ? "Método IA" : "Método tradicional"}
        </span>
        <div className="dt-eval-bar__metrics">
          <span><Flag size={15} /> Prueba {orden} de 2</span>
          <span><Clock3 size={15} /> {formatearSegundos(segundos)}</span>
          <span><MousePointerClick size={15} /> {clicks} clics</span>
        </div>
      </div>

      <div className="dt-eval-bar__aside">
        <p>
          {metodo === "ia"
            ? "Al terminar, pulsa «Aceptar cambios» en el panel derecho."
            : "Al terminar de registrar tus tareas, pulsa «Terminar prueba»."}
        </p>
        {metodo === "tradicional" && onFinalizar && (
          <button
            type="button"
            className="dt-btn dt-btn--primary"
            onClick={onFinalizar}
            disabled={finalizando || finalizarDeshabilitado}
            title={finalizarDeshabilitado ? "Registra al menos una tarea antes de terminar la prueba" : undefined}
          >
            {finalizando ? "Finalizando..." : "Terminar prueba"}
          </button>
        )}
      </div>
    </section>
  );
}
