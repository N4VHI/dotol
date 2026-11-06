import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import "../styles/questionnaires.css";

/**
 * El orden de envío coincide con el backend:
 * mental, física, temporal, desempeño, esfuerzo, frustración.
 * En desempeño, 0 = buen rendimiento y 100 = mal rendimiento.
 */
const DIMENSIONES = [
  { titulo: "Demanda mental", izq: "0 · Muy baja", der: "100 · Muy alta" },
  { titulo: "Demanda física", izq: "0 · Muy baja", der: "100 · Muy alta" },
  { titulo: "Demanda temporal", izq: "0 · Muy baja", der: "100 · Muy alta" },
  { titulo: "Rendimiento", izq: "0 · Muy bueno", der: "100 · Muy malo", destacado: true },
  { titulo: "Esfuerzo", izq: "0 · Muy bajo", der: "100 · Muy alto"},
  { titulo: "Frustración", izq: "0 · Muy baja", der: "100 · Muy alta" },
] as const;

type Props = {
  enviando: boolean;
  onEnviar: (respuestas: number[]) => void;
};

export default function NasaTlxMockPage({ enviando, onEnviar }: Props) {
  // Sin valores predeterminados válidos. Mover o pulsar cada barra registra una respuesta.
  const [respuestas, setRespuestas] = useState<Array<number | null>>(
    () => Array(6).fill(null)
  );

  const respondidas = respuestas.filter((valor) => valor !== null).length;
  const completo = respondidas === DIMENSIONES.length;

  function responder(indice: number, valor: number) {
    setRespuestas((actuales) =>
      actuales.map((respuesta, i) => (i === indice ? valor : respuesta))
    );
  }

  function finalizar() {
    if (enviando) return;
    const valores = respuestas.filter((valor): valor is number => valor !== null);
    if (valores.length !== DIMENSIONES.length) return;
    onEnviar(valores);
  }

  function dimension(indice: number) {
    const item = DIMENSIONES[indice];
    const respondida = respuestas[indice] !== null;
    const valor = respuestas[indice] ?? 50;
    const estilo = { "--dt-survey-fill": `${valor}%` } as CSSProperties;

    return (
      <div className={`dt-survey-tlx-card ${item.titulo === "Rendimiento" ? "dt-survey-tlx-card--effort" : ""}`} key={indice}>
        <label className="dt-survey-tlx-card__title" htmlFor={`dt-tlx-${indice}`}>
          <span className="dt-survey-tlx-card__number">{String(indice + 1).padStart(2, "0")}</span>
          <span>{item.titulo}</span>
        </label>
        <input
          id={`dt-tlx-${indice}`}
          className="dt-survey-tlx-card__slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={valor}
          style={estilo}
          onChange={(evento) => responder(indice, Number(evento.target.value))}
          onPointerUp={(evento) => {
            // También permite responder 50 haciendo clic exactamente en el centro.
            if (!respondida) responder(indice, Number(evento.currentTarget.value));
          }}
          disabled={enviando}
          aria-valuetext={respondida ? `${valor} de 100` : "Aún no respondida. Mueve la barra para elegir."}
          aria-describedby={item.titulo === "Rendimiento" ? "dt-tlx-rendimiento-ayuda" : undefined}
        />
        <div className="dt-survey-tlx-card__value" aria-live="off">
          {respondida ? valor : <span className="dt-survey-tlx-card__unanswered">Sin responder</span>}
        </div>
        <div className="dt-survey-tlx-card__anchors">
          <span>{item.izq}</span>
          <span>{item.der}</span>
        </div>
        {item.titulo === "Rendimiento" && (
          <p id="dt-tlx-rendimiento-ayuda" className="dt-survey-tlx-card__hint">
            0 = desempeño satisfactorio · 100 = desempeño insatisfactorio
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="dt-questionnaire dt-questionnaire--tlx">
      <div className="dt-questionnaire__content">
        <div className="dt-questionnaire__eyebrow-row">
          <span className="dt-questionnaire__eyebrow">Recolección de datos</span>
          <span className="dt-questionnaire__estimate" title="Tiempo estimado para responder">
            <Clock3 size={15} aria-hidden="true" /> 2 minutos
          </span>
        </div>

        <header className="dt-questionnaire__header">
          <h1>Evaluación Raw NASA TLX</h1>
          <p>Por favor, responde el siguiente cuestionario sobre la carga de trabajo percibida del método utilizado.</p>
          <p className="dt-questionnaire__note">No hay respuestas correctas o incorrectas.</p>
        </header>

        <div className="dt-questionnaire__columns dt-questionnaire__columns--tlx">
          <div className="dt-questionnaire__column">
            {[0, 1, 2].map(dimension)}
          </div>
          <div className="dt-questionnaire__column">
            {[3, 4, 5].map(dimension)}
          </div>
        </div>

        <footer className="dt-questionnaire__footer">
          <span className="dt-questionnaire__progress" role="status" aria-live="polite">
            <CheckCircle2 size={19} aria-hidden="true" /> {respondidas} de 6 respondidas
          </span>
          <button
            className="dt-questionnaire__submit"
            type="button"
            onClick={finalizar}
            disabled={!completo || enviando}
            title={!completo ? "Responde las seis dimensiones para continuar" : undefined}
          >
            {enviando ? "Guardando respuestas..." : "Finalizar cuestionario"}
            {!enviando && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </footer>
      </div>
    </section>
  );
}
