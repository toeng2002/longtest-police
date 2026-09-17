/* ============================================================
/* ============================================================
   app-settings.js — เมนู "ตั้งค่า" ของผู้ดูแลระบบ
   จัดการ 4 อย่าง: หน่วยงาน / วิชา / ระดับความยาก / ผู้ใช้งาน
   ต้องโหลดหลัง exam-db.js (ใช้ supa, DELETE_PIN, showToast)

   หมายเหตุ: ตาราง difficulty_levels ต้องสร้างก่อน
   โดยรัน SQL ใน setup_settings.sql ถ้ายังไม่มี ระบบจะแจ้งเตือน
   ============================================================ */

const SET_DATA = {
  units: [],
  subjects: [],
  difficulty: [],
  users: [],
  counts: { units: {}, subjects: {}, difficulty: {} }
};

let setTab = 'units';
let setEditId = null;
let setDeleteTarget = null;
let setPinValue = '';
let setDiffTableMissing = false;

const LEVEL_LABEL = { p: 'ชั้นประทวน', s: 'ชั้นสัญญาบัตร', both: 'ทั้งสองระดับ' };
const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', user: 'ผู้ใช้', both: 'ทั้งสองโหมด' };
const ROLE_COLOR = { admin: 'red', user: 'blue', both: 'purple' };
const DIFF_COLORS = ['gray', 'green', 'yellow', 'red', 'blue', 'purple'];

// ตัวช่วยสร้าง HTML (กันเครื่องหมายพิเศษในข้อความ)
function esc(s) {
  return String(s == null ? '' : s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function tagHtml(text, color) {
  return '<span class="tag tag-' + (color || 'gray') + '">' + esc(text) + '</span>';
}

// ตัวคั่นระหว่างไอคอนกับชื่อ (สร้างจาก char code เพื่อกันปัญหาการ escape)
const ICON_SEP = String.fromCharCode(32) + String.fromCharCode(45) + String.fromCharCode(32);

// ป้ายไอคอน + ชื่อ (เช่น "✈️ - ตรวจคนเข้าเมือง")
function unitLabel(u, withIcon) {
  if (!u) return '';
  if (!withIcon || !u.icon) return u.name;
  return u.icon + ICON_SEP + u.name;
}

function dashCell() {
  return '<span style="color:var(--text3);font-size:12px">—</span>';
}

function countCell(n) {
  return n > 0 ? tagHtml(n + ' ข้อ', 'blue') : dashCell();
}

function editBtn(kind, id, fnName) {
  return '<button class="btn btn-icon btn-sm" style="color:var(--accent)" title="แก้ไข" ' +
    'onclick="' + fnName + '(\'' + kind + '\',' + id + ')">' +
    '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">' +
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
}

function delBtn(kind, id) {
  return '<button class="btn btn-icon btn-sm" style="color:var(--danger)" title="ลบ" ' +
    'onclick="openSetDelete(\'' + kind + '\',' + id + ')">' +
    '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>';
}

function actionCell(kind, id, canDelete) {
  return '<div style="display:flex;gap:3px">' + editBtn(kind, id, 'openSetForm') +
    (canDelete ? delBtn(kind, id) : '') + '</div>';
}

function loadingRow(cols) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:20px;color:var(--text2)">กำลังโหลด...</td></tr>';
}

function emptyRow(cols, msg) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:20px;color:var(--text2)">' + esc(msg) + '</td></tr>';
}

function errorRow(cols, msg) {
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:20px;color:var(--danger)">' +
    'โหลดไม่สำเร็จ: ' + esc(msg) + '</td></tr>';
}

function setBody(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
/* ============================================================
   แท็บ
   ============================================================ */
function switchSetTab(tab) {
  setTab = tab;
  document.querySelectorAll('#set-tabs .filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['units', 'subjects', 'difficulty', 'users'].forEach(t => {
    const pane = document.getElementById('set-tab-' + t);
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
  });
  loadSetTab(tab);
}

function loadSetTab(tab) {
  if (tab === 'units') loadSetUnits();
  else if (tab === 'subjects') loadSetSubjectUnits().then(loadSetSubjects);
  else if (tab === 'difficulty') loadSetDifficulty();
  else if (tab === 'users') loadSetUsers();
}

// เข้าเมนูตั้งค่าครั้งแรก → เตรียม dropdown หน่วยงานก่อน แล้วโหลดแท็บ
function initSettingsPage() {
  loadSetSubjectUnits().then(() => switchSetTab(setTab));
}
/* ============================================================
   นับจำนวนข้อสอบ (ใช้เตือนก่อนลบ)
   ============================================================ */
async function loadSetCounts() {
  const empty = { units: {}, subjects: {}, difficulty: {} };
  try {
    const qu = await supa.from('question_units').select('unit_id, questions(subject_id)');
    if (qu.error) throw qu.error;
    const counts = { units: {}, subjects: {}, difficulty: {} };
    (qu.data || []).forEach(r => {
      if (r.unit_id) counts.units[r.unit_id] = (counts.units[r.unit_id] || 0) + 1;
      const sid = r.questions && r.questions.subject_id;
      if (sid) counts.subjects[sid] = (counts.subjects[sid] || 0) + 1;
    });
    const qq = await supa.from('questions').select('difficulty');
    (qq.data || []).forEach(q => {
      if (q.difficulty) counts.difficulty[q.difficulty] = (counts.difficulty[q.difficulty] || 0) + 1;
    });
    SET_DATA.counts = counts;
  } catch (e) {
    console.warn('loadSetCounts error', e);
    SET_DATA.counts = empty;
  }
}

/* ============================================================
   โหลดรายการหน่วยงาน มาใส่ dropdown
   ============================================================ */
async function loadSetSubjectUnits() {
  const sel = document.getElementById('set-subj-unit');
  if (!sel) return;
  const keep = sel.value;

  if (SET_DATA.units.length === 0) {
    const { data } = await supa.from('units').select('*').order('id');
    SET_DATA.units = data || [];
  }
  const opts = SET_DATA.units.map(u =>
    '<option value="' + esc(u.id) + '">' + esc(unitLabel(u, true)) + '</option>').join('');
  sel.innerHTML = '<option value="">ทุกหน่วยงาน</option>' + opts;
  if (keep) sel.value = keep;
}

/* ============================================================
   1) หน่วยงาน
   ============================================================ */
