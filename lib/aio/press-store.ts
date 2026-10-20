import type { GuardVerdict } from "../types";
import { EMPTY_CONTACT, type PressBrief, type PressContent, type PressImage, type PressRelease } from "./press-types";

/** aio_press_releases の行 → 画面の型 */
export const PRESS_COLUMNS = "id, title, status, brief, content, images, guard, error_message, created_at, updated_at";

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function rowToPress(r: Record<string, unknown>): PressRelease {
  const b = (r.brief ?? {}) as Partial<PressBrief>;
  const c = (r.content ?? {}) as Partial<PressContent>;
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    status: r.status === "submitted" ? "submitted" : "draft",
    brief: {
      kind: b.kind ?? "other",
      announcement: str(b.announcement),
      facts: str(b.facts),
      releaseDate: str(b.releaseDate),
      contact: { ...EMPTY_CONTACT, ...(b.contact ?? {}) },
      videos: Array.isArray(b.videos) ? b.videos : [],
      note: str(b.note),
    },
    content: {
      titleOptions: strs(c.titleOptions),
      title: str(c.title),
      subtitle: str(c.subtitle),
      lead: str(c.lead),
      bodyMd: str(c.bodyMd),
      keywords: strs(c.keywords),
      companyProfile: str(c.companyProfile),
      contactText: str(c.contactText),
      relatedLinks: Array.isArray(c.relatedLinks) ? c.relatedLinks : [],
      todo: strs(c.todo),
      videos: Array.isArray(c.videos) ? c.videos : [],
    },
    images: Array.isArray(r.images) ? (r.images as PressImage[]) : [],
    guard: (r.guard as GuardVerdict | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
