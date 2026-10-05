/**
 * storeService — ข้อมูลร้าน + โลโก้ + หน้าร้านประจำสัปดาห์ + ที่อยู่ร้าน (ย้ายมาจากฝั่งลูกค้า storeInfoController ·
 * Owner/storeProfileController · storeSettingsController · mapLinkController — customer-backend-merge.md §8.19)
 *
 *   - ข้อมูลร้านสาธารณะ (หน้า "ติดต่อเรา"): ชื่อร้าน เบอร์โทร อีเมลติดต่อ โซเชียล หน้าร้านที่เปิดแสดง ที่อยู่ + พิกัด
 *     ไม่ส่ง user_id/ชื่อพนักงาน พร้อมเพย์ หรือ field ภายใน
 *   - โลโก้: อัปโหลดผ่าน src/lib/upload.ts (โฟลเดอร์ store · รูป ≤ 5 MB jpg/png/webp/avif ตรวจลายเซ็นจริง) แล้วเก็บ URL
 *     ใน StoreProfile.logo_url · ยังไม่เคยอัปโหลด → /pictures/logoMoewMeeCake.png (ไฟล์เดิมของหน้าเว็บ)
 *     ชื่อไฟล์สุ่มใหม่ทุกครั้ง URL จึงเปลี่ยนเอง (ไม่ต้องต่อ ?v= แบบฝั่งลูกค้า) · โลโก้เก่าลบหลังบันทึกสำเร็จ
 *   - ข้อมูลร้าน/ที่อยู่ร้าน: เจ้าของร้านเท่านั้น · หน้าร้านประจำสัปดาห์: owner หรือพนักงานที่มีสิทธิ์เมนู store_info
 *     (ตรวจตามสิ่งที่เปลี่ยนจริง: รายการใหม่ = create · แก้/เปิด-ปิด = update · หายไป = delete)
 *   - แปลงลิงก์ Google Maps แบบย่อเป็นพิกัด (ตามได้เฉพาะ https ไปโดเมน Google · จำกัดขั้น/เวลา · ไม่อ่าน body)
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, forbidden, HttpError, unprocessable } from "../lib/httpError";
import { deleteImages, saveImages } from "../lib/upload";
import { isShortMapLink, parseCoordinates } from "../lib/parseCoordinates";
import { requirePermission, type PermAction } from "../lib/authGuard";
import type { SessionUser } from "../lib/session";
import storeProfileModel, { WEEK_DAYS } from "../models/storeProfileModel";
import storeSettingsModel from "../models/storeSettingsModel";
import userModel from "../models/userModel";
import { ensureWeeklyMarketsReady } from "./shippingService";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDoc = Record<string, any>;

/** โลโก้เดิมของหน้าเว็บ (ไฟล์ static ใน frontend) — ใช้เมื่อยังไม่เคยอัปโหลดผ่านหลัก */
export const DEFAULT_STORE_LOGO = "/pictures/logoMoewMeeCake.png";

const PROMPTPAY_RE = /^(\d{10}|\d{13})$/;
const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SOCIAL_KEYS = ["facebook", "line", "instagram", "website"] as const;
const MAX_WEEKLY_MARKETS = 15;
const PHONE_POPULATE = "user_fullname user_phone";

const phoneOf = (user: unknown) => String((user as { user_phone?: string | null } | null)?.user_phone ?? "").trim();
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ── สาธารณะ ─────────────────────────────────────────────────
export async function getPublicStoreInfo() {
  await dbConnect();
  await ensureWeeklyMarketsReady();
  const [profile, settings] = await Promise.all([
    storeProfileModel
      .findOne()
      .select("store_name logo_url phone_primary_user_id phone_secondary_user_id social_links weekly_markets contact_email")
      .populate("phone_primary_user_id", "user_phone")
      .populate("phone_secondary_user_id", "user_phone")
      .lean<AnyDoc>(),
    storeSettingsModel.findOne().select("house_no sub_district district province zip_code latitude longitude").lean<AnyDoc>(),
  ]);

  // เบอร์หลักก่อนเบอร์สำรอง ตัดค่าว่าง/ซ้ำ
  const phones = [...new Set([phoneOf(profile?.phone_primary_user_id), phoneOf(profile?.phone_secondary_user_id)])].filter(Boolean);
  const social = (profile?.social_links ?? {}) as AnyDoc;
  const lat = typeof settings?.latitude === "number" ? settings.latitude : null;
  const lng = typeof settings?.longitude === "number" ? settings.longitude : null;

  return {
    store_name: String(profile?.store_name ?? ""),
    logo_url: String(profile?.logo_url ?? "") || DEFAULT_STORE_LOGO,
    phones,
    contact_email: String(profile?.contact_email ?? "").trim(),
    social_links: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, String(social[k] ?? "")])),
    weekly_markets: ((profile?.weekly_markets ?? []) as AnyDoc[])
      .filter((m) => m.is_active !== false)
      .map(({ name, location, days, open_time, close_time, map_url }) => ({ name, location, days, open_time, close_time, map_url })),
    address: {
      house_no: String(settings?.house_no ?? ""),
      sub_district: String(settings?.sub_district ?? ""),
      district: String(settings?.district ?? ""),
      province: String(settings?.province ?? ""),
      zip_code: String(settings?.zip_code ?? ""),
    },
    location: lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
  };
}