async function loadSetUnits() {
  setBody('set-units-body', loadingRow(7));
  await loadSetCounts();

  const { data, error } = await supa.from('units').select('*').order('id');
  if (error) { setBody('set-units-body', errorRow(7, error.message)); return; }

  SET_DATA.units = data || [];
  if (SET_DATA.units.length === 0) {
    setBody('set-units-body', emptyRow(7, 'ยังไม่มีหน่วยงาน — กด "เพิ่มหน่วยงาน"'));
    return;
  }
  setBody('set-units-body', SET_DATA.units.map(u => {
    const n = SET_DATA.counts.units[u.id] || 0;
    const isActive = u.active !== false;
    const statusBtn = '<button class="btn btn-sm" onclick="toggleUnitActive(' + JSON.stringify(u.id) + ',' + (!isActive) + ')" ' +
      'style="font-size:12px;padding:3px 8px;cursor:pointer;' +
      (isActive ? 'background:var(--success-bg);color:var(--success);border:1px solid var(--success-border)' : 'background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-border)') + '" ' +
      'title="' + (isActive ? 'คลิกเพื่อปิดการเข้าใช้งาน' : 'คลิกเพื่อเปิดใช้งาน') + '">' +
      (isActive ? '🟢 เปิดใช้งาน' : '🔒 ปิดใช้งาน') + '</button>';
    return '<tr>' +
      '<td><span class="mono">' + esc(u.id) + '</span></td>' +
      '<td>' + esc(u.name) + '</td>' +
      '<td>' + esc(u.short_name || '-') + '</td>' +
      '<td style="font-size:18px">' + esc(u.icon || '-') + '</td>' +
      '<td>' + countCell(n) + '</td>' +
      '<td>' + statusBtn + '</td>' +
      '<td>' + actionCell('units', JSON.stringify(u.id), true) + '</td>' +
      '</tr>';
  }).join(''));
}

async function toggleUnitActive(id, newStatus) {
  try {
    const parsedId = isNaN(Number(id)) ? id : Number(id);
    const { error } = await supa.from('units').update({ active: newStatus }).eq('id', parsedId);
    if (error) {
      if (error.code === 'PGRST204' || (error.message && error.message.includes('active'))) {
        showToast('ยังไม่ได้รัน SQL: กรุณารัน migration_units_active.sql ใน Supabase ก่อน', 'danger');
      } else {
        showToast('ไม่สามารถเปลี่ยนสถานะได้: ' + error.message, 'danger');
      }
      return;
    }
    showToast((newStatus ? 'เปิดใช้งานหน่วยงานแล้ว' : 'ปิดการเข้าใช้งานหน่วยงานแล้ว'), 'success');
    await loadSetUnits();
    if (typeof _unitsCache !== 'undefined') _unitsCache = null;
    if (typeof _unitsListCache !== 'undefined') _unitsListCache = null;
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'danger');
  }
}


/* ============================================================
   2) วิชา
   ============================================================ */
async function loadSetSubjects() {
  setBody('set-subjects-body', loadingRow(6));
  await loadSetCounts();

  let q = supa.from('subjects').select('*').order('unit_id').order('id');
  const unitFilter = document.getElementById('set-subj-unit').value;
  const levelFilter = document.getElementById('set-subj-level').value;
  if (unitFilter) q = q.eq('unit_id', unitFilter);
  if (levelFilter) q = q.in('level', levelFilter === 'p' ? ['p', 'both'] : ['s', 'both']);

  const { data, error } = await q;
  if (error) { setBody('set-subjects-body', errorRow(6, error.message)); return; }

  SET_DATA.subjects = data || [];
  if (SET_DATA.subjects.length === 0) {
    setBody('set-subjects-body', emptyRow(6, 'ยังไม่มีวิชาในเงื่อนไขนี้ — กด "เพิ่มวิชา"'));
    return;
  }
  const unitMap = {};
  SET_DATA.units.forEach(u => { unitMap[u.id] = u; });

  setBody('set-subjects-body', SET_DATA.subjects.map(s => {
    const u = unitMap[s.unit_id];
    const n = SET_DATA.counts.subjects[s.id] || 0;
    const ratio = (s.ratio == null) ? '-' : s.ratio + '%';
    return '<tr>' +
      '<td>' + esc(s.name) + '</td>' +
      '<td style="font-size:12px;color:var(--text2)">' + esc(u ? (u.short_name || u.name) : s.unit_id) + '</td>' +
      '<td>' + tagHtml(LEVEL_LABEL[s.level] || s.level, s.level === 'p' ? 'blue' : 'purple') + '</td>' +
      '<td>' + esc(ratio) + '</td>' +
      '<td>' + countCell(n) + '</td>' +
      '<td>' + actionCell('subjects', s.id, true) + '</td>' +
      '</tr>';
  }).join(''));
}
/* ============================================================
   3) ระดับความยาก — ตาราง difficulty_levels
   ============================================================ */
async function loadSetDifficulty() {
  setBody('set-diff-body', loadingRow(6));
  const warn = document.getElementById('set-diff-warning');

  const { data, error } = await supa.from('difficulty_levels')
    .select('*').order('sort_order').order('id');

  if (error) {
    setDiffTableMissing = true;
    SET_DATA.difficulty = [];
    if (warn) {
      warn.style.display = 'flex';
      warn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/></svg>' +
        '<div><b>ยังไม่มีตาราง difficulty_levels</b><br>' +
        'ต้องสร้างตารางก่อน โดยรัน SQL ในไฟล์ <b>setup_settings.sql</b> ที่ Supabase → SQL Editor<br>' +
        '<span style="font-size:11px;opacity:.8">รายละเอียด: ' + esc(error.message) + '</span></div>';
    }
    setBody('set-diff-body', emptyRow(6, 'ต้องสร้างตาราง difficulty_levels ก่อนจึงจะเพิ่มได้'));
    return;
  }

  setDiffTableMissing = false;
  if (warn) warn.style.display = 'none';
  SET_DATA.difficulty = data || [];
  await loadSetCounts();

  if (SET_DATA.difficulty.length === 0) {
    setBody('set-diff-body', emptyRow(6, 'ยังไม่มีระดับความยาก — กด "เพิ่มระดับความยาก"'));
    return;
  }
  setBody('set-diff-body', SET_DATA.difficulty.map(d => {
    const n = SET_DATA.counts.difficulty[d.code] || 0;
    const order = (d.sort_order == null) ? '-' : d.sort_order;
    return '<tr>' +
      '<td><span class="mono">' + esc(d.code) + '</span></td>' +
      '<td>' + esc(d.name) + '</td>' +
      '<td>' + tagHtml(d.color || 'gray', d.color || 'gray') + '</td>' +
      '<td>' + esc(order) + '</td>' +
      '<td>' + countCell(n) + '</td>' +
      '<td>' + actionCell('difficulty', d.id, true) + '</td>' +
      '</tr>';
  }).join(''));
}

