/**
 * searchSynonymService — คำพ้องค้นหาสินค้า (ย้ายมาจาก backend ฝั่งลูกค้า · customer-backend-merge.md §8.16)
 *
 * 1 เอกสาร = 1 กลุ่มคำ: คำหลัก + คำพ้อง (ไทย/อังกฤษ/ชื่อเล่น/คำที่มักพิมพ์ผิด) เช่น "ช็อกโกแลต: chocolate, ช็อค"
 *   - ลูกค้า: GET /api/catalog/search-synonyms (หน้าเว็บขยายคำค้นเอง — แบบฝั่งลูกค้า)
 *     + /api/catalog/products?search= ขยายคำค้นด้วยกลุ่มคำพ้องฝั่ง server ด้วย (กติกาเดียวกับหน้าเว็บลูกค้า synonymMatch.ts)
 *   - หลังร้าน: /api/admin/search-synonyms (สิทธิ์เมนู products) — กติกาตรวจเหมือนฝั่งลูกค้า
 * cache กลุ่มคำ 60 วินาที · แก้แล้วล้าง cache ทันที
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { normalizeText } from "../lib/search/normalize";
import searchSynonymModel from "../models/searchSynonymModel";

export interface SynonymGroup {
  term: string;
  synonyms: string[];
}

const MAX_WORD_LENGTH = 60;
const MAX_SYNONYMS = 50;
/** คำที่สั้นกว่านี้ไม่รับ — การขยายคำค้นแบบ "คำค้นมีคำนี้" คำสั้นมาก (เช่น "ชา") จะไปโดนคำค้นเกือบทุกคำ */
const MIN_WORD_LENGTH = 2;
const CACHE_TTL_MS = 60_000;

let cache: { groups: SynonymGroup[]; expiresAt: number } | null = null;
export function clearSynonymCache(): void {
  cache = null;
}

/** กลุ่มคำพ้องทั้งหมด (ข้อความดิบ ไม่ normalize) — cache 60 วิ */
export async function getSynonymGroups(): Promise<SynonymGroup[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.groups;
  await dbConnect();
  const docs = await searchSynonymModel
    .find({ deleted_at: null })
    .select("term synonyms")
    .lean<SynonymGroup[]>();
  const groups = docs.map((d) => ({ term: d.term, synonyms: d.synonyms ?? [] }));
  cache = { groups, expiresAt: Date.now() + CACHE_TTL_MS };
  return groups;
}

/** คำพ้องที่สั้นกว่านี้ไม่นำมาจับแบบ "ขึ้นต้นด้วย" (กันพิมพ์ 1 ตัวอักษรแล้วตรงทุกกลุ่ม) */
const MIN_PREFIX_LENGTH = 2;
const clean = (s: string) => s.trim().toLowerCase();

/**
 * ขยายคำค้นด้วยคำพ้อง — กติกาเดียวกับหน้าเว็บลูกค้า (src/lib/search/synonymMatch.ts):
 * คำค้นตรงกับคำในกลุ่ม (ตรงตัว / คำค้นมีคำนั้น / คำนั้นขึ้นต้นด้วยคำค้น) → ใช้ทุกคำในกลุ่มนั้นด้วย
 */
export function expandQueryWithSynonyms(query: string, groups: SynonymGroup[]): { words: string[]; groups: string[] } {
  const q = clean(query);
  if (!q) return { words: [], groups: [] };
  const words = new Set<string>([q]);
  const used: string[] = [];
  for (const g of groups) {
    const groupWords = [g.term, ...(g.synonyms ?? [])].map(clean).filter(Boolean);
    const hit = groupWords.some((w) => w === q || q.includes(w) || (q.length >= MIN_PREFIX_LENGTH && w.startsWith(q)));
    if (hit) {
      for (const w of groupWords) words.add(w);
      used.push(g.term);
    }
  }
  return { words: [...words], groups: used };
}

/** คำที่ใช้ค้นจริงของคำค้นนี้ (โหลดกลุ่มคำพ้องให้เอง) — ใช้ใน productService.listProducts */
export async function searchWordsFor(query: string): Promise<string[]> {
  return expandQueryWithSynonyms(query, await getSynonymGroups()).words;
}

