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
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions')
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
    const defaultAdminPerms = ['dashboard', 'questions', 'add_question', 'import_csv', 'settings', 'manage_users', 'test_exam'];
    let userPerms = data.permissions;
    if (!userPerms || !Array.isArray(userPerms)) {
      userPerms = defaultAdminPerms;
    }

    currentUser={
      id: data.id,
      username: data.username,
      role: data.role,
      display_name: data.display_name,
      plan: data.plan || 'free',
      status: data.status || 'active',
      subscription_until: data.subscription_until || null,
      phone: data.phone || '',
      email: data.email || '',
      permissions: userPerms
    };
    _loginUser=currentUser;

    // --- ระบบความปลอดภัย: จำกัด 1 ID เข้าใช้งานได้ 1 อุปกรณ์/IP ---
    try {
      const mySessionToken = typeof generateUUID === 'function' ? generateUUID() : ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
      sessionStorage.setItem('police_current_session_token', mySessionToken);
      
      // ดึง IP ปัจจุบัน (แบบจำกัดเวลาไม่เกิน 2 วิ)
      const clientIp = await getClientIP();
      sessionStorage.setItem('police_client_ip', clientIp);
      
      // บันทึกลง Supabase เพื่อให้เครื่องอื่นตรวจจับได้ทันที
      const { error: sessErr } = await supa
        .from('users')
        .update({
          current_session_token: mySessionToken,
          last_login_ip: clientIp,
          last_active_at: new Date().toISOString()
        })
        .eq('id', data.id);

      if (sessErr) {
        console.warn('บันทึก Session ล้มเหลว (อาจยังไม่ได้รัน setup_security.sql):', sessErr.message);
      }

      // เริ่มระบบเฝ้าระวัง: หากมีเครื่องอื่นล็อกอินซ้ำ จะดีดเครื่องนี้ออกทันที
      startActiveSessionWatcher(data.id, mySessionToken);
    } catch (secErr) {
      console.warn('เกิดข้อผิดพลาดในการตั้งค่า Session Security:', secErr);
    }

    // แสดงลายน้ำระบุตัวตนบนหน้าจอ
    if (typeof updateSecurityWatermark === 'function') {
      try { updateSecurityWatermark(); } catch (e) {}
    }

    // เข้าโหมดตามสิทธิ์ (ห่อ try ไว้ ไม่ให้ error ของ UI กลบผลการ login)
    try{
      if(currentUser.role==='both'){
        showPickRole(currentUser);
      } else if(currentUser.role==='admin' || currentUser.role==='superadmin'){
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

// ตรวจสอบสิทธิ์การเข้าถึงเมนู/ฟังก์ชัน (RBAC)
function hasPermission(permKey) {
  if (!currentUser) return false;
  if (currentUser.role === 'superadmin') return true;
  if (currentUser.role !== 'admin' && currentUser.role !== 'both') return false;
  if (!currentUser.permissions || !Array.isArray(currentUser.permissions)) {
    return true; // fallback ถ้าไม่ได้ระบุสิทธิ์
  }
  return currentUser.permissions.includes(permKey);
}

function enterUser(){
  // หากเป็น admin แต่ไม่ได้รับสิทธิ์ test_exam ให้ไม่อนุญาต
  if (currentUser?.role === 'admin' && !hasPermission('test_exam')) {
    if (typeof showToast === 'function') showToast('คุณไม่ได้รับสิทธิ์ในการทดสอบทำข้อสอบ', 'warn');
    enterAdmin();
    return;
  }

  document.getElementById('s-login').style.display='none';
  document.getElementById('s-pick-role').style.display='none';
  document.getElementById('admin-layout').style.display='none';
  document.getElementById('user-layout').style.display='block';

  const name=currentUser?.display_name||currentUser?.username||'';
  const tb=document.getElementById('user-topbar-name');
  if(tb) tb.textContent=name;
  const sw=document.getElementById('switch-to-admin');
  if(sw) sw.style.display=(currentUser?.role==='both' || currentUser?.role==='admin' || currentUser?.role==='superadmin')?'inline-flex':'none';

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

  const isSuper = currentUser?.role === 'superadmin';
  const roleText = isSuper ? 'ผู้ดูแลระบบสูงสุด — superadmin' : 'ผู้ดูแลระบบ — admin';
  const roleEl = document.querySelector('.sidebar-logo .role');
  if(roleEl) roleEl.textContent = roleText;
  const badgeEl = document.querySelector('.badge-admin');
  if(badgeEl){
    badgeEl.textContent = isSuper ? 'SUPER ADMIN' : 'ADMIN';
    badgeEl.style.background = isSuper ? '#dc2626' : '';
  }
  const topbarBadge = document.getElementById('admin-role-badge');
  if(topbarBadge){
    topbarBadge.textContent = isSuper ? 'SUPER ADMIN' : 'ADMIN';
    topbarBadge.style.background = isSuper ? '#fee2e2' : '#e2e8f0';
    topbarBadge.style.color = isSuper ? '#dc2626' : '#475569';
  }

  // แสดงหรือซ่อนเมนู Audit Log ตามสิทธิ์ (เฉพาะ superadmin เท่านั้น)
  const navAudit = document.getElementById('nav-audit-logs');
  if(navAudit){
    navAudit.style.display = isSuper ? 'flex' : 'none';
  }

  // ปรับการแสดงผลเมนู Sidebar และปุ่มสลับโหมดตามสิทธิ์ (RBAC)
  if (typeof applyAdminPermissions === 'function') {
    applyAdminPermissions();
  }

  // ห่อไว้เพื่อไม่ให้ข้อผิดพลาดของ UI ทำให้การ login ถูกเข้าใจผิดว่าล้มเหลว
  try {
    if (typeof goFirstAllowedAdminPage === 'function') {
      goFirstAllowedAdminPage();
    } else if (typeof goPage === 'function') {
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

  // โหลดข้อมูลจริงเฉพาะหน้าที่ได้รับสิทธิ์ (ฟังก์ชันอยู่ใน app-admin.js)
  if(typeof initAdminDashboard==='function' && hasPermission('dashboard')) initAdminDashboard();
  if(typeof initQuestions==='function' && hasPermission('questions')) initQuestions();
  if(typeof initChoicesForm==='function') initChoicesForm();
}

function doLogout(){
  stopActiveSessionWatcher();
  sessionStorage.removeItem('police_current_session_token');
  if (typeof updateSecurityWatermark === 'function') {
    try { updateSecurityWatermark(); } catch (e) {}
  }
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

// ============================================================
// ระบบจัดการ 1 ID ใช้งานได้ 1 อุปกรณ์ / 1 IP พร้อมดีดเครื่องเก่าทันที
// ============================================================
let _securityChannel = null;
let _securityHeartbeat = null;

async function getClientIP() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // ไม่ค้างเกิน 2 วิ
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const d = await res.json();
      return d.ip || 'unknown';
    }
  } catch (e) {}
  return 'unknown';
}

function startActiveSessionWatcher(userId, mySessionToken) {
  stopActiveSessionWatcher();

  // 1) Realtime Listener จาก Supabase (เด้งทันทีระดับเสี้ยววินาที)
  try {
    if (typeof supa.channel === 'function') {
      const chanName = 'sess-watch-' + userId + '-' + Math.floor(Math.random() * 10000);
      _securityChannel = supa
        .channel(chanName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: 'id=eq.' + userId
          },
          (payload) => {
            const newRow = payload.new;
            if (newRow && newRow.current_session_token && newRow.current_session_token !== mySessionToken) {
              console.warn('ตรวจพบการเข้าสู่ระบบจากอุปกรณ์อื่น (Realtime Kick)');
              triggerForcedLogout(newRow.last_login_ip);
            }
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('Realtime Single-Session Monitor: Active');
          }
        });
    }
  } catch (rtErr) {
    console.warn('Supabase Realtime not available, fallback to heartbeat', rtErr);
  }

  // 2) Heartbeat Polling ตรวจสอบซ้ำทุก 15 วินาที (ป้องกันกรณีหลุดการเชื่อมต่อ Realtime บนมือถือ)
  _securityHeartbeat = setInterval(async () => {
    if (!currentUser || currentUser.id !== userId) {
      stopActiveSessionWatcher();
      return;
    }
    try {
      const { data, error } = await supa
        .from('users')
        .select('current_session_token, last_login_ip')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data && data.current_session_token && data.current_session_token !== mySessionToken) {
        console.warn('ตรวจพบการเข้าสู่ระบบจากอุปกรณ์อื่น (Heartbeat Kick)');
        triggerForcedLogout(data.last_login_ip);
      }
    } catch (e) {}
  }, 15000);
}

