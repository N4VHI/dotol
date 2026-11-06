import { useState } from "react";
import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import "../styles/questionnaires.css";

/**
 * SUS: conservar el orden P1-P10 al enviar a /evaluacion/sus.
 * Visualmente se reparten P1-P5 (izquierda) y P6-P10 (derecha).
 */
const PREGUNTAS = [
  "Creo que me gustaría usar este sistema con frecuencia.",
  "Me pareció que el sistema era innecesariamente complejo.",
  "Me pareció que el sistema era fácil de usar.",
  "Creo que necesitaría el apoyo de personal técnico para poder usar este sistema.",
  "Me pareció que las diversas funciones de este sistema estaban bien integradas.",
  "Me pareció que había demasiada inconsistencia en este sistema.",
  "Me imagino que la mayoría de las personas aprenderían a usar este sistema muy rápidamente.",
  "Me pareció que el sistema era muy engorroso de usar.",
  "Me sentí muy seguro al usar el sistema.",
  "Necesité aprender muchas cosas antes de poder empezar a trabajar con este sistema.",
] as const;

type Props = {
  enviando: boolean;
  onEnviar: (respuestas: number[]) => void;
};

const OPCIONES = [1, 2, 3, 4, 5] as const;

export default function SusMockPage({ enviando, onEnviar }: Props) {
  // Importante para la investigación: ninguna respuesta está seleccionada por defecto.
  const [respuestas, setRespuestas] = useState<Array<number | null>>(
    () => Array(10).fill(null)
  );

  const respondidas = respuestas.filter((valor) => valor !== null).length;
  const completo = respondidas === PREGUNTAS.length;

  function seleccionar(indice: number, valor: number) {
    setRespuestas((actuales) =>
      actuales.map((respuesta, i) => (i === indice ? valor : respuesta))
    );
  }

  function finalizar() {
    if (enviando) return;
    const valores = respuestas.filter((valor): valor is number => valor !== null);
    if (valores.length !== PREGUNTAS.length) return;
    onEnviar(valores);
  }

  function pregunta(indice: number) {
    return (
      <fieldset className="dt-survey-sus-card" key={indice} disabled={enviando}>
        <legend className="dt-survey-sus-card__legend">
          <span className="dt-survey-sus-card__number">{String(indice + 1).padStart(2, "0")}</span>
          <span>{PREGUNTAS[indice]}</span>
        </legend>

        <div className="dt-survey-sus-card__choices" aria-label={`Respuesta de la pregunta ${indice + 1}`}>
          {OPCIONES.map((valor) => (
            <label className="dt-survey-sus-choice" key={valor}>
              <input
                type="radio"
                name={`sus-${indice + 1}`}
                value={valor}
                checked={respuestas[indice] === valor}
                onChange={() => seleccionar(indice, valor)}
                aria-label={`${valor} de 5`}
              />
              <span>{valor}</span>
            </label>
          ))}
        </div>

        <div className="dt-survey-sus-card__anchors" aria-hidden="true">
          <span>1 · Totalmente en desacuerdo</span>
          <span>5 · Totalmente de acuerdo</span>
        </div>
      </fieldset>
    );
  }

  return (
    <section className="dt-questionnaire dt-questionnaire--sus">
      <div className="dt-questionnaire__content">
        <div className="dt-questionnaire__eyebrow-row">
          <span className="dt-questionnaire__eyebrow">Recolección de datos</span>
          <span className="dt-questionnaire__estimate" title="Tiempo estimado para responder">
            <Clock3 size={15} aria-hidden="true" /> 2 minutos
          </span>
        </div>

        <header className="dt-questionnaire__header">
          <h1>Evaluación SUS - Escala de Usabilidad del Sistema</h1>
          <p>Por favor, responde el siguiente cuestionario sobre la usabilidad percibida.</p>
          <p className="dt-questionnaire__note">No hay respuestas correctas o incorrectas.</p>
        </header>

        <div className="dt-questionnaire__columns dt-questionnaire__columns--sus">
          <div className="dt-questionnaire__column">
            {[0, 1, 2, 3, 4].map(pregunta)}
          </div>
          <div className="dt-questionnaire__column">
            {[5, 6, 7, 8, 9].map(pregunta)}
          </div>
        </div>

        <footer className="dt-questionnaire__footer">
          <span className="dt-questionnaire__progress" role="status" aria-live="polite">
            <CheckCircle2 size={19} aria-hidden="true" /> {respondidas} de 10 respondidas
          </span>
          <button
            className="dt-questionnaire__submit"
            type="button"
            onClick={finalizar}
            disabled={!completo || enviando}
            title={!completo ? "Responde las diez preguntas para continuar" : undefined}
          >
            {enviando ? "Guardando respuestas..." : "Finalizar cuestionario"}
            {!enviando && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </footer>
      </div>
    </section>
  );
}
