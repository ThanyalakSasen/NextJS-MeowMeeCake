import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../../scripts/audit-money-units";

/**
 * docs/BACKLOG4.md Y10 (BACKLOG2 §16.1) — audit-money-units เดิมรายงานแถวที่ fix-money-units แก้แล้วว่า
 * "ยังเป็นบาท" ซ้ำ (เพราะ fix ไม่แตะ updated_at) → ตอนนี้เทียบกับ backup + marker ก่อนตัดสิน
 */

const CUTOFF = new Date("2026-09-12T14:14:00Z");
const BEFORE = new Date("2026-09-01T00:00:00Z");
const FIX_AT = new Date("2026-09-20T12:20:00Z");
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const db = () => mongoose.connection.db!;

describe("scripts/audit-money-units (BACKLOG4 Y10)", () => {
  it("แถวใน backup: ตรง new → SATANG_FIXED · กลับเป็น old → BAHT_LIKELY · ไม่ตรงทั้งคู่ → REVIEW", async () => {
    const [fixedId, revertedId, editedId] = [1, 2, 3].map(() => new mongoose.Types.ObjectId());
    await db().collection("ingredients").insertMany([
      { _id: fixedId, ingredient_name: "แป้ง", cost_per_unit: 5500, updated_at: BEFORE },
      { _id: revertedId, ingredient_name: "เนย", cost_per_unit: 80, updated_at: BEFORE },
      { _id: editedId, ingredient_name: "ไข่", cost_per_unit: 420, updated_at: BEFORE },
    ]);
    dir = mkdtempSync(join(tmpdir(), "y10-"));
    writeFileSync(
      join(dir, "money-fix-2026-09-20T12-20-15-782Z.json"),
      JSON.stringify([
        { collection: "ingredients", _id: String(fixedId), field: "cost_per_unit", old: 55, new: 5500 },
        { collection: "ingredients", _id: String(revertedId), field: "cost_per_unit", old: 80, new: 8000 },
        { collection: "ingredients", _id: String(editedId), field: "cost_per_unit", old: 4, new: 400 },
      ])
    );

    const res = await runAudit({ cutoff: CUTOFF, backupDir: dir, reportPath: null });
    const verdictOf = (id: unknown) => res.rows.find((r) => r.id === String(id))!.verdict;
    expect(verdictOf(fixedId)).toBe("SATANG_FIXED");
    expect(verdictOf(revertedId)).toBe("BAHT_LIKELY");
    expect(verdictOf(editedId)).toBe("REVIEW");
    // แถวที่แก้แล้วต้องไม่ถูกเสนอให้ ×100 ซ้ำ
    expect(res.rows.find((r) => r.id === String(fixedId))!.proposed).toBeNull();
  });

  it("มี marker money_fix_units_applied → แถวเก่าที่ไม่อยู่ใน backup เป็น REVIEW ไม่ใช่ BAHT_LIKELY", async () => {
    const oldId = new mongoose.Types.ObjectId();
    await db().collection("recipes").insertOne({
      _id: oldId,
      recipe_name: "เค้ก",
      estimated_cost_per_batch: 12000,
      updated_at: BEFORE,
    });
    dir = mkdtempSync(join(tmpdir(), "y10-"));

    const without = await runAudit({ cutoff: CUTOFF, backupDir: dir, reportPath: null });
    expect(without.rows.find((r) => r.id === String(oldId))!.verdict).toBe("BAHT_LIKELY");

    await db()
      .collection<{ _id: string; applied_at: Date }>("migrations")
      .insertOne({ _id: "money_fix_units_applied", applied_at: FIX_AT });
    const withMarker = await runAudit({ cutoff: CUTOFF, backupDir: dir, reportPath: null });
    const row = withMarker.rows.find((r) => r.id === String(oldId))!;
    expect(withMarker.fixAppliedAt).toBe(FIX_AT.toISOString());
    expect(row.verdict).toBe("REVIEW");
    expect(row.proposed).toBeNull();
  });

  it("product-price-fix backup (ไม่มี collection) ถือเป็น products", async () => {
    const pid = new mongoose.Types.ObjectId();
    await db().collection("products").insertOne({ _id: pid, product_name_th: "ชิโอะปัง", product_price: 4500, updated_at: BEFORE });
    dir = mkdtempSync(join(tmpdir(), "y10-"));
    writeFileSync(
      join(dir, "product-price-fix-2026-09-24T21-30-28-057Z.json"),
      JSON.stringify([{ _id: String(pid), product_id: "pos-1", name: "ชิโอะปัง", field: "product_price", old: 45, new: 4500 }])
    );
    const res = await runAudit({ cutoff: CUTOFF, backupDir: dir, reportPath: null });
    expect(res.rows.find((r) => r.id === String(pid) && r.field === "product_price")!.verdict).toBe("SATANG_FIXED");
  });
});
