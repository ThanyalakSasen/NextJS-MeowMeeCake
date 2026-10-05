/**
 * customerNotifyService — แจ้งเตือนลูกค้า: **กระดิ่งในเว็บ (CustomerNotifications) + LINE** (คู่กับ notificationService ที่แจ้งฝั่งร้าน)
 *
 * ผู้ใช้เลือก (customer-backend-merge.md §8.12): กระดิ่งในเว็บแจ้ง**ทุกสถานะ** ของออเดอร์เว็บ (ORD-) + พรีออเดอร์ (PRE-) ·
 * LINE ส่งเฉพาะบางสถานะตามเดิม (ประหยัดโควตา — customerMessages คืน null = ไม่ส่ง LINE) · บิลหน้าร้าน (POS-) ไม่แจ้งทั้งสองทาง ·
 * ลูกค้ายกเลิกเองไม่แจ้งกลับ (เห็นผลในหน้าเว็บอยู่แล้ว) · กระดิ่งบันทึกได้แม้ลูกค้าไม่ได้ผูก LINE / ไม่ได้ตั้ง LINE token
 *
 * LINE:
 * ส่งได้เฉพาะลูกค้าที่ผูกบัญชี LINE แล้ว (users.line_user_id — src/lib/lineLogin.ts) และเป็นเพื่อนกับ
 * LINE OA · ไม่ได้ผูก / ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN / LINE ล้มเหลว = ข้ามเงียบ ๆ (log warn)
 * ไม่ throw — ทุกจุดที่เรียกเป็น fire-and-forget ห้ามทำให้ธุรกรรมหลักล้มตาม
 *
 * จุดที่เรียก: orderService.persistOrder / preorderService.createPreorder (สร้างใหม่),
 * updateOrderStatus / updatePreorderStatus (สถานะ), lib/orderLifecycle (ชำระเงิน + จัดส่ง — ใช้ร่วม order/preorder),
 * preorderReminderService (เตือนวันรับ) · preorderRoundService (เลื่อนวันรับ)
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
import customerNotificationModel from "../models/customerNotificationModel";
import { PAYMENT_EXPIRED_REASON } from "../lib/paymentDeadline";
import { isObjectId } from "../lib/objectId";
import { trackBackground } from "../lib/backgroundTasks";
import { notFound } from "../lib/httpError";

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

// ── กระดิ่งในเว็บ (CustomerNotifications) ──────────────────────
export type WebNoticeType = "info" | "success" | "warning" | "error";
export interface WebNotice {
  title: string;
  message: string;
  type: WebNoticeType;
  /** path ในหน้าเว็บลูกค้า เช่น /customer/account/purchases/<id> */
  link: string | null;
  ref_type: "order" | "preorder" | null;
  ref_id: unknown;
  /** เลขเอกสาร — ใช้ข้ามบิลหน้าร้าน (POS-) */
  doc_no?: string | null;
}

const isPosDoc = (docNo?: string | null) => typeof docNo === "string" && docNo.startsWith("POS-");

function docPath(kind: CustomerDocKind, id: unknown): string {
  return kind === "order" ? `/customer/account/purchases/${String(id)}` : "/customer/account/preorders";
}
function docTitle(kind: CustomerDocKind, docNo: string): string {
  return kind === "order" ? `คำสั่งซื้อ #${docNo}` : `พรีออเดอร์ #${docNo}`;
}
function web(kind: CustomerDocKind, id: unknown, docNo: string, message: string, type: WebNoticeType): WebNotice {
  return { title: docTitle(kind, docNo), message, type, link: docPath(kind, id), ref_type: kind, ref_id: id ?? null, doc_no: docNo };
}

