// aspectModel.ts — แง่มุมของรีวิว (ราคา/รสชาติ/บรรจุภัณฑ์/อื่นๆ ...)
// ใช้ทั้งพจนานุกรม NLP (SemanticTerms) และฟอร์มรีวิวที่ลูกค้ากด "ชอบ" / "ควรปรับปรุง" ต่อแง่มุม (Reviews.aspect_feedback)
// is_active / display_order / icon / placeholder_text: backend ฝั่งลูกค้าเขียน collection เดียวกันอยู่แล้ว (customer-backend-merge.md §8.20)
import mongoose from "mongoose";

const aspectSchema = new mongoose.Schema(
  {
    aspect_name_th: { type: String, required: true },
    aspect_name_eng: { type: String, required: true },
    aspect_desc: { type: String, default: null },
    is_active: { type: Boolean, default: true }, // ปิด = ไม่แสดงในฟอร์มรีวิว (รีวิวเดิมยังนับได้)
    display_order: { type: Number, default: 0 }, // ลำดับในฟอร์มรีวิว (น้อยก่อน)
    icon: { type: String, default: null }, // key จาก src/lib/aspectIcons.ts · null = ค่าเริ่มต้นตามชื่ออังกฤษ
    placeholder_text: { type: String, default: null }, // ตัวอย่างข้อความในฟอร์มรีวิว
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// ชื่อไทยห้ามซ้ำในแง่มุมที่ยังไม่ถูกลบ (ไม่สนตัวพิมพ์เล็ก/ใหญ่ — collation strength 2) — กัน seed ชุดเริ่มต้นซ้ำเมื่อเรียกพร้อมกัน
// และเพิ่ม/แก้ชื่อชนกันพร้อมกัน (docs/BACKLOG5.md G5)
// ⚠️ ไม่ให้ mongoose สร้าง index นี้เองตอนเปิดแอป (autoIndex: false) — DB จริงอาจมีชื่อซ้ำอยู่แล้ว (backend ฝั่งลูกค้าเขียน collection
// เดียวกัน) → สร้างด้วย `npm run check:aspect-names -- --apply` หลังตรวจว่าไม่มีชื่อซ้ำ
export const ASPECT_NAME_INDEX = {
  name: "uniq_active_aspect_name_th",
  unique: true,
  partialFilterExpression: { deleted_at: null },
  collation: { locale: "en", strength: 2 },
} as const;
aspectSchema.index({ aspect_name_th: 1 }, ASPECT_NAME_INDEX);
aspectSchema.set("autoIndex", false);

const Aspect = mongoose.models.Aspects || mongoose.model("Aspects", aspectSchema);
export default Aspect;
