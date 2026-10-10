/**
 * permissionCeiling — คนที่ไม่ใช่เจ้าของร้าน ให้หรือจัดการได้ไม่เกินสิทธิ์ที่ตัวเองมี (issue #81)
 *
 * ต่อจาก ownerProtection (กันยกระดับเป็น owner) — สิทธิ์เมนู `employees` ยังเปิดทางยกระดับเป็น staff ที่มีสิทธิ์
 * เต็มทุกเมนูได้: ให้สิทธิ์กับบทบาทตัวเอง · สร้างบทบาทใหม่ให้สิทธิ์เต็มแล้วย้ายตัวเองเข้าไป · ย้ายตัวเองเข้าบทบาท
 * ที่มีสิทธิ์มากกว่า · ตั้งรหัสผ่านให้พนักงานที่มีสิทธิ์มากกว่าแล้วล็อกอินแทน
 *
 * กติกา: ผู้ที่ไม่ใช่ owner
 *   - ให้สิทธิ์ (สร้าง / แก้ / กู้คืนแถวสิทธิ์): flag ที่จะเปิดต้องเป็นสิ่งที่ตัวเองมีอยู่แล้วในเมนูเดียวกัน
 *   - กำหนดบทบาทให้ผู้ใช้ (สร้างผู้ใช้ / ย้ายบทบาท): สิทธิ์ของบทบาทปลายทางต้องไม่เกินของตัวเอง
 *     (ตรวจเฉพาะเมื่อ role_id เปลี่ยนจริง — ฟอร์มหลังร้านส่ง role_id มาทุกครั้งที่บันทึก)
 *   - จัดการบัญชี (แก้ / ตั้งรหัสผ่าน / ปลดล็อก / ลบ / กู้คืน): สิทธิ์ของบทบาทเป้าหมายต้องไม่เกินของตัวเอง
 *   - ถอน / ลบสิทธิ์ไม่จำกัด (ไม่ใช่การยกระดับ)
 * "สิทธิ์" = สิทธิ์ที่ใช้ได้จริงตอนนี้ (getMenuAccess — ตัดที่หมดอายุออก · บทบาท owner = ทุกอย่าง) · ปฏิเสธ = 403
 * owner ทำได้ทุกอย่าง · ยังไม่ครอบคลุม: expires_at (ผู้ที่มีสิทธิ์ชั่วคราวยังให้สิทธิ์แบบไม่หมดอายุได้)
 */
import dbConnect from "../lib/dbConnect";
import { forbidden } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import type { SessionUser } from "../lib/session";
import permissionModel from "../models/permissionModel";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";
import { getMenuAccess, MENU_KEYS, type MenuAccess, type MenuKey } from "./permissionService";

const FLAGS = ["can_view", "can_create", "can_update", "can_delete", "can_approve"] as const;
type Flag = (typeof FLAGS)[number];
type Flags = Partial<Record<Flag, boolean | undefined>>;

const isOwner = (s: SessionUser) => s.role_type === "owner";

/** "payments.approve" — ใช้บอกในข้อความว่าขาดสิทธิ์ไหน */
const label = (menu: string, flag: Flag) => `${menu}.${flag.slice(4)}`;

function deny(missing: string[]): never {
  const shown = missing.slice(0, 5).join(", ") + (missing.length > 5 ? ` และอีก ${missing.length - 5} รายการ` : "");
  throw forbidden(`ให้หรือจัดการได้ไม่เกินสิทธิ์ที่ตัวเองมี — คุณไม่มีสิทธิ์ ${shown}`);
}

/** สิทธิ์ที่บทบาทนี้มี · id ผิดรูปแบบ / ไม่พบ = null (ให้ service ตอบ 400/404 เอง) · นับบทบาทที่ถูกลบแล้วด้วย */
async function roleAccess(roleId: unknown): Promise<MenuAccess | null> {
  // role_id ที่อ่านจาก DB เป็น ObjectId — แปลงก่อนเสมอ (เหตุผลเดียวกับ ownerProtection.isOwnerRole)
  const id = roleId == null ? "" : String(roleId);
  if (!isObjectId(id)) return null;
  await dbConnect();
  const role = await roleModel.findById(id).select("role_type").lean<{ role_type?: string } | null>();
  if (!role?.role_type) return null;
  return getMenuAccess({ role_id: id, role_type: role.role_type });
}

