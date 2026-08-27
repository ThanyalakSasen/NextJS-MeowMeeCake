import mongoose from "mongoose";

const addressSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
  },
  house_no: { 
    type: String, 
    required: true 
  },
  sub_district: { 
    type: String, 
    required: true 
  },
  district: { 
    type: String, 
    required: true 
  },
  province: { 
    type: String, 
    required: true 
  },
  zip_code: { 
    type: String, 
    required: true 
  },
  is_default: { 
    type: Boolean, 
    default: false 
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

// ✅ pre-save hook: อัปเดต updated_at อัตโนมัติทุกครั้งที่ save()
addressSchema.pre("save", function () {
  if (!this.isNew) {
    this.updated_at = new Date();
  }
});

const AddressModel =
  mongoose.models.Addresses || mongoose.model("Addresses", addressSchema);

export default AddressModel;