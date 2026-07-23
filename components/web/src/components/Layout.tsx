import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

const nav = [
  { href: "/extension", label: "CAST Extension" },
  { href: "/vessel", label: "Vessel Location Updating" },
];

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = nav.find((n) => pathname.startsWith(n.href));

  const onSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">CAST</div>
        <div className="rail-label">Workspace</div>
        {nav.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={`rail-link${pathname.startsWith(item.href) ? " active" : ""}`}
          >
            <span className="dot" />
            {item.label}
          </Link>
        ))}
        <div className="rail-foot">CAST web app</div>
      </nav>

      <header className="topbar">
        <h1>{current?.label ?? "CAST"}</h1>
        <div className="user">
          <div className="user-id">
            <span className="name">{user?.displayName}</span>
            <span className="tag">{user?.source === "ad" ? "Active Directory" : "Local account"}</span>
          </div>
          <div className="avatar">{initials(user?.displayName ?? "?")}</div>
          <button type="button" className="signout" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="content">{children}</main>

      <style>{layoutCss}</style>
    </div>
  );
}

const layoutCss = `
  .shell { display: grid; grid-template-columns: 240px 1fr; grid-template-rows: 60px 1fr; min-height: 100vh; }
  .rail { grid-row: 1 / -1; background: var(--color-navy-deep); color: var(--color-navy-ink); display: flex; flex-direction: column; padding: 16px 12px; gap: 2px; }
  .brand { font-weight: 700; font-size: 1.0625rem; padding: 8px 8px 24px; }
  .rail-label { font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #6f93bc; padding: 8px 8px 4px; }
  .rail-link { display: flex; align-items: center; gap: 12px; color: #c3d7ec; text-decoration: none; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 0.8125rem; font-weight: 600; }
  .rail-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .rail-link.active { background: var(--color-signal-wash); color: #fff; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; }
  .rail-link.active .dot { opacity: 1; background: var(--color-signal); }
  .rail-foot { margin-top: auto; font-size: 0.6875rem; color: #4f6a87; font-family: var(--font-mono); padding: 8px; }
  .topbar { grid-column: 2; background: var(--color-surface); border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
  .topbar h1 { font-size: 1.375rem; }
  .user { display: flex; align-items: center; gap: 12px; }
  .user-id { text-align: right; line-height: 1.3; }
  .name { display: block; font-size: 0.8125rem; font-weight: 700; }
  .tag { display: block; font-size: 0.6875rem; color: var(--color-ink-faint); }
  .avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--color-signal-wash); color: var(--color-signal); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.75rem; border: 1px solid var(--color-border); }
  .signout { background: none; border: none; color: var(--color-ink-soft); font: inherit; font-weight: 600; cursor: pointer; padding: 8px; }
  .signout:hover { color: var(--color-ink); }
  .content { grid-column: 2; padding: 24px; }
  @media (max-width: 860px) { .shell { grid-template-columns: 1fr; } .rail { display: none; } .topbar, .content { grid-column: 1; } }
`;
