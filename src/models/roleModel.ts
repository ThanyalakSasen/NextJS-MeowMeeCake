import mongoose from "mongoose";

const roleSchema = new mongoose.Schema({
  role_name: {
    type: String,
    required: true,
    unique: true,
  },
  role_type: {
    type: String,
    required: true,
    enum: ["admin", "staff", "customer"],
  },
  is_active: {
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
  }
);

const RoleModel = mongoose.models.Roles || mongoose.model("Roles", roleSchema);

export default RoleModel;
