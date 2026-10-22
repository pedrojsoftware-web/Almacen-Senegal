// API del Almacén Senegal: guarda las hojas en Netlify Blobs.
//   GET  /api/data   → todas las hojas (o {same:true} si no han cambiado desde ?v=)
//   POST /api/login  → comprueba la contraseña de editor
//   POST /api/write  → aplica cambios (cabecera x-edit-key con la contraseña)
// La contraseña se configura en Netlify como variable de entorno EDIT_PASSWORD.
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import seed from "../../data/datos-iniciales.json";

type Obj = Record<string, unknown>;
const SHEET = "sheet/";
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;

const store = () => getStore({ name: "almacen", consistency: "strong" });
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(target: Obj, patch: Obj): Obj {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k] as Obj, v);
    else target[k] = isObj(v) ? deepMerge({}, v) : v;
  }
  return target;
}

const sha = (s: string) => createHash("sha256").update(s).digest();
function passwordOk(given: string | null): boolean {
  const real = Netlify.env.get("EDIT_PASSWORD");
  if (!real || !given) return false;
  return timingSafeEqual(sha(given), sha(real));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Carga los datos del Excel la primera vez que se usa la app.
async function ensureSeed(st: ReturnType<typeof store>) {
  if ((await st.get("meta/seeded")) !== null) return;
  const sheets = (seed as { sheets: Record<string, Obj> }).sheets;
  for (const [id, data] of Object.entries(sheets)) {
    await st.setJSON(SHEET + id, data, { onlyIfNew: true });
  }
  await st.set("meta/seeded", new Date().toISOString());
}

async function versionOf(st: ReturnType<typeof store>) {
  const { blobs } = await st.list({ prefix: SHEET });
  const sig = blobs.map((b) => `${b.key}@${b.etag}`).sort().join("|");
  return { keys: blobs.map((b) => b.key), v: createHash("sha1").update(sig).digest("hex").slice(0, 16) };
}

async function readData(req: Request) {
  const st = store();
  await ensureSeed(st);
  const since = new URL(req.url).searchParams.get("v");
  const { keys, v } = await versionOf(st);
  if (since && since === v) return json({ v, same: true });
  const entries = await Promise.all(
    keys.map(async (k) => [k.slice(SHEET.length), await st.get(k, { type: "json" })] as const),
  );
  const sheets: Obj = {};
  for (const [id, data] of entries) if (data) sheets[id] = data;
  return json({ v, sheets });
}

async function patchSheet(st: ReturnType<typeof store>, key: string, patch: Obj) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await st.getWithMetadata(key, { type: "json" });
    if (!cur || !isObj(cur.data)) return false; // la hoja ya no existe
    const merged = deepMerge(structuredClone(cur.data), patch);
    const res = await st.setJSON(key, merged, { onlyIfMatch: cur.etag });
    if (!res || res.modified !== false) return true;
    await sleep(40 + Math.random() * 120); // otra persona guardó a la vez: reintentar sobre su versión
  }
  throw new Error("Demasiados cambios a la vez; inténtalo de nuevo");
}

async function writeData(req: Request) {
  if (!Netlify.env.get("EDIT_PASSWORD")) return json({ error: "Falta configurar EDIT_PASSWORD en Netlify" }, 503);
  if (!passwordOk(req.headers.get("x-edit-key"))) { await sleep(600); return json({ error: "Contraseña incorrecta" }, 401); }
  let body: { ops?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Petición no válida" }, 400); }
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length || ops.length > 50) return json({ error: "Petición no válida" }, 400);
  const st = store();
  for (const op of ops as Obj[]) {
    const sid = String(op.sid ?? "");
    if (!ID_RE.test(sid)) return json({ error: "Hoja no válida" }, 400);
    const key = SHEET + sid;
    if (op.del === true) await st.delete(key);
    else if (isObj(op.set)) await st.setJSON(key, op.set);
    else if (isObj(op.patch)) { if (!(await patchSheet(st, key, op.patch))) return json({ error: "La hoja ya no existe" }, 404); }
    else return json({ error: "Petición no válida" }, 400);
  }
  const { v } = await versionOf(st);
  return json({ ok: true, v });
}

async function login(req: Request) {
  if (!Netlify.env.get("EDIT_PASSWORD")) return json({ error: "Falta configurar EDIT_PASSWORD en Netlify" }, 503);
  let pw = "";
  try { pw = String((await req.json()).password ?? ""); } catch { /* vacío */ }
  if (passwordOk(pw)) return json({ ok: true });
  await sleep(800);
  return json({ error: "Contraseña incorrecta" }, 401);
}

export default async (req: Request) => {
  const path = new URL(req.url).pathname;
  try {
    if (path === "/api/data" && req.method === "GET") return await readData(req);
    if (path === "/api/write" && req.method === "POST") return await writeData(req);
    if (path === "/api/login" && req.method === "POST") return await login(req);
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Error del servidor", detail: String((e as Error)?.message ?? e) }, 500);
  }
};

export const config: Config = { path: ["/api/data", "/api/write", "/api/login"] };
