import { describe, it, expect, vi } from "vitest";
import notificationModel from "@/models/notificationModel";
import * as productService from "@/services/productService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct } from "./helpers";

/** docs/LINE.md §9 — แจ้งเจ้าของร้าน: พรีออเดอร์ใหม่ + สินค้าใกล้หมดจากการปรับสต็อกเอง */

async function lowStockNotes(productName: string) {
  return notificationModel.find({ title: `สินค้าใกล้หมด: ${productName}` }).lean();
}

/** notify() เป็น fire-and-forget — รอให้ record ถูกสร้าง (หรือยืนยันว่าไม่มีหลังรอสักครู่) */
async function settle() {
  await new Promise((r) => setTimeout(r, 150));
}

describe("สินค้าใกล้หมด — ปรับสต็อกเอง", () => {
  it("setStock จาก 10 → 3 (ข้ามเกณฑ์ 5) → แจ้ง 1 ครั้ง", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    const res = await productService.setStock(String(p._id), 3);
    expect(res.product_stock_quantity).toBe(3);
    await vi.waitFor(async () => expect(await lowStockNotes(p.product_name_th)).toHaveLength(1));
    expect((await lowStockNotes(p.product_name_th))[0].message).toContain("3");
  });

  it("setStock ที่ต่ำอยู่แล้ว (4 → 2) → ไม่แจ้งซ้ำ", async () => {
    const p = await makeProduct({ product_stock_quantity: 4 });
    await productService.setStock(String(p._id), 2);
    await settle();
    expect(await lowStockNotes(p.product_name_th)).toHaveLength(0);
  });

  it("adjustStock -4 จาก 8 → 4 → แจ้ง", async () => {
    const p = await makeProduct({ product_stock_quantity: 8 });
    await productService.adjustStock(String(p._id), -4);
    await vi.waitFor(async () => expect(await lowStockNotes(p.product_name_th)).toHaveLength(1));
  });

  it("adjustStock เพิ่มสต็อก (2 → 12) → ไม่แจ้ง", async () => {
    const p = await makeProduct({ product_stock_quantity: 2 });
    await productService.adjustStock(String(p._id), 10);
    await settle();
    expect(await lowStockNotes(p.product_name_th)).toHaveLength(0);
  });

  it("decreaseStock (ตัดของเสีย) 6 → 5 → แจ้ง (เท่ากับเกณฑ์นับว่าใกล้หมด)", async () => {
    const p = await makeProduct({ product_stock_quantity: 6 });
    await productService.decreaseStock(String(p._id), 1);
    await vi.waitFor(async () => expect(await lowStockNotes(p.product_name_th)).toHaveLength(1));
  });
});

describe("พรีออเดอร์ใหม่ → แจ้งเจ้าของร้าน", () => {
  it("createPreorder → มี notification 'พรีออเดอร์ใหม่ PRE-…' พร้อมชื่อรอบและยอด", async () => {
    const user = await makeUser();
    const product = await makeProduct({ product_types: ["preorder"], product_price: 120 });
    const roundName = `รอบแจ้งเตือน-${Date.now()}`;
    const round = await preorderRoundService.createRound(
      {
        round_name: roundName,
        open_date: new Date(Date.now() - 1000),
        close_date: new Date(Date.now() + 86_400_000),
        pickup_date: new Date(Date.now() + 2 * 86_400_000),
        items: [{ product_id: String(product._id), max_qty_total: 5 }],
      },
      String(user._id)
    );
    const roundItem = (await preorderRoundService.listRoundItems(String(round._id)))[0] as { _id: unknown };

    const preorder = (await preorderService.createPreorder(String(user._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: String(roundItem._id), quantity: 2 }],
    })) as { preorder_no: string };

    await vi.waitFor(async () =>
      expect(await notificationModel.findOne({ title: `พรีออเดอร์ใหม่ ${preorder.preorder_no}` })).toBeTruthy()
    );
    const note = await notificationModel.findOne({ title: `พรีออเดอร์ใหม่ ${preorder.preorder_no}` }).lean<{
      message: string;
      module: string;
    }>();
    expect(note?.module).toBe("order");
    expect(note?.message).toContain(roundName);
    expect(note?.message).toContain("240");
  });
});
