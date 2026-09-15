/* ============================================================
   serve.js — เซิร์ฟเวอร์เล็ก ๆ สำหรับทดสอบในเครื่อง
   ใช้:  node serve.js        แล้วเปิด http://localhost:8080
   หยุด: กด Ctrl+C

   ต้องรันผ่านเซิร์ฟเวอร์ ไม่ใช่ดับเบิลคลิก index.html
   เพราะการเปิดเป็น file:// จะทำให้เรียก Supabase ไม่ได้ (CORS)
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8080;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // กัน path traversal ออกจากโฟลเดอร์โปรเจกต์
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log(' เปิดเว็บทดสอบได้ที่:  http://localhost:' + PORT);
  console.log('');
  console.log('  บัญชีทดสอบ:');
  console.log('    admin / 123456   -> โหมดผู้ดูแลระบบ');
  console.log('    test  / 123456   -> โหมดผู้ใช้');
  console.log('');
  console.log('  กด Ctrl+C เพื่อหยุดเซิร์ฟเวอร์');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('พอร์ต ' + PORT + ' ถูกใช้อยู่ — ลองรันด้วยพอร์ตอื่น เช่น:  node serve.js 8081');
  } else {
    console.log('เกิดข้อผิดพลาด: ' + e.message);
  }
});
