/**
 * lineQuota — โควตาข้อความ push รายเดือนของ LINE OA (แพ็กเกจฟรี = 300 ข้อความ/เดือน)
 *
 * ใช้ 2 อย่าง (docs/LINE.md §9.6):
 *   1. กันโควตาไว้ให้เจ้าของร้าน — customerNotifyService เช็ค getRemainingQuota() ก่อนส่งหาลูกค้า ถ้าเหลือ
 *      ≤ LINE_OWNER_QUOTA_RESERVE (ค่าเริ่มต้น 30) หยุดส่งหาลูกค้า ให้แจ้งเตือนร้าน (สต็อกใกล้หมด ฯลฯ) ยังไปถึง
 *   2. แจ้งในหน้าแจ้งเตือนเว็บ (ไม่กินโควตา) เดือนละครั้ง ตอนโควตาใกล้หมด / หมดแล้ว
 *
 * ถามโควตาจาก LINE ไม่ได้ (ไม่มี token / network / API error) = "ไม่รู้" → ปล่อยส่งตามปกติ (fail-open) —
 * ไม่ให้ปัญหาฝั่ง quota API ทำแจ้งเตือนเงียบทั้งระบบ
 */
import notificationModel from "../models/notificationModel";
import { bangkokDateString } from "./datetime";
import { log } from "./logger";

const QUOTA_URL = "https://api.line.me/v2/bot/message/quota";
const CONSUMPTION_URL = "https://api.line.me/v2/bot/message/quota/consumption";
/** ไม่ถาม LINE ทุกข้อความ — cache ผลไว้ (นับที่ส่งสำเร็จระหว่างนั้นเพิ่มเองด้วย recordPushed) */
const CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_OWNER_RESERVE = 30;

export interface QuotaStatus {
  /** null = ไม่จำกัด (แพ็กเกจเสียเงินแบบไม่มีเพดาน) */
  limit: number | null;
  used: number;
  /** null = ไม่จำกัด */
  remaining: number | null;
}

let cache: { at: number; status: QuotaStatus } | null = null;

/** จำนวนข้อความที่กันไว้ให้เจ้าของร้าน (LINE_OWNER_QUOTA_RESERVE — จำนวนเต็ม ≥ 0) */
export function ownerQuotaReserve(): number {
  const raw = process.env.LINE_OWNER_QUOTA_RESERVE?.trim();
  if (!raw) return DEFAULT_OWNER_RESERVE;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_OWNER_RESERVE;
}

/** โควตาคงเหลือเดือนนี้ — null = ถามไม่ได้ (ให้ผู้เรียกถือว่าส่งได้) */
export async function getQuotaStatus(): Promise<QuotaStatus | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.status;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [qRes, cRes] = await Promise.all([
      fetch(QUOTA_URL, { headers }),
      fetch(CONSUMPTION_URL, { headers }),
    ]);
    if (!qRes.ok || !cRes.ok) return null;
    const q = (await qRes.json()) as { type?: string; value?: number };
    const c = (await cRes.json()) as { totalUsage?: number };
    if (typeof c.totalUsage !== "number") return null;
    const limit = q.type === "limited" && typeof q.value === "number" ? q.value : null;
    const status: QuotaStatus = {
      limit,
      used: c.totalUsage,
      remaining: limit === null ? null : Math.max(0, limit - c.totalUsage),
    };
    cache = { at: Date.now(), status };
    return status;
  } catch (err) {
    log.warn("line_quota.fetch_failed", { err });
    return null;
  }
}

/** ส่งสำเร็จ 1 ข้อความ → หักจาก cache (ข้อมูล consumption ของ LINE อัปเดตช้า ไม่งั้นช่วง cache จะส่งเกินได้) */
export function recordPushed(): void {
  if (!cache) return;
  const s = cache.status;
  s.used += 1;
  if (s.remaining !== null) s.remaining = Math.max(0, s.remaining - 1);
}

/** ล้าง cache — ใช้ในเทส */
export function resetQuotaCache(): void {
  cache = null;
}

/**
 * ส่งหาลูกค้าได้ไหม (ข้อ ข) — false เมื่อโควตาเหลือ ≤ reserve · ตอน false จะสร้างแจ้งเตือนในเว็บ (ข้อ ค)
 * ถามโควตาไม่ได้ / ไม่จำกัด → true
 */
export async function canSendToCustomer(): Promise<boolean> {
  const status = await getQuotaStatus();
  if (!status || status.remaining === null) return true;
  const reserve = ownerQuotaReserve();
  if (status.remaining > reserve) return true;
  await alertOwnerOnce(
    "โควตา LINE ใกล้หมด",
    `เดือนนี้เหลือ ${status.remaining}/${status.limit} ข้อความ — หยุดส่ง LINE หาลูกค้าชั่วคราว ` +
      `(กันไว้ ${reserve} ข้อความให้แจ้งเตือนร้าน) จะกลับมาส่งเมื่อขึ้นเดือนใหม่หรืออัปเกรดแพ็กเกจ LINE OA`
  );
  return false;
}

/** LINE ตอบ 429 ตอน push (โควตาหมดแล้ว) — แจ้งในเว็บเดือนละครั้ง (ข้อ ค) */
export async function alertQuotaExhausted(): Promise<void> {
  await alertOwnerOnce(
    "โควตา LINE หมดแล้ว",
    "LINE ปฏิเสธการส่งข้อความ (429) — แจ้งเตือนทาง LINE ทั้งหมด (รวมสต็อกใกล้หมด) จะไม่ถึงจนขึ้นเดือนใหม่ " +
      "ดูแจ้งเตือนในหน้านี้แทน หรืออัปเกรดแพ็กเกจใน LINE Official Account Manager"
  );
}

/** ตรวจว่า error ของ pushLineMessage คือโควตาหมด */
export function isQuotaExceededError(error: string | undefined): boolean {
  return typeof error === "string" && /LINE API 429/.test(error);
}

/**
 * สร้างแจ้งเตือนในเว็บ (ไม่ push LINE — กินโควตาไม่ได้) เดือนละครั้งต่อหัวข้อ: ใส่เดือนใน title แล้วเช็คซ้ำ
 * เขียนตรงผ่าน notificationModel (ไม่ผ่าน notificationService) กัน import วนกัน
 */
async function alertOwnerOnce(title: string, message: string): Promise<void> {
  const monthTitle = `${title} (${bangkokDateString().slice(0, 7)})`;
  try {
    const exists = await notificationModel.exists({ title: monthTitle, deleted_at: null });
    if (exists) return;
    await notificationModel.create({
      title: monthTitle,
      message,
      module: "system",
      type: "warning",
      link: null,
      is_read: false,
    });
  } catch (err) {
    log.warn("line_quota.alert_failed", { title: monthTitle, err });
  }
}
