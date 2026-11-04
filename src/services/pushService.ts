/**
 * pushService — อุปกรณ์รับแจ้งเตือนบนเครื่องของลูกค้า (Web Push) + ส่งแจ้งเตือน
 * เรียกจาก customerNotifyService.notifyCustomer ทุกครั้งที่บันทึกกระดิ่ง → ขึ้นเป็นแจ้งเตือนบนมือถือ/คอมแบบข้อความ SMS
 * กดแล้วเปิดหน้าที่เกี่ยวข้อง (เช่นหน้ารายละเอียดพรีออเดอร์ + ชำระเงิน) · ไม่ throw ตอนส่ง
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { webPushEnabled, webPushPublicKey, webPushSender, type PushPayload } from "../lib/webPush";
import pushSubscriptionModel from "../models/pushSubscriptionModel";

/** หน้าเว็บต้องรู้ public key ก่อนขอสิทธิ์ · enabled=false = backend ยังไม่ตั้ง key (ซ่อนปุ่มเปิดแจ้งเตือน) */
export function pushConfig() {
  return { enabled: webPushEnabled(), public_key: webPushPublicKey() };
}

/** บันทึกอุปกรณ์ของผู้ใช้ — endpoint เดิมของคนอื่น (สลับบัญชีบนเครื่องเดียวกัน) ย้ายมาเป็นของผู้ใช้นี้ */
export async function subscribe(
  userId: string,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string | null
) {
  await dbConnect();
  await pushSubscriptionModel.updateOne(
    { endpoint: input.endpoint },
    { $set: { user_id: userId, keys: input.keys, user_agent: userAgent?.slice(0, 500) ?? null } },
    { upsert: true }
  );
  return { subscribed: true };
}

/** ปิดแจ้งเตือนบนเครื่องนี้ (ลบเฉพาะของตัวเอง) */
export async function unsubscribe(userId: string, endpoint: string) {
  await dbConnect();
  await pushSubscriptionModel.deleteOne({ user_id: userId, endpoint });
  return { subscribed: false };
}

/** ส่งแจ้งเตือนทุกอุปกรณ์ของผู้ใช้ — คืนจำนวนที่ส่งสำเร็จ · ปลายทางหมดอายุลบทิ้ง · ไม่ throw */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!webPushEnabled()) return 0;
  try {
    await dbConnect();
    const subs = await pushSubscriptionModel
      .find({ user_id: userId })
      .select("endpoint keys")
      .lean<{ _id: unknown; endpoint: string; keys: { p256dh: string; auth: string } }[]>();
    let sent = 0;
    await Promise.all(
      subs.map(async (s) => {
        const res = await webPushSender.send({ endpoint: s.endpoint, keys: s.keys }, payload);
        if (res.ok) {
          sent++;
          await pushSubscriptionModel.updateOne({ _id: s._id }, { $set: { last_success_at: new Date() } });
        } else if (res.gone) {
          await pushSubscriptionModel.deleteOne({ _id: s._id });
        } else {
          log.warn("push.send_failed", { user_id: userId, error: res.error });
        }
      })
    );
    return sent;
  } catch (err) {
    log.warn("push.failed", { user_id: userId, err });
    return 0;
  }
}
