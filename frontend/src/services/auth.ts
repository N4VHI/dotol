
import {
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import {
  SignUpCommand,
  InitiateAuthCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

import { cognito, CLIENT_ID } from "../config/cognito";

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

  return {
    accessToken,
    expiresIn: respuesta.AuthenticationResult?.ExpiresIn ?? 3600,
  };
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