/* ============================================================
   4) ผู้ใช้งาน
   ============================================================ */
async function loadSetUsers() {
  setBody('set-users-body', loadingRow(5));

  const { data, error } = await supa.from('users')
    .select('id, username, role, display_name, created_at').order('id');
  if (error) { setBody('set-users-body', errorRow(5, error.message)); return; }

  SET_DATA.users = data || [];
  if (SET_DATA.users.length === 0) {
    setBody('set-users-body', emptyRow(5, 'ยังไม่มีผู้ใช้'));
    return;
  }

  setBody('set-users-body', SET_DATA.users.map(u => {
    const isMe = currentUser && currentUser.id === u.id;
    const created = u.created_at
      ? new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
      : '-';
    const meTag = isMe ? tagHtml('คุณ', 'green') : '';
    return '<tr>' +
      '<td>' + esc(u.username) + meTag + '</td>' +
      '<td style="color:var(--text2);font-size:12px">' + esc(u.display_name || '-') + '</td>' +
      '<td>' + tagHtml(ROLE_LABEL[u.role] || u.role, ROLE_COLOR[u.role] || 'gray') + '</td>' +
      '<td style="font-size:12px;color:var(--text2)">' + esc(created) + '</td>' +
      '<td>' + actionCell('users', u.id, !isMe) + '</td>' +
      '</tr>';
  }).join(''));
}
/* ============================================================
   ฟอร์มเพิ่ม / แก้ไข (modal เดียวใช้ทั้ง 4 แท็บ)
   ============================================================ */
function fieldHtml(id, label, value, opts) {
  opts = opts || {};
  const req = opts.required ? ' <span class="required">*</span>' : '';
  const hint = opts.hint
    ? '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + esc(opts.hint) + '</div>'
    : '';
  const wrapOpen = '<div class="form-group" style="margin-bottom:14px">';
  const labelHtml = '<label class="form-label">' + esc(label) + req + '</label>';

  if (opts.type === 'select') {
    return wrapOpen + labelHtml + '<select id="' + id + '">' + (opts.options || '') + '</select>' + hint + '</div>';
  }
  const ro = opts.readonly
    ? ' readonly style="background:var(--surface2);color:var(--text2)"'
    : '';
  const ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
  const v = (value == null) ? '' : value;
  return wrapOpen + labelHtml +
    '<input type="' + (opts.type || 'text') + '" id="' + id + '" value="' + esc(v) + '"' + ph + ro + '>' +
    hint + '</div>';
}

function optionHtml(value, label, selected) {
  return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
}

