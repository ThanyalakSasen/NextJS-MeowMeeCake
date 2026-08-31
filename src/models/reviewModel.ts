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
    order_item_id : { //คำสั่งซื้อที่รีวิวนี้เกี่ยวข้อง
        type: mongoose.Schema.Types.ObjectId,
        ref: "OrderItems",
        required: true,
    },
    preorder_order_item_id : { //คำสั่งซื้อแบบพรีออร์เดอร์ที่รีวิวนี้เกี่ยวข้อง (ถ้ามี)
        type: mongoose.Schema.Types.ObjectId,
        ref: "PreOrderItems",
        required: false,
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
    is_analyzed: { //สถานะการวิเคราะห์รีวิวนี้โดยระบบ (เช่น วิเคราะห์ความรู้สึก, ตรวจจับคำหยาบคาย เป็นต้น)
        type: Boolean,
        default: false,
    },
    is_visible: { //สถานะการแสดงรีวิวนี้ในระบบ ถ้า false จะไม่แสดงให้ผู้ใช้เห็น แต่ข้อมูลยังคงอยู่ในฐานข้อมูล
        type: Boolean,
        default: true,
    },
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
reviewSchema.index({ order_item_id: 1 }, { sparse: true });
reviewSchema.index({ preorder_order_item_id: 1 }, { sparse: true });


const ReviewModel = 
  mongoose.models.Reviews || mongoose.model("Reviews", reviewSchema);

export default ReviewModel;