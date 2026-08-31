import mongoose from "mongoose";

const productOptionSchema = new mongoose.Schema({
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Products",
    required: true,
  },
  option_name: {
    //ชื่อของตัวเลือก เช่น เขียนข้อความบนเค้ก หรือไม่เขียน
    type: String,
    required: true,
    trim: true,
  },
  is_text_input: {
    //ตัวเลือกนี้เป็นการกรอกข้อความเองหรือไม่ เช่น ถ้าเป็นการเขียนข้อความบนเค้ก อาจจะมีตัวเลือก "มีข้อความ" ที่ราคาเพิ่มขึ้น 50 บาท และตัวเลือก "ไม่มีข้อความ" ที่ราคาเพิ่มขึ้น 0 บาท แต่ถ้าเป็นการเพิ่มท็อปปิ้งบนเค้ก อาจจะมีตัวเลือก "ช็อกโกแลต" ที่ราคาเพิ่มขึ้น 20 บาท และตัวเลือก "สตรอเบอร์รี่" ที่ราคาเพิ่มขึ้น 30 บาท
    type: Boolean,
    default: false,
  },
  max_text_length: {
    //ถ้า is_text_input เป็น true จะใช้ field นี้ในการกำหนดความยาวสูงสุดของข้อความที่ลูกค้าสามารถกรอกได้ เช่น ถ้าเป็นการเขียนข้อความบนเค้ก อาจจะกำหนด max_text_length เป็น 20 เพื่อจำกัดให้ลูกค้ากรอกข้อความได้ไม่เกิน 20 ตัวอักษร
    type: Number,
    default: null, // null ถ้า option ไม่ใช่ text input
  },
  extra_price: {
    //ราคาที่เพิ่มขึ้นจากราคาสินค้าหลัก
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  is_required: {
    //ตัวเลือกนี้จำเป็นต้องเลือกหรือไม่ เช่น ถ้าเป็นการเขียนข้อความบนเค้ก อาจจะมีตัวเลือก "ไม่มีข้อความ" ที่ราคาเพิ่มขึ้น 0 บาท แต่ถ้าเป็นการเพิ่มข้อความบนเค้ก อาจจะมีตัวเลือก "มีข้อความ" ที่ราคาเพิ่มขึ้น 50 บาท และตัวเลือก "ไม่มีข้อความ" ที่ราคาเพิ่มขึ้น 0 บาท
    type: Boolean,
    default: false,
  },
  deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  });

productOptionSchema.index({ product_id: 1 });

const ProductOptionModel =
  mongoose.models.ProductOptions ||
  mongoose.model("ProductOptions", productOptionSchema);
export default ProductOptionModel;
