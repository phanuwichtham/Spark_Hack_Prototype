# แก้ต้นแบบ

| งาน | ไฟล์ |
| --- | --- |
| แก้หน้าแรก | `index.html`, `assets/css/landing.css` |
| แก้โครงหน้าและฟอร์ม | HTML ที่รากโปรเจกต์และ JavaScript ชื่อเดียวกันใน `assets/js/pages/` |
| เปลี่ยนสี ตัวอักษร และเมนู | `assets/css/tokens.css`, `assets/css/layout.css`, `assets/js/app-shell.js` |
| แก้ข้อมูลและขั้นตอนเดโม | `assets/js/demo-data.js`, `assets/js/guided-demo.js` |
| แก้กฎความเสี่ยงและการขาย | `assets/js/risk-engine.js`, `assets/js/calculations.js`, `assets/js/domain.js` และ SQL migration สำหรับกลุ่ม |
| ตั้งค่าเชื่อมต่อกลุ่ม | `assets/js/database-config.js` ตาม [คู่มือ Supabase](database/README_TH.md) |

ค่าน้ำว่างจัดเก็บเป็น `null` เงินเก็บเป็นสตางค์ น้ำหนักเป็นกิโลกรัมทศนิยมไม่เกินสามตำแหน่ง ใช้ลิงก์แบบ relative เพื่อให้เปิดจากโฟลเดอร์ย่อยและ GitHub Pages ได้
