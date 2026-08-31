// aspectModel.ts
import mongoose from "mongoose";

const aspectSchema = new mongoose.Schema(
  {
    aspect_name_th: { type: String, required: true },
    aspect_name_eng: { type: String, required: true },
    aspect_desc: { type: String, default: null },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

const Aspect = mongoose.models.Aspects || mongoose.model("Aspects", aspectSchema);
export default Aspect;