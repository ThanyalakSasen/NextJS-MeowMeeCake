/**
 * webPush — ส่งแจ้งเตือนขึ้นเครื่องลูกค้า (Web Push · VAPID) · docs/env.md
 *
 * ตั้ง WEB_PUSH_PUBLIC_KEY + WEB_PUSH_PRIVATE_KEY (สร้างด้วย `npx web-push generate-vapid-keys`)
 * WEB_PUSH_SUBJECT = mailto:… หรือ https://… (ไม่ตั้ง = URL หน้าเว็บลูกค้า) · ไม่ตั้ง key = ปิดการแจ้งเตือนบนเครื่องเงียบ ๆ
 */
import webpush from "web-push";
import { storefrontBase } from "./storefront";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** path ในเว็บลูกค้า — กดแจ้งเตือนแล้วเปิดหน้านี้ */
  url: string;
  /** แจ้งเตือนที่ tag เดียวกันแทนที่อันเก่าบนเครื่อง (ไม่ซ้อนหลายอัน) */
  tag?: string;
}

export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export function webPushPublicKey(): string | null {
  return process.env.WEB_PUSH_PUBLIC_KEY?.trim() || null;
}

export function webPushEnabled(): boolean {
  return !!(webPushPublicKey() && process.env.WEB_PUSH_PRIVATE_KEY?.trim());
}

function subject(): string {
  const s = process.env.WEB_PUSH_SUBJECT?.trim();
  if (s) return s;
  const base = storefrontBase();
  return base.startsWith("https://") ? base : "mailto:noreply@meowmeecake.app";
}

/** ส่ง 1 อุปกรณ์ — gone = ปลายทางหมดอายุ/ยกเลิกแล้ว (ลบทิ้งได้) · ไม่ throw */
async function sendWebPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  if (!webPushEnabled()) return { ok: false, gone: false, error: "disabled" };
  try {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      vapidDetails: { subject: subject(), publicKey: webPushPublicKey()!, privateKey: process.env.WEB_PUSH_PRIVATE_KEY!.trim() },
      TTL: 24 * 60 * 60,
      urgency: "high",
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410, error: status ? `HTTP ${status}` : String((err as Error)?.message ?? err) };
  }
}

/** object เดียว — เทสแทน send ได้ด้วย vi.spyOn(webPushSender, "send") */
export const webPushSender = { send: sendWebPush };
