// Cloudflare Pages Function — SEM40 Mastermind game room (KV-backed)
// Single global room. Host controls; players join via QR, answer + buzz.
//
// GET  /api/mastermind?action=state  -> { game, players[], subs[], buzz[] }
// POST /api/mastermind  body { action, ... }
//   player:  join {name,team} -> {pid}; answer {pid,choice}; buzz {pid}
//   host (needs key): setq {key,q}; patch {key,patch}; setscores {key,scores}; reset {key,clearPlayers?}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const TTL = 21600;   // players live 6h
const RTTL = 3600;   // per-round data 1h
const HOST_KEY = "sem40mc";
const TEAMS = ["GPT", "Gemini", "Claude"];

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function defaultGame() {
  return { round: 0, q: null, scores: { GPT: 0, Gemini: 0, Claude: 0 } };
}
async function listPrefix(kv, prefix) {
  const out = [];
  let cursor, done = false;
  while (!done) {
    const r = await kv.list({ prefix, cursor });
    for (const k of r.keys) {
      const v = await kv.get(k.name);
      if (v != null) { try { out.push({ k: k.name, v: JSON.parse(v) }); } catch {} }
    }
    done = r.list_complete;
    cursor = r.cursor;
    if (out.length > 400) break;
  }
  return out;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const kv = env.STARTUP_VOTES;
  const url = new URL(request.url);

  if (request.method === "GET") {
    const action = url.searchParams.get("action") || "state";
    if (action !== "state") return j({ error: "bad action" }, 400);
    const gameRaw = await kv.get("mm_game");
    const game = gameRaw ? JSON.parse(gameRaw) : defaultGame();
    const round = game.round || 0;
    const players = (await listPrefix(kv, "mm_p:")).map((x) => x.v);
    const subs = (await listPrefix(kv, `mm_sub:${round}:`)).map((x) => x.v);
    const buzz = (await listPrefix(kv, `mm_bz:${round}:`)).map((x) => x.v).sort((a, b) => a.ts - b.ts);
    return j({ game, players, subs, buzz });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  let body;
  try { body = await request.json(); } catch { return j({ error: "bad json" }, 400); }
  const action = body.action;
  const gameRaw = await kv.get("mm_game");
  let game = gameRaw ? JSON.parse(gameRaw) : defaultGame();
  const round = game.round || 0;

  // ---- player actions (open) ----
  if (action === "join") {
    const name = String(body.name || "").slice(0, 24).trim() || "Ẩn danh";
    const team = TEAMS.includes(body.team) ? body.team : "GPT";
    const pid = body.pid && /^p[a-z0-9]{4,}$/.test(body.pid) ? body.pid : "p" + Math.random().toString(36).slice(2, 9);
    await kv.put(`mm_p:${pid}`, JSON.stringify({ pid, name, team }), { expirationTtl: TTL });
    return j({ pid, name, team });
  }
  if (action === "answer") {
    if (!game.q || !game.q.open || game.q.revealed) return j({ ok: false, reason: "closed" });
    const pid = body.pid;
    const pRaw = pid && (await kv.get(`mm_p:${pid}`));
    if (!pRaw) return j({ error: "not joined" }, 400);
    const p = JSON.parse(pRaw);
    if (await kv.get(`mm_sub:${round}:${pid}`)) return j({ ok: false, reason: "already" });
    const choice = Number(body.choice);
    if (!(choice >= 0 && choice <= 3)) return j({ error: "bad choice" }, 400);
    await kv.put(`mm_sub:${round}:${pid}`, JSON.stringify({ pid, name: p.name, team: p.team, choice, ts: Date.now() }), { expirationTtl: RTTL });
    return j({ ok: true });
  }
  if (action === "buzz") {
    if (!game.q || !game.q.buzzOpen) return j({ ok: false, reason: "closed" });
    const pid = body.pid;
    const pRaw = pid && (await kv.get(`mm_p:${pid}`));
    if (!pRaw) return j({ error: "not joined" }, 400);
    const p = JSON.parse(pRaw);
    if (await kv.get(`mm_bzx:${round}:${pid}`)) return j({ ok: false, reason: "already" });
    const ts = Date.now();
    await kv.put(`mm_bz:${round}:${ts}:${pid}`, JSON.stringify({ pid, name: p.name, team: p.team, ts }), { expirationTtl: RTTL });
    await kv.put(`mm_bzx:${round}:${pid}`, "1", { expirationTtl: RTTL });
    return j({ ok: true });
  }

  // ---- host actions (need key) ----
  if (body.key !== HOST_KEY) return j({ error: "forbidden" }, 403);
  if (action === "setq") {
    game = { ...game, round: round + 1, q: { ...body.q, open: !!body.q.open, buzzOpen: !!body.q.buzzOpen, revealed: false } };
    await kv.put("mm_game", JSON.stringify(game));
    return j({ ok: true, game });
  }
  if (action === "patch") {
    game = { ...game, q: { ...(game.q || {}), ...body.patch } };
    await kv.put("mm_game", JSON.stringify(game));
    return j({ ok: true, game });
  }
  if (action === "setscores") {
    const s = body.scores || {};
    game = { ...game, scores: { GPT: +s.GPT || 0, Gemini: +s.Gemini || 0, Claude: +s.Claude || 0 } };
    await kv.put("mm_game", JSON.stringify(game));
    return j({ ok: true, game });
  }
  if (action === "reset") {
    game = defaultGame();
    await kv.put("mm_game", JSON.stringify(game));
    if (body.clearPlayers) {
      const ps = await listPrefix(kv, "mm_p:");
      await Promise.all(ps.map((p) => kv.delete(p.k)));
    }
    return j({ ok: true, game });
  }
  return j({ error: "bad action" }, 400);
}
