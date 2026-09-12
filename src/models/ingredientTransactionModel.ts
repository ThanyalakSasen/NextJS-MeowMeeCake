import mongoose from "mongoose";

const ingredientTransactionSchema = new mongoose.Schema(
  {
    ingredient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ingredients",
      required: true,
    },
    type: {
      // use = เบิกใช้ (ลดสต็อก), receive = รับเข้า (เพิ่มสต็อก), adjust = ปรับยอดนับสต็อก
      type: String,
      enum: ["use", "receive", "adjust"],
      required: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 0,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
    note: {
      type: String,
      default: "",
    },
    po_ref: {
      // อ้างอิงใบสั่งซื้อ/ล็อต-แบทช์ (ถ้ามี) — ยังไม่มี PurchaseOrder model แยก จึงเก็บเป็นเลขที่อ้างอิงแบบข้อความไปก่อน
      type: String,
      default: null,
    },
    transaction_date: {
      // วันที่เบิกใช้/รับเข้า/ปรับสต็อกจริง — แยกจาก created_at (เวลาที่บันทึกรายการ) เผื่อย้อนหลังบันทึกทีหลัง
      type: Date,
      default: null,
    },
    expiry_date: {
      // วันหมดอายุของล็อต/แบทช์ที่รับเข้า — ใช้กับรายการ type "receive" เป็นหลัก
      type: Date,
      default: null,
    },
    performed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    // BACKLOG §2c.3 — back-ref ไปยังรายการผลิตที่สร้างธุรกรรมนี้ (consumeStock/reverseStock ใน
    // productionItemService) — null = ธุรกรรมที่บันทึกมือปกติ ไม่เกี่ยวกับการผลิต
    // มีไว้กัน voidTransaction() ย้อนรายการที่ผูกกับการผลิตแบบไม่รู้ตัว (ดู ingredientTransactionService)
    production_item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProductionItems",
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

ingredientTransactionSchema.index({ ingredient_id: 1, created_at: -1 });
ingredientTransactionSchema.index({ type: 1 });
ingredientTransactionSchema.index({ deleted_at: 1 });
ingredientTransactionSchema.index({ production_item_id: 1 });

const IngredientTransaction =
  mongoose.models.IngredientTransactions ||
  mongoose.model("IngredientTransactions", ingredientTransactionSchema);

export default IngredientTransaction;
