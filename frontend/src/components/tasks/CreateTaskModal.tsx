import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { Categoria } from "../../types/categoria";
import { registrarTarea } from "../../services/tasks";

type Props = { accessToken: string; categorias: Categoria[]; onCerrar: () => void; onCreada: () => Promise<void> };

function hoyEnLima(fecha: Date) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(fecha);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export default function CreateTaskModal({ accessToken, categorias, onCerrar, onCreada }: Props) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState("");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [hoy] = useState(() => hoyEnLima(new Date()));
  const nombreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nombreRef.current?.focus();
    function escucharTeclado(evento: KeyboardEvent) {
      if (evento.key === "Escape" && !enviando) onCerrar();
    }
    window.addEventListener("keydown", escucharTeclado);
    return () => window.removeEventListener("keydown", escucharTeclado);
  }, [onCerrar, enviando]);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setError("");
    if (!nombre.trim()) return setError("Escribe el nombre de la tarea.");
    if (hora && !dia) return setError("Selecciona un día si deseas agregar una hora.");
    if (dia && dia < hoyEnLima(new Date())) return setError("La fecha no puede estar en el pasado.");

    const datos: Parameters<typeof registrarTarea>[1] = { nombre: nombre.trim() };
    if (descripcion.trim()) datos.descripcion = descripcion.trim();
    if (categoria) datos.id_categoria = categoria;
    if (dia) {
      if (hora) {
        // Perú usa UTC-05:00 durante todo el año.
        const fechaHora = `${dia}T${hora}:00-05:00`;
        if (new Date(fechaHora).getTime() <= Date.now()) {
          return setError("La fecha y la hora deben estar en el futuro.");
        }
        datos.fecha_hacer = fechaHora;
      } else {
        datos.fecha_dia = dia;
      }
    }

    setEnviando(true);
    try {
      await registrarTarea(accessToken, datos);
      await onCreada();
      onCerrar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo registrar la tarea.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="dt-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !enviando) onCerrar(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="dt-modal-title" className="dt-modal">
        <div className="dt-modal__header">
          <div>
            <h2 id="dt-modal-title">Añadir tarea</h2>
            <p>Organiza una actividad sin usar IA.</p>
          </div>
          <button type="button" className="dt-modal__close" aria-label="Cerrar formulario" onClick={onCerrar} disabled={enviando}><X size={18} /></button>
        </div>
        <form onSubmit={enviar} className="dt-modal__form">
          <label>Nombre de la tarea *
            <input ref={nombreRef} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Estudiar para el examen" maxLength={100} required />
          </label>
          <label>Descripción (opcional)
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Detalles para recordar..." rows={3} maxLength={500} />
          </label>
          <label>Categoría (opcional)
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}
            </select>
          </label>
          <div className="dt-modal__date-row">
            <label>Día (opcional)
              <input type="date" value={dia} min={hoy} onChange={(e) => { setDia(e.target.value); if (!e.target.value) setHora(""); }} />
            </label>
            <label>Hora (opcional)
              <input type="time" value={hora} disabled={!dia} onChange={(e) => setHora(e.target.value)} />
            </label>
          </div>
          <p className="dt-modal__hint">Sin fecha se creará una tarea libre. Con hora, se programará usando la zona horaria de Lima.</p>
          {error && <p role="alert" className="dt-modal__error">{error}</p>}
          <div className="dt-modal__actions">
            <button type="button" className="dt-btn dt-btn--outline" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="dt-btn dt-btn--primary" disabled={enviando}><Plus size={17} /> {enviando ? "Guardando..." : "Guardar tarea"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
