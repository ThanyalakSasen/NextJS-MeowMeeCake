import { describe, it, expect, vi, afterEach } from "vitest";
import notificationModel from "@/models/notificationModel";
import * as productService from "@/services/productService";
import * as preorderRoundService from "@/services/preorderRoundService";
import * as preorderService from "@/services/preorderService";
import * as orderService from "@/services/orderService";
import * as dashboardService from "@/services/dashboardService";
import { makeUser, makeProduct } from "./helpers";
import { flushBackground } from "@/lib/backgroundTasks";

/** docs/LINE.md §9 — แจ้งเจ้าของร้าน: พรีออเดอร์ใหม่ + สินค้าใกล้หมดจากการปรับสต็อกเอง */

async function lowStockNotes(productName: string) {
  return notificationModel.find({ title: `สินค้าใกล้จะหมด: ${productName}` }).lean();
}

/** notify() เป็น fire-and-forget — รอให้งานเบื้องหลังจบจริง (lib/backgroundTasks) แทนการรอเวลาตายตัว */
async function settle() {
  await flushBackground();
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
  it("createPreorder → มี notification 'เปิดพรีออเดอร์รอบใหม่ PRE-…' พร้อมชื่อรอบและยอด", async () => {
    const user = await makeUser();
    const product = await makeProduct({ is_preorder: true, product_price: 120 });
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
      expect(await notificationModel.findOne({ title: `เปิดพรีออเดอร์รอบใหม่ ${preorder.preorder_no}` })).toBeTruthy()
    );
    const note = await notificationModel.findOne({ title: `เปิดพรีออเดอร์รอบใหม่ ${preorder.preorder_no}` }).lean<{
      message: string;
      module: string;
    }>();
    expect(note?.module).toBe("order");
    expect(note?.message).toContain(roundName);
    expect(note?.message).toContain("240");
  });
});

/** docs/LINE.md §9.5 ข้อ 3 — เกณฑ์สินค้าใกล้หมดรายสินค้า (low_stock_threshold) */
describe("เกณฑ์สินค้าใกล้หมดรายสินค้า", () => {
  it("ตั้งเกณฑ์ 20: สต็อก 25 → 18 แจ้ง (ค่าเริ่มต้น 5 จะไม่แจ้ง) พร้อมบอกเกณฑ์ในข้อความ", async () => {
    const p = await makeProduct({ product_stock_quantity: 25, low_stock_threshold: 20 });
    await productService.setStock(String(p._id), 18);
    await vi.waitFor(async () => expect(await lowStockNotes(p.product_name_th)).toHaveLength(1));
    expect((await lowStockNotes(p.product_name_th))[0].message).toContain("เกณฑ์แจ้งเตือน 20");
  });

  it("ตั้งเกณฑ์ 0: ลดเหลือ 1 ไม่แจ้ง · หมดเกลี้ยง (0) ถึงแจ้ง", async () => {
    const p = await makeProduct({ product_stock_quantity: 10, low_stock_threshold: 0 });
    await productService.setStock(String(p._id), 1);
    await settle();
    expect(await lowStockNotes(p.product_name_th)).toHaveLength(0);
    await productService.adjustStock(String(p._id), -1);
    await vi.waitFor(async () => expect(await lowStockNotes(p.product_name_th)).toHaveLength(1));
  });

  it("create/update: รับจำนวนเต็ม ≥ 0 หรือ null · ค่าผิดโยน 400 · สินค้า preorder ล้างเป็น null", async () => {
    const p = await makeProduct({ product_stock_quantity: 10 });
    const id = String(p._id);

    const updated = (await productService.updateProduct(id, { low_stock_threshold: 12 })) as {
      low_stock_threshold: number | null;
    };
    expect(updated.low_stock_threshold).toBe(12);

    await expect(productService.updateProduct(id, { low_stock_threshold: -1 })).rejects.toThrow(/low_stock_threshold/);
    await expect(productService.updateProduct(id, { low_stock_threshold: 2.5 })).rejects.toThrow(/low_stock_threshold/);

    const cleared = (await productService.updateProduct(id, { low_stock_threshold: null })) as {
      low_stock_threshold: number | null;
    };
    expect(cleared.low_stock_threshold).toBeNull();

    const pre = await makeProduct({ is_preorder: true, product_stock_quantity: null, low_stock_threshold: 3 });
    const toPre = (await productService.updateProduct(String(pre._id), { product_name_th: `พรี-${Date.now()}` })) as {
      low_stock_threshold: number | null;
    };
    expect(toPre.low_stock_threshold).toBeNull();
  });

  it("getLowStockProducts: ไม่ส่ง threshold = ใช้เกณฑ์รายสินค้า · ส่งตัวเลข = เกณฑ์เดียวทุกตัว (แบบเดิม)", async () => {
    const tag = `LS-${Date.now()}`;
    const high = await makeProduct({ product_name_th: `${tag}-high`, product_stock_quantity: 15, low_stock_threshold: 20 });
    const dflt = await makeProduct({ product_name_th: `${tag}-default`, product_stock_quantity: 15 });

    const perProduct = await productService.getLowStockProducts(undefined, { limit: 200 });
    const ids = perProduct.items.map((it) => String(it._id));
    expect(perProduct.per_product).toBe(true);
    expect(ids).toContain(String(high._id)); // 15 ≤ 20
    expect(ids).not.toContain(String(dflt._id)); // 15 > 5

    const fixed = await productService.getLowStockProducts(15, { limit: 200 });
    const fixedIds = fixed.items.map((it) => String(it._id));
    expect(fixed.per_product).toBe(false);
    expect(fixedIds).toEqual(expect.arrayContaining([String(high._id), String(dflt._id)]));
  });

  it("dashboard นับสินค้าใกล้หมดตามเกณฑ์รายสินค้า", async () => {
    const before = (await dashboardService.overview()).low_stock.products;
    await makeProduct({ product_stock_quantity: 15, low_stock_threshold: 20 }); // ใกล้หมด
    await makeProduct({ product_stock_quantity: 15 }); // ไม่ใกล้หมด (ค่าเริ่มต้น 5)
    const after = (await dashboardService.overview()).low_stock.products;
    expect(after - before).toBe(1);
  });
});

