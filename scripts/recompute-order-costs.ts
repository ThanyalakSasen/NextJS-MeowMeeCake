import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import { writeFileSync, mkdirSync } from "node:fs";
import dbConnect from "../src/lib/dbConnect";

/**
 * คำนวณ cost_per_unit ของรายการในออเดอร์/พรีออเดอร์ใหม่จากสูตรปัจจุบัน
 *
 * ค่าเริ่มต้น = DRY-RUN (ไม่เขียนอะไร) — ต้องใส่ --apply ถึงจะเขียนจริง
 *   npx tsx scripts/recompute-order-costs.ts            (dry-run + เขียน scripts/recompute-order-costs.report.json)
 *   npx tsx scripts/recompute-order-costs.ts --apply
 *
 * ปัญหา: รายการที่สร้างในช่วง [cutoff, fixedAt) คำนวณต้นทุนจากสูตรที่ยังเป็น "บาท" แล้วบันทึกลงช่องสตางค์
 * (เช่น 27 บาท เก็บเป็น 27 สตางค์) → dashboard cogs/กำไรต่ำกว่าจริง ~100 เท่า ต้องคำนวณใหม่ ไม่ใช่คูณ 100
 * เพราะค่าเดิมถูกปัดเป็นบาทเต็มไปแล้ว (เสียเศษสตางค์)
 *
 * สูตรเดียวกับโค้ดจริง (recipeService.getUnitCostByProduct):
 *   สูตรล่าสุด (created_at ใหม่สุด, ไม่ถูกลบ) ของสินค้า → round(estimated_cost_per_batch / yield_qty)  [สตางค์]
 *   ไม่มีสูตรหรือ yield_qty ≤ 0 → ใช้ products.purchase_cost · ไม่มีทั้งคู่ → ไม่แตะ (NO_SOURCE)
 * ⚠️ เป็นต้นทุน "ตามสูตรวันนี้" ไม่ใช่ต้นทุนจริง ณ วันที่ขาย (ไม่มีข้อมูลย้อนหลังให้ทำอย่างอื่น)
 *
 * สแกนทุกรายการที่ cost_per_unit เป็นตัวเลข แล้วแบ่ง:
 *   PROPOSE   อยู่ในช่วงเสี่ยง + หาต้นทุนจากสูตรได้ + ค่าใหม่ "สมเหตุสมผล" เทียบค่าเดิม×100 (ต่างไม่เกิน 50%)
 *   REVIEW    อยู่นอกช่วงเสี่ยง หรือค่าใหม่ต่างจากค่าเดิม×100 มาก (สูตรเปลี่ยนมาก/สูตรแคชล้าสมัย) — ไม่แตะ
 *   NO_SOURCE หาต้นทุนใหม่ไม่ได้ — ไม่แตะ
 *
 * ความปลอดภัย (แบบเดียวกับ fix-money-units.ts): filter { _id, cost_per_unit: ค่าเดิม } ก่อนเขียน · ไม่แตะ updated_at ·
 * สำรองลง scripts/backups/ · marker money_fix_order_costs_applied กันรันซ้ำ · เมื่อสำเร็จลง marker
 * money_to_satang_3_11_order_items_cost_per_unit / _preorder_items_cost_per_unit ด้วย เพื่อให้
 * `npm run migrate:money-to-satang` ไม่คูณ ×100 ทับค่าที่คำนวณใหม่แล้ว
 */

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const APPLY = process.argv.includes("--apply");
const MARKER = "money_fix_order_costs_applied";
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const MAX_DIVERGENCE = 0.5;

async function markerTime(db: mongoose.mongo.Db, id: string): Promise<Date | null> {
  return (await db.collection<{ _id: string; applied_at: Date }>("migrations").findOne({ _id: id }))?.applied_at ?? null;
}

interface CostSource { unit: number | null; via: "recipe" | "purchase_cost" | "none"; recipe?: string; cacheDriftPct?: number | null }

