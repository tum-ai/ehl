"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getSettings,
  getSettingFullValue,
  upsertSetting,
  deleteSetting,
  getEnvFallbackStatus,
} from "@/lib/actions/settings";
import { SETTING_KEYS, type AppSetting } from "@/lib/settings";
import { QUERY_LIMITS } from "@/lib/config/limits";

interface SettingConfig {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  hasExpiry: boolean;
  envFallbackKey?: string;
}

const SETTING_CONFIGS: SettingConfig[] = [
  {
    key: SETTING_KEYS.GITHUB_TOKEN,
    label: "GitHub Token",
    description:
      "Classic personal access token (repo scope) for ehl-gg. Used for repo snapshots, auto-accepting collaborator invites, and jury access.",
    placeholder: "ghp_...",
    hasExpiry: true,
    envFallbackKey: "GITHUB_TOKEN",
  },
  {
    key: SETTING_KEYS.GITHUB_ORG,
    label: "GitHub Organization",
    description:
      "GitHub org where snapshot repos are created. Default: european-hackathon-league",
    placeholder: "european-hackathon-league",
    hasExpiry: false,
    envFallbackKey: "GITHUB_ORG",
  },
  {
    key: SETTING_KEYS.OPENROUTER_API_KEY,
    label: "OpenRouter API Key",
    description:
      "API key for the multi-agent code review pipeline. OpenRouter routes to multiple LLM providers with a single key.",
    placeholder: "sk-or-v1-...",
    hasExpiry: false,
    envFallbackKey: "OPENROUTER_API_KEY",
  },
];

