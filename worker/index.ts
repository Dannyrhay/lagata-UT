/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type TournamentPayload = { tournament?: unknown };
const tournamentSchema = `CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY NOT NULL, edit_token_hash TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`;

async function hashToken(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validTournament(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const tournament = value as { name?: unknown; players?: unknown; matches?: unknown };
  return typeof tournament.name === "string" && Array.isArray(tournament.players) && Array.isArray(tournament.matches);
}

async function handleTournamentApi(request: Request, db: D1Database) {
  await db.prepare(tournamentSchema).run();
  const id = new URL(request.url).searchParams.get("id");
  if (request.method === "GET") {
    if (!id) return Response.json({ error: "Missing tournament id" }, { status: 400 });
    const row = await db.prepare("SELECT data, updated_at FROM tournaments WHERE id = ?").bind(id).first<{ data: string; updated_at: string }>();
    if (!row) return Response.json({ error: "Tournament not found" }, { status: 404 });
    return Response.json({ tournament: JSON.parse(row.data), updatedAt: row.updated_at }, { headers: { "cache-control": "no-store" } });
  }
  const body = await request.json() as TournamentPayload;
  if (!validTournament(body.tournament)) return Response.json({ error: "Invalid tournament" }, { status: 400 });
  const data = JSON.stringify(body.tournament);
  if (data.length > 200000) return Response.json({ error: "Tournament is too large" }, { status: 413 });
  if (request.method === "POST") {
    const tournamentId = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const editToken = crypto.randomUUID() + crypto.randomUUID();
    await db.prepare("INSERT INTO tournaments (id, edit_token_hash, data) VALUES (?, ?, ?)").bind(tournamentId, await hashToken(editToken), data).run();
    return Response.json({ id: tournamentId, editToken }, { status: 201 });
  }
  if (request.method === "PUT") {
    const token = request.headers.get("x-edit-token") || "";
    if (!id || !token) return Response.json({ error: "Not authorized" }, { status: 401 });
    const stored = await db.prepare("SELECT edit_token_hash FROM tournaments WHERE id = ?").bind(id).first<{ edit_token_hash: string }>();
    if (!stored || stored.edit_token_hash !== await hashToken(token)) return Response.json({ error: "Not authorized" }, { status: 403 });
    await db.prepare("UPDATE tournaments SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(data, id).run();
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST, PUT" } });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/tournament") {
      return handleTournamentApi(request, env.DB);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
