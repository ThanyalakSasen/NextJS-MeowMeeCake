import mongoose from "mongoose";

const productCategorySchema = new mongoose.Schema({
  product_category_name: {
    type: String,
    required: true,
    unique: true,
  },
  deleted_at: {
    type: Date,
    default: null,  
  },},
  {
    timestamps: {  createdAt: "created_at", updatedAt: "updated_at" },
  });

const ProductCategoryModel =
  mongoose.models.ProductCategories ||
  mongoose.model("ProductCategories", productCategorySchema);


export default ProductCategoryModel;
