/** schemas/push — เปิด/ปิดแจ้งเตือนบนเครื่อง (POST/DELETE /api/shop/push) · รูปแบบเดียวกับ PushSubscription.toJSON() ของเบราว์เซอร์ */
import { z } from "zod";

const endpoint = z.string().trim().url().max(2000).refine((u) => u.startsWith("https://"), "endpoint ต้องเป็น https");

export const pushSubscribe = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().trim().min(1).max(200),
    auth: z.string().trim().min(1).max(100),
  }),
});

export const pushUnsubscribe = z.object({ endpoint });
