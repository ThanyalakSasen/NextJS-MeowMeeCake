/**
 * GET /api/admin/pos/guest-customer
 *   บัญชี "ลูกค้าทั่วไป" ที่ POS ผูกกับออเดอร์หน้าร้านที่ไม่ระบุลูกค้า — คืน { _id, user_fullname, email }
 *   ยังไม่ได้ seed = 404 (รัน npm run seed)
 *
 *   สิทธิ์: orders.view (พนักงานหน้าร้าน — เดิม POS ต้องค้นผ่าน /admin/users ที่ต้องมี employees.view
 *   ทำให้พนักงานเคาน์เตอร์เห็นรายชื่อพนักงานไปด้วย · frontend Final-Backlog P3)
 */
import { ok } from "@/lib/apiResponse";
import { withPermission } from "@/lib/authGuard";
import * as userService from "@/services/userService";

export const GET = withPermission("orders", "view", async () => {
  return ok(await userService.getPosGuestCustomer());
});
