import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ApiError } from "./apiResponse.js";

const DATA = join(process.cwd(), ".data");
const FILE = join(DATA, "announcements.json");
mkdirSync(DATA, { recursive: true });

export type Announcement = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: string;
};

type Store = { items: Announcement[] };

function load(): Store {
  if (!existsSync(FILE)) return { items: [] };
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Store;
  } catch {
    return { items: [] };
  }
}
function save(s: Store) {
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function listAnnouncements(activeOnly = false) {
  let rows = load().items;
  if (activeOnly) rows = rows.filter((a) => a.active);
  return rows;
}

export function createAnnouncement(title: string, body: string) {
  if (!title?.trim()) throw new ApiError(400, "bad_request", "title required");
  const s = load();
  const row: Announcement = {
    id: randomBytes(6).toString("hex"),
    title: title.trim().slice(0, 120),
    body: String(body || "").slice(0, 2000),
    active: true,
    createdAt: new Date().toISOString(),
  };
  s.items.unshift(row);
  save(s);
  return row;
}

export function setAnnouncementActive(id: string, active: boolean) {
  const s = load();
  const idx = s.items.findIndex((a) => a.id === id);
  if (idx < 0) throw new ApiError(404, "not_found", "Announcement not found");
  s.items[idx].active = active;
  save(s);
  return s.items[idx];
}