function getExpiryStatus(
  expiresAt: string | null
): { label: string; variant: "completed" | "upcoming" | "announced" | "default" } | null {
  if (!expiresAt) return null;

  const now = new Date();
  const expiry = new Date(expiresAt);
  const daysLeft = Math.ceil(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysLeft < 0) {
    return { label: "Expired", variant: "default" };
  }
  if (daysLeft <= 14) {
    return { label: `Expires in ${daysLeft}d`, variant: "default" };
  }
  if (daysLeft <= 60) {
    return { label: `Expires in ${daysLeft}d`, variant: "announced" };
  }
  return { label: `Expires in ${daysLeft}d`, variant: "completed" };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [envFallbacks, setEnvFallbacks] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function loadSettings() {
    const [data, fallbacks] = await Promise.all([
      getSettings(),
      getEnvFallbackStatus(),
    ]);
    setSettings(data);
    setEnvFallbacks(fallbacks);
    setLoading(false);
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function getSetting(key: string): AppSetting | undefined {
    return settings.find((s) => s.key === key);
  }

  async function startEdit(config: SettingConfig) {
    setEditing(config.key);
    // Fetch the full (unmasked) value on demand
    const fullValue = await getSettingFullValue(config.key);
    setValues((prev) => ({
      ...prev,
      [config.key]: fullValue ?? "",
    }));
    if (config.hasExpiry) {
      const existing = getSetting(config.key);
      setExpiries((prev) => ({
        ...prev,
        [config.key]: existing?.expiresAt
          ? new Date(existing.expiresAt).toISOString().split("T")[0]
          : "",
      }));
    }
  }

  function cancelEdit() {
    setEditing(null);
    setMessage(null);
  }

  async function handleSave(config: SettingConfig) {
    const value = values[config.key]?.trim();
    if (!value) {
      setMessage({ type: "error", text: "Value cannot be empty." });
      return;
    }

    setSaving(true);
    setMessage(null);

    const expiresAt = config.hasExpiry && expiries[config.key]
      ? new Date(expiries[config.key]).toISOString()
      : null;

    const result = await upsertSetting(config.key, value, expiresAt);

    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `${config.label} saved.` });
      setEditing(null);
      await loadSettings();
    }
    setSaving(false);
  }

  async function handleDelete(config: SettingConfig) {
    if (
      !confirm(
        `Remove ${config.label}? The system will fall back to environment variables if set.`
      )
    )
      return;

    setSaving(true);
    const result = await deleteSetting(config.key);
    if (result.error) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: `${config.label} removed.` });
      await loadSettings();
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div>
        <p className="ad-text-muted">Loading...</p>
      </div>
    );
  }

  // Check for any expiring/expired settings
  const warnings = SETTING_CONFIGS.filter((config) => {
    const setting = getSetting(config.key);
    if (!setting?.expiresAt) return false;
    const daysLeft = Math.ceil(
      (new Date(setting.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return daysLeft <= 30;
  });

  return (
    <div className="max-w-3xl">
      <h1 className="ad-title text-2xl">Settings</h1>
      <p className="mt-1 ad-text-secondary">
        API keys, tokens, and service configuration. Values are stored encrypted in the database.
      </p>

      {message && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "error"
              ? "ad-bg-error ad-text-error"
              : "ad-bg-success ad-text-success"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Expiry warnings */}
      {warnings.length > 0 && (
        <Card className="mt-6 ad-border-warning ad-bg-warning">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 ad-text-warning"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium ad-text-gold">Token expiry warning</p>
              <ul className="mt-1 text-sm ad-text-warning">
                {warnings.map((config) => {
                  const setting = getSetting(config.key)!;
                  const status = getExpiryStatus(setting.expiresAt);
                  return (
                    <li key={config.key}>
                      {config.label}: {status?.label}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* Settings cards */}
      <div className="mt-6 space-y-4">
        {SETTING_CONFIGS.map((config) => {
          const setting = getSetting(config.key);
          const isEditing = editing === config.key;
          const expiryStatus = setting ? getExpiryStatus(setting.expiresAt) : null;

          return (
            <Card key={config.key}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="ad-heading text-sm">
                      {config.label}
                    </h3>
                    {setting && expiryStatus && (
                      <Badge variant={expiryStatus.variant} light>
                        {expiryStatus.label}
                      </Badge>
                    )}
                    {setting && !expiryStatus && (
                      <Badge variant="completed" light>
                        Set
                      </Badge>
                    )}
                    {!setting && config.envFallbackKey && envFallbacks[config.envFallbackKey] && (
                      <Badge variant="announced" light>
                        Using env var
                      </Badge>
                    )}
                    {!setting && !(config.envFallbackKey && envFallbacks[config.envFallbackKey]) && (
                      <Badge variant="upcoming" light>
                        Not set
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs ad-text-muted">{config.description}</p>
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(config)}
                      className="text-sm ad-text-link transition-colors"
                    >
                      {setting ? "Update" : "Set"}
                    </button>
                    {setting && (
                      <button
                        onClick={() => handleDelete(config)}
                        disabled={saving}
                        className="text-sm ad-text-error hover:text-red-700 transition-colors disabled:opacity-40"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Current value (masked) */}
              {setting && !isEditing && (
                <div className="mt-3 rounded-lg ad-bg-elevated px-3 py-2">
                  <p className="font-mono text-xs ad-text-secondary">
                    {setting.value}
                  </p>
                  <p className="mt-1 text-xs ad-text-muted">
                    Last updated:{" "}
                    {new Date(setting.updatedAt).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              )}

              {/* Edit form */}
              {isEditing && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium ad-text-secondary">
                      Value
                    </label>
                    <input
                      type="text"
                      value={values[config.key] ?? ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [config.key]: e.target.value,
                        }))
                      }
                      placeholder={config.placeholder}
                      className="mt-1 w-full rounded-lg ad-border ad-bg-card px-4 py-2.5 font-mono text-sm ad-text placeholder:ad-text-muted focus:outline-none"
                      autoFocus
                    />
                  </div>

                  {config.hasExpiry && (
                    <div>
                      <label className="text-xs font-medium ad-text-secondary">
                        Expires on (optional)
                      </label>
                      <input
                        type="date"
                        value={expiries[config.key] ?? ""}
                        onChange={(e) =>
                          setExpiries((prev) => ({
                            ...prev,
                            [config.key]: e.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg ad-border ad-bg-card px-4 py-2.5 text-sm ad-text focus:outline-none"
                      />
                      <p className="mt-1 text-xs ad-text-muted">
                        A warning will appear 30 days before expiry.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSave(config)}
                      disabled={saving}
                    >
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Query Limits */}
      <Card className="mt-8">
        <h3 className="ad-heading text-sm">Query Limits</h3>
        <p className="mt-1 text-xs ad-text-muted">
          Safety caps on database queries to prevent unbounded data fetching.
          If a limit is reached, users see a warning banner. Override via
          environment variables in Vercel Dashboard (no redeploy needed).
        </p>
        <div className="mt-4 overflow-hidden rounded-lg ad-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b ad-border ad-bg-elevated">
                <th className="px-3 py-2 text-left font-semibold ad-text-muted">Query</th>
                <th className="px-3 py-2 text-right font-semibold ad-text-muted">Current</th>
                <th className="px-3 py-2 text-left font-semibold ad-text-muted">Env Variable</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(QUERY_LIMITS) as [string, number][]).map(([key, value]) => {
                const envKey = `LIMIT_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
                return (
                  <tr key={key} className="border-b ad-border last:border-0">
                    <td className="px-3 py-2 ad-text-secondary">{key}</td>
                    <td className="px-3 py-2 text-right font-mono ad-text">{value.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <code className="rounded ad-bg-elevated px-1.5 py-0.5 font-mono ad-text-secondary">
                        {envKey}
                      </code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs ad-text-muted">
          To change: Vercel Dashboard &rarr; Settings &rarr; Environment Variables &rarr; add e.g.{" "}
          <code className="rounded ad-bg-elevated px-1.5 py-0.5 font-mono">LIMIT_TEAMS=1000</code>.
          Changes apply on next function invocation.
        </p>
      </Card>

      {/* Environment fallbacks info */}
      <Card className="mt-8">
        <h3 className="ad-heading text-sm">Environment Fallbacks</h3>
        <p className="mt-1 text-xs ad-text-muted">
          If a setting is not configured above, the system falls back to
          environment variables (set during deployment). Database settings take
          priority.
        </p>
        <div className="mt-3 space-y-1.5">
          {SETTING_CONFIGS.filter((c) => c.envFallbackKey).map((config) => {
            const isSet = config.envFallbackKey ? envFallbacks[config.envFallbackKey] : false;
            return (
              <div key={config.key} className="flex items-center justify-between text-xs">
                <span className="ad-text-muted">{config.label}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded ad-bg-elevated px-2 py-0.5 font-mono ad-text-secondary">
                    {config.envFallbackKey}
                  </code>
                  <span className={`h-2 w-2 rounded-full ${isSet ? "bg-green-500" : "bg-gray-300"}`} title={isSet ? "Set" : "Not set"} />
                </div>
              </div>
            );
          })}
          {(() => {
            const anthropicSet = envFallbacks["ANTHROPIC_API_KEY"];
            return (
              <div className="flex items-center justify-between text-xs">
                <span className="ad-text-muted">AI API Key (Anthropic)</span>
                <div className="flex items-center gap-2">
                  <code className="rounded ad-bg-elevated px-2 py-0.5 font-mono ad-text-secondary">
                    ANTHROPIC_API_KEY
                  </code>
                  <span className={`h-2 w-2 rounded-full ${anthropicSet ? "bg-green-500" : "bg-gray-300"}`} title={anthropicSet ? "Set" : "Not set"} />
                </div>
              </div>
            );
          })()}
        </div>
      </Card>
    </div>
  );
}
