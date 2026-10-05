// searchSynonymModel.ts
// พจนานุกรมคำพ้องความหมายสำหรับระบบค้นหาสินค้า (แยกจาก semanticTermModel
// ซึ่งผูกกับ Aspects/Sentiment) — 1 เอกสาร = 1 คำหลัก + คำพ้องความหมายที่เกี่ยวข้อง
// ย้ายมาจาก backend ฝั่งลูกค้า (collection เดียวกัน · customer-backend-merge.md §8.16)
// รองรับทั้งไทยและอังกฤษในลิสต์เดียวกัน (เช่น term: "ช็อคโกแลต", synonyms: ["chocolate", "shokolat", "ชอคโกแลต"])
import mongoose from "mongoose";

const searchSynonymSchema = new mongoose.Schema(
  {
    term: { type: String, required: true, trim: true },
    synonyms: { type: [String], default: [] },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

searchSynonymSchema.index({ term: 1 });
searchSynonymSchema.index({ deleted_at: 1 });


const SearchSynonym =
  mongoose.models.SearchSynonyms || mongoose.model("SearchSynonyms", searchSynonymSchema);

export default SearchSynonym;
