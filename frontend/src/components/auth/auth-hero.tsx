import type { ReactNode } from "react";
import { ArrowUpRight, Sprout } from "lucide-react";
import "../../styles/auth.css";

type AuthLayoutProps = {
  children: ReactNode;
  pagina?: "registro" | "login";
};

/**
 * Estructura reutilizable para registro, confirmación y acceso.
 */
export default function AuthLayout({
  children,
  pagina = "registro",
}: AuthLayoutProps) {
  const esRegistro = pagina === "registro";

  return (
    <main className="auth-shell">
      <aside className="auth-hero" aria-label="Presentación de dotol">
        <div className="auth-hero__photo" aria-hidden="true" />
        <div className="auth-hero__shade" aria-hidden="true" />

        <div className="auth-hero__inner">
          <div className="auth-brand" aria-label="dotol">
            <span className="auth-brand__symbol" aria-hidden="true">
              <Sprout size={23} strokeWidth={1.7} />
            </span>
            <span className="auth-brand__name">dotol</span>
          </div>

          <div className="auth-hero__story">
            <span className="auth-hero__eyebrow">
              MÁS CLARIDAD. MÁS ORGANIZACIÓN
            </span>
            <h2 className="auth-hero__title">
              Enfócate en lo<br />que importa.
            </h2>
            <p className="auth-hero__description">
              Encuentra la productividad con dotol.
            </p>
          </div>
        </div>
      </aside>

      <section className="auth-side">
        <header className="auth-side__top">
          <span>
            {esRegistro ? "¿Ya tienes una cuenta?" : "Nuevo en Dotol?"}
          </span>
          {/* La ruta /login se conectará cuando creemos LoginPage. */}
          <a className="auth-side__link" href={esRegistro ? "/login" : "/registro"}>
            {esRegistro ? "Inicia sesión" : "Crear cuenta"}
            <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden="true" />
          </a>
        </header>

        <div className="auth-side__main">{children}</div>
      </section>
    </main>
  );
}