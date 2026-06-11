// Cloudflare Pages Function — Voting API
// GET  /api/votes         → { "1": 3, "2": 0, ... }
// POST /api/votes         → body: { id: "1" } → { success: true, votes: {...} }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const IDEA_IDS = ["1","2","3","4","5","6","7","8","9","10","11","12","13"];

export async function onRequest({ request, env }) {
  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const kv = env.STARTUP_VOTES;

  // GET — return all vote counts
  if (request.method === "GET") {
    const votes = {};
    await Promise.all(
      IDEA_IDS.map(async (id) => {
        const val = await kv.get(`idea_${id}`);
        votes[id] = val ? parseInt(val) : 0;
      })
    );
    return new Response(JSON.stringify(votes), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // POST — cast a vote
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { id } = body;
    if (!id || !IDEA_IDS.includes(String(id))) {
      return new Response(JSON.stringify({ error: "Invalid idea id" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const key = `idea_${id}`;
    const current = await kv.get(key);
    const newCount = (current ? parseInt(current) : 0) + 1;
    await kv.put(key, String(newCount));

    // Return all updated counts
    const votes = {};
    await Promise.all(
      IDEA_IDS.map(async (i) => {
        const val = await kv.get(`idea_${i}`);
        votes[i] = val ? parseInt(val) : 0;
      })
    );

    return new Response(JSON.stringify({ success: true, votes }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS });
}
