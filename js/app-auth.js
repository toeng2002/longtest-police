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

    // ล็อกอินผ่าน — บันทึกข้อมูลและสลับหน้า
    await completeLoginSuccess(data);
  }catch(e){
    console.error('doLogin error', e);
    err.style.display='block';
    err.textContent='เชื่อมต่อฐานข้อมูลไม่ได้: ' + (e.message || 'กรุณาลองใหม่');
  }finally{
    btn.textContent='เข้าสู่ระบบ';
    btn.disabled=false;
  }
}

// ฟังก์ชันบันทึก Session และเริ่มต้นสถานะผู้ใช้ (ใช้ร่วมกันทั้ง Username/Password และ Google OAuth)
async function completeLoginSuccess(data){
  if (!data) return;

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
    permissions: userPerms,
    auth_id: data.auth_id || null,
    avatar_url: data.avatar_url || null
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

  // ซ่อนหน้า login
  const login = document.getElementById('s-login');
  if (login) login.style.display = 'none';

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

  if (typeof updateUserAvatarUI === 'function') {
    try { updateUserAvatarUI(); } catch (avErr) { console.warn('updateUserAvatarUI error:', avErr); }
  }

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

  if (typeof updateUserAvatarUI === 'function') {
    try { updateUserAvatarUI(); } catch (avErr) {}
  }

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

  // ออกจากระบบ Supabase Auth ด้วย (หากล็อกอินผ่าน Google)
  try {
    if (supa && supa.auth) {
      supa.auth.signOut().catch(() => {});
    }
  } catch (e) {}

  document.getElementById('s-pick-role').style.display='none';
  document.getElementById('user-layout').style.display='none';
  document.getElementById('admin-layout').style.display='none';
  document.getElementById('s-login').style.display='flex';
  document.getElementById('inp-user').value='';
  document.getElementById('inp-pass').value='';
  const err=document.getElementById('login-err');
  if(err) err.style.display='none';
  const gBtn = document.getElementById('btn-google-login');
  const gTxt = document.getElementById('btn-google-text');
  if(gBtn) gBtn.disabled = false;
  if(gTxt) gTxt.textContent = 'เข้าสู่ระบบด้วย Google';
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
let _isOAuthProcessing = false;

function showLoginScreen(){
  if (currentUser || _isOAuthProcessing) return;
  const login = document.getElementById('s-login');
  const pick = document.getElementById('s-pick-role');
  const user = document.getElementById('user-layout');
  const admin = document.getElementById('admin-layout');
  if (pick) pick.style.display = 'none';
  if (user) user.style.display = 'none';
  if (admin) admin.style.display = 'none';
  if (login) login.style.display = 'flex';
}

// ============================================================
// ระบบเข้าสู่ระบบด้วย Google (Google OAuth 2.0 via Supabase)
// ============================================================

function showOAuthLoading(msg) {
  let el = document.getElementById('oauth-loading-box');
  if (!el) {
    el = document.createElement('div');
    el.id = 'oauth-loading-box';
    el.style.cssText = 'background:var(--accent-bg);border:1px solid var(--accent-border);border-radius:var(--r);padding:12px 14px;font-size:13px;color:var(--accent);text-align:center;margin-bottom:14px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:10px';
    const loginCard = document.querySelector('#s-login > div');
    const loginErr = document.getElementById('login-err');
    if (loginErr && loginErr.parentNode) {
      loginErr.parentNode.insertBefore(el, loginErr.nextSibling);
    } else if (loginCard) {
      loginCard.prepend(el);
    }
  }
  el.innerHTML = '<span style="font-size:16px">🔄</span> ' + (msg || 'กำลังเข้าสู่ระบบด้วย Google กรุณารอสักครู่...');
  el.style.display = 'flex';
  
  const btn = document.getElementById('btn-google-login');
  if (btn) btn.style.display = 'none';
}

function hideOAuthLoading() {
  const el = document.getElementById('oauth-loading-box');
  if (el) el.style.display = 'none';
  const btn = document.getElementById('btn-google-login');
  if (btn) btn.style.display = 'flex';
}

async function loginWithGoogle() {
  const btn = document.getElementById('btn-google-login');
  const txt = document.getElementById('btn-google-text');
  const err = document.getElementById('login-err');
  if (err) err.style.display = 'none';

  if (!navigator.onLine) {
    if (err) {
      err.style.display = 'block';
      err.textContent = 'ไม่พบสัญญาณอินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อ';
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'กำลังเชื่อมต่อ Google...';

  try {
    const redirectUrl = window.location.origin + window.location.pathname;
    const { data, error } = await supa.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account'
        }
      }
    });

    if (error) throw error;
    // เบราว์เซอร์จะ redirect ไปยังหน้า OAuth ของ Google
  } catch (e) {
    console.error('Google login error:', e);
    if (err) {
      err.style.display = 'block';
      err.textContent = 'เชื่อมต่อ Google ไม่สำเร็จ: ' + (e.message || 'กรุณาลองใหม่อีกครั้ง');
    }
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = 'เข้าสู่ระบบด้วย Google';
  }
}

