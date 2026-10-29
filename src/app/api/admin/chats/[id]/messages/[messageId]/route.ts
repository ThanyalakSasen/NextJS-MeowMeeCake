/**
 * PATCH  /api/admin/chats/:id/messages/:messageId — ร้านแก้ข้อความของร้าน body: { body } · chats.update
 * DELETE /api/admin/chats/:id/messages/:messageId — ร้านลบข้อความของร้าน (soft delete — ลูกค้าเห็น "ข้อความนี้ถูกลบแล้ว") · chats.delete
 * ข้อความของลูกค้า / ลบไปแล้ว = 404 · คืนข้อความหลังแก้/ลบ
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string; messageId: string }> };

export const PATCH = withPermission("chats", "update", async (_session, req, ctx: Ctx) => {
  const { id, messageId } = await ctx.params;
  return ok(await chatService.editStaffMessage(id, messageId, await req.json().catch(() => null)));
});

export const DELETE = withPermission("chats", "delete", async (_session, _req, ctx: Ctx) => {
  const { id, messageId } = await ctx.params;
  return ok(await chatService.deleteStaffMessage(id, messageId));
});
