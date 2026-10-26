/**
 * POST /api/shop/chat/messages — ลูกค้าส่งข้อความหาร้าน (สร้างห้องให้ตอนข้อความแรก)
 *   body: { body?: string (≤1000), order_id?: string | preorder_id?: string } — ต้องมีข้อความหรือแนบคำสั่งซื้อของตัวเอง 1 รายการ
 *   20 ข้อความ/นาที (429)
 */
import { created } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as chatService from "@/services/chatService";

export const POST = withAuth(async (session, req) =>
  created(await chatService.sendCustomerMessage(session.user_id, await req.json().catch(() => null)))
);
