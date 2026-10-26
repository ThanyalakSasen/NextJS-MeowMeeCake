/** POST /api/admin/chats/[id]/messages — ร้านตอบลูกค้า body: { body } · chats.create (ตอบแล้ว = ข้อความลูกค้าอ่านแล้ว) */
import { created } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("chats", "create", async (session, req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return created(await chatService.sendStaffMessage(session.user_id, id, await req.json().catch(() => null)));
});
