import mongoose from "mongoose";

const componentCategorySchema = new mongoose.Schema({
  component_category_name: {
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

const ComponentCategory = 
  mongoose.models.ComponentCategory || mongoose.model("ComponentCategory", componentCategorySchema);

export default ComponentCategory;
