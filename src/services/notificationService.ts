/**
 * notificationService — แจ้งเตือนภายในร้าน (เห็นร่วมกันทุกคนที่ login แล้ว)
 *
 * ไม่มี POST ให้ client สร้างเอง — สร้างได้ทางเดียวคือ notify() ที่เรียกจาก service อื่นตอนมีเหตุการณ์
 * จริง (ดู orderService.persistOrder / paymentService.createPayment / ingredientTransactionService
 * .createTransaction / productService.deductStockForOrder) แล้ว notify() จะ push ซ้ำเข้า LINE ให้เอง
 * (src/lib/line.ts) — LINE push ล้มเหลวไม่ทำให้การสร้าง notification ใน DB ล้มเหลวตาม (best-effort)
 */
import { createCrudService } from "../lib/crudService";
import notificationModel from "../models/notificationModel";
import { pushLineMessage } from "../lib/line";
import { alertQuotaExhausted, isQuotaExceededError, recordPushed } from "../lib/lineQuota";
import { log } from "../lib/logger";

/** ค่าที่เก็บใน DB — ภาษาอังกฤษ (enum ของ notificationModel · ใช้กรอง ?module=) ห้ามเปลี่ยนเป็นภาษาไทย */
export type NotificationModule = "order" | "ingredient" | "production" | "finance" | "system";

/** ป้ายภาษาไทยสำหรับแสดงผล — ใส่ใน response เป็น `module_label` และหัวข้อความ LINE */
export const NOTIFICATION_MODULE_LABELS: Record<NotificationModule, string> = {
  order: "คำสั่งซื้อ",
  ingredient: "วัตถุดิบ",
  production: "การผลิต",
  finance: "การเงิน",
  system: "อื่น ๆ",
};

/** ป้ายของค่าที่เลิกใช้แล้ว แต่ยังมีในเอกสารเก่า — ใช้แสดงผลอย่างเดียว (สร้างใหม่ไม่ได้) */
const LEGACY_MODULE_LABELS: Record<string, string> = { employee: "พนักงาน" };

/** ป้ายภาษาไทยของ module (ค่าไม่รู้จัก → คืนค่าเดิม) */
export function notificationModuleLabel(module: unknown): string {
  return (
    NOTIFICATION_MODULE_LABELS[module as NotificationModule] ?? LEGACY_MODULE_LABELS[String(module)] ?? String(module ?? "")
  );
}

/** รับได้ทั้ง key ("order") และป้ายไทย ("คำสั่งซื้อ") → key · ไม่รู้จัก = null (ใช้กับ ?module=) */
export function parseNotificationModule(value: string | null | undefined): NotificationModule | null {
  if (!value) return null;
  const v = value.trim();
  if (v in NOTIFICATION_MODULE_LABELS) return v as NotificationModule;
  const hit = (Object.entries(NOTIFICATION_MODULE_LABELS) as [NotificationModule, string][]).find(([, label]) => label === v);
  return hit ? hit[0] : null;
}

/** เพิ่ม module_label ให้ทุก response (list/getById/update/remove/restore) — ไม่แตะค่า module เดิม */
function presentNotification<T extends Record<string, unknown>>(doc: T): T {
  return { ...doc, module_label: notificationModuleLabel(doc.module) };
}
export type NotificationType = "info" | "warning" | "success" | "error";

export interface NotifyInput {
  title: string;
  message: string;
  module: NotificationModule;
  type: NotificationType;
  link?: string | null;
  /** false = บันทึกลง DB อย่างเดียว ไม่ push LINE (เช่น ออเดอร์หน้าร้าน POS — docs/LINE.md §9.5) · ค่าเริ่มต้น true */
  line?: boolean;
}

const base = createCrudService(notificationModel, {
  label: "การแจ้งเตือน",
  searchFields: ["title", "message"],
  // ไม่มี route ไหนเรียก base.create() จริง (ดูคอมเมนต์บนไฟล์ — สร้างผ่าน notify() เท่านั้น ซึ่งเขียนตรง
  // ผ่าน notificationModel.create() ไม่ผ่าน base) แต่ต้องระบุไว้กัน mass-assignment ถ้ามีจุดเรียกในอนาคต
  createFields: ["title", "message", "module", "type", "link", "is_read"],
  updateFields: ["is_read"], // client แก้ได้แค่ mark read/unread — เนื้อหาแก้ไม่ได้
  softDelete: true,
  present: presentNotification,
});

/** บันทึกแจ้งเตือนลง DB + พยายาม push เข้า LINE คู่กัน (ไม่ throw ถ้า LINE ล้มเหลว) */
async function notify(input: NotifyInput) {
  const doc = await notificationModel.create({
    title: input.title,
    message: input.message,
    module: input.module,
    type: input.type,
    link: input.link ?? null,
    is_read: false,
  });

  if (input.line === false) return presentNotification(doc.toObject());

  const lineText = `[${notificationModuleLabel(input.module)}] ${input.title}\n${input.message}`;
  const result = await pushLineMessage(lineText);
  if (result.ok) {
    recordPushed(); // หักโควตาใน cache ของ lib/lineQuota (ใช้ตัดสินว่าส่งหาลูกค้าต่อได้ไหม)
    await notificationModel.updateOne({ _id: doc._id }, { $set: { line_sent: true } });
  } else {
    log.warn("notification.line_push_failed", { notification_id: String(doc._id), error: result.error });
    await notificationModel.updateOne({ _id: doc._id }, { $set: { line_error: result.error ?? null } });
    // โควตาหมด (429) — แจ้งในหน้าแจ้งเตือนเว็บเดือนละครั้ง ให้เจ้าของรู้ว่า LINE เงียบเพราะอะไร (docs/LINE.md §9.6 ข้อ ค)
    if (isQuotaExceededError(result.error)) await alertQuotaExhausted();
  }

  return presentNotification(doc.toObject());
}

export const notificationService = { ...base, notify };
export default notificationService;
