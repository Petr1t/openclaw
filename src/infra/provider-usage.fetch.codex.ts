import { resolveProviderRequestHeaders } from "../agents/provider-request-config.js";
import { parseStrictFiniteNumber, parseStrictPositiveInteger } from "./parse-finite-number.js";
import {
  buildUsageHttpErrorSnapshot,
  fetchJson,
  readUsageJson,
} from "./provider-usage.fetch.shared.js";
import { clampPercent, PROVIDER_LABELS } from "./provider-usage.shared.js";
import type { ProviderUsageSnapshot, UsageWindow } from "./provider-usage.types.js";

type CodexUsageResponse = {
  rate_limit?: {
    limit_reached?: boolean;
    primary_window?: {
      limit_window_seconds?: number;
      used_percent?: number;
      reset_at?: number;
      reset_after_seconds?: number;
    };
    secondary_window?: {
      limit_window_seconds?: number;
      used_percent?: number;
      reset_at?: number;
      reset_after_seconds?: number;
    };
  };
  plan_type?: string;
  credits?: { balance?: number | string | null };
};

const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;

function resolveSecondaryWindowLabel(params: {
  windowHours: number;
  secondaryResetAt?: number;
  primaryResetAt?: number;
}): string {
  if (params.windowHours >= 168) {
    return "Week";
  }
  if (params.windowHours < 24) {
    return `${params.windowHours}h`;
  }
  // Codex occasionally reports a 24h secondary window while exposing a
  // weekly reset cadence in reset timestamps. Prefer cadence in that case.
  if (
    typeof params.secondaryResetAt === "number" &&
    typeof params.primaryResetAt === "number" &&
    params.secondaryResetAt - params.primaryResetAt >= WEEKLY_RESET_GAP_SECONDS
  ) {
    return "Week";
  }
  return "Day";
}

export async function fetchCodexUsage(
  token: string,
  accountId: string | undefined,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (accountId) {
    defaultHeaders["ChatGPT-Account-Id"] = accountId;
  }
  const headers =
    resolveProviderRequestHeaders({
      provider: "openai-codex",
      baseUrl: "https://chatgpt.com/backend-api/wham/usage",
      capability: "other",
      transport: "http",
      defaultHeaders,
    }) ?? defaultHeaders;

  const res = await fetchJson(
    "https://chatgpt.com/backend-api/wham/usage",
    { method: "GET", headers },
    timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    return buildUsageHttpErrorSnapshot({
      provider: "openai-codex",
      status: res.status,
      tokenExpiredStatuses: [401, 403],
    });
  }

  const parsed = await readUsageJson("openai-codex", res);
  if (!parsed.ok) {
    return parsed.snapshot;
  }
  const data = parsed.data as CodexUsageResponse;
  const windows: UsageWindow[] = [];

  if (data.rate_limit?.primary_window) {
    const pw = data.rate_limit.primary_window;
    // Remote JSON: reject NaN/Infinity/negative seconds before arithmetic so a
    // hostile/buggy response cannot produce an "Infinityh" label or a reset
    // timestamp that never expires.
    const windowHours = Math.round(
      (parseStrictPositiveInteger(pw.limit_window_seconds) ?? 10800) / 3600,
    );
    const resetAtSeconds = parseStrictPositiveInteger(pw.reset_at);
    windows.push({
      label: `${windowHours}h`,
      usedPercent: clampPercent(pw.used_percent || 0),
      resetAt: resetAtSeconds !== undefined ? resetAtSeconds * 1000 : undefined,
    });
  }

  if (data.rate_limit?.secondary_window) {
    const sw = data.rate_limit.secondary_window;
    const windowHours = Math.round(
      (parseStrictPositiveInteger(sw.limit_window_seconds) ?? 86400) / 3600,
    );
    const resetAtSeconds = parseStrictPositiveInteger(sw.reset_at);
    const label = resolveSecondaryWindowLabel({
      windowHours,
      primaryResetAt: parseStrictPositiveInteger(data.rate_limit?.primary_window?.reset_at),
      secondaryResetAt: resetAtSeconds,
    });
    windows.push({
      label,
      usedPercent: clampPercent(sw.used_percent || 0),
      resetAt: resetAtSeconds !== undefined ? resetAtSeconds * 1000 : undefined,
    });
  }

  let plan = data.plan_type;
  if (data.credits?.balance !== undefined && data.credits.balance !== null) {
    const balance =
      typeof data.credits.balance === "number"
        ? data.credits.balance
        : (parseStrictFiniteNumber(data.credits.balance) ?? 0);
    plan = plan ? `${plan} ($${balance.toFixed(2)})` : `$${balance.toFixed(2)}`;
  }

  return {
    provider: "openai-codex",
    displayName: PROVIDER_LABELS["openai-codex"],
    windows,
    plan,
  };
}
