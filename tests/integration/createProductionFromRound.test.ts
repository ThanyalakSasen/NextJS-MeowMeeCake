import { describe, it, expect } from "vitest";
import productionOrderModel from "@/models/productionOrderModel";
import productionItemModel from "@/models/productionItemModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * productionOrderService.createProductionFromRound — เชื่อมการจัดการผลิตกับรอบพรีออเดอร์
 * (ก่อนหน้านี้ backend ปฏิเสธ source_type "preorder" เสมอ แม้ productionOrderModel.round_id จะมี
 * field ไว้แล้วก็ตาม ไม่เคยมี path ไหนเขียนค่าจริง) ยืนยัน 3 พฤติกรรมหลัก:
 *  - รวมยอดสั่งจริงต่อสินค้าจากพรีออเดอร์ที่ยังไม่ยกเลิกในรอบนั้น (ไม่นับที่ cancelled)
 *  - บังคับ round_status = "closed" เท่านั้น
 *  - สร้างได้แค่ 1 ใบต่อรอบ
 */
describe("productionOrderService.createProductionFromRound", () => {
  async function setupClosedRoundWithOrders() {
    const admin = await makeUser();
    const customerA = await makeUser();
    const customerB = await makeUser();
    const product = await makeProduct({ product_type: "preorder", product_price: 100 });
    const recipe = await makeRecipe(String(product._id));

    const now = Date.now();
    const round = await preorderRoundService.createRound(
      {
        round_name: "รอบทดสอบ",
        open_date: new Date(now - 60_000),
        close_date: new Date(now + 60_000),
        pickup_date: new Date(now + 3 * 24 * 3600 * 1000),
        round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 100 }],
      },
      String(admin._id)
    );
    const roundItemId = String(round.items[0]._id);

    const preorderA = await preorderService.createPreorder(String(customerA._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: roundItemId, quantity: 3 }],
    });
    const preorderB = await preorderService.createPreorder(String(customerB._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: roundItemId, quantity: 2 }],
    });
    // ออเดอร์ที่ยกเลิกแล้ว — ต้องไม่ถูกนับรวมยอด
    const preorderCancelled = await preorderService.createPreorder(String(customerA._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: roundItemId, quantity: 10 }],
    });
    await preorderService.updatePreorderStatus(String(preorderCancelled._id), "cancelled");

    await preorderRoundService.updateRoundStatus(String(round._id), "closed");

    return { round, product, recipe, roundItemId, preorderA, preorderB, preorderCancelled };
  }

  it("รวมยอดสั่งจริง (ไม่นับที่ยกเลิก) เป็นใบสั่งผลิต + รายการเดียวต่อสินค้า ผูก round_id/round_item_id ไว้", async () => {
    const { round, product, recipe, roundItemId } = await setupClosedRoundWithOrders();

    const order = await productionOrderService.createProductionFromRound({
      round_id: String(round._id),
      production_date: new Date(),
    });

    expect(order.source_type).toBe("preorder");
    expect(String(order.round_id._id ?? order.round_id)).toBe(String(round._id));
    expect(order.items).toHaveLength(1);

    const item = order.items[0];
    expect(String(item.product_id._id ?? item.product_id)).toBe(String(product._id));
    expect(String(item.recipe_id._id ?? item.recipe_id)).toBe(String(recipe._id));
    expect(item.planned_qty).toBe(5); // 3 + 2 — ไม่นับ 10 ที่ยกเลิกไปแล้ว
    expect(String(item.round_item_id)).toBe(roundItemId);

    expect(await productionOrderModel.findById(order._id).lean()).not.toBeNull();
    expect(await productionItemModel.countDocuments({ production_order_id: order._id })).toBe(1);
  });

  it("สร้างซ้ำจากรอบเดิม → 409 (มีใบสั่งผลิตสำหรับรอบนี้อยู่แล้ว)", async () => {
    const { round } = await setupClosedRoundWithOrders();
    await productionOrderService.createProductionFromRound({
      round_id: String(round._id),
      production_date: new Date(),
    });

    await expect(
      productionOrderService.createProductionFromRound({
        round_id: String(round._id),
        production_date: new Date(),
      })
    ).rejects.toThrow(/มีใบสั่งผลิตสำหรับรอบนี้อยู่แล้ว/);
  });

  it("รอบยังไม่ปิดรับ (open) → 409 ปฏิเสธ ไม่สร้างใบสั่งผลิต", async () => {
    const admin = await makeUser();
    const product = await makeProduct({ product_type: "preorder" });
    await makeRecipe(String(product._id));
    const now = Date.now();
    const round = await preorderRoundService.createRound(
      {
        round_name: "รอบเปิดอยู่",
        open_date: new Date(now - 60_000),
        close_date: new Date(now + 60_000),
        pickup_date: new Date(now + 2 * 24 * 3600 * 1000),
        round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 10 }],
      },
      String(admin._id)
    );

    const countBefore = await productionOrderModel.countDocuments({});
    await expect(
      productionOrderService.createProductionFromRound({
        round_id: String(round._id),
        production_date: new Date(),
      })
    ).rejects.toThrow(/เฉพาะรอบที่สถานะ "ปิดรับแล้ว"/);
    expect(await productionOrderModel.countDocuments({})).toBe(countBefore);
  });

  it("มีสินค้าที่สั่งแล้วยังไม่มีสูตรผูก → 400 ปฏิเสธ ไม่เหลือใบสั่งผลิตค้าง", async () => {
    const admin = await makeUser();
    const customer = await makeUser();
    const product = await makeProduct({ product_type: "preorder" }); // ตั้งใจไม่สร้างสูตรให้
    const now = Date.now();
    const round = await preorderRoundService.createRound(
      {
        round_name: "รอบไม่มีสูตร",
        open_date: new Date(now - 60_000),
        close_date: new Date(now + 60_000),
        pickup_date: new Date(now + 2 * 24 * 3600 * 1000),
        round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 10 }],
      },
      String(admin._id)
    );
    const roundItemId = String(round.items[0]._id);
    await preorderService.createPreorder(String(customer._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: roundItemId, quantity: 1 }],
    });
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");

    const countBefore = await productionOrderModel.countDocuments({});
    await expect(
      productionOrderService.createProductionFromRound({
        round_id: String(round._id),
        production_date: new Date(),
      })
    ).rejects.toThrow(/ยังไม่มีสูตรผูกไว้/);
    expect(await productionOrderModel.countDocuments({})).toBe(countBefore);
  });

  it("สินค้ามีสูตรที่ยังไม่ถูกลบมากกว่า 1 สูตร → ใช้สูตรล่าสุด (created_at ใหม่สุด, docs/BACKLOG2.md §12.2)", async () => {
    const admin = await makeUser();
    const customer = await makeUser();
    const product = await makeProduct({ product_type: "preorder" });
    const oldRecipe = await makeRecipe(String(product._id)); // สร้างก่อน
    const newRecipe = await makeRecipe(String(product._id)); // สร้างทีหลัง — ต้องถูกเลือก

    const now = Date.now();
    const round = await preorderRoundService.createRound(
      {
        round_name: "รอบมีสูตรซ้ำ",
        open_date: new Date(now - 60_000),
        close_date: new Date(now + 60_000),
        pickup_date: new Date(now + 2 * 24 * 3600 * 1000),
        round_status: "open",
        items: [{ product_id: String(product._id), max_qty_total: 10 }],
      },
      String(admin._id)
    );
    const roundItemId = String(round.items[0]._id);
    await preorderService.createPreorder(String(customer._id), {
      round_id: String(round._id),
      order_type: "takeaway",
      items: [{ round_item_id: roundItemId, quantity: 4 }],
    });
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");

    const order = await productionOrderService.createProductionFromRound({
      round_id: String(round._id),
      production_date: new Date(),
    });

    const item = order.items[0];
    expect(String(item.recipe_id._id ?? item.recipe_id)).toBe(String(newRecipe._id));
    expect(String(item.recipe_id._id ?? item.recipe_id)).not.toBe(String(oldRecipe._id));
  });
});
