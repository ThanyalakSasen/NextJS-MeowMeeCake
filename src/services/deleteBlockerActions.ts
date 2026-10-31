// ─────────────────────────────────────────────────────────────
// deleteBlockerActions — ปุ่มแก้ทีละข้อใน modal "ลบยังไม่ได้" (services/deleteBlockers.ts · ผู้ใช้ขอ 2026-10-31)
//   unlinkIngredient    — เอาวัตถุดิบออกจากสูตร/ส่วนประกอบ (หักต้นทุน/แบทช์ของวัตถุดิบนั้นออก — ไม่คิดใหม่ทั้งสูตร
//                         กันต้นทุนที่แอดมินกรอกเองหาย และไม่ validate วัตถุดิบตัวอื่นในสูตรซ้ำ)
//   unlinkComponent     — เอาส่วนประกอบออกจากสูตรหลัก (หักต้นทุนเฉพาะส่วนประกอบนั้น แบบเดียวกัน)
//   releaseFromRound    — เอาสินค้าออกจากรอบที่ตั้งเวลา/เปิดรับ: ยังไม่มีคนจอง = ลบออกจากรอบ ·
//                         จองแล้ว = ปิดการขายในรอบ (is_active=false) — ออเดอร์เดิม + รายการผลิตยังอยู่ครบ
// ─────────────────────────────────────────────────────────────
import type { Types } from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, notFound } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { toSatang } from "../lib/money";
import recipeModel from "../models/recipeModel";
import componentModel from "../models/componentModel";
import ingredientModel from "../models/ingredientModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderRoundModel from "../models/preorderRoundModel";
import * as preorderRoundService from "./preorderRoundService";

type BomDoc = {
  _id: Types.ObjectId;
  recipe_name?: string;
  component_name?: string;
  estimated_cost_per_batch?: number;
  ingredients?: Array<{ ingredient_id: Types.ObjectId; quantity: number }>;
};

export async function unlinkIngredient(ingredientId: string, kind: "recipe" | "component", refId: string) {
  await dbConnect();
  assertObjectId(ingredientId);
  assertObjectId(refId, "ref_id");
  const model = (kind === "recipe" ? recipeModel : componentModel) as typeof recipeModel;
  const doc = await model.findOne({ _id: refId, deleted_at: null }).lean<BomDoc | null>();
  if (!doc) throw notFound(kind === "recipe" ? "ไม่พบสูตรที่ระบุ" : "ไม่พบส่วนประกอบที่ระบุ");
  const removed = (doc.ingredients ?? []).filter((it) => String(it.ingredient_id) === ingredientId);
  if (removed.length === 0) throw badRequest("วัตถุดิบนี้ไม่ได้อยู่ในรายการนี้แล้ว");

  const ing = await ingredientModel.findById(ingredientId).select("cost_per_unit").lean<{ cost_per_unit?: number } | null>();
  const removedCost = removed.reduce((s, it) => s + Number(it.quantity || 0) * Number(ing?.cost_per_unit ?? 0), 0);
  const cost = toSatang(Math.max(0, Number(doc.estimated_cost_per_batch ?? 0) - removedCost));

  await model.updateOne(
    { _id: refId },
    { $pull: { ingredients: { ingredient_id: ingredientId } }, $set: { estimated_cost_per_batch: cost } },
  );
  return { kind, ref_id: refId, label: doc.recipe_name ?? doc.component_name ?? "", estimated_cost_per_batch: cost };
}

export async function unlinkComponent(componentId: string, recipeId: string) {
  await dbConnect();
  assertObjectId(componentId);
  assertObjectId(recipeId, "recipe_id");
  const recipe = await recipeModel
    .findOne({ _id: recipeId, deleted_at: null })
    .lean<{ recipe_name?: string; estimated_cost_per_batch?: number; components?: Array<{ component_id: Types.ObjectId; quantity: number }> } | null>();
  if (!recipe) throw notFound("ไม่พบสูตรที่ระบุ");
  const removed = (recipe.components ?? []).filter((it) => String(it.component_id) === componentId);
  if (removed.length === 0) throw badRequest("ส่วนประกอบนี้ไม่ได้อยู่ในสูตรนี้แล้ว");

  const comp = await componentModel
    .findById(componentId)
    .select("estimated_cost_per_batch yield_qty")
    .lean<{ estimated_cost_per_batch?: number; yield_qty?: number } | null>();
  const perUnit = comp?.yield_qty ? Number(comp.estimated_cost_per_batch ?? 0) / comp.yield_qty : 0;
  const removedCost = removed.reduce((s, it) => s + Number(it.quantity || 0) * perUnit, 0);
  const cost = toSatang(Math.max(0, Number(recipe.estimated_cost_per_batch ?? 0) - removedCost));

  await recipeModel.updateOne(
    { _id: recipeId },
    { $pull: { components: { component_id: componentId } }, $set: { estimated_cost_per_batch: cost } },
  );
  return { recipe_id: recipeId, label: recipe.recipe_name ?? "", estimated_cost_per_batch: cost };
}

export async function releaseFromRound(productId: string, roundItemId: string) {
  await dbConnect();
  assertObjectId(productId);
  assertObjectId(roundItemId, "round_item_id");
  const item = await preorderRoundItemModel
    .findOne({ _id: roundItemId, product_id: productId, deleted_at: null })
    .lean<{ round_id: Types.ObjectId; current_qty?: number } | null>();
  if (!item) throw notFound("ไม่พบสินค้านี้ในรอบที่ระบุ");
  const round = await preorderRoundModel.findById(item.round_id).select("round_name round_status").lean<{ round_name: string; round_status: string } | null>();
  if (!round || (round.round_status !== "scheduled" && round.round_status !== "open")) {
    throw conflict("รอบนี้ปิดรับหรือยกเลิกแล้ว — ไม่ต้องเอาสินค้าออก");
  }
  if (Number(item.current_qty ?? 0) > 0) {
    await preorderRoundService.updateRoundItem(roundItemId, { is_active: false });
    return { round_item_id: roundItemId, round_name: round.round_name, result: "closed" as const };
  }
  await preorderRoundService.removeRoundItem(roundItemId);
  return { round_item_id: roundItemId, round_name: round.round_name, result: "removed" as const };
}
