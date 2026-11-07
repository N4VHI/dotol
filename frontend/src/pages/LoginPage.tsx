import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Sun } from "lucide-react";

import AuthLayout from "../components/auth/auth-hero";
import { iniciarSesion, mensajeErrorCognito } from "../services/auth";
import type { TokensCognito } from "../services/sesion";
import "../styles/login.css";

type LoginPageProps = {
  onIniciarSesion: (tokens: TokensCognito) => void;
};

export default function LoginPage({ onIniciarSesion }: LoginPageProps) {
  const [correo, setCorreo] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [mostrarContrasena, setMostrarContrasena] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function manejarIngreso(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (cargando) return;

    setError("");
    setCargando(true);

    try {
      // Separamos el error de Cognito del error al inicializar la sesión React.
      // Así no confundimos un login correcto con un error de la aplicación.
      let resultado: Awaited<ReturnType<typeof iniciarSesion>>;
      try {
        resultado = await iniciarSesion(correo, contrasena);
      } catch (errorCognito: unknown) {
        setError(mensajeErrorCognito(errorCognito));
        return;
      }

      try {
        onIniciarSesion(resultado);
        setContrasena("");
        // App.tsx decide el destino según el estado de evaluación.
      } catch (errorAplicacion: unknown) {
        const nombre = errorAplicacion && typeof errorAplicacion === "object"
          && "name" in errorAplicacion && typeof errorAplicacion.name === "string"
            ? errorAplicacion.name : "ErrorDesconocido";
        setError(`Cognito aceptó el login, pero dotol no pudo iniciar la sesión (${nombre}).`);
      }
    } finally {
      setCargando(false);
    }
  }

  return (
    <AuthLayout pagina="login">
      <div className="auth-card auth-login">
        <div className="auth-intro">
          <div className="auth-intro__symbol" aria-hidden="true">
            <Sun size={25} strokeWidth={1.7} />
          </div>
          <h1>Bienvenido.</h1>
          <p>Ingresa y continúa con lo que queda pendiente</p>
        </div>

        {error && (
          <p className="auth-alert auth-alert--error" role="alert">
            {error}
          </p>
        )}

        <form className="auth-form" onSubmit={manejarIngreso}>
          <div className="auth-field">
            <label htmlFor="login-correo">Correo</label>
            <input
              id="login-correo"
              type="email"
              value={correo}
              onChange={(evento) => setCorreo(evento.target.value)}
              placeholder="tu@email.com"
              autoComplete="username"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="login-contrasena">Contraseña</label>
            <div className="auth-field__password">
              <input
                id="login-contrasena"
                type={mostrarContrasena ? "text" : "password"}
                value={contrasena}
                onChange={(evento) => setContrasena(evento.target.value)}
                placeholder="Tu contraseña"
                autoComplete="current-password"
                required
              />
              <button
                className="auth-field__eye"
                type="button"
                onClick={() => setMostrarContrasena((valor) => !valor)}
                aria-label={mostrarContrasena ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={mostrarContrasena}
              >
                {mostrarContrasena ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button className="auth-submit" type="submit" disabled={cargando}>
            <ArrowRight size={18} aria-hidden="true" />
            {cargando ? "Ingresando..." : "Ingresa"}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
}
