import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCleanup } from "../../scripts/cleanup-legacy-product-fields";
import { checkDataIntegrity } from "@/services/dataIntegrityService";
import { makeProduct } from "./helpers";

/** docs/BACKLOG4.md §7.15 — ลบ delete_at: null ที่ค้างจาก schema เก่า (ไม่แตะตัวที่มีค่า) */

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});
const products = () => mongoose.connection.db!.collection("products");

describe("scripts/cleanup-legacy-product-fields", () => {
  it("dry-run ไม่เขียน · --apply ลบเฉพาะ delete_at: null · ตัวที่มีวันที่รายงานไม่แตะ · Y11 ไม่แจ้งแล้ว", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const oldUpdated = new Date("2026-09-01T00:00:00Z");
    await products().updateOne({ _id: a._id }, { $set: { delete_at: null, updated_at: oldUpdated } });
    await products().updateOne({ _id: b._id }, { $set: { delete_at: new Date("2026-08-01T00:00:00Z") } });

    const dry = await runCleanup();
    expect(dry.planned.map((p) => p._id)).toEqual([String(a._id)]);
    expect(dry.needsReview.map((p) => p._id)).toEqual([String(b._id)]);
    expect("delete_at" in (await products().findOne({ _id: a._id }))!).toBe(true);

    dir = mkdtempSync(join(tmpdir(), "legacy-"));
    const res = await runCleanup({ apply: true, backupDir: dir });
    expect(res.removed).toBe(1);
    const after = (await products().findOne({ _id: a._id }))!;
    expect("delete_at" in after).toBe(false);
    expect((after.updated_at as Date).toISOString()).toBe(oldUpdated.toISOString());
    expect((await products().findOne({ _id: b._id }))!.delete_at).toBeInstanceOf(Date);

    const integrity = await checkDataIntegrity();
    expect(integrity.issues.filter((i) => i.id === String(a._id))).toEqual([]);
    expect((await runCleanup({ apply: true, backupDir: dir })).planned).toHaveLength(0);
  });
});
