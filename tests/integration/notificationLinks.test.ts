import { describe, it, expect } from "vitest";
import notificationModel from "@/models/notificationModel";
import paymentModel from "@/models/paymentModel";
import productionOrderModel from "@/models/productionOrderModel";
import preorderModel from "@/models/preorderModel";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import * as paymentService from "@/services/paymentService";
import * as productService from "@/services/productService";
import { adminLinks } from "@/lib/adminLinks";
import { makeUser, makeProduct, makeRecipe } from "./helpers";

/**
 * ลิงก์ของแจ้งเตือนเจ้าของร้าน → หน้าเว็บหลังร้านที่ frontend ยืนยันแล้ว (frontend PR #16 · docs/LINE.md §9.14)
 * notify() บางจุดเป็น fire-and-forget → รอด้วย waitFor
 */

const DAY = 24 * 60 * 60 * 1000;

async function waitNote(title: RegExp) {
  for (let i = 0; i < 40; i++) {
    const n = await notificationModel.findOne({ title }).lean<{ title: string; link: string | null }>();
    if (n) return n;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`ไม่พบแจ้งเตือน ${title}`);
}

async function preorderSetup() {
  const p = await makeProduct({
    is_preorder: true, product_stock_quantity: null, product_price: 100,
    preorder_config: { min_order_qty: 1, max_order_qty: 50, lead_time_days: 1 },
  });
  await makeRecipe(String(p._id));
  const admin = await makeUser();
  const round = (await preorderRoundService.createRound(
    {
      round_name: `รอบลิงก์-${Date.now()}`, open_date: new Date(Date.now() - 1000), close_date: new Date(Date.now() + DAY),
      pickup_date: new Date(Date.now() + 5 * DAY), round_status: "open",
      items: [{ product_id: String(p._id), max_qty_total: 100 }],
    },
    String(admin._id)
  )) as { _id: unknown; items: Array<{ _id: unknown }> };
  const user = await makeUser();
  const pre = (await preorderService.createPreorder(String(user._id), {
    round_id: String(round._id), order_type: "takeaway", items: [{ round_item_id: String(round.items[0]._id), quantity: 2 }],
  })) as { _id: unknown; preorder_no: string; total_amount: number };
  return { round, user, pre };
}

describe("ลิงก์แจ้งเตือน → หน้าหลังร้าน", () => {
  it("adminLinks: path ตรงกับ frontend", () => {
    expect(adminLinks.order("o1")).toBe("/owner/orders/manageOrders?id=o1");
    expect(adminLinks.preorder("p1")).toBe("/owner/orders/preOrderRound?tab=orders&id=p1");
    expect(adminLinks.production("x1")).toBe("/owner/production?id=x1");
    expect(adminLinks.product("s1")).toBe("/owner/products/s1/edit");
    expect(adminLinks.dashboard).toBe("/owner/dashboard");
  });

  it("พรีออเดอร์ใหม่ + สลิปของพรีออเดอร์ → หน้าพรีออเดอร์ ?tab=orders&id=", async () => {
    const { user, pre } = await preorderSetup();
    const created = await waitNote(new RegExp(`^เปิดพรีออเดอร์รอบใหม่ ${pre.preorder_no}`));
    expect(created.link).toBe(adminLinks.preorder(pre._id));

    const payment = (await paymentService.createPayment({
      user_id: String(user._id), preorder_id: String(pre._id), amount: pre.total_amount,
    })) as { _id: unknown };
    await paymentService.submitSlip(String(payment._id), { slip_image_url: "/api/files/slips/a.jpg" });
    const slip = await waitNote(new RegExp(`^มีคำสั่งซื้อรอตรวจสอบสลิปโอนเงิน รหัสคำสั่งซื้อ ${pre.preorder_no}`));
    expect(slip.link).toBe(adminLinks.preorder(pre._id));
  });

  it("ปิดรอบที่สร้างใบผลิตได้ → หน้าใบผลิต ?id=", async () => {
    const { round, pre } = await preorderSetup();
    await preorderModel.updateOne({ _id: pre._id }, { $set: { payment_status: "paid", order_status: "confirmed" } });
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    const po = await productionOrderModel.findOne({ round_id: round._id }).lean<{ _id: unknown }>();
    expect(po).toBeTruthy();
    const n = await waitNote(/^ปิดรอบพรีออเดอร์ "รอบลิงก์-/);
    expect(n.link).toBe(adminLinks.production(po!._id));
  });

  it("ปิดรอบที่ไม่มีใครจ่าย (สร้างใบผลิตไม่ได้) → หน้ารอบพรีออเดอร์", async () => {
    const { round } = await preorderSetup();
    await preorderRoundService.updateRoundStatus(String(round._id), "closed");
    const n = await waitNote(/^ปิดรอบพรีออเดอร์ "รอบลิงก์-/);
    expect(n.link).toBe(adminLinks.preorderRounds);
    expect(await paymentModel.countDocuments()).toBe(0);
  });

  it("สินค้าใกล้จะหมด → หน้าแก้สินค้าตัวนั้น", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    await productService.setStock(String(p._id), 2);
    const n = await waitNote(new RegExp(`^สินค้าใกล้จะหมด: ${p.product_name_th}$`));
    expect(n.link).toBe(adminLinks.product(p._id));
  });
});
