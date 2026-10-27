/**
 * checkoutService — สั่งซื้อรวมครั้งเดียว (ตะกร้ารวม: สินค้าปกติ + พรีออเดอร์หลายรอบ · ผู้ใช้เลือก 2026-10-27)
 *
 *   POST /api/shop/checkout { order?, preorders[] } → หลายบิล: ออเดอร์สินค้าปกติ 1 ใบ + พรีออเดอร์ 1 ใบต่อรอบ
 *   - แต่ละบิลเลือกวิธีรับ/ที่อยู่/จุดรับเอง · ค่าส่งคิดต่อบิล (ส่งคนละวัน = คนละรอบส่ง)
 *   - รวมค่าส่ง (2026-10-27): บิลจัดส่งที่อยู่เดียวกัน + วันรับห่างกันไม่เกิน 7 วัน → เก็บค่าส่งครั้งเดียว
 *     ที่บิลที่รับเร็วสุด (combinedShippingWaivers) · ค่าส่งคิดจากจังหวัดอย่างเดียว ที่อยู่เดียวกัน = ค่าส่งเท่ากัน
 *   - คูปอง/โค้ดส่วนลดใช้ได้กับบิลเดียว (schemas/checkout · หน้าเว็บเลือกบิลที่ลดได้มากสุดให้)
 *   - บิลมากกว่า 1 ใบ → ผูกเป็น PaymentGroup — ลูกค้าโอนครั้งเดียว + แนบสลิปเดียว (paymentService.submitGroupSlip)
 *
 * ลำดับสร้าง: พรีออเดอร์ทุกใบก่อน แล้วออเดอร์จากตะกร้าเป็นใบสุดท้าย (createOrderFromCart ล้างตะกร้า)
 * ใบไหนสร้างไม่ผ่าน → ยกเลิกใบที่สร้างไปแล้ว (คืนโควตารอบ/คูปอง — cancelPreorder) แล้วโยน error ของใบนั้น
 * ตะกร้ายังอยู่ครบ เพราะออเดอร์จากตะกร้าสร้างเป็นขั้นสุดท้าย
 */
import dbConnect from "../lib/dbConnect";
import { log } from "../lib/logger";
import { bangkokDateString } from "../lib/datetime";
import preorderRoundModel from "../models/preorderRoundModel";
import type { CheckoutBody } from "../schemas/checkout";
import paymentGroupModel from "../models/paymentGroupModel";
import * as addressService from "./addressService";
import * as orderService from "./orderService";
import * as preorderService from "./preorderService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CheckoutBill {
  kind: "order" | "preorder";
  _id: string;
  doc_no: string;
  total_amount: number;
}

export interface CheckoutResult {
  /** มีเมื่อสร้างมากกว่า 1 บิล — ไปหน้าชำระรวม /customer/account/payment-group/{group_id} */
  group_id: string | null;
  bills: CheckoutBill[];
}

const ROLLBACK_REASON = "สั่งซื้อรวมไม่สำเร็จ — ระบบยกเลิกบิลนี้ให้อัตโนมัติ";

/** วันรับห่างกันได้ไม่เกินกี่วัน ถึงจะรวมค่าส่งเป็นครั้งเดียว */
export const COMBINE_SHIPPING_DAYS = 7;

/** บิลจัดส่ง 1 ใบสำหรับคิดรวมค่าส่ง — key = "order" หรือ round_id · date = วันรับ "YYYY-MM-DD" เวลาไทย */
export interface ShippingCandidate {
  key: string;
  address: Record<string, string> | null;
  date: string;
}

const ADDRESS_KEY_FIELDS = ["house_no", "sub_district", "district", "province", "zip_code"] as const;
/** ที่อยู่เดียวกัน = บ้านเลขที่ · ตำบล · อำเภอ · จังหวัด · รหัสไปรษณีย์ ตรงกัน (ไม่สนช่องว่าง/ตัวพิมพ์) */
export const shippingAddressKey = (a: Record<string, string>) =>
  ADDRESS_KEY_FIELDS.map((f) => String(a[f] ?? "").trim().replace(/\s+/g, " ").toLowerCase()).join("|");

const dayNumber = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/**
 * บิลที่ไม่ต้องเก็บค่าส่ง (key) — ต่อที่อยู่: เรียงตามวันรับ (เสมอกัน = ตามลำดับที่ส่งมา) บิลแรกเก็บค่าส่ง
 * บิลที่วันรับห่างจากบิลที่เก็บไม่เกิน COMBINE_SHIPPING_DAYS = ไม่เก็บ · เกินกว่านั้นเริ่มกลุ่มใหม่ (เก็บอีกครั้ง)
 */
