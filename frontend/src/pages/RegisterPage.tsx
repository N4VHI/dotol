import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  MailCheck,
  Sun,
} from "lucide-react";

import AuthLayout from "../components/auth/auth-hero";
import {
  registrarUsuario,
  confirmarRegistro,
  reenviarCodigo,
  mensajeErrorCognito,
} from "../services/auth";

type Etapa = "registro" | "verificacion" | "completado";

export default function RegisterPage() {
  // Conservamos el estado y el flujo que ya tenías funcionando.
  const [datos, setDatos] = useState({
    nombres: "",
    apellidos: "",
    codigo_universidad: "",
    universidad: "",
    correo: "",
    contrasena: "",
    repetirContrasena: "",
  });
  const [etapa, setEtapa] = useState<Etapa>("registro");
  const [correoVerificacion, setCorreoVerificacion] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [mostrarContrasena, setMostrarContrasena] = useState(false);
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);

  function cambiarDato(campo: keyof typeof datos, valor: string) {
    setDatos((anterior) => ({ ...anterior, [campo]: valor }));
  }

  async function manejarRegistro(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError("");
    setAviso("");

    if (!datos.nombres.trim() || !datos.apellidos.trim()) {
      setError("Ingresa tus nombres y apellidos.");
      return;
    }
    if (datos.contrasena !== datos.repetirContrasena) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    // Coincide con la política definida en tu Cognito: mínimo 12 caracteres.
    const contrasenaValida =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
    if (!contrasenaValida.test(datos.contrasena)) {
      setError(
        "La contraseña necesita al menos 12 caracteres, " +
          "mayúscula, minúscula, número y símbolo."
      );
      return;
    }

    setCargando(true);
    try {
      const resultado = await registrarUsuario({
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        correo: datos.correo,
        contrasena: datos.contrasena,
        universidad: datos.universidad,
        codigo_universidad: datos.codigo_universidad,
      });

      if (resultado.UserConfirmed) {
        setEtapa("completado");
      } else {
        setCorreoVerificacion(datos.correo.trim().toLowerCase());
        setEtapa("verificacion");
        setAviso("Revisa tu correo para obtener el código.");
      }
    } catch (errorDesconocido) {
      setError(mensajeErrorCognito(errorDesconocido));
    } finally {
      setCargando(false);
    }
  }

  async function manejarConfirmacion(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError("");
    setAviso("");
    setCargando(true);
    try {
      await confirmarRegistro(correoVerificacion, codigo);
      setEtapa("completado");
      setCodigo("");
      // No conservamos contraseñas tras confirmar el registro.
      setDatos((actual) => ({ ...actual, contrasena: "", repetirContrasena: "" }));
    } catch (errorDesconocido) {
      setError(mensajeErrorCognito(errorDesconocido));
    } finally {
      setCargando(false);
    }
  }

  async function manejarReenvio() {
    setError("");
    setAviso("");
    setCargando(true);
    try {
      await reenviarCodigo(correoVerificacion);
      setAviso("Se solicitó un nuevo código. Revisa tu correo.");
    } catch (errorDesconocido) {
      setError(mensajeErrorCognito(errorDesconocido));
    } finally {
      setCargando(false);
    }
  }

  return (
    <AuthLayout pagina="registro">
      <div className="auth-card">
        {etapa === "registro" && (
          <>
            <div className="auth-intro">
              <div className="auth-intro__symbol" aria-hidden="true">
                <Sun size={20} strokeWidth={1.7} />
              </div>
              <h1>Crea tu cuenta.</h1>
            </div>

            {error && <p className="auth-alert auth-alert--error" role="alert">{error}</p>}
            {aviso && <p className="auth-alert auth-alert--info" role="status">{aviso}</p>}

            <form onSubmit={manejarRegistro} className="auth-form">
              <div className="auth-form__columns">
                <div  className="auth-form__col">
                    <div className="auth-field">
                      <label htmlFor="nombres">Nombre(s)</label>
                      <input id="nombres" value={datos.nombres} onChange={(e) => cambiarDato("nombres", e.target.value)}
                        placeholder="Tu nombre" autoComplete="given-name" maxLength={100} required />
                    </div>

                    <div className="auth-field">
                      <label htmlFor="apellidos">Apellidos</label>
                      <input id="apellidos" value={datos.apellidos} onChange={(e) => cambiarDato("apellidos", e.target.value)}
                        placeholder="Tus apellidos" autoComplete="family-name" maxLength={100} required />
                    </div>

                    <div className="auth-field">
                      <label htmlFor="codigo_universidad">Código Universitario</label>
                      <input id="codigo_universidad" value={datos.codigo_universidad} onChange={(e) => cambiarDato("codigo_universidad", e.target.value)}
                        placeholder="Tu código universitario" maxLength={100} />
                    </div>

                    <div className="auth-field">
                      <label htmlFor="universidad">Universidad</label>
                      <input id="universidad" value={datos.universidad} onChange={(e) => cambiarDato("universidad", e.target.value)}
                        placeholder="Tu universidad" maxLength={100} autoComplete="organization" />
                    </div>
                </div>
                <div  className="auth-form__col">
                    <div className="auth-field">
                      <label htmlFor="correo">Correo</label>
                      <input id="correo" type="email" value={datos.correo} onChange={(e) => cambiarDato("correo", e.target.value)}
                        placeholder="tu@email.com" autoComplete="email" required />
                    </div>

                    <div className="auth-field">
                      <label htmlFor="contrasena">Contraseña</label>
                      <div className="auth-field__password">
                        <input id="contrasena" type={mostrarContrasena ? "text" : "password"} value={datos.contrasena}
                          onChange={(e) => cambiarDato("contrasena", e.target.value)} placeholder="Crea una contraseña"
                          autoComplete="new-password" minLength={12} aria-describedby="regla-contrasena" required />
                        <button type="button" className="auth-field__eye" onClick={() => setMostrarContrasena((v) => !v)}
                          aria-label={mostrarContrasena ? "Ocultar contraseña" : "Mostrar contraseña"}
                          aria-pressed={mostrarContrasena}>
                          {mostrarContrasena ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <p className="auth-field__hint" id="regla-contrasena">Mínimo 12 caracteres, mayúscula, minúscula, número y símbolo.</p>
                    </div>

                    <div className="auth-field">
                      <label htmlFor="repetir">Confirmar contraseña</label>
                      <div className="auth-field__password">
                        <input id="repetir" type={mostrarConfirmacion ? "text" : "password"} value={datos.repetirContrasena}
                          onChange={(e) => cambiarDato("repetirContrasena", e.target.value)}
                          placeholder="Repite tu contraseña" autoComplete="new-password" required />
                        <button type="button" className="auth-field__eye" onClick={() => setMostrarConfirmacion((v) => !v)}
                          aria-label={mostrarConfirmacion ? "Ocultar confirmación" : "Mostrar confirmación"}
                          aria-pressed={mostrarConfirmacion}>
                          {mostrarConfirmacion ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                </div>
              </div>
              

              {/* Términos y privacidad para la evaluación académica. */}
              <details style={{ fontSize: "0.7rem", lineHeight: 1.5 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Leer términos de uso y privacidad
                </summary>
                <p>
                  Dotol se utiliza en una investigación académica que compara
                  el registro manual de tareas con el registro asistido por IA.
                  Para la tesis se analizarán los tiempos, clics, cantidades de
                  tareas registradas y respuestas de los cuestionarios SUS y
                  NASA-TLX. No se publicarán nombres ni correos, y no se
                  revisará el contenido individual de las tareas como parte del
                  estudio. La aplicación sí almacena las tareas para funcionar;
                  los mensajes del chatbot se procesan mediante servicios de
                  AWS. Participar es voluntario.
                </p>
              </details>

              <label className="auth-terms">
                <input type="checkbox" required />
                <span>
                  He leído y acepto los{" "}
                  <span className="auth-terms__emphasis">términos de uso y privacidad</span>
                  {" "}para participar en la evaluación académica.
                </span>
              </label>

              <button type="submit" className="auth-submit" disabled={cargando}>
                <ArrowRight size={18} aria-hidden="true" />
                {cargando ? "Creando cuenta..." : "Crear cuenta"}
              </button>
            </form>

            <button type="button" className="auth-secondary-action"
              onClick={() => {
                setError("");
                setAviso("");
                setCorreoVerificacion(datos.correo.trim().toLowerCase());
                setEtapa("verificacion");
              }}>
              Ya tengo un código de verificación
            </button>
          </>
        )}

        {etapa === "verificacion" && (
          <>
            <div className="auth-intro">
              <div className="auth-intro__symbol" aria-hidden="true"><MailCheck size={25} strokeWidth={1.7} /></div>
              <h1>Verifica tu correo.</h1>
              <p>Ingresa el código de confirmación que recibiste.</p>
            </div>

            {error && <p className="auth-alert auth-alert--error" role="alert">{error}</p>}
            {aviso && <p className="auth-alert auth-alert--info" role="status">{aviso}</p>}

            <form onSubmit={manejarConfirmacion} className="auth-form">
              <div className="auth-field">
                <label htmlFor="correoVerificacion">Correo registrado</label>
                <input id="correoVerificacion" type="email" value={correoVerificacion}
                  onChange={(e) => setCorreoVerificacion(e.target.value)}
                  autoComplete="email" required />
              </div>
              <div className="auth-field">
                <label htmlFor="codigo">Código de verificación</label>
                <input id="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="Código recibido por correo" required />
              </div>
              <button type="submit" className="auth-submit" disabled={cargando}>
                <ArrowRight size={18} aria-hidden="true" />
                {cargando ? "Verificando..." : "Confirmar cuenta"}
              </button>
            </form>
            <button type="button" className="auth-secondary-action" onClick={manejarReenvio}
              disabled={cargando || !correoVerificacion.trim()}>
              Reenviar código
            </button>
            <button type="button" className="auth-secondary-action auth-secondary-action--muted"
              onClick={() => { setError(""); setAviso(""); setEtapa("registro"); }}>
              Volver al registro
            </button>
          </>
        )}

        {etapa === "completado" && (
          <div className="auth-complete">
            <div className="auth-intro__symbol" aria-hidden="true"><CheckCircle2 size={27} strokeWidth={1.7} /></div>
            <h1>¡Cuenta confirmada!</h1>
            <p>Tu cuenta de dotol ya está lista. Ahora puedes iniciar sesión.</p>
            {/* Se habilitará al implementar la ruta /login. */}
            <a className="auth-submit auth-submit--link" href="/login">
              <ArrowRight size={18} aria-hidden="true" />
              Ir a iniciar sesión
            </a>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
