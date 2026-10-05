import mongoose from "mongoose";

const preorderConfigSchema = new mongoose.Schema(
  {
    min_order_qty: {
      type: Number,
      required: true,
      min: 1,
    },
    max_order_qty: {
      type: Number,
      required: true,
      min: 1,
    },
    lead_time_days: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // รหัสสินค้าที่มนุษย์อ่านได้ / ใช้พิมพ์บาร์โค้ดหน้าร้าน (ไม่ใช่ _id ของ Mongo)
    //   pos-DDYYzzz = สินค้าหน้าร้าน/ออนไลน์ (inStore, online) , pre-DDYYzzz = พรีออเดอร์ (preorder)
    //   DD = วันที่สร้าง (01-31) , YY = ปี ค.ศ. 2 หลัก , zzz = เลขสุ่ม 3 หลัก (กันซ้ำ)
    // สร้างอัตโนมัติใน productService.createProduct() — ห้ามซ้ำ
    product_id: {
      type: String,
      required: true,
      trim: true,
    },
    product_name_th: {
      type: String,
      required: true,
      trim: true,
    },
    product_name_eng: {
      type: String,
      required: true,
      trim: true,
    },
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductCategories",
      required: true,
    },
    // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md)
    product_price: {
      type: Number,
      required: true,
      min: 0,
    },
    // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md)
    sale_price: {
      // ราคาโปรโมชัน — null = ไม่มีการลดราคา ใช้ product_price ตามปกติ
      type: Number,
      default: null,
      min: 0,
    },
    is_visible: {
      // ควบคุมว่าจะแสดงสินค้านี้ในหน้าร้านหรือไม่ (ซ่อนได้โดยไม่ต้องลบ)
      type: Boolean,
      default: true,
    },
    product_img: {
      type: [String],
      default: [],
    },
    product_description: {
      type: String,
      default: null,
    },
    preparation_heating: {
      type: String,
      default: null,
    },
    yield_per_batch: {
      type: Number,
      default: null,
      min: 0,
    },
    // ต้นทุนต่อหน่วยที่กรอกมือ (BACKLOG §3.16) — fallback ให้ recipeService.getUnitCostByProduct()
    // ใช้เฉพาะสินค้าที่ "ซื้อมาขายต่อ" ไม่มีสูตรการผลิต (recipeModel) ให้คำนวณต้นทุนเองได้
    // ถ้าสินค้ามีสูตรอยู่แล้ว ต้นทุนจากสูตรจะมาก่อนเสมอ (ดูลำดับความสำคัญใน recipeService)
    // เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (ทั้ง DB และ API — docs/money-units.md) — ต้นทุนซื้อมาขายต่อ ใช้เป็น fallback ของ getUnitCostByProduct() เมื่อไม่มีสูตร
    purchase_cost: {
      type: Number,
      default: null,
      min: 0,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
    is_preorder: {
      // true = สินค้าพรีออเดอร์ (รหัส pre- · ไม่มีสต็อก · ขายผ่านรอบพรีออเดอร์ต้องมี preorder_config)
      // false = สินค้าปกติ (รหัส pos- · มีสต็อก · ขายได้ทั้งเว็บและหน้าร้าน — ซ่อนจากเว็บด้วย is_visible)
      // docs/BACKLOG2.md §14 (2026-09-30) — แทน product_types (array inStore/online/preorder) ช่องทางขายดูจากออเดอร์แทน
      // ข้อมูลเก่าต้องรัน scripts/migrate-is-preorder.ts ก่อน (ไม่งั้นสินค้าพรีออเดอร์เดิมจะถูกอ่านเป็น false)
      type: Boolean,
      required: true,
      default: false,
    },
    product_stock_quantity: {
      // สินค้าปกติ (is_preorder: false) → มีค่า · พรีออเดอร์ → null
      type: Number,
      min: 0,
      default: 0,
    },
    // เกณฑ์ "สินค้าใกล้หมด" รายสินค้า (เทียบ reorder_point ของวัตถุดิบ) — null = ใช้ค่าเริ่มต้น 5
    // (src/lib/lowStock.ts) · ใช้ทั้งแจ้งเตือน LINE, /api/admin/products/low-stock และ dashboard
    low_stock_threshold: {
      type: Number,
      min: 0,
      default: null,
    },
    avg_rating: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0,
      max: 5,
      default: null,
    },
    review_count: {
      type: Number,
      min: 0,
      default: 0,
    },
    preorder_config: {
      // ใช้เฉพาะสินค้าพรีออเดอร์ (is_preorder: true) · สินค้าปกติ = null
      type: preorderConfigSchema,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);



// ── Indexes ─────────────────────────────────────────────────
// unique เฉพาะเอกสารที่มี product_id (sparse) — กันพังตอน build index บนข้อมูลเก่าที่ยังไม่มีรหัส
// (ให้รัน scripts/backfill-product-codes.ts เติมรหัสให้ของเดิม)
productSchema.index({ product_id: 1 }, { unique: true, sparse: true });
productSchema.index({ category_id: 1 });
productSchema.index({ is_preorder: 1, deleted_at: 1 });
productSchema.index({ avg_rating: -1 });
productSchema.index({ deleted_at: 1 });

const Product =
  mongoose.models.Products || mongoose.model("Products", productSchema);

export default Product;