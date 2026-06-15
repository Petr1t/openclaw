# OpenClaw Security Audit — Report Set

Dynamic-workflow audit of past hardening commits to find missed sibling
surfaces ("false negatives"). All findings below were fixed on branch
`claude/security-audit-dynamic-workflows-5bn5oe`.

## Honest framing (read before submitting anywhere)

None of these are remotely exploitable by an anonymous attacker. Each requires
a **malicious or compromised upstream that OpenClaw already trusts** (the AI
provider's API response, a user-configured generation endpoint, or the
provider's rate-limit JSON). They are defense-in-depth / consistency fixes that
align siblings with already-shipped hardening. Severities are **Low /
Informational**. Submitting them as high-CVSS to Intigriti/HackerOne would
misrepresent impact.

A separate hunt for genuinely external-attacker-triggerable bugs (SSRF bypass
via inbound-message URLs, path traversal on attachment filenames, webhook
signature bypass) found **nothing** — the codebase is well hardened there
(default-on SSRF guard with DNS pinning + RFC1918/loopback block, filename
sanitization via `@openclaw/fs-safe`, timing-safe webhook signature checks).

## Findings

| #   | Title                                                                  | Severity      | CVSS 3.1  | Trigger                                                                     | Fixed in               |
| --- | ---------------------------------------------------------------------- | ------------- | --------- | --------------------------------------------------------------------------- | ---------------------- |
| 1   | Unbounded generated-media downloads (google, openrouter, vydra, comfy) | Low           | 3.7       | Malicious/compromised provider response or user-configured hostile endpoint | `325a6829`, `b6fb2871` |
| 2   | MS Teams attachment `content-length` pre-check bypass                  | Informational | 0.0 (N/A) | Malicious media host (downstream stream cap still applied)                  | `1600f9b2`             |
| 3   | Codex usage rate-limit numeric parsing (Infinity/negative)             | Low           | 2.6       | Malicious Codex usage endpoint                                              | `6c33b1ff`             |

See the per-finding files for detail, repro, and remediation.

## Verification status

- `oxfmt --check`, `oxlint`, `tsgo:extensions` (prod), `tsgo:core` (prod): clean
- All touched test files pass (incl. 7 new regression tests: 4 download-cap,
  2 msteams content-length, 1 codex usage)
- Pre-existing, unrelated `tsgo:extensions:test` errors in
  `googlechat/src/targets.test.ts` and `matrix/src/matrix/sdk/transport.test.ts`
  (mock `Response` typing) are NOT touched by this branch and are out of scope.