// ── หลังร้าน ─────────────────────────────────────────────────
function parseBody(raw: unknown, partial: boolean): { term?: string; synonyms?: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const b = raw as Record<string, unknown>;
  const out: { term?: string; synonyms?: string[] } = {};

  if (b.term !== undefined || !partial) {
    const term = typeof b.term === "string" ? b.term.trim() : "";
    if (normalizeText(term).length < MIN_WORD_LENGTH) throw badRequest(`คำหลักต้องยาวอย่างน้อย ${MIN_WORD_LENGTH} ตัวอักษร`);
    if (term.length > MAX_WORD_LENGTH) throw badRequest(`คำหลักยาวได้ไม่เกิน ${MAX_WORD_LENGTH} ตัวอักษร`);
    out.term = term;
  }
  if (b.synonyms !== undefined || !partial) {
    if (!Array.isArray(b.synonyms ?? [])) throw badRequest("คำพ้องต้องเป็นรายการ");
    // ตัดช่องว่าง/ค่าว่าง/คำซ้ำ (เทียบแบบ normalize) และไม่ซ้ำกับคำหลัก
    const seen = new Set<string>(out.term ? [normalizeText(out.term)] : []);
    const list: string[] = [];
    for (const s of (b.synonyms as unknown[] | undefined) ?? []) {
      const v = typeof s === "string" ? s.trim() : "";
      const key = normalizeText(v);
      if (!key || seen.has(key)) continue;
      if (key.length < MIN_WORD_LENGTH) throw badRequest(`คำพ้อง "${v}" สั้นเกินไป (อย่างน้อย ${MIN_WORD_LENGTH} ตัวอักษร)`);
      if (v.length > MAX_WORD_LENGTH) throw badRequest(`คำพ้องยาวได้ไม่เกิน ${MAX_WORD_LENGTH} ตัวอักษร`);
      seen.add(key);
      list.push(v);
    }
    if (list.length > MAX_SYNONYMS) throw badRequest(`คำพ้องได้ไม่เกิน ${MAX_SYNONYMS} คำต่อกลุ่ม`);
    out.synonyms = list;
  }
  return out;
}

/** กลุ่มอื่นที่มีคำหลักเดียวกัน (เทียบแบบ normalize — ไม่สนตัวพิมพ์/วรรณยุกต์) */
async function assertNoDuplicateTerm(term: string, excludeId?: string) {
  const key = normalizeText(term);
  const docs = await searchSynonymModel
    .find({ deleted_at: null, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select("term")
    .lean<Array<{ term: string }>>();
  if (docs.some((d) => normalizeText(d.term) === key)) {
    throw conflict(`มีกลุ่มคำ "${term}" อยู่แล้ว — แก้ไขกลุ่มเดิมแทน`);
  }
}

export async function listSynonyms() {
  await dbConnect();
  return searchSynonymModel.find({ deleted_at: null }).sort({ term: 1 }).lean();
}

export async function createSynonym(raw: unknown) {
  await dbConnect();
  const body = parseBody(raw, false);
  await assertNoDuplicateTerm(body.term!);
  const doc = await searchSynonymModel.create({ term: body.term, synonyms: body.synonyms ?? [] });
  clearSynonymCache();
  return doc.toObject();
}

export async function updateSynonym(id: string, raw: unknown) {
  await dbConnect();
  assertObjectId(id);
  const body = parseBody(raw, true);
  if (body.term) await assertNoDuplicateTerm(body.term, id);
  const doc = await searchSynonymModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: body }, { returnDocument: "after", runValidators: true })
    .lean();
  if (!doc) throw notFound("ไม่พบกลุ่มคำพ้อง");
  clearSynonymCache();
  return doc;
}

export async function deleteSynonym(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await searchSynonymModel
    .findOneAndUpdate({ _id: id, deleted_at: null }, { $set: { deleted_at: new Date() } }, { returnDocument: "after" })
    .lean();
  if (!doc) throw notFound("ไม่พบกลุ่มคำพ้อง");
  clearSynonymCache();
  return doc;
}
