/** POST /api/shop/addresses/[id]/default — ตั้งที่อยู่นี้เป็นค่าเริ่มต้น */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as addressService from "@/services/addressService";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok(await addressService.setDefault(session.user_id, id));
});
