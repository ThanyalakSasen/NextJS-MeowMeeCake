/**
 * customerNotifyService — แจ้งเตือนลูกค้าทาง LINE (คู่กับ notificationService ที่แจ้งฝั่งร้าน)
 *
 * ส่งได้เฉพาะลูกค้าที่ผูกบัญชี LINE แล้ว (users.line_user_id — src/lib/lineLogin.ts) และเป็นเพื่อนกับ
 * LINE OA · ไม่ได้ผูก / ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN / LINE ล้มเหลว = ข้ามเงียบ ๆ (log warn)
 * ไม่ throw และไม่บันทึกลง DB — ทุกจุดที่เรียกเป็น fire-and-forget ห้ามทำให้ธุรกรรมหลักล้มตาม
 *
 * จุดที่เรียก: orderService.persistOrder / preorderService.createPreorder (สร้างใหม่),
 * updateOrderStatus / updatePreorderStatus (สถานะ), lib/orderLifecycle (ชำระเงิน + จัดส่ง — ใช้ร่วม order/preorder)
 */
import dbConnect from "../lib/dbConnect";
import { pushLineMessage } from "../lib/line";
import { log } from "../lib/logger";
import { toBaht } from "../lib/money";
import {
  alertQuotaExhausted,
  canSendToCustomer,
  isQuotaExceededError,
  recordPushed,
} from "../lib/lineQuota";
import userModel from "../models/userModel";

export type CustomerDocKind = "order" | "preorder";

const KIND_LABEL: Record<CustomerDocKind, string> = { order: "ออเดอร์", preorder: "พรีออเดอร์" };

/**
 * สถานะที่แจ้งลูกค้า — ประหยัดโควตา LINE OA (ฟรี 300 ข้อความ/เดือน — docs/LINE.md §9.6 ข้อ ก)
 * ไม่แจ้ง: pending (ได้ข้อความ "ได้รับออเดอร์" แล้ว) · confirmed (จ่ายแล้วได้ "ชำระเงินสำเร็จ" + auto-confirm อยู่แล้ว)
 * · preparing / completed (ไม่ต้องทำอะไรต่อ ดูในเว็บได้) · ready ของออเดอร์จัดส่ง (ได้ "กำลังจัดส่ง" แทน)
 */
const ORDER_STATUS_TEXT: Record<string, string> = {
  ready: "สินค้าพร้อมรับที่ร้านแล้ว 🎉",
  cancelled: "ถูกยกเลิก",
};

const PAYMENT_STATUS_TEXT: Record<string, string> = {
  paid: "ชำระเงินสำเร็จ ✅",
  failed: "การชำระเงินไม่ผ่านการตรวจสอบ กรุณาแนบสลิปใหม่หรือติดต่อร้าน",
  refunded: "คืนเงินเรียบร้อยแล้ว",
};

const DELIVERY_STATUS_TEXT: Record<string, string> = {
  shipping: "กำลังจัดส่ง 🚚",
  delivered: "จัดส่งสำเร็จแล้ว",
  failed: "จัดส่งไม่สำเร็จ ร้านจะติดต่อกลับค่ะ",
};

function header(kind: CustomerDocKind, docNo: string): string {
  return `🧁 MeowMeeCake\n${KIND_LABEL[kind]} ${docNo}`;
}

