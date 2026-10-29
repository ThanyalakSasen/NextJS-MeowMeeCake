import { describe, it, expect } from "vitest";
import productLotModel from "@/models/productLotModel";
import productLotPieceModel from "@/models/productLotPieceModel";
import productionItemModel from "@/models/productionItemModel";
import productionOrderModel from "@/models/productionOrderModel";
import * as productionOrderService from "@/services/productionOrderService";
import * as productLotService from "@/services/productLotService";
import { addDays, expiryState } from "@/services/productLotService";
import { bangkokDateString } from "@/lib/datetime";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * ล็อตสินค้า (productLotService) — ปิดงานผลิตแล้วสร้างล็อต 1 ล็อตต่อรายการ · วันผลิต/วันหมดอายุเริ่มต้น + กรอกเอง
 * สูตรจาก makeRecipe ไม่มีวัตถุดิบ → การหักวัตถุดิบไม่มีผล
 */

type Lot = {
  lot_no: string;
  product_id: unknown;
  produced_date: string;
  expiry_date: string | null;
  qty_produced: number;
  qty_remaining: number | null;
};

const PRODUCTION_DATE = "2026-10-28";

async function orderWith(items: Array<{ product: { _id: unknown }; qty: number }>) {
  const admin = await makeUser();
  const withRecipes = await Promise.all(items.map(async (i) => ({ ...i, recipe: await makeRecipe(String(i.product._id)) })));
  const order = (await productionOrderService.createProductionOrder({
    production_date: new Date(`${PRODUCTION_DATE}T09:00:00+07:00`),
    items: withRecipes.map((i) => ({
      product_id: String(i.product._id),
      recipe_id: String(i.recipe._id),
      planned_qty: i.qty,
    })),
  })) as { _id: unknown };
  await productionOrderService.startProduction(String(order._id));
  return { orderId: String(order._id), adminId: String(admin._id) };
}

const lotsOf = (orderId: string) => productLotModel.find({ production_order_id: orderId }).lean<Lot[]>();

