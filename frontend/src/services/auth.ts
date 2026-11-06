
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

  const refreshToken = respuesta.AuthenticationResult?.RefreshToken;
  if (!refreshToken) {
    throw new Error("Cognito no devolvió un refresh token para esta sesión.");
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: respuesta.AuthenticationResult?.ExpiresIn ?? 3600,
    deviceKey: respuesta.AuthenticationResult?.NewDeviceMetadata?.DeviceKey,
  } satisfies TokensCognito;
}

// Mensajes de error
export function mensajeErrorCognito(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "";

  switch (nombre) {
    case "UsernameExistsException":
      return "Este correo ya está registrado.";

    case "InvalidPasswordException":
      return "La contraseña no cumple los requisitos.";

    case "CodeMismatchException":
      return "El código es incorrecto.";

    case "ExpiredCodeException":
      return "El código expiró.";

    case "InvalidParameterException":
      return "Revisa los datos ingresados.";

    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Demasiados intentos. Inténtalo más tarde.";

    default:
      return "Ocurrió un error. Inténtalo nuevamente.";
  }
}

/**
 * Renovación compatible con clientes Cognito con o sin rotación del refresh token.
 * Compartimos las peticiones en curso para evitar dos rotaciones simultáneas en
 * React.StrictMode. El token de reemplazo puede cambiar tras cada renovación.
 */
let renovacionEnCurso: { token: string; promesa: Promise<TokensCognito> } | null = null;

export function renovarTokens(sesion: Sesion): Promise<TokensCognito> {
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
