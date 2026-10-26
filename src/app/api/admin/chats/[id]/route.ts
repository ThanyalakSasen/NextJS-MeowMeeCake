/**
 * GET /api/admin/chats/[id] — ห้องแชท (ข้อมูลลูกค้า) + ข้อความ · chats.view
 *   ?after= / ?before= / ?limit= เหมือน GET /api/shop/chat
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("chats", "view", async (_session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  return ok(await chatService.getConversationForStaff(id, { after: sp.get("after"), before: sp.get("before"), limit: sp.get("limit") }));
});
