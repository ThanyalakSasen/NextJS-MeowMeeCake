import mongoose from "mongoose";

const sentimentResultSchema = new mongoose.Schema({
    review_id: { //รีวิวที่ผลการวิเคราะห์นี้เกี่ยวข้อง
        type: mongoose.Schema.Types.ObjectId,
        ref: "Reviews",
        required: true,
    },
    aspect_id: { //แง่มุมที่ผลการวิเคราะห์นี้เกี่ยวข้อง (เช่น รสชาติ, การบริการ, ความสะอาด เป็นต้น)
        type: mongoose.Schema.Types.ObjectId,
        ref: "Aspects",
        required: true,
    },
    sentiment_score: { //คะแนนความรู้สึกที่ได้จากการวิเคราะห์รีวิวนี้ (เช่น -1 ถึง 1 หรือ 0 ถึง 100)
        type: mongoose.Types.Decimal128,
        required: true,
    },
    sentiment_label: { //ป้ายกำกับความรู้สึกที่ได้จากการวิเคราะห์รีวิวนี้ (เช่น บวก, ลบ, กลาง เป็นต้น)
        type: String,
        required: true,
        enum: ["Positive", "Negative", "Neutral"],
    },
    sentiment_result: { //ผลการวิเคราะห์ความรู้สึกที่ได้จากรีวิวนี้ (เช่น ข้อความที่อธิบายว่าทำไมรีวิวนี้ถึงถูกจัดเป็นบวก, ลบ หรือกลาง)
        type: String,
        required: false,
    },
    extracted_aspects: [{ //แง่มุมที่ถูกดึงออกมาจากรีวิวนี้โดยระบบ (เช่น รสชาติ, การบริการ, ความสะอาด เป็นต้น)
        type: String,
        required: false,
    }],
    model_version: { //เวอร์ชันของโมเดลที่ใช้ในการวิเคราะห์รีวิวนี้ (เช่น v1, v2 เป็นต้น)
        type: String,
        required: false,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
},
{
    timestamps: { createdAt: "analyzed_at", updatedAt: "updated_at" },
});

sentimentResultSchema.index({ review_id: 1 });
sentimentResultSchema.index({ review_id: 1, aspect_id: 1 });
sentimentResultSchema.index({ sentiment_label: 1 });

const SentimentResultModel = 
  mongoose.models.SentimentResults ||   mongoose.model("SentimentResults", sentimentResultSchema);

export default SentimentResultModel;