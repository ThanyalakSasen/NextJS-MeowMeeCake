/**
 * reviewStatsService — สรุปรีวิวสำหรับแดชบอร์ด "รายงานความคิดเห็น" (GET /api/admin/reviews/stats · สิทธิ์ reports.view)
 *
 * เดิม frontend โหลดรีวิวทั้งช่วงทีละหน้ามาคำนวณเอง (เพดาน 100 รายการ → ตัวเลขไม่ครบเมื่อรีวิวเยอะ + โหลดช้า)
 * ตอนนี้คำนวณที่ server จากรีวิว **ทุกรายการ** ในช่วง (ดึงเฉพาะฟิลด์ที่ใช้) — ตอบเฉพาะตัวเลขสรุป
 *
 *   summary         จำนวน · คะแนนเฉลี่ย · รีวิวแย่ (≤2 ดาว) · ตอบแล้ว · ยังไม่อ่าน · มีรูป/วิดีโอ
 *   previous        summary ของช่วงก่อนหน้า (prev_since/prev_until — frontend คิดช่วงเอง เพราะเดือน/ไตรมาสยาวไม่เท่ากัน)
 *   previous_aspects แง่มุมของช่วงก่อนหน้า (นับแบบเดียวกับ aspects) — frontend ใช้ดูแนวโน้มหัวข้อที่ถูกติ
 *   rating_counts   [1★ … 5★] · buckets (รายวัน/รายเดือน ตามเวลาไทย) · aspects (ชอบ/ควรปรับปรุง)
 *   top_products / low_products · categories (สรุปรายหมวด + แง่มุมที่ถูกติมากสุด) · unreplied_negative (5 ล่าสุด)
 *   products        ทุกสินค้าที่มีรีวิวในช่วง + ค่าช่วงก่อนหน้า + หัวข้อที่ถูกติมากสุด (ตาราง "วิเคราะห์รายสินค้า")
 *   productId       กรองทุกส่วนให้เหลือสินค้าเดียว (แดชบอร์ดเลือกสินค้า)
 *
 * แง่มุมนับแบบเดียวกับหน้าเดิม: aspect_feedback ของรีวิวใหม่ + ประโยคสำเร็จรูปของรีวิวเก่า (ระดับ ≥4 ชอบ · ≤2 ควรปรับปรุง · 3 ไม่นับ)
 */
import dbConnect from "../lib/dbConnect";
import { bangkokDateString } from "../lib/datetime";
import reviewModel from "../models/reviewModel";
import productModel from "../models/productModel";
import productCategoryModel from "../models/productCategoryModel";
import aspectModel from "../models/aspectModel";
import userModel from "../models/userModel";
import { NEGATIVE_REVIEW_MAX_RATING } from "./reviewService";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** สินค้า/หมวดคะแนนต่ำ — นับเฉพาะที่มีรีวิวอย่างน้อยเท่านี้ (1 รีวิวเดียวไม่ใช่ภาพรวม) */
export const MIN_REVIEWS_FOR_LOW = 2;
const TOP_N = 5;
const CATEGORY_ASPECTS_N = 3;

export type StatsBucket = "day" | "month";

export interface ReviewSummaryStats {
  total: number;
  avg: number | null;
  negative: number;
  replied: number;
  unread: number;
  with_media: number;
}

export interface AspectCount {
  name: string;
  positive: number;
  negative: number;
}

export interface ItemStat {
  id: string;
  name: string;
  count: number;
  avg: number;
}

export interface CategoryStat extends ItemStat {
  negative: number;
  /** รีวิวดี (4–5 คะแนน) */
  positive: number;
  /** แง่มุมของหมวดนี้: ที่ถูกติมากสุด 3 + ที่ถูกชมมากสุด 3 (ไม่ซ้ำ) เรียงที่ถูกติมากสุดก่อน */
  aspects: AspectCount[];
}

/** แถวของตาราง "วิเคราะห์รายสินค้า" */
export interface ProductAnalysis extends ItemStat {
  category_name: string;
  /** รีวิว 1–2 ดาว */
  negative: number;
  /** ช่วงก่อนหน้า · ส่ง prev_since/prev_until ไม่ครบ หรือไม่มีรีวิว = 0 / null */
  prev_count: number;
  prev_avg: number | null;
  /** หัวข้อที่ถูกติมากสุดของสินค้านี้ในช่วงนี้ */
  top_issue: { name: string; count: number } | null;
}

