import { CheckCircle2 } from "lucide-react";

// Los participantes finalizan aquí. No se muestra un botón de acceso a la
// aplicación porque el experimento solo incluye las dos pruebas asignadas.
export default function EvaluationFinishedPage() {
  return (
    <div className="dt-eval-screen">
      <section className="dt-eval-card dt-eval-card--wide">
        <span className="dt-eval-badge"><CheckCircle2 size={16} /> Evaluación completada</span>
        <h1>¡Gracias por participar!</h1>
        <p className="dt-eval-lead">
          Terminaste las pruebas del Método IA y el Método Tradicional,
          junto con los cuestionarios NASA-TLX y SUS.
        </p>
        <p>
          Tus respuestas quedaron registradas. No necesitas realizar más actividades
          en dotol. Puedes cerrar esta pestaña.
        </p>
      </section>
    </div>
  );
}
