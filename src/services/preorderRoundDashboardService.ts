/**
 * preorderRoundDashboardService — สรุปรอบพรีออเดอร์ + รายชื่อลูกค้าในรอบ สำหรับหลังร้าน (frontend Q-BE5 · F4 · Q-OWN3)
 * ย้ายแนวคิดจาก FrontOffice /owner/preorder-rounds/dashboard · /:id/customers
 *
 * กลุ่มสถานะชำระเงิน (ใช้ทั้งสรุปและตัวกรองรายชื่อ) — ดูจากพรีออเดอร์ที่ยังไม่ถูกลบ:
 *   paid      = ชำระแล้ว และยังไม่ยกเลิก
 *   pending   = ยังไม่ชำระ (pending / failed) และยังไม่ยกเลิก
 *   cancelled = ยกเลิกแล้ว (ทุกสถานะชำระเงิน — รวมที่รอโอนคืน/คืนเงินแล้ว)
 * ยอดจองต่อสินค้า = current_qty ของรายการในรอบ (คืนโควตาเมื่อยกเลิกแล้ว — preorderService.releaseQty)
 */
import dbConnect from "../lib/dbConnect";
import { assertObjectId } from "../lib/objectId";
import { buildMeta, escapeRegExp, type Pagination } from "../lib/queryParams";
import { round2 } from "../lib/money";
import preorderRoundModel from "../models/preorderRoundModel";
import preorderRoundItemModel from "../models/preorderRoundItemModel";
import preorderModel from "../models/preorderModel";
import preorderItemModel from "../models/preorderItemModel";
import { getRoundById, type RoundStatus } from "./preorderRoundService";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PAYMENT_GROUPS = ["paid", "pending", "cancelled"] as const;
export type PaymentGroup = (typeof PAYMENT_GROUPS)[number];

export function paymentGroupOf(p: { order_status?: string; payment_status?: string }): PaymentGroup {
  if (p.order_status === "cancelled") return "cancelled";
  return p.payment_status === "paid" ? "paid" : "pending";
}

/** เงื่อนไข mongo ของแต่ละกลุ่ม — ตรงกับ paymentGroupOf() */
const GROUP_FILTER: Record<PaymentGroup, Record<string, unknown>> = {
  paid: { order_status: { $ne: "cancelled" }, payment_status: "paid" },
  pending: { order_status: { $ne: "cancelled" }, payment_status: { $ne: "paid" } },
  cancelled: { order_status: "cancelled" },
};

interface GroupTotals {
  count: number;
  amount: number;
}

// ── สรุปต่อรอบ ────────────────────────────────────────────────
export interface DashboardQuery {
  pagination: Pagination;
  round_status?: RoundStatus;
  search?: string;
}

export async function getRoundsDashboard(query: DashboardQuery) {
  await dbConnect();

  const filter: Record<string, any> = { deleted_at: null };
  if (query.round_status) filter.round_status = query.round_status;
  if (query.search?.trim()) filter.round_name = new RegExp(escapeRegExp(query.search.trim()), "i");

  const [rounds, total] = await Promise.all([
    preorderRoundModel
      .find(filter)
      .select("round_name open_date close_date pickup_date round_status")
      .sort({ open_date: -1, _id: -1 })
      .skip(query.pagination.skip)
      .limit(query.pagination.limit)
      .lean<any[]>(),
    preorderRoundModel.countDocuments(filter),
  ]);
  const ids = rounds.map((r) => r._id);

  const [items, orderGroups] = await Promise.all([
    preorderRoundItemModel
      .find({ round_id: { $in: ids }, deleted_at: null })
      .populate("product_id", "product_name_th product_name_eng")
      .sort({ created_at: 1 })
      .lean<any[]>(),
    preorderModel.aggregate([
      { $match: { round_id: { $in: ids }, deleted_at: null } },
      {
        $group: {
          _id: {
            round_id: "$round_id",
            group: {
              $cond: [
                { $eq: ["$order_status", "cancelled"] },
                "cancelled",
                { $cond: [{ $eq: ["$payment_status", "paid"] }, "paid", "pending"] },
              ],
            },
          },
          count: { $sum: 1 },
          amount: { $sum: "$total_amount" },
          customers: { $addToSet: "$user_id" },
        },
      },
    ]),
  ]);

  return {
    items: rounds.map((r) => {
      const id = String(r._id);
      const products = items
        .filter((it) => String(it.round_id) === id)
        .map((it) => ({
          round_item_id: String(it._id),
          product_id: String(it.product_id?._id ?? it.product_id ?? ""),
          product_name_th: String(it.product_id?.product_name_th ?? ""),
          product_name_eng: String(it.product_id?.product_name_eng ?? ""),
          ordered_qty: Number(it.current_qty ?? 0),
          quota: Number(it.max_qty_total ?? 0),
          is_active: it.is_active !== false,
        }));
      const groups = Object.fromEntries(PAYMENT_GROUPS.map((g) => [g, { count: 0, amount: 0 } as GroupTotals])) as Record<
        PaymentGroup,
        GroupTotals
      >;
      const customers = new Set<string>();
      for (const g of orderGroups.filter((x: any) => String(x._id.round_id) === id)) {
        groups[g._id.group as PaymentGroup] = { count: g.count, amount: round2(g.amount) };
        if (g._id.group !== "cancelled") for (const u of g.customers) customers.add(String(u));
      }
      const total_quota = products.reduce((s, p) => s + p.quota, 0);
      const total_ordered_qty = products.reduce((s, p) => s + p.ordered_qty, 0);
      return {
        _id: id,
        round_name: r.round_name,
        open_date: r.open_date,
        close_date: r.close_date,
        pickup_date: r.pickup_date,
        round_status: r.round_status,
        product_count: products.length,
        total_quota,
        total_ordered_qty,
        fill_rate: total_quota > 0 ? Math.round((total_ordered_qty / total_quota) * 100) : 0,
        total_orders: PAYMENT_GROUPS.reduce((s, g) => s + groups[g].count, 0),
        /** ลูกค้าที่มีพรีออเดอร์ที่ยังไม่ยกเลิก */
        customer_count: customers.size,
        /** ยอดขาย = ไม่รวมยกเลิก */
        total_revenue: round2(groups.paid.amount + groups.pending.amount),
        payment: groups,
        products,
      };
    }),
    meta: buildMeta(total, query.pagination),
  };
}

