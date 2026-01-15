import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { UserSettings, UpdateUserSettingsInput } from "@/lib/api";

interface UseUserSettingsReturn {
  settings: UserSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (input: UpdateUserSettingsInput) => Promise<void>;
}

export function useUserSettings(): UseUserSettingsReturn {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await api.getUserSettings();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = useCallback(async (input: UpdateUserSettingsInput) => {
    const updated = await api.updateUserSettings(input);
    setSettings(updated);
  }, []);

  return {
    settings,
    loading,
    error,
    refresh,
    update,
  };
}