/** URL โลโก้ร้านล่าสุด (ใช้ทั้งหน้าร้านและหลังร้าน) */
export async function getStoreLogo(): Promise<{ url: string; updated_at: Date | null }> {
  await dbConnect();
  const profile = await storeProfileModel.findOne().select("logo_url logo_updated_at").lean<AnyDoc>();
  return { url: String(profile?.logo_url ?? "") || DEFAULT_STORE_LOGO, updated_at: profile?.logo_updated_at ?? null };
}

// ── หน้าร้านประจำสัปดาห์ ─────────────────────────────────────
/**
 * ตรวจ + ทำความสะอาดทีละรายการ (ไม่ส่ง array จาก client เข้า DB ตรงๆ) · ผิด = 400 ข้อความของรายการแรกที่ผิด
 * คง _id เดิมของรายการไว้ (ออเดอร์อ้างอิงจุดรับด้วย _id) · ต้องมีรายการที่เปิดแสดงอย่างน้อย 1 แห่ง
 */
export function normalizeWeeklyMarkets(raw: unknown): AnyDoc[] {
  if (!Array.isArray(raw)) throw badRequest("รูปแบบข้อมูลหน้าร้านประจำสัปดาห์ไม่ถูกต้อง");
  if (raw.length > MAX_WEEKLY_MARKETS) throw badRequest(`เพิ่มหน้าร้านประจำสัปดาห์ได้ไม่เกิน ${MAX_WEEKLY_MARKETS} แห่ง`);
  const seen = new Set<string>();
  const value = raw.map((item, i) => {
    const m = isPlainObject(item) ? item : {};
    const label = `หน้าร้านประจำสัปดาห์ลำดับที่ ${i + 1}`;
    const name = String(m.name ?? "").trim();
    if (!name) throw badRequest(`${label}: กรุณาระบุชื่อสถานที่`);
    const days = Array.isArray(m.days) ? WEEK_DAYS.filter((d) => (m.days as unknown[]).includes(d)) : [];
    if (days.length === 0) throw badRequest(`${label}: กรุณาเลือกวันที่ออกร้านอย่างน้อย 1 วัน`);
    const openTime = String(m.open_time ?? "");
    const closeTime = String(m.close_time ?? "");
    if (!TIME_RE.test(openTime) || !TIME_RE.test(closeTime)) throw badRequest(`${label}: รูปแบบเวลาไม่ถูกต้อง`);
    if (openTime >= closeTime) throw badRequest(`${label}: เวลาปิดต้องหลังเวลาเปิด`);
    const mapUrl = String(m.map_url ?? "").trim();
    if (mapUrl && !URL_RE.test(mapUrl)) throw badRequest(`${label}: รูปแบบลิงก์แผนที่ไม่ถูกต้อง`);
    // _id ซ้ำในรายการเดียวกัน (client ก๊อปรายการ) → รายการหลังได้ _id ใหม่
    const keep = typeof m._id === "string" && mongoose.isValidObjectId(m._id) && !seen.has(m._id);
    const id = keep ? new mongoose.Types.ObjectId(m._id as string) : new mongoose.Types.ObjectId();
    seen.add(String(id));
    return {
      _id: id,
      name: name.slice(0, 100),
      location: String(m.location ?? "").trim().slice(0, 200),
      days,
      open_time: openTime,
      close_time: closeTime,
      map_url: mapUrl,
      is_active: m.is_active !== false,
    };
  });
  if (!value.some((m) => m.is_active)) {
    throw badRequest("ต้องมีหน้าร้านประจำสัปดาห์ที่เปิดแสดงอย่างน้อย 1 แห่ง (ใช้เป็นเวลาเปิดร้านและจุดรับสินค้า)");
  }
  return value;
}

