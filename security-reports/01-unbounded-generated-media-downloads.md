# 1 — Unbounded generated-media downloads

- **Severity:** Low
- **CVSS 3.1:** `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L` = **3.7**
- **Class:** Uncontrolled resource consumption (CWE-400) via unbounded HTTP body read
- **Components:**
  - `extensions/google/video-generation-provider.ts` (video URI download)
  - `extensions/openrouter/video-generation-provider.ts` (content endpoint)
  - `extensions/vydra/shared.ts` (shared image/audio/video downloader)
  - `extensions/comfy/workflow-runtime.ts` (output download, direct + cloud-redirect paths)
- **Fixed in:** `325a6829` (google/openrouter/vydra), `b6fb2871` (comfy)

## Summary

After requesting media generation, these providers downloaded the result with
`Buffer.from(await response.arrayBuffer())` and **no size limit**. A provider
that returns (or is coerced into returning) an oversized body forces the whole
payload into memory, which can exhaust the bot process's heap and crash it
(DoS). Sibling providers (`fal`, `tts`, `azure-speech`) were already hardened
with `readResponseWithLimit`; these four were missed.

## Preconditions / who can trigger

Not anonymously exploitable. Requires one of:

- a malicious or compromised provider API returning an oversized body, or a
  TLS MITM of the provider connection (high difficulty), **or**
- for `comfy`: a user-configured generation endpoint that is attacker-controlled
  (lower difficulty — the operator points OpenClaw at a hostile Comfy server).

## Technical detail

Vulnerable pattern (pre-fix), e.g. `extensions/google/video-generation-provider.ts`:

```ts
const buffer = Buffer.from(await response.arrayBuffer()); // no cap
```

`response.arrayBuffer()` buffers the entire body regardless of size. There is
no `content-length` validation and no downstream cap on this path (the bytes
are returned directly as the generated asset).

## Impact

Availability only. Memory exhaustion → process crash / denial of service of the
OpenClaw gateway. No confidentiality or integrity impact.

## Reproduction

1. Point the provider at an endpoint you control (trivial for `comfy`; for the
   others, simulate the provider response).
2. Have it return a multi-GB body (or a stream that never ends) for the
   generated asset.
3. Observe the bot process RSS climb until OOM.

Regression test proving the bound (post-fix): set
`agents.defaults.mediaMaxMb` to a tiny value and confirm the download now
throws `… exceeds N bytes` instead of buffering — see
`extensions/google/video-generation-provider.test.ts` and the vydra/comfy tests.

## Remediation

Route every download through `readResponseWithLimit` (already exported via
`openclaw/plugin-sdk/response-limit-runtime`) with a cap derived from
`agents.defaults.mediaMaxMb` (16 MB default), matching the `fal` pattern. The
reader streams and cancels at the cap, so memory is bounded even on overflow.
Google/OpenRouter throw on overflow (their download URLs embed API-key/auth
material and cannot be surfaced as a plain URL); `fal`-style URL fallback is
only safe for public-CDN URLs.
