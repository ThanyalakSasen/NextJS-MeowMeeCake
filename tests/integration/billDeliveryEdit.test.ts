import { describe, it, expect } from "vitest";
import productCategoryModel from "@/models/productCategoryModel";
import promotionModel from "@/models/promotionModel";
import paymentModel from "@/models/paymentModel";
import paymentGroupModel from "@/models/paymentGroupModel";
import orderModel from "@/models/orderModel";
import * as orderService from "@/services/orderService";
import { editBillDelivery } from "@/services/billDeliveryService";
import { makeUser, makeProduct } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** ลูกค้าย้อนกลับไปแก้วิธีรับ/ที่อยู่ของบิลที่ยังไม่ชำระ (services/billDeliveryService.ts) */

const address = (province: string) => ({
  recipient_name: "ลูกค้า",
  recipient_phone: "0812345678",
  house_no: "1",
  sub_district: "ในเมือง",
  district: "เมือง",
  province,
  zip_code: "43000",
});

async function setup(extra: Record<string, unknown> = {}) {
  const cat = await productCategoryModel.create({ product_category_name: `ซาวโดว์-${Math.random()}`, ships_nationwide: true });
  const p = await makeProduct({ product_price: 200, category_id: cat._id, product_stock_quantity: 10 });
  const user = await makeUser();
  const uid = String(user._id);
  const order = (await orderService.createOrder(uid, {
    order_type: "delivery",
    delivery_address: address("หนองคาย"),
    items: [{ product_id: String(p._id), quantity: 1 }],
    storefront: true,
    ...extra,
  })) as any;
  return { uid, order };
}

describe("แก้วิธีรับสินค้าของบิลที่ยังไม่ชำระ", () => {
  it("เปลี่ยนที่อยู่ = ค่าส่ง/ยอดรวมคิดใหม่ · เลขเดิม · เปลี่ยนเป็นรับเอง = ค่าส่ง 0", async () => {
    const { uid, order } = await setup();
    expect(order.delivery_fee).toBe(40);
    expect(order.total_amount).toBe(240);

    const moved = (await editBillDelivery(uid, "order", String(order._id), {
      order_type: "delivery",
      delivery_address: address("กรุงเทพมหานคร"),
    })) as any;
    expect(moved).toMatchObject({ order_no: order.order_no, delivery_fee: 100, total_amount: 300 });
    expect(moved.delivery_address.province).toBe("กรุงเทพมหานคร");

    const pickup = (await editBillDelivery(uid, "order", String(order._id), { order_type: "takeaway" })) as any;
    expect(pickup).toMatchObject({ order_type: "takeaway", delivery_fee: 0, total_amount: 200, delivery_address: null });
  });

  it("ของคนอื่น = 403 · ส่งสลิปแล้ว / ชำระรวม / เลยกำหนดชำระ = 409", async () => {
    const { uid, order } = await setup();
    const other = await makeUser();
    const body = { order_type: "takeaway" as const };
    await expect(editBillDelivery(String(other._id), "order", String(order._id), body)).rejects.toMatchObject({ status: 403 });

    await paymentGroupModel.create({ user_id: uid, members: [{ kind: "order", ref_id: order._id, doc_no: order.order_no }] });
    await expect(editBillDelivery(uid, "order", String(order._id), body)).rejects.toMatchObject({ status: 409 });
    await paymentGroupModel.deleteMany({});

    await paymentModel.create({ user_id: uid, order_id: order._id, amount: order.total_amount, status: "pending", slip_image_url: "x" });
    await expect(editBillDelivery(uid, "order", String(order._id), body)).rejects.toMatchObject({ status: 409 });
    await paymentModel.deleteMany({});

    await orderModel.updateOne({ _id: order._id }, { $set: { payment_due_at: new Date(Date.now() - 1000) } });
    await expect(editBillDelivery(uid, "order", String(order._id), body)).rejects.toMatchObject({ status: 409 });
  });

  it("โปรส่งฟรี: ส่วนลดปรับตามค่าส่งใหม่ (ยอดสุทธิ = ราคาสินค้า) · เปลี่ยนเป็นรับเอง = 422", async () => {
    const uidForPromo = (await makeUser())._id;
    const promo = await promotionModel.create({
      promotion_name: "ส่งฟรี",
      promotion_code: `FREESHIP${Date.now()}`,
      discount_type: "FreeShipping",
      discount_value: 0,
      created_by: uidForPromo,
      start_date: new Date(Date.now() - 60_000),
      end_date: new Date(Date.now() + 86_400_000),
      is_active: true,
    });
    const { uid, order } = await setup({ promotion_code: promo.promotion_code });
    expect(order).toMatchObject({ delivery_fee: 40, discount_amount: 40, total_amount: 200 });

    const moved = (await editBillDelivery(uid, "order", String(order._id), {
      order_type: "delivery",
      delivery_address: address("กรุงเทพมหานคร"),
    })) as any;
    expect(moved).toMatchObject({ delivery_fee: 100, discount_amount: 100, total_amount: 200 });
    await expect(editBillDelivery(uid, "order", String(order._id), { order_type: "takeaway" })).rejects.toMatchObject({ status: 422 });
  });
});
