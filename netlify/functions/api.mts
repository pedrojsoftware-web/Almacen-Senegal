// API del Almacén Senegal: guarda las hojas y los usuarios en Netlify Blobs.
//
//   POST /api/login     {user: "admin"|"invitado", password}  → {token, user}
//   GET  /api/me        → usuario de la sesión
//   GET  /api/data      → todas las hojas (o {same:true} si no han cambiado desde ?v=)   [cualquier usuario]
//   POST /api/write     → aplica cambios                                                  [solo Administrador]
//   POST /api/password  {target, current, password} → cambia una contraseña              [solo Administrador]
//
// Las sesiones van en la cabecera "Authorization: Bearer <token>".
// Contraseñas iniciales (solo se usan la primera vez; luego se cambian desde la app):
//   Administrador → variable de entorno EDIT_PASSWORD
//   Invitado      → variable de entorno GUEST_PASSWORD, o "INVITADO" si no existe
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import seed from "../../data/datos-iniciales.json";

type Obj = Record<string, unknown>;
type Store = ReturnType<typeof store>;
type Role = "admin" | "invitado";
type UserRec = { salt: string; hash: string; ver: number };
type Auth = { secret: string; users: Record<Role, UserRec> };

const SHEET = "sheet/";
const AUTH_KEY = "meta/auth";
const ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
const ROLES: Role[] = ["admin", "invitado"];
const SESSION_DAYS = 180;

// Cambios de datos que se aplican una sola vez (con copia de seguridad previa).
const ONE_TIME_RESET = "2026-11-18-existencias-a-0";

const store = () => getStore({ name: "almacen", consistency: "strong" });
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(target: Obj, patch: Obj): Obj {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) deepMerge(target[k] as Obj, v);
    else target[k] = isObj(v) ? deepMerge({}, v) : v;
  }
  return target;
}

// ---------- contraseñas y sesiones ----------
function hashPw(password: string, salt = randomBytes(16).toString("hex")): UserRec {
  return { salt, hash: scryptSync(password, salt, 32).toString("hex"), ver: 1 };
}
function checkPw(password: string, rec: UserRec): boolean {
  const h = scryptSync(password, rec.salt, 32);
  return timingSafeEqual(h, Buffer.from(rec.hash, "hex"));
}
async function getAuth(st: Store): Promise<Auth | null> {
  const existing = (await st.get(AUTH_KEY, { type: "json" })) as Auth | null;
  if (existing) return existing;
  const adminPw = Netlify.env.get("EDIT_PASSWORD");
  if (!adminPw) return null;
  const fresh: Auth = {
    secret: randomBytes(32).toString("hex"),
    users: { admin: hashPw(adminPw), invitado: hashPw(Netlify.env.get("GUEST_PASSWORD") || "INVITADO") },
  };
  await st.setJSON(AUTH_KEY, fresh, { onlyIfNew: true });
  return (await st.get(AUTH_KEY, { type: "json" })) as Auth;
}
const b64 = (s: string) => Buffer.from(s).toString("base64url");
function sign(auth: Auth, payload: string) {
  return createHmac("sha256", auth.secret).update(payload).digest("base64url");
}
function makeToken(auth: Auth, u: Role) {
  const payload = b64(JSON.stringify({ u, v: auth.users[u].ver, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return payload + "." + sign(auth, payload);
}
function readToken(auth: Auth, req: Request): Role | null {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(auth, payload));
  const given = Buffer.from(sig);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const { u, v, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!ROLES.includes(u) || exp < Date.now() || auth.users[u as Role].ver !== v) return null;
    return u as Role;
  } catch { return null; }
}

// ---------- hojas ----------
async function ensureSeed(st: Store) {
  if ((await st.get("meta/seeded")) !== null) return;
  const sheets = (seed as { sheets: Record<string, Obj> }).sheets;
  for (const [id, data] of Object.entries(sheets)) await st.setJSON(SHEET + id, data, { onlyIfNew: true });
  await st.set("meta/seeded", new Date().toISOString());
}

async function readAll(st: Store) {
  const { blobs } = await st.list({ prefix: SHEET });
  const entries = await Promise.all(
    blobs.map(async (b) => [b.key.slice(SHEET.length), await st.get(b.key, { type: "json" })] as const),
  );
  const sheets: Record<string, Obj> = {};
  for (const [id, data] of entries) if (isObj(data)) sheets[id] = data;
  return sheets;
}

async function patchSheet(st: Store, key: string, patch: Obj) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await st.getWithMetadata(key, { type: "json" });
    if (!cur || !isObj(cur.data)) return false;
    const merged = deepMerge(structuredClone(cur.data), patch);
    const res = await st.setJSON(key, merged, { onlyIfMatch: cur.etag });
    if (!res || res.modified !== false) return true;
    await sleep(40 + Math.random() * 120);
  }
  throw new Error("Demasiados cambios a la vez; inténtalo de nuevo");
}