export interface ReviewStats {
  summary: ReviewSummaryStats;
  previous: ReviewSummaryStats | null;
  /** แง่มุมของช่วงก่อนหน้า · null = ไม่ได้ส่ง prev_since/prev_until */
  previous_aspects: AspectCount[] | null;
  rating_counts: number[];
  bucket: StatsBucket;
  /** เฉพาะช่วงที่มีรีวิว — frontend เติมช่วงว่างเอง · key = YYYY-MM-DD หรือ YYYY-MM (เวลาไทย) */
  buckets: Array<{ key: string; count: number; avg: number }>;
  aspects: AspectCount[];
  top_products: ItemStat[];
  low_products: ItemStat[];
  categories: CategoryStat[];
  /** ทุกสินค้าที่มีรีวิวในช่วงนี้ — เรียงรีวิวมากสุดก่อน */
  products: ProductAnalysis[];
  unreplied_negative_count: number;
  unreplied_negative: Array<{
    _id: string;
    rating: number;
    review_text: string | null;
    created_at: Date;
    product_name: string;
    user_name: string;
  }>;
}

const FIELDS = "rating created_at shop_reply read_at image video aspect_feedback selected_presets product_id user_id review_text";

/** แง่มุมของหมวด: ถูกติมากสุด N + ถูกชมมากสุด N (ไม่ซ้ำ) → เรียงที่ถูกติมากสุดก่อน */
function categoryAspects(all: AspectCount[]): AspectCount[] {
  const worst = all.filter((a) => a.negative > 0).sort((a, b) => b.negative - a.negative || b.positive - a.positive).slice(0, CATEGORY_ASPECTS_N);
  const best = all.filter((a) => a.positive > 0).sort((a, b) => b.positive - a.positive || a.negative - b.negative).slice(0, CATEGORY_ASPECTS_N);
  const picked = new Map([...worst, ...best].map((a) => [a.name, a]));
  return [...picked.values()].sort((a, b) => b.negative - a.negative || b.positive - a.positive);
}
const isNegative = (r: any) => Number(r.rating) <= NEGATIVE_REVIEW_MAX_RATING;
const isReplied = (r: any) => typeof r.shop_reply?.text === "string" && r.shop_reply.text.trim() !== "";
const round2 = (n: number) => Math.round(n * 100) / 100;

async function loadRows(since: Date, until: Date, productId?: string | null): Promise<any[]> {
  return reviewModel
    .find({ deleted_at: null, created_at: { $gte: since, $lt: until }, ...(productId ? { product_id: productId } : {}) })
    .select(FIELDS)
    .lean<any[]>();
}

function summarize(rows: any[]): ReviewSummaryStats {
  let sum = 0;
  let negative = 0;
  let replied = 0;
  let unread = 0;
  let withMedia = 0;
  for (const r of rows) {
    sum += Number(r.rating) || 0;
    if (isNegative(r)) negative++;
    if (isReplied(r)) replied++;
    if (!r.read_at) unread++;
    if ((Array.isArray(r.image) && r.image.length > 0) || r.video) withMedia++;
  }
  return {
    total: rows.length,
    avg: rows.length ? round2(sum / rows.length) : null,
    negative,
    replied,
    unread,
    with_media: withMedia,
  };
}

/** แง่มุม (ชอบ/ควรปรับปรุง) ของรีวิว 1 รายการ */
function topicsOf(r: any, aspectName: Map<string, string>): Array<{ name: string; sentiment: "positive" | "negative" }> {
  const out: Array<{ name: string; sentiment: "positive" | "negative" }> = [];
  for (const f of r.aspect_feedback ?? []) {
    if (f?.aspect_name_th && (f.sentiment === "positive" || f.sentiment === "negative")) {
      out.push({ name: String(f.aspect_name_th), sentiment: f.sentiment });
    }
  }
  for (const p of r.selected_presets ?? []) {
    const level = Number(p?.rating_level);
    if (!(level >= 4 || level <= 2)) continue;
    const name = (p.aspect_id && aspectName.get(String(p.aspect_id))) || String(p.text ?? "").split(":")[0].trim();
    if (name) out.push({ name, sentiment: level >= 4 ? "positive" : "negative" });
  }
  return out;
}

