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
import { log } from "../lib/logger";

export type NotificationModule = "order" | "ingredient" | "production" | "employee" | "finance" | "system";
export type NotificationType = "info" | "warning" | "success" | "error";

export interface NotifyInput {
  title: string;
  message: string;
  module: NotificationModule;
  type: NotificationType;
  link?: string | null;
}

const base = createCrudService(notificationModel, {
  label: "การแจ้งเตือน",
  searchFields: ["title", "message"],
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

  const lineText = `[${input.module}] ${input.title}\n${input.message}`;
  const result = await pushLineMessage(lineText);
  if (result.ok) {
    await notificationModel.updateOne({ _id: doc._id }, { $set: { line_sent: true } });
  } else {
    log.warn("notification.line_push_failed", { notification_id: String(doc._id), error: result.error });
    await notificationModel.updateOne({ _id: doc._id }, { $set: { line_error: result.error ?? null } });
  }

  return doc.toObject();
}

export const notificationService = { ...base, notify };
export default notificationService;
