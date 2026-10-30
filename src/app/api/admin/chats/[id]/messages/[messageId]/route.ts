/**
 * /api/admin/chats/[id]/messages/[messageId] — ร้านแก้/ลบข้อความของร้าน
 *   PATCH  body: { body } · chats.update
 *   DELETE ลบข้อความ (soft delete) · chats.delete
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