/** ข้อความกระดิ่งของแต่ละเหตุการณ์ (ข้อความแบบฝั่งลูกค้า) — null = ไม่แจ้ง */
export const customerWeb = {
  created(kind: CustomerDocKind, id: unknown, docNo: string, total: number): WebNotice {
    return web(kind, id, docNo, `🧾 ได้รับ${KIND_LABEL[kind]}แล้ว ยอดรวม ${toBaht(total).toLocaleString("th-TH")} บาท`, "info");
  },
  orderStatus(
    kind: CustomerDocKind,
    id: unknown,
    docNo: string,
    status: string,
    opts: { reason?: string | null; orderType?: string | null; paymentStatus?: string | null } = {}
  ): WebNotice | null {
    const isDelivery = opts.orderType === "delivery";
    switch (status) {
      case "confirmed":
        return web(kind, id, docNo, "🧾 ร้านรับคำสั่งซื้อของคุณแล้ว", "info");
      case "preparing":
        return web(kind, id, docNo, "👩‍🍳 ร้านกำลังเตรียมสินค้าของคุณ", "info");
      case "ready":
        return web(kind, id, docNo, isDelivery ? "📦 สินค้าพร้อมจัดส่งแล้ว" : "🛍️ สินค้าพร้อมให้มารับแล้ว", "info");
      case "completed":
        return web(kind, id, docNo, "🎉 คำสั่งซื้อสำเร็จแล้ว ขอบคุณที่อุดหนุนนะคะ", "success");
      case "cancelled": {
        const reason = opts.reason?.trim() ?? "";
        const lines = [`❌ คำสั่งซื้อถูกยกเลิก${reason ? `\nเหตุผล: ${reason}` : ""}`];
        if (reason === PAYMENT_EXPIRED_REASON) {
          if (kind === "preorder") lines.push("สละสิทธิ์การจองสินค้าในรอบนี้แล้ว");
          else lines.push("หากโอนเงินไปแล้ว กรุณาแนบสลิปที่หน้ารายละเอียดคำสั่งซื้อ ร้านจะตรวจสอบให้");
        }
        if (opts.paymentStatus === "paid") lines.push("ร้านจะดำเนินการคืนเงินให้ และแจ้งให้ทราบอีกครั้ง");
        return web(kind, id, docNo, lines.join("\n"), "error");
      }
      default:
        return null;
    }
  },
  paymentStatus(kind: CustomerDocKind, id: unknown, docNo: string, status: string): WebNotice | null {
    if (status === "paid") return web(kind, id, docNo, "✅ ร้านยืนยันการชำระเงินแล้ว", "success");
    if (status === "failed") return web(kind, id, docNo, "⚠️ สลิปไม่ผ่านการตรวจสอบ กรุณาอัปโหลดสลิปใหม่", "warning");
    if (status === "refunded") return web(kind, id, docNo, "💸 ร้านคืนเงินให้เรียบร้อยแล้ว", "success");
    return null;
  },
  deliveryStatus(kind: CustomerDocKind, id: unknown, docNo: string, status: string, trackingNo?: string | null): WebNotice | null {
    if (status === "shipping") {
      return web(kind, id, docNo, `🚚 จัดส่งสินค้าแล้ว${trackingNo ? `\nเลขพัสดุ: ${trackingNo}` : ""}`, "info");
    }
    if (status === "delivered") return web(kind, id, docNo, "🏠 สินค้าจัดส่งถึงแล้ว", "success");
    if (status === "failed") return web(kind, id, docNo, "⚠️ การจัดส่งมีปัญหา ร้านจะติดต่อกลับโดยเร็ว", "warning");
    return null;
  },
  /** ข้อความ LINE (customerMessages) ใช้เป็นข้อความกระดิ่งตรง ๆ — ตัดหัว "🧁 MeowMeeCake / เลขเอกสาร" ออก */
  fromLineText(kind: CustomerDocKind, id: unknown, docNo: string, lineText: string | null, type: WebNoticeType = "info"): WebNotice | null {
    if (!lineText) return null;
    const body = lineText.split("\n").slice(2).join("\n").trim();
    return web(kind, id, docNo, body || lineText, type);
  },
};

