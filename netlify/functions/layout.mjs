// Disposition commune de la salle : lue et enregistrée par toute personne qui a le lien.
// Stockage : Netlify Blobs (aucune configuration à faire sur Netlify).
import { getStore } from "@netlify/blobs";

const MAX_HISTORY = 30;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const num = (v) => typeof v === "number" && Number.isFinite(v);
function isValidLayout(l) {
  if (!l || typeof l !== "object") return false;
  if (!l.room || !["L", "D", "H", "sw", "sd"].every((k) => num(l.room[k]))) return false;
  if (!l.table || !["w", "d", "h", "seats"].every((k) => num(+l.table[k]))) return false;
  if (!Array.isArray(l.tables) || l.tables.length > 300) return false;
  return l.tables.every(
    (t) => t && num(t.x) && num(t.y) && num(t.r) && (t.pc === undefined || ["tour", "aio", "none"].includes(t.pc))
  );
}

export default async (req) => {
  const store = getStore({ name: "salle-info", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("history")) {
      const h = (await store.get("history", { type: "json" })) || [];
      return json(h.map((e) => ({ version: e.version, savedAt: e.savedAt, tables: e.layout.tables.length })));
    }
    if (url.searchParams.has("version")) {
      const v = Number(url.searchParams.get("version"));
      const h = (await store.get("history", { type: "json" })) || [];
      const entry = h.find((e) => e.version === v);
      return entry ? json(entry) : json({ error: "Version introuvable" }, 404);
    }
    const cur = await store.get("current", { type: "json" });
    return json(cur || { version: 0, savedAt: null, layout: null });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > 200_000) return json({ error: "Disposition trop volumineuse" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Données illisibles" }, 400); }
    if (!isValidLayout(body.layout)) return json({ error: "Disposition invalide" }, 400);

    const cur = await store.getWithMetadata("current", { type: "json" });
    const curData = cur?.data || { version: 0, savedAt: null, layout: null };
    // Quelqu'un a enregistré entre-temps : on renvoie sa version au lieu d'écraser.
    if (body.baseVersion !== curData.version) return json(curData, 409);

    const next = { version: curData.version + 1, savedAt: new Date().toISOString(), layout: body.layout };
    const res = cur
      ? await store.setJSON("current", next, { onlyIfMatch: cur.etag })
      : await store.setJSON("current", next, { onlyIfNew: true });
    if (!res.modified) {
      const latest = await store.get("current", { type: "json" });
      return json(latest || curData, 409);
    }

    const h = (await store.get("history", { type: "json" })) || [];
    h.unshift(next);
    await store.setJSON("history", h.slice(0, MAX_HISTORY));
    return json({ version: next.version, savedAt: next.savedAt });
  }

  return json({ error: "Méthode non autorisée" }, 405);
};

export const config = { path: "/api/layout" };
