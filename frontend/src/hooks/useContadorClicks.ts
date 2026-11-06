import { useEffect, useRef, useState } from "react";

function leerClicks(activo: boolean, clave: string): number {
  if (!activo || !clave) return 0;
  try {
    const guardado = Number(sessionStorage.getItem(`dotol:clicks:${clave}`) ?? "0");
    return Number.isFinite(guardado) && guardado >= 0 ? Math.floor(guardado) : 0;
  } catch {
    return 0;
  }
}

/**
 * Cuenta clics durante la prueba y conserva el total en la misma pestaña.
 * No cuenta las respuestas NASA-TLX/SUS ni las pulsaciones de teclado.
 * El evento "click" se captura antes del onClick del botón que finaliza.
 */
export function useContadorClicks(activo: boolean, clave: string) {
  const [vista, setVista] = useState(() => leerClicks(activo, clave));
  const contador = useRef(vista);

  useEffect(() => {
    if (!activo || !clave) return;
    const llave = `dotol:clicks:${clave}`;
    contador.current = leerClicks(activo, clave);

    const registrar = () => {
      contador.current += 1;
      setVista(contador.current);
      try { sessionStorage.setItem(llave, String(contador.current)); }
      catch { /* Funciona igualmente sin persistencia. */ }
    };

    document.addEventListener("click", registrar, true);
    return () => document.removeEventListener("click", registrar, true);
  }, [activo, clave]);

  function obtenerClicks() {
    return contador.current;
  }

  function limpiar() {
    contador.current = 0;
    setVista(0);
    try { sessionStorage.removeItem(`dotol:clicks:${clave}`); }
    catch { /* El almacenamiento puede estar deshabilitado. */ }
  }

  return { clicks: vista, obtenerClicks, limpiar };
}
