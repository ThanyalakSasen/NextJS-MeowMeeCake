// preorderRoundModel.ts
import mongoose from "mongoose";

const preorderRoundSchema = new mongoose.Schema(
  {
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true },
    round_name: { type: String, required: true, trim: true },
    open_date: { type: Date, required: true },
    close_date: { type: Date, required: true },
    pickup_date: { type: Date, required: true },
    round_status: { type: String, enum: ["open", "closed", "cancelled"], default: "open" },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

preorderRoundSchema.index({ round_status: 1 });
preorderRoundSchema.index({ open_date: 1, close_date: 1 });

const PreorderRound = mongoose.models.PreorderRounds || mongoose.model("PreorderRounds", preorderRoundSchema);
export default PreorderRound;