function openSetForm(kind, id) {
  setEditId = (id == null) ? null : id;
  const editing = setEditId !== null;
  const fields = document.getElementById('set-modal-fields');
  const err = document.getElementById('set-modal-error');
  const modal = document.getElementById('set-modal');
  if (err) err.style.display = 'none';

  const labels = { units: 'หน่วยงาน', subjects: 'วิชา', difficulty: 'ระดับความยาก', users: 'ผู้ใช้' };
  document.getElementById('set-modal-title').textContent = (editing ? 'แก้ไข' : 'เพิ่ม') + (labels[kind] || '');
  document.getElementById('set-modal-sub').textContent =
    editing ? 'แก้ไขข้อมูลแล้วกดบันทึก' : 'กรอกข้อมูลให้ครบแล้วกดบันทึก';

  if (kind === 'units') {
    const u = editing ? SET_DATA.units.find(x => String(x.id) === String(setEditId)) : null;
    const isActive = u ? (u.active !== false) : true;
    fields.innerHTML =
      (editing ? fieldHtml('f-id', 'ID หน่วยงาน (ตัวเลข)', u ? u.id : '', { readonly: true }) : '') +
      fieldHtml('f-code', 'รหัสอ้างอิง (code)', u ? (u.code || u.id) : '', {
        required: true, placeholder: 'เช่น tm หรือ jr',
        hint: 'ตัวพิมพ์เล็ก a-z, 0-9, _ เช่น tm หรือ jr'
      }) +
      fieldHtml('f-name', 'ชื่อหน่วยงาน', u ? u.name : '', {
        required: true, placeholder: 'เช่น ตรวจคนเข้าเมือง'
      }) +
      fieldHtml('f-short', 'ชื่อย่อ', u ? u.short_name : '', { placeholder: 'เช่น ตม.' }) +
      fieldHtml('f-icon', 'ไอคอน (emoji)', u ? u.icon : '', { placeholder: 'เช่น ✈️' }) +
      '<div class="form-group" style="margin-bottom:14px">' +
        '<label class="form-label">สถานะการเข้าใช้งาน</label>' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:4px 0">' +
          '<input type="checkbox" id="f-unit-active" ' + (isActive ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer">' +
          '<span>เปิดให้ผู้ใช้เข้าทำข้อสอบหน่วยงานนี้</span>' +
        '</label>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:2px">หากปิด ผู้ใช้จะไม่สามารถเลือกสอบในหน่วยนี้ได้</div>' +
      '</div>';
  }

  else if (kind === 'subjects') {
    const s = editing ? SET_DATA.subjects.find(x => x.id === setEditId) : null;
    const unitOpts = SET_DATA.units.map(x =>
      optionHtml(x.id, unitLabel(x, true), s && s.unit_id === x.id)).join('');
    const lvOpts = ['p', 's', 'both'].map(l =>
      optionHtml(l, LEVEL_LABEL[l], s && s.level === l)).join('');
    fields.innerHTML =
      fieldHtml('f-name', 'ชื่อวิชา', s ? s.name : '', {
        required: true, placeholder: 'เช่น กฎหมาย ตม.'
      }) +
      fieldHtml('f-unit', 'หน่วยงาน', null, { type: 'select', options: unitOpts, required: true }) +
      fieldHtml('f-level', 'ระดับชั้น', null, { type: 'select', options: lvOpts, required: true }) +
      fieldHtml('f-ratio', 'สัดส่วนคะแนน (%)', s ? s.ratio : '', {
        type: 'number', placeholder: 'เช่น 30', hint: 'ใช้แสดงสัดส่วนในหน้า "จำลองสอบจริง"'
      });
  }

  else if (kind === 'difficulty') {
    if (setDiffTableMissing) {
      showSetError('ยังไม่มีตาราง difficulty_levels — กรุณารัน SQL ใน setup_settings.sql ก่อน');
      return;
    }
    const d = editing ? SET_DATA.difficulty.find(x => x.id === setEditId) : null;
    const colorOpts = DIFF_COLORS.map(c => optionHtml(c, c, d && d.color === c)).join('');
    fields.innerHTML =
      fieldHtml('f-code', 'รหัส (ภาษาอังกฤษ)', d ? d.code : '', {
        required: true, readonly: editing, placeholder: 'เช่น easy',
        hint: editing ? 'แก้รหัสไม่ได้ เพราะถูกอ้างอิงในข้อสอบแล้ว' : 'ใช้ a-z, 0-9, _ จะถูกเก็บลงข้อสอบ'
      }) +
      fieldHtml('f-name', 'ชื่อที่แสดง', d ? d.name : '', { required: true, placeholder: 'เช่น ง่าย' }) +
      fieldHtml('f-color', 'สี', null, { type: 'select', options: colorOpts }) +
      fieldHtml('f-order', 'ลำดับการแสดง', d ? d.sort_order : (SET_DATA.difficulty.length + 1), { type: 'number' });
  }

  else if (kind === 'users') {
    const u = editing ? SET_DATA.users.find(x => x.id === setEditId) : null;
    const roleOpts = ['user', 'admin', 'both'].map(r =>
      optionHtml(r, ROLE_LABEL[r], u && u.role === r)).join('');
    fields.innerHTML =
      fieldHtml('f-username', 'ชื่อผู้ใช้ (username)', u ? u.username : '', {
        required: true, readonly: editing, placeholder: 'เช่น user001',
        hint: editing ? 'แก้ username ไม่ได้' : 'ใช้สำหรับล็อกอิน ต้องไม่ซ้ำกับคนอื่น'
      }) +
      fieldHtml('f-display', 'ชื่อที่แสดง', u ? u.display_name : '', { placeholder: 'เช่น สมชาย ใจดี' }) +
      fieldHtml('f-role', 'สิทธิ์การใช้งาน', null, { type: 'select', options: roleOpts, required: true }) +
      fieldHtml('f-pass', editing ? 'รหัสผ่านใหม่' : 'รหัสผ่าน', '', {
        type: 'password', required: !editing,
        placeholder: editing ? 'เว้นว่าง = ใช้รหัสเดิม' : 'อย่างน้อย 6 ตัวอักษร',
        hint: editing ? 'กรอกเฉพาะเมื่อต้องการเปลี่ยนรหัสผ่าน' : null
      });
  }

  modal.dataset.kind = kind;
  modal.classList.add('open');
  setTimeout(() => {
    const f = fields.querySelector('input:not([readonly]), select');
    if (f) f.focus();
  }, 100);
}

function closeSetModal() {
  document.getElementById('set-modal').classList.remove('open');
  setEditId = null;
}

function showSetError(msg) {
  const err = document.getElementById('set-modal-error');
  err.style.display = 'block';
  err.textContent = msg;
}
/* ============================================================
   บันทึกข้อมูล
   ============================================================ */
function fieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

const CODE_PATTERN = /^[a-z0-9_]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function checkCode(code) {
  if (!code) return 'กรุณากรอกรหัส';
  if (!CODE_PATTERN.test(code)) return 'รหัสใช้ได้เฉพาะ a-z, 0-9 และ _ เท่านั้น';
  return null;
}

// แสดงข้อความ error แล้วคืน true ถ้ามีปัญหา
function failIf(msg) {
  if (msg) { showSetError(msg); return true; }
  return false;
}

async function saveSetForm() {
  const kind = document.getElementById('set-modal').dataset.kind;
  const editing = setEditId !== null;
  const err = document.getElementById('set-modal-error');
  if (err) err.style.display = 'none';

  try {
    if (kind === 'units') return await saveUnit(editing);
    if (kind === 'subjects') return await saveSubject(editing);
    if (kind === 'difficulty') return await saveDifficulty(editing);
    if (kind === 'users') return await saveUser(editing);
  } catch (e) {
    console.error('saveSetForm error', e);
    showSetError('เกิดข้อผิดพลาด: ' + e.message);
  }
}

async function saveUnit(editing) {
  const code = fieldValue('f-code');
  const bad = checkCode(code);
  if (failIf(bad)) return;
  const name = fieldValue('f-name');
  if (failIf(!name ? 'กรุณากรอกชื่อหน่วยงาน' : null)) return;

  const activeEl = document.getElementById('f-unit-active');
  const activeVal = activeEl ? activeEl.checked : true;

  const row = {
    code: code,
    name: name,
    short_name: fieldValue('f-short') || null,
    icon: fieldValue('f-icon') || null,
    active: activeVal
  };
  const res = editing
    ? await supa.from('units').update(row).eq('id', setEditId)
    : await supa.from('units').insert(row);
  if (res.error) {
    if (res.error.code === 'PGRST204' || (res.error.message && res.error.message.includes('active'))) {
      showSetError('ยังไม่ได้รัน SQL: กรุณารัน migration_units_active.sql ใน Supabase ก่อน');
    } else {
      showSetError(res.error.message);
    }
    return;
  }

  showToast(editing ? 'แก้ไขหน่วยงานแล้ว' : 'เพิ่มหน่วยงานแล้ว', 'success');
  closeSetModal();
  loadSetUnits();
  loadSetSubjectUnits();
  if (typeof _unitsCache !== 'undefined') _unitsCache = null;
  if (typeof _unitsListCache !== 'undefined') _unitsListCache = null;
}

async function saveSubject(editing) {
  const name = fieldValue('f-name');
  if (failIf(!name ? 'กรุณากรอกชื่อวิชา' : null)) return;
  const unitId = fieldValue('f-unit');
  if (failIf(!unitId ? 'กรุณาเลือกหน่วยงาน' : null)) return;

  const parsedUnitId = isNaN(Number(unitId)) ? unitId : Number(unitId);
  const row = { name: name, unit_id: parsedUnitId, level: fieldValue('f-level') || 'p' };

  const ratioRaw = fieldValue('f-ratio');
  if (ratioRaw !== '') {
    const r = Number(ratioRaw);
    if (isNaN(r) || r < 0 || r > 100) { showSetError('สัดส่วนต้องเป็นตัวเลข 0-100'); return; }
    row.ratio = r;
  }

  const res = editing
    ? await supa.from('subjects').update(row).eq('id', setEditId)
    : await supa.from('subjects').insert(row);
  if (failIf(res.error ? res.error.message : null)) return;

  showToast(editing ? 'แก้ไขวิชาแล้ว' : 'เพิ่มวิชาแล้ว', 'success');
  closeSetModal();
  loadSetSubjects();
}

async function saveDifficulty(editing) {
  const code = fieldValue('f-code');
  const bad = checkCode(code);
  if (failIf(bad)) return;
  const name = fieldValue('f-name');
  if (failIf(!name ? 'กรุณากรอกชื่อที่แสดง' : null)) return;

  const orderRaw = fieldValue('f-order');
  const row = {
    code: code,
    name: name,
    color: fieldValue('f-color') || 'gray',
    sort_order: orderRaw === '' ? 0 : Number(orderRaw)
  };
  const res = editing
    ? await supa.from('difficulty_levels').update(row).eq('id', setEditId)
    : await supa.from('difficulty_levels').insert(row);
  if (failIf(res.error ? res.error.message : null)) return;

  showToast(editing ? 'แก้ไขระดับความยากแล้ว' : 'เพิ่มระดับความยากแล้ว', 'success');
  closeSetModal();
  loadSetDifficulty();
  if (typeof loadDifficultyOptions === 'function') loadDifficultyOptions();
}

async function saveUser(editing) {
  const username = fieldValue('f-username');
  if (failIf(!username ? 'กรุณากรอกชื่อผู้ใช้' : null)) return;
  if (failIf(!USERNAME_PATTERN.test(username) ? 'ชื่อผู้ใช้ได้เฉพาะ a-z A-Z 0-9 _ . -' : null)) return;

  const pass = fieldValue('f-pass');
  if (!editing && !pass) { showSetError('กรุณากรอกรหัสผ่าน'); return; }
  if (pass && pass.length < 6) { showSetError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }

  if (!editing) {
    const dup = await supa.from('users').select('id').eq('username', username).maybeSingle();
    if (dup.data) { showSetError('มีชื่อผู้ใช้นี้อยู่แล้ว'); return; }
  }

  const role = fieldValue('f-role') || 'user';
  const row = { username: username, role: role, display_name: fieldValue('f-display') || null };
  if (pass) row.password = pass;

  const res = editing
    ? await supa.from('users').update(row).eq('id', setEditId)
    : await supa.from('users').insert(row);
  if (failIf(res.error ? res.error.message : null)) return;

  // แก้ข้อมูลของตัวเอง → อัปเดตชื่อบน topbar ด้วย
  if (editing && currentUser && currentUser.id === setEditId) {
    currentUser.username = username;
    currentUser.role = role;
    currentUser.display_name = row.display_name;
    const an = document.getElementById('admin-username');
    if (an) an.textContent = username;
  }

  showToast(editing ? 'แก้ไขผู้ใช้แล้ว' : 'เพิ่มผู้ใช้แล้ว', 'success');
  closeSetModal();
  loadSetUsers();
}
/* ============================================================
   ลบข้อมูล — มี PIN ยืนยัน + เช็คว่ามีข้อสอบอ้างอิงอยู่ไหม
   ============================================================ */
function setDeleteInfo(kind, id) {
  if (kind === 'units') {
    const u = SET_DATA.units.find(x => x.id === id);
    const n = SET_DATA.counts.units[id] || 0;
    return {
      label: u ? unitLabel(u, true) : String(id),
      table: 'units', col: 'id', val: id, block: false,
      lines: n > 0 ? [n + ' ข้อสอบในหน่วยนี้ — ข้อสอบจะยังอยู่ แต่จะไม่ปรากฏในหน่วยนี้แล้ว'] : []
    };
  }
  if (kind === 'subjects') {
    const s = SET_DATA.subjects.find(x => x.id === id);
    const n = SET_DATA.counts.subjects[id] || 0;
    return {
      label: s ? s.name : ('#' + id),
      table: 'subjects', col: 'id', val: id, block: n > 0,
      lines: n > 0 ? ['มีข้อสอบใช้วิชานี้ ' + n + ' ข้อ — ต้องย้ายหรือลบข้อสอบเหล่านั้นก่อน'] : []
    };
  }
  if (kind === 'difficulty') {
    const d = SET_DATA.difficulty.find(x => x.id === id);
    const n = d ? (SET_DATA.counts.difficulty[d.code] || 0) : 0;
    return {
      label: d ? (d.name + ' (' + d.code + ')') : ('#' + id),
      table: 'difficulty_levels', col: 'id', val: id, block: n > 0,
      lines: n > 0 ? ['มีข้อสอบใช้ระดับนี้ ' + n + ' ข้อ — ต้องเปลี่ยนระดับของข้อสอบเหล่านั้นก่อน'] : []
    };
  }
  const u = SET_DATA.users.find(x => x.id === id);
  return {
    label: u ? (u.username + (u.display_name ? ' (' + u.display_name + ')' : '')) : ('#' + id),
    table: 'users', col: 'id', val: id, block: false,
    lines: ['บัญชีนี้จะล็อกอินเข้าระบบไม่ได้อีก']
  };
}

function openSetDelete(kind, id) {
  const info = setDeleteInfo(kind, id);
  if (info.block) {
    showToast(info.lines[0], 'danger');
    return;
  }
  setDeleteTarget = { kind: kind, id: id, info: info };

  const rows = ['<div style="font-size:11px;font-weight:500;color:var(--danger);margin-bottom:6px">รายการที่จะถูกลบ</div>',
    '<div class="del-item"><span style="flex-shrink:0">—</span><span>' + esc(info.label) + '</span></div>']
    .concat(info.lines.map(t => '<div class="del-item"><span style="flex-shrink:0">!</span><span>' + esc(t) + '</span></div>'));
  document.getElementById('set-del-list').innerHTML = rows.join('');

  document.getElementById('set-pin-err').textContent = '';
  document.getElementById('set-btn-confirm-del').disabled = true;
  setPinValue = '';

  const box = document.getElementById('set-pin-inputs');
  box.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const inp = document.createElement('input');
    inp.type = 'password';
    inp.maxLength = 1;
    inp.dataset.idx = i;
    inp.addEventListener('input', onSetPinInput);
    inp.addEventListener('keydown', onSetPinKey);
    box.appendChild(inp);
  }
  document.getElementById('set-del-modal').classList.add('open');
  setTimeout(() => { if (box.children[0]) box.children[0].focus(); }, 100);
}