async function syncAndLoginOAuthUser(authUser) {
  if (!authUser) return;
  try {
    showOAuthLoading('กำลังซิงค์ข้อมูลบัญชีผู้ใช้...');

    // 1) ค้นหาด้วย auth_id ก่อน
    let { data: userRow, error: qErr } = await supa
      .from('users')
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url')
      .eq('auth_id', authUser.id)
      .maybeSingle();

    if (qErr) {
      console.warn('ค้นหา auth_id ไม่สำเร็จ:', qErr);
    }

    // ตรวจสอบว่ามีข้อมูลค้างจากการสมัครสมาชิก (Pending Register) หรือ รีเซ็ตรหัสผ่าน (Pending Reset) หรือไม่
    const pendingRaw = localStorage.getItem('police_pending_register');
    let pendingReg = null;
    try { pendingReg = pendingRaw ? JSON.parse(pendingRaw) : null; } catch(e){}

    const resetRaw = localStorage.getItem('police_pending_reset');
    let pendingReset = null;
    try { pendingReset = resetRaw ? JSON.parse(resetRaw) : null; } catch(e){}

    // ตรวจจับ Reset Flow จากทุกช่องทาง:
    // 1) Flag จาก initGoogleAuth / onAuthStateChange (event === 'PASSWORD_RECOVERY')
    // 2) URL hash มี type=recovery
    // 3) URL search มี type=recovery หรือ flow=reset_password
    // 4) localStorage มี police_pending_reset
    // 5) authUser user_metadata มี pending_reset_flow
    const isResetFlow = Boolean(
      window._isPasswordRecoveryFlow ||
      (window.location.hash && (window.location.hash.includes('type=recovery') || window.location.hash.includes('flow=reset_password'))) ||
      (window.location.search && (window.location.search.includes('type=recovery') || window.location.search.includes('flow=reset_password'))) ||
      (pendingReset && pendingReset.flow === 'reset_password') ||
      authUser.user_metadata?.pending_reset_flow
    );

    // 2) ถ้าไม่เจอด้วย auth_id ให้ค้นหาด้วย email หรือ reset_user_id (กรณีเป็นผู้ใช้เดิม หรือ ยืนยันอีเมล)
    if (!userRow && authUser.email) {
      const { data: emailMatch } = await supa
        .from('users')
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url')
        .ilike('email', authUser.email)
        .maybeSingle();

      if (emailMatch) {
        userRow = emailMatch;
      }
    }

    if (!userRow && (authUser.user_metadata?.reset_user_id || pendingReset?.id)) {
      const targetId = authUser.user_metadata?.reset_user_id || pendingReset?.id;
      const { data: idMatch } = await supa
        .from('users')
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url')
        .eq('id', targetId)
        .maybeSingle();

      if (idMatch) {
        userRow = idMatch;
      }
    }

    if (userRow) {
      try {
        const updObj = {
          auth_id: authUser.id,
          avatar_url: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || userRow.avatar_url || null
        };
        await supa.from('users').update(updObj).eq('id', userRow.id);
        userRow.auth_id = authUser.id;
      } catch (linkErr) {
        console.warn('เชื่อมต่อ auth_id กับบัญชีเดิมไม่สำเร็จ:', linkErr);
      }
    }

    // ถ้าเป็นการรีเซ็ตรหัสผ่าน -> เปิดหน้า Step 3 ให้ตั้งรหัสผ่านใหม่ทันที (ห้ามล็อกอินเด็ดขาด!)
    if (isResetFlow) {
      window._isPasswordRecoveryFlow = false;
      localStorage.removeItem('police_pending_reset');
      hideOAuthLoading();
      _isOAuthProcessing = false;
      try {
        supa.auth.updateUser({ data: { pending_reset_flow: null, reset_user_id: null } }).catch(() => {});
      } catch (mErr) {}
      if (window.location.hash) {
        try { history.replaceState(null, '', window.location.pathname); } catch (hErr) {}
      }
      if (window.location.search) {
        try { history.replaceState(null, '', window.location.pathname); } catch (sErr) {}
      }
      if (userRow) {
        openForgotStep3(userRow);
      } else {
        const targetId = pendingReset?.id;
        const targetEmail = authUser.email || pendingReset?.email;
        let foundUser = null;
        if (targetId) {
          const { data } = await supa.from('users').select('id, username, email').eq('id', targetId).maybeSingle();
          foundUser = data;
        }
        if (!foundUser && targetEmail) {
          const { data } = await supa.from('users').select('id, username, email').ilike('email', targetEmail).maybeSingle();
          foundUser = data;
        }
        if (foundUser) {
          openForgotStep3(foundUser);
        } else {
          const errEl = document.getElementById('login-err');
          if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = 'ไม่พบบัญชีผู้ใช้งานที่ต้องการรีเซ็ตรหัสผ่าน กรุณาเริ่มใหม่อีกครั้ง';
          }
        }
      }
      return; // สำคัญมาก: หยุดการทำงานทันที ไม่ให้ไปถึงคำสั่ง completeLoginSuccess ด้านล่าง
    }

    // 3) ถ้ายังไม่มีในระบบเลย -> ลงทะเบียนให้อัตโนมัติ (Auto-register จาก Google หรือ Email Confirmation)
    let isNewRegistration = false;
    let isPasswordReset = false;

    if (!userRow) {
      showOAuthLoading('กำลังสร้างบัญชีผู้ใช้ใหม่...');
      let newUsername = '';
      let displayName = '';
      let userPassword = null;
      let userPhone = '';

      if (pendingReg && pendingReg.email && authUser.email && pendingReg.email.toLowerCase() === authUser.email.toLowerCase()) {
        newUsername = pendingReg.username;
        displayName = pendingReg.displayName || pendingReg.username;
        userPassword = pendingReg.password;
        userPhone = pendingReg.phone || '';
        isNewRegistration = true;
      } else if (authUser.user_metadata?.pending_username) {
        newUsername = authUser.user_metadata.pending_username;
        displayName = authUser.user_metadata.pending_display_name || newUsername;
        userPassword = authUser.user_metadata.pending_password || null;
        userPhone = authUser.user_metadata.pending_phone || '';
        isNewRegistration = true;
      } else {
        const emailPrefix = (authUser.email ? authUser.email.split('@')[0] : 'user').replace(/[^a-zA-Z0-9_]/g, '_');
        const randomSuffix = Math.random().toString(36).substring(2, 6);
        newUsername = (emailPrefix.substring(0, 15) + '_' + randomSuffix).toLowerCase();
        displayName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || emailPrefix;
      }

      const avatarUrl = authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null;

      const newUserObj = {
        username: newUsername,
        display_name: displayName,
        email: authUser.email || '',
        phone: userPhone,
        password: userPassword,
        auth_id: authUser.id,
        avatar_url: avatarUrl,
        role: 'user',
        plan: 'free',
        status: 'active',
        permissions: []
      };

      const { data: createdUser, error: insertErr } = await supa
        .from('users')
        .insert([newUserObj])
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url')
        .single();

      if (insertErr) {
        console.error('ลงทะเบียนผู้ใช้ใหม่อัตโนมัติไม่สำเร็จ:', insertErr);
        hideOAuthLoading();
        _isOAuthProcessing = false;
        const errEl = document.getElementById('login-err');
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = 'ไม่สามารถสร้างบัญชีผู้ใช้ใหม่ได้: ' + (insertErr.message || 'โปรดติดต่อผู้ดูแลระบบ');
        }
        return;
      }
      userRow = createdUser;
    }

    // ล้าง pending state
    localStorage.removeItem('police_pending_register');
    localStorage.removeItem('police_pending_reset');

    // ปิดโมดัลที่อาจเปิดค้างอยู่
    if (typeof closeRegisterModal === 'function') closeRegisterModal();
    if (typeof closeForgotPasswordModal === 'function') closeForgotPasswordModal();

    // ล้าง URL hash และ search หลังล็อกอินสำเร็จ เพื่อให้ URL สวยงามและไม่ค้าง token
    if (window.location.hash && (window.location.hash.includes('access_token') || window.location.hash.includes('error'))) {
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (hErr) {}
    }
    if (window.location.search && (window.location.search.includes('code=') || window.location.search.includes('error='))) {
      try {
        history.replaceState(null, '', window.location.pathname);
      } catch (sErr) {}
    }

    hideOAuthLoading();
    _isOAuthProcessing = false;

    if (isNewRegistration && typeof showToast === 'function') {
      showToast('🎉 ยืนยันอีเมลสำเร็จ! บัญชีของคุณถูกสร้างเรียบร้อยแล้ว ยินดีต้อนรับ', 'success');
    } else if (isPasswordReset && typeof showToast === 'function') {
      showToast('🔑 ยืนยันอีเมลและเปลี่ยนรหัสผ่านใหม่เรียบร้อยแล้ว!', 'success');
    }

    await completeLoginSuccess(userRow);
  } catch (err) {
    console.error('syncAndLoginOAuthUser error:', err);
    hideOAuthLoading();
    _isOAuthProcessing = false;
    const errEl = document.getElementById('login-err');
    if (errEl) {
      errEl.style.display = 'block';
      errEl.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง');
    }
  }
}

