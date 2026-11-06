/**
 * Persistencia temporal de sesión: sobrevive a F5 mientras la pestaña siga abierta.
 * No se guardan contraseñas. Para producción, evaluar cookies HttpOnly y BFF.
 */
export type Sesion = {
  accessToken: string;
  refreshToken: string;
  expiraEn: number; // milisegundos UNIX
  deviceKey?: string;
};

export type TokensCognito = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // segundos
  deviceKey?: string;
};

const CLAVE = "dotol:cognito:sesion:v1";

export function crearSesion(tokens: TokensCognito): Sesion {
  if (
    !tokens.accessToken ||
    !tokens.refreshToken ||
    !Number.isFinite(tokens.expiresIn) ||
    tokens.expiresIn <= 0
  ) {
    throw new Error("Cognito devolvió una sesión incompleta.");
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiraEn: Date.now() + tokens.expiresIn * 1000,
    ...(tokens.deviceKey ? { deviceKey: tokens.deviceKey } : {}),
  };
}

export function leerSesionGuardada(): Sesion | null {
  try {
    const contenido = window.sessionStorage.getItem(CLAVE);
    if (!contenido) return null;
    const datos: unknown = JSON.parse(contenido);
    if (!datos || typeof datos !== "object") return null;
    const sesion = datos as Record<string, unknown>;
    if (
      typeof sesion.accessToken !== "string" || !sesion.accessToken ||
      typeof sesion.refreshToken !== "string" || !sesion.refreshToken ||
      typeof sesion.expiraEn !== "number" || !Number.isFinite(sesion.expiraEn)
    ) return null;

    return {
      accessToken: sesion.accessToken,
      refreshToken: sesion.refreshToken,
      expiraEn: sesion.expiraEn,
      ...(typeof sesion.deviceKey === "string" ? { deviceKey: sesion.deviceKey } : {}),
    };
  } catch {
    // Storage puede estar bloqueado en modo privado o por la política del navegador.
    return null;
  }
}

export function guardarSesion(sesion: Sesion) {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
  } catch {
    // La sesión funciona en memoria, pero no persistirá si el navegador bloquea storage.
  }
}

export function limpiarSesion() {
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch {
    // No impedir el cierre local si storage no está disponible.
  }
}
