import { ArrowRight, ClipboardList, Clock3, ListTodo, MessageCircle, Shuffle, Sparkles } from "lucide-react";
import "../styles/evaluation-bienvenida.css";

type Props = {
  onContinuar: () => void;
};

/** Presentación informativa; no inicia la prueba ni guarda datos en AWS. */
export default function EvaluationWelcomePage({ onContinuar }: Props) {
  return (
    <main className="dt-intro-page">
      <div className="dt-intro-container">
        <div className="dt-intro-heading">
          <span className="dt-intro-pill"><Sparkles size={15} aria-hidden="true" /> Antes de comenzar</span>
          <h1>¡Bienvenido a dotol!</h1>
          <p>
            Dotol es una aplicación para organizar tus actividades personales y académicas.
            En esta evaluación probarás <strong>dos formas de registrar tareas</strong> y nos contarás
            cómo fue tu experiencia con cada una.
          </p>
        </div>

        <div className="dt-intro-section-title">Las dos formas de usar dotol</div>
        <div className="dt-intro-methods">
          <article className="dt-intro-method">
            <div className="dt-intro-method__icon"><ListTodo size={23} aria-hidden="true" /></div>
            <span className="dt-intro-method__label">Método tradicional</span>
            <h2>Registra las tareas tú mismo</h2>
            <p>Escribe cada actividad en un formulario, elige los detalles que necesites y guárdala.</p>
            <div className="dt-intro-example"><ClipboardList size={17} aria-hidden="true" /> Crear una tarea desde el formulario</div>
          </article>

          <article className="dt-intro-method">
            <div className="dt-intro-method__icon"><MessageCircle size={23} aria-hidden="true" /></div>
            <span className="dt-intro-method__label">Método con IA</span>
            <h2>Describe tus actividades en el chat</h2>
            <p>Cuéntale a dotol qué necesitas hacer. La IA preparará una propuesta que podrás revisar antes de aceptarla.</p>
            <div className="dt-intro-example"><Sparkles size={17} aria-hidden="true" /> Conversar, revisar y aceptar la propuesta</div>
          </article>
        </div>

        <section className="dt-intro-how" aria-labelledby="dt-intro-how-title">
          <div className="dt-intro-how__header">
            <Shuffle size={20} aria-hidden="true" />
            <h2 id="dt-intro-how-title">¿Qué harás durante la evaluación?</h2>
          </div>
          <ol className="dt-intro-steps">
            <li><strong>Prepara dos grupos de actividades varias.</strong> Escribe hasta seis tareas por grupo, con tus propias palabras.</li>
            <li><strong>Prueba los dos métodos.</strong> Dotol decidirá aleatoriamente el orden y qué grupo utilizarás en cada método.</li>
            <li><strong>Responde dos cuestionarios después de cada método.</strong> NASA-TLX y SUS nos ayudarán a conocer cómo fue tu experiencia.</li>
          </ol>
          <div className="dt-intro-note">
            <Clock3 size={18} aria-hidden="true" />
            <p>La aplicación medirá el tiempo y los clics durante cada prueba. <strong>El cronómetro todavía no empieza:</strong> tendrás instrucciones antes de comenzar.</p>
          </div>
        </section>

        <div className="dt-intro-footer">
          <p>No necesitas conocimientos de inteligencia artificial. Utiliza ambos métodos con naturalidad.</p>
          <button type="button" className="dt-intro-start" onClick={onContinuar}>
            Entendido, continuar <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}