async function initGoogleAuth() {
  try {
    if (!supa || !supa.auth) return;

    // ตรวจสอบว่า URL มีพารามิเตอร์ OAuth callback หรือไม่
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const isRecoveryUrl = hash.includes('type=recovery') || search.includes('type=recovery') || hash.includes('flow=reset_password') || search.includes('flow=reset_password');
    if (isRecoveryUrl) {
      window._isPasswordRecoveryFlow = true;
    }
    const hasOAuthParams = hash.includes('access_token') || hash.includes('refresh_token') || search.includes('code=') || isRecoveryUrl;
    const hasOAuthError = hash.includes('error') || search.includes('error=');

    if (hasOAuthError) {
      const urlParams = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : search);
      const errDesc = urlParams.get('error_description') || urlParams.get('error') || 'การยืนยันตัวตนล้มเหลว';
      const errEl = document.getElementById('login-err');
      if (errEl) {
        errEl.style.display = 'block';
        errEl.textContent = 'การยืนยันตัวตน: ' + decodeURIComponent(errDesc.replace(/\+/g, ' '));
      }
      history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (hasOAuthParams) {
      _isOAuthProcessing = true;
      showOAuthLoading(window._isPasswordRecoveryFlow ? 'กำลังตรวจสอบการขอตั้งรหัสผ่านใหม่...' : 'กำลังยืนยันตัวตน กรุณารอสักครู่...');
    }

    // 1) ลงทะเบียน listener ดักฟังเหตุการณ์การเปลี่ยนสถานะ Auth ก่อนเสมอ
    supa.auth.onAuthStateChange(async (event, session) => {
      console.log('Supabase Auth Event:', event, session ? session.user?.email : 'no-session');
      if (event === 'PASSWORD_RECOVERY') {
        window._isPasswordRecoveryFlow = true;
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') && session && session.user) {
        if (!currentUser || currentUser.auth_id !== session.user.id || window._isPasswordRecoveryFlow) {
          _isOAuthProcessing = true;
          await syncAndLoginOAuthUser(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        hideOAuthLoading();
        _isOAuthProcessing = false;
      }
    });

    // 2) ตรวจสอบ getSession() ซ้ำ
    const { data: { session }, error } = await supa.auth.getSession();
    if (error) {
      console.warn('supa.auth.getSession error:', error);
      hideOAuthLoading();
      _isOAuthProcessing = false;
      return;
    }

    if (session && session.user) {
      if (!currentUser || currentUser.auth_id !== session.user.id || window._isPasswordRecoveryFlow) {
        _isOAuthProcessing = true;
        await syncAndLoginOAuthUser(session.user);
      }
    } else if (!hasOAuthParams) {
      hideOAuthLoading();
      _isOAuthProcessing = false;
    }
  } catch (e) {
    console.warn('initGoogleAuth error:', e);
    hideOAuthLoading();
    _isOAuthProcessing = false;
  }
}

function initAppAuth() {
  showLoginScreen();
  initGoogleAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAppAuth);
} else {
  initAppAuth();
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

// ============================================================
// ระบบสมัครสมาชิกใหม่ (Register) & ลืมรหัสผ่าน (Forgot Password) ด้วย Email OTP
// ============================================================

let _regPendingData = null;
let _regTimer = null;
let _regCountdown = 60;
let _devRegOtp = null;

let _forgotPendingData = null;
let _forgotTimer = null;
let _forgotCountdown = 60;
let _devForgotOtp = null;

function hashPassword(plain) {
  const bcryptLib = (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt)
    ? dcodeIO.bcrypt
    : (typeof bcrypt !== 'undefined' ? bcrypt : null);
  if (bcryptLib && typeof bcryptLib.hashSync === 'function') {
    try {
      return bcryptLib.hashSync(plain, 10);
    } catch(e) {
      console.warn('hashSync failed:', e);
    }
  }
  return plain;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const parts = email.split('@');
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) {
    return name.charAt(0) + '***@' + domain;
  }
  return name.charAt(0) + '***' + name.charAt(name.length - 1) + '@' + domain;
}

// ------------------------------------------------------------
// สมัครสมาชิกใหม่ (Register Flow)
// ------------------------------------------------------------
function openRegisterModal() {
  const modal = document.getElementById('modal-register');
  if (!modal) return;
  
  // รีเซ็ตค่าฟอร์ม
  const elU = document.getElementById('reg-username'); if (elU) elU.value = '';
  const elD = document.getElementById('reg-display-name'); if (elD) elD.value = '';
  const elE = document.getElementById('reg-email'); if (elE) elE.value = '';
  const elP = document.getElementById('reg-phone'); if (elP) elP.value = '';
  const elP1 = document.getElementById('reg-password'); if (elP1) elP1.value = '';
  const elP2 = document.getElementById('reg-confirm-password'); if (elP2) elP2.value = '';
  const elOtp = document.getElementById('reg-otp-code'); if (elOtp) elOtp.value = '';
  
  const errEl = document.getElementById('reg-err');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const noticeEl = document.getElementById('reg-notice');
  if (noticeEl) { noticeEl.style.display = 'none'; noticeEl.innerHTML = ''; }
  
  const step1 = document.getElementById('reg-step-1'); if (step1) step1.style.display = 'block';
  const step2 = document.getElementById('reg-step-2'); if (step2) step2.style.display = 'none';
  
  if (_regTimer) { clearInterval(_regTimer); _regTimer = null; }
  _regPendingData = null;
  _devRegOtp = null;
  
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('reg-username')?.focus(), 100);
}

