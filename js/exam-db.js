/* ============================================================
   exam-db.js — ค่าคงที่ใช้ร่วมกัน + Supabase client
   โหลดไฟล์นี้เป็นไฟล์แรกสุด
   ============================================================ */

const SUPABASE_URL = 'https://dbkhyhtnhwwqhibbsgce.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SG2sdbQteFee7G4L60WOew_o5CrLoVe';

// รหัส PIN 6 หลักสำหรับยืนยันการลบข้อสอบในโหมด Admin
const DELETE_PIN = '123456';

// Supabase client ใช้ร่วมกันทั้งแอป (ประกาศครั้งเดียวที่นี่)
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ฟังก์ชันสร้าง UUID ที่รองรับทั้ง Secure Context (HTTPS/localhost) และ Non-Secure Context (HTTP ผ่าน LAN IP เช่น 192.168.x.x)
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (e) {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// session id สำหรับ track history ของผู้ใช้เครื่องนี้ (ไม่ต้อง login)
const SESSION_ID = (() => {
  try {
    let s = localStorage.getItem('exam_session');
    if (!s) {
      s = generateUUID();
      localStorage.setItem('exam_session', s);
    }
    return s;
  } catch (e) {
    return generateUUID();
  }
})();

// ผู้ใช้ที่ล็อกอินอยู่ (ถูก set โดย app-auth.js)
let currentUser = null;

// แสดงการแจ้งเตือนแบบ Toast (ใช้ร่วมกันทุกหน้า)
var _toastTimer = null;
function showToast(msg, type = '') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (t) t.className = 'toast';
  }, 3000);
}

