import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

type InicioPageProps = {
  accessToken: string;
  onCerrarSesion: () => void;
};

type RespuestaMe = {
  message: string;
  user_id: string;
};

/** Pantalla temporal para comprobar el login y la conexión con GET /me. */
export default function InitialPage({ accessToken, onCerrarSesion }: InicioPageProps) {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState<RespuestaMe | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function consultarUsuario() {
      try {
        const respuesta = await fetch(`${import.meta.env.VITE_API_URL}/me`, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });

        if (!respuesta.ok) {
          throw new Error(`GET /me devolvió HTTP ${respuesta.status}`);
        }

        const datos = (await respuesta.json()) as RespuestaMe;
        if (!controller.signal.aborted) setUsuario(datos);
      } catch (errorDesconocido) {
        if (!controller.signal.aborted) {
          setError(errorDesconocido instanceof Error ? errorDesconocido.message : "Error de conexión");
        }
      }
    }

    void consultarUsuario();
    return () => controller.abort();
  }, [accessToken]);

  function salir() {
    onCerrarSesion();
    navigate("/login", { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#F8F7F3] px-6 py-12 text-[#292F28]">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold text-[#42634B]">¡Bienvenido a dotol!</h1>
        <p className="mt-3 text-sm text-[#697065]">
          El inicio de sesión funcionó. Esta es una pantalla provisional antes de crear el dashboard.
        </p>
        {!usuario && !error && <p className="mt-5">Consultando GET /me...</p>}
        {usuario && (
          <div className="mt-5 rounded-xl bg-[#E8EEE3] p-4 text-sm">
            <p><strong>API:</strong> {usuario.message}</p>
            <p className="mt-2 break-all"><strong>ID de usuario:</strong> {usuario.user_id}</p>
          </div>
        )}
        {error && <p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}
        <button type="button" onClick={salir} className="mt-6 rounded-xl bg-[#42634B] px-5 py-3 text-sm font-semibold text-white">
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}
