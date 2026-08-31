// cartModel.ts
import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

cartSchema.index({ user_id: 1 });

const Cart = mongoose.models.Carts || mongoose.model("Carts", cartSchema);
export default Cart;