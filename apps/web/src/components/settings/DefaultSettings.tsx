import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { HardwareSelector } from "@/components/projects/HardwareSelector";
import { useUserSettings } from "@/hooks/useUserSettings";
import { IDLE_TIMEOUT_OPTIONS, type HardwareConfig } from "@/lib/api";

export function DefaultSettings() {
  const { settings, loading, error, update } = useUserSettings();
  const [hardware, setHardware] = useState<HardwareConfig | null>(null);
  const [idleTimeout, setIdleTimeout] = useState<0 | 5 | 10 | 30 | 60>(10);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Initialize state when settings load
  useEffect(() => {
    if (settings) {
      setHardware(settings.default_hardware);
      setIdleTimeout(settings.default_idle_timeout_minutes ?? 10);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!hardware) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await update({
        default_hardware: hardware,
        default_idle_timeout_minutes: idleTimeout,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Default Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure defaults for new projects. These settings will be pre-selected when creating a
          project.
        </p>
      </div>

      {/* Default Hardware Section */}
      <div className="space-y-4">
        <div>
          <h3 className="font-medium">Default Hardware</h3>
          <p className="text-sm text-muted-foreground mt-1">
            This hardware configuration will be used when creating new projects.
          </p>
        </div>
        {hardware && <HardwareSelector value={hardware} onChange={setHardware} />}
      </div>

      {/* Default Idle Timeout Section */}
      <div className="space-y-4">
        <div>
          <h3 className="font-medium">Default Idle Timeout</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Projects will automatically stop after this duration of inactivity.
          </p>
        </div>
        <select
          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={idleTimeout}
          onChange={(e) => setIdleTimeout(parseInt(e.target.value) as 0 | 5 | 10 | 30 | 60)}
        >
          {IDLE_TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4 pt-4">
        <Button onClick={handleSave} disabled={saving || !hardware}>
          {saving ? <Spinner size="sm" /> : "Save defaults"}
        </Button>
        {saveSuccess && <span className="text-sm text-green-600">Settings saved successfully</span>}
        {saveError && <span className="text-sm text-red-500">{saveError}</span>}
      </div>

      {/* Info Box */}
      <div className="border rounded-lg p-4 bg-muted/50 mt-6">
        <div className="flex items-start gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 text-muted-foreground"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <p className="text-sm text-muted-foreground">
            You can override these defaults when creating individual projects. Setting idle timeout
            to "Never" means projects will only stop when you manually stop them.
          </p>
        </div>
      </div>
    </div>
  );
}
