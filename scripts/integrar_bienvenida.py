#!/usr/bin/env python3
"""Integra la bienvenida en la pantalla de evaluación sin sustituir todo el proyecto.

Uso (desde la raíz dotol): python scripts/integrar_bienvenida.py
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

RUTA = Path("frontend/src/pages/EvaluationGatePage.tsx")
IMPORT_ORIGINAL = 'import EvaluationInstructionsPage from "./EvaluationInstructionsPage";'
IMPORT_NUEVO = 'import EvaluationWelcomePage from "./EvaluationWelcomePage";'
CABECERA = 'export default function EvaluationGatePage({ accessToken, onEstadoActualizado }: Props) {'
ESTADO = '  const [error, setError] = useState("");'
INTRO_CONDICION = 'estado.estado_global === "no_iniciada" && ('

HELPER = '''// Esta marca solo evita repetir la bienvenida al recargar la pestaña.
// Está asociada a la cuenta, pero NO es una aceptación de consentimiento.
function claveBienvenida(accessToken: string): string | null {
  try {
    const segmento = accessToken.split(".")[1];
    if (!segmento) return null;
    const base64 = segmento.replace(/-/g, "+").replace(/_/g, "/");
    const datos: unknown = JSON.parse(atob(base64));
    if (datos && typeof datos === "object" && "sub" in datos && typeof datos.sub === "string") {
      return `dotol:bienvenida:v1:${datos.sub}`;
    }
  } catch {
    // La bienvenida sigue funcionando sin almacenamiento si el token es inesperado.
  }
  return null;
}

'''

STATE = '''
  const [bienvenidaVista, setBienvenidaVista] = useState(() => {
    const clave = claveBienvenida(accessToken);
    if (!clave) return false;
    try { return window.sessionStorage.getItem(clave) === "1"; }
    catch { return false; }
  });

  function continuarBienvenida() {
    setBienvenidaVista(true);
    const clave = claveBienvenida(accessToken);
    if (clave) {
      try { window.sessionStorage.setItem(clave, "1"); }
      catch { /* Se puede continuar aunque sessionStorage esté bloqueado. */ }
    }
  }
'''


def aplicar(contenido: str) -> str:
    if IMPORT_NUEVO in contenido:
        return contenido  # Idempotente
    for descripcion, texto in [
        ("import de instrucciones", IMPORT_ORIGINAL),
        ("componente EvaluationGatePage", CABECERA),
        ("estado de errores", ESTADO),
        ("bloque no_iniciada", INTRO_CONDICION),
    ]:
        if contenido.count(texto) != 1:
            raise ValueError(f"No encontré exactamente un {descripcion}. No modifiqué el archivo.")

    contenido = contenido.replace(IMPORT_ORIGINAL, IMPORT_ORIGINAL + "\n" + IMPORT_NUEVO, 1)
    contenido = contenido.replace(CABECERA, HELPER + CABECERA, 1)
    contenido = contenido.replace(ESTADO, ESTADO + "\n" + STATE, 1)

    # Permite variaciones del formulario (texto libre, versión anterior, etc.)
    # conservando su implementación exacta.
    inicio = contenido.index('{estado.estado_global === "no_iniciada" && (')
    desde = contenido.index('        <EvaluationInstructionsPage', inicio)
    hasta = contenido.index('\n      )}', desde)
    original = contenido[desde:hasta]
    reemplazo = '''        bienvenidaVista ? (
''' + original.replace('        <EvaluationInstructionsPage', '          <EvaluationInstructionsPage', 1) + '''
        ) : (
          <EvaluationWelcomePage onContinuar={continuarBienvenida} />
        )'''
    contenido = contenido[:desde] + reemplazo + contenido[hasta:]
    return contenido


def main() -> int:
    ruta = Path(sys.argv[1]) if len(sys.argv) > 1 else RUTA
    if not ruta.exists():
        print(f"ERROR: no existe {ruta}. Ejecuta desde la raíz de dotol.", file=sys.stderr)
        return 1
    contenido = ruta.read_text(encoding="utf-8")
    try:
        actualizado = aplicar(contenido)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if actualizado == contenido:
        print("La bienvenida ya estaba integrada; no hice cambios.")
        return 0
    copia = ruta.with_name(f"{ruta.name}.bak-bienvenida-{datetime.now():%Y%m%d-%H%M%S}")
    copia.write_text(contenido, encoding="utf-8")
    ruta.write_text(actualizado, encoding="utf-8")
    print(f"Integrado correctamente: {ruta}")
    print(f"Respaldo: {copia}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
