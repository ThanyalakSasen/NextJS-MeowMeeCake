// src/services/recommendation/recommendationEngine.ts — ย้ายมาจาก backend ฝั่งลูกค้า (lib/services) · customer-backend-merge.md §8.15
/* eslint-disable @typescript-eslint/no-explicit-any */
// ═══════════════════════════════════════════════════════════════════════════════
// recommendationEngine.ts — Recommendation Engine หลัก (Hybrid 4 กลยุทธ์)
//
// กลยุทธ์ A: Collaborative Filtering  (35%)  Item-based, Cosine Similarity
// กลยุทธ์ B: Content-Based Filtering  (30%)  User Profile Vector + Taste Matching
// กลยุทธ์ C: Popularity-Based        (15%)   Sales + Rating + Recent Trend
// กลยุทธ์ D: Allergen-Aware Filter   (20%)   Bonus/penalty ตาม allergen (service แยก)
// กลยุทธ์ E: Age-Based Preference    (boost) Boost สินค้าที่ taste ตรงกับช่วงวัยผู้ใช้ (จาก user_birthdate)
//
// finalScore = (0.35×collab + 0.30×content + 0.15×popular + 0.20×allergen) / Σน้ำหนัก
// Boost: isFeatured ×1.1, discountPrice ×1.05, favorite category ×1.15, age-match ×1.1
//
// 📌 หมายเหตุการปรับให้เข้ากับ schema จริงของโปรเจกต์:
//  - Schema ปัจจุบันไม่มี field tasteProfile/tags/isFeatured/discountPrice
//    → Engine รองรับ field เหล่านี้แบบ optional (ถ้ามีในอนาคตจะใช้ทันที)
//    และมี fallback เป็นการ derive จากข้อมูลจริง (หมวด + ราคา + keyword ชื่อ/ส่วนผสม)
//  - avg_rating เป็น Mongoose Decimal128 → ต้องแปลงด้วย toNumber() ทุกครั้ง
// ───────────────────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import  connectMongoDB  from "@/lib/dbConnect";
import Product from "@/models/productModel";
import ProductCategory from "@/models/productCategoryModel";
import Recipe from "@/models/recipeModel";
import Ingredient from "@/models/ingredientModel";
import Component from "@/models/componentModel";
import Order from "@/models/orderModel";
import OrderItem from "@/models/orderItemModel";
import Review from "@/models/reviewModel";
import { isPreorderOf } from "@/lib/productCode";
import Cart from "@/models/cartModel";
import CartItem from "@/models/cartItemModel";
import User from "@/models/userModel";
import Interaction, {
  INTERACTION_ACTION_TYPES,
  INTERACTION_ACTION_WEIGHTS,
  type InteractionActionType,
} from "@/models/interactionModel";
import {
  buildAllergenInfoFromRecipe,
  checkAllergenForProduct,
  parseAllergenProfile,
  type AllergenProfile,
  type AllergenWarning,
  type ProductAllergenInfo,
} from "./allergenChecker";
import type { RecommendationItem } from "@/types/recommendation";

// Re-export สำหรับ consumer ฝั่ง UI (components/ProductCard.tsx)
export type { AllergenWarning };

// ─── น้ำหนักกลยุทธ์ (ตาม spec) ─────────────────────────────────────────────────
export const COLLABORATIVE_WEIGHT = 0.35;
export const CONTENT_WEIGHT = 0.3;
export const POPULARITY_WEIGHT = 0.15;
export const ALLERGEN_WEIGHT = 0.2;
export const COLD_START_MIN_INTERACTIONS = 5;

// ─── Boost factors ─────────────────────────────────────────────────────────────
const BOOST_FEATURED = 1.1;
const BOOST_DISCOUNT = 1.05;
const BOOST_FAVORITE_CATEGORY = 1.15;
const BOOST_AGE_MATCH = 1.1;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RecommendationStrategy = "hybrid" | "collaborative" | "content" | "popular";

export interface RecommendationQuery {
  userId: string;
  limit: number;
  strategy: RecommendationStrategy;
  excludeAllergens: boolean;
}

export interface RecommendationsResult {
  recommendations: RecommendationItem[];
  meta: {
    strategy: RecommendationStrategy;
    isColdStart: boolean;
    total: number;
    candidateCount: number;
    interactionCount: number;
  };
}

// RecommendationItem อยู่ที่ src/types/recommendation.ts (frontend มีสำเนาไฟล์เดียวกัน)
export type { RecommendationItem };

export interface SimilarProductsQuery {
  productId: string;
  limit: number;
  userId?: string;
}

/** Error ที่รู้สถานะ HTTP ชัดเจน (ให้ route ตอบกลับได้ถูกต้อง) */
export class RecommendationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RecommendationError";
    this.status = status;
  }
}
// ─── Math helpers ──────────────────────────────────────────────────────────────

