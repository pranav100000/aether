import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { ConnectedProvider } from "@/lib/api";

interface UseApiKeysReturn {
  providers: ConnectedProvider[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addKey: (provider: string, apiKey: string) => Promise<void>;
  removeKey: (provider: string) => Promise<void>;
}

export function useApiKeys(): UseApiKeysReturn {
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { providers } = await api.getApiKeys();
      setProviders(providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addKey = useCallback(async (provider: string, apiKey: string) => {
    const updated = await api.addApiKey(provider, apiKey);
    setProviders((prev) => prev.map((p) => (p.provider === provider ? updated : p)));
  }, []);

  const removeKey = useCallback(async (provider: string) => {
    await api.removeApiKey(provider);
    setProviders((prev) =>
      prev.map((p) =>
        p.provider === provider ? { ...p, connected: false, added_at: undefined } : p
      )
    );
  }, []);

  return {
    providers,
    loading,
    error,
    refresh,
    addKey,
    removeKey,
  };
}
