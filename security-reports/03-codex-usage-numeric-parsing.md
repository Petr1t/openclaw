# 3 — Codex usage rate-limit numeric parsing (Infinity/negative)

- **Severity:** Low / borderline Informational
- **CVSS 3.1:** `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N` = **2.6**
- **Class:** Improper validation of remote numeric input (CWE-20 / CWE-1284)
- **Component:** `src/infra/provider-usage.fetch.codex.ts` (`fetchCodexUsage`)
- **Fixed in:** `6c33b1ff`

## Summary

`limit_window_seconds` and `reset_at` come from the remote Codex usage JSON and
were used in arithmetic with only a falsy fallback:

```ts
const windowHours = Math.round((pw.limit_window_seconds || 10800) / 3600);
resetAt: pw.reset_at ? pw.reset_at * 1000 : undefined,
```

`JSON.parse("1e999")` yields `Infinity` (valid JSON syntax), which bypasses the
typed `number` shape. `Infinity` produces an `"Infinityh"` window label and a
`resetAt` of `Infinity` that **never compares as expired**; negative values
skew the secondary-window label cadence.

## Preconditions / who can trigger

A malicious or compromised Codex usage endpoint (or MITM). Not anonymously
exploitable.

## Impact

Integrity of displayed/derived data only: a corrupted rate-limit display and a
reset timestamp that never expires (the UI would show the limit as
permanently active). No code execution, no data exposure, no DoS.

## Reproduction

Return this body from the usage endpoint:

```json
{
  "rate_limit": {
    "primary_window": { "limit_window_seconds": 1e999, "used_percent": 35.5, "reset_at": 1e999 }
  }
}
```

Pre-fix: window label renders `"Infinityh"`, `resetAt` becomes `Infinity`.

## Remediation

Parse all four window numerics through `parseStrictPositiveInteger` (already
used in this same file for `credits.balance`), so non-finite/negative values
fall back to defaults. Test:
`src/infra/provider-usage.fetch.codex.test.ts` ("rejects non-finite or negative
remote window numerics", using the real `1e999`-via-raw-JSON vector).