function onSetPinInput(e) {
  const inp = e.target;
  const idx = Number(inp.dataset.idx);
  inp.classList.remove('pin-err');
  if (inp.value) {
    const next = inp.parentElement.children[idx + 1];
    if (next) next.focus();
  }
  updateSetPin();
}

function onSetPinKey(e) {
  const inp = e.target;
  const idx = Number(inp.dataset.idx);
  if (e.key === 'Backspace' && !inp.value && idx > 0) {
    inp.parentElement.children[idx - 1].focus();
  }
}

function updateSetPin() {
  const inputs = Array.prototype.slice.call(document.getElementById('set-pin-inputs').children);
  setPinValue = inputs.map(i => i.value).join('');
  const btn = document.getElementById('set-btn-confirm-del');
  const errEl = document.getElementById('set-pin-err');

  if (setPinValue.length !== 6) { btn.disabled = true; return; }

  if (setPinValue === DELETE_PIN) {
    btn.disabled = false;
    errEl.textContent = '';
    inputs.forEach(i => i.classList.remove('pin-err'));
    return;
  }
  btn.disabled = true;
  errEl.textContent = 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่';
  inputs.forEach(i => i.classList.add('pin-err'));
  setTimeout(() => {
    inputs.forEach(i => { i.value = ''; i.classList.remove('pin-err'); });
    if (inputs[0]) inputs[0].focus();
    setPinValue = '';
    errEl.textContent = '';
  }, 800);
}

