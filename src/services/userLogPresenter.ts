/**
 * userLogPresenter — จัด before/after ของ UserLog ก่อนส่งให้หน้า "บันทึกการทำงาน"
 *
 * 1) log เก่า (ก่อนมี lib/auditDiff · ~400 แถว) เก็บ "ทั้งเอกสาร" ไว้ทั้งสองฝั่ง รวม _id/timestamps →
 *    ตัดเหลือเฉพาะฟิลด์ที่เปลี่ยนจริงด้วย diffFields (log ใหม่ diff แล้ว — ผ่านซ้ำได้ผลเดิม)
 * 2) ค่าที่เป็น ObjectId ของฟิลด์อ้างอิง (role_id, user_id, product_id …) → ชื่อของมัน
 *    รวม id ทั้งหน้าแล้วค้นทีเดียวต่อ collection · หาไม่เจอ (ถูกลบถาวร) = คง id เดิมไว้
 * 3) log เก่าที่ตัดเหลือแค่ฟิลด์ที่เปลี่ยนจะไม่รู้ว่าเป็นรายการไหน → ใส่ชื่อรายการต่อท้ายข้อความ (ถ้ายังไม่มี)
 *    เอกสารที่ไม่มีชื่อ (สิทธิ์เมนู ฯลฯ) → `context` = ฟิลด์ระบุตัวตน เช่น { role_id: "พนักงานขาย", menu_key: "pos" }
 *    ข้อความเก่าที่มีชื่อ collection อังกฤษปน ("แก้ไขTemporaryPermissions") → ภาษาไทย
 * ไม่แก้ข้อมูลใน DB — แปลงตอนอ่านเท่านั้น
 */
import type { Model } from "mongoose";
import { diffFields, docLabel, snapshot } from "../lib/auditDiff";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";
import productModel from "../models/productModel";
import ingredientModel from "../models/ingredientModel";
import unitModel from "../models/unitModel";
import promotionModel from "../models/promotionModel";
import orderModel from "../models/orderModel";
import preorderModel from "../models/preorderModel";
import preorderRoundModel from "../models/preorderRoundModel";
import productCategoryModel from "../models/productCategoryModel";
import ingredientCategoryModel from "../models/ingredientCategoryModel";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";

