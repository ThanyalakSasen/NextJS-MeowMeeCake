import mongoose from "mongoose";

const ingredientCategorySchema = new mongoose.Schema({
  ingredient_category_name: {
    type: String,
    required: true,
    unique: true,
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

const IngredientCategory = 
  mongoose.models.IngredientCategory || mongoose.model("IngredientCategory", ingredientCategorySchema);

export default IngredientCategory;