async function costSource(db: mongoose.mongo.Db, productId: unknown, memo: Map<string, CostSource>): Promise<CostSource> {
  const key = String(productId);
  const hit = memo.get(key);
  if (hit) return hit;

  let result: CostSource = { unit: null, via: "none" };
  const recipe = await db.collection("recipes").find({ product_id: productId, deleted_at: null }).sort({ created_at: -1 }).limit(1).next();
  if (recipe && recipe.yield_qty > 0) {
    // ตรวจว่าค่าแคช estimated_cost_per_batch ยังตรงกับต้นทุนวัตถุดิบ/ส่วนประกอบปัจจุบันไหม (ข้อมูลประกอบการตัดสินใจ ไม่ได้ใช้คำนวณ)
    let drift: number | null = null;
    try {
      const ingIds = (recipe.ingredients ?? []).map((i: Doc) => i.ingredient_id);
      const compIds = (recipe.components ?? []).map((c: Doc) => c.component_id);
      const ings = ingIds.length ? await db.collection("ingredients").find({ _id: { $in: ingIds } }).toArray() : [];
      const comps = compIds.length ? await db.collection("components").find({ _id: { $in: compIds } }).toArray() : [];
      const ingCost = new Map(ings.map((x) => [String(x._id), x.cost_per_unit ?? 0]));
      const compCost = new Map(comps.map((x) => [String(x._id), x.yield_qty ? (x.estimated_cost_per_batch ?? 0) / x.yield_qty : 0]));
      const sum =
        (recipe.ingredients ?? []).reduce((s: number, i: Doc) => s + (i.quantity ?? 0) * (ingCost.get(String(i.ingredient_id)) ?? 0), 0) +
        (recipe.components ?? []).reduce((s: number, c: Doc) => s + (c.quantity ?? 0) * (compCost.get(String(c.component_id)) ?? 0), 0);
      const est = recipe.estimated_cost_per_batch ?? 0;
      drift = est > 0 ? Math.abs(Math.round(sum) - est) / est : Math.round(sum) > 0 ? 1 : 0;
    } catch {
      drift = null;
    }
    result = { unit: Math.round(recipe.estimated_cost_per_batch / recipe.yield_qty), via: "recipe", recipe: String(recipe.recipe_name ?? recipe._id), cacheDriftPct: drift };
  } else {
    const product = await db.collection("products").findOne({ _id: productId as mongoose.Types.ObjectId });
    if (product?.purchase_cost != null) result = { unit: product.purchase_cost, via: "purchase_cost" };
  }
  memo.set(key, result);
  return result;
}

interface Row {
  collection: string;
  item_id: string;
  parent_no: string;
  parent_created_at: string;
  product: string;
  quantity: number;
  now: number;
  proposed: number | null;
  alt_now_x100: number;
  via: CostSource["via"];
  recipe: string | null;
  cache_drift_pct: number | null;
  verdict: "PROPOSE" | "REVIEW" | "NO_SOURCE";
  reasons: string[];
  notes: string[];
}

