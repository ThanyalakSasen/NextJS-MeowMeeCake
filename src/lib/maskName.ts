// src/lib/maskName.ts — ย้ายมาจาก backend ฝั่งลูกค้า (customer-backend-merge.md §8.20)
// ซ่อนชื่อลูกค้าบางส่วนก่อนแสดงบนรีวิวสาธารณะ เช่น "สมชาย ใจดี" → "K. Som***"
export function maskCustomerName(fullName?: string | null): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "K. ลูกค้า";

  const firstWord = trimmed.split(/\s+/)[0];
  const visible = firstWord.slice(0, 3);
  const maskedLength = Math.max(firstWord.length - visible.length, 3);

  return `K. ${visible}${"*".repeat(maskedLength)}`;
}
