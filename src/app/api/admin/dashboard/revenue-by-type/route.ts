/**
 * GET /api/admin/dashboard/revenue-by-type — ⚠️ เลิกใช้ (docs/BACKLOG2.md §14, 2026-09-30)
 * เดิมแยกรายรับตามประเภทสินค้า (inStore/online/preorder) ซึ่งเลิกใช้แล้ว — คงไว้เป็นชื่อเก่าของ
 * /api/admin/dashboard/revenue-by-channel (response แบบใหม่ { web, pos, preorder, other, total, counts, orders })
 * frontend ควรย้ายไปเรียก revenue-by-channel
 */
export { GET } from "../revenue-by-channel/route";
