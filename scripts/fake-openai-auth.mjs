#!/usr/bin/env node
/**
 * Fake subscription sign-in server for developing / QA-ing Pixelforge's OAuth flows
 * without a real ChatGPT or xAI account. Node >= 18, no dependencies.
 *
 *   node scripts/fake-openai-auth.mjs [--port 8791] [--auto 2500]
 *
 * Emulates, from the documented shapes in docs/ai-research.md section 5:
 *
 *   OpenAI "Sign in with ChatGPT" (point PF_OPENAI_AUTH_BASE + PF_AI_BASE_URL_OPENAI here)
 *     GET  /api/accounts/authorize      fake consent page; validates every documented
 *                                        parameter (dynamic_agent_client, S256, loopback
 *                                        /callback, scopes, resource, ext_agent_host_id)
 *                                        and auto-redirects after --auto ms
 *     POST /api/accounts/oauth/token    authorization_code (checks the PKCE verifier) and
 *                                        refresh_token (rotates); id_token carries the nonce
 *     POST /api/accounts/oauth/revoke   200
 *     GET  /v1/models                   plan catalog ({ models: [{ slug, display_name, visibility }] })
 *     POST /v1/responses                requires store:false + stream:true; streams text, or
 *                                        for the image_generation tool answers 400
 *                                        subscription_sharing_unsupported_capability (as the
 *                                        docs say) unless FAKE_SIWC_IMAGES=allow, then streams
 *                                        an image_generation_call result
 *
 *   xAI device flow (point PF_XAI_AUTH_BASE + PF_AI_BASE_URL_XAI here, and set
 *   PF_XAI_OAUTH_CLIENT_ID to any value: the fake accepts any non-empty client id)
 *     POST /oauth2/device/code          RFC 8628 device authorization
 *     GET  /device                      fake approval page (auto-approves after --auto ms)
 *     POST /oauth2/token                device_code (authorization_pending until approved)
 *                                        and refresh_token
 *     GET  /oauth2/userinfo, POST /oauth2/revoke
 *     POST /v1/images/generations|edits Grok Imagine, JSON (OAuth bearer); 403 if FAKE_XAI_IMAGES=deny
 *
 * Errors on demand: a prompt containing `!limit` gets the plan usage-limit error (429 /
 * response.failed with resets_at); FAKE_SIWC_DENY=1 makes the consent page return
 * error=access_denied; FAKE_EXPIRES_IN=30 issues short-lived tokens to exercise refresh.
 *
 * PowerShell:
 *   node scripts/fake-openai-auth.mjs
 *   $env:PF_OPENAI_AUTH_BASE="http://127.0.0.1:8791"; $env:PF_AI_BASE_URL_OPENAI="http://127.0.0.1:8791"
 *   $env:PF_XAI_AUTH_BASE="http://127.0.0.1:8791";    $env:PF_AI_BASE_URL_XAI="http://127.0.0.1:8791"
 *   $env:PF_XAI_OAUTH_CLIENT_ID="pixelforge-dev-fake"; $env:PF_KEYSTORE="file"
 *   npm run tauri dev
 */

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { drawImage, json, readBody, sleep } from "./fake-ai-draw.mjs";

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const PORT = Number(argOf("--port", process.env.PORT ?? "8791"));
const AUTO_MS = Number(argOf("--auto", process.env.FAKE_AUTO_MS ?? "2500"));
const BASE = `http://127.0.0.1:${PORT}`;
const EXPIRES_IN = Number(process.env.FAKE_EXPIRES_IN ?? "3600");
const IMAGES = process.env.FAKE_SIWC_IMAGES === "allow";
const XAI_IMAGES = process.env.FAKE_XAI_IMAGES !== "deny";
const PLAN_SCOPES = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 12) => b64url(randomBytes(n));
const jwt = (claims) => `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "fake" }))}.${b64url(JSON.stringify(claims))}.${rand(16)}`;
const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** txn id -> pending authorization. */
const txns = new Map();
/** auth code -> grant. */
const codes = new Map();
/** access token -> { kind, email, clientId, exp } */
const access = new Map();
/** refresh token -> { kind, email, clientId } */
const refresh = new Map();
/** device_code -> { userCode, approved, clientId } */
const devices = new Map();
let registrations = 0;

