/**
 * pointsService — แต้มสะสมของลูกค้า (ย้ายมาจาก backend ฝั่งลูกค้า src/lib/points.ts · customer-backend-merge.md §8.11)
 *
 * สมุดบัญชี PointTransactions: ทุกการได้/ใช้/หมดอายุ = 1 แถว · ยอดคงเหลือ = ผลรวม remaining ของล็อต earn ที่ยังไม่หมดอายุ
 * กติกา (ผู้ใช้เลือก "แบบฝั่งลูกค้า"): ซื้อทุก 25 บาท = 1 แต้ม (ให้ตอนออเดอร์ completed) · 10 แต้ม = 1 บาท ·
 * ใช้ได้เมื่อมี ≥ 100 แต้ม ทีละ 10 แต้ม ไม่เกิน 30% ของยอดสินค้า (หลังหักคูปอง) · อายุแต้ม 365 วัน ·
 * โบนัส: สมัคร 50 (หลังยืนยันอีเมล) · ข้อมูลส่วนตัวครบ 10 · แชร์สินค้า 5 (ครั้งเดียวต่อสินค้า)
 * ยกเลิก/คืนเงิน → คืนแต้มที่ใช้ (กลับล็อตเดิม) + ดึงแต้มที่ได้จากออเดอร์นั้นคืน
 *
 * MongoDB ของร้านเป็น standalone (ไม่มี transaction) → หักแต้มแบบมีเงื่อนไขทีละล็อต + คืนเองถ้าพลาดกลางทาง
 * (ฝั่งลูกค้าใช้ transaction — ข้อมูลรูปแบบเดียวกัน ใช้ collection เดียวกันได้)
 */
import mongoose from "mongoose";
import dbConnect from "../lib/dbConnect";
import { badRequest, conflict } from "../lib/httpError";
import { log } from "../lib/logger";
import pointTransactionModel from "../models/pointTransactionModel";
import userModel from "../models/userModel";
import roleModel from "../models/roleModel";
import addressModel from "../models/addressModel";

export const POINT_RULES = {
  /** ทุก ๆ กี่บาท ได้ 1 แต้ม */
  BAHT_PER_POINT: 25,
  /** 1 แต้ม มีมูลค่ากี่บาทตอนใช้เป็นส่วนลด (10 แต้ม = 1 บาท) */
  POINT_VALUE_BAHT: 0.1,
  /** ต้องมีแต้มคงเหลืออย่างน้อยเท่านี้ถึงจะเริ่มใช้แต้มได้ */
  MIN_BALANCE_TO_REDEEM: 100,
  /** ใช้แต้มทีละขั้นกี่แต้ม (ส่วนลดเป็นจำนวนเต็มบาทเสมอ) */
  REDEEM_STEP: 10,
  /** ใช้แต้มลดได้ไม่เกินกี่ % ของยอดสินค้าต่อออเดอร์ */
  MAX_REDEEM_RATIO: 0.3,
  /** อายุแต้ม (วัน) นับจากวันที่ได้รับ */
  EXPIRY_DAYS: 365,
  /** แจ้งแต้มใกล้หมดอายุล่วงหน้ากี่วัน */
  EXPIRING_SOON_DAYS: 30,
  WELCOME: 50,
  REVIEW: 15,
  REVIEW_PHOTO: 20,
  SHARE: 5,
  PROFILE: 10,
} as const;

export type PointRefType = "order" | "preorder" | "review" | "product";
type EarnSource = "purchase" | "welcome" | "review" | "review_photo" | "share" | "profile";
export type LoyaltyKind = "order" | "preorder";

const DAY_MS = 24 * 60 * 60 * 1000;
const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

export function pointsToBaht(points: number): number {
  return Math.round(points * POINT_RULES.POINT_VALUE_BAHT * 100) / 100;
}

/** แต้มที่ได้จากยอดซื้อ — ปัดเศษทิ้ง (ซื้อ 2,500 บาท = 100 แต้ม) */
export function pointsEarnedFor(amount: number): number {
  return Math.floor(Math.max(0, amount) / POINT_RULES.BAHT_PER_POINT);
}

