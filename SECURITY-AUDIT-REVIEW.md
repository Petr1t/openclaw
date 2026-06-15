# Security Re-Audit — Review of the 2026-05-29 Hardening Wave

**Date:** 2026-06-15 · **Branch:** `claude/security-audit-review-0gsnrg`
**Scope:** Re-audit of the ~40 hardening commits from 2026-05-29 (numeric parsing,
download bounding, input validation), hunting for false negatives (missed sibling
surfaces) and false positives (fixes that break valid input or don't mitigate the risk).

## Verdict

- The **numeric-parsing** centralization was thorough and correct — no real false
  negatives, no regressive false positives. Automated re-sweeps over-report heavily;
  ~5 of every 6 numeric "findings" dissolve under context (downstream `maxBytes`
  bounding, `Number.isFinite` guards, pre-validation regex, `Number()`≠`parseInt`,
  signature binding, provider/operator trust).
- The one coherent gap was **download bounding applied one-sidedly**: the wave bounded
  `fal`/`tts`/`azure-speech`/`provider-http-errors` but missed sibling surfaces that
  buffer remote bodies via unbounded `response.arrayBuffer()`. All now fixed.

## A. False negatives — fixed (unbounded HTTP body reads → memory-DoS)

All routed through `readResponseWithLimit(response, maxBytes, { onOverflow })`.

| Surface                         | File                                                 | Behavior on overflow                      | Status   |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------- | -------- |
| OpenRouter video                | `extensions/openrouter/video-generation-provider.ts` | URL-only fallback (fal twin)              | ✅ fixed |
| Google video                    | `extensions/google/video-generation-provider.ts`     | fail-closed (URL embeds API key)          | ✅ fixed |
| Vydra image/audio/video         | `extensions/vydra/shared.ts` (+3 callers)            | fail-closed                               | ✅ fixed |
| Comfy output (+ cloud redirect) | `extensions/comfy/workflow-runtime.ts`               | fail-closed                               | ✅ fixed |
| Matrix global guarded-fetch     | `extensions/matrix/src/matrix/sdk/transport.ts`      | 256 MB ceiling                            | ✅ fixed |
| Pricing catalog read            | `src/gateway/model-pricing-cache.ts`                 | stream-cap at `MAX_PRICING_CATALOG_BYTES` | ✅ fixed |
| Mattermost guarded-fetch        | `extensions/mattermost/src/mattermost/client.ts`     | 256 MB ceiling                            | ✅ fixed |
| MS Teams Graph fetch            | `extensions/msteams/src/graph.ts`                    | 256 MB ceiling                            | ✅ fixed |
| Proxy-capture debug body        | `src/proxy-capture/runtime.ts`                       | 64 MB cap, recorded as capture error      | ✅ fixed |

Media providers honor `agents.defaults.mediaMaxMb` with a generous default ceiling so
legitimate large media is not rejected; the ceiling only blocks unbounded/abusive bodies.

## B. False positives (audited fixes that were wrong)

- **`2cb8ac15` signal content-length** — the commit made `readContentLength` _throw_ on
  any odd/missing header, which would abort legitimate attachments. **Already neutralized
  in the live tree** (`client-container.ts` now uses graceful `parseMediaContentLength(...)
?? undefined`). No action needed.
- **`476d0a2c` agent-core reject non-decimal** — correct for its scope (rejects
  `0x10`/`Infinity`/`NaN`, accepts all valid JSON numbers). See open decision C.

## C. Open decision (not a blind fix)

- **agent-core bool/null → number coercion** — `packages/agent-core/src/validation.ts`
  still coerces `null → 0` and `true/false → 1/0` for `number`/`integer` tool args
  (`{amount: true}` → `1`). This is standard JSON-Schema-style coercion shared across the
  codebase; forcing rejection could break legitimate model tool calls. **Decision: keep
  current behavior** (documented as intentional). Revisit only if a stricter tool-arg
  contract is desired — low risk, isolated change if so.

## D. Dismissed re-sweep noise (verified non-issues)

`kilocode:81`, `whatsapp:744`, `volcengine:150`, `xai-oauth:245`, `feishu create_time`,
`msteams:168` (downstream `saveOkMediaResponse`/`maxBytes` bound), `voice-call
webhook:514` (signature binds raw timestamp), `apns:153` (`Number()`≠`parseInt` + isFinite),
env/test-script parsers (operator/test-only, out of scope).

## Verification

- `pnpm tsgo:core` + `pnpm tsgo:extensions` clean
- New bounding tests: URL-fallback (openrouter), fail-closed (google/vydra/comfy),
  roundtrip (matrix); all existing provider tests green
- `oxlint` + `oxfmt` clean
