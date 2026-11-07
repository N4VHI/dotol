
import {
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import {
  SignUpCommand,
  InitiateAuthCommand,
  GetTokensFromRefreshTokenCommand,
  RevokeTokenCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

import { cognito, CLIENT_ID } from "../config/cognito";
import type { Sesion, TokensCognito } from "./sesion";

export type DatosRegistro = {
  nombres: string;
  apellidos: string;
  correo: string;
  contrasena: string;
  universidad?: string;
  codigo_universidad?: string;
};

// Registrar usuario
export async function registrarUsuario(datos: DatosRegistro) {
  const correo = datos.correo.trim().toLowerCase();

  const atributos: AttributeType[] = [
    { Name: "email", Value: correo },
    { Name: "given_name", Value: datos.nombres.trim() },
    { Name: "family_name", Value: datos.apellidos.trim() },
  ];

  const universidad = datos.universidad?.trim();
  if (universidad) {
    atributos.push({ Name: "custom:universidad", Value: universidad });
  }

  const codigo = datos.codigo_universidad?.trim();
  if (codigo) {
    atributos.push({ Name: "custom:codigo", Value: codigo });
  }

  return cognito.send(
    new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: correo,
      Password: datos.contrasena,
      UserAttributes: atributos,
    })
  );
}

// Confirmar cuenta con código
export async function confirmarRegistro(
  correo: string,
  codigo: string
) {
  return cognito.send(
    new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: correo.trim().toLowerCase(),
      ConfirmationCode: codigo.trim(),
    })
  );
}

// Reenviar código
export async function reenviarCodigo(correo: string) {
  return cognito.send(
    new ResendConfirmationCodeCommand({
      ClientId: CLIENT_ID,
      Username: correo.trim().toLowerCase(),
    })
  );
}

export async function iniciarSesion(correo: string, contrasena: string) {
  // Si las variables de Vite no se cargaron, indicarlo antes de llamar a AWS.
  if (!import.meta.env.VITE_AWS_REGION || !CLIENT_ID) {
    const fallo = new Error("Configuración de Cognito incompleta");
    fallo.name = "ConfiguracionCognito";
    throw fallo;
  }

  const respuesta = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: correo.trim().toLowerCase(),
        PASSWORD: contrasena,
      },
    })
  );

  if (respuesta.ChallengeName) {
    throw new Error(
      "Cognito solicita una verificación adicional (" +
      respuesta.ChallengeName +
      "). Este paso todavía no está implementado."
    );
  }

  const accessToken = respuesta.AuthenticationResult?.AccessToken;
  if (!accessToken) {
    throw new Error("Cognito no devolvió un token de acceso.");
  }

  // Si Cognito entregó acceso válido, no bloqueamos el ingreso por la ausencia
  // de un refresh token. La sesión sin refresh solo durará hasta su vencimiento.
  const refreshToken = respuesta.AuthenticationResult?.RefreshToken;

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresIn: respuesta.AuthenticationResult?.ExpiresIn ?? 3600,
    deviceKey: respuesta.AuthenticationResult?.NewDeviceMetadata?.DeviceKey,
  } satisfies TokensCognito;
}

// Los errores del SDK pueden llegar como objetos planos, no siempre como
// instancias de Error. No usamos instanceof para identificar su código.
export function diagnosticoErrorCognito(error: unknown) {
  let nombre = "ErrorDesconocido";
  let mensaje = "";
  let estado: number | undefined;

  if (error && typeof error === "object") {
    const dato = error as Record<string, unknown>;
    if (typeof dato.name === "string" && dato.name) nombre = dato.name;
    else if (typeof dato.code === "string" && dato.code) nombre = dato.code;
    if (typeof dato.message === "string") mensaje = dato.message;
    if (dato.$metadata && typeof dato.$metadata === "object") {
      const metadata = dato.$metadata as Record<string, unknown>;
      if (typeof metadata.httpStatusCode === "number") estado = metadata.httpStatusCode;
    }
  } else if (typeof error === "string") {
    mensaje = error;
  }

  const sufijo = estado ? ` (HTTP ${estado})` : "";
  return { nombre, mensaje, estado, sufijo };
}

