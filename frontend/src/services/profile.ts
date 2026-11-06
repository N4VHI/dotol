import { GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "../config/cognito";

export type Perfil = { nombre: string; apellidos: string };

/** Consulta atributos del usuario actual mediante su access token, sin un rol IAM en React. */
export async function obtenerPerfil(accessToken: string): Promise<Perfil> {
  const resultado = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
  const atributos = resultado.UserAttributes ?? [];
  const valor = (nombre: string) => atributos.find((a) => a.Name === nombre)?.Value ?? "";
  return { nombre: valor("given_name"), apellidos: valor("family_name") };
}
