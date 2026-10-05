/**
 * /api/shop/favorites — รายการโปรดของฉัน (ย้ายมาจากฝั่งลูกค้า /api/customer/favorites · customer-backend-merge.md §8.14)
 *   GET    → { items: [{ id, name, nameeg, category, price, originalPrice, image, inStock, rating, is_preorder }] }
 *   POST   { productId } (หรือ product_id) → 201 เพิ่มเข้ารายการ (เพิ่มซ้ำ = ไม่ซ้ำแถว) · ไม่พบสินค้า = 404
 *   DELETE { productId } (body หรือ ?productId=) → เอาออก
 */
import { created, ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as favoriteService from "@/services/favoriteService";

export const GET = withAuth(async (session) => ok(await favoriteService.listFavorites(session.user_id)));

export const POST = withAuth(async (session, req) => {
  const productId = favoriteService.readProductId(await req.json().catch(() => ({})));
  return created(await favoriteService.addFavorite(session.user_id, productId));
});

export const DELETE = withAuth(async (session, req) => {
  const sp = req.nextUrl.searchParams;
  const fromQuery = sp.get("productId") ?? sp.get("product_id");
  const productId = favoriteService.readProductId(
    fromQuery ? { productId: fromQuery } : await req.json().catch(() => ({}))
  );
  return ok(await favoriteService.removeFavorite(session.user_id, productId));
});
