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
    // ใช้ ilike เพื่อรองรับกรณีคีย์บอร์ดมือถือพิมพ์ตัวใหญ่ตัวแรกอัตโนมัติ (เช่น Admin -> admin) หรือล็อกอินด้วยอีเมล
    let query = supa
      .from('users')
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes');

    if (u.includes('@')) {
      query = query.ilike('email', u);
    } else {
      query = query.ilike('username', u);
    }

    const {data,error} = await query.maybeSingle();

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
  if (window._isResetModalOpen || window._isPasswordResetActive || sessionStorage.getItem('police_reset_modal_open') === 'true') {
    console.warn('Blocked completeLoginSuccess: Reset password in progress');
    return;
  }

  const defaultAdminPerms = ['dashboard', 'questions', 'add_question', 'import_csv', 'settings', 'manage_users', 'test_exam'];
  let userPerms = data.permissions;
  if (!userPerms || !Array.isArray(userPerms)) {
    userPerms = defaultAdminPerms;
  }

  const userAvatar = data.avatar_url || (data.id ? localStorage.getItem('police_avatar_' + data.id) : null) || null;

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
    avatar_url: userAvatar,
    notes: data.notes || null
  };
  _loginUser=currentUser;

  // บันทึกแคชรูปโปรไฟล์สำรองใน localStorage
  if (currentUser.avatar_url && currentUser.id) {
    try { localStorage.setItem('police_avatar_' + currentUser.id, currentUser.avatar_url); } catch(e){}
  }

  // ซิงค์การตั้งค่ารูปลักษณ์ (Theme, Font, Wallpaper) จาก Cloud ข้ามอุปกรณ์
  if (typeof loadUserPreferencesFromCloud === 'function') {
    try {
      loadUserPreferencesFromCloud(data.notes);
    } catch(prefErr) {
      console.warn('loadUserPreferencesFromCloud error:', prefErr);
    }
  }

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
  // คืนค่าภาพพื้นหลังเมื่อออกจากระบบ เพื่อไม่ให้ภาพพื้นหลังของบัญชีนี้ค้างในหน้าจอเข้าสู่ระบบ
  if (typeof applyCustomWallpaper === 'function') {
    try { applyCustomWallpaper(null, '25'); } catch (e) {}
  }
  if (typeof closeUserDropdown === 'function') {
    try { closeUserDropdown(); } catch (e) {}
  }
  if (typeof closeAdminDropdown === 'function') {
    try { closeAdminDropdown(); } catch (e) {}
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

function isRecoverySession(session, authUser) {
  if (window._isPasswordRecoveryFlow || window._isPasswordResetActive || window._isResetModalOpen) return true;
  if (sessionStorage.getItem('police_is_password_recovery') === 'true' || 
      localStorage.getItem('police_is_password_recovery') === 'true' ||
      sessionStorage.getItem('police_reset_modal_open') === 'true') return true;

  // 1) เช็คจาก JWT token payload amr claims
  if (session && session.access_token) {
    try {
      const parts = session.access_token.split('.');
      if (parts.length >= 2) {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = decodeURIComponent(atob(b64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        const payload = JSON.parse(jsonStr);
        if (payload && payload.amr && Array.isArray(payload.amr)) {
          const hasRec = payload.amr.some(item => {
            if (typeof item === 'string') return item === 'recovery';
            if (item && typeof item === 'object') return item.method === 'recovery';
            return false;
          });
          if (hasRec) return true;
        }
      }
    } catch(e) {}
  }

  // 2) เช็คจาก authUser.amr
  if (authUser && authUser.amr && Array.isArray(authUser.amr)) {
    const hasRec = authUser.amr.some(item => {
      if (typeof item === 'string') return item === 'recovery';
      if (item && typeof item === 'object') return item.method === 'recovery';
      return false;
    });
    if (hasRec) return true;
  }

  // 3) เช็คจาก authUser app_metadata / user_metadata
  if (authUser && (authUser.user_metadata?.pending_reset_flow || authUser.app_metadata?.provider === 'recovery')) {
    return true;
  }

  return false;
}

async function syncAndLoginOAuthUser(authUser) {
  if (!authUser) return;

  // หากหน้าต่างตั้งรหัสผ่านใหม่ (Step 3) กำลังเปิดแสดงอยู่แล้ว ให้หยุดทันทีเพื่อไม่ให้เกิดการล็อกอินทับ
  if ((window._isResetModalOpen || sessionStorage.getItem('police_reset_modal_open') === 'true') &&
      document.getElementById('modal-forgot-pwd')?.style.display === 'flex' &&
      document.getElementById('forgot-step-3')?.style.display === 'block') {
    console.log('Reset password modal is already visible, suppressing duplicate syncAndLoginOAuthUser');
    hideOAuthLoading();
    _isOAuthProcessing = false;
    return;
  }
  try {
    showOAuthLoading('กำลังซิงค์ข้อมูลบัญชีผู้ใช้...');

    // 1) ค้นหาด้วย auth_id ก่อน
    let { data: userRow, error: qErr } = await supa
      .from('users')
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
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

    // ดึง session ล่าสุดมาตรวจสอบ AMR claims
    let currentSession = null;
    try {
      const { data: sessData } = await supa.auth.getSession();
      currentSession = sessData?.session || null;
    } catch(sErr){}

    const isAmrRecovery = isRecoverySession(currentSession, authUser);

    // ตรวจจับ Reset Flow จากทุกช่องทาง:
    // 1) Flag จาก early sniffer ใน <head> หรือ initGoogleAuth (event === 'PASSWORD_RECOVERY')
    // 2) AMR claim ใน JWT token มี method: 'recovery'
    // 3) sessionStorage ที่ดักจับไว้ก่อน Supabase SDK เคลียร์ hash ทิ้ง
    // 4) localStorage ที่ดักจับไว้ก่อน Supabase SDK เคลียร์ hash ทิ้ง
    // 5) URL hash มี type=recovery หรือ flow=reset_password
    // 6) URL search มี type=recovery หรือ flow=reset_password
    // 7) localStorage มี police_pending_reset
    // 8) authUser user_metadata มี pending_reset_flow
    const isResetFlow = Boolean(
      window._isPasswordRecoveryFlow ||
      window._isPasswordResetActive ||
      window._isResetModalOpen ||
      isAmrRecovery ||
      sessionStorage.getItem('police_is_password_recovery') === 'true' ||
      localStorage.getItem('police_is_password_recovery') === 'true' ||
      sessionStorage.getItem('police_reset_modal_open') === 'true' ||
      (window.location.hash && (window.location.hash.includes('type=recovery') || window.location.hash.includes('flow=reset_password'))) ||
      (window.location.search && (window.location.search.includes('type=recovery') || window.location.search.includes('flow=reset_password'))) ||
      (pendingReset && (pendingReset.flow === 'reset_password' || pendingReset.id)) ||
      authUser.user_metadata?.pending_reset_flow
    );

    // 2) ถ้าไม่เจอด้วย auth_id ให้ค้นหาด้วย email หรือ reset_user_id (กรณีเป็นผู้ใช้เดิม หรือ ยืนยันอีเมล)
    if (!userRow && authUser.email) {
      const { data: emailMatch } = await supa
        .from('users')
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
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
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
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
      window._isResetModalOpen = true;
      window._isPasswordResetActive = true;
      window._isPasswordRecoveryFlow = false;
      try { sessionStorage.setItem('police_reset_modal_open', 'true'); } catch(e){}
      try { sessionStorage.removeItem('police_is_password_recovery'); } catch(e){}
      try { localStorage.removeItem('police_is_password_recovery'); } catch(e){}
      try { localStorage.removeItem('police_pending_reset'); } catch(e){}
      hideOAuthLoading();
      _isOAuthProcessing = false;
      currentUser = null;
      try { localStorage.removeItem('police_user'); } catch(e){}
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
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
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
    const isRecoveryUrl = Boolean(
      window._isPasswordRecoveryFlow ||
      sessionStorage.getItem('police_is_password_recovery') === 'true' ||
      localStorage.getItem('police_is_password_recovery') === 'true' ||
      hash.includes('type=recovery') || search.includes('type=recovery') ||
      hash.includes('flow=reset_password') || search.includes('flow=reset_password')
    );
    if (isRecoveryUrl) {
      window._isPasswordRecoveryFlow = true;
      try { sessionStorage.setItem('police_is_password_recovery', 'true'); } catch(e){}
      try { localStorage.setItem('police_is_password_recovery', 'true'); } catch(e){}
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
      if (event === 'PASSWORD_RECOVERY' || (session && isRecoverySession(session, session.user))) {
        window._isPasswordRecoveryFlow = true;
        window._isPasswordResetActive = true;
        window._isResetModalOpen = true;
        try { sessionStorage.setItem('police_is_password_recovery', 'true'); } catch(e){}
        try { localStorage.setItem('police_is_password_recovery', 'true'); } catch(e){}
        try { sessionStorage.setItem('police_reset_modal_open', 'true'); } catch(e){}
      }
      if ((window._isPasswordResetActive || window._isResetModalOpen || sessionStorage.getItem('police_reset_modal_open') === 'true') && 
          document.getElementById('modal-forgot-pwd')?.style.display === 'flex' &&
          document.getElementById('forgot-step-3')?.style.display === 'block') {
        return;
      }
      const isRecovery = Boolean(
        window._isPasswordRecoveryFlow ||
        window._isPasswordResetActive ||
        window._isResetModalOpen ||
        sessionStorage.getItem('police_is_password_recovery') === 'true' ||
        localStorage.getItem('police_is_password_recovery') === 'true' ||
        sessionStorage.getItem('police_reset_modal_open') === 'true' ||
        (session && isRecoverySession(session, session.user))
      );
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') && session && session.user) {
        if (!currentUser || currentUser.auth_id !== session.user.id || isRecovery) {
          _isOAuthProcessing = true;
          await syncAndLoginOAuthUser(session.user);
        }
      } else if (event === 'SIGNED_OUT') {
        hideOAuthLoading();
        _isOAuthProcessing = false;
      }
    });

    // 2) ตรวจสอบ getSession() ซ้ำ (ถ้ากำลังอยู่ในโหมด Reset Password หรือกำลังประมวลผลอยู่ ให้ข้ามไปเลย)
    if (window._isPasswordResetActive || window._isResetModalOpen || sessionStorage.getItem('police_reset_modal_open') === 'true') {
      hideOAuthLoading();
      _isOAuthProcessing = false;
      return;
    }

    const { data: { session }, error } = await supa.auth.getSession();
    if (error) {
      console.warn('supa.auth.getSession error:', error);
      hideOAuthLoading();
      _isOAuthProcessing = false;
      return;
    }

    if (window._isPasswordResetActive || window._isResetModalOpen || sessionStorage.getItem('police_reset_modal_open') === 'true') {
      hideOAuthLoading();
      _isOAuthProcessing = false;
      return;
    }

    const isRecoverySessionFlag = Boolean(
      window._isPasswordRecoveryFlow ||
      window._isPasswordResetActive ||
      window._isResetModalOpen ||
      sessionStorage.getItem('police_is_password_recovery') === 'true' ||
      localStorage.getItem('police_is_password_recovery') === 'true' ||
      sessionStorage.getItem('police_reset_modal_open') === 'true' ||
      (session && isRecoverySession(session, session?.user))
    );

    if (session && session.user) {
      if (!_isOAuthProcessing && (!currentUser || currentUser.auth_id !== session.user.id || isRecoverySessionFlag)) {
        if (isRecoverySessionFlag) {
          window._isResetModalOpen = true;
          window._isPasswordResetActive = true;
          try { sessionStorage.setItem('police_reset_modal_open', 'true'); } catch(e){}
        }
        _isOAuthProcessing = true;
        await syncAndLoginOAuthUser(session.user);
      }
    } else if (!hasOAuthParams && !isRecoverySessionFlag) {
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
// การตั้งค่าระบบยืนยันตัวตนทางอีเมล (Email Confirmation Configuration)
// true  = เปิดใช้งานการยืนยันอีเมล (ผู้ใช้ต้องคลิกลิงก์/กรอก OTP ก่อนจึงจะใช้งานได้)
// false = ปิดการยืนยันอีเมล (โหมดทดสอบ: สมัครแล้วเข้าใช้งานทันที, รีเซ็ตรหัสผ่านได้ทันทีโดยไม่ต้องรออีเมล)
// ============================================================
const REQUIRE_EMAIL_CONFIRMATION = true;

let _regPendingData = null;
let _regTimer = null;
let _regCountdown = 60;
let _devRegOtp = null;

let _forgotPendingData = null;
let _forgotTimer = null;
let _forgotCountdown = 60;
let _devForgotOtp = null;

// ============================================================
// ระบบส่งอีเมล OTP ผ่าน Google Apps Script (ส่งจาก Gmail ส่วนตัว ฟรี 100%)
// สามารถระบุ Web App URL ได้ที่นี่ หรือบันทึกลง localStorage('police_gas_otp_url')
// ============================================================
let GAS_OTP_ENDPOINT = (localStorage.getItem('police_gas_otp_url') || '').trim() || 'https://script.google.com/macros/s/AKfycbzzp8HdhUVM_TT4jXS-Kc2bSP9i6XNOldvKZfeIEz1wNEk6nlgngJQhSDkEpp56B1hFPA/exec';

async function sendOtpEmailViaGAS(toEmail, otpCode, username, flow) {
  const gasUrl = (localStorage.getItem('police_gas_otp_url') || '').trim() || GAS_OTP_ENDPOINT;
  if (!gasUrl || gasUrl.trim() === '' || gasUrl.includes('_placeholder')) {
    console.warn('⚠️ Google Apps Script URL ยังไม่ได้ตั้งค่า (อยู่ในโหมดทดสอบ)');
    return { success: false, reason: 'no_endpoint' };
  }
  try {
    await fetch(gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        to: toEmail,
        otp: otpCode,
        username: username || 'ผู้ใช้งาน',
        appName: 'ระบบจำลองข้อสอบตำรวจ',
        flow: flow || 'reset_password'
      })
    });
    return { success: true };
  } catch (err) {
    console.error('sendOtpEmailViaGAS error:', err);
    return { success: false, error: err };
  }
}

// ช่วยให้แอดมินตั้งค่า Web App URL ได้ง่ายๆ ผ่าน Console: setGasOtpUrl('https://...')
window.setGasOtpUrl = function(url) {
  if (!url) return;
  localStorage.setItem('police_gas_otp_url', url.trim());
  GAS_OTP_ENDPOINT = url.trim();
  console.log('✅ บันทึก Google Apps Script Web App URL เรียบร้อย:', url.trim());
  if (typeof showToast === 'function') showToast('✅ บันทึก Google Apps Script URL เรียบร้อย', 'success');
};

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
  
  const btn = document.getElementById('btn-reg-request-otp');
  if (btn) {
    btn.disabled = false;
    btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันตัวตน' : '✨ สมัครสมาชิก';
  }

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
  if (!u || !p1 || !p2 || (REQUIRE_EMAIL_CONFIRMATION && !em)) {
    showRegError('กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบถ้วน');
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    showRegError('Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือขีดล่าง (_) ความยาว 3-20 ตัวอักษร');
    return;
  }

  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
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
    btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? 'กำลังตรวจสอบและส่งอีเมลยืนยัน...' : 'กำลังสร้างบัญชีผู้ใช้...';
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
      if (btn) { btn.disabled = false; btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันตัวตน' : '✨ สมัครสมาชิก'; }
      return;
    }

    // 3. ตรวจสอบอีเมลซ้ำใน Supabase (ถ้ามีอีเมล)
    if (em) {
      const { data: dupEmail, error: dupEmailErr } = await supa
        .from('users')
        .select('id')
        .ilike('email', em)
        .maybeSingle();

      if (dupEmailErr) throw dupEmailErr;
      if (dupEmail) {
        showRegError(`อีเมล <strong>"${em}"</strong> ถูกลงทะเบียนไว้แล้ว สามารถเข้าสู่ระบบหรือใช้ "ลืมรหัสผ่าน" ได้ทันที`);
        if (btn) { btn.disabled = false; btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันตัวตน' : '✨ สมัครสมาชิก'; }
        return;
      }
    }

    const hashedPassword = hashPassword(p1);

    // ============================================================
    // ถ้าปิดการยืนยันอีเมล (REQUIRE_EMAIL_CONFIRMATION === false) -> สร้างบัญชีและเข้าสู่ระบบทันที!
    // ============================================================
    if (!REQUIRE_EMAIL_CONFIRMATION) {
      const newUserObj = {
        username: u.toLowerCase(),
        display_name: d || u,
        email: em ? em.toLowerCase() : `${u.toLowerCase()}@local.exam`,
        phone: ph || '',
        password: hashedPassword,
        role: 'user',
        plan: 'free',
        status: 'active',
        permissions: [],
        auth_id: null
      };

      const { data: createdUser, error: insertErr } = await supa
        .from('users')
        .insert([newUserObj])
        .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
        .single();

      if (insertErr) throw insertErr;

      closeRegisterModal();
      if (typeof showToast === 'function') {
        showToast('🎉 สมัครสมาชิกสำเร็จ! ยินดีต้อนรับ', 'success');
      }
      await completeLoginSuccess(createdUser);
      return;
    }

    // ============================================================
    // ถ้าเปิดการยืนยันอีเมล (REQUIRE_EMAIL_CONFIRMATION === true) -> ส่งรหัส OTP 6 หลัก
    // ============================================================
    // 4. บันทึกข้อมูลรอยืนยันลง localStorage (แฮชรหัสผ่านเรียบร้อย)
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    _devRegOtp = generatedOtp;

    _regPendingData = {
      username: u,
      displayName: d || u,
      email: em,
      phone: ph,
      password: hashedPassword,
      otp: generatedOtp,
      otpExpiry: Date.now() + (10 * 60 * 1000) // 10 minutes
    };
    try {
      localStorage.setItem('police_pending_register', JSON.stringify(_regPendingData));
    } catch(stErr) {}

    // 5. ส่ง Email OTP ผ่าน Google Apps Script (หรือโหมดทดสอบ)
    const gasRes = await sendOtpEmailViaGAS(em, generatedOtp, u, 'register');

    // สลับไป Step 2
    const step1 = document.getElementById('reg-step-1'); if (step1) step1.style.display = 'none';
    const step2 = document.getElementById('reg-step-2'); if (step2) step2.style.display = 'block';
    const emailTarget = document.getElementById('reg-otp-email-target');
    if (emailTarget) emailTarget.textContent = em;
    const otpInput = document.getElementById('reg-otp-code');
    if (otpInput) {
      otpInput.value = '';
      setTimeout(() => otpInput.focus(), 100);
    }

    if (gasRes && gasRes.success) {
      showRegNotice(`✅ ส่งรหัส OTP 6 หลักไปยัง <b>${maskEmail(em)}</b> แล้ว กรุณานำรหัสมากรอกด้านล่าง`);
    } else {
      showRegNotice(`⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP คือ: <strong style="font-size:20px;color:var(--accent);letter-spacing:2px">${generatedOtp}</strong><br><small style="color:var(--text2)">*เมื่อติดตั้ง Google Apps Script แล้ว รหัสจะถูกส่งเข้า Gmail อัตโนมัติ</small>`);
    }

    startRegCountdown();

  } catch (e) {
    console.error('requestRegisterOtp error:', e);
    showRegError('เกิดข้อผิดพลาด: ' + (e.message || 'ไม่สามารถส่งรหัสยืนยันได้ กรุณาลองใหม่'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล' : '✨ สมัครสมาชิก';
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
    btnResend.style.display = 'none';
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
        btnResend.style.display = 'inline-block';
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
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    _devRegOtp = generatedOtp;
    _regPendingData.otp = generatedOtp;
    _regPendingData.otpExpiry = Date.now() + (10 * 60 * 1000);

    const gasRes = await sendOtpEmailViaGAS(_regPendingData.email, generatedOtp, _regPendingData.username, 'register');

    if (gasRes && gasRes.success) {
      showRegNotice(`✅ ส่งรหัส OTP ใหม่ไปยัง <b>${maskEmail(_regPendingData.email)}</b> แล้ว`);
    } else {
      showRegNotice(`⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP ใหม่คือ: <strong style="font-size:20px;color:var(--accent);letter-spacing:2px">${generatedOtp}</strong>`);
    }

    startRegCountdown();
  } catch (e) {
    showRegError('ส่งใหม่อีกครั้งไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    if (btnResend) btnResend.textContent = 'ส่งรหัสอีกครั้ง';
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

  if (_regPendingData.otpExpiry && Date.now() > _regPendingData.otpExpiry) {
    showRegError('รหัส OTP หมดอายุแล้ว (เกิน 10 นาที) กรุณากดส่งรหัสใหม่อีกครั้ง');
    return;
  }

  const validOtp = _regPendingData.otp || _devRegOtp;
  if (validOtp && code !== validOtp) {
    showRegError('รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังยืนยัน...';
  }

  try {
    let authUser = null;
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
      .select('id, username, password, role, display_name, plan, status, subscription_until, phone, email, permissions, auth_id, avatar_url, notes')
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
  if (noticeEl) {
    if (!REQUIRE_EMAIL_CONFIRMATION) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = '⚙️ <b>[โหมดทดสอบ]</b> กรอก Username หรือ อีเมล เพื่อกำหนดรหัสผ่านใหม่ได้ทันที';
    } else {
      noticeEl.style.display = 'none';
      noticeEl.innerHTML = '';
    }
  }

  const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'block';
  const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'none';
  const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'none';
  const manualContainer = document.getElementById('forgot-otp-manual-container');
  if (manualContainer) manualContainer.style.display = 'none';

  const btn = document.getElementById('btn-forgot-request-otp');
  if (btn) {
    btn.disabled = false;
    btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล' : '🔑 ถัดไป: ตั้งรหัสผ่านใหม่';
  }

  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  _forgotPendingData = null;
  _devForgotOtp = null;

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('forgot-identity')?.focus(), 100);
  if (typeof startForgotCrossTabPoll === 'function') startForgotCrossTabPoll();
}

function closeForgotPasswordModal() {
  if (typeof stopForgotCrossTabPoll === 'function') stopForgotCrossTabPoll();
  window._isResetModalOpen = false;
  window._isPasswordResetActive = false;
  window._isPasswordRecoveryFlow = false;
  try { sessionStorage.removeItem('police_reset_modal_open'); } catch(e){}
  try { sessionStorage.removeItem('police_is_password_recovery'); } catch(e){}
  try { localStorage.removeItem('police_is_password_recovery'); } catch(e){}
  try { localStorage.removeItem('police_pending_reset'); } catch(e){}

  const modal = document.getElementById('modal-forgot-pwd');
  if (modal) modal.style.display = 'none';
  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  _forgotPendingData = null;
  _devForgotOtp = null;
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
      if (btn) {
        btn.disabled = false;
        btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งลิงก์ยืนยันทางอีเมล' : '🔑 ถัดไป: ตั้งรหัสผ่านใหม่';
      }
      return;
    }

    const user = users[0];

    // ============================================================
    // ถ้าปิดการยืนยันอีเมล (REQUIRE_EMAIL_CONFIRMATION === false) -> ข้ามไป Step 3 ตั้งรหัสใหม่ได้ทันที!
    // ============================================================
    if (!REQUIRE_EMAIL_CONFIRMATION) {
      openForgotStep3(user);
      const noticeStep3 = document.getElementById('forgot-notice');
      if (noticeStep3) {
        noticeStep3.style.display = 'block';
        noticeStep3.innerHTML = `⚙️ <b>[โหมดทดสอบ]</b> ตรวจพบบัญชี "<strong>${user.username}</strong>" เรียบร้อยแล้ว กรุณากำหนดรหัสผ่านใหม่ของคุณด้านล่าง`;
      }
      return;
    }

    // ============================================================
    // ถ้าเปิดการยืนยันอีเมล (REQUIRE_EMAIL_CONFIRMATION === true) -> ส่งลิงก์ยืนยันทางอีเมล
    // ============================================================
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

    if (btn) btn.textContent = 'กำลังส่งรหัส OTP...';

    // สร้างรหัส OTP 6 หลัก
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    _devForgotOtp = generatedOtp;
    _forgotPendingData = {
      id: user.id,
      username: user.username,
      email: user.email,
      otp: generatedOtp,
      otpExpiry: Date.now() + (10 * 60 * 1000), // 10 minutes
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

    // ส่งอีเมล OTP ผ่าน Google Apps Script (ส่งออกจาก Gmail ส่วนตัว ฟรี 100%)
    const gasRes = await sendOtpEmailViaGAS(user.email, generatedOtp, user.username, 'reset_password');

    // สลับไป Step 2
    const step1 = document.getElementById('forgot-step-1'); if (step1) step1.style.display = 'none';
    const step2 = document.getElementById('forgot-step-2'); if (step2) step2.style.display = 'block';
    const step3 = document.getElementById('forgot-step-3'); if (step3) step3.style.display = 'none';
    const targetEmailEl = document.getElementById('forgot-otp-email-target');
    if (targetEmailEl) targetEmailEl.textContent = maskEmail(user.email);
    const otpInp = document.getElementById('forgot-otp-code');
    if (otpInp) {
      otpInp.value = '';
      setTimeout(() => otpInp.focus(), 100);
    }

    if (gasRes && gasRes.success) {
      showForgotNotice(`✅ ส่งรหัส OTP 6 หลักไปยัง <b>${maskEmail(user.email)}</b> แล้ว กรุณานำรหัสมากรอกด้านล่าง`);
    } else {
      showForgotNotice(`⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP คือ: <strong style="font-size:20px;color:var(--accent);letter-spacing:2px">${generatedOtp}</strong><br><small style="color:var(--text2)">*เมื่อติดตั้ง Google Apps Script แล้ว รหัสจะถูกส่งเข้า Gmail อัตโนมัติ</small>`);
    }

    startForgotCountdown();

  } catch(e) {
    console.error('requestForgotPasswordOtp error:', e);
    showForgotError('ส่งรหัส OTP ไม่สำเร็จ: ' + (e.message || 'กรุณาลองใหม่อีกครั้ง'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = REQUIRE_EMAIL_CONFIRMATION ? '📩 ถัดไป: ส่งรหัส OTP ทางอีเมล' : '🔑 ถัดไป: ตั้งรหัสผ่านใหม่';
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
    btnResend.style.display = 'none';
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
        btnResend.style.display = 'inline-block';
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
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    _devForgotOtp = generatedOtp;
    _forgotPendingData.otp = generatedOtp;
    _forgotPendingData.otpExpiry = Date.now() + (10 * 60 * 1000);

    const gasRes = await sendOtpEmailViaGAS(_forgotPendingData.email, generatedOtp, _forgotPendingData.username, 'reset_password');

    if (gasRes && gasRes.success) {
      showForgotNotice(`✅ ส่งรหัส OTP ใหม่ไปยัง <b>${maskEmail(_forgotPendingData.email)}</b> แล้ว`);
    } else {
      showForgotNotice(`⚙️ <b>[โหมดทดสอบ]</b> รหัส OTP ใหม่คือ: <strong style="font-size:20px;color:var(--accent);letter-spacing:2px">${generatedOtp}</strong>`);
    }

    startForgotCountdown();
  } catch(e) {
    showForgotError('ส่งใหม่อีกครั้งไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    if (btnResend) btnResend.textContent = 'ส่งรหัสอีกครั้ง';
  }
}

function openForgotStep3(userData, isCrossTabSync) {
  window._isResetModalOpen = true;
  window._isPasswordResetActive = true;
  window._isPasswordRecoveryFlow = false;
  try { sessionStorage.setItem('police_reset_modal_open', 'true'); } catch(e){}
  _isOAuthProcessing = false;
  hideOAuthLoading();
  currentUser = null;

  if (userData) {
    _forgotPendingData = {
      id: userData.id,
      username: userData.username,
      email: userData.email,
      verified: true
    };
    if (!isCrossTabSync && typeof broadcastResetEvent === 'function') {
      try { broadcastResetEvent('STEP3_OPENED', _forgotPendingData); } catch(e){}
    }
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
    noticeEl.innerHTML = '✅ ยืนยันรหัส OTP สำเร็จแล้ว! กรุณากำหนดรหัสผ่านใหม่ของคุณด้านล่าง';
  }

  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('forgot-new-pass')?.focus(), 100);
}

async function verifyForgotOtp() {
  const code = (document.getElementById('forgot-otp-code')?.value || '').trim();
  const btn = document.getElementById('btn-forgot-verify-otp');
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

  if (_forgotPendingData.otpExpiry && Date.now() > _forgotPendingData.otpExpiry) {
    showForgotError('รหัส OTP หมดอายุแล้ว (เกิน 10 นาที) กรุณากดส่งรหัสใหม่อีกครั้ง');
    return;
  }

  const validOtp = _forgotPendingData.otp || _devForgotOtp;
  if (validOtp && code !== validOtp) {
    showForgotError('รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังยืนยัน...';
  }

  // ยืนยัน OTP ผ่านแล้ว -> เปิดหน้า Step 3 ให้ตั้งรหัสผ่านใหม่ทันทีในแท็บเดิม!
  if (_forgotTimer) { clearInterval(_forgotTimer); _forgotTimer = null; }
  _forgotPendingData.verified = true;
  openForgotStep3(_forgotPendingData);
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
    if (typeof broadcastResetEvent === 'function') {
      try { broadcastResetEvent('PASSWORD_CHANGED_SUCCESS', { username: resetUsername }); } catch(e){}
    }
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

// ============================================================
// Cross-Tab Synchronization (ระบบซิงค์สถานะข้ามแท็บอัตโนมัติ)
// ช่วยแก้ปัญหาเมื่อผู้ใช้เปิด Gmail ในแท็บใหม่แล้วคลิกลิงก์
// ให้แท็บเดิมอัปเดตสถานะตามทันที ไม่ค้างอยู่ที่หน้าเดิม
// ============================================================
let _lastAuthSyncHandledTime = 0;
let _forgotPollTimer = null;
let _authBc = null;

try {
  if (typeof BroadcastChannel !== 'undefined') {
    _authBc = new BroadcastChannel('police_auth_channel');
    _authBc.onmessage = (event) => {
      handleCrossTabAuthEvent(event.data);
    };
  }
} catch(e) {}

function broadcastResetEvent(action, data) {
  const payload = { action, data, time: Date.now() };
  if (_authBc) {
    try {
      _authBc.postMessage(payload);
    } catch(e) {}
  }
  try {
    localStorage.setItem('police_auth_broadcast', JSON.stringify(payload));
  } catch(e) {}
}

function handleCrossTabAuthEvent(msg) {
  if (!msg || !msg.action) return;
  if (msg.time && msg.time <= _lastAuthSyncHandledTime) return;
  _lastAuthSyncHandledTime = msg.time || Date.now();

  console.log('handleCrossTabAuthEvent received:', msg.action, msg.data);

  if (msg.action === 'STEP3_OPENED' && msg.data) {
    // ถ้าแท็บเดิมกำลังเปิดโมดัลลืมรหัสผ่านอยู่ (เช่น อยู่ Step 2 รอคลิกอีเมล) ให้สลับเป็น Step 3 ทันที!
    const modalForgot = document.getElementById('modal-forgot-pwd');
    if (modalForgot && modalForgot.style.display === 'flex') {
      const step3 = document.getElementById('forgot-step-3');
      if (!step3 || step3.style.display !== 'block') {
        console.log('Cross-tab sync: Step 3 opened in another tab, switching this tab to Step 3');
        openForgotStep3(msg.data, true);
        if (typeof showToast === 'function') {
          showToast('🔗 ตรวจพบการคลิกลิงก์ยืนยันจากอีกหน้าต่างหนึ่ง! กำลังเปิดหน้าตั้งรหัสผ่านใหม่ให้คุณ', 'info');
        }
      }
    }
  } else if (msg.action === 'PASSWORD_CHANGED_SUCCESS' && msg.data) {
    // ถ้ามีการเปลี่ยนรหัสผ่านสำเร็จจากอีกแท็บหนึ่ง -> ปิดโมดัลและเตรียมช่อง Username ให้พร้อมล็อกอินในแท็บนี้
    console.log('Cross-tab sync: Password changed in another tab, updating this tab');
    closeForgotPasswordModal();
    if (typeof showToast === 'function') {
      showToast('✅ ตั้งรหัสผ่านใหม่สำเร็จแล้วจากอีกหน้าต่างหนึ่ง! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่', 'success');
    }
    const userInp = document.getElementById('inp-user');
    if (userInp && msg.data.username) userInp.value = msg.data.username;
    const passInp = document.getElementById('inp-pass');
    if (passInp) {
      passInp.value = '';
      passInp.focus();
    }
  } else if (msg.action === 'REGISTER_SUCCESS') {
    if (typeof closeRegisterModal === 'function') closeRegisterModal();
    if (typeof showToast === 'function') {
      showToast('🎉 ยืนยันอีเมลสำเร็จเรียบร้อยแล้ว!', 'success');
    }
  }
}

function startForgotCrossTabPoll() {
  if (_forgotPollTimer) clearInterval(_forgotPollTimer);
  _lastAuthSyncHandledTime = Date.now() - 1000;
  _forgotPollTimer = setInterval(() => {
    try {
      const raw = localStorage.getItem('police_auth_broadcast');
      if (!raw) return;
      const msg = JSON.parse(raw);
      if (msg && msg.time && msg.time > _lastAuthSyncHandledTime) {
        handleCrossTabAuthEvent(msg);
      }
    } catch(e) {}
  }, 800);
}

function stopForgotCrossTabPoll() {
  if (_forgotPollTimer) {
    clearInterval(_forgotPollTimer);
    _forgotPollTimer = null;
  }
}

// ฟังผ่าน Storage Event (สำหรับ browser ที่ไม่แชร์ BroadcastChannel หรือเปิดคนละ context)
window.addEventListener('storage', (event) => {
  if (event.key === 'police_auth_broadcast' && event.newValue) {
    try {
      const msg = JSON.parse(event.newValue);
      handleCrossTabAuthEvent(msg);
    } catch(e) {}
  }
});