describe("ปิดงานผลิต → สร้างล็อตสินค้า", () => {
  it("ค่าเริ่มต้น: วันผลิต = วันในใบสั่งผลิต · หมดอายุ = + shelf_life_days · พรีออเดอร์ไม่มีคงเหลือ", async () => {
    const brownie = await makeProduct({ product_stock_quantity: 0, shelf_life_days: 5 });
    const cake = await makeProduct({ is_preorder: true, product_stock_quantity: null });
    const { orderId, adminId } = await orderWith([
      { product: brownie, qty: 12 },
      { product: cake, qty: 3 },
    ]);

    await productionOrderService.completeProduction(orderId, { performed_by: adminId });

    const lots = await lotsOf(orderId);
    expect(lots).toHaveLength(2);
    const b = lots.find((l) => String(l.product_id) === String(brownie._id))!;
    const c = lots.find((l) => String(l.product_id) === String(cake._id))!;
    expect(b.lot_no).toMatch(/^L261028\d{4}$/);
    expect(b).toMatchObject({ produced_date: PRODUCTION_DATE, expiry_date: "2026-11-02", qty_produced: 12, qty_remaining: 12 });
    // ไม่ได้ตั้งอายุสินค้า → ไม่มีวันหมดอายุ · พรีออเดอร์ไม่มีสต็อก
    expect(c).toMatchObject({ expiry_date: null, qty_produced: 3, qty_remaining: null });
  });

  it("กรอกวันผลิต/วันหมดอายุจริงต่อรายการ · จำนวนตาม actual_qty · รายการยกเลิกไม่มีล็อต", async () => {
    const a = await makeProduct({ product_stock_quantity: 0, shelf_life_days: 3 });
    const b = await makeProduct({ product_stock_quantity: 0 });
    const { orderId, adminId } = await orderWith([
      { product: a, qty: 10 },
      { product: b, qty: 4 },
    ]);
    const itemA = await productionItemModel.findOne({ production_order_id: orderId, product_id: a._id });
    await productionItemModel.updateOne({ _id: itemA!._id }, { $set: { actual_qty: 8 } });
    await productionItemModel.updateOne({ production_order_id: orderId, product_id: b._id }, { $set: { item_status: "cancelled" } });

    await productionOrderService.completeProduction(orderId, {
      performed_by: adminId,
      use_actual: true,
      lots: [{ item_id: String(itemA!._id), produced_date: "2026-10-29", expiry_date: "2026-11-05" }],
    });

    const lots = await lotsOf(orderId);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ produced_date: "2026-10-29", expiry_date: "2026-11-05", qty_produced: 8, qty_remaining: 8 });
  });

  it("วันหมดอายุก่อนวันผลิต → 400 และงานผลิตยังไม่ถูกปิด", async () => {
    const a = await makeProduct({ product_stock_quantity: 0 });
    const { orderId, adminId } = await orderWith([{ product: a, qty: 5 }]);
    const item = await productionItemModel.findOne({ production_order_id: orderId });

    await expect(
      productionOrderService.completeProduction(orderId, {
        performed_by: adminId,
        lots: [{ item_id: String(item!._id), produced_date: "2026-10-28", expiry_date: "2026-10-27" }],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect((await productionOrderModel.findById(orderId).lean<{ production_status: string }>())!.production_status).toBe("in_progress");
    expect(await lotsOf(orderId)).toHaveLength(0);
  });

  it("ค้นล็อตจากเลข (สแกนบาร์โค้ด) — ไม่สนตัวพิมพ์ · มีสินค้า ใบสั่งผลิต และสถานะหมดอายุ", async () => {
    const a = await makeProduct({ product_stock_quantity: 0, shelf_life_days: 2 });
    const { orderId, adminId } = await orderWith([{ product: a, qty: 6 }]);
    await productionOrderService.completeProduction(orderId, { performed_by: adminId });
    const [lot] = await lotsOf(orderId);

    const found = await productLotService.getLotByNo(` ${lot.lot_no.toLowerCase()} `);
    expect(found).toMatchObject({ lot_no: lot.lot_no, product_name_th: a.product_name_th, expiry_date: "2026-10-30" });
    expect(found.production_no).toMatch(/^PRD-/);
    await expect(productLotService.getLotByNo("L0000000000")).rejects.toMatchObject({ status: 404 });
  });

  it("ปิดงานผลิต → เก็บรหัสประจำชิ้นครบทุกชิ้น · สแกนรหัสชิ้น → ล็อต + ชิ้นที่ · ไม่มีในตาราง = 404", async () => {
    const a = await makeProduct({ product_stock_quantity: 0 });
    const { orderId, adminId } = await orderWith([{ product: a, qty: 12 }]);
    await productionOrderService.completeProduction(orderId, { performed_by: adminId });
    const [lot] = await lotsOf(orderId);

    const stored = await productLotPieceModel.find({ product_id: a._id }).sort({ piece_no: 1 }).lean<Array<{ piece_no: number; piece_code: string }>>();
    expect(stored.map((p) => p.piece_no)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(stored[0].piece_code).toBe(`${lot.lot_no}-001`);
    expect(stored[11].piece_code).toBe(`${lot.lot_no}-012`);
    expect(productLotService.pieceCode(lot.lot_no, 7, 1200)).toBe(`${lot.lot_no}-0007`);

    const byLot = await productLotService.getLotByNo(lot.lot_no);
    expect(byLot).toMatchObject({ piece_no: null, piece_code: null });
    const byPiece = await productLotService.getLotByNo(` ${lot.lot_no.toLowerCase()}-012 `);
    expect(byPiece).toMatchObject({ lot_no: lot.lot_no, piece_no: 12, piece_code: `${lot.lot_no}-012`, qty_produced: 12 });

    await expect(productLotService.getLotByNo(`${lot.lot_no}-013`)).rejects.toMatchObject({ status: 404 });
    await expect(productLotService.getLotByNo("L0000000000-001")).rejects.toMatchObject({ status: 404 });

    // ปิดงานซ้ำ/เรียก ensure ซ้ำ ไม่สร้างชิ้นซ้ำ
    expect(await productLotService.listPieces(lot.lot_no)).toHaveLength(12);
    expect(await productLotPieceModel.countDocuments({ product_id: a._id })).toBe(12);
  });

  it("ล็อตเก่าที่ยังไม่มีรหัสชิ้น → listPieces สร้างให้ครั้งแรก แล้วสแกนเจอ", async () => {
    const a = await makeProduct({ product_stock_quantity: 0 });
    const { orderId, adminId } = await orderWith([{ product: a, qty: 3 }]);
    await productionOrderService.completeProduction(orderId, { performed_by: adminId });
    const [lot] = await lotsOf(orderId);
    await productLotPieceModel.deleteMany({ product_id: a._id });
    await expect(productLotService.getLotByNo(`${lot.lot_no}-001`)).rejects.toMatchObject({ status: 404 });

    const pieces = await productLotService.listPieces(lot.lot_no);
    expect(pieces).toEqual([1, 2, 3].map((n) => ({ piece_no: n, piece_code: `${lot.lot_no}-00${n}` })));
    expect(await productLotService.getLotByNo(`${lot.lot_no}-002`)).toMatchObject({ piece_no: 2 });
  });
});

describe("expiryState", () => {
  const today = bangkokDateString();
  it("เลยวัน = expired · ภายใน 2 วัน = expiring · ไม่มีวัน = none", () => {
    expect(expiryState(addDays(today, -1), today)).toBe("expired");
    expect(expiryState(today, today)).toBe("expiring");
    expect(expiryState(addDays(today, 2), today)).toBe("expiring");
    expect(expiryState(addDays(today, 3), today)).toBe("ok");
    expect(expiryState(null, today)).toBe("none");
  });
});