function stopActiveSessionWatcher() {
  if (_securityChannel) {
    try { supa.removeChannel(_securityChannel); } catch (e) {}
    _securityChannel = null;
  }
  if (_securityHeartbeat) {
    clearInterval(_securityHeartbeat);
    _securityHeartbeat = null;
  }
}

function triggerForcedLogout(newIp) {
  stopActiveSessionWatcher();
  sessionStorage.removeItem('police_current_session_token');
  doLogout();
  showForcedLogoutModal(newIp);
}

function showForcedLogoutModal(newIp) {
  let m = document.getElementById('modal-forced-logout');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-forced-logout';
    m.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 100000;
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    `;
    m.innerHTML = `
      <div style="background: #ffffff; border-radius: 18px; padding: 28px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35); border: 1px solid #e2e8f0; font-family: 'Sarabun', system-ui, sans-serif;">
        <div style="font-size: 48px; margin-bottom: 12px; line-height: 1;">⚡</div>
        <div style="font-size: 17px; font-weight: 700; color: #dc2626; margin-bottom: 8px;">มีการเข้าสู่ระบบจากอุปกรณ์อื่น</div>
        <div id="forced-logout-desc" style="font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 22px;">
          บัญชีของคุณได้ถูกเข้าสู่ระบบจากเครื่องอื่น ระบบจึงได้นำคุณออกจากระบบในอุปกรณ์นี้ เพื่อความปลอดภัย
        </div>
        <button onclick="closeForcedLogoutModal()" style="background: #2563eb; color: #ffffff; border: none; border-radius: 10px; padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; box-shadow: 0 4px 6px -1px rgba(37,99,235,0.25);">
          รับทราบและกลับสู่หน้าล็อกอิน
        </button>
      </div>
    `;
    document.body.appendChild(m);
  }
  const desc = document.getElementById('forced-logout-desc');
  if (desc) {
    desc.innerHTML = `บัญชีของคุณได้ถูกเข้าสู่ระบบจากอุปกรณ์อื่น หรือเบราว์เซอร์อื่น${newIp && newIp !== 'unknown' ? '<br>(IP ล่าสุด: <b>' + newIp + '</b>)' : ''}<br>ระบบจึงได้นำคุณออกจากระบบโดยอัตโนมัติ เพื่อป้องกันการใช้งานซ้อนกัน`;
  }
  m.style.display = 'flex';
}

function closeForcedLogoutModal() {
  const m = document.getElementById('modal-forced-logout');
  if (m) m.style.display = 'none';
  showLoginScreen();
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
  if (user.role === 'admin' || user.role === 'superadmin' || user.role === 'both' || user.plan === 'vip') return true;
  if (!user.subscription_until) return false;
  return new Date(user.subscription_until) > new Date();
}

function getSubscriptionDaysRemaining(user) {
  if (!user || !user.subscription_until) return 0;
  const diff = new Date(user.subscription_until) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
