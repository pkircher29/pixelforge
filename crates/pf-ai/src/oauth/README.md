# `crates/pf-ai/src/oauth` — Subscription OAuth Flows

Implements officially documented subscription sign-in flows for OpenAI ("Sign in with ChatGPT") and xAI (Grok RFC 8628 device flow), plus automatic token refresh and optional API-key fallback on plan usage limits.

## Key Files

| File | Role |
|---|---|
| `mod.rs` | Shared OAuth types (`OAuthTokens`, `ImageAccess`, `PlanModel`, `RefreshConfig`), `OAuthSession` (serialized token refresh 120 s before expiry and once after HTTP 401), `Loopback` (`127.0.0.1:<ephemeral>/callback` HTTP listener), `PlanFallbackProvider` (falls back to API key only on `ai_plan_limit`), and keystore persistence (`load_tokens`, `save_tokens`, `delete_tokens` under `oauth:<provider>`). |
| `openai_siwc.rs` | OpenAI "Sign in with ChatGPT" (Authorization Code + PKCE S256 + OIDC ID-token validation, dynamic client registration, `/v1/models` plan catalog, `/v1/responses` streaming text prompt-assist and gated image generation, live image-eligibility check, and token revocation). Honors `PF_OPENAI_AUTH_BASE` and `PF_AI_BASE_URL_OPENAI`. |
| `xai_device.rs` | xAI RFC 8628 device authorization flow (`/oauth2/device/code`, polling `/oauth2/token`, `/oauth2/userinfo`, `/oauth2/revoke`) and bearer-authenticated Grok Imagine provider. Requires a client ID via `PF_XAI_OAUTH_CLIENT_ID` or Settings; honors `PF_XAI_AUTH_BASE` and `PF_AI_BASE_URL_XAI`. |
