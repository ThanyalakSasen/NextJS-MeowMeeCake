/**
 * GET /api/health — ตรวจว่าระบบขึ้นและต่อ MongoDB ได้
 *   200 { ok: true }  เมื่อเชื่อมต่อฐานข้อมูลสำเร็จ
 *   503 { ok: false } เมื่อยังต่อไม่ได้
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";

const READY_STATE_LABEL: Record<number, string> = {
  0: "disconnected", // ไม่ได้เชื่อมต่อ
  1: "connected", // เชื่อมต่อแล้ว
  2: "connecting", // กำลังเชื่อมต่อ
  3: "disconnecting", // กำลังตัดการเชื่อมต่อ
};

export async function GET() {
  const ts = new Date().toISOString();
  try {
    await dbConnect();
    const state = mongoose.connection.readyState;
    const ok = state === 1;
    return NextResponse.json(
      { ok, db: READY_STATE_LABEL[state] ?? String(state), ts },
      { status: ok ? 200 : 503 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: "error", message: err instanceof Error ? err.message : String(err), ts },
      { status: 503 }
    );
  }
}
