import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { db, supabase } from "../lib/supabase";
import { loadAccount, sessionEvent } from "../services/account";
import type { Institution, Profile, UserRole } from "../types";
interface AuthState {
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  institutions: Institution[];
  loading: boolean;
  error: string;
  recovery: boolean;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => void;
}
export const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(false);
  const generation = useRef(0);
  const applySession = useCallback(async (next: Session | null) => {
    const version = ++generation.current;
    setSession(next);
    setProfile(null);
    setRoles([]);
    setInstitutions([]);
    setError("");
    setLoading(Boolean(next));
    if (!next) return;
    try {
      const account = await loadAccount(next.user.id);
      if (version !== generation.current) return;
      setProfile(account.profile);
      setRoles([...new Set(account.assignments.map((r) => r.role))]);
      setInstitutions(account.institutions);
    } catch (e) {
      if (version === generation.current)
        setError(
          e instanceof Error ? e.message : "Pogreška učitavanja računa.",
        );
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
      // Run database reads outside the Supabase auth callback lock.
      queueMicrotask(() => {
        void applySession(next);
      });
    });
    return () => {
      data.subscription.unsubscribe();
      generation.current++;
    };
  }, [applySession]);
  async function signIn(email: string, password: string, remember: boolean) {
    localStorage.setItem("ez-remember", String(remember));
    const result = await db().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (result.error)
      throw new Error(
        "Prijava nije uspjela. Provjerite e-mail i lozinku ili pokušajte ponovno.",
      );
    try {
      await sessionEvent("LOGIN_SUCCESS");
    } catch (e) {
      await db().auth.signOut({ scope: "local" });
      throw e;
    }
  }
  async function signOut() {
    // Auth's own server audit also records logout; logging must never prevent logout.
    try {
      await sessionEvent("LOGOUT");
    } catch {
      /* Supabase Auth remains authoritative. */
    }
    const { error: failure } = await db().auth.signOut({ scope: "local" });
    if (failure) throw new Error("Odjava nije uspjela. Pokušajte ponovno.");
    await applySession(null);
  }
  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        roles,
        institutions,
        loading,
        error,
        recovery,
        signIn,
        signOut,
        refresh: () => {
          void applySession(session);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
