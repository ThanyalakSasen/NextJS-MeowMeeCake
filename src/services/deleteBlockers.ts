// ─────────────────────────────────────────────────────────────
// deleteBlockers — เหตุที่ลบสินค้า/วัตถุดิบ/สูตรยังไม่ได้ เป็นรายการ (ผู้ใช้ขอ 2026-10-31)
//   หน้าจอเปิด modal แสดงรายการนี้ (GET .../delete-blockers) พร้อมปุ่มแก้ทีละข้อ (action) แล้วลบต่อได้
//   remove()/deleteProduct() เรียก assertDeletable() — เหลือข้อไหน = 409 (ข้อความรวมทุกข้อ + details.blockers)
//
//   สินค้า:  stock (ปรับสต็อกเอง) · round (อยู่ในรอบตั้งเวลา/เปิดรับ — action เอาออก/ปิดการขายในรอบ)
//           · preorders (พรีออเดอร์ที่ยังไม่ผลิต — action ยกเลิกสินค้าในรอบ: ออเดอร์ + ใบสั่งผลิตของรอบยังอยู่ ผลิตต่อได้
//             แล้วลบสินค้าได้เลย · ผู้ใช้เลือก 2026-10-31) · production (ใบสั่งผลิตค้าง — ยกเว้นของรอบที่ยกเลิกสินค้าแล้ว)
//   วัตถุดิบ: stock · recipe / component (ใช้อยู่ — action เอาวัตถุดิบออกจากสูตร/ส่วนประกอบ)
//   สูตร:    production (ใบสั่งผลิตค้าง) · product (สูตรสุดท้ายของสินค้า — action ยกเลิกการผูกแล้วลบ)
//   ส่วนประกอบ: parent_recipe (สูตรหลักที่ใช้อยู่ — action ยกเลิกการผูกกับสูตรหลัก)
// ไฟล์นี้ import แค่ model (service ต่าง ๆ import ไฟล์นี้ — กัน import วน)
// ─────────────────────────────────────────────────────────────
import type { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { conflict } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import productModel from "../models/productModel";
import ingredientModel from "../models/ingredientModel";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderModel from "../models/preorderModel";
import productionItemModel from "../models/productionItemModel";
import productionOrderModel from "../models/productionOrderModel";

export type BlockerKind = "stock" | "round" | "preorders" | "production" | "recipe" | "component" | "product" | "parent_recipe";
export type BlockerAction =
  | "remove_from_round" // รายการในรอบยังไม่มีคนจอง → เอาออกจากรอบ
  | "close_round_item" // มีคนจองแล้ว → ปิดการขายในรอบ (ออเดอร์เดิมยังอยู่ ผลิตตามเดิม)
  | "release_preorders" // มีออเดอร์ค้าง → ยกเลิกสินค้าในรอบ (ออเดอร์/การผลิตของรอบยังอยู่) แล้วลบสินค้าได้
  | "unlink_recipe" // เอาวัตถุดิบออกจากสูตร
  | "unlink_component" // เอาวัตถุดิบออกจากส่วนประกอบ
  | "unlink_product" // ยกเลิกการผูกสินค้าแล้วลบสูตร
  | "unlink_parent_recipe"; // เอาส่วนประกอบออกจากสูตรหลัก

export interface DeleteBlocker {
  kind: BlockerKind;
  /** id ของสิ่งที่ action ไปแก้ (round item / recipe / component / product) */
  ref_id: string | null;
  /** ชื่อรอบ / เลขใบสั่งผลิต / ชื่อสูตร / ชื่อสินค้า */
  label: string;
  /** ตัวเลขประกอบ (สต็อก · ยอดจอง · จำนวนออเดอร์ค้าง) */
  qty: number | null;
  unit: string | null;
  action: BlockerAction | null;
}

/** ออเดอร์พรีออเดอร์ที่ยังไม่ได้ผลิต (พร้อมรับ/เสร็จ/ยกเลิก = ผลิตแล้วหรือไม่ต้องผลิต) */
const UNPRODUCED = ["pending", "confirmed", "preparing"];

const fmt = (n: number) => n.toLocaleString("th-TH");

/** ข้อความรวม (ใช้เป็น message ของ 409 — หน้าจอเก่า/เทสต์อ่านได้) */
export function describeBlocker(b: DeleteBlocker): string {
  const unit = b.unit ? ` ${b.unit}` : "";
  switch (b.kind) {
    case "stock":
      return `ยังมีของในสต็อก ${fmt(b.qty ?? 0)}${unit}`;
    case "round":
      return `อยู่ในรอบพรีออเดอร์ "${b.label}"${b.qty ? ` (จองแล้ว ${fmt(b.qty)} ชิ้น)` : ""}`;
    case "preorders":
      return `มีพรีออเดอร์ที่ยังไม่ผลิต ${fmt(b.qty ?? 0)} ออเดอร์ ในรอบ "${b.label}"`;
    case "production":
      return `อยู่ในใบสั่งผลิตที่ยังไม่เสร็จ ${b.label}`;
    case "recipe":
      return `สูตร "${b.label}" ใช้อยู่`;
    case "component":
      return `ส่วนประกอบ "${b.label}" ใช้อยู่`;
    case "product":
      return `เป็นสูตรเดียวของสินค้า "${b.label}"`;
    case "parent_recipe":
      return `สูตรหลัก "${b.label}" ใช้ส่วนประกอบนี้อยู่`;
  }
}

export function assertNoBlockers(noun: string, blockers: DeleteBlocker[]): void {
  if (blockers.length === 0) return;
  throw conflict(`ลบ${noun}นี้ยังไม่ได้ — ${blockers.map(describeBlocker).join(" · ")}`, { blockers });
}

/** excludeRounds = รอบที่ยกเลิกสินค้าไปแล้ว — ใบสั่งผลิตของรอบนั้นผลิตต่อได้ ไม่กันลบสินค้า */
async function openProductionBlockers(match: Record<string, unknown>, excludeRounds: Types.ObjectId[] = []): Promise<DeleteBlocker[]> {
  const orderIds = await productionItemModel.distinct("production_order_id", {
    ...match,
    deleted_at: null,
    item_status: { $ne: "cancelled" },
  });
  if (orderIds.length === 0) return [];
  const open = await productionOrderModel
    .find({
      _id: { $in: orderIds },
      deleted_at: null,
      production_status: { $in: ["planned", "in_progress"] },
      ...(excludeRounds.length ? { round_id: { $nin: excludeRounds } } : {}),
    })
    .select("production_no")
    .sort({ production_date: 1 })
    .lean<Array<{ _id: Types.ObjectId; production_no: string }>>();
  return open.map((o) => ({ kind: "production", ref_id: String(o._id), label: o.production_no, qty: null, unit: null, action: null }));
}

// ── สินค้า ────────────────────────────────────────────────────
export async function productDeleteBlockers(id: string): Promise<DeleteBlocker[]> {
  await dbConnect();
  assertObjectId(id);
  const out: DeleteBlocker[] = [];

  const p = await productModel.findById(id).select("product_stock_quantity").lean<{ product_stock_quantity?: number | null } | null>();
  const stock = Number(p?.product_stock_quantity ?? 0);
  if (stock > 0) out.push({ kind: "stock", ref_id: id, label: "", qty: stock, unit: "ชิ้น", action: null });

  const items = await preorderRoundItemModel
    .find({ product_id: id, deleted_at: null })
    .select("round_id current_qty is_active released_at")
    .lean<Array<{ _id: Types.ObjectId; round_id: Types.ObjectId; current_qty?: number; is_active?: boolean; released_at?: Date | null }>>();
  const releasedRounds = items.filter((i) => i.released_at).map((i) => i.round_id);
  if (items.length) {
    const rounds = await preorderRoundModel
      .find({ _id: { $in: items.map((i) => i.round_id) }, deleted_at: null, round_status: { $ne: "cancelled" } })
      .select("round_name round_status open_date")
      .sort({ open_date: 1 })
      .lean<Array<{ _id: Types.ObjectId; round_name: string; round_status: string }>>();
    // ออเดอร์ที่ยังไม่ผลิตต่อรอบ (นับจากรายการพรีออเดอร์ของสินค้านี้)
    const preorderIds = await preorderItemModel.distinct("preorder_id", { product_id: id, deleted_at: null });
    const pending = preorderIds.length
      ? await preorderModel.aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: { _id: { $in: preorderIds }, deleted_at: null, order_status: { $in: UNPRODUCED } } },
          { $group: { _id: "$round_id", n: { $sum: 1 } } },
        ])
      : [];
    const pendingByRound = new Map(pending.map((r) => [String(r._id), r.n]));

    for (const r of rounds) {
      const item = items.find((i) => String(i.round_id) === String(r._id));
      if (!item || item.released_at) continue;
      const live = r.round_status === "scheduled" || r.round_status === "open";
      if (live && item.is_active !== false) {
        const booked = Number(item.current_qty ?? 0);
        out.push({
          kind: "round",
          ref_id: String(item._id),
          label: r.round_name,
          qty: booked,
          unit: "ชิ้น",
          action: booked > 0 ? "close_round_item" : "remove_from_round",
        });
      }
      const n = pendingByRound.get(String(r._id)) ?? 0;
      if (n > 0) out.push({ kind: "preorders", ref_id: String(item._id), label: r.round_name, qty: n, unit: "ออเดอร์", action: "release_preorders" });
    }
  }

  out.push(...(await openProductionBlockers({ product_id: id }, releasedRounds)));
  return out;
}