/** แต้มสูงสุดที่ใช้ได้กับยอดสินค้านี้ — 0 ถ้าแต้มยังไม่ถึงขั้นต่ำ */
export function maxRedeemablePoints(balance: number, subtotal: number): number {
  if (balance < POINT_RULES.MIN_BALANCE_TO_REDEEM) return 0;
  const capBaht = Math.max(0, subtotal) * POINT_RULES.MAX_REDEEM_RATIO;
  // + 1e-9 กันทศนิยมเพี้ยน (70 * 0.3 / 0.1 = 209.999… ต้องได้ 210)
  const capPoints = Math.floor(capBaht / POINT_RULES.POINT_VALUE_BAHT + 1e-9);
  const points = Math.min(balance, capPoints);
  return points - (points % POINT_RULES.REDEEM_STEP);
}

/** ตรวจว่าใช้แต้มจำนวนนี้กับยอดสินค้านี้ได้ไหม — คืนส่วนลด (บาท) · ไม่ผ่าน = 400 */
export function validateRedemption(points: number, balance: number, subtotal: number): number {
  if (!Number.isInteger(points) || points <= 0) throw badRequest("จำนวนแต้มไม่ถูกต้อง");
  if (points % POINT_RULES.REDEEM_STEP !== 0) throw badRequest(`ใช้แต้มได้ทีละ ${POINT_RULES.REDEEM_STEP} แต้ม`);
  if (balance < POINT_RULES.MIN_BALANCE_TO_REDEEM) {
    throw badRequest(`ต้องมีแต้มสะสมอย่างน้อย ${POINT_RULES.MIN_BALANCE_TO_REDEEM} แต้มก่อนจึงจะใช้แต้มได้`);
  }
  if (points > balance) throw badRequest("แต้มสะสมไม่พอ");
  const max = maxRedeemablePoints(balance, subtotal);
  if (points > max) {
    throw badRequest(
      `ใช้แต้มได้สูงสุด ${max} แต้มสำหรับออเดอร์นี้ (ไม่เกิน ${POINT_RULES.MAX_REDEEM_RATIO * 100}% ของยอดสินค้า)`
    );
  }
  return pointsToBaht(points);
}

/** สะสมแต้มได้เฉพาะลูกค้า (กันออเดอร์หน้าร้านที่ผูก user เป็นพนักงาน/เจ้าของ) */
async function isCustomer(userId: string): Promise<boolean> {
  const user = await userModel.findOne({ _id: userId, deleted_at: null }).select("role_id").lean<{ role_id?: unknown } | null>();
  if (!user?.role_id) return false;
  const role = await roleModel.findById(user.role_id).select("role_type").lean<{ role_type?: string } | null>();
  return role?.role_type === "customer";
}

/** ให้แต้ม 1 ล็อต — dedupe_key ซ้ำ = ไม่ให้ซ้ำ (คืน null) */
export async function awardPoints(opts: {
  userId: string;
  source: EarnSource;
  points: number;
  dedupeKey: string;
  description: string;
  refType?: PointRefType;
  refId?: unknown;
}) {
  await dbConnect();
  if (!Number.isInteger(opts.points) || opts.points <= 0) return null;
  if (!(await isCustomer(opts.userId))) return null;
  try {
    return await pointTransactionModel.create({
      user_id: opts.userId,
      type: "earn",
      source: opts.source,
      points: opts.points,
      remaining: opts.points,
      expires_at: new Date(Date.now() + POINT_RULES.EXPIRY_DAYS * DAY_MS),
      ref_type: opts.refType ?? null,
      ref_id: opts.refId ?? null,
      description: opts.description,
      dedupe_key: opts.dedupeKey,
    });
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

/** ตัดแต้มที่หมดอายุแล้ว + จดประวัติ "แต้มหมดอายุ" (เรียกก่อนแสดงยอด) */
export async function expireLots(userId: string): Promise<void> {
  await dbConnect();
  const lots = await pointTransactionModel
    .find({ user_id: userId, type: "earn", remaining: { $gt: 0 }, expires_at: { $lte: new Date() } })
    .lean<Array<{ _id: unknown; remaining: number; description: string }>>();
  for (const lot of lots) {
    const res = await pointTransactionModel.updateOne({ _id: lot._id, remaining: lot.remaining }, { $set: { remaining: 0 } });
    if (res.modifiedCount === 0) continue;
    await pointTransactionModel.create({
      user_id: userId,
      type: "expire",
      source: "expire",
      points: -lot.remaining,
      allocations: [{ lot_id: lot._id, points: lot.remaining }],
      description: `แต้มหมดอายุ (${lot.description})`,
    });
  }
}

export async function getBalance(userId: string): Promise<number> {
  await dbConnect();
  const [row] = await pointTransactionModel.aggregate<{ total: number }>([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        type: "earn",
        remaining: { $gt: 0 },
        expires_at: { $gt: new Date() },
      },
    },
    { $group: { _id: null, total: { $sum: "$remaining" } } },
  ]);
  return row?.total ?? 0;
}

