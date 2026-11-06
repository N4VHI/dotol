import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { ArrowUp, CircleHelp, Sparkles } from "lucide-react";
import type { MensajeChat } from "../../types/propuesta";

type Props = {
  mensajes: MensajeChat[];
  nombre: string;
  enviando: boolean;
  bloqueado: boolean;
  onEnviar: (mensaje: string) => Promise<boolean>;
};

export default function ConversationPanel({ mensajes, nombre, enviando, bloqueado, onEnviar }: Props) {
  const [borrador, setBorrador] = useState("");
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensajes, enviando]);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const texto = borrador.trim();
    if (!texto || enviando || bloqueado) return;
    // Vaciar el cuadro inmediatamente, aunque AWS todavia este procesando.
    setBorrador("");
    try {
      const enviado = await onEnviar(texto);
      if (!enviado) setBorrador(texto);
    } catch {
      // Si falla, la persona puede corregir o reintentar el mensaje.
      setBorrador(texto);
    }
  }

  function controlarEnter(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === "Enter" && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      evento.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="dt-ai-chat" aria-label="Conversación con Dotol AI">
      <header className="dt-ai-chat__header">
        <span className="dt-ai-chat__icon" aria-hidden="true"><Sparkles size={21} strokeWidth={1.8} /></span>
        <div className="dt-ai-chat__identity">
          <strong>Dotol AI</strong>
          <span><i aria-hidden="true" /> Máximo 6 acciones por propuesta, pendientes de aprobación</span>
        </div>
        <span className="dt-ai-chat__help" title="Ninguna tarea se modifica hasta que aceptes los cambios">
          <CircleHelp size={18} aria-hidden="true" />
        </span>
      </header>

      <div className="dt-ai-chat__scroll" aria-live="polite" aria-relevant="additions text">
        <div className="dt-ai-chat__day">Conversación actual</div>
        {mensajes.length === 0 && (
          <div className="dt-ai-chat__bubble dt-ai-chat__bubble--bot">
            <span className="dt-ai-chat__sender">DOTOL</span>
            <p>¡Hola{nombre ? `, ${nombre}` : ""}! ☀︎<br />¿Empezamos a planear?</p>
          </div>
        )}
        {mensajes.map((mensaje, indice) => (
          mensaje.rol === "usuario" ? (
            <div className="dt-ai-chat__bubble dt-ai-chat__bubble--user" key={`${indice}-${mensaje.rol}`}>
              <p>{mensaje.texto}</p>
            </div>
          ) : (
            <div className="dt-ai-chat__bubble dt-ai-chat__bubble--bot" key={`${indice}-${mensaje.rol}`}>
              <span className="dt-ai-chat__sender">DOTOL</span>
              <p>{mensaje.texto}</p>
            </div>
          )
        ))}
        {enviando && (
          <div className="dt-ai-chat__bubble dt-ai-chat__bubble--bot" role="status">
            <span className="dt-ai-chat__sender">DOTOL</span>
            <p className="dt-ai-chat__thinking">Dotol está pensando…</p>
          </div>
        )}
        <div ref={finRef} />
      </div>

      <form className="dt-ai-composer" onSubmit={(e) => { void enviar(e); }}>
        <label className="dt-sr-only" htmlFor="dt-ai-mensaje">Escribe tu mensaje</label>
        <textarea
          id="dt-ai-mensaje"
          placeholder="Crea, actualiza, completa o elimina alguna tarea"
          rows={2}
          value={borrador}
          maxLength={500}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={controlarEnter}
          disabled={enviando || bloqueado}
        />
        <div className="dt-ai-composer__actions">
          <span>{borrador.length}/500</span>
          <button type="submit" aria-label="Enviar mensaje" title="Enviar mensaje" disabled={!borrador.trim() || enviando || bloqueado}>
            <ArrowUp size={17} strokeWidth={2} />
          </button>
        </div>
      </form>
      <p className="dt-ai-chat__disclaimer">El asistente puede cometer errores. Comprueba las acciones antes de aceptarlas.</p>
    </section>
  );
}
