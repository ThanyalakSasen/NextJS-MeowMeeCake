"use client";

import { App, ConfigProvider } from "antd";
import type { ThemeConfig } from "antd";
import thTH from "antd/locale/th_TH";
import dayjs from "dayjs";
import "dayjs/locale/th";

// ตั้ง locale ไทยให้ dayjs ครั้งเดียวตรงนี้ (ก่อนคอมโพเนนต์ไหนใน tree เรนเดอร์) กัน DatePicker/Calendar
// หน้าที่ยังไม่ได้ import "dayjs/locale/th" เอง แสดงเดือน/วันเป็นภาษาอังกฤษหลุดมาแวบหนึ่งตอนโหลดหน้าครั้งแรก
dayjs.locale("th");

// antd render ฟอนต์ของ Table/Select/Input/Button/Tag ฯลฯ ด้วย design token
// ของตัวเอง (ไม่ผ่านคลาส Tailwind text-*) ค่า default ของ antd คือ 14px/12px
// ซึ่งหลุดช่วง 14–22px ที่กำหนดไว้ใน src/app/globals.css (@theme)
// ตั้ง token ที่นี่ครั้งเดียวเพื่อให้ทุกคอมโพเนนต์ antd ทั้งแอปอยู่ในช่วงเดียวกัน
const theme: ThemeConfig = {
  token: {
    fontSize: 14, // ฐาน (ตรงกับ text-xs) — ทดลองลดจาก 16px
    fontSizeSM: 14, // เดิม 12px → ยกขึ้นเป็นขั้นต่ำ 14px
    fontSizeLG: 16,
    fontSizeXL: 18,
    fontSizeIcon: 14, // เดิม 12px → ไอคอนเล็ก เช่น ปุ่มปิด/ลูกศร select
    fontSizeHeading1: 22, // เพดานสูงสุดของทั้งโปรเจกต์
    fontSizeHeading2: 20,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,

    // ธีมสีน้ำตาล (Coffee) — สีหลักของแบรนด์ ให้คอมโพเนนต์ antd ที่ไม่ได้ครอบสี
    // ด้วย Tailwind (!bg-brown-800 ฯลฯ) เอง ใช้สีนี้แทนสีฟ้า default ของ antd ด้วย
    // เช่น Switch ตอนเปิด, focus ring, ปุ่ม type="primary" เปล่าๆ, ลิงก์
    colorPrimary: "#4B2E2B",
    colorPrimaryHover: "#603D2A",
    colorPrimaryActive: "#37201D",
    colorLink: "#7C4F35",
    colorLinkHover: "#4B2E2B",
  },
};

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    // locale={thTH} ทำให้ DatePicker/RangePicker/Calendar/Table ฯลฯ ของ antd ทั้งแอปเป็นภาษาไทย
    // (ชื่อเดือน/วันในสัปดาห์, ปุ่ม "วันนี้"/"ตอนนี้"/"ตกลง", ข้อความแบ่งหน้า ฯลฯ) — ก่อนหน้านี้ไม่ได้ตั้งไว้
    // เลยใช้ locale อังกฤษเป็นค่าเริ่มต้นของ antd อยู่ ทั้งที่ dayjs ตั้ง locale ไทยไว้แล้วในหลายหน้า
    <ConfigProvider theme={theme} locale={thTH}>
      {/* <App> ให้ theme ด้านบนนี้ส่งต่อไปถึง feedback component ของ antd ที่เหลืออยู่ (เช่น Popconfirm)
          popup แจ้งเตือน/ยืนยันหลักของทั้งโปรเจกต์ย้ายไปใช้ sweetalert2 แล้ว — ดู src/lib/alert.ts */}
      <App>{children}</App>
    </ConfigProvider>
  );
}