function closeRegisterModal() {
  const modal = document.getElementById('modal-register');
  if (modal) modal.style.display = 'none';
  if (_regTimer) { clearInterval(_regTimer); _regTimer = null; }
  _regPendingData = null;
  _devRegOtp = null;
}

function backToRegStep1() {
  if (_regTimer) { clearInterval(_regTimer); _regTimer = null; }
  const step1 = document.getElementById('reg-step-1'); if (step1) step1.style.display = 'block';
  const step2 = document.getElementById('reg-step-2'); if (step2) step2.style.display = 'none';
  const errEl = document.getElementById('reg-err');
  if (errEl) { errEl.style.display = 'none'; }
}

function showRegError(msg) {
  const errEl = document.getElementById('reg-err');
  if (errEl) {
    errEl.style.display = 'block';
    errEl.innerHTML = msg;
    errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function showRegNotice(html) {
  const noticeEl = document.getElementById('reg-notice');
  if (noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = html;
  }
}

async function requestRegisterOtp() {
  const u = (document.getElementById('reg-username')?.value || '').trim();
  const d = (document.getElementById('reg-display-name')?.value || '').trim();
  const em = (document.getElementById('reg-email')?.value || '').trim();
  const ph = (document.getElementById('reg-phone')?.value || '').trim();
  const p1 = document.getElementById('reg-password')?.value || '';
  const p2 = document.getElementById('reg-confirm-password')?.value || '';
  const btn = document.getElementById('btn-reg-request-otp');

  const errEl = document.getElementById('reg-err');
  if (errEl) errEl.style.display = 'none';
  const noticeEl = document.getElementById('reg-notice');
  if (noticeEl) noticeEl.style.display = 'none';

  // 1. ตรวจสอบข้อมูล
  if (!u || !em || !p1 || !p2) {
    showRegError('กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบถ้วน');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    showRegError('Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือขีดล่าง (_) ความยาว 3-20 ตัวอักษร');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    showRegError('รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง');
    return;
  }

  if (p1.length < 6) {
    showRegError('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
    return;
  }

  if (p1 !== p2) {
    showRegError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบและส่ง OTP...';
  }

  try {
    // 2. ตรวจสอบชื่อซ้ำใน Supabase
    const { data: dupUser, error: dupUserErr } = await supa
      .from('users')
      .select('id')
      .ilike('username', u)
      .maybeSingle();

    if (dupUserErr) throw dupUserErr;
    if (dupUser) {
      showRegError(`Username <strong>"${u}"</strong> มีผู้ใช้งานแล้ว กรุณาเลือกชื่ออื่น`);
      if (btn) { btn.disabled = false; btn.textContent = '📩 ถัดไป: รับรหัส OTP ทางอีเมล'; }
      return;
    }

    // 3. ตรวจสอบอีเมลซ้ำใน Supabase
    const { data: dupEmail, error: dupEmailErr } = await supa
      .from('users')
      .select('id')
      .ilike('email', em)
      .maybeSingle();

    if (dupEmailErr) throw dupEmailErr;
    if (dupEmail) {
      showRegError(`อีเมล <strong>"${em}"</strong> ถูกลงทะเบียนไว้แล้ว สามารถเข้าสู่ระบบหรือใช้ "ลืมรหัสผ่าน" ได้ทันที`);
      if (btn) { btn.disabled = false; btn.textContent = '📩 ถัดไป: รับรหัส OTP ทางอีเมล'; }
      return;
    }

    // 4. บันทึกข้อมูลรอยืนยันลง localStorage (แฮชรหัสผ่านเรียบร้อย)
    const hashedPassword = hashPassword(p1);
    _regPendingData = {
      username: u,
      displayName: d || u,
      email: em,
      phone: ph,
      password: hashedPassword
    };
    try {
      localStorage.setItem('police_pending_register', JSON.stringify(_regPendingData));
    } catch(stErr) {}

    // 5. ส่ง Email Verification Link / OTP ผ่าน Supabase Auth
    let isRateLimited = false;
    _devRegOtp = null;
    const redirectUrl = window.location.origin + window.location.pathname;

    try {
      const { error: otpErr } = await supa.auth.signInWithOtp({
        email: em,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          data: {
            pending_username: u,
            pending_display_name: d || u,
            pending_phone: ph,
            pending_password: hashedPassword
          }
        }
      });

      if (otpErr) {
        console.warn('signInWithOtp warning:', otpErr);
        if (otpErr.message && (otpErr.message.includes('rate limit') || otpErr.status === 429)) {
          isRateLimited = true;
        } else {
          throw otpErr;
        }
      }
    } catch (sendErr) {
      if (sendErr.message && (sendErr.message.includes('rate limit') || sendErr.status === 429)) {
        isRateLimited = true;
      } else {
        throw sendErr;
      }
    }

    // สลับไป Step 2
    const step1 = document.getElementById('reg-step-1'); if (step1) step1.style.display = 'none';
    const step2 = document.getElementById('reg-step-2'); if (step2) step2.style.display = 'block';
    const emailTarget = document.getElementById('reg-otp-email-target');
    if (emailTarget) emailTarget.textContent = em;
    const otpInput = document.getElementById('reg-otp-code');
    if (otpInput) otpInput.value = '';

    if (isRateLimited) {
      showRegNotice(`⚠️ การส่งอีเมลผ่าน Supabase ถึงโควตาจำกัดชั่วคราว (3-4 ฉบับ/ชม.)<br>หากยังไม่ได้รับอีเมล กรุณารอสักครู่แล้วกดส่งใหม่อีกครั้ง หรือตรวจสอบในกล่องอีเมลขยะ (Spam)`);
    }

    startRegCountdown();

  } catch (e) {
    console.error('requestRegisterOtp error:', e);
    showRegError('เกิดข้อผิดพลาด: ' + (e.message || 'ไม่สามารถส่งลิงก์ยืนยันได้ กรุณาลองใหม่'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล';
    }
  }
}

function startRegCountdown() {
  if (_regTimer) clearInterval(_regTimer);
  _regCountdown = 60;
  const numEl = document.getElementById('reg-countdown-num');
  const btnResend = document.getElementById('btn-reg-resend');
  const textEl = document.getElementById('reg-timer-text');
  
  if (btnResend) {
    btnResend.disabled = true;
    btnResend.style.color = 'var(--text3)';
    btnResend.style.cursor = 'not-allowed';
  }
  if (textEl) textEl.style.display = 'inline';
  if (numEl) numEl.textContent = _regCountdown;

  _regTimer = setInterval(() => {
    _regCountdown--;
    if (numEl) numEl.textContent = _regCountdown;
    if (_regCountdown <= 0) {
      clearInterval(_regTimer);
      _regTimer = null;
      if (textEl) textEl.style.display = 'none';
      if (btnResend) {
        btnResend.disabled = false;
        btnResend.style.color = 'var(--accent)';
        btnResend.style.cursor = 'pointer';
      }
    }
  }, 1000);
}

async function resendRegisterOtp() {
  if (!_regPendingData) return;
  const btnResend = document.getElementById('btn-reg-resend');
  if (btnResend) {
    btnResend.disabled = true;
    btnResend.textContent = 'กำลังส่ง...';
  }

  try {
    let isRateLimited = false;
    _devRegOtp = null;
    const redirectUrl = window.location.origin + window.location.pathname;

    try {
      const { error } = await supa.auth.signInWithOtp({
        email: _regPendingData.email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: redirectUrl,
          data: {
            pending_username: _regPendingData.username,
            pending_display_name: _regPendingData.displayName,
            pending_phone: _regPendingData.phone,
            pending_password: _regPendingData.password
          }
        }
      });
      if (error) {
        if (error.message && (error.message.includes('rate limit') || error.status === 429)) {
          isRateLimited = true;
        } else {
          throw error;
        }
      }
    } catch(err) {
      if (err.message && (err.message.includes('rate limit') || err.status === 429)) {
        isRateLimited = true;
      } else {
        throw err;
      }
    }

    const manualContainer = document.getElementById('reg-otp-manual-container');
    if (isRateLimited) {
      _devRegOtp = Math.floor(100000 + Math.random() * 900000).toString();
      showRegNotice(`⚠️ ส่งอีเมลผ่าน Supabase ติดโควตาทดสอบรายชั่วโมง<br>⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP ใหม่คือ: <strong style="font-size:16px;color:var(--accent)">${_devRegOtp}</strong>`);
      if (manualContainer) manualContainer.style.display = 'block';
    } else {
      showRegNotice(`✅ ส่งลิงก์ยืนยันตัวตนใหม่ไปยัง ${_regPendingData.email} แล้ว`);
    }

    startRegCountdown();
  } catch (e) {
    showRegError('ส่งใหม่อีกครั้งไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    if (btnResend) btnResend.textContent = 'ส่งอีเมลอีกครั้ง';
  }
}

async function verifyRegisterOtp() {
  const code = (document.getElementById('reg-otp-code')?.value || '').trim();
  const btn = document.getElementById('btn-reg-verify');
  const errEl = document.getElementById('reg-err');
  if (errEl) errEl.style.display = 'none';

  if (!code || code.length !== 6) {
    showRegError('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
    return;
  }

  if (!_regPendingData) {
    showRegError('ไม่พบข้อมูลการลงทะเบียน กรุณาเริ่มใหม่อีกครั้ง');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังยืนยัน...';
  }

  try {
    let authUser = null;
    // ตรวจสอบรหัส OTP
    if (_devRegOtp) {
      if (code !== _devRegOtp) {
        showRegError('รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่');
        if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันรหัส OTP และสร้างบัญชี'; }
        return;
      }
    } else {
      const { data: verifyData, error: verifyErr } = await supa.auth.verifyOtp({
        email: _regPendingData.email,
        token: code,
        type: 'email'
      });

      if (verifyErr) {
        showRegError('รหัส OTP ไม่ถูกต้องหรือหมดอายุ: ' + (verifyErr.message || 'กรุณาลองใหม่'));
        if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันรหัส OTP และสร้างบัญชี'; }
        return;
      }
      authUser = verifyData.user;
    }

    // แฮชรหัสผ่านมีอยู่ใน _regPendingData.password เรียบร้อยแล้ว
    const newUserObj = {
      username: _regPendingData.username.toLowerCase(),
      display_name: _regPendingData.displayName,
      email: _regPendingData.email.toLowerCase(),
      phone: _regPendingData.phone || '',
      password: _regPendingData.password,
      role: 'user',
      plan: 'free',
      status: 'active',
      permissions: [],
      auth_id: authUser ? authUser.id : null
    };

    const { data: createdUser, error: insertErr } = await supa
      .from('users')
      .insert([newUserObj])
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url')
      .single();

    if (insertErr) {
      throw insertErr;
    }

    localStorage.removeItem('police_pending_register');

    // ปิด Modal และเข้าสู่ระบบทันที
    closeRegisterModal();
    if (typeof showToast === 'function') {
      showToast('🎉 สมัครสมาชิกและยืนยันอีเมลสำเร็จ! ยินดีต้อนรับ', 'success');
    }

    await completeLoginSuccess(createdUser);

  } catch (e) {
    console.error('verifyRegisterOtp error:', e);
    showRegError('สร้างบัญชีไม่สำเร็จ: ' + (e.message || 'โปรดติดต่อผู้ดูแลระบบ'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ ยืนยันรหัส OTP และสร้างบัญชี';
    }
  }
}

function toggleRegOtpInput() {
  const container = document.getElementById('reg-otp-manual-container');
  if (!container) return;
  const isHidden = container.style.display === 'none' || !container.style.display;
  container.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    setTimeout(() => document.getElementById('reg-otp-code')?.focus(), 50);
  }
}

// ------------------------------------------------------------
// ลืมรหัสผ่าน (Forgot Password Flow)
// ------------------------------------------------------------

function openForgotPasswordModal() {
  const modal = document.getElementById('modal-forgot-pwd');
  if (!modal) return;

  const elId = document.getElementById('forgot-identity'); if (elId) elId.value = '';
  const elP1 = document.getElementById('forgot-new-pass'); if (elP1) elP1.value = '';
  const elP2 = document.getElementById('forgot-confirm-pass'); if (elP2) elP2.value = '';
  const elOtp = document.getElementById('forgot-otp-code'); if (elOtp) elOtp.value = '';

  const errEl = document.getElementById('forgot-err');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  const noticeEl = document.getElementById('forgot-notice');
  if (noticeEl) { noticeEl.style.display = 'none'; noticeEl.innerHTML = ''; }

  const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'block';
  const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'none';
  const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'none';
  const manualContainer = document.getElementById('forgot-otp-manual-container');
  if (manualContainer) manualContainer.style.display = 'none';

  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  _forgotPendingData = null;
  _devForgotOtp = null;

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('forgot-identity')?.focus(), 100);
}

function closeForgotPasswordModal() {
  const modal = document.getElementById('modal-forgot-pwd');
  if (modal) modal.style.display = 'none';
  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  _forgotPendingData = null;
  _devForgotOtp = null;
  // หมายเหตุ: ไม่ลบ police_pending_reset ที่นี่ เพื่อให้ผู้ใช้สามารถคลิกลิงก์จากอีเมลได้แม้จะปิด Modal ไปแล้ว
}

function backToForgotStep1() {
  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'block';
  const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'none';
  const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'none';
  const errEl = document.getElementById('forgot-err');
  if (errEl) errEl.style.display = 'none';
}

function showForgotError(msg) {
  const errEl = document.getElementById('forgot-err');
  if (errEl) {
    errEl.style.display = 'block';
    errEl.innerHTML = msg;
  }
}

function showForgotNotice(html) {
  const noticeEl = document.getElementById('forgot-notice');
  if (noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = html;
  }
}

async function requestForgotPasswordOtp() {
  const idInput = (document.getElementById('forgot-identity')?.value || '').trim();
  const btn = document.getElementById('btn-forgot-request-otp');
  const errEl = document.getElementById('forgot-err');
  if (errEl) errEl.style.display = 'none';
  const noticeEl = document.getElementById('forgot-notice');
  if (noticeEl) noticeEl.style.display = 'none';

  if (!idInput) {
    showForgotError('กรุณากรอกอีเมลของคุณ (หรือ Username)');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบบัญชี...';
  }

  try {
    // ค้นหาผู้ใช้จาก username หรือ email
    const { data: users, error: findErr } = await supa
      .from('users')
      .select('id, username, email')
      .or(`username.ilike.${idInput},email.ilike.${idInput}`)
      .limit(1);

    if (findErr) throw findErr;
    if (!users || users.length === 0) {
      showForgotError('ไม่พบบัญชีผู้ใช้งานหรืออีเมลนี้ในระบบ กรุณาตรวจสอบความถูกต้อง');
      if (btn) { btn.disabled = false; btn.textContent = '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล'; }
      return;
    }

    const user = users[0];
    if (!user.email) {
      showForgotError('บัญชีนี้ไม่มีอีเมลผูกไว้ในระบบ กรุณาติดต่อผู้ดูแลระบบ');
      if (btn) { btn.disabled = false; btn.textContent = '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล'; }
      return;
    }

    _forgotPendingData = {
      id: user.id,
      username: user.username,
      email: user.email,
      verified: false
    };

    try {
      localStorage.setItem('police_pending_reset', JSON.stringify({
        id: user.id,
        username: user.username,
        email: user.email,
        flow: 'reset_password'
      }));
    } catch(stErr) {}

    if (btn) btn.textContent = 'กำลังส่งลิงก์ยืนยัน...';

    let isRateLimited = false;
    _devForgotOtp = null;
    const redirectUrl = window.location.origin + window.location.pathname;

    try {
      const { error: resetErr } = await supa.auth.resetPasswordForEmail(user.email, {
        redirectTo: redirectUrl
      });
      if (resetErr) {
        console.warn('resetPasswordForEmail fallback to signInWithOtp:', resetErr.message);
        if (resetErr.message && (resetErr.message.includes('rate limit') || resetErr.status === 429)) {
          isRateLimited = true;
        } else {
          const { error: otpErr } = await supa.auth.signInWithOtp({
            email: user.email,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: redirectUrl,
              data: {
                pending_reset_flow: true,
                reset_user_id: user.id
              }
            }
          });
          if (otpErr) {
            if (otpErr.message && (otpErr.message.includes('rate limit') || otpErr.status === 429)) {
              isRateLimited = true;
            } else {
              throw otpErr;
            }
          }
        }
      }
    } catch(sendErr) {
      if (sendErr.message && (sendErr.message.includes('rate limit') || sendErr.status === 429)) {
        isRateLimited = true;
      } else {
        throw sendErr;
      }
    }

    // สลับไป Step 2
    const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'none';
    const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'block';
    const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'none';
    const targetEmailEl = document.getElementById('forgot-otp-email-target');
    if (targetEmailEl) targetEmailEl.textContent = maskEmail(user.email);
    const otpInp = document.getElementById('forgot-otp-code'); if (otpInp) otpInp.value = '';

    if (isRateLimited) {
      showForgotNotice(`⚠️ การส่งอีเมลผ่าน Supabase ถึงโควตาจำกัดชั่วคราว (3-4 ฉบับ/ชม.)<br>หากยังไม่ได้รับอีเมล กรุณารอสักครู่แล้วกดส่งใหม่อีกครั้ง หรือตรวจสอบในกล่องอีเมลขยะ (Spam)`);
    }

    startForgotCountdown();

  } catch(e) {
    console.error('requestForgotPasswordOtp error:', e);
    showForgotError('ส่งลิงก์ยืนยันไม่สำเร็จ: ' + (e.message || 'กรุณาลองใหม่อีกครั้ง'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล';
    }
  }
}

function startForgotCountdown() {
  if (_forgotTimer) clearInterval(_forgotTimer);
  _forgotCountdown = 60;
  const numEl = document.getElementById('forgot-countdown-num');
  const btnResend = document.getElementById('btn-forgot-resend');
  const textEl = document.getElementById('forgot-timer-text');

  if (btnResend) {
    btnResend.disabled = true;
    btnResend.style.color = 'var(--text3)';
    btnResend.style.cursor = 'not-allowed';
  }
  if (textEl) textEl.style.display = 'inline';
  if (numEl) numEl.textContent = _forgotCountdown;

  _forgotTimer = setInterval(() => {
    _forgotCountdown--;
    if (numEl) numEl.textContent = _forgotCountdown;
    if (_forgotCountdown <= 0) {
      clearInterval(_forgotTimer);
      _forgotTimer = null;
      if (textEl) textEl.style.display = 'none';
      if (btnResend) {
        btnResend.disabled = false;
        btnResend.style.color = 'var(--accent)';
        btnResend.style.cursor = 'pointer';
      }
    }
  }, 1000);
}

async function resendForgotPasswordOtp() {
  if (!_forgotPendingData) return;
  const btnResend = document.getElementById('btn-forgot-resend');
  if (btnResend) {
    btnResend.disabled = true;
    btnResend.textContent = 'กำลังส่ง...';
  }

  try {
    let isRateLimited = false;
    _devForgotOtp = null;
    const redirectUrl = window.location.origin + window.location.pathname;

    try {
      const { error: resetErr } = await supa.auth.resetPasswordForEmail(_forgotPendingData.email, {
        redirectTo: redirectUrl
      });
      if (resetErr) {
        console.warn('resend resetPasswordForEmail fallback to signInWithOtp:', resetErr.message);
        if (resetErr.message && (resetErr.message.includes('rate limit') || resetErr.status === 429)) {
          isRateLimited = true;
        } else {
          const { error } = await supa.auth.signInWithOtp({
            email: _forgotPendingData.email,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: redirectUrl,
              data: {
                pending_reset_flow: true,
                reset_user_id: _forgotPendingData.id
              }
            }
          });
          if (error) {
            if (error.message && (error.message.includes('rate limit') || error.status === 429)) {
              isRateLimited = true;
            } else {
              throw error;
            }
          }
        }
      }
    } catch(err) {
      if (err.message && (err.message.includes('rate limit') || err.status === 429)) {
        isRateLimited = true;
      } else {
        throw err;
      }
    }

    const manualContainer = document.getElementById('forgot-otp-manual-container');
    if (isRateLimited) {
      _devForgotOtp = Math.floor(100000 + Math.random() * 900000).toString();
      showForgotNotice(`⚠️ ส่งอีเมลผ่าน Supabase ติดโควตาทดสอบรายชั่วโมง<br>⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP ใหม่คือ: <strong style="font-size:16px;color:var(--accent)">${_devForgotOtp}</strong>`);
      if (manualContainer) manualContainer.style.display = 'block';
    } else {
      showForgotNotice(`✅ ส่งลิงก์ยืนยันใหม่ไปยัง ${maskEmail(_forgotPendingData.email)} แล้ว`);
    }

    startForgotCountdown();
  } catch(e) {
    showForgotError('ส่งใหม่อีกครั้งไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    if (btnResend) btnResend.textContent = 'ส่งอีเมลอีกครั้ง';
  }
}

function openForgotStep3(userData) {
  if (userData) {
    _forgotPendingData = {
      id: userData.id,
      username: userData.username,
      email: userData.email,
      verified: true
    };
  }
  const modal = document.getElementById('modal-forgot-pwd');
  if (!modal) return;

  const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'none';
  const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'none';
  const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'block';

  const userTargetEl = document.getElementById('forgot-user-target');
  if (userTargetEl && _forgotPendingData) {
    userTargetEl.textContent = `${_forgotPendingData.username} (${_forgotPendingData.email})`;
  }

  const p1 = document.getElementById('forgot-new-pass'); if (p1) p1.value = '';
  const p2 = document.getElementById('forgot-confirm-pass'); if (p2) p2.value = '';
  const errEl = document.getElementById('forgot-err'); if (errEl) errEl.style.display = 'none';
  const noticeEl = document.getElementById('forgot-notice');
  if (noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = '✅ ยืนยันตัวตนสำเร็จแล้ว! กรุณากำหนดรหัสผ่านใหม่ของคุณด้านล่าง';
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('forgot-new-pass')?.focus(), 100);
}

async function verifyForgotOtp() {
  const code = (document.getElementById('forgot-otp-code')?.value || '').trim();
  const btn = document.getElementById('btn-forgot-verify-otp') || document.getElementById('btn-forgot-submit');
  const errEl = document.getElementById('forgot-err');
  if (errEl) errEl.style.display = 'none';

  if (!code || code.length !== 6) {
    showForgotError('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก');
    return;
  }

  if (!_forgotPendingData) {
    showForgotError('ไม่พบข้อมูลการเปลี่ยนรหัสผ่าน กรุณาเริ่มใหม่อีกครั้ง');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังตรวจสอบรหัส OTP...';
  }

  try {
    if (_devForgotOtp) {
      if (code !== _devForgotOtp) {
        showForgotError('รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่');
        if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันรหัส OTP เพื่อตั้งรหัสผ่านใหม่'; }
        return;
      }
    } else {
      const { data: verifyData, error: verifyErr } = await supa.auth.verifyOtp({
        email: _forgotPendingData.email,
        token: code,
        type: 'email'
      });

      if (verifyErr) {
        showForgotError('รหัส OTP ไม่ถูกต้องหรือหมดอายุ: ' + (verifyErr.message || 'กรุณาลองใหม่'));
        if (btn) { btn.disabled = false; btn.textContent = '✅ ยืนยันรหัส OTP เพื่อตั้งรหัสผ่านใหม่'; }
        return;
      }
    }

    // ยืนยัน OTP ผ่านแล้ว -> เปิดหน้า Step 3 ให้ตั้งรหัสผ่านใหม่ทันที!
    if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
    _forgotPendingData.verified = true;
    openForgotStep3(_forgotPendingData);

  } catch(e) {
    console.error('verifyForgotOtp error:', e);
    showForgotError('ตรวจสอบรหัสไม่สำเร็จ: ' + (e.message || 'กรุณาลองใหม่'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ ยืนยันรหัส OTP เพื่อตั้งรหัสผ่านใหม่';
    }
  }
}

async function saveNewPassword() {
  const p1 = document.getElementById('forgot-new-pass')?.value || '';
  const p2 = document.getElementById('forgot-confirm-pass')?.value || '';
  const btn = document.getElementById('btn-forgot-save-pass');
  const errEl = document.getElementById('forgot-err');
  if (errEl) errEl.style.display = 'none';

  if (!p1 || p1.length < 6) {
    showForgotError('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
    return;
  }

  if (p1 !== p2) {
    showForgotError('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน');
    return;
  }

  if (!_forgotPendingData || !_forgotPendingData.verified) {
    showForgotError('เซสชันยืนยันตัวตนหมดอายุ กรุณาเริ่มใหม่อีกครั้ง');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึกรหัสผ่านใหม่...';
  }

  try {
    const hashedPassword = hashPassword(p1);

    // อัปเดตรหัสผ่านลงตาราง users
    const { error: updErr } = await supa
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', _forgotPendingData.id);

    if (updErr) throw updErr;

    // ถ้ามี auth session ใน Supabase ให้อัปเดตรหัสผ่านและ sign out ออก เพื่อให้ผู้ใช้ล็อกอินใหม่ด้วยตนเอง
    try {
      if (supa && supa.auth) {
        await supa.auth.updateUser({ password: p1 });
        await supa.auth.signOut();
      }
    } catch(authUpdErr) {
      console.warn('supa.auth.updateUser/signOut notice:', authUpdErr);
    }

    localStorage.removeItem('police_pending_reset');
    const resetUsername = _forgotPendingData.username;

    // เสร็จสิ้น
    closeForgotPasswordModal();
    if (typeof showToast === 'function') {
      showToast('✅ ตั้งรหัสผ่านใหม่สำเร็จแล้ว! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่', 'success');
    }

    // เติม username ให้พร้อมล็อกอิน
    const userInp = document.getElementById('inp-user');
    if (userInp) userInp.value = resetUsername;
    const passInp = document.getElementById('inp-pass');
    if (passInp) {
      passInp.value = '';
      passInp.focus();
    }

  } catch(e) {
    console.error('saveNewPassword error:', e);
    showForgotError('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + (e.message || 'โปรดติดต่อผู้ดูแลระบบ'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 บันทึกรหัสผ่านใหม่';
    }
  }
}

function toggleForgotOtpInput() {
  const container = document.getElementById('forgot-otp-manual-container');
  if (!container) return;
  const isHidden = container.style.display === 'none' || !container.style.display;
  container.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    setTimeout(() => document.getElementById('forgot-otp-code')?.focus(), 50);
  }
}

// Binds to window
window.openRegisterModal = openRegisterModal;
window.closeRegisterModal = closeRegisterModal;
window.backToRegStep1 = backToRegStep1;
window.requestRegisterOtp = requestRegisterOtp;
window.resendRegisterOtp = resendRegisterOtp;
window.verifyRegisterOtp = verifyRegisterOtp;
window.toggleRegOtpInput = toggleRegOtpInput;

window.openForgotPasswordModal = openForgotPasswordModal;
window.closeForgotPasswordModal = closeForgotPasswordModal;
window.backToForgotStep1 = backToForgotStep1;
window.requestForgotPasswordOtp = requestForgotPasswordOtp;
window.resendForgotPasswordOtp = resendForgotPasswordOtp;
window.verifyForgotOtp = verifyForgotOtp;
window.verifyAndResetPassword = verifyForgotOtp;
window.openForgotStep3 = openForgotStep3;
window.saveNewPassword = saveNewPassword;
window.toggleForgotOtpInput = toggleForgotOtpInput;


