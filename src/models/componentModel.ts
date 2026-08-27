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

const componentSchema = new mongoose.Schema(
  {
    component_name: {
      type: String,
      required: true,
      trim: true,
    },
    componentcategory_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ComponentCategories",
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

componentSchema.index({ componentcategory_id: 1 });
componentSchema.index({ created_by: 1 });
componentSchema.index({ deleted_at: 1 });

const Component =
  mongoose.models.Components || mongoose.model("Components", componentSchema);

export default Component;