// Placeholder หน้าแรก (เฟส 0)
// เฟส 5 จะแทนที่ด้วย logic redirect ตาม session:
//   verifySession(cookie) ? redirect("/owner/dashboard") : redirect("/login")
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-2 text-brown-900">
      <h1 className="text-xl font-medium">MeowMee Cake</h1>
      <p className="text-sm text-gray-500">ระบบจัดการร้าน — กำลังตั้งค่าโปรเจกต์ (เฟส 0)</p>
    </main>
  );
}
