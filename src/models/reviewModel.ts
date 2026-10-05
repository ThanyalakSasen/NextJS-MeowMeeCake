import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
    user_id : { //ผู้ที่เขียนรีวิวนี้
        type: mongoose.Schema.Types.ObjectId,
        ref: "Users",
        required: true,
    },
    product_id : { //สินค้าที่รีวิวนี้เกี่ยวข้อง
        type: mongoose.Schema.Types.ObjectId,
        ref: "Products",
        required: true,
    },
    // รีวิวผูกกับรายการสินค้าในคำสั่งซื้ออย่างใดอย่างหนึ่ง (customer-backend-merge.md §8.20):
    //   order_item_id = ออเดอร์ปกติ (OrderItems) · preorder_order_item_id = พรีออเดอร์ (PreorderItems)
    order_item_id : { //คำสั่งซื้อที่รีวิวนี้เกี่ยวข้อง
        type: mongoose.Schema.Types.ObjectId,
        ref: "OrderItems",
        default: null,
        required: function (this: { preorder_order_item_id?: unknown }) {
            return !this.preorder_order_item_id;
        },
    },
    preorder_order_item_id : { //รายการในพรีออเดอร์ที่รีวิวนี้เกี่ยวข้อง (ถ้ามี) — เดิม ref "PreOrderItems" สะกดผิด populate ไม่ได้
        type: mongoose.Schema.Types.ObjectId,
        ref: "PreorderItems",
        default: null,
    },
    rating: { //คะแนนรีวิวที่ให้กับสินค้า (เช่น 1-5 ดาว)
            type: Number,
            required: true,
            min: 1,
            max: 5,
    },
    review_text: { //ข้อความรีวิวที่เขียนโดยผู้ใช้
        type: String,
        required: false,
    },
    image : 
        { //รูปภาพประกอบรีวิวที่ผู้ใช้สามารถอัปโหลดได้ (ถ้ามี)
            type: [String], //เก็บ URL หรือ path ของรูปภาพ
            required: false,
        }
    ,
    video: { //วิดีโอประกอบรีวิว 1 คลิป (ถ้ามี) — URL จาก /api/shop/reviews/upload (customer-backend-merge.md §8.18)
        type: String,
        default: null,
    },
    is_analyzed: { //สถานะการวิเคราะห์รีวิวนี้โดยระบบ (เช่น วิเคราะห์ความรู้สึก, ตรวจจับคำหยาบคาย เป็นต้น)
        type: Boolean,
        default: false,
    },
    // ── ฟิลด์ที่ backend ฝั่งลูกค้าเขียนลง collection เดียวกันอยู่แล้ว (customer-backend-merge.md §8.20) ──
    // แง่มุมที่ลูกค้ากด "ชอบ" / "ควรปรับปรุง" — 1 แง่มุมเลือกได้ทางเดียว · เก็บชื่อไว้กันแง่มุมต้นทางถูกลบ/เปลี่ยนชื่อ
    aspect_feedback: {
        type: [
            {
                aspect_id: { type: mongoose.Schema.Types.ObjectId, ref: "Aspects", required: true },
                aspect_name_th: { type: String },
                sentiment: { type: String, enum: ["positive", "negative"], required: true },
            },
        ],
        default: [],
        _id: false,
    },
    // สถานะการแสดงผล — รีวิวใหม่แสดงทันที (approved) ร้านซ่อนทีหลังได้ (hidden) · เปลี่ยนคู่กับ is_visible เสมอ
    // (reviewService.setReviewStatus) · เอกสารเก่าที่ไม่มี status นับเป็น approved
    status: {
        type: String,
        enum: ["pending", "approved", "hidden"],
        default: "approved",
    },
    is_visible: { //สถานะการแสดงรีวิวนี้ในระบบ ถ้า false จะไม่แสดงให้ผู้ใช้เห็น แต่ข้อมูลยังคงอยู่ในฐานข้อมูล (คู่กับ status)
        type: Boolean,
        default: true,
    },
    is_pinned: { type: Boolean, default: false }, //ปักหมุดให้ขึ้นบนสุดของหน้ารีวิวสินค้า
    pinned_at: { type: Date, default: null },
    // คำตอบจากร้าน (ลูกค้าเห็น)
    shop_reply: {
        type: {
            text: { type: String },
            replied_at: { type: Date },
            replied_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
        },
        default: null,
        _id: false,
    },
    // ── ข้อมูลภายในของทีมงาน — ห้ามส่งให้ลูกค้า/หน้าสาธารณะ (reviewService.PUBLIC_FIELDS) ──
    internal_tags: { type: [String], default: [] },
    internal_note: {
        type: {
            text: { type: String },
            updated_at: { type: Date },
            updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
        },
        default: null,
        _id: false,
    },
    read_at: { type: Date, default: null }, // ทีมงานอ่าน/จัดการแล้ว (null = ยังไม่อ่าน)
    read_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    deleted_at: {
      type: Date,
      default: null,
    },
},
{
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
});

reviewSchema.index({ product_id: 1 });
reviewSchema.index({ user_id: 1 });
// 1 รายการรีวิวได้ครั้งเดียว (partial unique — รีวิวที่ถูก soft delete แล้วไม่บล็อกการรีวิวใหม่)
// กรองเฉพาะค่าที่เป็น ObjectId — รีวิวพรีออเดอร์มี order_item_id: null (index เดิม order_item_id_1 นับ null ซ้ำกัน
// → รีวิวพรีออเดอร์ชิ้นที่ 2 ชน) · ตั้งชื่อใหม่ไม่ให้ชนกับ index เดิมใน DB จริง — ลบของเดิมด้วย npm run migrate:reviews
reviewSchema.index(
  { order_item_id: 1 },
  { name: "uniq_active_order_item", unique: true, partialFilterExpression: { deleted_at: null, order_item_id: { $type: "objectId" } } }
);
reviewSchema.index(
  { preorder_order_item_id: 1 },
  { name: "uniq_active_preorder_item", unique: true, partialFilterExpression: { deleted_at: null, preorder_order_item_id: { $type: "objectId" } } }
);
reviewSchema.index({ status: 1, created_at: -1 });


const ReviewModel = 
  mongoose.models.Reviews || mongoose.model("Reviews", reviewSchema);

export default ReviewModel;