/** POST /api/admin/chats/:id/read — ร้านเปิดอ่านห้องนี้แล้ว (chat.view) → { unread_shop: 0 } */
import type { NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withPermission("chat", "view", async (_s, _req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await chatService.markShopRead(id));
});
