/** POST /api/admin/chats/[id]/read — ร้านเปิดห้อง → ข้อความลูกค้าอ่านแล้ว · chats.view */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("chats", "view", async (_session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await chatService.markReadByStaff(id));
});
