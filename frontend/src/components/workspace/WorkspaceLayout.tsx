import { useEffect, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router";
import { PanelLeft, Search } from "lucide-react";
import Sidebar from "./Sidebar";
import { obtenerPerfil, type Perfil } from "../../services/profile";
import "../../styles/workspace.css";

type Props = { accessToken: string; onCerrarSesion: () => void };
export type WorkspaceContext = { busqueda: string; nombre: string };
// The outlet hook is intentionally exported alongside this layout for consumers.
// eslint-disable-next-line react-refresh/only-export-components
export const useWorkspace = () => useOutletContext<WorkspaceContext>();

export default function WorkspaceLayout({ accessToken, onCerrarSesion }: Props) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const ruta = useLocation();
  const esTradicional = ruta.pathname === "/inicio";

  useEffect(() => {
    let activo = true;
    void obtenerPerfil(accessToken)
      .then((datos) => { if (activo) setPerfil(datos); })
      .catch(() => { if (activo) setPerfil(null); });
    return () => { activo = false; };
  }, [accessToken]);

  return (
    <div className="dt-shell">
      <Sidebar perfil={perfil} onCerrarSesion={onCerrarSesion} />
      <div className="dt-workspace">
        <header className="dt-topbar">
          <div className="dt-topbar__location"><PanelLeft size={17} /> <span>{esTradicional ? "Hoy" : "Método IA"}</span></div>
          {esTradicional && (
            <label className="dt-topbar__search">
              <Search size={16} aria-hidden="true" />
              <span className="dt-sr-only">Buscar tareas</span>
              <input type="search" placeholder="Buscar tareas" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
          )}
        </header>
        <main className="dt-workspace__content">
          <Outlet context={{ busqueda, nombre: perfil?.nombre ?? "" }} />
        </main>
      </div>
    </div>
  );
}
