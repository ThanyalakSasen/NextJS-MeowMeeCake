/**
 * promotionUsageService — บันทึกการใช้โปรโมชัน (PromotionUsages)
 *
 * recordUsage()  : จองสิทธิ์แบบ atomic ($inc used_count เฉพาะเมื่อยังไม่ถึง usage_limit)
 *                  + สร้างบันทึก + ตรวจโควตาต่อผู้ใช้ (rollback ตัวเองถ้าล้ม)
 * revokeUsage()  : soft-delete บันทึกของออเดอร์ + $inc used_count -1   (เรียกตอนออเดอร์ถูกยกเลิก)
 * getUserUsageCount() : นับจำนวนครั้งที่ user ใช้โปรโมชันนี้ (ไม่นับที่ถูก revoke)
 */
import dbConnect from "../lib/dbConnect";
import { badRequest, notFound, unprocessable } from "../lib/httpError";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, type Pagination } from "../lib/queryParams";
import promotionUsagesModel from "../models/promotionUsagesModel";
import promotionModel from "../models/promotionModel";
import { toBahtFields } from "../lib/money";

// BACKLOG §3.11 — discount_applied เก็บเป็นสตางค์ แต่ API ยังคืนบาททศนิยมเหมือนเดิม
function presentUsage<T extends Record<string, unknown>>(usage: T): T {
  return toBahtFields(usage, ["discount_applied"] as const);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RecordUsageInput {
  promotion_id: string;
  user_id: string;
  discount_applied: number;
  order_id?: string | null;
  preorder_id?: string | null;
}

export async function recordUsage(input: RecordUsageInput) {
  await dbConnect();
  assertObjectId(input.promotion_id, "promotion_id");
  assertObjectId(input.user_id, "user_id");
  if (input.discount_applied == null || input.discount_applied < 0) {
    throw badRequest("discount_applied ต้องไม่ติดลบ");
  }

  // 1) จองสิทธิ์แบบ atomic: $inc used_count เฉพาะเมื่อ used_count < usage_limit
  //    (กัน race — 2 ออเดอร์พร้อมกันใช้เกิน usage_limit ไม่ได้ — แนวเดียวกับ preorder quota)
  const claimed = await promotionModel
    .findOneAndUpdate(
      {
        _id: input.promotion_id,
        deleted_at: null,
        $or: [
          { usage_limit: null },
          { $expr: { $lt: [{ $ifNull: ["$used_count", 0] }, "$usage_limit"] } },
        ],
      },
      { $inc: { used_count: 1 } },
      { new: true }
    )
    .lean<any>();

  if (!claimed) {
    const exists = await promotionModel.exists({ _id: input.promotion_id, deleted_at: null });
    throw exists
      ? unprocessable("โปรโมชันนี้ถูกใช้ครบจำนวนแล้ว")
      : notFound("ไม่พบโปรโมชันนี้");
  }

  // 2) สร้างบันทึก + ตรวจโควตาต่อผู้ใช้ — ถ้าขั้นนี้ล้ม rollback การจอง used_count
  try {
    const doc = await promotionUsagesModel.create({
      promotion_id: input.promotion_id,
      user_id: input.user_id,
      order_id: input.order_id ?? null,
      preorder_id: input.preorder_id ?? null,
      discount_applied: input.discount_applied,
    });

    if (claimed.max_user_per_user != null) {
      // นับหลังสร้าง (optimistic — ผู้ยิงคำขอพร้อมกันคนหลังจะเป็นฝ่ายแพ้ แล้วถูก rollback)
      const userCount = await promotionUsagesModel.countDocuments({
        promotion_id: input.promotion_id,
        user_id: input.user_id,
        deleted_at: null,
      });
      if (userCount > claimed.max_user_per_user) {
        await promotionUsagesModel.deleteOne({ _id: doc._id }).catch(() => undefined);
        throw unprocessable("คุณใช้สิทธิ์โปรโมชันนี้ครบจำนวนแล้ว");
      }
    }

    return presentUsage(doc.toObject());
  } catch (err) {
    await promotionModel
      .updateOne({ _id: input.promotion_id, used_count: { $gt: 0 } }, { $inc: { used_count: -1 } })
      .catch(() => undefined);
    throw err;
  }
}

/** ยกเลิกการใช้โปรโมชันของออเดอร์ (best-effort — เรียกตอน cancel ออเดอร์) */
export async function revokeUsage(opts: { order_id?: string; preorder_id?: string }) {
  await dbConnect();
  const filter: Record<string, any> = { deleted_at: null };
  if (opts.order_id) filter.order_id = opts.order_id;
  else if (opts.preorder_id) filter.preorder_id = opts.preorder_id;
  else return { revoked: 0 };

  const rows = await promotionUsagesModel.find(filter).lean<any[]>();
  if (rows.length === 0) return { revoked: 0 };

  await promotionUsagesModel.updateMany(filter, { $set: { deleted_at: new Date() } });
  await Promise.all(
    rows.map((r) =>
      promotionModel.updateOne(
        { _id: r.promotion_id, used_count: { $gt: 0 } },
        { $inc: { used_count: -1 } }
      )
    )
  );
  return { revoked: rows.length };
}

export async function getUserUsageCount(promotionId: string, userId: string): Promise<number> {
  await dbConnect();
  assertObjectId(promotionId, "promotion_id");
  assertObjectId(userId, "user_id");
  return promotionUsagesModel.countDocuments({
    promotion_id: promotionId,
    user_id: userId,
    deleted_at: null,
  });
}

export interface ListUsageQuery {
  pagination: Pagination;
  promotion_id?: string;
  user_id?: string;
  order_id?: string;
}

export async function listUsages(query: ListUsageQuery) {
  await dbConnect();
  const filter: Record<string, any> = { deleted_at: null };
  for (const k of ["promotion_id", "user_id", "order_id"] as const) {
    const v = query[k];
    if (v) {
      assertObjectId(v, k);
      filter[k] = v;
    }
  }

  const [items, total] = await Promise.all([
    promotionUsagesModel
      .find(filter)
      .sort({ usage_date: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .populate("promotion_id", "promotion_code promotion_name discount_type")
      .populate("user_id", "user_fullname email")
      .lean(),
    promotionUsagesModel.countDocuments(filter),
  ]);
  return { items: items.map(presentUsage), meta: buildMeta(total, query.pagination) };
}

export async function getUsageById(id: string) {
  await dbConnect();
  assertObjectId(id);
  const doc = await promotionUsagesModel
    .findOne({ _id: id, deleted_at: null })
    .populate("promotion_id", "promotion_code promotion_name")
    .populate("user_id", "user_fullname email")
    .lean();
  if (!doc) throw notFound("ไม่พบบันทึกการใช้โปรโมชันที่ระบุ");
  return presentUsage(doc);
}
