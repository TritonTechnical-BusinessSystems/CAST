import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Button, Field, Input, Banner } from "../ui";

/**
 * Blocks the entire app until a pending local-account password change is
 * resolved (INIT-0036) — reached only when `user.mustChangePassword` is
 * true, either because the account was just reset (break-glass recovery:
 * "let me log in with no password and prompt me to set a new one") or was
 * freshly seeded and never had a real password chosen. Every other route is
 * 403'd server-side while this is pending (`middleware/auth.ts`), so this
 * screen isn't just a UI nicety — it's the only door through.
 */
export function SetNewPassword() {
  const { user, changePassword, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("New password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await changePassword(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set new password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/favicon.png" alt="" />
          <span className="auth-brand-name">CAST</span>
        </div>
        <p className="auth-eyebrow">{user?.id}</p>
        <h1 className="auth-title">Set a new password</h1>
        <p className="muted text-sm">This account needs a new password before you can continue.</p>

        <form onSubmit={submit} className="auth-form">
          <Field label="New password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" required />
          </Field>

          {error && <Banner tone="danger">{error}</Banner>}

          <Button type="submit" variant="primary" block disabled={busy}>
            {busy ? "Saving…" : "Set new password"}
          </Button>
        </form>

        <button type="button" className="auth-alt" onClick={() => logout()}>
          Sign out instead
        </button>
      </div>
    </div>
  );
}
