// Cloudflare Pages Function — SEM40 Mastermind game room (KV-backed)
// Single global room. Uses single-key aggregates (read-modify-write) so the
// host reads fresh state via get() instead of the laggy list() API.
//
// GET  /api/mastermind?action=state -> { game, players[], subs[], buzz[] }
// POST /api/mastermind  body { action, ... }
//   player:  join {name,team,pid?} -> {pid}; answer {pid,choice}; buzz {pid}
//   host (needs key): setq {key,q}; patch {key,patch}; setscores {key,scores}; reset {key}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const TTL = 21600;   // roster 6h
const RTTL = 3600;   // per-round 1h
const HOST_KEY = "sem40mc";
const TEAMS = ["GPT", "Gemini", "Claude"];

function j(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function defaultGame() {
  return { round: 0, q: null, scores: { GPT: 0, Gemini: 0, Claude: 0 } };
}
async function getJSON(kv, k, d) {
  const v = await kv.get(k);
  if (v == null) return d;
  try { return JSON.parse(v); } catch { return d; }
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const kv = env.STARTUP_VOTES;
  const url = new URL(request.url);

  if (request.method === "GET") {
    if ((url.searchParams.get("action") || "state") !== "state") return j({ error: "bad action" }, 400);
    const game = await getJSON(kv, "mm_game", defaultGame());
    const round = game.round || 0;
    const roster = await getJSON(kv, "mm_roster", {});
    const subMap = await getJSON(kv, `mm_sub:${round}`, {});
    const buzz = await getJSON(kv, `mm_bz:${round}`, []);
    return j({
      game,
      players: Object.values(roster),
      subs: Object.values(subMap),
      buzz: buzz.slice().sort((a, b) => a.ts - b.ts),
    });
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  let body;
  try { body = await request.json(); } catch { return j({ error: "bad json" }, 400); }
  const action = body.action;
  const game = await getJSON(kv, "mm_game", defaultGame());
  const round = game.round || 0;

  // ---- player actions ----
  if (action === "join") {
    const name = String(body.name || "").slice(0, 24).trim() || "Ẩn danh";
    const team = TEAMS.includes(body.team) ? body.team : "GPT";
    const pid = body.pid && /^p[a-z0-9]{4,}$/.test(body.pid) ? body.pid : "p" + Math.random().toString(36).slice(2, 9);
    const roster = await getJSON(kv, "mm_roster", {});
    roster[pid] = { pid, name, team };
    await kv.put("mm_roster", JSON.stringify(roster), { expirationTtl: TTL });
    return j({ pid, name, team });
  }
  if (action === "answer") {
    if (!game.q || !game.q.open || game.q.revealed) return j({ ok: false, reason: "closed" });
    const pid = body.pid;
    const roster = await getJSON(kv, "mm_roster", {});
    const p = roster[pid];
    if (!p) return j({ error: "not joined" }, 400);
    const choice = Number(body.choice);
    if (!(choice >= 0 && choice <= 3)) return j({ error: "bad choice" }, 400);
    const key = `mm_sub:${round}`;
    const subMap = await getJSON(kv, key, {});
    if (subMap[pid]) return j({ ok: false, reason: "already" });
    subMap[pid] = { pid, name: p.name, team: p.team, choice, ts: Date.now() };
    await kv.put(key, JSON.stringify(subMap), { expirationTtl: RTTL });
    return j({ ok: true });
  }
  if (action === "buzz") {
    if (!game.q || !game.q.buzzOpen) return j({ ok: false, reason: "closed" });
    const pid = body.pid;
    const roster = await getJSON(kv, "mm_roster", {});
    const p = roster[pid];
    if (!p) return j({ error: "not joined" }, 400);
    const key = `mm_bz:${round}`;
    const buzz = await getJSON(kv, key, []);
    if (buzz.some((b) => b.pid === pid)) return j({ ok: false, reason: "already" });
    buzz.push({ pid, name: p.name, team: p.team, ts: Date.now() });
    await kv.put(key, JSON.stringify(buzz), { expirationTtl: RTTL });
    return j({ ok: true });
  }

  // ---- host actions ----
  if (body.key !== HOST_KEY) return j({ error: "forbidden" }, 403);
  if (action === "setq") {
    const g = { ...game, round: round + 1, q: { ...body.q, open: !!body.q.open, buzzOpen: !!body.q.buzzOpen, revealed: false } };
    await kv.put("mm_game", JSON.stringify(g));
    return j({ ok: true, game: g });
  }
  if (action === "patch") {
    const g = { ...game, q: { ...(game.q || {}), ...body.patch } };
    await kv.put("mm_game", JSON.stringify(g));
    return j({ ok: true, game: g });
  }
  if (action === "setscores") {
    const s = body.scores || {};
    const g = { ...game, scores: { GPT: +s.GPT || 0, Gemini: +s.Gemini || 0, Claude: +s.Claude || 0 } };
    await kv.put("mm_game", JSON.stringify(g));
    return j({ ok: true, game: g });
  }
  if (action === "reset") {
    await kv.put("mm_game", JSON.stringify(defaultGame()));
    if (body.clearPlayers) await kv.put("mm_roster", JSON.stringify({}), { expirationTtl: TTL });
    return j({ ok: true, game: defaultGame() });
  }
  return j({ error: "bad action" }, 400);
}
