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
    if(typeof dcodeIO==='undefined' || !dcodeIO.bcrypt){
      console.error('ไม่พบไลบรารี bcryptjs — กรุณาตรวจสอบว่าโหลด script จาก CDN สำเร็จ');
      return false;
    }
    try{
      return await dcodeIO.bcrypt.compare(plain, stored);
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
    const {data,error}=await supa
      .from('users')
      .select('id, username, password, role, display_name')
      .eq('username', u)
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

    // ล็อกอินผ่าน — เก็บผู้ใช้โดยไม่เก็บรหัสผ่านไว้
    currentUser={ id:data.id, username:data.username, role:data.role, display_name:data.display_name };
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
    err.textContent='เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาลองใหม่';
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
  if(sw) sw.style.display=currentUser?.role==='both'?'inline-flex':'none';

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
    goPage('dashboard', document.querySelector('.nav-item'));
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