function addAspect(map: Map<string, AspectCount>, name: string, sentiment: "positive" | "negative") {
  const a = map.get(name) ?? { name, positive: 0, negative: 0 };
  a[sentiment]++;
  map.set(name, a);
}

const byVolume = (a: AspectCount, b: AspectCount) => b.positive + b.negative - (a.positive + a.negative);

/** แง่มุมรวมของชุดรีวิว เรียงตามจำนวนครั้งที่ถูกพูดถึง */
function aspectsOf(rows: any[], aspectName: Map<string, string>): AspectCount[] {
  const map = new Map<string, AspectCount>();
  for (const r of rows) for (const tp of topicsOf(r, aspectName)) addAspect(map, tp.name, tp.sentiment);
  return [...map.values()].sort(byVolume);
}

export async function getReviewStats(q: {
  since: Date;
  until: Date;
  bucket: StatsBucket;
  prevSince?: Date | null;
  prevUntil?: Date | null;
  /** เฉพาะสินค้านี้ — ทุกส่วน (รวมช่วงก่อนหน้า) คิดจากรีวิวของสินค้านี้เท่านั้น */
  productId?: string | null;
}): Promise<ReviewStats> {
  await dbConnect();
  const [rows, prevRows] = await Promise.all([
    loadRows(q.since, q.until, q.productId),
    q.prevSince && q.prevUntil ? loadRows(q.prevSince, q.prevUntil, q.productId) : Promise.resolve(null),
  ]);

  // ชื่อแง่มุมของประโยคสำเร็จรูป (รีวิวเก่า) · สินค้า (รวมที่ถูกลบ — รีวิวเก่ายังอยู่) · หมวด
  const presetAspectIds = new Set<string>();
  for (const r of [...rows, ...(prevRows ?? [])]) {
    for (const p of r.selected_presets ?? []) if (p?.aspect_id) presetAspectIds.add(String(p.aspect_id));
  }
  const productIds = [...new Set(rows.map((r) => String(r.product_id ?? "")).filter(Boolean))];
  const [aspects, products] = await Promise.all([
    presetAspectIds.size ? aspectModel.find({ _id: { $in: [...presetAspectIds] } }).select("aspect_name_th").lean<any[]>() : [],
    productIds.length ? productModel.find({ _id: { $in: productIds } }).select("product_name_th category_id").lean<any[]>() : [],
  ]);
  const aspectName = new Map(aspects.map((a) => [String(a._id), String(a.aspect_name_th ?? "")]));
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const categoryIds = [...new Set(products.map((p) => String(p.category_id ?? "")).filter(Boolean))];
  const categories = categoryIds.length
    ? await productCategoryModel.find({ _id: { $in: categoryIds } }).select("product_category_name").lean<any[]>()
    : [];
  const categoryName = new Map(categories.map((c) => [String(c._id), String(c.product_category_name ?? "")]));

  const ratingCounts = [0, 0, 0, 0, 0];
  const buckets = new Map<string, { count: number; sum: number }>();
  const aspectMap = new Map<string, AspectCount>();
  const productStats = new Map<string, { count: number; sum: number; negative: number; aspects: Map<string, AspectCount> }>();
  const categoryStats = new Map<string, { count: number; sum: number; negative: number; positive: number; aspects: Map<string, AspectCount> }>();

  for (const r of rows) {
    const rating = Math.min(5, Math.max(1, Math.round(Number(r.rating) || 1)));
    ratingCounts[rating - 1]++;

    const day = bangkokDateString(new Date(r.created_at));
    const key = q.bucket === "day" ? day : day.slice(0, 7);
    const b = buckets.get(key) ?? { count: 0, sum: 0 };
    b.count++;
    b.sum += Number(r.rating) || 0;
    buckets.set(key, b);

    const topics = topicsOf(r, aspectName);
    for (const tp of topics) addAspect(aspectMap, tp.name, tp.sentiment);

    const pid = String(r.product_id ?? "");
    if (pid) {
      const ps = productStats.get(pid) ?? { count: 0, sum: 0, negative: 0, aspects: new Map<string, AspectCount>() };
      ps.count++;
      ps.sum += Number(r.rating) || 0;
      if (isNegative(r)) ps.negative++;
      for (const tp of topics) addAspect(ps.aspects, tp.name, tp.sentiment);
      productStats.set(pid, ps);

      const cid = String(productById.get(pid)?.category_id ?? "");
      if (cid) {
        const cs = categoryStats.get(cid) ?? { count: 0, sum: 0, negative: 0, positive: 0, aspects: new Map<string, AspectCount>() };
        cs.count++;
        cs.sum += Number(r.rating) || 0;
        if (isNegative(r)) cs.negative++;
        if (Number(r.rating) >= 4) cs.positive++;
        for (const tp of topics) addAspect(cs.aspects, tp.name, tp.sentiment);
        categoryStats.set(cid, cs);
      }
    }
  }

  const productList: ItemStat[] = [...productStats].map(([id, s]) => ({
    id,
    name: String(productById.get(id)?.product_name_th ?? ""),
    count: s.count,
    avg: round2(s.sum / s.count),
  }));

  // ช่วงก่อนหน้ารายสินค้า (จำนวน + ผลรวมคะแนน) — ตาราง "วิเคราะห์รายสินค้า" ใช้เทียบ
  const prevByProduct = new Map<string, { count: number; sum: number }>();
  for (const r of prevRows ?? []) {
    const pid = String(r.product_id ?? "");
    if (!pid) continue;
    const s = prevByProduct.get(pid) ?? { count: 0, sum: 0 };
    s.count++;
    s.sum += Number(r.rating) || 0;
    prevByProduct.set(pid, s);
  }
  const productTable: ProductAnalysis[] = [...productStats]
    .map(([id, s]) => {
      const product = productById.get(id);
      const prev = prevByProduct.get(id);
      const issue = [...s.aspects.values()].filter((a) => a.negative > 0).sort((a, b) => b.negative - a.negative || a.name.localeCompare(b.name, "th"))[0];
      return {
        id,
        name: String(product?.product_name_th ?? ""),
        category_name: categoryName.get(String(product?.category_id ?? "")) ?? "",
        count: s.count,
        avg: round2(s.sum / s.count),
        negative: s.negative,
        prev_count: prev?.count ?? 0,
        prev_avg: prev ? round2(prev.sum / prev.count) : null,
        top_issue: issue ? { name: issue.name, count: issue.negative } : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"));

  // รีวิวแย่ที่ยังไม่ตอบ — 5 รายการใหม่สุด (ชื่อสินค้า/ลูกค้าสำหรับแสดง)
  const unreplied = rows.filter((r) => isNegative(r) && !isReplied(r));
  const latest = [...unreplied]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, TOP_N);
  const userIds = [...new Set(latest.map((r) => String(r.user_id ?? "")).filter(Boolean))];
  const users = userIds.length ? await userModel.find({ _id: { $in: userIds } }).select("user_fullname").lean<any[]>() : [];
  const userName = new Map(users.map((u) => [String(u._id), String(u.user_fullname ?? "")]));

  return {
    summary: summarize(rows),
    previous: prevRows ? summarize(prevRows) : null,
    previous_aspects: prevRows ? aspectsOf(prevRows, aspectName) : null,
    rating_counts: ratingCounts,
    bucket: q.bucket,
    buckets: [...buckets]
      .map(([key, b]) => ({ key, count: b.count, avg: round2(b.sum / b.count) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    aspects: [...aspectMap.values()].sort(byVolume),
    top_products: [...productList].sort((a, b) => b.count - a.count || b.avg - a.avg).slice(0, TOP_N),
    low_products: productList
      .filter((p) => p.count >= MIN_REVIEWS_FOR_LOW)
      .sort((a, b) => a.avg - b.avg || b.count - a.count)
      .slice(0, TOP_N),
    categories: [...categoryStats]
      .map(([id, s]) => ({
        id,
        name: categoryName.get(id) ?? "",
        count: s.count,
        avg: round2(s.sum / s.count),
        negative: s.negative,
        positive: s.positive,
        aspects: categoryAspects([...s.aspects.values()]),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th")),
    products: productTable,
    unreplied_negative_count: unreplied.length,
    unreplied_negative: latest.map((r) => ({
      _id: String(r._id),
      rating: Number(r.rating),
      review_text: r.review_text ?? null,
      created_at: r.created_at,
      product_name: String(productById.get(String(r.product_id ?? ""))?.product_name_th ?? ""),
      user_name: userName.get(String(r.user_id ?? "")) ?? "",
    })),
  };
}
