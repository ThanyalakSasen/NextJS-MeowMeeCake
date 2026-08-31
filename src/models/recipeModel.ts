import mongoose from "mongoose";

const ingredientItemSchema = new mongoose.Schema(
  {
    ingredient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ingredients",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
  },
  { _id: false }
);

const componentItemSchema = new mongoose.Schema(
  {
    component_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Components",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
  },
  { _id: false }
);

const recipeSchema = new mongoose.Schema(
  {
    recipe_name: {
      type: String,
      required: true,
      trim: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Products",
      required: true,
    },
    yield_qty: {
      type: Number,
      required: true,
      min: 0,
    },
    yield_unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Units",
      required: true,
    },
    estimated_cost_per_batch: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    duration_minutes: {
      // เวลารวมโดยประมาณตั้งแต่เริ่มจนเสร็จ (นาที)
      type: Number,
      default: 0,
    },
    // เก็บขั้นตอนการทำเป็น JSON string ของ [{ order, title, description, durationMinutes }]
    // (ไม่แยก sub-document schema เพราะโครงสร้างขั้นตอนยืดหยุ่นและฝั่ง frontend เป็นคนกำหนดรูปแบบ)
    steps_content: {
      type: String,
      default: null,
    },
    note: {
      type: String,
      default: "",
    },
    ingredients: {
      type: [ingredientItemSchema],
      default: [],
    },
    components: {
      type: [componentItemSchema],
      default: [],
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

recipeSchema.index({ product_id: 1 });
recipeSchema.index({ created_by: 1 });
recipeSchema.index({ deleted_at: 1 });

const Recipe =
  mongoose.models.Recipes || mongoose.model("Recipes", recipeSchema);

export default Recipe;