// ── วัตถุดิบ ───────────────────────────────────────────────────
export async function ingredientDeleteBlockers(id: string): Promise<DeleteBlocker[]> {
  await dbConnect();
  assertObjectId(id);
  const out: DeleteBlocker[] = [];

  const ing = await ingredientModel
    .findById(id)
    .select("current_stock unit_id")
    .populate("unit_id", "unit_abbr")
    .lean<{ current_stock?: number; unit_id?: { unit_abbr?: string } | null } | null>();
  const stock = Number(ing?.current_stock ?? 0);
  if (stock > 0) out.push({ kind: "stock", ref_id: id, label: "", qty: stock, unit: ing?.unit_id?.unit_abbr ?? null, action: null });

  const match = { "ingredients.ingredient_id": id, deleted_at: null };
  const [recipes, components] = await Promise.all([
    recipeModel.find(match).select("recipe_name").sort({ recipe_name: 1 }).lean<Array<{ _id: Types.ObjectId; recipe_name?: string }>>(),
    componentModel.find(match).select("component_name").sort({ component_name: 1 }).lean<Array<{ _id: Types.ObjectId; component_name?: string }>>(),
  ]);
  for (const r of recipes) out.push({ kind: "recipe", ref_id: String(r._id), label: r.recipe_name ?? "", qty: null, unit: null, action: "unlink_recipe" });
  for (const c of components) out.push({ kind: "component", ref_id: String(c._id), label: c.component_name ?? "", qty: null, unit: null, action: "unlink_component" });
  return out;
}

