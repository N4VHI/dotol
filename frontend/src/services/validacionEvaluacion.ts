import type { Tarea } from "../types/tarea";
import type { AccionPropuesta } from "../types/propuesta";
import type { TareaObjetivo } from "./evaluacion";

function normalizarTitulo(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function fechaLima(valor: string): string | null {
  const dia = new Date(valor);
  if (Number.isNaN(dia.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(dia);
  const obtener = (tipo: string) => partes.find((v) => v.type === tipo)?.value ?? "";
  return `${obtener("year")}-${obtener("month")}-${obtener("day")}`;
}

type Comparacion = { faltantes: TareaObjetivo[]; sobrantes: number };
type Resultado = { nombre: string; fecha: string | null };

function comparar(objetivos: TareaObjetivo[], resultados: Resultado[]): Comparacion {
  const disponibles = [...resultados];
  const faltantes: TareaObjetivo[] = [];
  for (const esperado of objetivos) {
    const indice = disponibles.findIndex((r) =>
      normalizarTitulo(r.nombre) === normalizarTitulo(esperado.nombre)
      && r.fecha === (esperado.fecha_dia ?? null)
    );
    if (indice < 0) faltantes.push(esperado);
    else disponibles.splice(indice, 1);
  }
  return { faltantes, sobrantes: disponibles.length };
}

export function compararTareasManuales(objetivos: TareaObjetivo[], tareas: Tarea[]): Comparacion {
  return comparar(objetivos, tareas.map((t) => ({
    nombre: t.nombre,
    fecha: t.fecha_dia ?? (t.fecha_hacer ? fechaLima(t.fecha_hacer) : null),
  })));
}

export function compararPropuestaIA(objetivos: TareaObjetivo[], acciones: AccionPropuesta[]): Comparacion {
  return comparar(objetivos, acciones.filter((a) => a.op === "create")
    .map((a) => ({ nombre: a.title ?? "", fecha: a.due ?? null })));
}