// Pone a 0 las existencias de las hojas de inventario, una sola vez, guardando antes una copia completa.
async function oneTimeReset(st: Store) {
  const marker = "meta/applied/" + ONE_TIME_RESET;
  if ((await st.get(marker)) !== null) return;
  const sheets = await readAll(st);
  await st.setJSON("backup/" + ONE_TIME_RESET, { createdAt: new Date().toISOString(), sheets }, { onlyIfNew: true });
  for (const [id, sh] of Object.entries(sheets)) {
    if (sh.kind !== "inv" || !isObj(sh.rows)) continue;
    const rows: Obj = {};
    for (const [rid, r] of Object.entries(sh.rows as Obj)) {
      if (!isObj(r) || r.x) continue;
      rows[rid] = { e: r.g ? "" : "0" };
    }
    if (Object.keys(rows).length) await patchSheet(st, SHEET + id, { rows });
  }
  await st.set(marker, new Date().toISOString());
}

async function versionOf(st: Store) {
  const { blobs } = await st.list({ prefix: SHEET });
  const sig = blobs.map((b) => `${b.key}@${b.etag}`).sort().join("|");
  return createHash("sha1").update(sig).digest("hex").slice(0, 16);
}

// ---------- rutas ----------
async function readData(req: Request, st: Store) {
  await ensureSeed(st);
  await oneTimeReset(st);
  const since = new URL(req.url).searchParams.get("v");
  const v = await versionOf(st);
  if (since && since === v) return json({ v, same: true });
  return json({ v, sheets: await readAll(st) });
}

async function writeData(req: Request, st: Store) {
  let body: { ops?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Petición no válida" }, 400); }
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length || ops.length > 50) return json({ error: "Petición no válida" }, 400);
  for (const op of ops as Obj[]) {
    const sid = String(op.sid ?? "");
    if (!ID_RE.test(sid)) return json({ error: "Hoja no válida" }, 400);
    const key = SHEET + sid;
    if (op.del === true) await st.delete(key);
    else if (isObj(op.set)) await st.setJSON(key, op.set);
    else if (isObj(op.patch)) { if (!(await patchSheet(st, key, op.patch))) return json({ error: "La hoja ya no existe" }, 404); }
    else return json({ error: "Petición no válida" }, 400);
  }
  return json({ ok: true, v: await versionOf(st) });
}

async function login(req: Request, auth: Auth) {
  let body: Obj = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const u = String(body.user ?? "") as Role;
  const pw = String(body.password ?? "");
  if (!ROLES.includes(u) || !pw || !checkPw(pw, auth.users[u])) {
    await sleep(800);
    return json({ error: "Usuario o contraseña incorrectos" }, 401);
  }
  return json({ token: makeToken(auth, u), user: u });
}

async function changePassword(req: Request, st: Store, auth: Auth) {
  let body: Obj = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const target = String(body.target ?? "") as Role;
  const current = String(body.current ?? "");
  const next = String(body.password ?? "");
  if (!ROLES.includes(target)) return json({ error: "Usuario no válido" }, 400);
  if (!checkPw(current, auth.users.admin)) { await sleep(800); return json({ error: "La contraseña actual del Administrador no es correcta" }, 403); }
  if (next.length < 6) return json({ error: "La nueva contraseña debe tener al menos 6 caracteres" }, 400);
  const rec = hashPw(next);
  rec.ver = auth.users[target].ver + 1; // cierra las sesiones abiertas con la contraseña anterior
  const updated: Auth = { ...auth, users: { ...auth.users, [target]: rec } };
  await st.setJSON(AUTH_KEY, updated);
  return json({ ok: true, token: target === "admin" ? makeToken(updated, "admin") : undefined });
}

export default async (req: Request) => {
  const path = new URL(req.url).pathname;
  try {
    const st = store();
    const auth = await getAuth(st);
    if (!auth) return json({ error: "Falta configurar EDIT_PASSWORD en Netlify" }, 503);
    if (path === "/api/login" && req.method === "POST") return await login(req, auth);

    const user = readToken(auth, req);
    if (!user) return json({ error: "Sesión caducada. Vuelve a entrar" }, 401);
    if (path === "/api/me" && req.method === "GET") return json({ user });
    if (path === "/api/data" && req.method === "GET") return await readData(req, st);

    if (user !== "admin") return json({ error: "El usuario Invitado solo puede consultar" }, 403);
    if (path === "/api/write" && req.method === "POST") return await writeData(req, st);
    if (path === "/api/password" && req.method === "POST") return await changePassword(req, st, auth);
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Error del servidor", detail: String((e as Error)?.message ?? e) }, 500);
  }
};

export const config: Config = { path: ["/api/login", "/api/me", "/api/data", "/api/write", "/api/password"] };
