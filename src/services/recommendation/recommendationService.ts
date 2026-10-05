/**
 * recommendationService — ห่อ recommendationEngine ให้ route ใช้ (ย้ายมาจาก backend ฝั่งลูกค้า recommendationController /
 * app/api/customer/recommendations · customer-backend-merge.md §8.15)
 *
 *   - แนะนำเฉพาะตัว (ล็อกอิน): hybrid (collaborative 35% · content 30% · ยอดนิยม 15% · สารก่อภูมิแพ้ 20%) · คำนวณเกิน 4.5 วิ
 *     หรือ hybrid ล้ม → ถอยเป็น "popular" (เร็ว) · error ของ engine ที่รู้สถานะ (RecommendationError) ตอบตามนั้น
 *   - สินค้าแนะนำหน้าแรก: ไม่ล็อกอิน = เรียงตามคะแนนรีวิว 10 ชิ้น · ล็อกอิน = hybrid (ไม่ตัดสินค้าที่แพ้ออก — ให้คะแนนต่ำลง)
 *   - สินค้าคล้ายกัน: ล็อกอินหรือไม่ก็ได้ (ล็อกอิน = personalize + เตือนสารก่อภูมิแพ้)
 *   - รายชื่อวัตถุดิบสาธารณะ (เลือกอาหารที่แพ้) — ส่งแค่ _id + ชื่อ ไม่ส่งต้นทุน/สต็อก
 */
import dbConnect from "../../lib/dbConnect";
import { HttpError } from "../../lib/httpError";
import { log } from "../../lib/logger";
import productModel from "../../models/productModel";
import recipeModel from "../../models/recipeModel";
import ingredientModel from "../../models/ingredientModel";
import "../../models/productCategoryModel";
import { toPublicProduct } from "../../lib/publicProduct";
import {
  getRecommendations,
  getSimilarProducts,
  RecommendationError,
  type RecommendationStrategy,
  type RecommendationsResult,
} from "./recommendationEngine";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENGINE_TIMEOUT_MS = 4500;
const STRATEGIES: RecommendationStrategy[] = ["hybrid", "collaborative", "content", "popular"];

export function parseStrategy(value: string | null | undefined): RecommendationStrategy {
  return value && (STRATEGIES as string[]).includes(value) ? (value as RecommendationStrategy) : "hybrid";
}

export function clampLimit(raw: string | null | undefined, def: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : def;
}

/** RecommendationError → HttpError (ให้ route() ของหลักตอบสถานะถูก) */
function toHttp(err: unknown): unknown {
  return err instanceof RecommendationError ? new HttpError(err.message, err.status, err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST") : err;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ENGINE_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** แนะนำเฉพาะตัว — timeout / hybrid ล้ม → popular */
export async function personalized(opts: {
  userId: string;
  limit: number;
  strategy: RecommendationStrategy;
  excludeAllergens: boolean;
}): Promise<RecommendationsResult> {
  await dbConnect();
  try {
    return sanitizeResult(await withTimeout(getRecommendations(opts), ENGINE_TIMEOUT_MS));
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "ENGINE_TIMEOUT";
    if (!(err instanceof RecommendationError) && (timedOut || opts.strategy === "hybrid")) {
      log.warn("recommendation.fallback_popular", { user_id: opts.userId, timedOut, err });
      try {
        return sanitizeResult(await getRecommendations({ ...opts, strategy: "popular" }));
      } catch (fallbackErr) {
        throw toHttp(fallbackErr);
      }
    }
    throw toHttp(err);
  }
}

/** avg_rating เป็น Decimal128 → number */
function toNum(v: unknown): number {
  if (v == null) return 0;
  return typeof (v as any).toNumber === "function" ? Number((v as any).toNumber()) : Number(v) || 0;
}
/** สินค้าที่ส่งออก API (สาธารณะ/ลูกค้า) — เฉพาะ field สาธารณะ (ไม่มีต้นทุน/สูตร · docs/BACKLOG5.md R1) */
const publicProduct = (p: any) => toPublicProduct({ ...p, avg_rating: toNum(p.avg_rating) });
const sanitize = (products: any[]) => products.map(publicProduct);
const sanitizeResult = <T extends { recommendations: Array<{ product: any }> }>(result: T): T => ({
  ...result,
  recommendations: result.recommendations.map((r) => ({ ...r, product: publicProduct(r.product) })),
});

/** สินค้าแนะนำหน้าแรก — { products } (ไม่ล็อกอิน / engine ล้ม = เรียงตามคะแนนรีวิว) */
export async function recommendedProducts(userId: string | null): Promise<{ products: any[] }> {
  await dbConnect();
  const popular = async () => {
    const products = await productModel
      .find({ deleted_at: null, is_visible: { $ne: false } })
      .populate("category_id", "product_category_name")
      .lean<any[]>();
    const recipes = await recipeModel
      .find({ deleted_at: null })
      .populate("ingredients.ingredient_id", "ingredient_name")
      .select("product_id ingredients")
      .lean<any[]>();
    const recipeByProduct = new Map(recipes.map((r) => [String(r.product_id), r]));
    const ranked = products
      // ชื่อวัตถุดิบ (เตือนแพ้อาหาร) เท่านั้น — เดิมแนบสูตรทั้งก้อน (ปริมาณวัตถุดิบ) ไปกับ response สาธารณะ
      .map((p) => ({
        ...p,
        category_name: p.category_id?.product_category_name ?? "",
        ingredientNames: ((recipeByProduct.get(String(p._id))?.ingredients ?? []) as any[])
          .map((i) => i?.ingredient_id?.ingredient_name)
          .filter((n): n is string => typeof n === "string" && n.length > 0),
      }))
      .sort((a, b) => toNum(b.avg_rating) - toNum(a.avg_rating));
    return { products: sanitize(ranked.slice(0, 10)) };
  };
  if (!userId) return popular();
  try {
    const result = await withTimeout(
      getRecommendations({ userId, limit: 10, strategy: "hybrid", excludeAllergens: false }),
      ENGINE_TIMEOUT_MS
    );
    return { products: sanitize(result.recommendations.map((r) => r.product)) };
  } catch (err) {
    log.warn("recommendation.recommended_fallback", { user_id: userId, err });
    return popular();
  }
}

/** สินค้าคล้ายกัน — { recommendations: [{ product, score, reasons, allergenWarning }] } */
export async function similar(productId: string, limit: number, userId?: string) {
  await dbConnect();
  try {
    const recommendations = await getSimilarProducts({ productId, limit, userId });
    return { recommendations: recommendations.map((r: any) => ({ ...r, product: publicProduct(r.product) })) };
  } catch (err) {
    throw toHttp(err);
  }
}

/** วัตถุดิบสาธารณะสำหรับเลือกอาหารที่แพ้ — เฉพาะ _id + ชื่อ */
export async function publicIngredients() {
  await dbConnect();
  const ingredients = await ingredientModel
    .find({ deleted_at: null })
    .select("_id ingredient_name")
    .sort({ ingredient_name: 1 })
    .lean();
  return { ingredients };
}
