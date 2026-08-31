import mongoose from "mongoose";

const unitSchema = new mongoose.Schema({
  unit_name: {
    type: String,
    required: true,
    unique: true,
  },
  unit_abbr: { //ตัวย่อหน่วย
    type: String,
    required: true,
    unique: true,
  },
  unit_type: { //ลิสต์สินค้าที่สามารถใช้หน่วยได้ เช่น หน่วยปริมาณของสูตรขนม หรือหน่วยนับของสินค้า
    type: String,
    required: true,
    enum: [
      "IngredientWeight", // น้ำหนักวัตถุดิบ เช่น กรัม, กิโลกรัม
      "IngredientVolume", // ปริมาตรวัตถุดิบ เช่น มิลลิลิตร, ลิตร
      "ProductWeight",    // น้ำหนักสินค้า
      "ProductVolume",    // ปริมาตรสินค้า
      "ProductCount",     // จำนวนชิ้นสินค้า
      "Package",          // หน่วยบรรจุ เช่น กล่อง, ถุง, แพ็ค
      "Sheet",            // แผ่น เช่น แผ่นเค้ก
      "Tray",             // ถาด
      "Slice",            // ชิ้นที่ตัดแบ่ง เช่น เค้ก
      "Piece",            // ชิ้นทั่วไป
      "Custom"            // หน่วยเฉพาะกิจ
    ],
  },
  usage_context: {
    type: [String], // ลิสต์ของประเภทที่สามารถใช้หน่วยนี้ได้ เช่น ["Ingredient", "Product"] หรือ ["Both"]
    required: true,
    enum: ["Ingredient", "Product", "Both"], // กำหนดว่าใช้กับวัตถุดิบ, สินค้า หรือทั้งสองอย่าง
  },
  deleted_at: {
      type: Date,
      default: null,
    },
  
},
  {
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
  }
);

const UnitModel = 
   mongoose.models.Units || mongoose.model("Units", unitSchema);

export default UnitModel;
