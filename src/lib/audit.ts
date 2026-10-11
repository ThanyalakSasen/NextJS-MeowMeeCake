/**
 * audit — บันทึกกิจกรรมของผู้ใช้ลง UserLogs (แบบ fire-and-forget ไม่หน่วง response)
 *
 * เรียกจาก route handler หลังทำ mutation สำเร็จ:
 *   audit(req, { action: "เปลี่ยนสถานะออเดอร์เป็น confirmed", action_type: "UPDATE",
 *                entity: "Order", entity_id: id });
 *
 * การแก้ไข/สร้าง/ลบที่ต้องการ "ก่อน → หลัง" ใช้ auditChange แทน (ดูด้านล่าง) — ระบุชื่อรายการในข้อความ
 * + เก็บเฉพาะฟิลด์ที่เปลี่ยนลง before/after ให้หน้า "บันทึกการทำงาน" แสดงว่าแก้อะไรจากอะไรเป็นอะไร
 *
 * - actor (user_id) + ip อ่านจาก session/header ที่ middleware แนบมา
 * - ถ้าไม่มี session (endpoint สาธารณะ) จะไม่บันทึก
 * - writeLog เป็น silent อยู่แล้ว (จับ error เอง) — ที่นี่ไม่ await เพื่อไม่ให้ช้า
 */
import type { NextRequest } from "next/server";
import { clientIp } from "./request";
import { getSession } from "./session";
import { diffFields, docLabel, snapshot } from "./auditDiff";
import { writeLog } from "../services/userLogService";
import type { ActionType } from "../services/userLogService";

export interface AuditEntry {
  action: string;
  action_type: ActionType;
  entity: string;
  entity_id?: string | null;
  details?: unknown;
  before?: unknown;
  after?: unknown;
}

export function audit(req: NextRequest, entry: AuditEntry): void {
  const session = getSession(req);
  if (!session) return;

  void writeLog({
    user_id: session.user_id,
    ip_address: clientIp(req),
    action: entry.action,
    action_type: entry.action_type,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    details: entry.details,
    before: entry.before,
    after: entry.after,
  });
}

const VERB = { create: "สร้าง", update: "แก้ไข", delete: "ลบ", restore: "กู้คืน" } as const;
const ACTION_TYPE: Record<keyof typeof VERB, ActionType> = {
  create: "CREATE", update: "UPDATE", delete: "DELETE", restore: "UPDATE",
};

export interface AuditChangeEntry {
  op: keyof typeof VERB;
  /** ชื่อชนิดข้อมูลภาษาไทย เช่น "โปรโมชัน" → ข้อความ `แก้ไขโปรโมชัน "ลด 20 บาท"` */
  noun: string;
  entity: string;
  entity_id?: string | null;
  /** doc ก่อนทำ (update/delete) */
  before?: unknown;
  /** doc หลังทำ (create/update/restore) */
  after?: unknown;
  /** จำกัดฟิลด์ที่บันทึก — ปกติ Object.keys(body) ที่ผู้ใช้ส่งมา */
  keys?: string[];
  /** แทนคำกริยาตาม op เช่น "เปลี่ยนสถานะ" → `เปลี่ยนสถานะออเดอร์ "ORD-001"` */
  verb?: string;
  /** แทนชื่อที่หาเองจาก doc (docLabel) — ใช้เมื่อชื่ออยู่ที่เอกสารอื่น เช่น เลขออเดอร์ของรายการชำระเงิน */
  label?: string;
  /** ต่อท้ายข้อความ เช่น " (ถาวร)" */
  suffix?: string;
  details?: unknown;
}

/** log การสร้าง/แก้ไข/ลบ พร้อมชื่อรายการ + ฟิลด์ก่อน/หลัง */
export function auditChange(req: NextRequest, e: AuditChangeEntry): void {
  const label = e.label ?? docLabel(e.after) ?? docLabel(e.before);
  let before: unknown;
  let after: unknown;
  if (e.op === "update") {
    const diff = diffFields(e.before, e.after, e.keys);
    before = diff?.before;
    after = diff?.after;
  } else if (e.op === "delete") {
    before = snapshot(e.before, e.keys);
  } else {
    after = snapshot(e.after, e.keys);
  }
  audit(req, {
    action: `${e.verb ?? VERB[e.op]}${e.noun}${label ? ` "${label}"` : ""}${e.suffix ?? ""}`,
    action_type: ACTION_TYPE[e.op],
    entity: e.entity,
    entity_id: e.entity_id ?? null,
    details: e.details,
    before,
    after,
  });
}