async function main() {
  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) throw new Error("ไม่มี mongoose.connection.db");

  if (await db.collection<{ _id: string }>("migrations").findOne({ _id: MARKER })) {
    throw new Error(`เคยรัน recompute-order-costs --apply สำเร็จแล้ว (marker ${MARKER}) — ห้ามรันซ้ำ`);
  }

  const cutoff = arg("cutoff") ? new Date(arg("cutoff")!) : await markerTime(db, "money_to_satang_3_11_preorders");
  const fixedAt = arg("fixed-at") ? new Date(arg("fixed-at")!) : await markerTime(db, "money_fix_units_applied");
  if (!cutoff || !fixedAt) throw new Error("หา cutoff/fixedAt จาก marker ไม่เจอ — ระบุ --cutoff=ISO --fixed-at=ISO");

  console.log(APPLY ? "โหมด APPLY — จะเขียนลงฐานข้อมูลจริง\n" : "โหมด DRY-RUN — ไม่เขียนอะไรลงฐานข้อมูล (ใส่ --apply เพื่อเขียนจริง)\n");
  console.log(`ช่วงเสี่ยง: ${cutoff.toISOString()} → ${fixedAt.toISOString()}\n`);

  const memo = new Map<string, CostSource>();
  const rows: Row[] = [];

  for (const [itemsCol, parentCol, idField, noField] of [
    ["orderitems", "orders", "order_id", "order_no"],
    ["preorderitems", "preorders", "preorder_id", "preorder_no"],
  ] as const) {
    const items = await db.collection(itemsCol).find({ cost_per_unit: { $type: "number" } }).toArray();
    for (const it of items) {
      const parent = await db.collection(parentCol).findOne({ _id: it[idField] });
      const created: Date | null = parent?.created_at ?? null;
      const inWindow = created !== null && created >= cutoff && created < fixedAt;
      const src = it.product_id ? await costSource(db, it.product_id, memo) : ({ unit: null, via: "none" } as CostSource);
      const reasons: string[] = [];
      const notes: string[] = [];
      let verdict: Row["verdict"] = "PROPOSE";

      if (src.unit === null) {
        verdict = "NO_SOURCE";
        reasons.push("ไม่มีสูตร (หรือ yield_qty ≤ 0) และไม่มี purchase_cost");
      } else {
        if (!inWindow) {
          verdict = "REVIEW";
          reasons.push("อยู่นอกช่วงเสี่ยง — ค่าเดิมอาจไม่ได้ผิดจากปัญหาบาท/สตางค์");
        }
        const alt = it.cost_per_unit * 100;
        const divergence = alt > 0 ? Math.abs(src.unit - alt) / alt : src.unit > 0 ? 1 : 0;
        if (divergence > MAX_DIVERGENCE) {
          verdict = "REVIEW";
          reasons.push(`ค่าใหม่ ${src.unit} ต่างจากค่าเดิม×100 (${alt}) ${(divergence * 100).toFixed(0)}% — สูตรเปลี่ยนไปมากหรือแคชล้าสมัย`);
        }
        // ข้อสังเกตเท่านั้น ไม่บล็อก: โค้ดจริงใช้ estimated_cost_per_batch ที่เก็บไว้ (ซึ่งอาจตั้งเองโดยตั้งใจ) ไม่ได้คำนวณจากวัตถุดิบ
        // ถ้าค่านั้นสอดคล้องกับค่าเดิม×100 (ผ่านเกณฑ์ divergence ด้านบน) แสดงว่าเป็นค่าเดียวกับที่ใช้ตอนสร้างออเดอร์
        if (src.cacheDriftPct != null && src.cacheDriftPct > 0.05) {
          notes.push(`หมายเหตุ: estimated_cost_per_batch ของสูตร "${src.recipe}" ต่างจากต้นทุนวัตถุดิบ/ส่วนประกอบปัจจุบัน ${(src.cacheDriftPct * 100).toFixed(0)}% (อาจตั้งค่าเอง)`);
        }
      }

      rows.push({
        collection: itemsCol,
        item_id: String(it._id),
        parent_no: String(parent?.[noField] ?? it[idField]),
        parent_created_at: created?.toISOString() ?? "?",
        product: String(it.product_snapshot?.product_name_th ?? it.product_id),
        quantity: it.quantity,
        now: it.cost_per_unit,
        proposed: src.unit,
        alt_now_x100: it.cost_per_unit * 100,
        via: src.via,
        recipe: src.recipe ?? null,
        cache_drift_pct: src.cacheDriftPct ?? null,
        verdict,
        reasons,
        notes,
      });
    }
  }

  const baht = (s: number) => (s / 100).toFixed(2);
  console.log(`รายการที่ cost_per_unit เป็นตัวเลข: ${rows.length}\n`);
  for (const r of rows) {
    const tag = { PROPOSE: "จะแก้      ", REVIEW: "ต้องดูเอง   ", NO_SOURCE: "หาต้นทุนไม่ได้" }[r.verdict];
    console.log(`[${tag}] ${r.parent_no} · ${r.product.slice(0, 24)} ×${r.quantity}`);
    console.log(`   ตอนนี้ ${r.now} สตางค์ (=${baht(r.now)} บาท)  |  ค่าเดิม×100 = ${r.alt_now_x100}  |  จากสูตรวันนี้ = ${r.proposed ?? "-"}${r.proposed != null ? ` (=${baht(r.proposed)} บาท, ${r.via}${r.recipe ? `: ${r.recipe}` : ""})` : ""}`);
    for (const why of r.reasons) console.log(`   ⚠️ ${why}`);
    for (const n of r.notes) console.log(`   ℹ️ ${n}`);
  }

  const plan = rows.filter((r) => r.verdict === "PROPOSE");
  const cogsBefore = plan.reduce((s, r) => s + r.now * r.quantity, 0);
  const cogsAfter = plan.reduce((s, r) => s + (r.proposed as number) * r.quantity, 0);
  console.log(`\nจะแก้ ${plan.length} รายการ · ต้องดูเอง ${rows.filter((r) => r.verdict === "REVIEW").length} · หาต้นทุนไม่ได้ ${rows.filter((r) => r.verdict === "NO_SOURCE").length}`);
  console.log(`ต้นทุนรวม (เฉพาะที่จะแก้): ${baht(cogsBefore)} → ${baht(cogsAfter)} บาท`);

  writeFileSync("scripts/recompute-order-costs.report.json", JSON.stringify({ generated_at: new Date().toISOString(), cutoff, fixedAt, rows }, null, 2));
  console.log("รายงานเต็ม: scripts/recompute-order-costs.report.json");

  if (!APPLY) {
    console.log("\nDRY-RUN จบ — ไม่มีการเขียนใด ๆ");
    return;
  }
  if (!plan.length) {
    console.log("\nไม่มีอะไรให้เขียน");
    return;
  }

  mkdirSync("scripts/backups", { recursive: true });
  const backupPath = `scripts/backups/order-costs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backupPath, JSON.stringify(plan.map((r) => ({ collection: r.collection, _id: r.item_id, field: "cost_per_unit", old: r.now, new: r.proposed })), null, 2));
  console.log(`\nสำรองค่าเดิมแล้ว: ${backupPath}`);

  let written = 0;
  let failed = 0;
  for (const r of plan) {
    const res = await db.collection(r.collection).updateOne(
      { _id: new mongoose.Types.ObjectId(r.item_id), cost_per_unit: r.now },
      { $set: { cost_per_unit: r.proposed } }
    );
    if (res.matchedCount === 1) written++;
    else {
      failed++;
      console.log(`   ⚠️ ไม่ได้เขียน (ค่าเปลี่ยนระหว่างทาง): ${r.parent_no} ${r.item_id}`);
    }
  }
  console.log(`\nเขียนสำเร็จ ${written} รายการ · ไม่สำเร็จ ${failed} รายการ`);

  if (failed === 0 && plan.length === rows.length) {
    const col = db.collection<{ _id: string; applied_at: Date; modified_count: number }>("migrations");
    for (const id of [MARKER, "money_to_satang_3_11_order_items_cost_per_unit", "money_to_satang_3_11_preorder_items_cost_per_unit"]) {
      if (!(await col.findOne({ _id: id }))) await col.insertOne({ _id: id, applied_at: new Date(), modified_count: written });
    }
    console.log("ลง marker แล้ว — สคริปต์นี้จะไม่ยอมรันซ้ำ และ migrate:money-to-satang จะข้าม section cost_per_unit");
  } else {
    console.log("มีรายการที่ไม่ได้แก้ (REVIEW/NO_SOURCE/ล้มเหลว) → ไม่ลง marker ตัดสินใจก่อนว่าจะจัดการที่เหลืออย่างไร");
  }
}

main()
  .catch((err) => {
    console.error("\nrecompute-order-costs ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
