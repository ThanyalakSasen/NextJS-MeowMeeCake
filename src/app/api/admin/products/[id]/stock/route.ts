/**
 * /api/admin/products/[id]/stock  — จัดการสต็อกสินค้าปกติ (is_preorder: false — พรีออเดอร์ไม่มีสต็อก)
 *   GET   — อ่านจำนวนคงเหลือ (stock.view)
 *   PUT   — ตั้งค่าสต็อกเป็นจำนวนที่ระบุ (stock.update)   body: { quantity, note? }
 *   PATCH — ปรับสต็อกด้วยส่วนต่าง (stock.update)          body: { delta, note? } หรือ { action, quantity, note? }
 *   note — หมายเหตุ (เหตุผลที่รับเข้า/เบิกใช้/ปรับยอด) ไม่มีที่เก็บบนสินค้า → เก็บในบันทึกการทำงาน (ข้อความ + details + after)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

const NOTE_MAX = 200;

/** หมายเหตุจาก body — ตัดช่องว่าง · ว่าง = ไม่มี · ยาวเกินตัด (ไม่ปฏิเสธคำขอเพราะหมายเหตุ) */
function noteOf(body: { note?: unknown }): string | undefined {
  if (typeof body?.note !== "string") return undefined;
  const note = body.note.trim().slice(0, NOTE_MAX);
  return note || undefined;
}

/** log สต็อกสินค้า: ชื่อสินค้า + ส่วนต่าง + ยอดก่อน → หลัง (before/after = { product_stock_quantity }) */
function auditStock(
  req: Parameters<typeof audit>[0],
  id: string,
  product: { product_name_th?: string } | null | undefined,
  verb: string,
  before: number,
  after: number,
  details: Record<string, unknown>,
  note?: string
) {
  const name = product?.product_name_th ? ` "${product.product_name_th}"` : "";
  const delta = after - before;
  audit(req, {
    action: `${verb}สต็อกสินค้า${name} ${delta >= 0 ? "+" : ""}${delta} (${before} → ${after})${note ? ` · หมายเหตุ: ${note}` : ""}`,
    action_type: "UPDATE",
    entity: "Product",
    entity_id: id,
    details: { ...details, change: delta, ...(note ? { note } : {}) },
    before: { product_stock_quantity: before },
    after: { product_stock_quantity: after, ...(note ? { note } : {}) },
  });
}

export const GET = withPermission("stock", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok({ product_id: id, quantity: await productService.getStock(id) });
});

export const PUT = withPermission("stock", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  const quantity = body.quantity;
  const before = await productService.getStock(id);
  const result = await productService.setStock(id, Number(quantity));
  auditStock(req, id, result, "ตั้งยอด", before, Number(quantity), { set: Number(quantity) }, noteOf(body));
  return ok(result);
});

export const PATCH = withPermission("stock", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();

  let result;
  let detail: Record<string, unknown>;
  if (body.action === "increase") {
    result = await productService.increaseStock(id, Number(body.quantity));
    detail = { action: "increase", quantity: Number(body.quantity) };
  } else if (body.action === "decrease") {
    result = await productService.decreaseStock(id, Number(body.quantity), {
      allowNegative: Boolean(body.allowNegative),
    });
    detail = { action: "decrease", quantity: Number(body.quantity) };
  } else if (body.delta !== undefined) {
    result = await productService.adjustStock(id, Number(body.delta), {
      allowNegative: Boolean(body.allowNegative),
    });
    detail = { delta: Number(body.delta) };
  } else {
    throw badRequest('ต้องระบุ { delta } หรือ { action: "increase"|"decrease", quantity }');
  }

  const product = result as { product_name_th?: string; product_stock_quantity?: number };
  const after = product.product_stock_quantity ?? 0;
  const delta =
    body.delta !== undefined
      ? Number(body.delta)
      : (body.action === "decrease" ? -1 : 1) * Math.abs(Number(body.quantity));
  auditStock(req, id, product, delta >= 0 ? "เพิ่ม" : "ลด", after - delta, after, detail, noteOf(body));
  return ok(result);
});
