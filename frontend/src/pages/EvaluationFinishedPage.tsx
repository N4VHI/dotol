import type { RegistroEvaluacion } from "../services/evaluacion";

type Props = {
  evaluaciones: RegistroEvaluacion[];
  onEntrar: () => void;
};

function tituloMetodo(tipo: string) {
  return tipo === "ia" ? "Método IA" : "Método tradicional";
}

export default function EvaluationFinishedPage({ evaluaciones, onEntrar }: Props) {
  return (
    <div className="dt-eval-screen">
      <section className="dt-eval-card dt-eval-card--wide">
        <span className="dt-eval-badge">Evaluación completada</span>
        <h1>¡Gracias por completar las pruebas!</h1>
        <p className="dt-eval-lead">Ya probaste ambos métodos. A continuación puedes entrar al uso normal de dotol.</p>

        <div className="dt-eval-summary">
          {evaluaciones.map((item) => (
            <article key={item.tipo_prueba} className="dt-eval-summary__card">
              <strong>{tituloMetodo(item.tipo_prueba)}</strong>
              <p>Orden: {item.orden}</p>
              <p>Duración: {item.duracion_segundos ?? 0} s</p>
              <p>Clics: {item.cant_clicks ?? 0}</p>
              <p>Raw NASA-TLX: {item.puntaje_raw_tlx ?? "-"}</p>
              <p>SUS: {item.puntaje_sus ?? "-"}</p>
            </article>
          ))}
        </div>

        <div className="dt-eval-actions">
          <button type="button" className="dt-btn dt-btn--primary" onClick={onEntrar}>
            Entrar a dotol
          </button>
        </div>
      </section>
    </div>
  );
}
