/**
 * Auth context. Session lives in an httpOnly cookie set by the API, so the
 * client can't read the token — it asks the API who it is via /api/auth/me.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface User {
  id: string;
  displayName: string;
  source: "ad" | "local";
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, mode: "ad" | "local") => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login: AuthContextValue["login"] = async (username, password, mode) => {
    const r = await api.post<{ user: User }>("/auth/login", { username, password, mode });
    setUser(r.user);
  };

  const logout: AuthContextValue["logout"] = async () => {
    await api.post("/auth/logout");
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
