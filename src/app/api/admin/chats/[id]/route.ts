/**
 * GET /api/admin/chats/:id — ห้องแชท 1 ห้อง + ข้อมูลลูกค้าประกอบการตอบ (chat.view)
 *   → { _id, unread_shop, last_sender, customer: { _id, name, phone, email, image }, recent_orders: [{ kind, no, order_status, payment_status, total_amount, created_at }] }
 */
import type { NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("chat", "view", async (_s, _req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await chatService.getConversationForShop(id));
});
