import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Field, Input, Banner } from "../ui";
import { IconDownload } from "../ui/Icons";

export function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<"landing" | "signin">("landing");
  const [mode, setMode] = useState<"ad" | "local">("ad");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/extension", { replace: true });
  }, [user, navigate]);

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

  // ---- Secondary: configuration sign-in ----
  if (view === "signin") {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img src="/favicon.png" alt="" />
            <span className="auth-brand-name">CAST</span>
          </div>
          <p className="auth-eyebrow">Configuration sign-in</p>
          <h1 className="auth-title">Sign in</h1>

          <form onSubmit={submit} className="auth-form">
            <Field label="Username">
              {mode === "ad" ? (
                <div className="input-group">
                  <span className="input-prefix">triton\</span>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" required />
                </div>
              ) : (
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" required />
              )}
            </Field>
            <Field
              label="Password"
              hint={
                mode === "ad"
                  ? "Access is limited to members of the CAST Users security group."
                  : "Local accounts are a break-glass fallback for AD outages."
              }
            >
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
            </Field>

            {error && <Banner tone="danger">{error}</Banner>}

            <Button type="submit" variant={mode === "ad" ? "primary" : "secondary"} block disabled={busy}>
              {busy ? "Signing in…" : mode === "ad" ? "Sign in with Active Directory" : "Sign in with local account"}
            </Button>
          </form>

          <button
            type="button"
            className="auth-alt"
            onClick={() => {
              setMode(mode === "ad" ? "local" : "ad");
              setError(null);
            }}
          >
            {mode === "ad" ? "Trouble signing in? Use a local account" : "Back to Active Directory sign-in"}
          </button>
          <button type="button" className="auth-back" onClick={() => setView("landing")}>
            ← Back to download
          </button>
        </div>
      </div>
    );
  }

  // ---- Primary: download the extension ----
  return (
    <div className="landing">
      <div className="landing-inner">
        <img className="landing-logo" src="/favicon.png" alt="" />
        <h1 className="landing-title">CAST</h1>
        <p className="landing-tagline">ConnectWise Augmentation Suite for Triton</p>
        <p className="landing-desc">
          The CAST browser extension standardizes ConnectWise for your role — hiding clutter and surfacing what matters,
          automatically.
        </p>
        <a className="btn btn-primary landing-download" href="/api/extension/install.bat" download>
          <IconDownload width={18} height={18} />
          Download the CAST Browser Extension
        </a>
        <p className="landing-hint">for Chrome &amp; Edge</p>
        <ol className="landing-steps">
          <li>Download and run the installer.</li>
          <li>If prompted, click to approve.</li>
          <li>Restart your browser.</li>
        </ol>
        <button type="button" className="landing-signin" onClick={() => setView("signin")}>
          Configuration sign-in →
        </button>
      </div>
    </div>
  );
}
