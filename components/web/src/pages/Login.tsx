import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";

export function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"ad" | "local">("ad");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in → skip the form.
  useEffect(() => {
    if (user) navigate("/extension", { replace: true });
  }, [user, navigate]);

  // Optional: hint from the API whether AD is even configured.
  useEffect(() => {
    api.get<{ adConfigured: boolean }>("/auth/config").catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, mode);
      navigate("/extension", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-view">
      <div className="login-card">
        <p className="eyebrow">CAST — ConnectWise Augmentation Suite</p>
        <h1>Sign in</h1>

        <form onSubmit={submit} className="login-form">
          <label>
            {mode === "ad" ? "Domain \\ Username" : "Username"}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={mode === "ad" ? "TRITON\\jsmith" : "username"}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>

          {mode === "ad" ? (
            <p className="hint">Access is limited to members of the <strong>CAST Users</strong> security group.</p>
          ) : (
            <p className="hint">Local accounts are a fallback for when Active Directory is unavailable — not a general-purpose login.</p>
          )}

          {error && <p className="error">{error}</p>}

          <button type="submit" className={mode === "ad" ? "btn-primary" : "btn-secondary"} disabled={busy}>
            {busy ? "Signing in…" : mode === "ad" ? "Sign in with Active Directory" : "Sign in with local account"}
          </button>
        </form>

        <button
          type="button"
          className="link"
          onClick={() => { setMode(mode === "ad" ? "local" : "ad"); setError(null); }}
        >
          {mode === "ad" ? "Trouble signing in? Use a local account" : "Back to Active Directory sign-in"}
        </button>
      </div>

      <style>{loginCss}</style>
    </div>
  );
}

const loginCss = `
  .login-view { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(175deg, #0a2e52, #081d36); }
  .login-card { width: 100%; max-width: 380px; background: #0d3157; border: 1px solid rgba(255,255,255,0.09); border-radius: var(--radius-lg); padding: 32px 24px 24px; color: #eef4fa; }
  .login-card .eyebrow { font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #8fb4d6; }
  .login-card h1 { font-size: 1.75rem; margin: 8px 0 24px; }
  .login-form { display: flex; flex-direction: column; gap: 12px; }
  .login-form label { display: flex; flex-direction: column; gap: 6px; font-size: 0.75rem; color: #b8cbe0; font-weight: 600; }
  .login-form input { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.16); border-radius: var(--radius-sm); padding: 10px 12px; color: #f4f8fc; font: inherit; }
  .hint { font-size: 0.6875rem; color: #9fb8d1; }
  .hint strong { color: #d7e7f5; }
  .error { background: rgba(240,119,108,0.14); border: 1px solid rgba(240,119,108,0.4); color: #ffd9d4; padding: 10px 12px; border-radius: var(--radius-sm); font-size: 0.75rem; }
  .login-form .btn-primary { margin-top: 8px; background: #1a8aa3; color: #fff; }
  .login-form .btn-secondary { margin-top: 8px; color: #eef4fa; border-color: rgba(255,255,255,0.24); }
  .link { display: block; margin: 20px auto 0; background: none; border: none; color: #8fb4d6; font: inherit; font-weight: 600; font-size: 0.75rem; cursor: pointer; }
  .link:hover { text-decoration: underline; }
`;
