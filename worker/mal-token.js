// worker/mal-token.js — Cloudflare Worker: the only piece that must not live in the extension,
// because MyAnimeList's token endpoint needs the client secret.
//
// Deploy:  wrangler deploy worker/mal-token.js --name kura-mal
// Vars:    MAL_CLIENT_ID, MAL_CLIENT_SECRET   (wrangler secret put / [vars])
// Then put https://kura-mal.<you>.workers.dev in the extension's Setup tab.
//
// Endpoints
//   POST /exchange  {code, code_verifier, redirect_uri} -> MAL token response
//   POST /refresh   {refresh_token}                     -> MAL token response
//   GET  /health    -> {ok:true}
//
// The Worker never stores anything: it forwards the request with the secret attached and
// returns MAL's JSON untouched.

const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function tokenRequest(params, env) {
  const body = new URLSearchParams({
    ...params,
    client_id: env.MAL_CLIENT_ID,
    client_secret: env.MAL_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true });
    if (!env.MAL_CLIENT_ID || !env.MAL_CLIENT_SECRET) return json({ error: 'worker is missing MAL_CLIENT_ID / MAL_CLIENT_SECRET' }, 500);

    if (request.method === 'POST' && url.pathname === '/exchange') {
      const { code, code_verifier, redirect_uri } = await request.json().catch(() => ({}));
      if (!code || !code_verifier || !redirect_uri) return json({ error: 'code, code_verifier and redirect_uri are required' }, 400);
      return tokenRequest({ grant_type: 'authorization_code', code, code_verifier, redirect_uri }, env);
    }

    if (request.method === 'POST' && url.pathname === '/refresh') {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return json({ error: 'refresh_token is required' }, 400);
      return tokenRequest({ grant_type: 'refresh_token', refresh_token }, env);
    }

    return json({ error: 'not found' }, 404);
  },
};