function closeSetDelModal() {
  document.getElementById('set-del-modal').classList.remove('open');
  setDeleteTarget = null;
  setPinValue = '';
}

async function confirmSetDelete() {
  if (!setDeleteTarget) return;
  const target = setDeleteTarget;
  const btn = document.getElementById('set-btn-confirm-del');
  btn.disabled = true;
  btn.textContent = 'กำลังลบ...';

  try {
    if (target.kind === 'users' && currentUser && currentUser.id === target.id) {
      showToast('ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้', 'danger');
      closeSetDelModal();
      return;
    }

    const res = await supa.from(target.info.table).delete().eq(target.info.col, target.info.val);
    if (res.error) {
      showToast('ลบไม่สำเร็จ: ' + res.error.message, 'danger');
      closeSetDelModal();
      return;
    }

    showToast('ลบแล้ว', 'success');
    closeSetDelModal();

    if (target.kind === 'units') { loadSetUnits(); loadSetSubjectUnits(); }
    else if (target.kind === 'subjects') loadSetSubjects();
    else if (target.kind === 'difficulty') loadSetDifficulty();
    else loadSetUsers();
  } catch (e) {
    console.error('confirmSetDelete error', e);
    showToast('ลบไม่สำเร็จ: ' + e.message, 'danger');
    closeSetDelModal();
  } finally {
    btn.textContent = 'ลบ';
  }
}

/* ============================================================
   โหลดตัวเลือกระดับความยากจากฐานข้อมูล (ใช้ในฟอร์มเพิ่มข้อสอบ)
   ถ้าตารางยังไม่มี จะถอยไปใช้ค่าเริ่มต้น easy/medium/hard
   ============================================================ */
async function loadDifficultyOptions() {
  const sel = document.getElementById('q-difficulty');
  if (!sel) return;

  const FALLBACK = [
    { code: 'easy', name: 'ง่าย', sort_order: 1 },
    { code: 'medium', name: 'ปานกลาง', sort_order: 2 },
    { code: 'hard', name: 'ยาก', sort_order: 3 }
  ];

  let list = null;
  try {
    const { data, error } = await supa.from('difficulty_levels').select('*').order('sort_order').order('id');
    if (!error && data && data.length) list = data;
  } catch (e) { /* ใช้ค่า fallback */ }
  if (!list) list = FALLBACK;

  const keep = sel.value;
  sel.innerHTML = list.map(d =>
    optionHtml(d.code, d.name, keep ? d.code === keep : d.code === 'medium')).join('');
}

/* ============================================================
   ปิด modal ด้วยการคลิกพื้นหลัง / ปุ่ม Esc
   ============================================================ */
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'set-modal') closeSetModal();
  if (e.target && e.target.id === 'set-del-modal') closeSetDelModal();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeSetModal();
  closeSetDelModal();
});
/* ============================================================
   โหลดตัวเลือก "หน่วยงาน" ในฟอร์มเพิ่มข้อสอบ จากฐานข้อมูลจริง
   เดิมเป็น HTML เขียนตายตัว 6 หน่วย ทำให้หน่วยใหม่ที่เพิ่ม
   ในเมนูตั้งค่าไม่โผล่ในฟอร์ม
   ============================================================ */

const CHIP_SEP = String.fromCharCode(32);   // ช่องว่าง

// สร้าง chip หนึ่งอัน: <label class="check-chip"><input type="checkbox" value="ID"> 😀 ชื่อ</label>
function unitChipHtml(u, checked) {
  const cls = checked ? 'check-chip on' : 'check-chip';
  const ck = checked ? ' checked' : '';
  const label = (u.icon ? u.icon + CHIP_SEP : '') + u.name;
  return '<label class="' + cls + '" onclick="toggleChip(this,event)">' +
    '<input type="checkbox" value="' + esc(u.id) + '"' + ck + ' style="display:none"> ' +
    esc(label) + '</label>';
}

// โหลดหน่วยงานทั้งหมดลง #unit-checks
// keepChecked = รายการ id ที่ผู้ใช้ติ๊กไว้อยู่แล้ว (ไม่ให้หายตอนโหลดซ้ำ)
async function loadUnitChips(keepChecked) {
  const box = document.getElementById('unit-checks');
  if (!box) return;

  box.innerHTML = '<span style="font-size:12px;color:var(--text3)">กำลังโหลดหน่วยงาน...</span>';

  const { data, error } = await supa.from('units').select('*').order('id');
  if (error || !data || data.length === 0) {
    box.innerHTML = '<span style="font-size:12px;color:var(--danger)">' +
      (error ? 'โหลดหน่วยงานไม่สำเร็จ: ' + esc(error.message)
             : 'ยังไม่มีหน่วยงาน — เพิ่มได้ที่เมนู ตั้งค่า → หน่วยงาน') + '</span>';
    return;
  }

  // เลือกค่าเริ่มต้น: คงอันที่ติ๊กไว้ ถ้าไม่มีให้เลือก ตม. ก่อน (มีวิชาเยอะสุด)
  let keep;
  if (keepChecked && keepChecked.length) {
    keep = keepChecked.map(String);
  } else {
    const preferred = data.filter(u => u.id === 'tm' || u.id === 1 || u.code === 'tm');
    keep = [String(preferred.length ? preferred[0].id : data[0].id)];
  }

  box.innerHTML = data.map(u => unitChipHtml(u, keep.indexOf(String(u.id)) !== -1)).join('');
  updateChipNotice();
}

