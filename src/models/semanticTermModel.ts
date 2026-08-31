// semanticTermModel.ts
import mongoose from "mongoose";

const semanticTermSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true },
    synonyms: { type: [String], default: [] },
    aspect_id: { type: mongoose.Schema.Types.ObjectId, ref: "Aspects", required: true },
    product_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

semanticTermSchema.index({ aspect_id: 1 });
semanticTermSchema.index({ term: 1 });

const SemanticTerm = mongoose.models.SemanticTerms || mongoose.model("SemanticTerms", semanticTermSchema);
export default SemanticTerm;