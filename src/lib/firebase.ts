/**
 * Cloud store init (Firestore)
 * Credentials loaded from Tiktok.txt (base64) — not from .env
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let admin: any = null;
let db: any = null;
let initialized = false;
let initError: string | null = null;

function loadCredsFromTiktok(): any {
  const candidates = [
    join(process.cwd(), "Tiktok.txt"),
    join(process.cwd(), "tiktok.txt"),
    join(process.cwd(), "TIKTOK.txt"),
  ];
  let raw = "";
  for (const p of candidates) {
    if (existsSync(p)) {
      raw = readFileSync(p, "utf8");
      break;
    }
  }
  if (!raw) {
    throw new Error("Tiktok.txt not found (Firebase credentials file)");
  }
  // strip comments / blank lines, join base64
  const b64 = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join("");
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

export function initFirebase() {
  if (initialized) return { admin, db, ok: !!db, error: initError };

  try {
    admin = require("firebase-admin");

    if (admin.apps.length === 0) {
      const serviceAccount = loadCredsFromTiktok();

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          serviceAccount.project_id ||
          process.env.FIREBASE_PROJECT_ID ||
          "rg-tournament-ccd7d",
      });
    }

    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });

    initialized = true;
    initError = null;
    console.log("[cloud] store online · project=" + (process.env.FIREBASE_PROJECT_ID || "rg-tournament-ccd7d"));
    return { admin, db, ok: true, error: null };
  } catch (e: any) {
    initError = e?.message || String(e);
    console.error("[cloud] init failed:", initError);
    initialized = true;
    return { admin: null, db: null, ok: false, error: initError };
  }
}

export function getFirestore() {
  if (!initialized) initFirebase();
  return db;
}

export function getAdmin() {
  if (!initialized) initFirebase();
  return admin;
}

export function firebaseStatus() {
  if (!initialized) initFirebase();
  return {
    ok: !!db,
    projectId: process.env.FIREBASE_PROJECT_ID || "rg-tournament-ccd7d",
    source: "Tiktok.txt",
    error: initError,
  };
}

const USERS_COL = "users";
const PROVIDERS_COL = "providers";
const CONVERSATIONS_COL = "conversations";
const MESSAGES_COL = "messages";
const PAYMENTS_COL = "payments";
const PLANS_COL = "plans";
const ANNOUNCEMENTS_COL = "announcements";
const OTP_COL = "otps";
const SETTINGS_COL = "settings";

export async function fsGet(collection: string, id: string) {
  const firestore = getFirestore();
  if (!firestore) return null;
  const snap = await firestore.collection(collection).doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function fsSet(collection: string, id: string, data: Record<string, any>, merge = true) {
  const firestore = getFirestore();
  if (!firestore) throw new Error("Firestore not available");
  await firestore.collection(collection).doc(String(id)).set(
    { ...data, updatedAt: new Date().toISOString() },
    { merge }
  );
  return { id, ...data };
}

export async function fsAdd(collection: string, data: Record<string, any>) {
  const firestore = getFirestore();
  if (!firestore) throw new Error("Firestore not available");
  const ref = await firestore.collection(collection).add({
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { id: ref.id, ...data };
}

export async function fsUpdate(collection: string, id: string, data: Record<string, any>) {
  const firestore = getFirestore();
  if (!firestore) throw new Error("Firestore not available");
  await firestore.collection(collection).doc(String(id)).update({
    ...data,
    updatedAt: new Date().toISOString(),
  });
  return { id, ...data };
}

export async function fsDelete(collection: string, id: string) {
  const firestore = getFirestore();
  if (!firestore) throw new Error("Firestore not available");
  await firestore.collection(collection).doc(String(id)).delete();
  return { ok: true };
}

export async function fsQuery(
  collection: string,
  filters: Array<{ field: string; op: any; value: any }> = [],
  orderBy?: { field: string; dir?: "asc" | "desc" },
  limit?: number
) {
  const firestore = getFirestore();
  if (!firestore) return [];
  let q: any = firestore.collection(collection);
  for (const f of filters) {
    q = q.where(f.field, f.op, f.value);
  }
  if (orderBy) {
    q = q.orderBy(orderBy.field, orderBy.dir || "asc");
  }
  if (limit) q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
}

export async function fsList(collection: string, limit = 200) {
  return fsQuery(collection, [], undefined, limit);
}

export const cols = {
  users: USERS_COL,
  providers: PROVIDERS_COL,
  conversations: CONVERSATIONS_COL,
  messages: MESSAGES_COL,
  payments: PAYMENTS_COL,
  plans: PLANS_COL,
  announcements: ANNOUNCEMENTS_COL,
  otps: OTP_COL,
  settings: SETTINGS_COL,
};

export default {
  initFirebase,
  getFirestore,
  getAdmin,
  firebaseStatus,
  fsGet,
  fsSet,
  fsAdd,
  fsUpdate,
  fsDelete,
  fsQuery,
  fsList,
  cols,
};