// อ่านรายการหน่วยที่ติ๊กอยู่ตอนนี้ (ใช้ตอนโหลดซ้ำ/สลับโหมด)
function checkedUnitIds() {
  const box = document.getElementById('unit-checks');
  if (!box) return [];
  return Array.prototype.slice.call(box.querySelectorAll('.check-chip.on input'))
    .map(i => i.value);
}

// เดิมอ่านหน่วยจาก textContent ซึ่งเปราะบาง (ชื่อหน่วยมีช่องว่าง/emoji ได้)
// เปลี่ยนมาอ่านจาก value ของ input แทน
function readCheckedUnits() {
  return checkedUnitIds();
}
/* ============================================================
   ตัวเลือก "วิชา" ในฟอร์มเพิ่มข้อสอบ
   ลำดับการทำงาน:
     1) dropdown ดึงรายชื่อจากตาราง subject_lookup (ทะเบียนวิชา)
     2) ถ้ายังไม่มีตาราง subject_lookup จะถอยไปใช้ subjects แทน
     3) ตอนกดบันทึก → saveQuestion() จะบันทึก subject_id ลงตาราง questions
        ซึ่งเป็น table ที่เก็บข้อมูลจริง (ไม่ใช่ตัว lookup)
   ============================================================ */

let SUBJ_LIST = [];         // รายวิชาสำหรับกรอง (จากตาราง subjects)
let SUBJ_MASTER = [];       // ทะเบียนวิชาสำหรับ dropdown (จาก subject_lookup)
let lookupTableReady = false;

// โหลดทะเบียนวิชาจาก subject_lookup — คืน true ถ้าตารางมีอยู่
async function loadSubjectMaster() {
  try {
    const { data, error } = await supa
      .from('subject_lookup')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .order('name');
    if (error) throw error;
    SUBJ_MASTER = data || [];
    lookupTableReady = true;
    return true;
  } catch (e) {
    // ยังไม่ได้สร้างตาราง → ใช้ subjects แทน
    console.warn('subject_lookup ยังไม่พร้อม ใช้ subjects แทน:', e.message);
    SUBJ_MASTER = [];
    lookupTableReady = false;
    return false;
  }
}

// โหลดรายวิชาจริง (subjects) สำหรับกรองตามหน่วย+ระดับ
async function loadSubjectList() {
  try {
    const { data, error } = await supa.from('subjects').select('*').order('name');
    if (error) throw error;
    SUBJ_LIST = data || [];
  } catch (e) {
    console.warn('loadSubjectList error', e);
    SUBJ_LIST = [];
  }
  return SUBJ_LIST;
}

// วิชาที่ใช้ได้กับหน่วย + ระดับ ที่เลือก
function subjectsFor(unitId, level) {
  if (!unitId) return [];
  const lv = level === 'p' ? ['p', 'both']
           : level === 's' ? ['s', 'both']
           : ['p', 's', 'both'];
  return SUBJ_LIST.filter(s => s.unit_id === unitId && lv.indexOf(s.level) !== -1);
}

// รายการที่จะใส่ใน dropdown
// - ถ้ามี subject_lookup → ใช้ทะเบียนนั้น แล้วเติม (ไม่มีในทะเบียน) จาก subjects
// หา subject ที่ตรงชื่อนี้ (ไม่จำกัดหน่วย) — ใช้เมื่อหน่วยที่เลือกยังไม่มีวิชานั้น
function findSubjectAnyUnit(name, level) {
  const lv = level === 'p' ? ['p', 'both'] : level === 's' ? ['s', 'both'] : ['p', 's', 'both'];
  const same = SUBJ_LIST.filter(s => s.name === name);
  if (same.length === 0) return null;
  // เอาตัวที่ตรงระดับก่อน ถ้าไม่มีก็เอาตัวแรก
  return same.filter(s => lv.indexOf(s.level) !== -1)[0] || same[0];
}

// รายการวิชาทั้งหมดที่จะใส่ใน dropdown (ไม่ซ้ำชื่อ)
// วิชาทุกตัวเลือกได้เสมอ — ถ้าหน่วยที่เลือกยังไม่มีวิชานั้น
// ระบบจะเก็บ unit_id/level ใหม่ตอนบันทึก (ดู ensureSubjectForUnit)
function allSubjectItems() {
  const names = [];
  const subjById = {};
  const iconByName = {};

  SUBJ_LIST.forEach(s => {
    if (!s.name) return;
    if (names.indexOf(s.name) === -1) {
      names.push(s.name);
      iconByName[s.name] = s.icon || null;
    }
  });
  // เพิ่มชื่อจากทะเบียน lookup ด้วย (ถ้ามีตาราง)
  SUBJ_MASTER.forEach(m => {
    if (!m.name) return;
    if (names.indexOf(m.name) === -1) names.push(m.name);
    if (m.icon) iconByName[m.name] = m.icon;
  });
  names.sort((a, b) => a.localeCompare(b, 'th'));
  return names.map(n => ({ name: n, icon: iconByName[n] || '📄' }));
}

// จำนวนวิชาที่เลือกได้
function subjectDropdownItems(unitId, level) {
  return allSubjectItems();
}


// ตัวเลือกที่ยังไม่ผูกกับหน่วยนี้ — แสดงให้เห็นแต่เลือกไม่ได้
function disabledOption(it) {
  const text = it.icon + ' : ' + it.name + ' (ยังไม่ผูกกับหน่วยนี้)';
  return '<option value="" disabled>' + esc(text) + '</option>';
}

