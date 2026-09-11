/**
 * audit — บันทึกกิจกรรมของผู้ใช้ลง UserLogs (แบบ fire-and-forget ไม่หน่วง response)
 *
 * เรียกจาก route handler หลังทำ mutation สำเร็จ:
 *   audit(req, { action: "เปลี่ยนสถานะออเดอร์เป็น confirmed", action_type: "UPDATE",
 *                entity: "Order", entity_id: id });
 *
 * - actor (user_id) + ip อ่านจาก session/header ที่ middleware แนบมา
 * - ถ้าไม่มี session (endpoint สาธารณะ) จะไม่บันทึก
 * - writeLog เป็น silent อยู่แล้ว (จับ error เอง) — ที่นี่ไม่ await เพื่อไม่ให้ช้า
 */
import type { NextRequest } from "next/server";
import { clientIp } from "./request";
import { getSession } from "./session";
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
