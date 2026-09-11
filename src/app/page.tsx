// หน้าแรกแบบ static — บอกว่านี่คือ backend API
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.6 }}>
      <h1>🐱 MeowMeeCake API</h1>
      <p>Backend สำหรับร้าน MeowMeeCake — เข้าถึงผ่าน endpoint ใต้ <code>/api</code></p>
      <ul>
        <li><code>GET /api/health</code> — ตรวจสถานะระบบ + การเชื่อมต่อฐานข้อมูล</li>
        <li><code>GET /api/products</code>, <code>/api/orders</code>, <code>/api/ingredients</code> …</li>
      </ul>
    </main>
  );
}