export function combinedShippingWaivers(bills: ShippingCandidate[]): Set<string> {
  const waived = new Set<string>();
  const byAddress = new Map<string, ShippingCandidate[]>();
  for (const b of bills) {
    if (!b.address) continue;
    const k = shippingAddressKey(b.address);
    byAddress.set(k, [...(byAddress.get(k) ?? []), b]);
  }
  for (const group of byAddress.values()) {
    const sorted = group.map((b, i) => ({ b, i })).sort((x, y) => dayNumber(x.b.date) - dayNumber(y.b.date) || x.i - y.i);
    let payerDay: number | null = null;
    for (const { b } of sorted) {
      const d = dayNumber(b.date);
      if (payerDay !== null && d - payerDay <= COMBINE_SHIPPING_DAYS) waived.add(b.key);
      else payerDay = d;
    }
  }
  return waived;
}

export async function checkout(userId: string, body: CheckoutBody): Promise<CheckoutResult> {
  await dbConnect();
  const created: CheckoutBill[] = [];

  // ที่อยู่จัดส่งของทุกบิลก่อน (ใช้ทั้งสร้างบิลและคิดรวมค่าส่ง) · วันรับพรีออเดอร์ = วันรับของรอบ · สินค้าปกติ = วันนี้
  const preorderAddresses = await Promise.all(body.preorders.map((p) => addressService.resolveDeliverySnapshot(userId, p)));
  const orderAddress = body.order ? await addressService.resolveDeliverySnapshot(userId, body.order) : null;
  const rounds = await preorderRoundModel
    .find({ _id: { $in: body.preorders.map((p) => p.round_id) } })
    .select("pickup_date")
    .lean<{ _id: unknown; pickup_date?: Date | null }[]>();
  const pickupOf = new Map(rounds.map((r) => [String(r._id), r.pickup_date ? bangkokDateString(new Date(r.pickup_date)) : null]));
  const today = bangkokDateString();
  const waived = combinedShippingWaivers([
    ...(body.order?.order_type === "delivery" ? [{ key: "order", address: orderAddress, date: today }] : []),
    ...body.preorders.flatMap((p, i) =>
      p.order_type === "delivery" ? [{ key: p.round_id, address: preorderAddresses[i], date: pickupOf.get(p.round_id) ?? today }] : []
    ),
  ]);

  try {
    for (const [i, p] of body.preorders.entries()) {
      const delivery_address = preorderAddresses[i];
      const preorder: any = await preorderService.createPreorder(
        userId,
        {
          round_id: p.round_id,
          order_type: p.order_type,
          delivery_address,
          items: p.items,
          pickup_location_id: p.pickup_location_id ?? null,
          pickup_date: p.pickup_date ?? null,
          user_coupon_id: p.user_coupon_id ?? null,
          promotion_code: p.promotion_code ?? null,
          points_to_redeem: p.points_to_redeem ?? 0,
        },
        { storefront: true, waive_delivery_fee: waived.has(p.round_id) }
      );
      created.push({ kind: "preorder", _id: String(preorder._id), doc_no: String(preorder.preorder_no), total_amount: Number(preorder.total_amount ?? 0) });
    }

    if (body.order) {
      const o = body.order;
      const order: any = await orderService.createOrderFromCart(userId, {
        order_type: o.order_type,
        delivery_address: orderAddress,
        promotion_code: o.promotion_code ?? null,
        promotion_id: o.promotion_id ?? null,
        channel: "online",
        storefront: true,
        waive_delivery_fee: waived.has("order"),
        pickup_location_id: o.pickup_location_id ?? null,
        pickup_date: o.pickup_date ?? null,
        user_coupon_id: o.user_coupon_id ?? null,
        points_to_redeem: o.points_to_redeem ?? 0,
        item_notes: o.item_notes ?? {},
        cart_item_ids: o.cart_item_ids ?? null,
      });
      // ออเดอร์สินค้าปกติขึ้นก่อนในรายการบิล
      created.unshift({ kind: "order", _id: String(order._id), doc_no: String(order.order_no), total_amount: Number(order.total_amount ?? 0) });
    }
  } catch (err) {
    await rollback(userId, created);
    throw err;
  }

  if (created.length < 2) return { group_id: null, bills: created };
  const group = await paymentGroupModel.create({
    user_id: userId,
    members: created.map((b) => ({ kind: b.kind, ref_id: b._id, doc_no: b.doc_no })),
  });
  return { group_id: String(group._id), bills: created };
}

/** ยกเลิกบิลที่สร้างไปแล้วในการสั่งซื้อรวมที่ล้ม — best-effort ทีละใบ (ใบไหนพังให้ log แล้วไปต่อ) */
async function rollback(userId: string, bills: CheckoutBill[]): Promise<void> {
  for (const b of bills) {
    try {
      if (b.kind === "preorder") {
        // cancelled_by = ลูกค้าเอง → ไม่ส่งแจ้งเตือน "ถูกยกเลิก" กลับไปหาลูกค้า
        await preorderService.cancelPreorder(b._id, { cancelled_by: userId, cancelled_reason: ROLLBACK_REASON });
      } else {
        await orderService.cancelOrderByCustomer(b._id, userId, ROLLBACK_REASON);
      }
    } catch (err) {
      log.error("checkout.rollback_failed", { kind: b.kind, id: b._id, err });
    }
  }
}