/**
 * หักแต้มจากล็อตที่ใกล้หมดอายุก่อน (FIFO) แล้วจดแถว type "redeem"
 * ไม่มี transaction: หักแบบมีเงื่อนไขทีละล็อต — พลาดกลางทาง/แต้มไม่พอ → คืนล็อตที่หักไปแล้วก่อน throw
 */
async function deductPoints(opts: {
  userId: string;
  points: number;
  source: "redeem" | "coupon";
  refType: "order" | "preorder" | "coupon";
  refId: unknown;
  description: string;
}): Promise<void> {
  const lots = await pointTransactionModel
    .find({ user_id: opts.userId, type: "earn", remaining: { $gt: 0 }, expires_at: { $gt: new Date() } })
    .sort({ expires_at: 1 })
    .lean<Array<{ _id: unknown; remaining: number }>>();

  let left = opts.points;
  const allocations: Array<{ lot_id: unknown; points: number }> = [];
  const undo = async () => {
    for (const a of allocations) {
      await pointTransactionModel.updateOne({ _id: a.lot_id }, { $inc: { remaining: a.points } });
    }
  };
  try {
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining, left);
      const res = await pointTransactionModel.updateOne(
        { _id: lot._id, remaining: { $gte: take } },
        { $inc: { remaining: -take } }
      );
      if (res.modifiedCount === 0) throw conflict("ยอดแต้มมีการเปลี่ยนแปลง กรุณาลองใหม่อีกครั้ง");
      allocations.push({ lot_id: lot._id, points: take });
      left -= take;
    }
    if (left > 0) throw badRequest("แต้มสะสมไม่พอ");
    await pointTransactionModel.create({
      user_id: opts.userId,
      type: "redeem",
      source: opts.source,
      points: -opts.points,
      allocations,
      ref_type: opts.refType,
      ref_id: opts.refId,
      description: opts.description,
      dedupe_key: `redeem:${opts.refType}:${String(opts.refId)}`,
    });
  } catch (err) {
    await undo();
    if (isDuplicateKey(err)) throw conflict("ใช้แต้มกับคำสั่งซื้อนี้ไปแล้ว");
    throw err;
  }
}

/**
 * ใช้แต้มเป็นส่วนลดของออเดอร์/พรีออเดอร์ — subtotal = ยอดสินค้าหลังหักคูปอง/โปรแล้ว (คิดเพดาน 30%) · คืนส่วนลด (บาท)
 * ผู้เรียกต้องคืนแต้มเอง (refundRedemption) ถ้าสร้างเอกสารไม่สำเร็จ
 */
export async function redeemPoints(opts: {
  userId: string;
  points: number;
  subtotal: number;
  refType: LoyaltyKind;
  refId: unknown;
  refNo: string;
}): Promise<number> {
  await dbConnect();
  await expireLots(opts.userId);
  const discount = validateRedemption(opts.points, await getBalance(opts.userId), opts.subtotal);
  await deductPoints({
    userId: opts.userId,
    points: opts.points,
    source: "redeem",
    refType: opts.refType,
    refId: opts.refId,
    description: `ใช้แต้มเป็นส่วนลด ${discount.toLocaleString("th-TH")} บาท (คำสั่งซื้อ ${opts.refNo})`,
  });
  return discount;
}

/** แลกแต้มเป็นคูปอง — ต้องมีแต้มถึงขั้นต่ำ (ไม่มีเพดาน % เพราะไม่ผูกกับออเดอร์) */
export async function spendPointsForCoupon(opts: { userId: string; points: number; couponId: unknown; couponName: string }) {
  await dbConnect();
  if (!Number.isInteger(opts.points) || opts.points <= 0) throw badRequest("คูปองนี้ไม่ได้เปิดให้แลกด้วยแต้ม");
  await expireLots(opts.userId);
  const balance = await getBalance(opts.userId);
  if (balance < POINT_RULES.MIN_BALANCE_TO_REDEEM) {
    throw badRequest(`ต้องมีแต้มสะสมอย่างน้อย ${POINT_RULES.MIN_BALANCE_TO_REDEEM} แต้มก่อนจึงจะแลกได้`);
  }
  if (opts.points > balance) throw badRequest("แต้มสะสมไม่พอ");
  await deductPoints({
    userId: opts.userId,
    points: opts.points,
    source: "coupon",
    refType: "coupon",
    refId: opts.couponId,
    description: `แลกคูปอง ${opts.couponName}`,
  });
}