/** สิ่งที่ target มีแต่ actor ไม่มี */
function missingIn(actor: MenuAccess, target: MenuAccess): string[] {
  const out: string[] = [];
  for (const menu of MENU_KEYS) {
    for (const f of FLAGS) if (target[menu]?.[f] && !actor[menu]?.[f]) out.push(label(menu, f));
  }
  return out;
}

async function assertRoleWithinActor(session: SessionUser, roleId: unknown): Promise<void> {
  const target = await roleAccess(roleId);
  if (!target) return;
  const missing = missingIn(await getMenuAccess(session), target);
  if (missing.length) deny(missing);
}

/** POST /api/admin/permissions — flag ที่ส่งมาเป็น true ต้องเป็นสิ่งที่ผู้ทำมีในเมนูนั้น */
export async function assertMayGrant(session: SessionUser, menuKey: MenuKey, flags: Flags): Promise<void> {
  if (isOwner(session)) return;
  const own = (await getMenuAccess(session))[menuKey];
  if (!own) return; // menu_key ผิด — permissionService ตอบ 400 เอง
  const missing = FLAGS.filter((f) => flags[f] === true && !own[f]).map((f) => label(menuKey, f));
  if (missing.length) deny(missing);
}

/**
 * PATCH /api/admin/permissions/:id (ส่ง patch) · POST .../restore (ไม่ส่ง)
 * เมนูดูจากแถวเดิม (นับที่ถูกลบแล้วด้วย) · PATCH ตรวจเฉพาะ flag ที่จะเปิด · กู้คืนตรวจทุก flag ที่แถวนั้นเปิดไว้ (กลับมามีผลทั้งหมด)
 */
export async function assertMayGrantExisting(session: SessionUser, permissionId: string, patch?: Flags): Promise<void> {
  if (isOwner(session) || !isObjectId(permissionId)) return;
  await dbConnect();
  const row = await permissionModel
    .findById(permissionId)
    .select(`menu_key ${FLAGS.join(" ")}`)
    .lean<({ menu_key: MenuKey } & Record<Flag, boolean | undefined>) | null>();
  if (!row) return; // ไม่พบ — permissionService ตอบ 404 เอง
  const flags = patch ?? Object.fromEntries(FLAGS.map((f) => [f, !!row[f]]));
  await assertMayGrant(session, row.menu_key, flags);
}

/** POST /api/admin/users — บทบาทของผู้ใช้ใหม่ต้องไม่เกินสิทธิ์ของผู้ทำ */
export async function assertMayAssignRoleWithin(session: SessionUser, roleId: unknown): Promise<void> {
  if (isOwner(session) || roleId == null || roleId === "") return;
  await assertRoleWithinActor(session, roleId);
}

/**
 * แก้ / ตั้งรหัสผ่าน / ปลดล็อก / ลบ / กู้คืน ผู้ใช้ — บทบาทของเป้าหมายต้องไม่เกินสิทธิ์ของผู้ทำ (นับผู้ใช้ที่ถูกลบแล้วด้วย)
 * nextRoleId (PATCH ที่ส่ง role_id): ถ้าเปลี่ยนจริง บทบาทใหม่ต้องไม่เกินสิทธิ์ของผู้ทำด้วย — กันย้ายตัวเองเข้าบทบาทที่สูงกว่า
 * บัญชีของตัวเองไม่ต้องตรวจบทบาทปัจจุบัน (เท่ากับสิทธิ์ตัวเองอยู่แล้ว) แต่ยังตรวจการย้ายบทบาท
 */
export async function assertMayManageUserWithin(
  session: SessionUser,
  userId: string,
  nextRoleId?: unknown
): Promise<void> {
  if (isOwner(session) || !isObjectId(userId)) return;
  await dbConnect();
  const user = await userModel.findById(userId).select("role_id").lean<{ role_id?: unknown } | null>();
  if (!user) return; // ไม่พบ — userService ตอบ 404 เอง
  if (userId !== session.user_id) await assertRoleWithinActor(session, user.role_id);
  const changing = nextRoleId !== undefined && nextRoleId !== null && nextRoleId !== "" && String(nextRoleId) !== String(user.role_id ?? "");
  if (changing) await assertRoleWithinActor(session, nextRoleId);
}
