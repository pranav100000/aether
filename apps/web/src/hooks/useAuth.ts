import { useState, useEffect, useCallback } from "react";
import type { User, Session, Provider, UserIdentity } from "@supabase/supabase-js";
import * as Sentry from "@sentry/react";
import { supabase } from "@/lib/supabase";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      });
      // Set Sentry user context
      if (session?.user) {
        Sentry.setUser({ id: session.user.id, email: session.user.email });
      } else {
        Sentry.setUser(null);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      });
      // Update Sentry user context
      if (session?.user) {
        Sentry.setUser({ id: session.user.id, email: session.user.email });
      } else {
        Sentry.setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  const signInWithOAuth = useCallback(async (provider: Provider) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const linkIdentity = useCallback(async (provider: Provider) => {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/settings`,
      },
    });
    if (error) throw error;
    return data;
  }, []);

  const unlinkIdentity = useCallback(async (identity: UserIdentity) => {
    const { data, error } = await supabase.auth.unlinkIdentity(identity);
    if (error) throw error;
    return data;
  }, []);

  const setPassword = useCallback(async (password: string) => {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    return data;
  }, []);

  const getIdentityByProvider = useCallback(
    (provider: string): UserIdentity | undefined => {
      return state.user?.identities?.find((i) => i.provider === provider);
    },
    [state.user]
  );

  return {
    user: state.user,
    session: state.session,
    loading: state.loading,
    signIn,
    signUp,
    signInWithOAuth,
    signOut,
    getAccessToken,
    linkIdentity,
    unlinkIdentity,
    setPassword,
    getIdentityByProvider,
  };
}