// ── ข้อความ (export ให้เทสตรวจได้) ─────────────────────────
export const customerMessages = {
  created(kind: CustomerDocKind, docNo: string, totalSatang: number): string {
    return `${header(kind, docNo)}\nได้รับ${KIND_LABEL[kind]}แล้ว ยอดรวม ${toBaht(totalSatang).toLocaleString("th-TH")} บาท`;
  },
  orderStatus(
    kind: CustomerDocKind,
    docNo: string,
    status: string,
    opts: { reason?: string | null; orderType?: string | null } = {}
  ): string | null {
    const text = ORDER_STATUS_TEXT[status];
    if (!text) return null;
    if (status === "ready" && opts.orderType === "delivery") return null;
    const reason = opts.reason;
    const why = status === "cancelled" && reason ? `\nเหตุผล: ${reason}` : "";
    return `${header(kind, docNo)}\nสถานะ: ${text}${why}`;
  },
  /** เตือนก่อนวันรับพรีออเดอร์ (preorderReminderService) — ยังไม่จ่ายเงินให้เตือนด้วย */
  pickupReminder(
    preorderNo: string,
    pickupDate: Date,
    opts: { orderType?: string | null; unpaid?: boolean } = {}
  ): string {
    const day = pickupDate.toLocaleDateString("th-TH", {
      timeZone: "Asia/Bangkok",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const what =
      opts.orderType === "delivery"
        ? `ร้านจะเริ่มจัดส่งพรีออเดอร์ของคุณ${day}`
        : `ถึงวันรับพรีออเดอร์แล้ว — มารับได้ที่ร้าน${day}`;
    const pay = opts.unpaid ? "\n⚠️ ยังไม่ได้ชำระเงิน กรุณาชำระก่อนวันรับ" : "";
    return `${header("preorder", preorderNo)}\n⏰ ${what}${pay}`;
  },
  /** ร้านเลื่อนวันรับของรอบพรีออเดอร์ (preorderRoundService.updateRound — docs/preorder-round-flow.md ปัญหา 6) */
  pickupDateChanged(preorderNo: string, newPickupDate: Date, orderType?: string | null): string {
    const day = newPickupDate.toLocaleDateString("th-TH", {
      timeZone: "Asia/Bangkok",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const what = orderType === "delivery" ? "วันเริ่มจัดส่ง" : "วันรับสินค้า";
    return `${header("preorder", preorderNo)}\n📅 ร้านเปลี่ยน${what}เป็น${day}`;
  },
  paymentStatus(kind: CustomerDocKind, docNo: string, status: string): string | null {
    const text = PAYMENT_STATUS_TEXT[status];
    return text ? `${header(kind, docNo)}\n${text}` : null;
  },
  deliveryStatus(kind: CustomerDocKind, docNo: string, status: string, trackingNo?: string | null): string | null {
    const text = DELIVERY_STATUS_TEXT[status];
    if (!text) return null;
    const tracking = status === "shipping" && trackingNo ? `\nเลขพัสดุ: ${trackingNo}` : "";
    return `${header(kind, docNo)}\n${text}${tracking}`;
  },
};

/** ส่งข้อความหาลูกค้า 1 คน — คืน true ถ้าส่งสำเร็จ · ไม่ throw */
export async function notifyCustomer(userId: unknown, text: string | null): Promise<boolean> {
  if (!text || !userId) return false;
  // ยังไม่ตั้ง token (dev/test) → ไม่ต้อง query DB เลย
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  try {
    await dbConnect();
    const id =
      typeof userId === "object" && userId !== null && "_id" in userId
        ? String((userId as { _id: unknown })._id)
        : String(userId);
    const user = await userModel
      .findOne({ _id: id, deleted_at: null })
      .select("line_user_id")
      .lean<{ line_user_id?: string | null } | null>();
    if (!user?.line_user_id) return false;

    // กันโควตาไว้ให้แจ้งเตือนเจ้าของร้าน (docs/LINE.md §9.6 ข้อ ข) — เหลือน้อย = ข้าม + แจ้งในเว็บ (ข้อ ค)
    if (!(await canSendToCustomer())) {
      log.warn("customer_notify.skipped_quota_reserve", { user_id: id });
      return false;
    }

    const result = await pushLineMessage(text, user.line_user_id);
    if (result.ok) {
      recordPushed();
    } else {
      log.warn("customer_notify.line_push_failed", { user_id: id, error: result.error });
      if (isQuotaExceededError(result.error)) await alertQuotaExhausted();
    }
    return result.ok;
  } catch (err) {
    log.warn("customer_notify.failed", { err });
    return false;
  }
}

/** fire-and-forget — ใช้ในจุดที่ไม่อยากรอ LINE API ก่อนตอบ client */
export function notifyCustomerLater(userId: unknown, text: string | null): void {
  void notifyCustomer(userId, text);
}

export const customerNotifyService = { notifyCustomer, notifyCustomerLater, customerMessages };
export default customerNotifyService;
