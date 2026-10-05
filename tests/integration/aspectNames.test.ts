/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import { Types } from "mongoose";
import aspectModel, { ASPECT_NAME_INDEX } from "@/models/aspectModel";
import reviewModel from "@/models/reviewModel";
import { aspectService, ensureDefaultAspects } from "@/services/sentimentService";
import { runAspectNameCheck } from "../../scripts/check-aspect-names";

/** docs/BACKLOG5.md G5 — ชื่อแง่มุมห้ามซ้ำ (unique index สร้างผ่านสคริปต์ตรวจ) · seed ชุดเริ่มต้นพร้อมกันไม่ซ้ำ */

const hasIndex = async () => (await aspectModel.collection.indexes().catch(() => [])).some((ix: any) => ix.name === ASPECT_NAME_INDEX.name);

beforeEach(async () => {
  // afterEach ของ setup ล้างข้อมูลแต่ไม่ลบ index — เริ่มทุกเทสแบบ "DB จริงที่ยังไม่มี index"
  if (await hasIndex()) await aspectModel.collection.dropIndex(ASPECT_NAME_INDEX.name);
});

const raw = (name: string, over: Record<string, unknown> = {}) =>
  aspectModel.collection.insertOne({ aspect_name_th: name, aspect_name_eng: name, deleted_at: null, created_at: new Date(), ...over } as any);

describe("check:aspect-names", () => {
  it("ไม่สร้าง index เองตอนเปิดแอป (autoIndex: false)", async () => {
    await aspectModel.create({ aspect_name_th: "ราคา", aspect_name_eng: "Price" });
    await aspectModel.init();
    expect(await hasIndex()).toBe(false);
  });

  it("เจอชื่อซ้ำ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) + นับการอ้างถึง · --apply ไม่สร้าง index · ลบตัวซ้ำแล้วสร้างได้", async () => {
    const a = (await raw("รสชาติ")).insertedId;
    const b = (await raw("รสชาติ ")).insertedId;
    await raw("Cake");
    await raw("cake");
    await raw("ลบไปแล้ว", { deleted_at: new Date() });
    await raw("ลบไปแล้ว");
    await reviewModel.collection.insertOne({
      product_id: new Types.ObjectId(),
      user_id: new Types.ObjectId(),
      rating: 5,
      deleted_at: null,
      aspect_feedback: [{ aspect_id: b, aspect_name_th: "รสชาติ", sentiment: "positive" }],
    } as any);

    const dry = await runAspectNameCheck();
    expect(dry.dryRun).toBe(true);
    expect(dry.duplicates).toHaveLength(2);
    const taste = dry.duplicates.find((g) => g[0].aspect_name_th.trim() === "รสชาติ")!;
    expect(taste.find((x) => x._id === String(b))!.reviews).toBe(1);
    expect(taste.find((x) => x._id === String(a))!.reviews).toBe(0);
    expect(dry.untrimmed.map((u) => u._id)).toEqual([String(b)]);

    const blocked = await runAspectNameCheck({ apply: true });
    expect(blocked).toMatchObject({ indexCreated: false });
    expect(await hasIndex()).toBe(false);

    await aspectModel.updateMany({ aspect_name_th: { $in: ["รสชาติ ", "cake"] } }, { $set: { deleted_at: new Date() } });
    const ok = await runAspectNameCheck({ apply: true });
    expect(ok).toMatchObject({ duplicates: [], indexCreated: true });
    expect(await hasIndex()).toBe(true);
    expect((await runAspectNameCheck({ apply: true })).indexExisted).toBe(true);

    // หลังมี index: ชื่อซ้ำ (ต่างตัวพิมพ์) เขียนตรงไม่ได้ · ผ่าน service ได้ 409 · ชื่อที่ลบไปแล้วใช้ซ้ำได้
    await expect(raw("CAKE")).rejects.toMatchObject({ code: 11000 });
    await expect(aspectService.create({ aspect_name_th: "รสชาติ" })).rejects.toMatchObject({ status: 409 });
    await expect(raw("รสชาติ ", { deleted_at: new Date() })).resolves.toBeTruthy();
  });
});

describe("ensureDefaultAspects พร้อมกัน", () => {
  it("มี index แล้ว: เรียกพร้อมกัน 5 ครั้งครั้งแรก → ได้ชุดเริ่มต้น 4 ด้านพอดี (ไม่ throw)", async () => {
    await runAspectNameCheck({ apply: true }); // DB ว่าง → ไม่มีชื่อซ้ำ → สร้าง index
    await Promise.all(Array.from({ length: 5 }, () => ensureDefaultAspects()));
    const names = (await aspectModel.find({ deleted_at: null }).lean<any[]>()).map((a) => a.aspect_name_th).sort();
    expect(names).toEqual(["บรรจุภัณฑ์", "ราคา", "รสชาติ", "อื่นๆ"].sort());
  });
});
