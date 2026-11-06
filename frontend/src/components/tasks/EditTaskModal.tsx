import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Save, X } from "lucide-react";
import type { Tarea } from "../../types/tarea";
import type { Categoria } from "../../types/categoria";
import { actualizarTarea, type ActualizarTareaDatos } from "../../services/tasks";

function fechaLima(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(fecha);
  const p = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}

function horaLima(iso?: string): string {
  if (!iso) return "";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(fecha);
  const p = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${p("hour")}:${p("minute")}`;
}

type Props = {
  accessToken: string;
  tarea: Tarea;
  categorias: Categoria[];
  onCerrar: () => void;
  onActualizada: () => Promise<void>;
};

export default function EditTaskModal({ accessToken, tarea, categorias, onCerrar, onActualizada }: Props) {
  const [nombre, setNombre] = useState(tarea.nombre);
  const [descripcion, setDescripcion] = useState(tarea.descripcion ?? "");
  const [categoria, setCategoria] = useState(tarea.id_categoria ?? "");
  const diaOriginal = tarea.fecha_dia ?? (tarea.fecha_hacer ? fechaLima(new Date(tarea.fecha_hacer)) : "");
  const horaOriginal = horaLima(tarea.fecha_hacer);
  const [dia, setDia] = useState(diaOriginal);
  const [hora, setHora] = useState(horaOriginal);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [hoy] = useState(() => fechaLima(new Date()));
  const nombreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nombreRef.current?.focus();
  }, []);

  useEffect(() => {
    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape" && !enviando) {
        onCerrar();
      }
    }

    window.addEventListener("keydown", alPresionarTecla);

    return () => {
      window.removeEventListener("keydown", alPresionarTecla);
    };
  }, [onCerrar, enviando]);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setError("");
    if (!nombre.trim()) return setError("El nombre no puede quedar vacío.");
    if (hora && !dia) return setError("Selecciona un día para asignar una hora.");

    // Enviar solo los atributos modificados; así preservamos fechas y horas anteriores.
    const cambios: ActualizarTareaDatos = {};
    if (nombre.trim() !== tarea.nombre) cambios.nombre = nombre.trim();
    if (descripcion.trim() !== (tarea.descripcion ?? "")) {
      cambios.descripcion = descripcion.trim() || null;
    }
    if (categoria !== (tarea.id_categoria ?? "")) {
      cambios.id_categoria = categoria || null;
    }

    if (dia !== diaOriginal || hora !== horaOriginal) {
      if (!dia) {
        cambios.fecha_dia = null;
      } else if (hora) {
        const fechaConHora = `${dia}T${hora}:00-05:00`;
        if (new Date(fechaConHora).getTime() <= Date.now()) {
          return setError("La nueva fecha y hora deben estar en el futuro.");
        }
        cambios.fecha_hacer = fechaConHora;
      } else {
        if (dia < fechaLima(new Date())) return setError("La nueva fecha no puede estar en el pasado.");
        cambios.fecha_dia = dia;
      }
    }

    if (Object.keys(cambios).length === 0) return setError("No realizaste ningún cambio.");
    setEnviando(true);
    try {
      await actualizarTarea(accessToken, tarea.id_tarea, cambios);
      await onActualizada();
      onCerrar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No fue posible actualizar la tarea.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="dt-modal-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !enviando) onCerrar();
    }}>
      <section className="dt-modal" role="dialog" aria-modal="true" aria-labelledby="dt-edit-title">
        <div className="dt-modal__header">
          <div><h2 id="dt-edit-title">Editar tarea</h2><p>Modifica la información de tu tarea pendiente.</p></div>
          <button className="dt-modal__close" type="button" aria-label="Cerrar" onClick={onCerrar} disabled={enviando}><X size={18} /></button>
        </div>
        <form className="dt-modal__form" onSubmit={guardar}>
          <label>Nombre *
            <input ref={nombreRef} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} required />
          </label>
          <label>Descripción
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} maxLength={500} />
          </label>
          <label>Categoría
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Sin categoría</option>
              {categoria && !categorias.some((c) => c.id_categoria === categoria) && (
                <option value={categoria} disabled>La categoría anterior fue eliminada</option>
              )}
              {categorias.map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}
            </select>
          </label>
          <div className="dt-modal__date-row">
            <label>Día
              <input type="date" value={dia} min={diaOriginal && diaOriginal < hoy ? undefined : hoy}
                onChange={(e) => { setDia(e.target.value); if (!e.target.value) setHora(""); }} />
            </label>
            <label>Hora (opcional)
              <input type="time" value={hora} disabled={!dia} onChange={(e) => setHora(e.target.value)} />
            </label>
          </div>
          <p className="dt-modal__hint">Los campos que no modifiques conservarán su valor. Para quitar la fecha, borra el día. Si eliges una hora, se usa Lima (UTC−05:00).</p>
          {error && <p className="dt-modal__error" role="alert">{error}</p>}
          <div className="dt-modal__actions">
            <button type="button" className="dt-btn dt-btn--outline" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="dt-btn dt-btn--primary" disabled={enviando}><Save size={16} />{enviando ? "Guardando..." : "Guardar cambios"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
