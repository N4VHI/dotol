import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router";

import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import ManualTasksPage from "./pages/ManualTasksPage";
import AiTasksPage from "./pages/AiTasksPage";
import EvaluationGatePage from "./pages/EvaluationGatePage";
import WorkspaceLayout from "./components/workspace/WorkspaceLayout";
import { consultarEvaluacion, type ResumenEvaluacion } from "./services/evaluacion";
import { renovarTokens, revocarRefreshToken } from "./services/auth";
import {
  crearSesion,
  guardarSesion,
  leerSesionGuardada,
  limpiarSesion,
  type Sesion,
  type TokensCognito,
} from "./services/sesion";


// Solo se usa para adaptar la interfaz. La autorización real ocurre en la
// Lambda, leyendo el claim cognito:groups validado por API Gateway.
function esAdministradorLocal(accessToken?: string): boolean {
  if (!accessToken) return false;
  try {
    const parte = accessToken.split(".")[1];
    if (!parte) return false;
    const base64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    const datos: unknown = JSON.parse(atob(base64));
    if (!datos || typeof datos !== "object" || !("cognito:groups" in datos)) return false;
    const grupos = datos["cognito:groups"];
    return Array.isArray(grupos) && grupos.includes("dotol-admins");
  } catch {
    return false;
  }
}

type Autenticacion = {
  sesion: Sesion | null;
  fase: "restaurando" | "lista" | "error";
};

