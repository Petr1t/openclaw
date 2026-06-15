# 2 — MS Teams attachment `content-length` pre-check bypass

- **Severity:** Informational (no real impact)
- **CVSS 3.1:** 0.0 — N/A
- **Class:** Improper input validation (CWE-20) — defense-in-depth only
- **Component:** `extensions/msteams/src/attachments/bot-framework.ts`
  (`saveBotFrameworkAttachmentView`)
- **Fixed in:** `1600f9b2`

## Summary

The Bot Framework attachment downloader pre-checked the response
`content-length` with raw `Number()` before downloading:

```ts
const contentLength = response.headers.get("content-length");
if (contentLength && Number(contentLength) > params.maxBytes) {
  /* skip */
}
```

`Number()` accepts `"-1"`, `"1e9"`, `" 5 "` and coerces junk to `NaN`, so a
malicious media host can craft a `content-length` that slips past this early
guard. **However, the actual download (`saveResponseMedia`) still enforces
`params.maxBytes` on the stream**, so there is no real unbounded-read or
bypass — only an inconsistency with the centralized strict parser
(`parseMediaContentLength`) that sibling channels (signal, googlechat, matrix)
already use.

## Preconditions / who can trigger

A malicious media host returning a crafted `content-length`. Even then, no
security boundary is crossed because the stream is capped downstream.

## Impact

None beyond cosmetics/consistency. Listed for completeness; **not a reportable
vulnerability**.

## Remediation

Use `parseMediaContentLength` (strict `^\d+$` + `Number.isSafeInteger`) for the
pre-check and reject malformed headers, matching the sibling channels. Test:
`extensions/msteams/src/attachments/bot-framework.test.ts` (oversized valid
header is skipped; malformed `-1` is now rejected instead of proceeding).
