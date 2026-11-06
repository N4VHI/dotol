import { Inbox, LogOut, Sparkles, Sprout } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import type { Perfil } from "../../services/profile";

type Props = { perfil: Perfil | null; onCerrarSesion: () => void };

export default function Sidebar({ perfil, onCerrarSesion }: Props) {
  const navigate = useNavigate();
  const nombreCompleto = [perfil?.nombre, perfil?.apellidos].filter(Boolean).join(" ") || "Mi cuenta";
  const iniciales = [perfil?.nombre?.[0], perfil?.apellidos?.[0]].filter(Boolean).join("").toUpperCase() || "DT";

  function salir() {
    onCerrarSesion();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="dt-sidebar" aria-label="Navegación principal">
      <div className="dt-sidebar__brand">
        <span className="dt-sidebar__logo" aria-hidden="true"><Sprout size={23} strokeWidth={1.8} /></span>
        <span>dotol</span>
      </div>

      <nav className="dt-sidebar__nav" aria-label="Métodos de organización">
        <NavLink to="/ia" className={({ isActive }) => `dt-sidebar__link ${isActive ? "is-active" : ""}`}>
          <Sparkles size={20} strokeWidth={1.7} /> <span>Método IA</span>
        </NavLink>
        <NavLink to="/inicio" className={({ isActive }) => `dt-sidebar__link ${isActive ? "is-active" : ""}`}>
          <Inbox size={19} strokeWidth={1.7} /> <span>Método Tradicional</span>
        </NavLink>
      </nav>

      <div className="dt-sidebar__bottom">
        <div className="dt-sidebar__profile" title={nombreCompleto}>
          <span className="dt-sidebar__avatar" aria-hidden="true">{iniciales}</span>
          <span className="dt-sidebar__profile-name">{nombreCompleto}</span>
        </div>
        <button type="button" className="dt-sidebar__logout" onClick={salir} aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
