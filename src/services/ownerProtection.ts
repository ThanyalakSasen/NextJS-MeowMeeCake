/**
 * ownerProtection — กันคนที่ไม่ใช่เจ้าของร้านยกระดับตัวเองเป็น owner หรือยึด/ปิดบัญชี owner
 *
 * owner ผ่านทุกสิทธิ์ (authGuard.requirePermission) แต่สิทธิ์เมนู `employees` ของพนักงานจัดการ "ผู้ใช้ + บทบาท" ได้
 * เดิมจึงมีทางยกระดับ: สร้างบทบาทประเภท owner · ย้ายผู้ใช้ (รวมตัวเอง) เข้าบทบาท owner · ตั้งรหัสผ่านใหม่ให้บัญชี owner
 * แล้วล็อกอินแทน · แก้อีเมล / ปิดใช้งาน / ลบบัญชี owner · ปิดใช้งานบทบาท owner (owner ล็อกอินไม่ได้ — authGuard)
 * (การเปลี่ยน role_type ของบทบาทเดิมปิดไปแล้วที่ roleService.update)
 *
 * กติกา: ผู้ที่ไม่ใช่ owner
 *   - สร้างบทบาทประเภท owner ไม่ได้ · แก้ / ลบ / กู้คืนบทบาทประเภท owner ไม่ได้
 *   - ตั้งผู้ใช้ให้อยู่บทบาทประเภท owner ไม่ได้ (สร้างใหม่ หรือย้ายบทบาท)
 *   - แก้ / ตั้งรหัสผ่าน / ปลดล็อก / ลบ / กู้คืน ผู้ใช้ที่อยู่บทบาทประเภท owner ไม่ได้
 * owner ทำได้ทุกอย่าง · ทั้งหมดตอบ 403
 *
 * กันร้านล็อกตัวเองออก (ทุกคน รวม owner): ลบ / ปิดใช้งาน / ย้ายบทบาทบัญชีตัวเองไม่ได้ (403)
 * และเอาเจ้าของร้านคนสุดท้ายที่ใช้งานได้ออกไม่ได้ (409) — assertKeepsOwner / assertRoleKeepsOwner
 */
import dbConnect from "../lib/dbConnect";
import { conflict, forbidden } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import type { SessionUser } from "../lib/session";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";

const OWNER_ONLY = "เฉพาะเจ้าของร้านเท่านั้นที่จัดการบัญชีหรือบทบาทระดับเจ้าของร้านได้";

const isOwner = (s: SessionUser) => s.role_type === "owner";

/** บทบาทนี้เป็นประเภท owner ไหม (นับที่ถูกลบแล้วด้วย — กู้คืนแล้วก็ยังเป็น owner) · id ผิดรูปแบบ = false (ให้ service ตอบ 400/404 เอง) */
async function isOwnerRole(roleId: unknown): Promise<boolean> {
  // role_id ที่อ่านจาก DB เป็น ObjectId (isObjectId รับแค่ string) — แปลงก่อนเสมอ ไม่งั้นบัญชี owner หลุดการตรวจ
  const id = roleId == null ? "" : String(roleId);
  if (!isObjectId(id)) return false;
  await dbConnect();
  return !!(await roleModel.exists({ _id: id, role_type: "owner" }));
}

/** POST /api/admin/roles */
export function assertMayCreateRoleType(session: SessionUser, roleType: unknown): void {
  if (roleType === "owner" && !isOwner(session)) throw forbidden(OWNER_ONLY);
}

/** PATCH / DELETE / restore ของ /api/admin/roles/:id */
export async function assertMayManageRole(session: SessionUser, roleId: string): Promise<void> {
  if (!isOwner(session) && (await isOwnerRole(roleId))) throw forbidden(OWNER_ONLY);
}

/** ตั้ง role_id ให้ผู้ใช้ (POST /api/admin/users · PATCH ที่ส่ง role_id) */
export async function assertMayAssignRole(session: SessionUser, roleId: unknown): Promise<void> {
  if (!isOwner(session) && (await isOwnerRole(roleId))) throw forbidden(OWNER_ONLY);
}

