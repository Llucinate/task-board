import { Redis } from "@upstash/redis";

// Хранилище: Upstash Redis из Vercel Marketplace (переменные окружения
// KV_REST_API_URL/KV_REST_API_TOKEN или UPSTASH_REDIS_REST_URL/TOKEN подставляются сами).
// Если базы нет (локальный запуск) — данные живут в памяти до перезапуска.
const hasRedis =
  (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
  (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = hasRedis ? Redis.fromEnv() : null;
const KEY = "board:notes";
const memory = new Map();

const store = {
  async all() {
    if (!redis) return [...memory.values()];
    const h = (await redis.hgetall(KEY)) || {};
    return Object.values(h).map((v) => (typeof v === "string" ? JSON.parse(v) : v));
  },
  async get(id) {
    if (!redis) return memory.get(id) || null;
    const v = await redis.hget(KEY, id);
    return v ? (typeof v === "string" ? JSON.parse(v) : v) : null;
  },
  async put(note) {
    if (!redis) return void memory.set(note.id, note);
    await redis.hset(KEY, { [note.id]: JSON.stringify(note) });
  },
  async remove(id) {
    if (!redis) return memory.delete(id);
    return (await redis.hdel(KEY, id)) > 0;
  },
};

const COLORS = ["yellow", "pink", "blue", "green", "orange"];
const MAX_NOTES = 300;
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const notes = await store.all();
      notes.sort((a, b) => b.created - a.created);
      return send(res, 200, { notes });
    }

    const body = await readBody(req);

    if (req.method === "POST") {
      const title = clean(body.title, 80);
      if (!title) return send(res, 400, { error: "Напиши, что нужно сделать" });
      if ((await store.all()).length >= MAX_NOTES)
        return send(res, 400, { error: "Доска переполнена — сними старые задачи" });
      const note = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title,
        desc: clean(body.desc, 400),
        author: clean(body.author, 30),
        color: COLORS.includes(body.color) ? body.color : "yellow",
        created: Date.now(),
        takenBy: "",
      };
      await store.put(note);
      return send(res, 201, { note });
    }

    if (req.method === "PATCH") {
      const note = await store.get(clean(body.id, 40));
      if (!note) return send(res, 404, { error: "Задачу уже сняли" });
      note.takenBy = clean(body.takenBy, 30);
      await store.put(note);
      return send(res, 200, { note });
    }

    if (req.method === "DELETE") {
      await store.remove(clean(body.id, 40));
      return send(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "Ошибка сервера" });
  }
}
