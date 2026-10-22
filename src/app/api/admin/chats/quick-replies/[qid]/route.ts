/**
 * /api/admin/chats/quick-replies/:qid (chat.update)
 *   PATCH  { title?, text?, sort_order? } → ข้อความตอบเร็วที่แก้แล้ว
 *   DELETE → { deleted: true }
 */
import type { NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

type Ctx = { params: Promise<{ qid: string }> };

export const PATCH = withPermission("chat", "update", async (_s, req: NextRequest, ctx: Ctx) => {
  const { qid } = await ctx.params;
  const body = ((await req.json().catch(() => null)) ?? {}) as { title?: unknown; text?: unknown; sort_order?: unknown };
  return ok(await chatService.updateQuickReply(qid, body));
});

export const DELETE = withPermission("chat", "update", async (_s, _req: NextRequest, ctx: Ctx) => {
  const { qid } = await ctx.params;
  return ok(await chatService.deleteQuickReply(qid));
});
