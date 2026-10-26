/**
 * couponNoticeService — แจ้งเตือน "ในเว็บ" ของลูกค้าเรื่องคูปอง/โค้ดส่วนลด (กระดิ่งหน้าร้าน · ไม่ส่ง LINE = ไม่กินโควตา)
 *
 *   - notifyCouponRedeemed: ลูกค้าแลกแต้มเป็นคูปอง → แจ้งคนนั้นพร้อมรหัส (ref_type "coupon")
 *   - notifyCustomersOfNewCode: ร้านสร้างโค้ดส่วนลดใหม่ที่ใช้ในเว็บได้ → แจ้งลูกค้าทุกคนพร้อมรหัส (ref_type "promotion")
 *     แสดงตั้งแต่วันเริ่มโปร (visible_at) · โค้ดที่แลกด้วยแต้ม / หน้าร้านอย่างเดียว / ปิดอยู่ / หมดอายุแล้ว = ไม่แจ้ง
 *   - hidePromotionNotices / restorePromotionNotices: ลบโค้ด → ซ่อนแจ้งเตือนของโค้ดนั้น · กู้คืน → แสดงอีกครั้ง
 * หน้าเว็บอ่าน coupon_code ไปแสดงพร้อมปุ่มคัดลอก · ทุกฟังก์ชันไม่ throw (ไม่ให้การสร้างโปร/แลกคูปองล้มเพราะแจ้งเตือน)
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { trackBackground } from "../lib/backgroundTasks";
import { channelsOf, positiveLimit } from "../lib/promoCode";
import customerNotificationModel from "../models/customerNotificationModel";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MEMBER_COUPONS_PATH = "/customer/account/member?tab=coupons";
const INSERT_BATCH = 500;

const baht = (n: unknown) => Number(n ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });

/** "ลด 10% (สูงสุด 50 บาท) เมื่อซื้อครบ 300 บาท" — เงื่อนไขย่อของโปร/คูปอง */
export function describeDiscount(p: {
  discount_type: string;
  discount_value?: number | null;
  max_discount_amount?: number | null;
  min_order_amount?: number | null;
}): string {
  const cap = positiveLimit(p.max_discount_amount);
  const min = positiveLimit(p.min_order_amount);
  const what =
    p.discount_type === "Percentage"
      ? `ลด ${Number(p.discount_value ?? 0)}%${cap != null ? ` (สูงสุด ${baht(cap)} บาท)` : ""}`
      : p.discount_type === "Amount"
        ? `ลด ${baht(p.discount_value)} บาท`
        : "ส่งฟรี";
  return min != null ? `${what} เมื่อซื้อครบ ${baht(min)} บาท` : what;
}

const thaiDate = (d: unknown) =>
  new Date(d as string).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

export async function notifyCouponRedeemed(userId: string, coupon: any): Promise<void> {
  try {
    await dbConnect();
    await customerNotificationModel.create({
      user_id: userId,
      title: `แลกคูปองสำเร็จ: ${coupon.promotion_name}`,
      message: `${describeDiscount(coupon)} · ใช้ได้ถึง ${thaiDate(coupon.expires_at)} — เลือกจาก "คูปองของฉัน" ตอนชำระเงิน`,
      type: "success",
      link: MEMBER_COUPONS_PATH,
      ref_type: "coupon",
      ref_id: coupon._id,
      coupon_code: coupon.promotion_code,
    });
  } catch (err) {
    log.warn("coupon_notice.redeemed_failed", { user_id: userId, err });
  }
}

/** โค้ดนี้ควรประกาศให้ลูกค้าเว็บไหม */
function isPublicWebCode(p: any, now = new Date()): boolean {
  if (!p || p.deleted_at || p.is_active === false) return false;
  if (Number(p.points_cost) > 0) return false; // แลกด้วยแต้ม — ไม่ใช่โค้ดที่กรอกเอง
  if (!channelsOf(p).includes("online")) return false; // หน้าร้านอย่างเดียว
  if (p.end_date && new Date(p.end_date) < now) return false;
  return true;
}

async function customerIds(): Promise<unknown[]> {
  const roles = await roleModel.find({ role_type: "customer" }).select("_id").lean<{ _id: unknown }[]>();
  if (roles.length === 0) return [];
  const users = await userModel
    .find({ role_id: { $in: roles.map((r) => r._id) }, deleted_at: null, is_active: { $ne: false } })
    .select("_id")
    .lean<{ _id: unknown }[]>();
  return users.map((u) => u._id);
}

export async function notifyCustomersOfNewCodeNow(promo: any): Promise<number> {
  try {
    if (!isPublicWebCode(promo)) return 0;
    await dbConnect();
    const ids = await customerIds();
    if (ids.length === 0) return 0;
    const now = new Date();
    const start = promo.start_date ? new Date(promo.start_date) : now;
    const docs = ids.map((user_id) => ({
      user_id,
      title: `โค้ดส่วนลดใหม่: ${promo.promotion_name}`,
      message: `${describeDiscount(promo)} · ใช้ได้ถึง ${thaiDate(promo.end_date)} — กรอกโค้ดตอนชำระเงิน`,
      type: "success",
      link: "/customer/product",
      ref_type: "promotion",
      ref_id: promo._id,
      coupon_code: promo.promotion_code,
      visible_at: start > now ? start : now,
    }));
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      await customerNotificationModel.insertMany(docs.slice(i, i + INSERT_BATCH), { ordered: false });
    }
    return docs.length;
  } catch (err) {
    log.warn("coupon_notice.new_code_failed", { promotion_id: String(promo?._id), err });
    return 0;
  }
}

/** fire-and-forget — ไม่ให้หน้าสร้างโปรรอแจ้งลูกค้าหลายร้อยคน */
export function notifyCustomersOfNewCode(promo: any): void {
  void trackBackground(notifyCustomersOfNewCodeNow(promo));
}

export async function hidePromotionNotices(promotionId: string): Promise<void> {
  try {
    await dbConnect();
    await customerNotificationModel.updateMany(
      { ref_type: "promotion", ref_id: promotionId, deleted_at: null },
      { $set: { deleted_at: new Date() } }
    );
  } catch (err) {
    log.warn("coupon_notice.hide_failed", { promotion_id: promotionId, err });
  }
}

export async function restorePromotionNotices(promotionId: string): Promise<void> {
  try {
    await dbConnect();
    await customerNotificationModel.updateMany(
      { ref_type: "promotion", ref_id: promotionId, deleted_at: { $ne: null } },
      { $set: { deleted_at: null } }
    );
  } catch (err) {
    log.warn("coupon_notice.restore_failed", { promotion_id: promotionId, err });
  }
}