const MARKET_COMPARE_FIELDS = ["name", "location", "days", "open_time", "close_time", "map_url", "is_active"] as const;
// เอกสารเก่าบางรายการไม่มี field เหล่านี้ (ไม่งั้นจะนับว่า "ถูกแก้" ทั้งที่ไม่ได้แตะ)
const MARKET_DEFAULTS: AnyDoc = { location: "", days: [], map_url: "", is_active: true };
const marketChanged = (before: AnyDoc, after: AnyDoc) =>
  MARKET_COMPARE_FIELDS.some(
    (f) => JSON.stringify(before[f] ?? MARKET_DEFAULTS[f] ?? null) !== JSON.stringify(after[f] ?? MARKET_DEFAULTS[f] ?? null)
  );

const ACTION_LABEL: Record<PermAction, string> = { view: "ดู", create: "เพิ่ม", update: "แก้ไข", delete: "ลบ", approve: "อนุมัติ" };

export async function getWeeklyMarkets() {
  await dbConnect();
  const profile = await ensureWeeklyMarketsReady();
  return { weekly_markets: profile.weekly_markets ?? [] };
}

/** แทนที่ทั้งรายการ · สิทธิ์ store_info ตรวจตามสิ่งที่เปลี่ยนเทียบกับที่บันทึกไว้ (owner ผ่านเสมอ) */
export async function updateWeeklyMarkets(session: SessionUser, body: unknown) {
  if (!isPlainObject(body)) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const markets = normalizeWeeklyMarkets(body.weekly_markets);
  await dbConnect();
  // ย้ายเวลาทำการเดิมก่อน — ไม่งั้นการย้ายครั้งแรกจะเติมหน้าร้านหลักซ้อนเข้ามาหลังบันทึก
  const profile = await ensureWeeklyMarketsReady();

  const existing = new Map(((profile.weekly_markets ?? []) as AnyDoc[]).map((m) => [String(m._id), m]));
  const incomingIds = new Set(markets.map((m) => String(m._id)));
  const needed = new Set<PermAction>();
  for (const m of markets) {
    const before = existing.get(String(m._id));
    if (!before) needed.add("create");
    else if (marketChanged(before, m)) needed.add("update");
  }
  if ([...existing.keys()].some((id) => !incomingIds.has(id))) needed.add("delete");

  const missing: PermAction[] = [];
  for (const action of needed) {
    try {
      await requirePermission(session, "store_info", action);
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) missing.push(action);
      else throw err;
    }
  }
  if (missing.length > 0) {
    throw forbidden(`คุณไม่มีสิทธิ์${missing.map((a) => ACTION_LABEL[a]).join("/")}หน้าร้านประจำสัปดาห์ กรุณาติดต่อเจ้าของร้าน`);
  }

  // บันทึกเฉพาะเมื่อยังเป็นเวอร์ชันที่ใช้ตรวจสิทธิ์ — มีคนแก้ระหว่างนี้ = 409 (กันสิทธิ์ที่คำนวณจากข้อมูลเก่า)
  const doc = await storeProfileModel
    .findOneAndUpdate(
      { _id: profile._id, updated_at: profile.updated_at },
      { $set: { weekly_markets: markets } },
      { returnDocument: "after", runValidators: true }
    )
    .lean<AnyDoc>();
  if (!doc) throw conflict("หน้าร้านประจำสัปดาห์ถูกแก้ไขระหว่างนี้ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง");
  return { weekly_markets: doc.weekly_markets ?? [] };
}

// ── ข้อมูลร้าน (เจ้าของร้าน) ──────────────────────────────────
function withSystemEmail(doc: AnyDoc | null): AnyDoc {
  return { ...(doc ?? {}), logo_url: String(doc?.logo_url ?? "") || DEFAULT_STORE_LOGO, system_email: process.env.EMAIL_USER ?? null };
}

async function loadProfile() {
  return storeProfileModel
    .findOne()
    .populate("phone_primary_user_id", PHONE_POPULATE)
    .populate("phone_secondary_user_id", PHONE_POPULATE)
    .lean<AnyDoc>();
}

/** ข้อมูลร้านทั้งหมด + system_email (บัญชีที่ระบบใช้ส่งอีเมล · อ่านอย่างเดียว) */
export async function getProfile() {
  await dbConnect();
  await ensureWeeklyMarketsReady(); // สร้างเอกสารให้ถ้ายังไม่มี + ย้ายเวลาทำการเดิม (ครั้งเดียว)
  return withSystemEmail(await loadProfile());
}