function pantallaEstado(titulo: string, mensaje: string, reintentar?: () => void, salir?: () => void) {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f8f7f3" }}>
      <div style={{ textAlign: "center", color: "#42634b", padding: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>dotol</h1>
        <p role={reintentar ? "alert" : "status"}>{titulo}</p>
        <p>{mensaje}</p>
        {reintentar && <button type="button" onClick={reintentar}>Reintentar</button>}
        {salir && <> {" "}<button type="button" onClick={salir}>Volver al inicio de sesión</button></>}
      </div>
    </main>
  );
}

export default function App() {
  const [autenticacion, setAutenticacion] = useState<Autenticacion>(() => {
    const guardada = leerSesionGuardada();
    return { sesion: guardada, fase: guardada ? "restaurando" : "lista" };
  });
  const [evaluacion, setEvaluacion] = useState<ResumenEvaluacion | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [errorEvaluacion, setErrorEvaluacion] = useState("");
  const versionSesion = useRef(0);

  const sesion = autenticacion.sesion;
  const token = autenticacion.fase === "lista" ? sesion?.accessToken : undefined;
  const esAdmin = esAdministradorLocal(token);

  // Al recargar se valida la sesión almacenada y se renueva si está por vencer.
  // No mostramos login ni llamamos a la API hasta terminar esta operación.
  useEffect(() => {
    if (autenticacion.fase !== "restaurando" || !sesion) return;
    let vigente = true;
    const version = versionSesion.current;

    async function restaurar() {
      try {
        const margen = sesion!.refreshToken ? 60_000 : 0;
        const siguiente = sesion!.expiraEn - Date.now() > margen
          ? sesion!
          : sesion!.refreshToken
            ? crearSesion(await renovarTokens(sesion!))
            : null;
        if (!vigente || version !== versionSesion.current) return;
        if (!siguiente) {
          limpiarSesion();
          setAutenticacion({ sesion: null, fase: "lista" });
          return;
        }
        guardarSesion(siguiente);
        setAutenticacion({ sesion: siguiente, fase: "lista" });
      } catch (error: unknown) {
        if (!vigente || version !== versionSesion.current) return;
        const tipo = error instanceof Error ? error.name : "";
        if (["NotAuthorizedException", "InvalidParameterException", "ResourceNotFoundException"].includes(tipo)) {
          limpiarSesion();
          setAutenticacion({ sesion: null, fase: "lista" });
        } else {
          setAutenticacion({ sesion, fase: "error" });
        }
      }
    }

    void restaurar();
    return () => { vigente = false; };
  }, [autenticacion.fase, sesion]);

  // Renovación preventiva un minuto antes del vencimiento.
  useEffect(() => {
    if (autenticacion.fase !== "lista" || !sesion) return;
    let vigente = true;
    const version = versionSesion.current;
    const margen = sesion.refreshToken ? 60_000 : 0;
    const restante = Math.max(0, sesion.expiraEn - Date.now() - margen);

    const temporizador = window.setTimeout(() => {
      if (!sesion.refreshToken) {
        cerrarSesionLocal();
        return;
      }
      void renovarTokens(sesion)
        .then((tokensNuevos) => {
          if (!vigente || version !== versionSesion.current) return;
          const siguiente = crearSesion(tokensNuevos);
          guardarSesion(siguiente);
          setAutenticacion({ sesion: siguiente, fase: "lista" });
        })
        .catch((error: unknown) => {
          if (!vigente || version !== versionSesion.current) return;
          const tipo = error instanceof Error ? error.name : "";
          if (["NotAuthorizedException", "InvalidParameterException", "ResourceNotFoundException"].includes(tipo)) {
            cerrarSesionLocal();
          } else {
            setAutenticacion({ sesion, fase: "error" });
          }
        });
    }, restante);

    return () => {
      vigente = false;
      window.clearTimeout(temporizador);
    };
  }, [autenticacion.fase, sesion]);

  // Consultar la evaluación solo con un access token listo y vigente.
  useEffect(() => {
    if (!token || esAdmin) return;
    const controller = new AbortController();
    void consultarEvaluacion(token, controller.signal)
      .then((estado) => {
        if (!controller.signal.aborted) {
          setEvaluacion(estado);
          setErrorEvaluacion("");
        }
      })
      .catch((fallo: unknown) => {
        if (!controller.signal.aborted) {
          setErrorEvaluacion(
            fallo instanceof Error ? fallo.message : "No se pudo consultar la evaluación."
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setComprobando(false);
      });
    return () => controller.abort();
  }, [token, esAdmin]);

  function cerrarSesionLocal() {
    versionSesion.current += 1;
    limpiarSesion();
    setAutenticacion({ sesion: null, fase: "lista" });
    setEvaluacion(null);
    setComprobando(false);
    setErrorEvaluacion("");
  }

  function cerrarSesion() {
    const refreshToken = sesion?.refreshToken;
    cerrarSesionLocal();
    if (refreshToken) {
      // El cierre local es inmediato; intentamos revocar el refresh token en Cognito.
      void revocarRefreshToken(refreshToken).catch(() => {
        // Si la red falla, la sesión ya fue borrada de la pestaña.
      });
    }
  }

  function autenticar(tokens: TokensCognito) {
    const nueva = crearSesion(tokens);
    versionSesion.current += 1;
    guardarSesion(nueva);
    setEvaluacion(null);
    setComprobando(true);
    setErrorEvaluacion("");
    setAutenticacion({ sesion: nueva, fase: "lista" });
  }

  function reintentarRestauracion() {
    if (sesion) setAutenticacion({ sesion, fase: "restaurando" });
  }

  async function reintentarEvaluacion() {
    if (!token) return;
    setComprobando(true);
    setErrorEvaluacion("");
    try {
      setEvaluacion(await consultarEvaluacion(token));
    } catch (fallo) {
      setErrorEvaluacion(fallo instanceof Error ? fallo.message : "No se pudo consultar la evaluación.");
    } finally {
      setComprobando(false);
    }
  }

  if (autenticacion.fase === "restaurando") {
    return pantallaEstado("Restaurando tu sesión…", "Comprobando tus credenciales de Cognito.");
  }
  if (autenticacion.fase === "error") {
    return pantallaEstado(
      "No se pudo renovar la sesión.",
      "Comprueba tu conexión e inténtalo de nuevo.",
      reintentarRestauracion,
      cerrarSesion,
    );
  }

  const finalizada = esAdmin || evaluacion?.estado_global === "completada";
  const registroActivo = evaluacion?.evaluaciones.find(
    (item) => item.tipo_prueba === evaluacion.metodo_actual
  );
  const pruebaActiva =
    evaluacion?.estado_global === "en_progreso" && registroActivo?.estado === "en_curso";
  const entradaNormal = esAdmin ? "/inicio" : "/evaluacion";
  const entrarManual = esAdmin || (pruebaActiva && evaluacion?.metodo_actual === "tradicional");
  const entrarIA = esAdmin || (pruebaActiva && evaluacion?.metodo_actual === "ia");

  if (sesion && !esAdmin && (comprobando || !evaluacion)) {
    return pantallaEstado(
      errorEvaluacion || "Comprobando fase de evaluación…",
      errorEvaluacion ? "No se modificaron tus datos." : "",
      errorEvaluacion ? () => { void reintentarEvaluacion(); } : undefined,
      errorEvaluacion ? cerrarSesion : undefined,
    );
  }

  return (
    <Routes>
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/login" element={
        sesion ? <Navigate to={entradaNormal} replace /> :
        <LoginPage onIniciarSesion={autenticar} />
      } />

      <Route element={sesion ? (
        <WorkspaceLayout accessToken={sesion.accessToken} onCerrarSesion={cerrarSesion} />
      ) : <Navigate to="/login" replace />}>
        <Route
          path="/evaluacion"
          element={<EvaluationGatePage
            accessToken={token ?? ""}
            onEstadoActualizado={setEvaluacion}
          />}
        />
        <Route
          path="/inicio"
          element={entrarManual ? (
            <ManualTasksPage
              accessToken={token ?? ""}
              evaluacionActiva={!finalizada && pruebaActiva ? registroActivo : null}
              onEstadoActualizado={setEvaluacion}
            />
          ) : <Navigate to="/evaluacion" replace />}
        />
        <Route
          path="/ia"
          element={entrarIA ? (
            <AiTasksPage
              accessToken={token ?? ""}
              evaluacionActiva={!finalizada && pruebaActiva ? registroActivo : null}
              onEstadoActualizado={setEvaluacion}
            />
          ) : <Navigate to="/evaluacion" replace />}
        />
      </Route>

      <Route path="/" element={<Navigate to={sesion ? entradaNormal : "/login"} replace />} />
      <Route path="*" element={<Navigate to={sesion ? entradaNormal : "/login"} replace />} />
    </Routes>
  );
}