function issue(kind, clientId, email, extra = {}) {
  const at = `fake-${kind}-at-${rand()}`;
  const rt = `fake-${kind}-rt-${rand()}`;
  access.set(at, { kind, email, clientId, exp: now() + EXPIRES_IN });
  refresh.set(rt, { kind, email, clientId });
  return { access_token: at, refresh_token: rt, token_type: "Bearer", expires_in: EXPIRES_IN, ...extra };
}

function bearer(req) {
  const tok = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const t = access.get(tok);
  if (!t) return null;
  if (t.exp < now()) return { expired: true };
  return t;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#f6f6f6;font:14px system-ui,sans-serif;color:#111}
.card{width:380px;background:#fff;border:1px solid #ddd;border-radius:14px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:19px;margin:0 0 6px} p{color:#555;line-height:1.5;margin:8px 0} .fake{display:inline-block;font-size:11px;color:#b45309;background:#fef3c7;border-radius:6px;padding:2px 6px;margin-bottom:10px}
button{width:100%;height:40px;border-radius:20px;border:0;background:#0d0d0d;color:#fff;font-weight:600;font-size:14px;margin-top:14px;cursor:pointer}
.code{font:600 26px ui-monospace,monospace;letter-spacing:.15em;text-align:center;padding:10px;border:1px dashed #bbb;border-radius:8px;margin:12px 0}
ul{padding-left:18px;color:#444} small{color:#888}</style></head><body><div class="card">${body}</div></body></html>`;
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  return (async () => {
    for (const e of events) {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      await sleep(60);
    }
    res.end();
  })();
}

function improve(text) {
  const t = (text || "a scene").trim().replace(/\s+/g, " ");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}, cinematic lighting, rich colour, sharp focus, detailed textures, balanced composition (fake ChatGPT plan rewrite)`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  const p = url.pathname;
  try {
    if (p === "/healthz") return json(res, 200, { ok: true });

    // ------------------------------------------------------------- OpenAI SIWC
    if (req.method === "GET" && p === "/api/accounts/authorize") {
      const q = Object.fromEntries(url.searchParams);
      const problems = [];
      if (q.client_id !== "dynamic_agent_client" && !/^oaiapp_/.test(q.client_id ?? "")) problems.push("client_id must be dynamic_agent_client or an issued oaiapp_ id");
      if (q.client_id === "dynamic_agent_client" && !q.agent_name_hint) problems.push("agent_name_hint missing on first registration");
      if (!q.ext_agent_host_id) problems.push("ext_agent_host_id missing");
      if (q.response_type !== "code") problems.push("response_type must be code");
      if (!/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(q.redirect_uri ?? "")) problems.push("redirect_uri must be http://127.0.0.1:<port>/callback");
      for (const s of ["openid", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"]) if (!(q.scope ?? "").split(" ").includes(s)) problems.push(`scope ${s} missing`);
      if (q.resource !== "https://api.openai.com/v1") problems.push("resource must be https://api.openai.com/v1");
      if (q.code_challenge_method !== "S256" || !q.code_challenge) problems.push("PKCE S256 required");
      if (!q.state || !q.nonce) problems.push("state and nonce required");
      log(`SIWC authorize client_id=${q.client_id} agent=${q.agent_name_hint ?? "-"} host=${q.ext_agent_host_id ?? "-"} redirect=${q.redirect_uri} problems=${problems.length}`);
      if (problems.length) return json(res, 400, { error: "invalid_request", error_description: problems.join("; ") });
      const txn = rand();
      txns.set(txn, q);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page("Sign in with ChatGPT (fake)", `<span class="fake">FAKE — scripts/fake-openai-auth.mjs</span>
<h1>Sign in with ChatGPT</h1><p><b>${esc(q.agent_name_hint ?? "This app")}</b> wants to use your ChatGPT plan.</p>
<ul><li>Verify your name and email</li><li>Use your ChatGPT plan for eligible requests in this app</li></ul>
<p>Signed in as <b>paul@example.com</b> · ChatGPT Plus</p>
<form method="get" action="/api/accounts/approve"><input type="hidden" name="txn" value="${txn}"><button id="go" type="submit">Continue</button></form>
<small>Continuing automatically in ${(AUTO_MS / 1000).toFixed(1)} s…</small>
<script>setTimeout(()=>document.getElementById('go').click(), ${AUTO_MS});</script>`));
    }
    if (req.method === "GET" && p === "/api/accounts/approve") {
      const q = txns.get(url.searchParams.get("txn") ?? "");
      if (!q) return json(res, 400, { error: "invalid_request", error_description: "unknown transaction" });
      txns.delete(url.searchParams.get("txn"));
      const to = new URL(q.redirect_uri);
      if (process.env.FAKE_SIWC_DENY === "1") {
        to.searchParams.set("error", "access_denied");
        to.searchParams.set("state", q.state);
      } else {
        const clientId = q.client_id === "dynamic_agent_client" ? `oaiapp_fake${++registrations}` : q.client_id;
        const code = `code-${rand()}`;
        codes.set(code, { challenge: q.code_challenge, nonce: q.nonce, clientId, redirectUri: q.redirect_uri });
        to.searchParams.set("code", code);
        to.searchParams.set("scope", PLAN_SCOPES);
        to.searchParams.set("state", q.state);
        to.searchParams.set("client_id", clientId);
      }
      log(`SIWC redirect -> ${to.origin}${to.pathname}`);
      res.writeHead(302, { location: to.toString() });
      return res.end();
    }
    if (req.method === "POST" && (p === "/api/accounts/oauth/token" || p === "/oauth2/token")) {
      const f = Object.fromEntries(new URLSearchParams((await readBody(req)).toString("utf8")));
      if (f.grant_type === "authorization_code") {
        const g = codes.get(f.code);
        if (!g) return json(res, 400, { error: "invalid_grant", error_description: "unknown or used code" });
        codes.delete(f.code);
        const challenge = b64url(createHash("sha256").update(f.code_verifier ?? "").digest());
        if (challenge !== g.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verifier does not match" });
        if (f.redirect_uri !== g.redirectUri) return json(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        if (f.client_id !== g.clientId) return json(res, 400, { error: "invalid_client" });
        if (f.resource !== "https://api.openai.com/v1") return json(res, 400, { error: "invalid_target" });
        const id_token = jwt({ iss: BASE, aud: g.clientId, sub: "user-fake-1", email: "paul@example.com", email_verified: true, nonce: g.nonce, iat: now(), exp: now() + 3600 });
        log(`SIWC token exchange OK client_id=${g.clientId}`);
        return json(res, 200, issue("siwc", g.clientId, "paul@example.com", { id_token, scope: PLAN_SCOPES }));
      }
      if (f.grant_type === "refresh_token") {
        const r = refresh.get(f.refresh_token);
        if (!r) return json(res, 400, { error: "invalid_grant", error_description: "refresh token unknown or reused" });
        refresh.delete(f.refresh_token);
        log(`${r.kind} refresh OK (rotated)`);
        return json(res, 200, issue(r.kind, r.clientId, r.email));
      }
      if (f.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
        const d = devices.get(f.device_code);
        if (!d) return json(res, 400, { error: "expired_token" });
        if (d.clientId !== f.client_id) return json(res, 400, { error: "invalid_client" });
        if (!d.approved) return json(res, 400, { error: "authorization_pending" });
        devices.delete(f.device_code);
        const id_token = jwt({ iss: BASE, aud: d.clientId, sub: "xai-user-1", email: "paul@example.com", iat: now(), exp: now() + 3600 });
        log(`xAI device flow approved client_id=${d.clientId}`);
        return json(res, 200, issue("xai", d.clientId, "paul@example.com", { id_token, scope: "openid profile email offline_access api:access" }));
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (req.method === "POST" && (p === "/api/accounts/oauth/revoke" || p === "/oauth2/revoke")) {
      const f = Object.fromEntries(new URLSearchParams((await readBody(req)).toString("utf8")));
      refresh.delete(f.token);
      access.delete(f.token);
      log(`revoke ${p}`);
      res.writeHead(200);
      return res.end();
    }
    if (req.method === "GET" && p === "/v1/models") {
      const t = bearer(req);
      if (t?.expired) return json(res, 401, { error: { message: "token expired (fake)" } });
      if (t?.kind === "siwc") return json(res, 200, { models: [{ slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list" }, { slug: "gpt-5.5-mini", display_name: "GPT-5.5 mini", visibility: "list" }, { slug: "internal-eval", display_name: "Internal", visibility: "hide" }] });
      if (t) return json(res, 200, { object: "list", data: [{ id: "grok-imagine-image-2.0" }] });
      return json(res, 200, { object: "list", data: [{ id: "gpt-image-2.5-flare" }] });
    }
    if (req.method === "POST" && p === "/v1/responses") {
      const t = bearer(req);
      if (!t || t.kind !== "siwc") return json(res, 401, { error: { message: "missing or unknown plan token (fake)", code: "subscription_sharing_invalid_user" } });
      if (t.expired) return json(res, 401, { error: { message: "token expired (fake)" } });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (body.store !== false || body.stream !== true) return json(res, 400, { error: { code: "invalid_request_error", message: "plan usage requires store:false and stream:true" } });
      for (const k of ["temperature", "max_output_tokens", "top_p", "user", "metadata"]) if (k in body) return json(res, 400, { error: { code: "invalid_request_error", message: `${k} is not supported with ChatGPT plan usage` } });
      const content = body.input?.[0]?.content ?? [];
      const text = content.find((c) => c.type === "input_text")?.text ?? "";
      const wantsImage = (body.tools ?? []).some((x) => x.type === "image_generation");
      log(`SIWC responses model=${body.model} image_tool=${wantsImage} text="${text.slice(0, 50)}"`);
      if (/!limit/.test(text)) return json(res, 429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Weekly limit for this app reached (fake)", resets_at: now() + 5 * 3600 } });
      if (wantsImage && !IMAGES) return json(res, 400, { error: { code: "subscription_sharing_unsupported_capability", message: "Image generation is not available with ChatGPT plan usage (fake, matching OpenAI's preview limitations)" } });
      await sleep(400);
      if (wantsImage) {
        const tool = body.tools.find((x) => x.type === "image_generation");
        const m = /^(\d+)x(\d+)$/.exec(tool.size ?? "");
        const [w, h] = m ? [Math.min(1536, Number(m[1])), Math.min(1536, Number(m[2]))] : [768, 768];
        const png = drawImage({ width: w, height: h, provider: "chatgpt", prompt: `[plan] ${text}`, mode: tool.action === "edit" ? (tool.input_image_mask ? "mask" : "edit") : "gen" }).toString("base64");
        const item = { id: "ig_fake", type: "image_generation_call", status: "completed", revised_prompt: `(fake plan) ${text}`, result: png };
        return sse(res, [
          { type: "response.created", response: { id: "resp_fake", status: "in_progress" } },
          { type: "response.image_generation_call.in_progress", item_id: "ig_fake", output_index: 0 },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: "resp_fake", status: "completed", output: [item] } },
        ]);
      }
      const out = improve(text);
      const words = out.split(" ");
      return sse(res, [
        { type: "response.created", response: { id: "resp_fake", status: "in_progress" } },
        ...words.map((w, i) => ({ type: "response.output_text.delta", item_id: "msg_fake", delta: (i ? " " : "") + w })),
        { type: "response.output_text.done", item_id: "msg_fake", text: out },
        { type: "response.completed", response: { id: "resp_fake", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: out }] }] } },
      ]);
    }

    // ------------------------------------------------------------- xAI device flow
    if (req.method === "POST" && p === "/oauth2/device/code") {
      const f = Object.fromEntries(new URLSearchParams((await readBody(req)).toString("utf8")));
      if (!f.client_id) return json(res, 400, { error: "invalid_client", error_description: "client_id required" });
      const device_code = `dev-${rand()}`;
      const user_code = `${rand(3).toUpperCase().replace(/[^A-Z]/g, "X").slice(0, 4)}-${rand(3).toUpperCase().replace(/[^A-Z]/g, "Y").slice(0, 4)}`;
      devices.set(device_code, { userCode: user_code, approved: false, clientId: f.client_id });
      log(`xAI device code client_id=${f.client_id} scope="${f.scope}" user_code=${user_code}`);
      return json(res, 200, { device_code, user_code, verification_uri: `${BASE}/device`, verification_uri_complete: `${BASE}/device?user_code=${user_code}`, expires_in: 600, interval: 2 });
    }
    if (req.method === "GET" && p === "/device") {
      const code = url.searchParams.get("user_code") ?? "";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page("Approve device (fake xAI)", `<span class="fake">FAKE — scripts/fake-openai-auth.mjs</span>
<h1>Connect to Grok</h1><p>Confirm this code matches the one shown in the app:</p><div class="code">${esc(code || "—")}</div>
<p>Signed in as <b>paul@example.com</b> · SuperGrok</p>
<form method="post" action="/device/approve"><input type="hidden" name="user_code" value="${esc(code)}"><button id="go" type="submit">Approve</button></form>
<small>Approving automatically in ${(AUTO_MS / 1000).toFixed(1)} s…</small><script>setTimeout(()=>document.getElementById('go').click(), ${AUTO_MS});</script>`));
    }
    if (req.method === "POST" && p === "/device/approve") {
      const f = Object.fromEntries(new URLSearchParams((await readBody(req)).toString("utf8")));
      let ok = false;
      for (const d of devices.values()) if (d.userCode === f.user_code) ok = d.approved = true;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(page("Approved", ok ? "<h1>Device approved</h1><p>You can close this tab and return to Pixelforge.</p>" : "<h1>Unknown code</h1>"));
    }
    if (req.method === "GET" && p === "/oauth2/userinfo") {
      const t = bearer(req);
      return t ? json(res, 200, { sub: "xai-user-1", email: t.email }) : json(res, 401, { error: "invalid_token" });
    }
    if (req.method === "POST" && (p === "/v1/images/generations" || p === "/v1/images/edits")) {
      const t = bearer(req);
      const auth = req.headers.authorization ?? "";
      if (!t && !/^Bearer\s+\S+/.test(auth)) return json(res, 401, { error: "missing credentials" });
      if (t?.expired) return json(res, 401, { error: "token expired (fake)" });
      const j = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (t?.kind === "xai" && !XAI_IMAGES) return json(res, 403, { error: "This account is not allowed to use OAuth tokens for Grok Imagine (fake)" });
      if (/!limit/.test(j.prompt ?? "")) return json(res, 429, { error: "Daily image limit reached for this subscription (fake)" }, { "retry-after": "3600" });
      log(`${p} bearer=${t ? t.kind : "api-key"} model=${j.model} prompt="${(j.prompt ?? "").slice(0, 50)}"`);
      await sleep(500);
      const png = drawImage({ width: 768, height: 768, provider: t?.kind === "xai" || j.aspect_ratio ? "grok" : "chatgpt", prompt: `${t ? "[sub] " : ""}${j.prompt ?? ""}`, mode: p.endsWith("edits") ? "edit" : "gen" }).toString("base64");
      return json(res, 200, { data: [{ b64_json: png, revised_prompt: `(fake) ${j.prompt}`, mime_type: "image/png" }], model: j.model, usage: { input_tokens: 20, output_tokens: 1000 } });
    }

    json(res, 404, { error: { message: `no route for ${req.method} ${p}` } });
  } catch (e) {
    console.error(p, e);
    json(res, 500, { error: { message: String(e) } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`fake-openai-auth listening on ${BASE} (auto ${AUTO_MS} ms, SIWC images ${IMAGES ? "ALLOWED" : "refused as documented"}, xAI images ${XAI_IMAGES ? "allowed" : "denied"})`);
  log(`set PF_OPENAI_AUTH_BASE, PF_AI_BASE_URL_OPENAI, PF_XAI_AUTH_BASE, PF_AI_BASE_URL_XAI to ${BASE}; PF_XAI_OAUTH_CLIENT_ID to any value`);
});
