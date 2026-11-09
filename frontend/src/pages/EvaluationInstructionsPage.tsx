import { useState } from "react";
import type { FormEvent } from "react";
import { ClipboardCheck, Shuffle } from "lucide-react";
import type { GruposEvaluacion } from "../services/evaluacion";
import "../styles/evaluation-texto.css";

type Props = {
  preparando: boolean;
  onComenzar: (grupos: GruposEvaluacion) => void;
};

export default function EvaluationInstructionsPage({ preparando, onComenzar }: Props) {
  const [grupoA, setGrupoA] = useState("");
  const [grupoB, setGrupoB] = useState("");
  const [error, setError] = useState("");

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (preparando) return;
    const grupos: GruposEvaluacion = { A: grupoA.trim(), B: grupoB.trim() };
    if (!grupos.A || !grupos.B) {
      setError("Escribe las actividades de ambos grupos antes de continuar.");
      return;
    }
    // No se interpreta ni compara el texto: es la consigna del participante.
    // El límite de seis actividades es orientativo, no una validación automática.
    setError("");
    onComenzar(grupos);
  }

  return (
    <div className="dt-eval-screen">
      <section className="dt-eval-card dt-eval-card--wide dt-prep">
        <span className="dt-eval-badge"><ClipboardCheck size={15} /> Preparación del experimento</span>
        <h1>Prepara tus dos grupos de tareas</h1>
        <p className="dt-eval-lead">
          Piensa en hasta <strong>6 actividades por grupo</strong>. Escríbelas con tus propias palabras,
          incluyendo detalles, categorías o fechas si las necesitas. Procura que ambos grupos tengan
          una dificultad parecida. No hace falta crear una ficha por cada tarea.
        </p>

        <form onSubmit={enviar}>
          <div className="dt-prep-grid dt-prep-grid--texto">
            <label className="dt-prep-free-group">
              <span className="dt-prep-free-group__heading">Grupo 1 · A</span>
              <span className="dt-prep-free-group__subtitle">Escribe libremente las actividades del primer grupo.</span>
              <textarea
                name="grupoA"
                rows={9}
                maxLength={2500}
                value={grupoA}
                onChange={(e) => { setGrupoA(e.target.value); setError(""); }}
                placeholder="Tengo que sacar a mi perro a pasear, preparar el almuerzo el martes, ordenar mi escritorio..."
                disabled={preparando}
                required
              />
              <span className="dt-prep-free-group__hint">Máximo sugerido: 6 tareas · {grupoA.length}/2500 caracteres</span>
            </label>

            <label className="dt-prep-free-group">
              <span className="dt-prep-free-group__heading">Grupo 2 · B</span>
              <span className="dt-prep-free-group__subtitle">Un conjunto diferente de actividades para el otro método.</span>
              <textarea
                name="grupoB"
                rows={9}
                maxLength={2500}
                value={grupoB}
                onChange={(e) => { setGrupoB(e.target.value); setError(""); }}
                placeholder="Quiero jugar básquet, leer para el examen del viernes, comprar materiales..."
                disabled={preparando}
                required
              />
              <span className="dt-prep-free-group__hint">Máximo sugerido: 6 tareas · {grupoB.length}/2500 caracteres</span>
            </label>
          </div>

          <div className="dt-prep-notice">
            <Shuffle size={20} />
            <p><strong>Asignación aleatoria:</strong> dotol elegirá con qué método comenzarás y
              cuál de los dos grupos utilizarás en cada prueba. Tendrás a la vista las tareas que registraste
              en tu grupo mientras las registras. El cronómetro empezará al iniciar la prueba.
            </p>
          </div>
          {error && <p className="dt-feedback dt-feedback--error" role="alert">{error}</p>}
          <div className="dt-eval-actions">
            <button className="dt-btn dt-btn--primary" disabled={preparando} type="submit">
              {preparando ? "Guardando grupos..." : "Guardar grupos y continuar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
