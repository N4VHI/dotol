import { ArrowRight, Bot, PanelLeft } from "lucide-react";
import type { MetodoEvaluacion, RegistroEvaluacion } from "../services/evaluacion";
import EvaluationTaskBrief from "../components/evaluation/EvaluationTaskBrief";

type Props = {
  metodo: MetodoEvaluacion;
  orden: 1 | 2;
  iniciando: boolean;
  onIniciar: () => void;
  registro: RegistroEvaluacion;
};

export default function EvaluationControlPage({ metodo, orden, iniciando, onIniciar, registro }: Props) {
  const esIA = metodo === "ia";
  const grupoAusente = !registro.texto_grupo?.trim() && !registro.tareas_objetivo?.length;

  return (
    <div className="dt-eval-screen">
      <section className="dt-eval-card">
        <span className="dt-eval-badge">Control de la prueba</span>
        <h1>{esIA ? "Vas a empezar con el Método IA" : "Vas a empezar con el Método Tradicional"}</h1>
        <p className="dt-eval-lead">
          Esta es la <strong>prueba {orden} de 2</strong>. Cuando pulses el botón de abajo se iniciarán el cronómetro y el contador de clics.
        </p>

        <div className="dt-eval-method-preview">
          <div className="dt-eval-method-preview__icon">
            {esIA ? <Bot size={22} /> : <PanelLeft size={22} />}
          </div>
          <div>
            <strong>{esIA ? "Método IA" : "Método Tradicional"}</strong>
            <p>
              {esIA
                ? "Describe las tareas en el chat y acepta los cambios cuando estés conforme."
                : "Registra manualmente tus tareas. Hemos añadido un botón para terminar la prueba cuando acabes."}
            </p>
          </div>
        </div>

        {grupoAusente ? (
          <p role="alert" className="dt-feedback dt-feedback--error">
            Tu evaluación fue preparada con una versión anterior, sin grupos asignados.
            Para probar este nuevo experimento utiliza una cuenta de prueba nueva.
          </p>
        ) : <EvaluationTaskBrief registro={registro} />}

        <ul className="dt-eval-checklist">
          <li>No cierres la pestaña mientras realizas la prueba.</li>
          <li>Intenta registrar todas tus tareas en una sola sesión.</li>
          <li>Cuando termines, pasarás inmediatamente a NASA-TLX.</li>
        </ul>

        <div className="dt-eval-actions">
          <button type="button" className="dt-btn dt-btn--primary" onClick={onIniciar} disabled={iniciando || grupoAusente}>
            <ArrowRight size={17} /> {iniciando ? "Iniciando..." : "Iniciar prueba"}
          </button>
        </div>
      </section>
    </div>
  );
}
