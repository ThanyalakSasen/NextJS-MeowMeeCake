/** GET /api/admin/user-logs/[id] — ดู log รายตัว (employees.view ; log เป็น append-only) */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as userLogService from "@/services/userLogService";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission("employees", "view", async (_s, _r, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await userLogService.getLogById(id));
});
