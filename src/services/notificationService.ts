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

export type NotificationModule = "order" | "ingredient" | "production" | "employee" | "finance" | "system";
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

  if (input.line === false) return doc.toObject();

  const lineText = `[${input.module}] ${input.title}\n${input.message}`;
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

  return doc.toObject();
}

export const notificationService = { ...base, notify };
export default notificationService;
