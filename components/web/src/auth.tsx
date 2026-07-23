/**
 * Auth context. Session lives in an httpOnly cookie set by the API, so the
 * client can't read the token — it asks the API who it is via /api/auth/me,
 * which also returns the user's role + resolved permissions.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export type Role = "admin" | "operator" | "viewer";

export interface User {
  id: string;
  displayName: string;
  source: "ad" | "local";
  role: Role;
}

interface MeResponse {
  user: User;
  permissions: string[];
}

interface AuthContextValue {
  user: User | null;
  permissions: string[];
  loading: boolean;
  can: (perm: string) => boolean;
  login: (username: string, password: string, mode: "ad" | "local") => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<MeResponse>("/auth/me")
      .then((r) => {
        setUser(r.user);
        setPermissions(r.permissions);
      })
      .catch(() => {
        setUser(null);
        setPermissions([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const login: AuthContextValue["login"] = async (username, password, mode) => {
    const r = await api.post<MeResponse>("/auth/login", { username, password, mode });
    setUser(r.user);
    setPermissions(r.permissions);
  };

  const logout: AuthContextValue["logout"] = async () => {
    await api.post("/auth/logout");
    setUser(null);
    setPermissions([]);
  };

  const can = (perm: string) => permissions.includes(perm);

  return (
    <AuthContext.Provider value={{ user, permissions, loading, can, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