/** แก้ / ตั้งรหัสผ่าน / ปลดล็อก / ลบ / กู้คืน ผู้ใช้ (นับผู้ใช้ที่ถูกลบแล้วด้วย — กู้คืนบัญชี owner ก็ต้องเป็น owner) */
export async function assertMayManageUser(session: SessionUser, userId: string): Promise<void> {
  if (isOwner(session) || !isObjectId(userId)) return;
  await dbConnect();
  const user = await userModel.findById(userId).select("role_id").lean<{ role_id?: unknown } | null>();
  if (user && (await isOwnerRole(user.role_id))) throw forbidden(OWNER_ONLY);
}

const LAST_OWNER =
  "ต้องเหลือบัญชีเจ้าของร้านที่ใช้งานได้อย่างน้อย 1 บัญชี — เพิ่ม/เปิดใช้งานเจ้าของร้านคนอื่นก่อน";
const SELF_LOCKOUT = "ลบ / ปิดใช้งาน / ย้ายบทบาทของบัญชีตัวเองไม่ได้ — ให้ผู้ดูแลคนอื่นทำแทน";

/**
 * จำนวนเจ้าของร้านที่ล็อกอินใช้งานได้ (บัญชีเปิด + ไม่ถูกลบ · อยู่บทบาทประเภท owner ที่เปิดอยู่และไม่ถูกลบ)
 * ไม่นับผู้ใช้ / บทบาทที่กำลังจะถูกเอาออก (exclude)
 */
async function activeOwnerCount(exclude: { userId?: string; roleId?: string } = {}): Promise<number> {
  await dbConnect();
  const roles = await roleModel
    .find({
      role_type: "owner",
      is_active: { $ne: false },
      deleted_at: null,
      ...(exclude.roleId ? { _id: { $ne: exclude.roleId } } : {}),
    })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  if (roles.length === 0) return 0;
  return userModel.countDocuments({
    role_id: { $in: roles.map((r) => r._id) },
    is_active: { $ne: false },
    deleted_at: null,
    ...(exclude.userId ? { _id: { $ne: exclude.userId } } : {}),
  });
}

/**
 * ลบ / ปิดใช้งาน / ย้ายบทบาทผู้ใช้ — กันร้านล็อกตัวเองออก (เดิมไม่มีการตรวจ):
 *   - ทำกับบัญชีตัวเองไม่ได้ (403) — เจ้าของร้านคนเดียวลบ/ปิดตัวเองแล้วไม่มีใครจัดการร้านได้อีก
 *   - เอาเจ้าของร้านคนสุดท้ายที่ใช้งานได้ออกไม่ได้ (409)
 * change.remove = DELETE · is_active=false = ปิดใช้งาน · role_id = ย้ายบทบาท (ย้ายไปบทบาท owner อื่น = ยังเป็นเจ้าของ)
 */
export async function assertKeepsOwner(
  session: SessionUser,
  userId: string,
  change: { remove?: boolean; is_active?: boolean; role_id?: unknown }
): Promise<void> {
  if (!isObjectId(userId)) return;
  await dbConnect();
  const user = await userModel.findById(userId).select("role_id").lean<{ role_id?: unknown } | null>();
  if (!user) return;
  const deactivates = !!change.remove || change.is_active === false;
  const movesRole = change.role_id !== undefined && String(change.role_id ?? "") !== String(user.role_id ?? "");
  if (!deactivates && !movesRole) return;

  if (String(session.user_id) === userId) throw forbidden(SELF_LOCKOUT);

  if (!(await isOwnerRole(user.role_id))) return;
  if (!deactivates && (await isOwnerRole(change.role_id))) return;
  if ((await activeOwnerCount({ userId })) === 0) throw conflict(LAST_OWNER);
}

/** ปิดใช้งานบทบาทประเภท owner — ต้องเหลือเจ้าของร้านในบทบาท owner อื่นที่ใช้งานได้ (authGuard ปฏิเสธทุกคนในบทบาทที่ปิด) */
export async function assertRoleKeepsOwner(roleId: string, input: { is_active?: unknown }): Promise<void> {
  if (input.is_active !== false || !(await isOwnerRole(roleId))) return;
  if ((await activeOwnerCount({ roleId })) === 0) throw conflict(LAST_OWNER);
}