/** คืนแต้มที่ใช้ไปกับเอกสารนี้กลับล็อตเดิม (ยกเลิก/คืนเงิน/สร้างไม่สำเร็จ) — เรียกซ้ำได้ (dedupe) */
export async function refundRedemption(refType: LoyaltyKind | "coupon", refId: string): Promise<void> {
  await dbConnect();
  const redeem = await pointTransactionModel
    .findOne({ ref_type: refType, ref_id: refId, type: "redeem" })
    .lean<{ user_id: unknown; points: number; allocations: Array<{ lot_id: unknown; points: number }> } | null>();
  if (!redeem) return;
  try {
    await pointTransactionModel.create({
      user_id: redeem.user_id,
      type: "refund",
      source: "redeem_refund",
      points: -redeem.points,
      allocations: redeem.allocations,
      ref_type: refType,
      ref_id: refId,
      description: refType === "coupon" ? "คืนแต้มจากการแลกคูปองที่ไม่สำเร็จ" : "คืนแต้มจากคำสั่งซื้อที่ถูกยกเลิก",
      dedupe_key: `refund:${refType}:${refId}`,
    });
  } catch (err) {
    if (isDuplicateKey(err)) return;
    throw err;
  }
  for (const a of redeem.allocations) {
    await pointTransactionModel.updateOne({ _id: a.lot_id }, { $inc: { remaining: a.points } });
  }
}

/** ออเดอร์ที่เคยได้แต้มถูกยกเลิก/คืนเงิน → ดึงแต้มส่วนที่ยังไม่ได้ใช้คืน */
async function revokePurchaseEarn(refType: LoyaltyKind, refId: string): Promise<void> {
  const lot = await pointTransactionModel
    .findOne({ ref_type: refType, ref_id: refId, type: "earn", source: "purchase" })
    .lean<{ _id: unknown; user_id: unknown; remaining: number } | null>();
  if (!lot || lot.remaining <= 0) return;
  const res = await pointTransactionModel.updateOne({ _id: lot._id, remaining: lot.remaining }, { $set: { remaining: 0 } });
  if (res.modifiedCount === 0) return;
  await pointTransactionModel.create({
    user_id: lot.user_id,
    type: "revoke",
    source: "purchase_revoke",
    points: -lot.remaining,
    allocations: [{ lot_id: lot._id, points: lot.remaining }],
    ref_type: refType,
    ref_id: refId,
    description: "ยกเลิกแต้มจากคำสั่งซื้อที่ถูกยกเลิก",
  });
}

interface OrderLike {
  _id: unknown;
  user_id: unknown;
  order_no?: string;
  preorder_no?: string;
  order_status?: string;
  payment_status?: string;
  subtotal?: number;
  discount_amount?: number;
  delivery_fee?: number;
  total_amount?: number;
}

/**
 * ซิงก์แต้มตามสถานะล่าสุดของออเดอร์/พรีออเดอร์ (เรียกซ้ำได้ — ทุกขั้นมี dedupe)
 *   completed → ให้แต้มตามยอดสินค้าหลังหักส่วนลด (ไม่รวมค่าส่ง)
 *   cancelled / refunded → คืนแต้มที่ใช้ + ดึงแต้มที่ได้คืน
 * ไม่ทำให้ขั้นตอนหลักล้ม — error แค่ log
 */
