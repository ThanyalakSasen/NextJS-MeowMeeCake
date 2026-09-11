import { describe, it, expect, vi } from "vitest";
import { Saga } from "@/lib/compensation";

describe("Saga", () => {
  it("rollback รัน undo แบบย้อนลำดับ (ขั้นล่าสุดก่อน)", async () => {
    const order: string[] = [];
    const saga = new Saga();
    saga.onRollback("a", async () => void order.push("a"));
    saga.onRollback("b", async () => void order.push("b"));
    saga.onRollback("c", async () => void order.push("c"));

    await saga.rollback();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("commit → rollback ไม่ทำอะไร", async () => {
    const undo = vi.fn(async () => {});
    const saga = new Saga();
    saga.onRollback("x", undo);
    saga.commit();
    await saga.rollback();
    expect(undo).not.toHaveBeenCalled();
    expect(saga.size).toBe(0);
  });

  it("undo ที่ throw → ไม่ทำให้ rollback ล้ม, ขั้นอื่นยังรัน", async () => {
    const ran: string[] = [];
    const saga = new Saga();
    saga.onRollback("ok1", async () => void ran.push("ok1"));
    saga.onRollback("boom", async () => {
      throw new Error("undo failed");
    });
    saga.onRollback("ok2", async () => void ran.push("ok2"));

    await expect(saga.rollback()).resolves.toBeUndefined();
    expect(ran).toEqual(["ok2", "ok1"]); // boom ถูกข้าม, ที่เหลือรันครบ (ย้อนลำดับ)
  });

  it("rollback ล้าง step แล้ว — เรียกซ้ำไม่รันอีก", async () => {
    const undo = vi.fn(async () => {});
    const saga = new Saga();
    saga.onRollback("x", undo);
    await saga.rollback();
    await saga.rollback();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(saga.size).toBe(0);
  });

  it("size สะท้อนจำนวน undo ที่ค้าง", () => {
    const saga = new Saga();
    expect(saga.size).toBe(0);
    saga.onRollback("a", async () => {});
    saga.onRollback("b", async () => {});
    expect(saga.size).toBe(2);
  });
});
