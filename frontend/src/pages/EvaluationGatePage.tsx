import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  consultarEvaluacion,
  enviarNASA_TLX,
  enviarSUS,
  iniciarEvaluacion,
  prepararEvaluacion,
  type ResumenEvaluacion,
  type RegistroEvaluacion,
  type GruposEvaluacion,
} from "../services/evaluacion";
import EvaluationControlPage from "./EvaluationControlPage";
import EvaluationFinishedPage from "./EvaluationFinishedPage";
import EvaluationInstructionsPage from "./EvaluationInstructionsPage";
import EvaluationWelcomePage from "./EvaluationWelcomePage";
import NasaTlxMockPage from "./NasaTlxMockPage";
import SusMockPage from "./SusMockPage";
import "../styles/evaluation.css";
import "../styles/evaluation-grupos.css";

type Props = {
  accessToken: string;
  onEstadoActualizado?: (estado: ResumenEvaluacion) => void;
};

function registroActual(estado: ResumenEvaluacion | null): RegistroEvaluacion | undefined {
  return estado?.evaluaciones.find((item) => item.tipo_prueba === estado.metodo_actual);
}

// Esta marca solo evita repetir la bienvenida al recargar la pestaña.
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

export default function EvaluationGatePage({ accessToken, onEstadoActualizado }: Props) {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<ResumenEvaluacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState<null | "preparar" | "iniciar" | "tlx" | "sus">(null);
  const [error, setError] = useState("");

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


  const actualizar = useCallback((datos: ResumenEvaluacion) => {
    setEstado(datos);
    onEstadoActualizado?.(datos);
  }, [onEstadoActualizado]);

  const recargar = useCallback(async (signal?: AbortSignal) => {
    const datos = await consultarEvaluacion(accessToken, signal);
    if (!signal?.aborted) actualizar(datos);
  }, [accessToken, actualizar]);

  useEffect(() => {
    const controller = new AbortController();
    void consultarEvaluacion(accessToken, controller.signal)
      .then((datos) => { if (!controller.signal.aborted) actualizar(datos); })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "No se pudo cargar la evaluación.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [accessToken, actualizar]);

  const actual = registroActual(estado);

  // Si se recarga la pestaña durante una prueba ya iniciada,
  // reanudamos el mismo método en lugar de iniciar un segundo cronómetro.
  useEffect(() => {
    if (actual?.estado === "en_curso") {
      navigate(actual.tipo_prueba === "ia" ? "/ia" : "/inicio", { replace: true });
    }
  }, [actual?.estado, actual?.tipo_prueba, navigate]);

  async function comenzar(grupos: GruposEvaluacion) {
    setTrabajando("preparar");
    setError("");
    try {
      actualizar(await prepararEvaluacion(accessToken, grupos));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la evaluación.");
    } finally {
      setTrabajando(null);
    }
  }

  async function iniciar() {
    setTrabajando("iniciar");
    setError("");
    try {
      const datos = await iniciarEvaluacion(accessToken);
      actualizar(datos);
      if (!datos.metodo_actual) throw new Error("La evaluación no devolvió el método actual.");
      navigate(datos.metodo_actual === "ia" ? "/ia" : "/inicio", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la prueba.");
    } finally {
      setTrabajando(null);
    }
  }

  async function guardarTlx(respuestas: number[]) {
    setTrabajando("tlx");
    setError("");
    try {
      actualizar(await enviarNASA_TLX(accessToken, respuestas));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar NASA-TLX.");
    } finally {
      setTrabajando(null);
    }
  }

  async function guardarSus(respuestas: number[]) {
    setTrabajando("sus");
    setError("");
    try {
      actualizar(await enviarSUS(accessToken, respuestas));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar SUS.");
    } finally {
      setTrabajando(null);
    }
  }

  if (cargando) return <div className="dt-eval-loading">Cargando evaluación...</div>;
  if (!estado) {
    return (
      <div className="dt-eval-loading">
        <div>
          <p role="alert">{error || "No se pudo obtener el estado de evaluación."}</p>
          <button type="button" onClick={() => { setCargando(true); void recargar().catch((e: unknown) => {
            setError(e instanceof Error ? e.message : "No se pudo cargar la evaluación.");
          }).finally(() => setCargando(false)); }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {error && <div className="dt-eval-global-error" role="alert">{error}</div>}

      {estado.estado_global === "no_iniciada" && (
        bienvenidaVista ? (
          <EvaluationInstructionsPage preparando={trabajando === "preparar"} onComenzar={(grupos) => void comenzar(grupos)} />
        ) : (
          <EvaluationWelcomePage onContinuar={continuarBienvenida} />
        )
      )}

      {/* La Lambda devuelve "instrucciones" al preparar, pero ya creó las dos filas pendientes. */}
      {estado.estado_global === "en_progreso" && actual?.estado === "pendiente" && (
        <EvaluationControlPage
          metodo={actual.tipo_prueba}
          orden={actual.orden}
          iniciando={trabajando === "iniciar"}
          onIniciar={() => void iniciar()}
          registro={actual}
        />
      )}

      {actual?.estado === "en_curso" && (
        <div className="dt-eval-loading">Reanudando prueba...</div>
      )}

      {actual?.estado === "pendiente_tlx" && (
        <NasaTlxMockPage enviando={trabajando === "tlx"} onEnviar={(r) => void guardarTlx(r)} />
      )}

      {actual?.estado === "pendiente_sus" && (
        <SusMockPage enviando={trabajando === "sus"} onEnviar={(r) => void guardarSus(r)} />
      )}

      {estado.estado_global === "completada" && (
        <EvaluationFinishedPage />
      )}
    </>
  );
}