// ── สูตร ──────────────────────────────────────────────────────
/** allowLastRecipe = ผู้ใช้กด "ยกเลิกการผูกสินค้า" แล้ว — ไม่นับข้อ product */
export async function recipeDeleteBlockers(id: string, opts: { allowLastRecipe?: boolean } = {}): Promise<DeleteBlocker[]> {
  await dbConnect();
  assertObjectId(id);
  const out = await openProductionBlockers({ recipe_id: id });

  if (!opts.allowLastRecipe) {
    const recipe = await recipeModel.findById(id).select("product_id").lean<{ product_id?: Types.ObjectId } | null>();
    if (recipe?.product_id) {
      const product = await productModel
        .findOne({ _id: recipe.product_id, deleted_at: null })
        .select("product_name_th")
        .lean<{ _id: Types.ObjectId; product_name_th?: string } | null>();
      if (product) {
        const others = await recipeModel.countDocuments({ product_id: recipe.product_id, deleted_at: null, _id: { $ne: id } });
        if (others === 0) {
          out.push({ kind: "product", ref_id: String(product._id), label: product.product_name_th ?? "", qty: null, unit: null, action: "unlink_product" });
        }
      }
    }
  }
  return out;
}

// ── ส่วนประกอบ (สูตรย่อย) ─────────────────────────────────────
/** สูตรหลักที่ยังใช้ส่วนประกอบนี้ — ลบแล้วสูตรหลักคิดต้นทุน/ตัดวัตถุดิบไม่ครบ (ผู้ใช้ขอ 2026-10-31) */
export async function componentDeleteBlockers(id: string): Promise<DeleteBlocker[]> {
  await dbConnect();
  assertObjectId(id);
  const recipes = await recipeModel
    .find({ "components.component_id": id, deleted_at: null })
    .select("recipe_name")
    .sort({ recipe_name: 1 })
    .lean<Array<{ _id: Types.ObjectId; recipe_name?: string }>>();
  return recipes.map((r) => ({
    kind: "parent_recipe",
    ref_id: String(r._id),
    label: r.recipe_name ?? "",
    qty: null,
    unit: null,
    action: "unlink_parent_recipe",
  }));
}