async function phoneUserId(raw: unknown, label: string): Promise<mongoose.Types.ObjectId | null> {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !mongoose.isValidObjectId(raw)) throw badRequest(`${label}ไม่ถูกต้อง`);
  const user = await userModel.exists({ _id: raw, deleted_at: null });
  if (!user) throw badRequest(`ไม่พบผู้ใช้ที่เลือกเป็น${label}`);
  return new mongoose.Types.ObjectId(raw);
}

/** ตรวจ + เลือกเฉพาะ field ที่แก้ได้ (โลโก้แยก · business_hours/cover_url เลิกใช้แล้ว) */
async function buildProfileUpdate(body: Record<string, unknown>): Promise<AnyDoc> {
  const update: AnyDoc = {};
  if ("store_name" in body) {
    const name = String(body.store_name ?? "").trim();
    if (name.length > 100) throw badRequest("ชื่อร้านยาวได้ไม่เกิน 100 ตัวอักษร");
    update.store_name = name;
  }
  if ("promptpay_id" in body || "promptpay_account_name" in body) {
    const id = String(body.promptpay_id ?? "").replace(/[\s-]/g, "");
    const accountName = String(body.promptpay_account_name ?? "").trim();
    if (id && !PROMPTPAY_RE.test(id)) {
      throw badRequest("รูปแบบเลขพร้อมเพย์ไม่ถูกต้อง (ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตร/เลขภาษี 13 หลัก)");
    }
    if (id && !accountName) throw badRequest("กรุณาระบุชื่อบัญชีให้ตรงกับเลขพร้อมเพย์");
    update.promptpay_id = id;
    update.promptpay_account_name = accountName.slice(0, 100);
  }
  if ("contact_email" in body) {
    const email = String(body.contact_email ?? "").trim().toLowerCase();
    if (email && (email.length > 254 || !EMAIL_RE.test(email))) throw badRequest("รูปแบบอีเมลติดต่อร้านไม่ถูกต้อง");
    update.contact_email = email;
  }
  if ("social_links" in body) {
    if (!isPlainObject(body.social_links)) throw badRequest("รูปแบบลิงก์โซเชียลไม่ถูกต้อง");
    for (const key of SOCIAL_KEYS) {
      if (!(key in body.social_links)) continue;
      const url = String(body.social_links[key] ?? "").trim();
      if (url && (url.length > 500 || !URL_RE.test(url))) throw badRequest(`รูปแบบ URL ของ ${key} ไม่ถูกต้อง`);
      update[`social_links.${key}`] = url;
    }
  }
  if ("phone_primary_user_id" in body) {
    update.phone_primary_user_id = await phoneUserId(body.phone_primary_user_id, "เบอร์โทรหลัก");
  }
  if ("phone_secondary_user_id" in body) {
    update.phone_secondary_user_id = await phoneUserId(body.phone_secondary_user_id, "เบอร์โทรสำรอง");
  }
  if ("weekly_markets" in body) update.weekly_markets = normalizeWeeklyMarkets(body.weekly_markets);
  return update;
}

/**
 * แก้ข้อมูลร้าน (upsert เอกสารเดียว) + โลโก้ (ถ้ามี) · ตรวจข้อมูลก่อนอัปโหลดเสมอ (ข้อมูลผิด = ไม่มีไฟล์ค้าง)
 * บันทึกไม่สำเร็จ → ลบไฟล์โลโก้ใหม่ทิ้ง · สำเร็จ → ลบโลโก้เก่า (ค่าที่ถูกแทนที่จริง ณ ตอนบันทึก)
 */
export async function updateProfile(body: unknown, logo: File | null = null) {
  if (!isPlainObject(body)) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  await dbConnect();
  await ensureWeeklyMarketsReady();
  const update = await buildProfileUpdate(body);

  let newLogo: string | null = null;
  if (logo) {
    const [saved] = await saveImages([logo], "store", { prefix: "logo" });
    newLogo = saved.url;
    update.logo_url = newLogo;
    update.logo_updated_at = new Date();
  }

  let before: AnyDoc | null;
  try {
    before = await storeProfileModel
      .findOneAndUpdate({}, { $set: update }, { returnDocument: "before", upsert: true, runValidators: true })
      .select("logo_url")
      .lean<AnyDoc>();
  } catch (err) {
    if (newLogo) await deleteImages([newLogo]);
    throw err;
  }
  const oldLogo = String(before?.logo_url ?? "");
  if (newLogo && oldLogo && oldLogo !== newLogo) await deleteImages([oldLogo]);
  return withSystemEmail(await loadProfile());
}