// เติม dropdown วิชา ตามหน่วย+ระดับที่เลือกอยู่
async function loadSubjectOptions(unitId, level, keepValue) {
  const sel = document.getElementById('q-subject');
  if (!sel) return;

  const want = (keepValue != null) ? String(keepValue) : sel.value;

  if (SUBJ_LIST.length === 0) await loadSubjectList();
  if (!lookupTableReady && SUBJ_MASTER.length === 0) await loadSubjectMaster();

  if (!unitId) {
    sel.innerHTML = '<option value="">-- เลือกหน่วยงานก่อน --</option>';
    updateSubjectHint(0);
    return;
  }

  const items = subjectDropdownItems(unitId, level);
  if (items.length === 0) {
    sel.innerHTML = '<option value="">-- ไม่มีวิชา --</option>';
    updateSubjectHint(0);
    return;
  }

  // วิชาทุกตัวเลือกได้ — ใช้ชื่อวิชาเป็น value (ตอนบันทึกจะ resolve เป็น subject_id)
  sel.innerHTML = '<option value="">-- เลือกวิชา --</option>' +
    items.map(it => optionHtml(it.name, it.icon + ' : ' + it.name, it.name === want)).join('');

  updateSubjectHint(items.length);
}

// จำนวนวิชาที่เลือกได้ในหน่วย+ระดับปัจจุบัน
function subjectOptionCount() {
  const sel = document.getElementById('q-subject');
  if (!sel) return 0;
  let n = 0;
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value) n++;
  }
  return n;
}

// ข้อความช่วยใต้ช่องวิชา
// count = จำนวนวิชาที่มี (ถ้าไม่ส่งมา จะนับจาก dropdown เอง)
// สำคัญ: onchange ใน HTML เรียกโดยไม่ส่ง argument จึงต้องคำนวณเองได้
function updateSubjectHint(count) {
  const hint = document.getElementById('q-subject-hint');
  if (!hint) return;

  if (count == null) count = subjectOptionCount();

  const sel = document.getElementById('q-subject');
  const unitId = (typeof selectedUnit === 'function') ? selectedUnit() : '';
  const chosen = sel && sel.value;

  if (!unitId) {
    hint.textContent = 'เลือกหน่วยงานก่อน จึงจะแสดงรายวิชา';
    hint.style.color = 'var(--warning)';
    return;
  }
  if (count === 0) {
    hint.textContent = 'ยังไม่มีวิชาในระบบ — เพิ่มได้ที่เมนู ตั้งค่า → วิชา';
    hint.style.color = 'var(--warning)';
    return;
  }
  if (!chosen) {
    hint.textContent = 'เลือกวิชาจากรายการ (' + count + ' วิชา)';
    hint.style.color = 'var(--text3)';
    return;
  }

  // ตรวจว่าหน่วยที่เลือกมีวิชานี้อยู่แล้วหรือจะสร้างใหม่
  const level = (typeof selectedLevel === 'function') ? selectedLevel() : 'p';
  const lv = level === 'p' ? ['p', 'both'] : level === 's' ? ['s', 'both'] : ['p', 's', 'both'];
  const inUnit = SUBJ_LIST.filter(s => s.name === chosen && s.unit_id === unitId &&
    lv.indexOf(s.level) !== -1)[0];

  if (inUnit) {
    hint.textContent = '✓ ใช้วิชาที่มีอยู่แล้ว: ' + chosen;
    hint.style.color = 'var(--success)';
  } else {
    hint.textContent = '＋ จะสร้างวิชา "' + chosen + '" ให้หน่วยนี้ตอนบันทึก';
    hint.style.color = 'var(--accent)';
  }
}

// เรียกเมื่อเปลี่ยนหน่วย/ระดับ → โหลดวิชาใหม่
function refreshFormSubjects() {
  if (typeof selectedUnit !== 'function') return;
  loadSubjectOptions(selectedUnit(), selectedLevel());
}

// เตรียมช่องวิชาตอนเปิดฟอร์ม
async function initSubjectField() {
  await loadSubjectList();      // วิชาจริง (subjects) สำหรับกรอง
  await loadSubjectMaster();    // ทะเบียนวิชา (subject_lookup) สำหรับ dropdown
  refreshFormSubjects();
}

// ชื่อวิชาที่เลือกอยู่ (value ของ dropdown คือชื่อวิชา)
function selectedSubjectName() {
  const el = document.getElementById('q-subject');
  return el ? String(el.value || '').trim() : '';
}

// เลือกวิชาใน dropdown ตามชื่อ (ใช้ตอนโหลดฟอร์มแก้ไข)
// ถ้าไม่มีในรายการ จะเติมเป็นตัวเลือกใหม่ให้ชั่วคราว
function setSubjectByName(name) {
  const sel = document.getElementById('q-subject');
  if (!sel || !name) return;
  const want = String(name).trim();

  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === want) { sel.value = want; return; }
  }
  // ยังไม่มีในรายการ → เพิ่มเข้าไปแล้วเลือก
  const opt = document.createElement('option');
  opt.value = want;
  opt.textContent = '📄 ' + want;
  sel.appendChild(opt);
  sel.value = want;
}

// Resolve ชื่อวิชา → subject_id สำหรับหน่วย+ระดับ ที่เลือก
// ถ้าหน่วยนั้นยังไม่มีวิชานี้ จะสร้างใหม่ให้อัตโนมัติ
// คืน { id, created, name } หรือ { error }
async function ensureSubjectForUnit(name, unitId, level) {
  if (!name) return { error: 'กรุณาเลือกวิชา' };
  if (!unitId) return { error: 'กรุณาเลือกหน่วยงานก่อน' };

  // 1) หาในหน่วย+ระดับ ที่เลือกก่อน
  const lv = level === 'p' ? ['p', 'both'] : level === 's' ? ['s', 'both'] : ['p', 's', 'both'];
  let found = SUBJ_LIST.filter(s => s.name === name && String(s.unit_id) === String(unitId) &&
    lv.indexOf(s.level) !== -1)[0];
  if (found) return { id: found.id, created: false, name: found.name };

  // 2) มีวิชานี้อยู่แล้วในหน่วยอื่น → คัดลอกมาให้หน่วยนี้
  const other = findSubjectAnyUnit(name, level);
  const parsedUnitId = isNaN(Number(unitId)) ? unitId : Number(unitId);
  const row = { name: name, unit_id: parsedUnitId, level: (level || 'p') };
  if (other && other.ratio != null) row.ratio = other.ratio;

  const res = await supa.from('subjects').insert(row).select().single();
  if (res.error) return { error: 'สร้างวิชาให้หน่วยนี้ไม่สำเร็จ: ' + res.error.message };

  SUBJ_LIST.push(res.data);
  return { id: res.data.id, created: true, name: res.data.name };
}