/** แปลงค่าที่อาจเป็น Decimal128 | string | number → number (avg_rating เป็น Decimal128) */
function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && typeof (value as any).toString === "function") {
    const n = parseFloat((value as any).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return Number(value) || 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * สินค้าที่ "แนะนำได้จริง" — ต้องไม่ใช่ preorder, ไม่ถูกซ่อน, และมีสต็อก > 0
 * (ต้องตรงกับเงื่อนไขฝั่ง UI: HomeRecommendations.isRecommendableProduct และ
 * ProductCard self-guard) ไม่งั้น engine จะนับสินค้าที่ถูกซ่อนอยู่ดีเป็น candidate
 * ทำให้ limit=10 ขอมา 10 แต่โชว์จริงได้ไม่กี่ชิ้นเพราะโดนกรองทิ้งที่ฝั่ง UI ทีหลัง
 */
function isDisplayableProduct(doc: any): boolean {
  if (!doc) return false;
  if (isPreorderOf(doc) === true) return false; // is_preorder (หรือ product_type เก่าของข้อมูลที่ยังไม่ย้าย)
  if (doc.is_visible === false) return false;
  const stockQty = doc.product_stock_quantity;
  if (stockQty === null || stockQty === undefined) return false;
  if (Number(stockQty) === 0) return false;
  return true;
}

/** Cosine similarity ระหว่างเวกเตอร์สองชุด (ค่ากลับอยู่ในช่วง [-1, 1]) */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Euclidean distance ระหว่างเวกเตอร์สองชุด */
function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** ทำเวกเตอร์ให้เป็น unit vector (ใช้กับ cosine) */
function normalizeVec(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return v.map(() => 0);
  return v.map((x) => x / norm);
}

// ─── Taste Profile (กลยุทธ์ B) ─────────────────────────────────────────────────
// Schema ปัจจุบันไม่มี field tasteProfile จึงใช้การสกัด keyword จากชื่อ/คำอธิบาย/ส่วนผสม
// เป็นเวกเตอร์รสชาติ 12 มิติ; ถ้าในอนาคตมี product.tasteProfile (array ตัวเลข) จะใช้ค่านั้นแทน

interface TasteDimension {
  key: string;
  keywords: string[];
}

const TASTE_DIMENSIONS: TasteDimension[] = [
  { key: "sweet", keywords: ["หวาน", "น้ำตาล", "น้ำผึ้ง", "sugar", "sweet", "honey"] },
  { key: "chocolate", keywords: ["ช็อก", "ช็อค", "โกโก้", "cocoa", "choco", "chocolate"] },
  { key: "coffee_tea", keywords: ["กาแฟ", "coffee", "ชา", "tea", "espresso", "ชาดำ"] },
  { key: "matcha_taro", keywords: ["มัทฉะ", "matcha", "เผือก", "taro"] },
  { key: "fruit", keywords: ["สตรอ", "สตอเบอรี่", "strawberry", "บลูเบอร์รี่", "blueberry", "มะม่วง", "mango", "กล้วย", "banana", "เสาวรส", "passion", "ลิ้นจี่", "lychee", "ส้ม", "orange", "แอปเปิ้ล", "apple", "เบอร์รี่", "berry"] },
  { key: "cream_milk", keywords: ["ครีม", "cream", "นม", "milk", "เนย", "butter"] },
  { key: "nut", keywords: ["ถั่ว", "nut", "อัลมอนด์", "almond", "พีแคน", "pecan", "วอลนัท", "walnut", "พิซตาชิโอ", "pistachio"] },
  { key: "cheese", keywords: ["ชีส", "cheese"] },
  { key: "sour", keywords: ["เปรี้ยว", "sour", "มะนาว", "lemon", "citrus", "ยูซุ", "yuzu"] },
  { key: "grain", keywords: ["ขนมปัง", "bread", "แป้ง", "flour", "sourdough", "ซาวโดว์", "ครัวซองต์", "croissant", "บาแก็ต", "baguette", "โฮลวีต"] },
  { key: "caramel", keywords: ["คาราเมล", "caramel", "ทอฟฟี่", "toffee"] },
  { key: "spicy", keywords: ["เผ็ด", "spicy", "ขิง", "ginger"] },
];

export const TASTE_COUNT = TASTE_DIMENSIONS.length;
const TASTE_INDEX_BY_KEY = new Map(TASTE_DIMENSIONS.map((d, i) => [d.key, i]));

// ─── Age-Based Preference (เงื่อนไขเพิ่มเติมตามช่วงอายุ) ────────────────────────
// ใช้ user_birthdate คำนวณอายุ → จับกลุ่มช่วงวัย → boost สินค้าที่มี taste ตรงกับ
// รสนิยมทั่วไปของวัยนั้น (ยังไม่มี field เก็บ "กลุ่มอายุเป้าหมาย" ในตัวสินค้าเอง
// จึงอิงจาก taste vector 12 มิติที่ derive จากชื่อ/ส่วนผสมแทน เหมือนกลยุทธ์ B)
interface AgeBracket {
  key: string;
  label: string;
  minAge: number;
  maxAge: number; // Infinity สำหรับกลุ่มอายุสูงสุด
  tasteKeys: string[]; // taste dimension (ดู TASTE_DIMENSIONS) ที่วัยนี้มักชอบ
}

const AGE_BRACKETS: AgeBracket[] = [
  { key: "child", label: "เด็ก (ต่ำกว่า 13 ปี)", minAge: 0, maxAge: 12, tasteKeys: ["sweet", "chocolate", "fruit", "cream_milk"] },
  { key: "teen", label: "วัยรุ่น (13-19 ปี)", minAge: 13, maxAge: 19, tasteKeys: ["chocolate", "matcha_taro", "fruit", "caramel"] },
  { key: "young_adult", label: "วัยทำงานตอนต้น (20-35 ปี)", minAge: 20, maxAge: 35, tasteKeys: ["coffee_tea", "matcha_taro", "cheese", "sour"] },
  { key: "adult", label: "วัยกลางคน (36-55 ปี)", minAge: 36, maxAge: 55, tasteKeys: ["coffee_tea", "nut", "grain", "caramel"] },
  { key: "senior", label: "ผู้สูงอายุ (56 ปีขึ้นไป)", minAge: 56, maxAge: Infinity, tasteKeys: ["coffee_tea", "grain", "nut", "sour"] },
];

/** คำนวณอายุ (ปี) จาก user_birthdate — คืนค่า null ถ้าไม่มีข้อมูล/รูปแบบไม่ถูกต้อง */
function calcAge(birthdate: unknown): number | null {
  if (!birthdate) return null;
  const d = new Date(birthdate as any);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

/** หากลุ่มช่วงอายุของผู้ใช้จาก user_birthdate — คืนค่า null ถ้าไม่ทราบวันเกิด */
function getAgeBracket(birthdate: unknown): AgeBracket | null {
  const age = calcAge(birthdate);
  if (age === null) return null;
  return AGE_BRACKETS.find((b) => age >= b.minAge && age <= b.maxAge) ?? null;
}

/**
 * สร้าง taste vector จากชื่อ/คำอธิบาย/ส่วนผสมของสินค้า
 * ถ้า product มี field tasteProfile (array ความยาวเท่า TASTE_COUNT) จะใช้ค่าจาก field นั้นแทน
 */
function buildTasteVector(seedText: string, providedTasteProfile?: unknown): number[] {
  if (Array.isArray(providedTasteProfile) && providedTasteProfile.length === TASTE_COUNT) {
    return providedTasteProfile.map((v) => toNumber(v));
  }
  const text = seedText.toLowerCase();
  return TASTE_DIMENSIONS.map((dim) =>
    dim.keywords.some((kw) => text.includes(kw)) ? 1 : 0
  );
}
// ─── การรวบรวมสัญญาณพฤติกรรมผู้ใช้ (User Signals) ───────────────────────────────

/** จำนวนเหตุการณ์แยกตาม action ของ (user, product) คู่หนึ่ง */
interface ProductSignals {
  view: number;
  add_to_cart: number;
  wishlist: number;
  purchase: number;
  ratingMax: number; // คะแนนรีวิวสูงสุดที่ให้ (weight = rating value ตาม spec)
}

/** น้ำหนักรวมของ (user, product) สำหรับ User-Item Matrix (กลยุทธ์ A) */
function signalWeight(s: ProductSignals): number {
  return (
    s.view * INTERACTION_ACTION_WEIGHTS.view +
    s.add_to_cart * INTERACTION_ACTION_WEIGHTS.add_to_cart +
    s.wishlist * INTERACTION_ACTION_WEIGHTS.wishlist +
    s.purchase * INTERACTION_ACTION_WEIGHTS.purchase +
    s.ratingMax
  );
}

function createSignals(): ProductSignals {
  return { view: 0, add_to_cart: 0, wishlist: 0, purchase: 0, ratingMax: 0 };
}

/**
 * รวบรวมสัญญาณทั้งหมดของผู้ใช้คนหนึ่ง เพื่อประกอบเป็น User-Item Matrix
 *
 * แหล่งข้อมูล:
 *  1. Interactions collection (source of truth ใหม่ — view/wishlist/add_to_cart/purchase)
 *  2. Orders + OrderItems (purchase history เดิมก่อนมี Interactions)
 *  3. Carts + CartItems (add_to_cart เดิม)
 *  4. Reviews (rating 1-5)
 *
 * Dedupe logic: ถ้า Interactions มี add_to_cart/purchase ของสินค้าชิ้นไหนแล้ว
 * จะไม่นับ legacy cart/order ของสินค้าชิ้นนั้นซ้ำ (Interactions เป็นตัวจริงกว่า)
 */
async function collectUserSignals(
  userId: string
): Promise<{ signals: Map<string, ProductSignals>; eventCount: number }> {
  await connectMongoDB();
  const signals = new Map<string, ProductSignals>();
  let eventCount = 0;
  const ensure = (productId: string): ProductSignals => {
    let s = signals.get(productId);
    if (!s) {
      s = createSignals();
      signals.set(productId, s);
    }
    return s;
  };

  // ── 1. Interactions (view / wishlist / add_to_cart / purchase ใหม่) ──
  const interactions = await Interaction.find({ user_id: userId, deleted_at: null })
    .sort({ created_at: -1 })
    .limit(5000)
    .select("product_id action_type")
    .lean();

  const canonical = new Set<string>(); // สินค้าที่มี add_to_cart/purchase จาก Interactions
  for (const it of interactions) {
    const pid = String(it.product_id);
    const action = it.action_type as InteractionActionType;
    if (action === "add_to_cart" || action === "purchase") canonical.add(pid);
    ensure(pid)[action] += 1;
    eventCount += 1;
  }

  // ── 2. Purchase history (legacy จาก Orders/OrderItems) ──
  const orders = await Order.find({
    user_id: userId,
    deleted_at: null,
    order_status: { $ne: "cancelled" },
  })
    .select("_id")
    .lean();
  const orderIds = orders.map((o) => o._id);
  if (orderIds.length > 0) {
    const items = await OrderItem.find({
      order_id: { $in: orderIds },
      deleted_at: null,
    })
      .select("order_id product_id")
      .lean();
    const perProductOrders = new Map<string, Set<string>>();
    for (const item of items) {
      const pid = String(item.product_id);
      if (canonical.has(pid)) continue; // ไม่นับซ้ำถ้า Interactions มี purchase แล้ว
      let set = perProductOrders.get(pid);
      if (!set) {
        set = new Set();
        perProductOrders.set(pid, set);
      }
      set.add(String(item.order_id));
    }
    for (const [pid, orderSet] of perProductOrders) {
      ensure(pid).purchase += orderSet.size;
      eventCount += orderSet.size;
    }
  }

  // ── 3. Add_to_cart (legacy จาก Carts/CartItems) ──
  const cart = await Cart.findOne({ user_id: userId, deleted_at: null })
    .select("_id")
    .lean();
  if (cart) {
    const cartItems = await CartItem.find({
      cart_id: cart._id,
      deleted_at: null,
    })
      .select("product_id")
      .lean();
    const seen = new Set<string>();
    for (const item of cartItems) {
      const pid = String(item.product_id);
      if (canonical.has(pid)) continue; // ไม่นับซ้ำถ้า Interactions มี add_to_cart แล้ว
      if (seen.has(pid)) continue;
      seen.add(pid);
      ensure(pid).add_to_cart += 1;
      eventCount += 1;
    }
  }

  // ── 4. Reviews (rating -> weight = ค่า rating ตาม spec) ──
  const reviews = await Review.find({
    user_id: userId,
    deleted_at: null,
    is_visible: true,
  })
    .select("product_id rating")
    .lean();
  for (const r of reviews) {
    const pid = String(r.product_id);
    const rating = toNumber(r.rating);
    if (rating > 0) {
      const s = ensure(pid);
      s.ratingMax = Math.max(s.ratingMax, rating);
    }
    eventCount += 1;
  }

  // ตัดรายการที่น้ำหนักเป็น 0 ออก
  for (const [pid, s] of signals) {
    if (signalWeight(s) <= 0) signals.delete(pid);
  }

  return { signals, eventCount };
}
// ─── Catalog + Feature Vector (ใช้ในกลยุทธ์ B และ Similar) ─────────────────────

/** คุณสมบัติของสินค้าที่ใช้คำนวณความคล้าย (category, price, taste) */
interface ProductFeatures {
  categoryId: string;
  categoryName: string;
  price: number;
  taste: number[];
  seedText: string;
  vector: number[]; // feature vector เต็ม (category one-hot + ราคา normalized + taste)
}

interface CatalogProduct {
  doc: any;
  features: ProductFeatures;
  allergenInfo: ProductAllergenInfo;
}

/**
 * โหลดสินค้าทั้งหมด (ที่ยัง active) พร้อม recipe → ingredient → allergen
 * แล้วสร้าง feature vector สำหรับ content-based scoring
 */
// เพิ่มตัวแปรระดับ Module ใน lib/services/recommendationEngine.ts
let catalogCache: { data: { items: CatalogProduct[]; categoryOrder: string[] }; expiresAt: number } | null = null;

/** อายุ cache ของแคตตาล็อก (ms) — ค่าเริ่มต้น 3 นาที · RECOMMENDATION_CACHE_TTL_MS=0 ปิด cache (เทส) */
function catalogCacheTtl(): number {
  const n = Number(process.env.RECOMMENDATION_CACHE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 3 * 60 * 1000;
}

/** ล้าง cache แคตตาล็อก (เทส / หลังแก้สินค้า) */
export function resetCatalogCache(): void {
  catalogCache = null;
}

async function loadCatalog(): Promise<{ items: CatalogProduct[]; categoryOrder: string[] }> {
// หากมี Cache และยังไม่หมดอายุ ( Cache 3 นาที ) ให้ดึงจาก RAM ไปใช้ได้ทันที (ใช้เวลา 0ms)
  if (catalogCache && Date.now() < catalogCache.expiresAt) {
    return catalogCache.data;
  }

  await connectMongoDB();

  // ⚠️ โหลดข้อมูลผ่าน query ตรงๆ (ไม่ใช้ nested populate) เพื่อให้ทำงานได้แม้ module
  //    ของ model อื่นยังไม่ถูก register — ป้องกัน MissingSchemaError เมื่อ endpoint นี้ถูกเรียกก่อน route อื่น
  const products = await Product.find({ deleted_at: null }).lean();

  const categories = await ProductCategory.find({ deleted_at: null })
    .select("_id product_category_name")
    .lean();
  const categoryNameById = new Map<string, string>(
    categories.map((c) => [String(c._id), String(c.product_category_name ?? "")])
  );

  const ingredients = await Ingredient.find({ deleted_at: null })
    .select("_id ingredient_name")
    .lean();
  const ingredientNameById = new Map<string, string>(
    ingredients.map((i) => [String(i._id), String(i.ingredient_name ?? "")])
  );

  const rawRecipes = await Recipe.find({ deleted_at: null }).lean();
  const componentIds = [
    ...new Set(
      rawRecipes.flatMap((r) =>
        ((r as any).components ?? []).map((c: any) => c?.component_id).filter(Boolean)
      )
    ),
  ];
  const components =
    componentIds.length > 0
      ? await Component.find({ _id: { $in: componentIds } })
          .select("ingredients")
          .lean()
      : [];
  const componentById = new Map(components.map((c) => [String(c._id), c]));

  // แปลง recipe ให้เป็นโครงสร้างที่มีชื่อส่วนผสม (จำลองแบบ populated)
  // เพื่อส่งเข้า buildAllergenInfoFromRecipe ได้ตรงๆ
  const recipeByProduct = new Map<string, any>();
  for (const recipe of rawRecipes) {
    const pid = recipe.product_id ? String(recipe.product_id) : null;
    if (!pid) continue;
    const mainRemapped = ((recipe as any).ingredients ?? []).map((item: any) => ({
      ingredient_id: {
        ingredient_name: ingredientNameById.get(String(item.ingredient_id)) ?? "",
      },
    }));
    const subRemapped = ((recipe as any).components ?? []).flatMap((c: any) => {
      const comp = componentById.get(String(c.component_id));
      return ((comp as any)?.ingredients ?? []).map((ci: any) => ({
        ingredient_id: {
          ingredient_name: ingredientNameById.get(String(ci.ingredient_id)) ?? "",
        },
      }));
    });
    recipeByProduct.set(pid, {
      ingredients: mainRemapped,
      components: subRemapped.length > 0 ? [{ component_id: { ingredients: subRemapped } }] : [],
    });
  }

  const categoryOrder: string[] = [];
  const categorySet = new Set<string>();
  const prices: number[] = [];
  const items: CatalogProduct[] = [];

  for (const doc of products) {
    const pid = String(doc._id);
    const categoryId = doc.category_id ? String(doc.category_id) : "";
    const categoryName = categoryNameById.get(categoryId) ?? "";
    if (categoryId && !categorySet.has(categoryId)) {
      categorySet.add(categoryId);
      categoryOrder.push(categoryId);
    }
    const price = toNumber(doc.product_price);
    prices.push(price);

    const recipe = recipeByProduct.get(pid);
    const allergenInfo = buildAllergenInfoFromRecipe(recipe);
    // seed text สำหรับสกัด taste vector (ชื่อ + คำอธิบาย + ส่วนผสม)
    const seedText = [
      doc.product_name_th,
      doc.product_name_eng,
      doc.product_description,
      ...allergenInfo.allIngredientNames,
    ]
      .filter((x) => x)
      .join(" ");
    const taste = buildTasteVector(
      seedText,
      (doc as any).tasteProfile ?? (doc as any).taste_profile
    );
    const features: ProductFeatures = {
      categoryId,
      categoryName,
      price,
      taste,
      seedText,
      vector: [],
    };
    items.push({ doc, features, allergenInfo });
  }

  // ── สร้าง feature vector: [one-hot หมวด, ราคา normalized, taste] ──
  const priceMin = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMax = prices.length > 0 ? Math.max(...prices) : 1;
  const priceRange = Math.max(1e-9, priceMax - priceMin);
  const dim = categoryOrder.length + 1 + TASTE_COUNT;

  for (const item of items) {
    const f = item.features;
    const v = new Array(dim).fill(0);
    const catIdx = categoryOrder.indexOf(f.categoryId);
    if (catIdx >= 0) v[catIdx] = 1;
    v[categoryOrder.length] = (f.price - priceMin) / priceRange;
    for (let i = 0; i < TASTE_COUNT; i++) {
      v[categoryOrder.length + 1 + i] = f.taste[i];
    }
    f.vector = v;
  }

  const result = { items, categoryOrder };
  
  // บันทึกลง Cache ไว้ 3 นาที (180,000 ms)
  catalogCache = {
    data: result,
    expiresAt: Date.now() + catalogCacheTtl(),
  };

  return result;
}
// ─── กลยุทธ์ A: Collaborative Filtering (Item-based) ───────────────────────────

/**
 * สร้าง User-Item Matrix แบบย่อ (neighborhood) เพื่อประหยัด query:
 *  1. หา "เพื่อนบ้าน" = ผู้ใช้คนอื่นที่เคย interact กับสินค้าที่ target user interact
 *  2. โหลดสัญญาณทั้งหมดของเพื่อนบ้านชุดนั้น (Interactions + Orders + Carts + Reviews)
 *  3. build matrix: userId → (productId → weight)
 *
 * น้ำหนักตาม spec: purchase=5, add_to_cart=3, wishlist=4, view=1, rating=ค่า rating (1-5)
 */
// ─── ปรับปรุง buildNeighborhoodUserItemMap เพื่อแก้ N+1 Query ─────────────────
async function buildNeighborhoodUserItemMap(
  userId: string,
  mySignals: Map<string, ProductSignals>
): Promise<Map<string, Map<string, number>>> {
  const myProductIds = [...mySignals.keys()];
  const matrix = new Map<string, Map<string, number>>();
  if (myProductIds.length === 0) return matrix;

  const ensureUser = (uid: string): Map<string, number> => {
    let m = matrix.get(uid);
    if (!m) {
      m = new Map();
      matrix.set(uid, m);
    }
    return m;
  };
  const addWeight = (uid: string, pid: string, weight: number) => {
    if (weight <= 0) return;
    const m = ensureUser(uid);
    m.set(pid, (m.get(pid) ?? 0) + weight);
  };

  for (const [pid, s] of mySignals) addWeight(userId, pid, signalWeight(s));

  // 1. หาเพื่อนบ้าน (จํากัดไม่เกิน 100 คนเพื่อความรวดเร็วในการคำนวณ)
  const neighbors = new Set<string>();

  const [interactions, reviews] = await Promise.all([
    Interaction.find({
      product_id: { $in: myProductIds },
      deleted_at: null,
      user_id: { $ne: userId },
    }).limit(2000).select("user_id").lean(),
    
    Review.find({
      product_id: { $in: myProductIds },
      deleted_at: null,
      is_visible: true,
      user_id: { $ne: userId },
    }).limit(1000).select("user_id").lean()
  ]);

  for (const it of interactions) neighbors.add(String(it.user_id));
  for (const r of reviews) neighbors.add(String(r.user_id));

  neighbors.delete(userId);
  if (neighbors.size === 0) return matrix;

  // เอาเฉพาะ Top 50-100 เพื่อนบ้านพอ
  const neighborArr = [...neighbors].slice(0, 100);

  // 2. ดึงข้อมูลของเพื่อนบ้านแบบ Batch เดียว (หลีกเลี่ยง .populate ในลูป)
  const [nInteractions, nOrders, nReviews] = await Promise.all([
    Interaction.find({
      user_id: { $in: neighborArr },
      deleted_at: null,
    }).limit(5000).select("user_id product_id action_type").lean(),

    Order.find({
      user_id: { $in: neighborArr },
      deleted_at: null,
      order_status: { $ne: "cancelled" },
    }).limit(1000).select("_id user_id").lean(),

    Review.find({
      user_id: { $in: neighborArr },
      deleted_at: null,
      is_visible: true,
    }).limit(1000).select("user_id product_id rating").lean()
  ]);

  // ประมวลผล Interactions
  for (const it of nInteractions) {
    const uid = String(it.user_id);
    const pid = String(it.product_id);
    const w = INTERACTION_ACTION_WEIGHTS[it.action_type as InteractionActionType] || 1;
    addWeight(uid, pid, w);
  }

  // ประมวลผล Orders (ดึง OrderItems รวดเดียวโดยใช้ $in)
  if (nOrders.length > 0) {
    const orderMap = new Map(nOrders.map(o => [String(o._id), String(o.user_id)]));
    const nItems = await OrderItem.find({
      order_id: { $in: nOrders.map((o) => o._id) },
      deleted_at: null,
    }).select("order_id product_id").lean();

    for (const item of nItems) {
      const uid = orderMap.get(String(item.order_id));
      if (uid) addWeight(uid, String(item.product_id), INTERACTION_ACTION_WEIGHTS.purchase);
    }
  }

  // ประมวลผล Reviews
  for (const r of nReviews) {
    const rating = toNumber(r.rating);
    if (rating > 0) addWeight(String(r.user_id), String(r.product_id), rating);
  }

  return matrix;
}

/**
 * คำนวณคะแนน Collaborative Filtering สำหรับผู้ใช้:
 *  - สร้าง item vector (ผู้ใช้ → น้ำหนัก) จาก User-Item Matrix
 *  - คำนวณ Cosine Similarity ระหว่างสินค้าที่ user interact กับสินค้าอื่น
 *  - คะแนน = Σ(srcWeight × sim) / Σ(srcWeight)  → อยู่ในช่วง [0, 1]
 *  - แนะนำเฉพาะสินค้าที่ user ยังไม่เคย interact (ตาม spec)
 */
async function computeCollaborativeScores(
  userId: string,
  mySignals: Map<string, ProductSignals>,
  myProductIds: string[]
): Promise<Map<string, number>> {
  if (myProductIds.length === 0) return new Map();
  const matrix = await buildNeighborhoodUserItemMap(userId, mySignals);

  // item vector: productId → (userId → weight)
  const itemUsers = new Map<string, Map<string, number>>();
  for (const [uid, prods] of matrix) {
    for (const [pid, w] of prods) {
      let vec = itemUsers.get(pid);
      if (!vec) {
        vec = new Map();
        itemUsers.set(pid, vec);
      }
      vec.set(uid, (vec.get(uid) ?? 0) + w);
    }
  }

  const result = new Map<string, number>();
  for (const srcId of myProductIds) {
    const srcVec = itemUsers.get(srcId);
    if (!srcVec) continue;
    const srcWeight = signalWeight(mySignals.get(srcId) ?? createSignals());
    if (srcWeight <= 0) continue;
    for (const [candId, candVec] of itemUsers) {
      if (candId === srcId) continue;
      const sim = cosine([...srcVec.values()], [...candVec.values()]);
      if (sim <= 0) continue;
      result.set(candId, (result.get(candId) ?? 0) + srcWeight * sim);
    }
  }

  // normalize ด้วยผลรวมน้ำหนักต้นทาง → คะแนนอยู่ในช่วง [0, 1]
  let totalWeight = 0;
  for (const pid of myProductIds) {
    totalWeight += signalWeight(mySignals.get(pid) ?? createSignals());
  }
  if (totalWeight > 0) {
    for (const [candId, score] of result) {
      result.set(candId, clamp01(score / totalWeight));
    }
  }
  return result;
}
// ─── กลยุทธ์ B: Content-Based Filtering ────────────────────────────────────────

/**
 * คำนวณคะแนน Content-Based:
 *  - User Profile Vector = weighted average ของ feature vector สินค้าที่ "ชอบ"
 *    (ซื้อ / wishlist / ให้คะแนน ≥ 4) โดยถ่วงด้วยน้ำหนัก signal
 *  - contentScore = cosine(userProfile, productVector)
 *  - Taste Profile Matching (ตาม spec):
 *      user_taste = average(purchased_products.tasteProfile)
 *      tasteScore = 1 - euclidean_distance(user_taste, product_taste) / max_distance
 *  - รวม: 0.5 × contentScore + 0.5 × tasteScore
 */
function computeContentScores(
  mySignals: Map<string, ProductSignals>,
  items: CatalogProduct[]
): Map<string, number> {
  const result = new Map<string, number>();
  const featuresById = new Map(items.map((i) => [String(i.doc._id), i.features]));

  // สินค้าที่ user "ชอบ" อย่างชัดเจน (ซื้อ / wishlist / ให้คะแนน ≥ 4)
  const liked: Array<{ pid: string; weight: number }> = [];
  for (const [pid, s] of mySignals) {
    if (s.purchase > 0 || s.wishlist > 0 || s.ratingMax >= 4) {
      liked.push({ pid, weight: Math.max(signalWeight(s), 1) });
    }
  }
  if (liked.length === 0) return result;

  const dim = items.reduce((max, i) => Math.max(max, i.features.vector.length), 0);
  if (dim === 0) return result;

  const profile = new Array(dim).fill(0);
  const tasteProfile = new Array(TASTE_COUNT).fill(0);
  let totalWeight = 0;

  for (const { pid, weight } of liked) {
    const f = featuresById.get(pid);
    if (!f) continue;
    const v = normalizeVec(f.vector);
    for (let i = 0; i < dim; i++) profile[i] += weight * v[i];
    const t = normalizeVec(f.taste);
    for (let i = 0; i < TASTE_COUNT; i++) tasteProfile[i] += weight * t[i];
    totalWeight += weight;
  }
  if (totalWeight <= 0) return result;
  for (let i = 0; i < dim; i++) profile[i] /= totalWeight;
  for (let i = 0; i < TASTE_COUNT; i++) tasteProfile[i] /= totalWeight;

  const tasteProfileUnit = normalizeVec(tasteProfile);
  const maxTasteDist = Math.sqrt(TASTE_COUNT); // สมาชิกของ taste vector อยู่ในช่วง [0,1]

  for (const item of items) {
    const pid = String(item.doc._id);
    if (mySignals.has(pid)) continue; // ข้ามสินค้าที่เคย interact แล้ว
    const sim = cosine(profile, normalizeVec(item.features.vector));
    const dist =
      euclidean(tasteProfileUnit, normalizeVec(item.features.taste)) / maxTasteDist;
    const tasteScore = clamp01(1 - dist);
    const score = 0.5 * clamp01(sim) + 0.5 * tasteScore;
    if (score > 0) result.set(pid, score);
  }
  return result;
}

/**
 * หาหมวดหมู่ที่ผู้ใช้ชื่นชอบ สำหรับ boost ×1.15
 *  - ถ้ามี user.preferences.favoriteCategoryIds (จาก onboarding ในอนาคต) ใช้ค่านั้น
 *  - ถ้าไม่มี → derive จากหมวดสินค้าที่ user ซื้อ/wishlist/ให้คะแนนสูง (top 3)
 */
function deriveFavoriteCategories(
  userDoc: any,
  mySignals: Map<string, ProductSignals>,
  items: CatalogProduct[]
): Set<string> {
  const explicit = userDoc?.preferences?.favoriteCategoryIds;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return new Set(explicit.map((x: unknown) => String(x)));
  }
  const featuresById = new Map(items.map((i) => [String(i.doc._id), i.features]));
  const counts = new Map<string, number>();

  // สินค้าที่ถูกใจ (favoriteproducts) → หมวดที่ชอบโดยตรง (strong signal = น้ำหนัก wishlist)
  if (Array.isArray(userDoc?.favoriteproducts)) {
    for (const raw of userDoc.favoriteproducts) {
      const pid = String(raw ?? "");
      const f = featuresById.get(pid);
      if (f?.categoryId) {
        counts.set(
          f.categoryId,
          (counts.get(f.categoryId) ?? 0) + INTERACTION_ACTION_WEIGHTS.wishlist
        );
      }
    }
  }

  for (const [pid, s] of mySignals) {
    if (s.purchase <= 0 && s.wishlist <= 0 && s.ratingMax < 4) continue;
    const f = featuresById.get(pid);
    if (f && f.categoryId) {
      counts.set(f.categoryId, (counts.get(f.categoryId) ?? 0) + signalWeight(s));
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c);
  return new Set(top);
}

/**
 * ใช้ boost factors ตาม spec: isFeatured ×1.1, discountPrice ×1.05, favCategory ×1.15
 * + Age-Based boost ×1.1 ถ้า taste ของสินค้าตรงกับรสนิยมทั่วไปของช่วงวัยผู้ใช้
 */
function applyBoosts(
  score: number,
  product: any,
  features: ProductFeatures,
  favCategories: Set<string>,
  ageBracket: AgeBracket | null
): { score: number; boosts: string[] } {
  let s = score;
  const boosts: string[] = [];

  if (product?.isFeatured === true) {
    s *= BOOST_FEATURED;
    boosts.push("สินค้าแนะนำของร้าน");
  }
  // sale_price = ราคาลดที่ owner ตั้งในหน้าตั้งราคาสินค้า (field จริงใน Products)
  const promoPrice = toNumber(product?.discountPrice ?? (product as any)?.promo_price ?? (product as any)?.sale_price);
  if (promoPrice > 0 && promoPrice < toNumber(product?.product_price)) {
    s *= BOOST_DISCOUNT;
    boosts.push("มีราคาพิเศษ/โปรโมชั่น");
  }
  if (favCategories.has(features.categoryId)) {
    s *= BOOST_FAVORITE_CATEGORY;
    boosts.push("ตรงกับหมวดหมู่ที่คุณชื่นชอบ");
  }
  if (ageBracket) {
    const tasteMatches = ageBracket.tasteKeys.some((key) => {
      const idx = TASTE_INDEX_BY_KEY.get(key);
      return idx !== undefined && features.taste[idx] > 0;
    });
    if (tasteMatches) {
      s *= BOOST_AGE_MATCH;
      boosts.push(`รสชาติที่เหมาะกับช่วงวัยของคุณ (${ageBracket.label})`);
    }
  }
  return { score: s, boosts };
}
// ─── กลยุทธ์ C: Popularity-Based ───────────────────────────────────────────────

interface PopularityScore {
  score: number;
  totalQty: number;
  qty7: number;
  trend: number;
  normSales: number;
  normRating: number;
}

/**
 * คำนวณคะแนนความนิยมจากยอดขายจริง (Orders/OrderItems เฉพาะที่ไม่ใช่ cancelled):
 *  - normalized_sales = totalSold / max(totalSold)
 *  - normalized_rating = avgRating / 5
 *  - recent_trend = sales_last_7_days / avg_weekly_sales  (cap ที่ 3x)
 *  - score = 0.4×normSales + 0.3×normRating + 0.3×trend
 */
async function computePopularityScores(
  items: CatalogProduct[]
): Promise<Map<string, PopularityScore>> {
  await connectMongoDB();
  const orders = await Order.find({
    deleted_at: null,
    order_status: { $ne: "cancelled" },
  })
    .select("_id")
    .lean();
  const orderIds = orders.map((o) => o._id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const aggRows = orderIds.length
    ? await OrderItem.aggregate([
        { $match: { order_id: { $in: orderIds }, deleted_at: null } },
        {
          $group: {
            _id: "$product_id",
            totalQty: { $sum: "$quantity" },
            qty7: {
              $sum: {
                $cond: [{ $gte: ["$created_at", sevenDaysAgo] }, "$quantity", 0],
              },
            },
            firstAt: { $min: "$created_at" },
          },
        },
      ])
    : [];

  const stats = new Map<
    string,
    { totalQty: number; qty7: number; firstAt: Date | null }
  >();
  let maxTotal = 0;
  for (const row of aggRows as any[]) {
    const total = toNumber(row.totalQty);
    const q7 = toNumber(row.qty7);
    maxTotal = Math.max(maxTotal, total);
    stats.set(String(row._id), {
      totalQty: total,
      qty7: q7,
      firstAt: row.firstAt ?? null,
    });
  }

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const result = new Map<string, PopularityScore>();

  for (const item of items) {
    const pid = String(item.doc._id);
    const st = stats.get(pid);
    const totalQty = st?.totalQty ?? 0;
    const qty7 = st?.qty7 ?? 0;
    const avgRating = toNumber(item.doc.avg_rating);

    const normSales = maxTotal > 0 ? totalQty / maxTotal : 0;
    const normRating = clamp01(avgRating / 5);

    // จำนวนสัปดาห์นับจากสินค้าขายครั้งแรก (เพื่อคำนวณ avg weekly sales)
    let weeks = 1;
    if (st?.firstAt) {
      weeks = Math.max(
        1,
        Math.min(52, (now - new Date(st.firstAt).getTime()) / weekMs)
      );
    }
    const avgWeekly = weeks > 0 ? totalQty / weeks : 0;
    const trendRaw = avgWeekly > 0 ? qty7 / avgWeekly : qty7 > 0 ? 1 : 0;
    const trend = clamp01(trendRaw / 3); // ปรับให้ trend ที่สูงเกินไปไม่ครอบงำคะแนน

    const popScore = 0.4 * normSales + 0.3 * normRating + 0.3 * trend;
    result.set(pid, {
      score: popScore,
      totalQty,
      qty7,
      trend,
      normSales,
      normRating,
    });
  }
  return result;
}
// ─── การรวมคะแนน + การสร้างเหตุผล (Main Entry) ────────────────────────────────

const DEFAULT_POPULARITY: PopularityScore = {
  score: 0,
  totalQty: 0,
  qty7: 0,
  trend: 0,
  normSales: 0,
  normRating: 0,
};

interface ReasonOptions {
  strategy: RecommendationStrategy;
  collab: number;
  content: number;
  pop: PopularityScore;
  boosts: string[];
  warning: AllergenWarning;
  isColdStart: boolean;
}

/** สร้างเหตุผล (ภาษาไทย) ว่าทำไมถึงแนะนำสินค้าชิ้นนี้ — ใช้แสดงบน UI */
function buildReasons(opts: ReasonOptions): string[] {
  const reasons: string[] = [];

  if (opts.isColdStart) {
    if (opts.pop.totalQty > 0) reasons.push("สินค้าขายดีที่ลูกค้าส่วนใหญ่เลือก");
    if (opts.pop.trend > 1) reasons.push("กำลังมาแรงในรอบ 7 วัน");
  } else {
    if (opts.collab > 0.1) {
      reasons.push("คนที่สั่ง/ดูสินค้าแบบเดียวกับคุณ ก็มักชอบสินค้านี้");
    }
    if (opts.content > 0.25) {
      reasons.push("รสชาติและสไตล์ใกล้เคียงกับสินค้าที่คุณชื่นชอบ");
    }
    if (opts.pop.score > 0.5 && opts.pop.totalQty > 0) {
      reasons.push("สินค้าขายดีประจำร้าน");
    }
    if (opts.pop.trend > 1.2 && opts.pop.totalQty > 0) {
      reasons.push("กำลังมาแรงในรอบ 7 วัน");
    }
    if (opts.pop.normRating >= 0.8 && opts.pop.totalQty > 0) {
      reasons.push("ได้รับคะแนนรีวิวสูง");
    }
  }

  for (const b of opts.boosts) {
    if (!reasons.includes(b)) reasons.push(b);
  }
  if (opts.warning.level !== "none" && opts.warning.message) {
    reasons.push(opts.warning.message);
  }
  return reasons.slice(0, 4);
}
/**
 * MAIN ENTRY — GET /api/recommendations
 *
 * 1. โหลด catalog + allergen + สัญญาณผู้ใช้
 * 2. ถ้า cold start (interaction < 5 ครั้ง) → Popularity + Allergen + หมวดที่ชอบ
 * 3. ถ้าไม่ใช่ → Hybrid 4 กลยุทธ์:
 *    finalScore = (0.35×collab + 0.30×content + 0.15×popular + 0.20×allergen) / 0.80
 * 4. ใช้ boost: isFeatured ×1.1, discountPrice ×1.05, favoriteCategory ×1.15
 * 5. สินค้าที่มี allergen ยังแสดงอยู่ (ติด warning) — ยกเว้น excludeAllergens=true
 */
export async function getRecommendations(
  query: RecommendationQuery
): Promise<RecommendationsResult> {
  await connectMongoDB();
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const strategy: RecommendationStrategy = query.strategy || "hybrid";
  const { userId, excludeAllergens } = query;

  // ข้อมูลผู้ใช้: allergen profile + favorite categories
  const userDoc = await User.findById(userId).lean().catch(() => null);
  const allergenProfile: AllergenProfile = parseAllergenProfile(
    (userDoc as any)?.user_allergies,
    (userDoc as any)?.allergenProfile
  );

  const { items } = await loadCatalog();
  const { signals, eventCount } = await collectUserSignals(userId);

  // ── สินค้าที่ถูกใจ (favoriteproducts) = สัญญาณ "ชอบ" ที่ชัดเจน ──
  // - ไม่แนะนำสินค้าที่อยู่ในรายการโปรดซ้ำ (เช่นเดียวกับสินค้าที่ interact แล้ว)
  // - นำไปใช้ใน content profile / favorite categories เพื่อแนะนำสินค้าแนวเดียวกัน
  const favoriteProductIds: string[] = Array.isArray((userDoc as any)?.favoriteproducts)
    ? (userDoc as any).favoriteproducts.map((id: unknown) => String(id))
    : [];
  for (const pid of favoriteProductIds) {
    if (!pid || !mongoose.isValidObjectId(pid)) continue;
    const existing = signals.get(pid);
    if (existing) {
      existing.wishlist += 1;
    } else {
      signals.set(pid, { ...createSignals(), wishlist: 1 });
    }
  }

  const myProductIds = [...signals.keys()];
  const isColdStart = eventCount < COLD_START_MIN_INTERACTIONS;

  const popScores = await computePopularityScores(items);
  const favCategories = deriveFavoriteCategories(userDoc, signals, items);
  const ageBracket = getAgeBracket((userDoc as any)?.user_birthdate);

  // กลยุทธ์ B (Content) คำนวณได้เสมอ, กลยุทธ์ A (Collab) ข้ามได้ถ้า cold start
  const contentScores = computeContentScores(signals, items);
  const needCollab =
    strategy === "collaborative" || (strategy === "hybrid" && !isColdStart);
  const collabScores = needCollab
    ? await computeCollaborativeScores(userId, signals, myProductIds)
    : new Map<string, number>();

  const candidates: RecommendationItem[] = [];

  for (const item of items) {
    const pid = String(item.doc._id);
    // ข้ามสินค้าที่แสดงจริงไม่ได้ (preorder / ถูกซ่อน / หมดสต็อก) — กันไม่ให้ไปแย่งที่ใน limit
    if (!isDisplayableProduct(item.doc)) continue;
    // สินค้าที่ user เคย interact แล้วไม่แนะนำซ้ำ (ตามหลักกลยุทธ์ A)
    if (signals.has(pid)) continue;

    const warning = checkAllergenForProduct(item.allergenInfo, allergenProfile);
    if (excludeAllergens && warning.level !== "none") continue;

    const pop = popScores.get(pid) ?? DEFAULT_POPULARITY;
    const collab = collabScores.get(pid) ?? 0;
    const content = contentScores.get(pid) ?? 0;

    let rawScore = 0;
    if (strategy === "collaborative") {
      rawScore = collab;
    } else if (strategy === "content") {
      rawScore = content;
    } else if (strategy === "popular") {
      rawScore = pop.score;
    } else if (isColdStart) {
      // Cold Start: Popularity-Based + Allergen Filter (+ หมวดที่ชอบ via boost)
      // map adjustment [-0.5, +0.2] → [0, 1] แล้วถ่วง 30%
      const adjNorm = clamp01((warning.scoreAdjustment + 0.5) / 0.7);
      rawScore = 0.7 * pop.score + 0.3 * adjNorm;
    } else {
      // Hybrid เต็มรูปแบบ (หารด้วย 0.80 = ผลรวมน้ำหนักกลยุทธ์หลัก)
      rawScore =
        (COLLABORATIVE_WEIGHT * collab +
          CONTENT_WEIGHT * content +
          POPULARITY_WEIGHT * pop.score +
          ALLERGEN_WEIGHT * warning.scoreAdjustment) /
                0.8;
    }

    const boosted = applyBoosts(rawScore, item.doc, item.features, favCategories, ageBracket);
    const reasons = buildReasons({
      strategy,
      collab,
      content,
      pop,
      boosts: boosted.boosts,
      warning,
      isColdStart,
    });

    candidates.push({
      product: {
        ...item.doc,
        category_name: item.features.categoryName,
        ingredientNames: item.allergenInfo.allIngredientNames,
      },
      score: Number(boosted.score.toFixed(6)),
      reasons,
      allergenWarning: warning.level === "none" ? null : warning,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const recommendations = candidates.slice(0, limit);

  return {
    recommendations,
    meta: {
      strategy,
      isColdStart,
      total: recommendations.length,
      candidateCount: candidates.length,
      interactionCount: eventCount,
    },
  };
}
// ─── GET /api/recommendations/similar/:productId ───────────────────────────────

/**
 * หา "คนที่ซื้อ/ดูสินค้านี้ มักสั่งอะไรด้วย" (co-occurrence)
 * อ่านจาก Interactions + Orders/OrderItems + Carts/CartItems ที่ผูกกับสินค้าต้นทาง
 */
async function getCoOccurrenceScores(
  targetProductId: string
): Promise<Map<string, number>> {
  const co = new Map<string, number>();
  const users = new Set<string>();
  const mark = (uid: string) => {
    if (uid) users.add(uid);
  };

  const interactions = await Interaction.find({
    product_id: targetProductId,
    deleted_at: null,
  })
    .limit(20000)
    .select("user_id")
    .lean();
  for (const it of interactions) mark(String(it.user_id));

  const orderItems = await OrderItem.find({
    product_id: targetProductId,
    deleted_at: null,
  })
    .populate({
      path: "order_id",
      match: { deleted_at: null, order_status: { $ne: "cancelled" } },
      select: "user_id",
    })
    .select("product_id")
    .lean();
  for (const oi of orderItems) mark(String((oi.order_id as any)?.user_id ?? ""));

  const cartItems = await CartItem.find({
    product_id: targetProductId,
    deleted_at: null,
  })
    .populate({ path: "cart_id", match: { deleted_at: null }, select: "user_id" })
    .select("product_id")
    .lean();
  for (const ci of cartItems) mark(String((ci.cart_id as any)?.user_id ?? ""));

  const usersArr = [...users];
  if (usersArr.length === 0) return co;

  // นับ unique user ต่อสินค้าอื่น (กันคนเดียวกันนับซ้ำ)
  const productUsers = new Map<string, Set<string>>();
  const addOcc = (pid: string, uid: string) => {
    if (!pid || !uid || pid === targetProductId) return;
    let set = productUsers.get(pid);
    if (!set) {
      set = new Set();
      productUsers.set(pid, set);
    }
    set.add(uid);
  };

  const ints = await Interaction.find({
    user_id: { $in: usersArr },
    deleted_at: null,
    product_id: { $ne: targetProductId },
  })
    .limit(40000)
    .select("user_id product_id")
    .lean();
  for (const it of ints) addOcc(String(it.product_id), String(it.user_id));

  const nOrders = await Order.find({
    user_id: { $in: usersArr },
    deleted_at: null,
    order_status: { $ne: "cancelled" },
  })
    .select("_id user_id")
    .lean();
  if (nOrders.length > 0) {
    const oItems = await OrderItem.find({
      order_id: { $in: nOrders.map((o) => o._id) },
      deleted_at: null,
    })
      .select("order_id product_id")
      .lean();
    const orderToUser = new Map(nOrders.map((o) => [String(o._id), String(o.user_id)]));
    for (const item of oItems) {
      addOcc(String(item.product_id), orderToUser.get(String(item.order_id)) ?? "");
    }
  }

  const nCarts = await Cart.find({
    user_id: { $in: usersArr },
    deleted_at: null,
  })
    .select("_id user_id")
    .lean();
  if (nCarts.length > 0) {
    const cItems = await CartItem.find({
      cart_id: { $in: nCarts.map((c) => c._id) },
      deleted_at: null,
    })
      .select("cart_id product_id")
      .lean();
    const cartToUser = new Map(nCarts.map((c) => [String(c._id), String(c.user_id)]));
    for (const item of cItems) {
      addOcc(String(item.product_id), cartToUser.get(String(item.cart_id)) ?? "");
    }
  }

  for (const [pid, set] of productUsers) co.set(pid, set.size);
  return co;
}

/**
 * FIND SIMILAR — GET /api/recommendations/similar/:productId (Auth: Optional)
 * คะแนน = 0.7 × (cosine feature vector + taste) + 0.3 × co-occurrence
 */
export async function getSimilarProducts(
  query: SimilarProductsQuery
): Promise<RecommendationItem[]> {
  await connectMongoDB();
  const productId = query.productId;
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 6));

  if (!mongoose.isValidObjectId(productId)) {
    throw new RecommendationError(400, "รูปแบบ productId ไม่ถูกต้อง");
  }

  const { items } = await loadCatalog();
  const targetItem = items.find((i) => String(i.doc._id) === productId);
  if (!targetItem) {
    throw new RecommendationError(404, "ไม่พบสินค้าที่ระบุ");
  }

  // ถ้าล็อกอิน → โหลดโปรไฟล์สารที่แพ้ (user_allergies) เพื่อแนบคำเตือน allergen
  // ในสินค้าที่แนะนำคล้ายกัน (ProductCard จะแสดง badge เดือนเมื่อมี user_allergies)
  let allergenProfile: AllergenProfile | null = null;
  if (query.userId) {
    const userDoc = await User.findById(query.userId).lean().catch(() => null);
    if (userDoc) {
      allergenProfile = parseAllergenProfile(
        (userDoc as any)?.user_allergies,
        (userDoc as any)?.allergenProfile
      );
    }
  }

    // ดึงหมวดหมู่ของสินค้าที่เลือกเพื่อกรองสินค้าที่คล้ายกันตามหมวดเดียวกัน
  // category_id ตอน lean จะเป็น ObjectId (ไม่ได้ populate) → ใช้ String() เปรียบเทียบเสมอ
  const targetCategoryId = targetItem.doc?.category_id
    ? String(targetItem.doc.category_id)
    : "";

  const coScores = await getCoOccurrenceScores(productId);
  let maxCo = 0;
  for (const c of coScores.values()) maxCo = Math.max(maxCo, c);

  const targetVec = normalizeVec(targetItem.features.vector);
  const targetTaste = normalizeVec(targetItem.features.taste);
  const maxTasteDist = Math.sqrt(TASTE_COUNT);

  const scored: RecommendationItem[] = [];
  for (const item of items) {
    const pid = String(item.doc._id);
    if (pid === productId) continue;
    // ข้ามสินค้าที่แสดงจริงไม่ได้ (preorder / ถูกซ่อน / หมดสต็อก)
    if (!isDisplayableProduct(item.doc)) continue;

    // กรอง: เฉพาะสินค้าที่อยู่ในหมวดหมู่เดียวกันกับสินค้าที่เลือก
    const itemCategoryId = item.doc?.category_id
      ? String(item.doc.category_id)
      : "";
    if (targetCategoryId && itemCategoryId !== targetCategoryId) continue;

    // ความคล้ายจาก feature vector (หมวด + ราคา + รสชาติ)
    const sim = cosine(targetVec, normalizeVec(item.features.vector));
    const dist =
      euclidean(targetTaste, normalizeVec(item.features.taste)) / maxTasteDist;
    const tasteScore = clamp01(1 - dist);
    const contentSim = 0.6 * clamp01(sim) + 0.4 * tasteScore;

    const coCount = coScores.get(pid) ?? 0;
    const coNorm = maxCo > 0 ? coCount / maxCo : 0;
    const score = 0.7 * contentSim + 0.3 * coNorm;

    const reasons: string[] = [];
    if (contentSim > 0.35) reasons.push("มีรสชาติและส่วนผสมใกล้เคียงกับสินค้านี้");
    if (coNorm > 0.35) reasons.push("ลูกค้าที่เลือกสินค้านี้ มักสั่งรายการนี้ด้วย");
    if (reasons.length === 0) reasons.push("สินค้าที่ลูกค้าอาจสนใจ");

    // แนบคำเตือน allergen (ถ้าล็อกอินและมี user_allergies) — badge เดือนบนการ์ด
    const warning = allergenProfile
      ? checkAllergenForProduct(item.allergenInfo, allergenProfile)
      : null;

    scored.push({
      product: {
        ...item.doc,
        category_name: item.features.categoryName,
        ingredientNames: item.allergenInfo.allIngredientNames,
      },
      score: Number(score.toFixed(6)),
      reasons: reasons.slice(0, 3),
      allergenWarning:
        warning && warning.level !== "none" ? warning : null,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // ถ้าสินค้าในหมวดเดียวกันไม่พอ → เติมจากหมวดอื่น (prevent หน้าขาว/ผลลัพธ์ว่าง)
  if (scored.length < limit) {
    const existingIds = new Set(scored.map((r) => String(r.product?._id)));
    for (const item of items) {
      if (scored.length >= limit) break;
      const pid = String(item.doc._id);
      if (pid === productId || existingIds.has(pid)) continue;
      // ข้ามสินค้าที่แสดงจริงไม่ได้ (preorder / ถูกซ่อน / หมดสต็อก)
      if (!isDisplayableProduct(item.doc)) continue;

      // ข้ามสินค้าในหมวดเดียวกับเป้าหมาย (ให้ลงก่อนหมดแล้ว)
      const fallbackCategory = item.doc?.category_id ? String(item.doc.category_id) : "";
      if (targetCategoryId && fallbackCategory === targetCategoryId) continue;
      
      const sim = cosine(targetVec, normalizeVec(item.features.vector));
      const dist =
        euclidean(targetTaste, normalizeVec(item.features.taste)) / maxTasteDist;
      const tasteScore = clamp01(1 - dist);
      const contentSim = 0.6 * clamp01(sim) + 0.4 * tasteScore;
      
      // ✅ คำนวณ warning ใหม่สำหรับสินค้าตัวนี้โดยเฉพาะ
      const fallbackWarning = allergenProfile
        ? checkAllergenForProduct(item.allergenInfo, allergenProfile)
        : null;

      scored.push({
        product: {
          ...item.doc,
          category_name: item.features.categoryName,
          ingredientNames: item.allergenInfo.allIngredientNames,
        },
        score: Number((contentSim * 0.4).toFixed(6)), // ถ่วงให้คะแนนน้อยกว่าหมวดเดียวกัน
        reasons: ["สินค้าแนะนำ"],
        allergenWarning:
          fallbackWarning && fallbackWarning.level !== "none" ? fallbackWarning : null,
      });
      existingIds.add(pid);
    }
  }

  return scored.slice(0, limit);
}
// ─── POST /api/interactions ────────────────────────────────────────────────────

/**
 * บันทึก interaction ของผู้ใช้ลงใน collection `Interactions`
 * (ทำหน้าที่เป็นสัญญาณป้อนเข้า recommendation engine)
 *
 * Body: { productId, actionType: "view"|"add_to_cart"|"wishlist"|"purchase", metadata? }
 */
export async function recordInteraction(input: {
  userId: string;
  productId: string;
  actionType: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  id: string;
  userId: string;
  productId: string;
  actionType: string;
  weight: number;
  createdAt: Date;
}> {
  await connectMongoDB();
  const actionType = input.actionType as InteractionActionType;

  if (!(INTERACTION_ACTION_TYPES as readonly string[]).includes(actionType)) {
    throw new RecommendationError(
      400,
      `actionType ต้องเป็นหนึ่งใน: ${INTERACTION_ACTION_TYPES.join(", ")}`
    );
  }
  if (!mongoose.isValidObjectId(input.productId)) {
    throw new RecommendationError(400, "รูปแบบ productId ไม่ถูกต้อง");
  }

  // ตรวจว่าสินค้ายัง active อยู่จริง (กันบันทึก interaction กับสินค้าที่ลบไปแล้ว)
  const product = await Product.exists({ _id: input.productId, deleted_at: null });
  if (!product) {
    throw new RecommendationError(404, "ไม่พบสินค้าที่ระบุ");
  }

  const doc = await Interaction.create({
    user_id: input.userId,
    product_id: input.productId,
    action_type: actionType,
    metadata: input.metadata ?? {},
    deleted_at: null,
  });

  const plain = doc.toObject() as any;
  return {
    id: String(plain._id),
    userId: String(plain.user_id),
    productId: String(plain.product_id),
    actionType: String(plain.action_type),
    weight: INTERACTION_ACTION_WEIGHTS[plain.action_type as InteractionActionType],
    createdAt: plain.created_at,
  };
}