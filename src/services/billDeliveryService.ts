/**
 * billDeliveryService — ลูกค้าย้อนกลับไปแก้ "วิธีรับสินค้า / ที่อยู่จัดส่ง / จุดรับ" ของบิลที่สร้างแล้วแต่ยังไม่ชำระ (ผู้ใช้เลือก 2026-10-29)
 *   PATCH /api/shop/orders/:id/delivery · PATCH /api/shop/preorders/:id/delivery
 *   body: { order_type, address_id + recipient_name + recipient_phone | delivery_address, pickup_location_id?, pickup_date? }
 *
 * แก้บิลเดิม (เลขเดิม) — ไม่ยกเลิกแล้วสร้างใหม่:
 *   - แก้ได้เฉพาะบิลของตัวเอง · สถานะ pending · ยังไม่ชำระ · ยังไม่ส่งสลิป (ไม่มีรายการชำระที่รอตรวจ) · ยังไม่เลยกำหนดชำระ
 *   - บิลที่ชำระรวมกับบิลอื่น (PaymentGroup) แก้ไม่ได้ — ค่าส่งรวมกันข้ามบิล (shipping_waivers) แก้ใบเดียวแล้วยอดของอีกใบผิด
 *   - ค่าส่งคิดใหม่ฝั่ง server (ShippingZones + ขอบเขตจัดส่ง — ส่งไม่ได้ = 400 เหมือนตอนสั่ง)
 *   - ส่วนลด: โปร/คูปองแบบลดราคาสินค้าและแต้ม ไม่ขึ้นกับค่าส่ง → คงเดิม
 *     โปร/คูปอง "ส่งฟรี" (FreeShipping) = ส่วนลดเท่าค่าส่ง → ปรับตามค่าส่งใหม่ · เปลี่ยนเป็นรับเอง/ค่าส่ง 0 = ใช้ส่งฟรีไม่ได้ → 422
 *   - ยอดรวม = ราคาสินค้า − ส่วนลด + ค่าส่งใหม่ · กำหนดชำระ (payment_due_at) คงเดิม
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/httpError";
import { isObjectId } from "../lib/objectId";
import { toSatang } from "../lib/money";
import orderModel from "../models/orderModel";
import orderItemModel from "../models/orderItemModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import preorderRoundModel from "../models/preorderRoundModel";
import paymentModel from "../models/paymentModel";
import paymentGroupModel from "../models/paymentGroupModel";
import promotionModel from "../models/promotionModel";
import userCouponModel from "../models/userCouponModel";
import type { EditBillDeliveryBody } from "../schemas/billDelivery";
import * as addressService from "./addressService";
import * as shippingService from "./shippingService";
import * as orderService from "./orderService";
import * as preorderService from "./preorderService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type BillKind = "order" | "preorder";

const ADDRESS_FIELDS = ["recipient_name", "recipient_phone", "house_no", "sub_district", "district", "province", "zip_code"] as const;

/** บิลนี้ใช้โปร/คูปองส่งฟรีอยู่ไหม (ส่วนลดของมันเท่าค่าส่ง → ต้องปรับตามค่าส่งใหม่) */
async function usesFreeShipping(bill: any): Promise<{ any: boolean; viaCoupon: boolean }> {
  const promoIds = [...new Set([bill.promotion_id, ...(bill.promotion_ids ?? [])].filter(Boolean).map(String))];
  let couponPromoId: string | null = null;
  if (bill.user_coupon_id) {
    const uc = await userCouponModel.findById(bill.user_coupon_id).select("promotion_id").lean<any>();
    couponPromoId = uc?.promotion_id ? String(uc.promotion_id) : null;
  }
  const ids = [...new Set([...promoIds, ...(couponPromoId ? [couponPromoId] : [])])];
  if (!ids.length) return { any: false, viaCoupon: false };
  const free = await promotionModel
    .find({ _id: { $in: ids }, discount_type: "FreeShipping" })
    .select("_id")
    .lean<{ _id: unknown }[]>();
  const freeIds = new Set(free.map((p) => String(p._id)));
  return { any: freeIds.size > 0, viaCoupon: !!couponPromoId && freeIds.has(couponPromoId) };
}

