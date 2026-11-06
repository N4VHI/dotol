import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";

import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import ManualTasksPage from "./pages/ManualTasksPage";
import AiTasksPage from "./pages/AiTasksPage";
import WorkspaceLayout from "./components/workspace/WorkspaceLayout";

type Sesion = {
  accessToken: string;
  expiraEn: number;
};

export default function App() {
  // Conservamos el funcionamiento actual: sesión en memoria (se pierde al recargar).
  const [sesion, setSesion] = useState<Sesion | null>(null);

  useEffect(() => {
    if (!sesion) return;
    const tiempoRestante = Math.max(0, sesion.expiraEn - Date.now());
    const temporizador = window.setTimeout(() => setSesion(null), tiempoRestante);
    return () => window.clearTimeout(temporizador);
  }, [sesion]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={sesion ? "/inicio" : "/login"} replace />} />
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/login" element={
        <LoginPage onIniciarSesion={(accessToken, expiresIn) => {
          setSesion({
            accessToken,
            expiraEn: Date.now() + Math.max(0, expiresIn - 30) * 1000,
          });
        }} />
      } />

      {/* Todas las rutas privadas comparten exactamente el mismo menú izquierdo. */}
      <Route element={sesion ? (
        <WorkspaceLayout accessToken={sesion.accessToken} onCerrarSesion={() => setSesion(null)} />
      ) : <Navigate to="/login" replace />}>
        <Route path="/inicio" element={<ManualTasksPage accessToken={sesion?.accessToken ?? ""} />} />
        <Route
          path="/ia"
          element={
            <AiTasksPage
              accessToken={sesion?.accessToken ?? ""}
            />
          }
        />
      </Route>

      <Route path="*" element={<Navigate to={sesion ? "/inicio" : "/login"} replace />} />
    </Routes>
  );
}
