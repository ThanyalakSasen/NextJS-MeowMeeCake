import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema({
  banner_name: {
    type: String, //ชื่อแบนเนอร์ที่แสดงบนหน้าร้าน
    required: true,
    trim: true,
  },
  banner_description: {
    type: String, //คำอธิบายแบนเนอร์ที่แสดงบนหน้าร้าน
    required: false,
    trim: true,
    default: ''
  },
  banner_img: {
    type: String, // url ของรูปภาพ
    required: true,

  },
  banner_link: {
    type: String,
    required: false,
  },
  start_date: {
    // ว่าง = แสดงได้ทันที (ไม่ต้องรอกำหนดเวลา)
    type: Date,
    default: null,
  },
  end_date: {
    // ว่าง = ไม่มีวันหมดอายุ
    type: Date,
    default: null,
  },
  sort_order: {
    //ลำดับการแสดงผลของแบนเนอร์ ถ้ามีหลายแบนเนอร์จะเรียงตามลำดับนี้
    type: Number,
    required: true,
  },
  is_active: {
    //ยังมีการใช้แบนเนอร์นี้อยู่หรือไม่ ถ้าไม่มีก็จะไม่แสดงในระบบ แต่ข้อมูลยังคงอยู่ในฐานข้อมูล
    type: Boolean,
    default: true,
  },
  deleted_at: {
    //วันที่และเวลาที่ลบแบนเนอร์นี้ (ลบแบบนุ่มนวล)
    type: Date,
    default: null,
  },
}, {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
});

bannerSchema.index({ sort_order: 1, is_active: 1 });
bannerSchema.index({ deleted_at: 1 });

const BannerModel =
  mongoose.models.Banners ||
  mongoose.model("Banners", bannerSchema);

export default BannerModel;