// ── ที่อยู่ร้าน + พิกัด (เจ้าของร้าน) ──────────────────────────
const ADDRESS_FIELDS = ["house_no", "sub_district", "district", "province", "zip_code"] as const;

export async function getSettings() {
  await dbConnect();
  return (
    (await storeSettingsModel.findOne().lean<AnyDoc>()) ??
    ((await storeSettingsModel.findOneAndUpdate({}, {}, { upsert: true, returnDocument: "after" }).lean<AnyDoc>()) as AnyDoc)
  );
}

export async function updateSettings(body: unknown) {
  if (!isPlainObject(body)) throw badRequest("รูปแบบข้อมูลไม่ถูกต้อง");
  const update: AnyDoc = {};
  for (const f of ADDRESS_FIELDS) {
    if (!(f in body)) continue;
    const v = String(body[f] ?? "").trim();
    if (v.length > 200) throw badRequest(`${f} ยาวเกินไป`);
    update[f] = v;
  }
  if (typeof update.zip_code === "string" && update.zip_code && !/^\d{5}$/.test(update.zip_code)) {
    throw badRequest("รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก");
  }
  for (const [f, max] of [["latitude", 90], ["longitude", 180]] as const) {
    if (!(f in body)) continue;
    const raw = body[f];
    if (raw === null || raw === "") {
      update[f] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || Math.abs(n) > max) throw badRequest(`${f} ต้องอยู่ระหว่าง -${max} ถึง ${max}`);
    update[f] = n;
  }
  await dbConnect();
  return storeSettingsModel.findOneAndUpdate({}, { $set: update }, { returnDocument: "after", upsert: true, runValidators: true }).lean<AnyDoc>();
}

// ── ลิงก์ Google Maps แบบย่อ → พิกัด ───────────────────────────
const MAP_MAX_HOPS = 6;
const MAP_TIMEOUT_MS = 8000;

/** โดเมนที่ยอมให้ server เปิด — ลิงก์ย่อของ Google และ Google Maps เท่านั้น (กัน SSRF) */
function isAllowedMapHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "maps.app.goo.gl" || host === "goo.gl" || /^(?:[a-z0-9-]+\.)*google\.(?:com|co\.th)$/.test(host);
}

function toAllowedMapUrl(raw: string, base?: string): URL | null {
  try {
    const url = new URL(raw, base);
    // ห้ามพอร์ต/บัญชีผู้ใช้ใน URL — โดเมน Google จริงไม่ต้องใช้
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    return isAllowedMapHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** ตาม redirect ของลิงก์ย่อทีละขั้นแล้วอ่านพิกัดจาก URL ปลายทาง → { lat, lng, url } */
export async function resolveMapLink(rawUrl: unknown): Promise<{ lat: number; lng: number; url: string }> {
  const input = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!isShortMapLink(input)) throw badRequest("ไม่ใช่ลิงก์ Google Maps แบบย่อ");
  let current = toAllowedMapUrl(input);
  if (!current) throw badRequest("ลิงก์ไม่ถูกต้อง");

  const deadline = AbortSignal.timeout(MAP_TIMEOUT_MS);
  try {
    for (let hop = 0; hop < MAP_MAX_HOPS; hop++) {
      const parsed = parseCoordinates(current.toString());
      if (parsed.ok) return { lat: parsed.lat, lng: parsed.lng, url: current.toString() };

      // หน้าขอความยินยอมคุกกี้ของ Google — ลิงก์จริงอยู่ใน ?continue=
      const cont = current.hostname.startsWith("consent.") ? current.searchParams.get("continue") : null;
      if (cont) {
        const next = toAllowedMapUrl(cont);
        if (!next) break;
        current = next;
        continue;
      }

      const res = await fetch(current, { method: "GET", redirect: "manual", signal: deadline, cache: "no-store" });
      await res.body?.cancel().catch(() => undefined); // ไม่ต้องการเนื้อหาหน้า
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) break;
      const next = toAllowedMapUrl(location, current.toString());
      if (!next) throw badRequest("ลิงก์นี้ไม่ได้พาไปที่ Google Maps");
      current = next;
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError("เปิดลิงก์ไม่สำเร็จ กรุณาลองใหม่ หรือคัดลอกพิกัดมาวางแทน", 502, "BAD_GATEWAY");
  }
  throw unprocessable("ลิงก์นี้ไม่มีพิกัดของตำแหน่ง — เปิดลิงก์ใน Google Maps แล้วคลิกขวาที่หมุดเพื่อคัดลอกพิกัดมาวางแทน");
}