// ── รายชื่อลูกค้าในรอบ ─────────────────────────────────────────
export interface RoundCustomersQuery {
  /** ชื่อ · เบอร์ · อีเมล ลูกค้า หรือเลขพรีออเดอร์ */
  search?: string;
  payment_group?: PaymentGroup;
  order_type?: "delivery" | "takeaway";
}

const lineOf = (it: any) => ({
  product_id: String(it.product_id ?? ""),
  product_name_th: String(it.product_snapshot?.product_name_th ?? ""),
  product_name_eng: String(it.product_snapshot?.product_name_eng ?? ""),
  variant_name: it.product_snapshot?.variant_name ?? null,
  selected_variants: (it.selected_variants ?? []).map((v: any) => ({ group_name: v.group_name ?? "", variant_name: v.variant_name })),
  selected_options: (it.selected_options ?? []).map((o: any) => ({ option_name: o.option_name, text_value: o.text_value ?? null })),
  special_request: it.special_request ?? null,
  quantity: Number(it.quantity ?? 0),
  unit_price: round2(Number(it.unit_price ?? 0)),
  total_price: round2(Number(it.total_price ?? 0)),
});

export async function getRoundCustomers(roundId: string, query: RoundCustomersQuery = {}) {
  await dbConnect();
  assertObjectId(roundId);
  const round = await getRoundById(roundId);

  const filter: Record<string, any> = { round_id: round._id, deleted_at: null };
  if (query.payment_group) Object.assign(filter, GROUP_FILTER[query.payment_group]);
  if (query.order_type) filter.order_type = query.order_type;

  const preorders = await preorderModel
    .find(filter)
    .select(
      "preorder_no user_id order_type order_status payment_status delivery_address pickup_date pickup_point total_amount cancelled_reason created_at"
    )
    .populate("user_id", "user_fullname email user_phone")
    .sort({ created_at: 1 })
    .lean<any[]>();

  const term = query.search?.trim().toLowerCase();
  const matched = term
    ? preorders.filter((p) =>
        [p.preorder_no, p.user_id?.user_fullname, p.user_id?.email, p.user_id?.user_phone]
          .filter(Boolean)
          .some((v: string) => String(v).toLowerCase().includes(term))
      )
    : preorders;

  const lines = await preorderItemModel
    .find({ preorder_id: { $in: matched.map((p) => p._id) }, deleted_at: null })
    .sort({ created_at: 1 })
    .lean<any[]>();

  const byUser = new Map<string, any>();
  for (const p of matched) {
    const user = p.user_id && typeof p.user_id === "object" ? p.user_id : null;
    const userId = String(user?._id ?? p.user_id ?? "");
    const group = paymentGroupOf(p);
    const entry =
      byUser.get(userId) ??
      byUser
        .set(userId, {
          user_id: userId,
          user_fullname: user?.user_fullname ?? "",
          email: user?.email ?? "",
          user_phone: user?.user_phone ?? null,
          order_count: 0,
          total_spent: 0,
          orders: [] as any[],
        })
        .get(userId);
    entry.order_count += 1;
    if (group !== "cancelled") entry.total_spent = round2(entry.total_spent + Number(p.total_amount ?? 0));
    entry.orders.push({
      _id: String(p._id),
      preorder_no: p.preorder_no,
      order_type: p.order_type,
      order_status: p.order_status,
      payment_status: p.payment_status,
      payment_group: group,
      delivery_address: p.delivery_address ?? null,
      pickup_date: p.pickup_date ?? null,
      pickup_point: p.pickup_point ? { point_name: p.pickup_point.point_name, address: p.pickup_point.address ?? "" } : null,
      total_amount: round2(Number(p.total_amount ?? 0)),
      cancelled_reason: p.cancelled_reason ?? null,
      created_at: p.created_at,
      items: lines.filter((l) => String(l.preorder_id) === String(p._id)).map(lineOf),
    });
  }

  const customers = [...byUser.values()].sort((a, b) => a.user_fullname.localeCompare(b.user_fullname, "th"));
  return {
    round: {
      _id: String(round._id),
      round_name: round.round_name,
      pickup_date: round.pickup_date,
      round_status: round.round_status,
    },
    customers,
    total_customers: customers.length,
    total_orders: matched.length,
  };
}
