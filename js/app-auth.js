/* ============================================================
   app-auth.js — การเข้าสู่ระบบ / สลับโหมด / ออกจากระบบ
   ต้องโหลดหลัง exam-db.js

   หมายเหตุความปลอดภัย: ตาราง users เก็บรหัสผ่านเป็น bcrypt hash
   จึงตรวจรหัสผ่านด้วย bcrypt.compare ฝั่ง client (ใช้ bcryptjs)
   ============================================================ */

// แคชผู้ใช้ที่ล็อกอินอยู่ เพื่อไม่ต้องดึงรหัสผ่านจาก DB ไว้ในหน่วยความจำ
let _loginUser = null;

// hash แบบ bcrypt ขึ้นต้นด้วย $2a$ / $2b$ / $2y$
function isBcryptHash(s){
  return typeof s==='string' && /^\$2[aby]?\$/.test(s);
}

// เทียบรหัสผ่านที่พิมพ์ กับค่าที่เก็บในฐานข้อมูล (รองรับทั้ง bcrypt และ plaintext เดิม)
async function verifyPassword(plain, stored){
  if(stored==null) return false;
  if(isBcryptHash(stored)){
    const bcryptLib = (typeof dcodeIO!=='undefined' && dcodeIO.bcrypt) 
      ? dcodeIO.bcrypt 
      : (typeof bcrypt!=='undefined' ? bcrypt : null);

    if(!bcryptLib){
      console.error('ไม่พบไลบรารี bcryptjs — กรุณาตรวจสอบว่าโหลด script สำเร็จ');
      const err=document.getElementById('login-err');
      if(err){
        err.style.display='block';
        err.textContent='ไม่พบระบบตรวจสอบรหัสผ่าน (bcrypt) กรุณารีเฟรชหน้าเว็บ';
      }
      return false;
    }
    try{
      return await bcryptLib.compare(plain, stored);
    }catch(e){
      console.error('bcrypt compare error', e);
      return false;
    }
  }
  // เผื่อกรณียังไม่ได้ hash (ควรย้ายไป hash ให้หมด)
  return plain === stored;
}

async function doLogin(){
  const uEl=document.getElementById('inp-user');
  const pEl=document.getElementById('inp-pass');
  const err=document.getElementById('login-err');
  const btn=document.getElementById('btn-login');
  const u=uEl.value.trim();
  const p=pEl.value;

  if(!u||!p){
    err.style.display='block';
    err.textContent='กรุณากรอก Username และ Password';
    return;
  }

  btn.textContent='กำลังตรวจสอบ...';
  btn.disabled=true;
  err.style.display='none';

  try{
    // ใช้ ilike เพื่อรองรับกรณีคีย์บอร์ดมือถือพิมพ์ตัวใหญ่ตัวแรกอัตโนมัติ (เช่น Admin -> admin)
    const {data,error}=await supa
      .from('users')
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email')
      .ilike('username', u)
      .maybeSingle();

    if(error) throw error;

    if(!data){
      err.style.display='block';
      err.textContent='Username หรือ Password ไม่ถูกต้อง';
      return;
    }

    const ok=await verifyPassword(p, data.password);
    if(!ok){
      err.style.display='block';
      err.textContent='Username หรือ Password ไม่ถูกต้อง';
      return;
    }

    // ล็อกอินผ่าน — เก็บผู้ใช้และข้อมูลแพ็กเกจโดยไม่เก็บรหัสผ่านไว้
    currentUser={
      id: data.id,
      username: data.username,
      role: data.role,
      display_name: data.display_name,
      plan: data.plan || 'free',
      status: data.status || 'active',
      subscription_until: data.subscription_until || null,
      phone: data.phone || '',
      email: data.email || ''
    };
    _loginUser=currentUser;

    // เข้าโหมดตามสิทธิ์ (ห่อ try ไว้ ไม่ให้ error ของ UI กลบผลการ login)
    try{
      if(currentUser.role==='both'){
        showPickRole(currentUser);
      } else if(currentUser.role==='admin'){
        enterAdmin();
      } else {
        enterUser();
      }
    }catch(uiErr){
      console.error('สลับหน้าหลังล็อกอินไม่สำเร็จ', uiErr);
    }
  }catch(e){
    console.error('doLogin error', e);
    err.style.display='block';
    err.textContent='เชื่อมต่อฐานข้อมูลไม่ได้: ' + (e.message || 'กรุณาลองใหม่');
  }finally{
    btn.textContent='เข้าสู่ระบบ';
    btn.disabled=false;
  }
}

// role='both' → ให้เลือกว่าจะเข้าโหมดไหน
function showPickRole(user){
  document.getElementById('s-login').style.display='none';
  document.getElementById('user-layout').style.display='none';
  document.getElementById('admin-layout').style.display='none';
  const pr=document.getElementById('s-pick-role');
  pr.style.display='flex';
  const name=user.display_name||user.username;
  document.getElementById('role-greeting').textContent='สวัสดี, '+name;
  document.getElementById('role-avatar').textContent=name.charAt(0).toUpperCase();
}