/** docs/LINE.md §9.5 ข้อ 4 — ออเดอร์หน้าร้าน (POS) ไม่ push LINE เจ้าของร้าน (ยังบันทึกในเว็บ) */
describe("ออเดอร์ POS กับ LINE เจ้าของร้าน", () => {
  const ORIGINAL = process.env.LINE_NOTIFY_POS_ORDERS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LINE_NOTIFY_POS_ORDERS;
    else process.env.LINE_NOTIFY_POS_ORDERS = ORIGINAL;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_TARGET_ID;
    vi.unstubAllGlobals();
  });

  async function placeOrder(channel: "online" | "instore") {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "token-test";
    process.env.LINE_TARGET_ID = "U_OWNER";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    const user = await makeUser();
    const p = await makeProduct({ product_stock_quantity: 100 });
    const order = await orderService.createOrder(String(user._id), {
      order_type: "takeaway",
      channel,
      items: [{ product_id: String(p._id), quantity: 1 }],
    });
    const title = `ออเดอร์ใหม่ ${order.order_no}`;
    await vi.waitFor(async () => expect(await notificationModel.findOne({ title })).toBeTruthy());
    await settle();
    const pushedToOwner = fetchSpy.mock.calls.some(
      ([url, init]) => url === "https://api.line.me/v2/bot/message/push" && JSON.parse(init.body).to === "U_OWNER"
    );
    return { note: await notificationModel.findOne({ title }).lean<{ line_sent: boolean }>(), pushedToOwner };
  }

  it("ออเดอร์เว็บ (ORD-) → บันทึก + push LINE เหมือนเดิม", async () => {
    const { note, pushedToOwner } = await placeOrder("online");
    expect(pushedToOwner).toBe(true);
    expect(note?.line_sent).toBe(true);
  });

  it("ออเดอร์ POS (ค่าเริ่มต้น) → บันทึกในเว็บ แต่ไม่ push LINE", async () => {
    delete process.env.LINE_NOTIFY_POS_ORDERS;
    const { note, pushedToOwner } = await placeOrder("instore");
    expect(note).toBeTruthy();
    expect(pushedToOwner).toBe(false);
    expect(note?.line_sent).toBe(false);
  });

  it("ออเดอร์ POS + LINE_NOTIFY_POS_ORDERS=true → push LINE", async () => {
    process.env.LINE_NOTIFY_POS_ORDERS = "true";
    const { pushedToOwner } = await placeOrder("instore");
    expect(pushedToOwner).toBe(true);
  });
});