// Mensajes seguros: nunca muestran contraseñas, tokens ni el cuerpo de la solicitud.
export function mensajeErrorCognito(error: unknown): string {
  const { nombre, mensaje, sufijo } = diagnosticoErrorCognito(error);

  switch (nombre) {
    case "UsernameExistsException":
      return "Este correo ya está registrado.";
    case "InvalidPasswordException":
      return "La contraseña no cumple los requisitos de Cognito.";
    case "CodeMismatchException":
      return "El código de confirmación es incorrecto.";
    case "ExpiredCodeException":
      return "El código de confirmación expiró.";
    case "NotAuthorizedException":
      return `Cognito no autorizó el ingreso${sufijo}. Revisa las credenciales y el estado de la cuenta.`;
    case "UserNotConfirmedException":
      return "Debes confirmar tu cuenta mediante el código enviado al correo.";
    case "PasswordResetRequiredException":
      return "Tu cuenta necesita restablecer la contraseña.";
    case "InvalidParameterException":
      return `Cognito rechazó los parámetros del login${sufijo}. Comprueba que USER_PASSWORD_AUTH esté habilitado en el cliente de aplicación.`;
    case "ResourceNotFoundException":
      return `Cognito no encontró el recurso indicado${sufijo}. Revisa la región y el ID del cliente.`;
    case "InvalidUserPoolConfigurationException":
      return `La configuración del grupo de usuarios no permite esta autenticación${sufijo}.`;
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Se alcanzó el límite de intentos. Inténtalo más tarde.";
    case "ConfiguracionCognito":
      return "Falta VITE_AWS_REGION o VITE_COGNITO_CLIENT_ID en frontend/.env.local. Reinicia Vite después de corregirlo.";
    default:
      if (/fetch|network|cors|load failed/i.test(mensaje)) {
        return `No se pudo contactar con Cognito (${nombre}${sufijo}). Revisa F12 → Network; puede ser la conexión, CORS o un bloqueador.`;
      }
      return `El login falló con ${nombre}${sufijo}. Indícame solo ese código (no la solicitud ni los tokens).`;
  }
}

/**
 * Renovación compatible con clientes Cognito con o sin rotación del refresh token.
 * Compartimos las peticiones en curso para evitar dos rotaciones simultáneas en
 * React.StrictMode. El token de reemplazo puede cambiar tras cada renovación.
 */
let renovacionEnCurso: { token: string; promesa: Promise<TokensCognito> } | null = null;

export function renovarTokens(sesion: Sesion): Promise<TokensCognito> {
  if (!sesion.refreshToken) {
    return Promise.reject(new Error("Esta sesión no dispone de refresh token."));
  }
  if (renovacionEnCurso?.token === sesion.refreshToken) {
    return renovacionEnCurso.promesa;
  }

  const promesa = cognito.send(new GetTokensFromRefreshTokenCommand({
    ClientId: CLIENT_ID,
    RefreshToken: sesion.refreshToken,
    ...(sesion.deviceKey ? { DeviceKey: sesion.deviceKey } : {}),
  })).then((respuesta): TokensCognito => {
    const accessToken = respuesta.AuthenticationResult?.AccessToken;
    if (!accessToken) {
      throw new Error("Cognito no devolvió un access token al renovar.");
    }
    return {
      accessToken,
      refreshToken: respuesta.AuthenticationResult?.RefreshToken || sesion.refreshToken,
      expiresIn: respuesta.AuthenticationResult?.ExpiresIn ?? 3600,
      deviceKey: respuesta.AuthenticationResult?.NewDeviceMetadata?.DeviceKey || sesion.deviceKey,
    };
  });

  renovacionEnCurso = { token: sesion.refreshToken, promesa };
  void promesa.then(
    () => { if (renovacionEnCurso?.promesa === promesa) renovacionEnCurso = null; },
    () => { if (renovacionEnCurso?.promesa === promesa) renovacionEnCurso = null; },
  );
  return promesa;
}

/** Revoca el refresh token actual en Cognito al cerrar sesión. */
export async function revocarRefreshToken(refreshToken: string): Promise<void> {
  await cognito.send(new RevokeTokenCommand({
    ClientId: CLIENT_ID,
    Token: refreshToken,
  }));
}