function enterUser(){
  document.getElementById('s-login').style.display='none';
  document.getElementById('s-pick-role').style.display='none';
  document.getElementById('admin-layout').style.display='none';
  document.getElementById('user-layout').style.display='block';

  const name=currentUser?.display_name||currentUser?.username||'';
  const tb=document.getElementById('user-topbar-name');
  if(tb) tb.textContent=name;
  const sw=document.getElementById('switch-to-admin');
  if(sw) sw.style.display=(currentUser?.role==='both' || currentUser?.role==='admin')?'inline-flex':'none';

  // ห่อไว้เพื่อไม่ให้ข้อผิดพลาดของ UI ทำให้การ login ถูกเข้าใจผิดว่าล้มเหลว
  try {
    goHome();
  } catch (e) {
    console.error('enterUser UI error', e);
  }
}

function enterAdmin(){
  document.getElementById('s-login').style.display='none';
  document.getElementById('s-pick-role').style.display='none';
  document.getElementById('user-layout').style.display='none';
  document.getElementById('admin-layout').style.display='flex';

  const name=currentUser?.display_name||currentUser?.username||'admin';
  const an=document.getElementById('admin-username');
  if(an) an.textContent=name;
  const av=document.getElementById('admin-avatar');
  if(av) av.textContent=name.charAt(0).toUpperCase();

  // ห่อไว้เพื่อไม่ให้ข้อผิดพลาดของ UI ทำให้การ login ถูกเข้าใจผิดว่าล้มเหลว
  try {
    if(typeof goPage === 'function'){
      goPage('dashboard', document.querySelector('.nav-item'));
    } else {
      // หน้านี้ไม่มีระบบ Admin — แสดงข้อความให้ไปหน้าที่ถูกต้อง
      document.getElementById('admin-layout').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;padding:20px;text-align:center">' +
        '<div style="font-size:40px">🛡️</div>' +
        '<div style="font-size:16px;font-weight:600;color:#1A1A18">คุณมีสิทธิ์ Admin</div>' +
        '<div style="font-size:13px;color:#6B6B66">กรุณาเข้าใช้งานระบบจัดการข้อสอบผ่านหน้า Admin</div>' +
        '<a href="index.html" style="background:#2563EB;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">ไปหน้า Admin (ระบบหลัก) →</a>' +
        '<button onclick="doLogout()" style="background:transparent;border:1px solid #D0D0CA;border-radius:8px;padding:8px 20px;font-size:13px;color:#6B6B66;cursor:pointer">← ออกจากระบบ</button>' +
        '</div>';
    }
  } catch (e) {
    console.error('enterAdmin UI error', e);
  }

  // โหลดข้อมูลจริง (ฟังก์ชันอยู่ใน app-admin.js)
  if(typeof initAdminDashboard==='function') initAdminDashboard();
  if(typeof initQuestions==='function') initQuestions();
  if(typeof initChoicesForm==='function') initChoicesForm();
}

function doLogout(){
  currentUser=null;
  _loginUser=null;
  document.getElementById('s-pick-role').style.display='none';
  document.getElementById('user-layout').style.display='none';
  document.getElementById('admin-layout').style.display='none';
  document.getElementById('s-login').style.display='flex';
  document.getElementById('inp-user').value='';
  document.getElementById('inp-pass').value='';
  const err=document.getElementById('login-err');
  if(err) err.style.display='none';
}

// ล็อกอินด้วยปุ่ม Enter
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter') return;
  const loginVisible=document.getElementById('s-login').style.display!=='none';
  if(loginVisible) doLogin();
});

// ============================================================
// แสดงหน้า login ทันทีที่โหลดเสร็จ
// (ใน HTML ตั้ง display:none ไว้ กันหน้า login แวบขึ้นมาก่อนสคริปต์โหลด)
// ============================================================
function showLoginScreen(){
  const login = document.getElementById('s-login');
  const pick = document.getElementById('s-pick-role');
  const user = document.getElementById('user-layout');
  const admin = document.getElementById('admin-layout');
  if (pick) pick.style.display = 'none';
  if (user) user.style.display = 'none';
  if (admin) admin.style.display = 'none';
  if (login) login.style.display = 'flex';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showLoginScreen);
} else {
  showLoginScreen();
}

// ============================================================
// ฟังก์ชันตรวจสอบสิทธิ์และสถานะการต่ออายุ (Subscription Helpers)
// เตรียมพร้อมสำหรับระบบต่ออายุและจำกัดสิทธิ์ในอนาคต
// ============================================================
function isSubscriptionActive(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'both' || user.plan === 'vip') return true;
  if (!user.subscription_until) return false;
  return new Date(user.subscription_until) > new Date();
}

function getSubscriptionDaysRemaining(user) {
  if (!user || !user.subscription_until) return 0;
  const diff = new Date(user.subscription_until) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
