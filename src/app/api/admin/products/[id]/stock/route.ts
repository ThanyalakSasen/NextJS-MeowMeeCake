/**
 * /api/admin/products/[id]/stock  — จัดการสต็อกสินค้าที่มีสต็อก ("inStore" / "online")
 *   GET   — อ่านจำนวนคงเหลือ (stock.view)
 *   PUT   — ตั้งค่าสต็อกเป็นจำนวนที่ระบุ (stock.update)   body: { quantity }
 *   PATCH — ปรับสต็อกด้วยส่วนต่าง (stock.update)          body: { delta } หรือ { action, quantity }
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/httpError";
import * as productService from "@/services/productService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("stock", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok({ product_id: id, quantity: await productService.getStock(id) });
});

export const PUT = withPermission("stock", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { quantity } = await req.json();
  const result = await productService.setStock(id, Number(quantity));
  audit(req, {
    action: `ตั้งค่าสต็อกสินค้าเป็น ${Number(quantity)}`,
    action_type: "UPDATE",
    entity: "Product",
    entity_id: id,
    details: { set: Number(quantity) },
  });
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

  audit(req, {
    action: "ปรับสต็อกสินค้า",
    action_type: "UPDATE",
    entity: "Product",
    entity_id: id,
    details: detail,
  });
  return ok(result);
});
