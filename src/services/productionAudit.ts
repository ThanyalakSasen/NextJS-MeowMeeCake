/**
 * productionAudit — ข้อความสรุปของงานผลิตสำหรับ UserLog (ไม่แตะสต็อก แค่อ่านชื่อ)
 *
 *   itemsSummary(items)     → ["ชิโอะปัง × 10", …]           (รายการผลิตในใบ · ต้อง populate product_id)
 *   stockUsageLines(items)  → ["แป้งสาลี 500 g", "เนย 120 g"] (รวม stock_impact ทุกรายการ ต่อวัตถุดิบ+หน่วย)
 *
 * ใช้ใส่เป็นฟิลด์ items_summary / stock_used / stock_returned ใน before/after ของ log
 */
import ingredientModel from "../models/ingredientModel";
import unitModel from "../models/unitModel";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const idOf = (v: unknown): string => (v && typeof v === "object" && "_id" in v ? String((v as AnyDoc)._id) : String(v));

export function itemsSummary(items: AnyDoc[] | undefined): string[] {
  return (items ?? []).map((it) => {
    const name = (it.product_id as AnyDoc | undefined)?.product_name_th ?? "สินค้า";
    const qty = it.actual_qty ?? it.planned_qty;
    return `${name} × ${qty}`;
  });
}

/** ใบสั่งผลิต + items_summary (ฟิลด์เสมือนให้ log เห็นรายการผลิตเป็นข้อความ) */
export function orderForAudit(order: AnyDoc | undefined | null): AnyDoc | undefined {
  return order ? { ...order, items_summary: itemsSummary(order.items) } : undefined;
}

export async function stockUsageLines(items: AnyDoc[] | undefined): Promise<string[] | null> {
  const lines = (items ?? []).flatMap((it) => (it.stock_impact ?? []) as AnyDoc[]);
  if (!lines.length) return null;

  const totals = new Map<string, { ingredient: string; unit: string; qty: number }>();
  for (const l of lines) {
    const key = `${idOf(l.ingredient_id)}|${idOf(l.unit_id)}`;
    const cur = totals.get(key) ?? { ingredient: idOf(l.ingredient_id), unit: idOf(l.unit_id), qty: 0 };
    cur.qty += Number(l.qty_consumed) || 0;
    totals.set(key, cur);
  }

  const rows = [...totals.values()];
  const [ingredients, units] = await Promise.all([
    ingredientModel.find({ _id: { $in: rows.map((r) => r.ingredient) } }).select("ingredient_name").lean<AnyDoc[]>(),
    unitModel.find({ _id: { $in: rows.map((r) => r.unit) } }).select("unit_name unit_abbr").lean<AnyDoc[]>(),
  ]);
  const ingName = new Map(ingredients.map((d) => [String(d._id), d.ingredient_name as string]));
  const unitName = new Map(units.map((d) => [String(d._id), (d.unit_abbr || d.unit_name) as string]));

  return rows.map((r) => {
    const qty = Math.round(r.qty * 1000) / 1000;
    return `${ingName.get(r.ingredient) ?? "วัตถุดิบ"} ${qty}${unitName.get(r.unit) ? ` ${unitName.get(r.unit)}` : ""}`;
  });
}