export async function syncOrderPoints(kind: LoyaltyKind, doc: OrderLike | null): Promise<void> {
  if (!doc?.user_id) return;
  try {
    await dbConnect();
    const refId = String(doc._id);
    if (doc.order_status === "cancelled" || doc.payment_status === "refunded") {
      await refundRedemption(kind, refId);
      await revokePurchaseEarn(kind, refId);
      return;
    }
    if (doc.order_status === "completed") {
      const amount = Math.min(
        Number(doc.subtotal ?? 0) - Number(doc.discount_amount ?? 0),
        Number(doc.total_amount ?? 0) - Number(doc.delivery_fee ?? 0)
      );
      await awardPoints({
        userId: String(doc.user_id),
        source: "purchase",
        points: pointsEarnedFor(amount),
        dedupeKey: `purchase:${kind}:${refId}`,
        description: `ซื้อสินค้า คำสั่งซื้อ ${doc.order_no ?? doc.preorder_no ?? refId}`,
        refType: kind,
        refId: doc._id,
      });
    }
  } catch (err) {
    log.error("points.sync_failed", { kind, id: String(doc._id), err });
  }
}

/** โบนัสสมาชิกใหม่ — ให้หลังยืนยันอีเมล (กันสมัครด้วยอีเมลปลอมเก็บแต้ม) */
export function awardWelcomeBonus(userId: string) {
  return awardPoints({ userId, source: "welcome", points: POINT_RULES.WELCOME, dedupeKey: "welcome", description: "โบนัสสมัครสมาชิกใหม่" });
}

/** ข้อมูลส่วนตัวครบ = วันเกิด + เบอร์โทร + ที่อยู่อย่างน้อย 1 ที่ */
export async function isProfileComplete(userId: string): Promise<boolean> {
  await dbConnect();
  const user = await userModel
    .findOne({ _id: userId, deleted_at: null })
    .select("user_birthdate user_phone")
    .lean<{ user_birthdate?: Date | null; user_phone?: string | null } | null>();
  if (!user?.user_birthdate || !user.user_phone) return false;
  return !!(await addressModel.exists({ user_id: userId, deleted_at: null }));
}

export async function checkProfileCompletion(userId: string) {
  if (!(await isProfileComplete(userId))) return null;
  return awardPoints({ userId, source: "profile", points: POINT_RULES.PROFILE, dedupeKey: "profile", description: "กรอกข้อมูลส่วนตัวครบถ้วน" });
}

/** เรียกได้จากทุกที่ — แต้มไม่ใช่ขั้นตอนหลัก error ไม่ทำให้ request ล้ม */
export async function safely(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error("points.safely_failed", { label, err });
  }
}

/** หน้าสมาชิก: ยอด + แต้มใกล้หมดอายุ + ประวัติ 50 รายการ + สถานะโบนัส */
export async function getMyPoints(userId: string) {
  await expireLots(userId);
  await safely("profile", () => checkProfileCompletion(userId));
  const now = new Date();
  const soon = new Date(now.getTime() + POINT_RULES.EXPIRING_SOON_DAYS * DAY_MS);
  const [balance, expiringLots, history, bonuses, profileComplete] = await Promise.all([
    getBalance(userId),
    pointTransactionModel
      .find({ user_id: userId, type: "earn", remaining: { $gt: 0 }, expires_at: { $gt: now, $lte: soon } })
      .sort({ expires_at: 1 })
      .select("remaining expires_at")
      .lean<Array<{ remaining: number; expires_at: Date }>>(),
    pointTransactionModel
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(50)
      .select("type source points description created_at expires_at")
      .lean(),
    pointTransactionModel
      .find({ user_id: userId, dedupe_key: { $in: ["welcome", "profile"] } })
      .select("dedupe_key")
      .lean<Array<{ dedupe_key: string }>>(),
    isProfileComplete(userId),
  ]);
  const earned = new Set(bonuses.map((b) => b.dedupe_key));
  return {
    balance,
    expiring_soon: {
      points: expiringLots.reduce((s, l) => s + l.remaining, 0),
      first_date: expiringLots[0]?.expires_at ?? null,
    },
    history,
    bonuses: { welcome: earned.has("welcome"), profile: earned.has("profile") },
    profile_complete: profileComplete,
    rules: POINT_RULES,
  };
}

/** แชร์สินค้า — ได้แต้มครั้งเดียวต่อสินค้า */
export async function awardShare(userId: string, product: { _id: unknown; product_name_th?: string }) {
  const lot = await awardPoints({
    userId,
    source: "share",
    points: POINT_RULES.SHARE,
    dedupeKey: `share:${String(product._id)}`,
    description: `แชร์สินค้า ${product.product_name_th ?? ""}`.trim(),
    refType: "product",
    refId: product._id,
  });
  return { awarded: lot ? POINT_RULES.SHARE : 0 };
}