type Source = { model: Model<any>; field: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

const USERS: Source = { model: userModel, field: "user_fullname" };

/** ชื่อฟิลด์อ้างอิง → collection + ฟิลด์ชื่อ */
const REF_SOURCES: Record<string, Source> = {
  role_id: { model: roleModel, field: "role_name" },
  user_id: USERS,
  granted_by: USERS,
  performed_by: USERS,
  verified_by: USERS,
  cancelled_by: USERS,
  revoked_by: USERS,
  replied_by: USERS,
  read_by: USERS,
  phone_primary_user_id: USERS,
  phone_secondary_user_id: USERS,
  product_id: { model: productModel, field: "product_name_th" },
  ingredient_id: { model: ingredientModel, field: "ingredient_name" },
  unit_id: { model: unitModel, field: "unit_name" },
  promotion_id: { model: promotionModel, field: "promotion_name" },
  order_id: { model: orderModel, field: "order_no" },
  preorder_id: { model: preorderModel, field: "preorder_no" },
  round_id: { model: preorderRoundModel, field: "round_name" },
  product_category_id: { model: productCategoryModel, field: "product_category_name" },
  category_id: { model: productCategoryModel, field: "product_category_name" },
  assigned_to: USERS,
  ingredient_category_id: { model: ingredientCategoryModel, field: "ingredient_category_name" },
  recipe_id: { model: recipeModel, field: "recipe_name" },
  component_id: { model: componentModel, field: "component_name" },
};

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/** ฟิลด์ที่บอกว่าเอกสารไม่มีชื่อเป็นของใคร/อะไร (สิทธิ์เมนู = บทบาท + เมนู) */
const CONTEXT_KEYS = ["role_id", "user_id", "menu_key", "product_id", "ingredient_id", "order_id", "preorder_id"];

/** ข้อความ log เก่าที่มีชื่อ collection อังกฤษปน */
const LEGACY_NOUN: Record<string, string> = {
  TemporaryPermissions: "สิทธิ์ชั่วคราว",
  ReviewPresets: "ข้อความรีวิวสำเร็จรูป",
};

type Changes = Record<string, unknown> | null | undefined;
interface LogLike {
  action?: string;
  before?: unknown;
  after?: unknown;
  details?: unknown;
  context?: Record<string, unknown> | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** ชื่อฟิลด์สุดท้ายของ path: "weekly_markets[ตลาด].role_id" → "role_id" */
const leafOf = (path: string) => path.replace(/\[[^\]]*\]/g, "").split(".").pop() ?? path;

/** before/after เหลือเฉพาะที่เปลี่ยน (หรือ snapshot ไม่มีฟิลด์ระบบ เมื่อมีฝั่งเดียว) */
function trimChanges(log: LogLike): { before: Changes; after: Changes } {
  // log สร้างแบบเก่าเก็บ before เป็น { ฟิลด์: null … } — ถือว่าไม่มีค่าก่อน (แสดงแบบ "ข้อมูลที่สร้าง")
  const b = isRecord(log.before) && Object.values(log.before).some((v) => v != null) ? log.before : null;
  const a = isRecord(log.after) ? log.after : null;
  if (b && a) {
    const diff = diffFields(b, a);
    return { before: diff?.before ?? null, after: diff?.after ?? null };
  }
  return { before: b ? snapshot(b) ?? null : null, after: a ? snapshot(a) ?? null : null };
}

/** เรียก fn กับทุกค่าอ้างอิง (ไล่ object ซ้อน 1 ชั้นด้วย — แถวที่เพิ่ม/ลบทั้งแถวเก็บเป็น object) */
function eachRef(changes: Changes, fn: (src: Source, id: string, set: (v: unknown) => void) => void) {
  if (!changes) return;
  const visit = (container: Record<string, unknown>, key: string, src: Source | undefined) => {
    const v = container[key];
    if (src && typeof v === "string" && OBJECT_ID_RE.test(v)) fn(src, v, (x) => (container[key] = x));
    else if (src && Array.isArray(v)) {
      v.forEach((x, i) => {
        if (typeof x === "string" && OBJECT_ID_RE.test(x)) fn(src, x, (y) => (v[i] = y));
      });
    } else if (isRecord(v)) {
      for (const k of Object.keys(v)) visit(v, k, REF_SOURCES[k]);
    }
  };
  for (const path of Object.keys(changes)) visit(changes, path, REF_SOURCES[leafOf(path)]);
}

/** ฟิลด์ระบุตัวตนจาก object หนึ่ง (null = ไม่มีสักตัว) */
function contextOf(doc: unknown): Record<string, unknown> | null {
  if (!isRecord(doc)) return null;
  const context = Object.fromEntries(CONTEXT_KEYS.filter((k) => doc[k] != null).map((k) => [k, String(doc[k])]));
  return Object.keys(context).length ? context : null;
}

/**
 * log เก่าเก็บทั้งเอกสาร (มี _id) — ชื่อรายการ/ฟิลด์ระบุตัวตนอ่านจากเอกสารนั้น
 * log ใหม่ที่ diff แล้วของเอกสารไม่มีชื่อ (เช่น แก้ไขสิทธิ์เมนู) ส่งฟิลด์ระบุตัวตนมาใน details แทน
 */
function identify(log: LogLike): Pick<LogLike, "action" | "context"> {
  let action = log.action ?? "";
  for (const [en, th] of Object.entries(LEGACY_NOUN)) action = action.replace(en, th);
  const full = [log.after, log.before].find((d): d is Record<string, unknown> => isRecord(d) && "_id" in d);
  if (!full) return { action, context: contextOf(log.details) };
  const label = docLabel(full);
  if (label) return { action: action.includes(`"`) ? action : `${action} "${label}"` };
  return { action, context: contextOf(full) };
}

export async function presentLogs<T extends LogLike>(logs: T[]): Promise<T[]> {
  const trimmed = logs.map((l) => ({ ...l, ...identify(l), ...trimChanges(l) }));

  // รวม id ต่อ collection
  const wanted = new Map<Source, Set<string>>();
  for (const l of trimmed) {
    for (const side of [l.before, l.after, l.context]) {
      eachRef(side, (src, id) => {
        if (!wanted.has(src)) wanted.set(src, new Set());
        wanted.get(src)!.add(id);
      });
    }
  }

  const names = new Map<Source, Map<string, string>>();
  await Promise.all(
    [...wanted].map(async ([src, ids]) => {
      const docs = await src.model
        .find({ _id: { $in: [...ids] } })
        .select(src.field)
        .lean<Record<string, unknown>[]>()
        .catch(() => []);
      names.set(src, new Map(docs.map((d) => [String(d._id), String(d[src.field] ?? "")])));
    }),
  );

  for (const l of trimmed) {
    for (const side of [l.before, l.after, l.context]) {
      eachRef(side, (src, id, set) => {
        const name = names.get(src)?.get(id);
        if (name) set(name);
      });
    }
  }
  return trimmed;
}
