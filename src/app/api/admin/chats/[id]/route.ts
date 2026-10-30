/**
 * /api/admin/chats/[id]
 *   GET    ห้องแชท (ข้อมูลลูกค้า) + ข้อความ · chats.view — ?after= / ?before= / ?limit= เหมือน GET /api/shop/chat
 *   DELETE ลบแชทออกจากรายการหลังร้าน (ประวัติข้อความไม่ถูกลบ · ลูกค้าส่งใหม่ = กลับมาพร้อมประวัติเก่า) · chats.delete
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import { audit } from "@/lib/audit";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("chats", "view", async (_session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.getConversationForStaff(id, { after: sp.get("after"), before: sp.get("before"), limit: sp.get("limit") }));
});

export const DELETE = withPermission("chats", "delete", async (_session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await chatService.deleteConversation(id);
  audit(req, { action: "ลบห้องแชทลูกค้า", action_type: "DELETE", entity: "ChatConversation", entity_id: id });
  return ok(result);
});
