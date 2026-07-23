import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "../ui";
import { IconGrid, IconShip, IconSearch, IconRoute, IconPlug, IconActivity, IconLogout, IconMenu, IconPin } from "../ui/Icons";

const groups = [
  {
    label: "Workspace",
    items: [
      { href: "/extension", label: "CAST Extension", icon: IconGrid },
      { href: "/vessel", label: "Vessel Location Updating", icon: IconShip },
      { href: "/vessel-identity", label: "Vessel Identity", icon: IconSearch },
      { href: "/tracking", label: "Vessel Tracking Config", icon: IconRoute },
      { href: "/geo-alerts", label: "Geo Alerts", icon: IconPin },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/integrations", label: "Integrations", icon: IconPlug },
      { href: "/health", label: "System Health", icon: IconActivity },
    ],
  },
];

const allItems = groups.flatMap((g) => g.items);

// Nav items that require a permission to appear.
const REQUIRES: Record<string, string> = { "/integrations": "integrations.write" };

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const current = allItems.find((n) => pathname.startsWith(n.href));

  const onSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={`rail${drawerOpen ? " open" : ""}`}>
        <div className="rail-brand">
          <img src="/favicon.png" alt="" />
          <span className="rail-brand-name">CAST</span>
        </div>
        <nav className="rail-nav">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="rail-section-label">{g.label}</div>
              {g.items
                .filter((item) => !REQUIRES[item.href] || can(REQUIRES[item.href]))
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.href}
                      to={item.href}
                      className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                      onClick={() => setDrawerOpen(false)}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="rail-footer">CAST · ConnectWise Augmentation Suite</div>
      </aside>

      <div className={`rail-backdrop${drawerOpen ? " show" : ""}`} onClick={() => setDrawerOpen(false)} />

      <div className="main">
        <header className="topbar">
          <div className="row gap-2">
            <button className="rail-toggle" aria-label="Menu" onClick={() => setDrawerOpen((o) => !o)}>
              <IconMenu />
            </button>
            <h1>{current?.label ?? "CAST"}</h1>
          </div>
          <div className="row gap-3">
            <div className="topbar-user">
              <div className="topbar-user-name">{user?.displayName}</div>
              <div className="topbar-user-tag">
                {(user?.source === "ad" ? "Active Directory" : "Local account")} · {user?.role}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              <IconLogout /> <span className="hide-xs">Sign out</span>
            </Button>
          </div>
        </header>
        <main className="page-body">
          <div className="page-body-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
