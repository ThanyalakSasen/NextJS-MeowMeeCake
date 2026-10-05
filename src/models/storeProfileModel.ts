// storeProfileModel.ts
// ข้อมูลทั่วไปของร้าน (เอกสารเดียว - single-doc config) ใช้กับหน้า "จัดการข้อมูลร้านค้า"
// (ย้ายมาจาก backend ฝั่งลูกค้า — collection เดียวกัน) แยกจาก storeSettingsModel.ts (ที่อยู่ร้าน+พิกัด สำหรับรับเองที่ร้าน + ค่าจัดส่ง)
// โลโก้ร้าน: หลักเก็บไฟล์ผ่าน src/lib/upload.ts (โฟลเดอร์ store) แล้วเก็บ URL ใน logo_url (customer-backend-merge.md §8.19)
//   logo_url ว่าง = ยังไม่เคยอัปโหลดผ่านหลัก → ใช้ไฟล์เดิม /pictures/logoMoewMeeCake.png ของหน้าเว็บ
// เบอร์โทรหลัก/สำรอง: ไม่เก็บเป็น string แต่อ้างอิง user_id ไปที่ตาราง Users (ใช้ user_phone ของคนนั้น)
// อีเมลติดต่อร้าน (contact_email): ร้านตั้งเองได้ แสดงให้ลูกค้าเห็นที่หน้า "ติดต่อเรา"
// อีเมลที่ระบบใช้ส่งอีเมล: อ่านจาก process.env.EMAIL_USER ตรงๆ (read-only ในหน้านี้) ไม่เก็บในเอกสารนี้
import mongoose from "mongoose";

const businessHourDaySchema = new mongoose.Schema(
  {
    is_open: { type: Boolean, default: true },
    open_time: { type: String, default: "09:00" }, // "HH:mm"
    close_time: { type: String, default: "18:00" },
  },
  { _id: false }
);

// หน้าร้านประจำสัปดาห์ — หน้าร้านหลัก + จุดขายนอกร้านที่ไปออกเป็นประจำ (เช่น ถนนคนเดินทุกศุกร์-เสาร์)
// แสดงให้ลูกค้าเห็นที่หน้า /customer/contact-us และเป็น "จุดรับสินค้า" ตอน checkout แบบรับเอง (เฉพาะรายการที่ is_active)
// มี _id ประจำรายการ — ออเดอร์/พรีออเดอร์อ้างอิงจุดรับด้วย _id นี้ (ดู src/lib/pickupLocationsServer.ts)
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const weeklyMarketSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 }, // เช่น "ถนนคนเดินตลาดแคมของ"
    location: { type: String, default: "", trim: true, maxlength: 200 }, // รายละเอียดสถานที่/จุดสังเกต
    days: { type: [{ type: String, enum: WEEK_DAYS }], default: [] },
    open_time: { type: String, default: "17:00", match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // "HH:mm"
    close_time: { type: String, default: "22:00", match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    map_url: { type: String, default: "", trim: true }, // ลิงก์ Google Maps (ไม่บังคับ)
    is_active: { type: Boolean, default: true }, // ปิดไว้ = ไม่แสดงให้ลูกค้าเห็น (เช่น งดออกร้านชั่วคราว)
  }
);

const storeProfileSchema = new mongoose.Schema(
  {
    store_name: { type: String, default: "" },
    logo_url: { type: String, default: "" },
    // เวลาอัปโหลดโลโก้ล่าสุด — ใช้เป็น version ต่อท้าย URL โลโก้ ให้ cache รูปเก่าหมดผลทันที (ฝั่งลูกค้า src/lib/storeLogo.ts)
    logo_updated_at: { type: Date, default: null },
    cover_url: { type: String, default: "" },

    phone_primary_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },
    phone_secondary_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null },

    // อีเมลติดต่อร้าน — แยกจากบัญชีที่ระบบใช้ส่งอีเมล (EMAIL_USER) · ว่าง = ไม่แสดงให้ลูกค้าเห็น
    contact_email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },

    promptpay_id: { type: String, default: "" },
    promptpay_account_name: { type: String, default: "" },

    social_links: {
      facebook: { type: String, default: "" },
      line: { type: String, default: "" },
      instagram: { type: String, default: "" },
      website: { type: String, default: "" },
    },

    // เลิกใช้แล้ว — เวลาทำการถูกย้ายไปเป็นรายการ "หน้าร้าน" ใน weekly_markets (คงไว้เพื่ออ่านตอนย้ายข้อมูลครั้งแรก)
    business_hours: {
      mon: { type: businessHourDaySchema, default: () => ({}) },
      tue: { type: businessHourDaySchema, default: () => ({}) },
      wed: { type: businessHourDaySchema, default: () => ({}) },
      thu: { type: businessHourDaySchema, default: () => ({}) },
      fri: { type: businessHourDaySchema, default: () => ({}) },
      sat: { type: businessHourDaySchema, default: () => ({}) },
      sun: { type: businessHourDaySchema, default: () => ({}) },
    },

    weekly_markets: { type: [weeklyMarketSchema], default: [] },
    // true = ย้าย business_hours เข้า weekly_markets แล้ว (ทำครั้งเดียว — ดู ensureWeeklyMarketsReady)
    business_hours_migrated: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const StoreProfileModel = mongoose.models.StoreProfile || mongoose.model("StoreProfile", storeProfileSchema);

export default StoreProfileModel;