/** บันทึกกระดิ่ง 1 รายการ — ไม่ throw */
async function recordWebNotice(userId: string, notice: WebNotice): Promise<void> {
  try {
    await customerNotificationModel.create({
      user_id: userId,
      title: notice.title,
      message: notice.message,
      type: notice.type,
      link: notice.link,
      ref_type: notice.ref_type,
      ref_id: notice.ref_id ?? null,
    });
  } catch (err) {
    log.warn("customer_notify.web_failed", { user_id: userId, err });
  }
}

const userIdOf = (userId: unknown) =>
  typeof userId === "object" && userId !== null && "_id" in userId
    ? String((userId as { _id: unknown })._id)
    : String(userId);

/**
 * แจ้งลูกค้า 1 คน: บันทึกกระดิ่งในเว็บ (ถ้ามี notice) + ส่ง LINE (ถ้ามี text และผูก LINE แล้ว)
 * คืน true ถ้าส่ง LINE สำเร็จ · ไม่ throw · บิลหน้าร้าน (notice.doc_no ขึ้นต้น POS-) ไม่แจ้ง
 */
export async function notifyCustomer(userId: unknown, text: string | null, notice?: WebNotice | null): Promise<boolean> {
  if (!userId) return false;
  if (notice && isPosDoc(notice.doc_no)) return false;
  if (notice) {
    try {
      await dbConnect();
      await recordWebNotice(userIdOf(userId), notice);
    } catch (err) {
      log.warn("customer_notify.web_failed", { err });
    }
  }
  if (!text) return false;
  // ยังไม่ตั้ง token (dev/test) → ไม่ต้อง query DB เลย
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  try {
    await dbConnect();
    const id = userIdOf(userId);
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
export function notifyCustomerLater(userId: unknown, text: string | null, notice?: WebNotice | null): void {
  void trackBackground(notifyCustomer(userId, text, notice));
}

// ── กระดิ่งของลูกค้า (GET/PATCH /api/shop/notifications) ──────────
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** ของฉัน + ยังไม่ถูกลบ + ถึงเวลาแสดงแล้ว (รายการที่บันทึกล่วงหน้าโผล่เองเมื่อถึง visible_at — แบบฝั่งลูกค้า) */
function visibleFilter(userId: string) {
  return {
    user_id: userId,
    deleted_at: null,
    $or: [{ visible_at: { $lte: new Date() } }, { visible_at: null }],
  };
}

export async function listMyNotifications(userId: string, rawLimit?: unknown) {
  await dbConnect();
  const n = Number(rawLimit);
  const limit = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
  const filter = visibleFilter(userId);
  const [items, unread_count] = await Promise.all([
    customerNotificationModel
      .find(filter)
      .sort({ visible_at: -1, created_at: -1, _id: -1 })
      .limit(limit)
      .select("title message type link ref_type ref_id read_at created_at visible_at")
      .lean(),
    customerNotificationModel.countDocuments({ ...filter, read_at: null }),
  ]);
  return { items, unread_count };
}

export async function markAllRead(userId: string) {
  await dbConnect();
  const res = await customerNotificationModel.updateMany(
    { ...visibleFilter(userId), read_at: null },
    { $set: { read_at: new Date() } }
  );
  return { updated: res.modifiedCount ?? 0, unread_count: 0 };
}

export async function markRead(userId: string, id: string) {
  await dbConnect();
  if (!isObjectId(id)) throw notFound("ไม่พบการแจ้งเตือน");
  const doc = await customerNotificationModel
    .findOneAndUpdate({ ...visibleFilter(userId), _id: id }, { $set: { read_at: new Date() } }, { returnDocument: "after" })
    .lean();
  if (!doc) throw notFound("ไม่พบการแจ้งเตือน");
  const unread_count = await customerNotificationModel.countDocuments({ ...visibleFilter(userId), read_at: null });
  return { item: doc, unread_count };
}

export const customerNotifyService = { notifyCustomer, notifyCustomerLater, customerMessages, customerWeb };
export default customerNotifyService;
