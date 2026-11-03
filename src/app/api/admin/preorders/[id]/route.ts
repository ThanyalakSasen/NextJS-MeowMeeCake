/**
 * /api/admin/preorders/[id]
 *   GET    — พรีออเดอร์ + รายการสินค้า (preorder.view) ?includeDeleted= + refund_account (เฉพาะตอนรอโอนคืน)
 *   PATCH  — ร้านแก้ผู้รับ + ที่อยู่จัดส่ง (preorder.update) body: { delivery_address } — เฉพาะแบบจัดส่งที่ยังไม่ส่ง
 *   DELETE — ลบพรีออเดอร์ (soft) (preorder.delete) — เฉพาะที่ completed/cancelled
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { auditChange } from "@/lib/audit";
import { parseBool } from "@/lib/queryParams";
import { parseBody } from "@/lib/validate";
import { adminUpdatePreorderBody } from "@/schemas/preorder";
import * as preorderService from "@/services/preorderService";
import { updatePreorderAddress } from "@/services/preorderEditService";
import { withRefundAccount } from "@/services/userService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("preorder", "view", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const includeDeleted = parseBool(req.nextUrl.searchParams.get("includeDeleted")) ?? false;
  return ok(await withRefundAccount(await preorderService.getPreorderById(id, { includeDeleted })));
});

export const PATCH = withPermission("preorder", "update", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, adminUpdatePreorderBody);
  const before = await preorderService.getPreorderById(id).catch(() => undefined);
  const result = await updatePreorderAddress(id, body.delivery_address);
  auditChange(req, {
    op: "update",
    verb: "แก้ไขที่อยู่จัดส่ง",
    noun: "พรีออเดอร์",
    entity: "Preorder",
    entity_id: id,
    before,
    after: result,
    keys: ["delivery_address"],
  });
  return ok(await withRefundAccount(result));
});

export const DELETE =withPermission("preorder", "delete", async (_s, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const before = await preorderService.getPreorderById(id).catch(() => undefined);
  const result = await preorderService.deletePreorder(id);
  auditChange(req, {
    op: "delete",
    noun: "พรีออเดอร์",
    entity: "Preorder",
    entity_id: id,
    before,
    keys: ["order_status", "payment_status", "total_amount"],
  });
  return ok(result);
});
