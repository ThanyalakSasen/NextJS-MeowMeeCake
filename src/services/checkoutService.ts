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
 * PaymentGroup (บิล > 1) สร้างก่อนบิลแรก แล้วเติม members + shipping_waivers ตอนท้าย — พังขั้นไหนก็ rollback ทั้งชุด
 * shipping_waivers: บิลที่รวมค่าส่ง → บิลที่เก็บแทน + ค่าส่ง (paymentGroupService.restoreWaivedShipping คืนค่าส่งเมื่อบิลนั้นถูกยกเลิก)
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
  return new Set(combinedShippingPayers(bills).keys());
}

/** เหมือน combinedShippingWaivers แต่บอกด้วยว่าบิลที่ไม่เก็บ (key) รวมค่าส่งกับบิลไหน (ค่า = key ของบิลที่เก็บ) */
export function combinedShippingPayers(bills: ShippingCandidate[]): Map<string, string> {
  const waived = new Map<string, string>();
  const byAddress = new Map<string, ShippingCandidate[]>();
  for (const b of bills) {
    if (!b.address) continue;
    const k = shippingAddressKey(b.address);
    byAddress.set(k, [...(byAddress.get(k) ?? []), b]);
  }
  for (const group of byAddress.values()) {
    const sorted = group.map((b, i) => ({ b, i })).sort((x, y) => dayNumber(x.b.date) - dayNumber(y.b.date) || x.i - y.i);
    let payer: { key: string; day: number } | null = null;
    for (const { b } of sorted) {
      const d = dayNumber(b.date);
      if (payer !== null && d - payer.day <= COMBINE_SHIPPING_DAYS) waived.set(b.key, payer.key);
      else payer = { key: b.key, day: d };
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
  const waived = combinedShippingPayers([
    ...(body.order?.order_type === "delivery" ? [{ key: "order", address: orderAddress, date: today }] : []),
    ...body.preorders.flatMap((p, i) =>
      p.order_type === "delivery" ? [{ key: p.round_id, address: preorderAddresses[i], date: pickupOf.get(p.round_id) ?? today }] : []
    ),
  ]);
  // ค่าส่งจริงของแต่ละบิล (key → บาท) — บิลที่ไม่เก็บจดค่าส่งของบิลที่เก็บแทนไว้ในกลุ่ม (คืนค่าส่งเมื่อบิลนั้นถูกยกเลิก)
  const feeOf = new Map<string, number>();
  const keyOf = new Map<string, string>(); // bill _id → key

  // กลุ่มสร้างก่อนบิล (อยู่ใน try) — สร้างกลุ่มไม่ได้ = ยังไม่มีบิล · ไม่ใช่สร้างบิล/ล้างตะกร้าแล้วค่อยพังตอนท้าย
  const billCount = body.preorders.length + (body.order ? 1 : 0);
  let groupId: string | null = null;

  try {
    if (billCount > 1) groupId = String((await paymentGroupModel.create({ user_id: userId, members: [] }))._id);


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
      feeOf.set(p.round_id, Number(preorder.delivery_fee ?? 0));
      keyOf.set(String(preorder._id), p.round_id);
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
      feeOf.set("order", Number(order.delivery_fee ?? 0));
      keyOf.set(String(order._id), "order");
    }

    if (groupId) {
      const billOfKey = new Map(created.map((b) => [keyOf.get(b._id), b]));
      const shipping_waivers = created.flatMap((b) => {
        const payer = billOfKey.get(waived.get(keyOf.get(b._id) ?? ""));
        return payer ? [{ ref_id: b._id, payer_kind: payer.kind, payer_ref_id: payer._id, fee: feeOf.get(keyOf.get(payer._id)!) ?? 0 }] : [];
      });
      await paymentGroupModel.updateOne(
        { _id: groupId },
        { $set: { members: created.map((b) => ({ kind: b.kind, ref_id: b._id, doc_no: b.doc_no })), shipping_waivers } }
      );
    }
  } catch (err) {
    await rollback(userId, created);
    if (groupId) await paymentGroupModel.deleteOne({ _id: groupId }).catch((e) => log.error("checkout.rollback_group_failed", { group_id: groupId, err: e }));
    throw err;
  }

  return { group_id: groupId, bills: created };
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
