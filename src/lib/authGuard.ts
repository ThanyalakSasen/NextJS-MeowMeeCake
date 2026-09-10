/**
 * authGuard — ตัวช่วยตรวจสิทธิ์ในชั้น route handler (รันบน Node)
 *
 *   requireAuth(req)                       → ต้องล็อกอิน (มี session) ไม่งั้น 401
 *   requireRole(session, ...roles)         → role_type ต้องอยู่ในลิสต์ ไม่งั้น 403
 *   requirePermission(session, menu, act)  → เช็คสิทธิ์เมนูจาก Permissions (owner ผ่านหมด) ไม่งั้น 403
 *   requireSelfOrRole(session, uid, ...r)  → เป็นเจ้าของข้อมูลเอง หรือมี role ที่ระบุ
 *
 * และ wrapper ที่ประกอบกับ route() ให้เขียน route สั้นลง:
 *   withAuth(handler)                      → ครอบ route() + requireAuth, ส่ง session เป็น arg แรก
 *   withPermission(menu, act, handler)     → ครอบ route() + requireAuth + requirePermission
 */
import type { NextRequest } from "next/server";
import { forbidden, unauthorized } from "./httpError";
import { route } from "./apiResponse";
import { getSession, type RoleType, type SessionUser } from "./session";
import { getEffectivePermissions } from "../services/permissionService";
import type { MenuKey } from "../services/permissionService";

export type PermAction = "view" | "create" | "update" | "delete" | "approve";

export function requireAuth(req: NextRequest): SessionUser {
  const session = getSession(req);
  if (!session) throw unauthorized("กรุณาเข้าสู่ระบบ");
  return session;
}

export function requireRole(session: SessionUser, ...roles: RoleType[]): void {
  if (!roles.includes(session.role_type)) {
    throw forbidden("บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้");
  }
}

export async function requirePermission(
  session: SessionUser,
  menu: MenuKey,
  action: PermAction
): Promise<void> {
  if (session.role_type === "owner") return; // เจ้าของร้านผ่านทุกสิทธิ์
  const { permissions } = await getEffectivePermissions(session.role_id);
  const allowed = permissions[menu]?.[`can_${action}`];
  if (!allowed) {
    throw forbidden(`ไม่มีสิทธิ์ "${action}" ในเมนู "${menu}"`);
  }
}

/**
 * ผ่านเฉพาะเจ้าของทรัพยากรนั้น (ใช้ใน /api/shop/* ที่ไม่มีแนวคิดเรื่องสิทธิ์เมนู)
 * ownerId รับได้ทั้ง string, ObjectId, หรือ document ที่ populate แล้ว ({ _id })
 */
export function requireOwner(session: SessionUser, ownerId: unknown): void {
  const owner =
    ownerId && typeof ownerId === "object"
      ? String((ownerId as { _id?: unknown })._id ?? "")
      : String(ownerId ?? "");
  if (!owner || owner !== session.user_id) {
    throw forbidden("เข้าถึงได้เฉพาะข้อมูลของบัญชีตนเอง");
  }
}

/** ผ่านถ้าเป็นเจ้าของข้อมูลนั้นเอง หรือมี role ที่ระบุ (เช่น staff/owner จัดการแทนลูกค้า) */
export function requireSelfOrRole(
  session: SessionUser,
  targetUserId: string,
  ...roles: RoleType[]
): void {
  if (session.user_id === String(targetUserId)) return;
  requireRole(session, ...roles);
}

/**
 * ผ่านถ้าเป็นเจ้าของทรัพยากรนั้น (ownerId ตรงกับ session) — ไม่งั้นต้องมีสิทธิ์ menu.action
 * ownerId รับได้ทั้ง string, ObjectId, หรือ document ที่ populate แล้ว ({ _id })
 */
export async function requireOwnerOrPermission(
  session: SessionUser,
  ownerId: unknown,
  menu: MenuKey,
  action: PermAction
): Promise<void> {
  const owner =
    ownerId && typeof ownerId === "object"
      ? String((ownerId as { _id?: unknown })._id ?? "")
      : String(ownerId ?? "");
  if (owner && owner === session.user_id) return;
  await requirePermission(session, menu, action);
}

// ── wrappers ────────────────────────────────────────────────
type GuardedHandler<A extends unknown[]> = (
  session: SessionUser,
  req: NextRequest,
  ...rest: A
) => Promise<Response> | Response;

export function withAuth<A extends unknown[]>(handler: GuardedHandler<A>) {
  return route(async (req: NextRequest, ...rest: A) => {
    const session = requireAuth(req);
    return handler(session, req, ...rest);
  });
}

export function withPermission<A extends unknown[]>(
  menu: MenuKey,
  action: PermAction,
  handler: GuardedHandler<A>
) {
  return route(async (req: NextRequest, ...rest: A) => {
    const session = requireAuth(req);
    await requirePermission(session, menu, action);
    return handler(session, req, ...rest);
  });
}
