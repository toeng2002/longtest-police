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

// session id สำหรับ track history ของผู้ใช้เครื่องนี้ (ไม่ต้อง login)
const SESSION_ID = (() => {
  let s = localStorage.getItem('exam_session');
  if (!s) {
    s = crypto.randomUUID();
    localStorage.setItem('exam_session', s);
  }
  return s;
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

