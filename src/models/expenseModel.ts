import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "วัตถุดิบ",
        "บรรจุภัณฑ์",
        "ค่าจ้างแรงงาน",
        "ค่าสาธารณูปโภค",
        "ค่าเช่า",
        "ค่าการตลาด",
        "ค่าซ่อมบำรุง",
        "อื่นๆ",
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    payment_method: {
      type: String,
      enum: ["เงินสด", "โอนเงิน", "บัตรเครดิต", "QR Code"],
      required: true,
    },
    vendor: {
      type: String,
      default: "",
    },
    note: {
      type: String,
      default: "",
    },
    receipt_url: {
      type: String,
      default: null,
    },
    // ค่าใช้จ่ายประจำ (เช่น ค่าเช่า/ค่าไฟรายเดือน) — ฝั่ง frontend คำนวณวันครบกำหนดรอบถัดไปจาก date + 1 เดือน
    is_recurring: {
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
  }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ is_recurring: 1 });
expenseSchema.index({ deleted_at: 1 });

const Expense =
  mongoose.models.Expenses || mongoose.model("Expenses", expenseSchema);

export default Expense;