export async function editBillDelivery(userId: string, kind: BillKind, id: string, body: EditBillDeliveryBody) {
  if (!isObjectId(id)) throw badRequest("รูปแบบ id ไม่ถูกต้อง");
  await dbConnect();
  const model: any = kind === "order" ? orderModel : preorderModel;
  const label = kind === "order" ? "ออเดอร์" : "พรีออเดอร์";

  const bill = await model.findOne({ _id: id, deleted_at: null }).lean();
  if (!bill) throw notFound(`ไม่พบ${label}`);
  if (String(bill.user_id) !== String(userId)) throw forbidden();
  if (bill.order_status !== "pending") throw conflict(`${label}นี้ร้านรับแล้วหรือถูกยกเลิก — แก้วิธีรับสินค้าไม่ได้`);
  if (bill.payment_status !== "pending") throw conflict(`${label}นี้ชำระเงินแล้ว — แก้วิธีรับสินค้าไม่ได้`);
  if (bill.payment_due_at && new Date(bill.payment_due_at).getTime() <= Date.now()) {
    throw conflict(`${label}นี้เลยกำหนดชำระแล้ว — แก้วิธีรับสินค้าไม่ได้`);
  }
  const slip = await paymentModel.exists({ [kind === "order" ? "order_id" : "preorder_id"]: bill._id, status: "pending", deleted_at: null });
  if (slip) throw conflict("ส่งสลิปแล้ว — แก้วิธีรับสินค้าไม่ได้ (ติดต่อร้านผ่านแชทได้)");
  const grouped = await paymentGroupModel.exists({ "members.ref_id": bill._id });
  if (grouped) throw conflict("บิลนี้ชำระรวมกับบิลอื่น (ค่าส่งคิดรวมกัน) — แก้ทีละบิลไม่ได้ ติดต่อร้านผ่านแชทได้");

  // ── วิธีรับใหม่ ──
  let delivery_address: Record<string, string> | null = null;
  if (body.order_type === "delivery") {
    const addr = await addressService.resolveDeliverySnapshot(userId, body);
    if (!addr) throw badRequest("กรุณาเลือกหรือกรอกที่อยู่จัดส่ง");
    for (const f of ADDRESS_FIELDS) if (!addr[f]) throw badRequest(`delivery_address.${f} จำเป็นต้องระบุ`);
    delivery_address = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, addr[f]]));
  }
  let pickup: Awaited<ReturnType<typeof shippingService.resolvePickupSelection>> | null = null;
  if (body.order_type === "takeaway" && body.pickup_location_id) {
    if (kind === "order") {
      pickup = await shippingService.resolvePickupSelection(body.pickup_location_id, body.pickup_date, { type: "order" });
    } else {
      const round = await preorderRoundModel.findById(bill.round_id).select("pickup_date").lean<any>();
      pickup = await shippingService.resolvePickupSelection(body.pickup_location_id, body.pickup_date, {
        type: "preorder",
        roundPickupDate: round?.pickup_date ?? null,
      });
    }
  }

  // ── ค่าส่งใหม่ (server คิดเอง เหมือนตอนสั่ง) ──
  let delivery_fee = 0;
  if (body.order_type === "delivery") {
    const itemModel: any = kind === "order" ? orderItemModel : preorderItemModel;
    const items = await itemModel
      .find(kind === "order" ? { order_id: bill._id } : { preorder_id: bill._id })
      .select("product_id")
      .lean();
    delivery_fee = toSatang(
      (
        await shippingService.quoteStorefrontDelivery({
          province: delivery_address?.province ?? null,
          productIds: items.map((it: any) => String(it.product_id)),
          ...(kind === "preorder" ? { preorder: true } : {}),
        })
      ).fee
    );
  }

  // ── ส่วนลดส่งฟรี = ค่าส่ง → ปรับตาม · อื่น ๆ คงเดิม ──
  const oldFee = Number(bill.delivery_fee ?? 0);
  let discount_amount = Number(bill.discount_amount ?? 0);
  let coupon_discount = Number(bill.coupon_discount ?? 0);
  const free = await usesFreeShipping(bill);
  if (free.any) {
    if (!(delivery_fee > 0)) {
      throw unprocessable("บิลนี้ใช้โปร/คูปองส่งฟรี — ต้องเป็นแบบจัดส่งที่มีค่าส่ง (เปลี่ยนเป็นรับเองไม่ได้)");
    }
    discount_amount = toSatang(discount_amount - oldFee + delivery_fee);
    if (free.viaCoupon) coupon_discount = toSatang(coupon_discount - oldFee + delivery_fee);
  }
  const subtotal = Number(bill.subtotal ?? 0);
  if (discount_amount > subtotal + delivery_fee) throw badRequest("ส่วนลดมากกว่ายอดที่ต้องชำระ");
  const total_amount = toSatang(subtotal - discount_amount + delivery_fee);

  // อัปเดตแบบมีเงื่อนไข — กันแข่งกับการส่งสลิป/ยกเลิก/หมดเวลาที่เกิดระหว่างนี้
  const updated = await model.findOneAndUpdate(
    { _id: bill._id, order_status: "pending", payment_status: "pending", deleted_at: null },
    {
      $set: {
        order_type: body.order_type,
        delivery_address,
        pickup_date: pickup?.pickup_date ?? null,
        pickup_point: pickup?.pickup_point ?? null,
        delivery_fee,
        discount_amount,
        coupon_discount,
        total_amount,
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) throw conflict(`${label}นี้เปลี่ยนสถานะไปแล้ว กรุณารีเฟรชหน้า`);

  return kind === "order" ? orderService.getOrderById(id) : preorderService.getPreorderById(id);
}
