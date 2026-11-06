import { Sparkles } from "lucide-react";

/** Ruta temporal para que el menú compartido ya navegue correctamente. */
export default function AiPlaceholderPage() {
  return (
    <div className="dt-page dt-page--placeholder">
      <Sparkles size={32} color="#42634B" />
      <h1>Método IA</h1>
      <p>El espacio del chatbot lo conectaremos en la siguiente etapa.</p>
    </div>
  );
}
