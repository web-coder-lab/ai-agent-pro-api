/**
 * Firebase Admin + Firestore init
 * Project: rg-tournament-ccd7d
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let admin: any = null;
let db: any = null;
let initialized = false;
let initError: string | null = null;

export function initFirebase() {
  if (initialized) return { admin, db, ok: !!db, error: initError };

  try {
    // Dynamic require so project still boots if firebase-admin not installed yet
    admin = require("firebase-admin");

    if (admin.apps.length === 0) {
      let serviceAccount: any = null;

      // 1) Prefer JSON string in env (Render-friendly, no secret file)
      const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (jsonEnv && jsonEnv.trim().startsWith("{")) {
        serviceAccount = JSON.parse(jsonEnv);
      } else {
        // 2) Fallback to file path
        const saPath =
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
          process.env.GOOGLE_APPLICATION_CREDENTIALS ||
          join(process.cwd(), "firebase-service-account.json");
        if (!existsSync(saPath)) {
          throw new Error(
            `Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or file at ${saPath}`
          );
        }
        serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          serviceAccount.project_id ||
          process.env.FIREBASE_PROJECT_ID ||
          "rg-tournament-ccd7d",
      });
    }

    db = admin.firestore();
    // Ignore undefined properties
    db.settings({ ignoreUndefinedProperties: true });

    initialized = true;
    initError = null;
    console.log("[firebase] initialized · project=rg-tournament-ccd7d");
    return { admin, db, ok: true, error: null };
  } catch (e: any) {
    initError = e?.message || String(e);
    console.error("[firebase] init failed:", initError);
    initialized = true; // don't retry forever
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
    error: initError,
  };
}

// ---------- Firestore helpers (users + generic collections) ----------

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
  filters: Array<{ field: string; op: FirebaseFirestore.WhereFilterOp; value: any }> = [],
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

// Convenience
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

export default { initFirebase, getFirestore, getAdmin, firebaseStatus, fsGet, fsSet, fsAdd, fsUpdate, fsDelete, fsQuery, fsList, cols };
