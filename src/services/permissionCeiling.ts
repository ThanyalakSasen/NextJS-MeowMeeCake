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
 * owner ทำได้ทุกอย่าง
 *
 * วันหมดอายุ (Final-Backlog P5): ถ้าสิทธิ์ของผู้ทำในเมนูนั้นมี expires_at — สิทธิ์ที่ให้ / บทบาทปลายทางต้องหมดอายุ
 * ไม่ช้ากว่านั้น (ไม่มีวันหมดอายุ = เกินเสมอ) · กันผู้ที่มีสิทธิ์ชั่วคราวให้สิทธิ์ถาวรกับบทบาทอื่น แล้วย้ายตัวเองเข้าไป
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
type Flags = Partial<Record<Flag, boolean | undefined>> & { expires_at?: Date | string | null };
/** menu_key → วันหมดอายุของแถวที่มีผลอยู่ (null = ถาวร) · ไม่มีแถว = ไม่อยู่ใน map */
type Expiries = Partial<Record<MenuKey, Date | null>>;

const isOwner = (s: SessionUser) => s.role_type === "owner";

/** "payments.approve" — ใช้บอกในข้อความว่าขาดสิทธิ์ไหน */
const label = (menu: string, flag: Flag) => `${menu}.${flag.slice(4)}`;

const listShown = (items: string[]) =>
  items.slice(0, 5).join(", ") + (items.length > 5 ? ` และอีก ${items.length - 5} รายการ` : "");

function deny(missing: string[]): never {
  throw forbidden(`ให้หรือจัดการได้ไม่เกินสิทธิ์ที่ตัวเองมี — คุณไม่มีสิทธิ์ ${listShown(missing)}`);
}

function denyExpiry(menus: string[]): never {
  throw forbidden(
    `สิทธิ์ของคุณใน ${listShown(menus)} เป็นแบบชั่วคราว — ให้หรือจัดการได้เฉพาะสิทธิ์ที่หมดอายุไม่ช้ากว่าของคุณ`
  );
}

/** วันหมดอายุของแถวสิทธิ์ที่มีผลอยู่ของบทบาท (ตัดที่หมดอายุแล้วออก — ตรงกับ getEffectivePermissions) */
async function roleExpiries(roleId: string): Promise<Expiries> {
  await dbConnect();
  const now = new Date();
  const rows = await permissionModel
    .find({ role_id: roleId, deleted_at: null, $or: [{ expires_at: null }, { expires_at: { $gt: now } }] })
    .select("menu_key expires_at")
    .lean<Array<{ menu_key: MenuKey; expires_at?: Date | null }>>();
  return Object.fromEntries(rows.map((r) => [r.menu_key, r.expires_at ?? null]));
}

const toDate = (v: Date | string | null | undefined): Date | null => (v == null ? null : new Date(v));

/** สิทธิ์ที่ให้ (หมดอายุ granted) อยู่ใต้เพดานของผู้ทำ (limit) ไหม — limit null = ผู้ทำมีแบบถาวร ให้อะไรก็ได้ */
const withinExpiry = (granted: Date | null, limit: Date | null | undefined) =>
  limit == null || (granted != null && granted.getTime() <= limit.getTime());

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
  // บทบาทปลายทางไม่ใช่ owner แน่นอน (owner มีทุกอย่าง → ติด missing ไปแล้ว) — เทียบวันหมดอายุรายเมนูที่ปลายทางมี flag
  const [own, theirs] = await Promise.all([roleExpiries(session.role_id), roleExpiries(String(roleId))]);
  const late = MENU_KEYS.filter(
    (menu) => FLAGS.some((f) => target[menu]?.[f]) && !withinExpiry(theirs[menu] ?? null, own[menu])
  );
  if (late.length) denyExpiry(late);
}

/**
 * POST /api/admin/permissions — flag ที่ส่งมาเป็น true ต้องเป็นสิ่งที่ผู้ทำมีในเมนูนั้น
 * และถ้าสิทธิ์ของผู้ทำในเมนูนั้นมีวันหมดอายุ expires_at ที่ให้ต้องไม่ช้ากว่า (ไม่ส่ง / null = ถาวร = เกิน)
 */
export async function assertMayGrant(session: SessionUser, menuKey: MenuKey, flags: Flags): Promise<void> {
  if (isOwner(session)) return;
  const own = (await getMenuAccess(session))[menuKey];
  if (!own) return; // menu_key ผิด — permissionService ตอบ 400 เอง
  const missing = FLAGS.filter((f) => flags[f] === true && !own[f]).map((f) => label(menuKey, f));
  if (missing.length) deny(missing);
  if (!FLAGS.some((f) => flags[f] === true)) return; // ไม่ได้เปิดอะไร (ถอนสิทธิ์) — ไม่จำกัด
  const limit = (await roleExpiries(session.role_id))[menuKey];
  if (!withinExpiry(toDate(flags.expires_at), limit)) denyExpiry([menuKey]);
}

/**
 * PATCH /api/admin/permissions/:id (ส่ง patch) · POST .../restore (ไม่ส่ง)
 * เมนูดูจากแถวเดิม (นับที่ถูกลบแล้วด้วย) · PATCH ตรวจเฉพาะ flag ที่จะเปิด · กู้คืนตรวจทุก flag ที่แถวนั้นเปิดไว้ (กลับมามีผลทั้งหมด)
 * วันหมดอายุ: ไม่ส่ง expires_at = ใช้ของแถวเดิม · ส่ง expires_at (ยืด/ตัดวันหมดอายุ) = นับทุก flag ที่จะเปิดอยู่หลังแก้ว่าเป็นการให้ใหม่
 */
export async function assertMayGrantExisting(session: SessionUser, permissionId: string, patch?: Flags): Promise<void> {
  if (isOwner(session) || !isObjectId(permissionId)) return;
  await dbConnect();
  const row = await permissionModel
    .findById(permissionId)
    .select(`menu_key expires_at ${FLAGS.join(" ")}`)
    .lean<({ menu_key: MenuKey; expires_at?: Date | null } & Record<Flag, boolean | undefined>) | null>();
  if (!row) return; // ไม่พบ — permissionService ตอบ 404 เอง
  const rowFlags = Object.fromEntries(FLAGS.map((f) => [f, !!row[f]])) as Record<Flag, boolean>;
  let flags: Flags;
  if (!patch) flags = { ...rowFlags, expires_at: row.expires_at ?? null };
  else if (patch.expires_at !== undefined) {
    flags = { ...Object.fromEntries(FLAGS.map((f) => [f, patch[f] ?? rowFlags[f]])), expires_at: patch.expires_at };
  } else flags = { ...patch, expires_at: row.expires_at ?? null };
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
