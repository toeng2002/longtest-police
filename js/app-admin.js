/* ============================================================
   app-admin.js — โหมดผู้ดูแลระบบ: dashboard, จัดการข้อสอบ, ลบ, เพิ่มข้อสอบ
   ต้องโหลดหลัง exam-db.js
   ============================================================ */

// ===== Supabase CRUD =====

async function dbLoadQuestions(){
  const {data,error}=await supa
    .from('questions')
    .select(`id, question, choice_a, choice_b, choice_c, choice_d,
             answer, explanation, difficulty, source, published, created_at,
             question_image, subject_id,
             subjects(name),
             question_units(unit_id, level)`)
    .order('id',{ascending:false});
  if(error){console.error(error);return[];}

  const uMap = typeof getUnitsMap === 'function' ? await getUnitsMap() : {};

  return (data||[]).map(q=>{
    const unitList = [...new Set((q.question_units||[]).map(u=>u.unit_id))];
    const unitLabels = unitList.map(uId => (uMap[uId] ? (uMap[uId].short_name || uMap[uId].name) : uId));
    return {
      id:q.id,
      question:q.question,
      choice_a:q.choice_a, choice_b:q.choice_b, choice_c:q.choice_c, choice_d:q.choice_d,
      answer:q.answer,
      explanation:q.explanation||'',
      difficulty:q.difficulty||'medium',
      source:q.source||'',
      image:q.question_image||'',
      subject_id:q.subject_id,
      unitsRaw:unitList,
      levelsRaw:[...new Set((q.question_units||[]).map(u=>u.level))],
      unit:unitLabels.join(','),
      level:[...new Set((q.question_units||[]).map(u=>u.level))].join(','),
      subject:q.subjects?.name||'',
      type:q.question_image?'มีรูป':'ข้อความ',
      status:q.published?'เผยแพร่':'รอตรวจสอบ'
    };
  });
}

// สร้างแถว question_units (ทุกหน่วย × ทุกระดับ, ไม่ซ้ำ)
function buildUnitRows(questionId, units, levels){
  const rows=[];
  const seen=new Set();
  units.forEach(u=>{
    const parsedUnit = isNaN(Number(u)) ? u : Number(u);
    levels.forEach(lv=>{
      const key=parsedUnit+'|'+lv;
      if(seen.has(key)) return;
      seen.add(key);
      rows.push({question_id:questionId,unit_id:parsedUnit,level:lv});
    });
  });
  return rows;
}

// เพิ่มข้อสอบใหม่ — คืนค่า { ok, id, error }
async function dbInsertQuestion(formData){
  const {units,levels,subject_id,question,choice_a,choice_b,choice_c,choice_d,
         answer,explanation,difficulty,source,published,image}=formData;

  const {data:q,error:e1}=await supa.from('questions').insert({
    question,choice_a,choice_b,choice_c,choice_d,
    answer,explanation:explanation||null,difficulty,source:source||null,
    published,subject_id,question_image:image||null
  }).select().single();
  if(e1){ console.error(e1); return { ok:false, error:e1.message }; }

  const rows=buildUnitRows(q.id, units, levels);
  if(rows.length){
    const {error:e2}=await supa.from('question_units').insert(rows);
    if(e2){
      // ย้อนลบข้อสอบที่เพิ่งสร้าง ไม่ให้เหลือข้อมูลค้าง
      await supa.from('questions').delete().eq('id',q.id);
      return { ok:false, error:'ผูกหน่วยงานไม่สำเร็จ: '+e2.message };
    }
  }
  return { ok:true, id:q.id };
}

// แก้ไขข้อสอบเดิม — อัปเดต questions + เปลี่ยน question_units ให้ตรงใหม่
async function dbUpdateQuestion(id, formData){
  const {units,levels,subject_id,question,choice_a,choice_b,choice_c,choice_d,
         answer,explanation,difficulty,source,published,image}=formData;

  // 1) อัปเดตตัวข้อสอบ
  const {error:e1}=await supa.from('questions').update({
    question,choice_a,choice_b,choice_c,choice_d,
    answer,explanation:explanation||null,difficulty,source:source||null,
    published,subject_id,question_image:image||null
  }).eq('id',id);
  if(e1){ console.error(e1); return { ok:false, error:e1.message }; }

  // 2) เอาการผูกหน่วย/ระดับเดิมออก แล้วใส่ใหม่ตามที่เลือก
  const del=await supa.from('question_units').delete().eq('question_id',id);
  if(del.error){ return { ok:false, error:'ลบการผูกหน่วยเดิมไม่สำเร็จ: '+del.error.message }; }

  const rows=buildUnitRows(id, units, levels);
  if(rows.length){
    const {error:e2}=await supa.from('question_units').insert(rows);
    if(e2){ return { ok:false, error:'ผูกหน่วยงานไม่สำเร็จ: '+e2.message }; }
  }
  return { ok:true, id:id };
}

async function dbDeleteQuestions(ids){
  const {error}=await supa.from('questions').delete().in('id',ids);
  return !error;
}

async function dbTogglePublish(id,published){
  await supa.from('questions').update({published}).eq('id',id);
}

// รายการข้อสอบสำหรับตาร admin — โหลดจาก Supabase ใน initQuestions()
let questions=[];

let selectedIds=new Set(), curPage=1, pageSize=5, filtered=[];
let pinVal='';





function goPage(id,navEl){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(navEl){
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    navEl.classList.add('active');
  }
  const titles={'dashboard':'Dashboard','questions':'ข้อสอบทั้งหมด','add-question':'เพิ่มข้อสอบ','import-csv':'นำเข้า CSV','settings':'ตั้งค่าระบบ'};
  document.getElementById('topbar-title').textContent=titles[id]||id;
  // เปิดหน้าตั้งค่า → โหลดข้อมูล (ฟังก์ชันอยู่ใน app-settings.js)
  if(id==='settings' && typeof initSettingsPage==='function') initSettingsPage();
  // show switch-to-user if role=both or admin
  const sw=document.getElementById('admin-switch-user');
  if(sw) sw.style.display=(currentUser?.role==='both' || currentUser?.role==='admin')?'flex':'none';
  // เปิด Dashboard → โหลดสถิติใหม่ทุกครั้ง (ไม่งั้นตัวเลขจะค้างอยู่ของเก่า)
  if(id==='dashboard' && typeof initAdminDashboard==='function') initAdminDashboard();
  // เปิดหน้าเพิ่มข้อสอบ → เตรียมฟอร์ม + โหลดรายวิชาจริง
  if(id==='add-question'){
    // ถ้าเข้ามาจากเมนูโดยตรง (ไม่ใช่ปุ่มแก้ไข) ให้เริ่มเป็นโหมดเพิ่มใหม่
    const fromEdit = (typeof editingId!=='undefined' && editingId!==null);
    if(!fromEdit && typeof prepareAddForm==='function') prepareAddForm();
  }
  // เปิดหน้ารวมข้อสอบ → โหลดใหม่ทุกครั้งเพื่อให้เห็นข้อมูลล่าสุด
  if(id==='questions' && typeof initQuestions==='function') initQuestions();
}

async function initAdminDashboard(){
  // ดึงข้อสอบจริงจาก Supabase แล้วคำนวณสถิติจากข้อมูลจริง
  const rows=await dbLoadQuestions();
  const counts={};
  rows.forEach(q=>{
    (q.unit?q.unit.split(','):['ไม่ระบุ']).forEach(u=>{
      const k=u.trim()||'ไม่ระบุ';
      counts[k]=(counts[k]||0)+1;
    });
  });
  const units=Object.keys(counts).map(k=>({n:k,v:counts[k]})).sort((a,b)=>b.v-a.v);
  const max=Math.max(1,...units.map(u=>u.v));

  const totalEl=document.getElementById('stat-total');
  if(totalEl) totalEl.textContent=rows.length.toLocaleString();
  const unitCountEl=document.getElementById('stat-units');
  if(unitCountEl) unitCountEl.textContent=units.length;
  const subjEl=document.getElementById('stat-subjects');
  if(subjEl) subjEl.textContent=[...new Set(rows.map(q=>q.subject).filter(Boolean))].length;
  const draftEl=document.getElementById('stat-draft');
  if(draftEl) draftEl.textContent=rows.filter(q=>q.status!=='เผยแพร่').length;

  const bars=document.getElementById('unit-bars');
  if(units.length===0){
    bars.innerHTML='<div style="font-size:12px;color:var(--text2);padding:8px 0">ยังไม่มีข้อสอบในฐานข้อมูล</div>';
    return;
  }
  bars.innerHTML=units.map(u=>`
      <span style="font-size:13px">${u.n}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:100px;height:5px;background:var(--surface2);border-radius:2px">
          <div style="width:${Math.round(u.v/max*100)}%;height:5px;background:var(--accent);border-radius:2px"></div>
        </div>
        <span style="font-size:12px;color:var(--text2);min-width:28px;text-align:right">${u.v}</span>
      </div>
    </div>`).join('');
  // กิจกรรมล่าสุดสร้างจากข้อสอบที่เพิ่มเข้ามาจริง
  const recent=[...rows].slice(0,6);
  document.getElementById('activity-log').innerHTML=recent.length===0
    ? '<div style="font-size:12px;color:var(--text2);padding:10px 0">ยังไม่มีกิจกรรม</div>'
    : recent.map(q=>`
    <div class="activity-item">
      <div class="act-dot" style="background:${q.status==='เผยแพร่'?'var(--success)':'var(--warning)'}"></div>
      <div><div class="act-text">${q.status==='เผยแพร่'?'เผยแพร่':'ร่าง'}ข้อสอบ #${q.id} · ${q.subject||'ไม่ระบุวิชา'}</div><div class="act-time">${q.unit||''}</div></div>
    </div>`).join('');
}

async function initQuestions(){
  // แสดง loading
  document.getElementById('q-tbody').innerHTML=
    '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text2)">⏳ กำลังโหลดข้อสอบ...</td></tr>';
  questions=await dbLoadQuestions();
  filtered=[...questions];
  curPage=1;
  // ล้างตัวกรองให้ตรงกับข้อมูลที่โหลดมา
  ['q-search','q-unit','q-level','q-status'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&el.tagName!=='SELECT') el.value='';
  });
  renderUnitFilter();
  renderTable();
}

// สร้างตัวเลือก "หน่วย" ในตัวกรองจากข้อมูลจริง
function renderUnitFilter(){
  const sel=document.getElementById('q-unit');
  if(!sel) return;
  const units=[...new Set(questions.flatMap(q=>(q.unit||'').split(',').map(s=>s.trim()).filter(Boolean)))];
  sel.innerHTML='<option value="">ทุกหน่วย</option>'+
    units.map(u=>`<option value="${u}">${u}</option>`).join('');
}

function filterQ(){
  const s=document.getElementById('q-search').value.toLowerCase();
  const u=document.getElementById('q-unit').value;
  const lv=document.getElementById('q-level').value;
  const st=document.getElementById('q-status').value;
  filtered=questions.filter(q=>{
    if(s&&!q.question.toLowerCase().includes(s))return false;
    if(u&&!q.unit.includes(u))return false;
    if(lv&&!q.level.includes(lv))return false;
    if(st&&q.status!==st)return false;
    return true;
  });
  curPage=1;selectedIds.clear();updateBulkBar();
  renderTable();
}

function renderTable(){
  const start=(curPage-1)*pageSize, end=start+pageSize;
  const rows=filtered.slice(start,end);
  const tbody=document.getElementById('q-tbody');
  const labels={'เผยแพร่':'tag-green','รอตรวจสอบ':'tag-yellow'};
  const types={'ข้อความ':'tag-gray','มีรูป':'tag-blue'};
  tbody.innerHTML=rows.map(q=>`
    <tr class="${selectedIds.has(q.id)?'sel-row':''}" id="row-${q.id}">
      <td><input type="checkbox" ${selectedIds.has(q.id)?'checked':''} onchange="toggleSel(${q.id},this)"></td>
      <td style="font-size:12px;color:var(--text2)">#${q.id}</td>
      <td>
        <div style="font-size:13px">${q.question.length>55?q.question.slice(0,55)+'...':q.question}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${q.level}</div>
      </td>
      <td>
        <span class="tag tag-blue" style="font-size:11px">${q.unit}</span>
      </td>
      <td style="font-size:12px;color:var(--text2)">${q.subject}</td>
      <td><span class="tag ${types[q.type]||'tag-gray'}">${q.type}</span></td>
      <td><span class="tag ${labels[q.status]||'tag-gray'}">${q.status}</span></td>
      <td>
        <div style="display:flex;gap:3px">
          <button class="btn btn-icon btn-sm" title="แก้ไข" onclick="editQ(${q.id})" style="color:var(--accent)">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-icon btn-sm" title="ลบ" onclick="quickDel(${q.id})" style="color:var(--danger)">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
  document.getElementById('q-count-label').textContent=`แสดง ${rows.length} จาก ${filtered.length} ข้อ`;
  document.getElementById('btn-prev').disabled=curPage===1;
  document.getElementById('btn-next').disabled=end>=filtered.length;
  document.getElementById('chk-all').checked=rows.length>0&&rows.every(q=>selectedIds.has(q.id));
}

function changePage(d){curPage+=d;renderTable();}

function toggleSel(id,chk){
  if(chk.checked)selectedIds.add(id);else selectedIds.delete(id);
  document.getElementById(`row-${id}`)?.classList.toggle('sel-row',chk.checked);
  updateBulkBar();
}

function toggleAll(chk){
  const start=(curPage-1)*pageSize,end=start+pageSize;
  filtered.slice(start,end).forEach(q=>{
    if(chk.checked)selectedIds.add(q.id);else selectedIds.delete(q.id);
    document.getElementById(`row-${q.id}`)?.classList.toggle('sel-row',chk.checked);
  });
  updateBulkBar();
}

function clearSel(){selectedIds.clear();updateBulkBar();renderTable();}

function updateBulkBar(){
  const bar=document.getElementById('bulk-bar');
  const n=selectedIds.size;
  bar.style.display=n>0?'flex':'none';
  document.getElementById('bulk-count').textContent=`เลือก ${n} รายการ`;
}

function quickDel(id){selectedIds.clear();selectedIds.add(id);openDeleteModal();}

// เก็บ id ของข้อสอบที่กำลังแก้ไข (null = เพิ่มใหม่)
let editingId = null;

// เปิดฟอร์มแก้ไข พร้อมโหลดข้อมูลเดิมมาใส่
async function editQ(id){
  const q = questions.filter(x => x.id === id)[0];
  if(!q){ showToast('ไม่พบข้อสอบ #'+id, 'danger'); return; }

  // ตั้งค่า editingId ก่อน แล้วให้ prepareAddForm() เตรียมฟอร์ม (จะรู้ว่าเป็นโหมดแก้ไข)
  editingId = id;
  goPage('add-question', null);

  // เตรียม dropdown ทั้งหมดก่อน แล้วค่อยเติมค่าลงฟอร์ม
  if(typeof prepareAddForm === 'function') await prepareAddForm();
  await loadQuestionIntoForm(q);
}

// เติมข้อมูลข้อสอบลงแบบฟอร์ม
async function loadQuestionIntoForm(q){
  document.getElementById('form-title').textContent = 'แก้ไขข้อสอบ #' + q.id;
  const sub = document.querySelector('#page-add-question .form-header-sub');
  if(sub) sub.textContent = 'แก้ไขข้อมูลแล้วกดบันทึก (จะอัปเดตข้อเดิม ไม่สร้างใหม่)';

  // 1) หน่วยงาน — ติ๊กเฉพาะที่ข้อสอบนี้ผูกอยู่
  if(typeof loadUnitChips === 'function'){
    await loadUnitChips(q.unitsRaw || []);
  }

  // 2) ระดับชั้น
  const lvSet = q.levelsRaw || [];
  document.querySelectorAll('#level-checks .check-chip').forEach(function(chip){
    const inp = chip.querySelector('input');
    const on = lvSet.indexOf(inp.value) !== -1;
    chip.classList.toggle('on', on);
    inp.checked = on;
  });
  if(typeof updateChipNotice === 'function') updateChipNotice();

  // 3) วิชา — ใส่ชื่อวิชาเดิม
  if(typeof refreshFormSubjects === 'function'){
    await refreshFormSubjects();
  }
  const sel = document.getElementById('q-subject');
  if(sel && typeof setSubjectByName === 'function') setSubjectByName(q.subject);
  if(typeof updateSubjectHint === 'function') updateSubjectHint();

  // 4) ระดับความยาก
  const dif = document.getElementById('q-difficulty');
  if(dif) dif.value = q.difficulty || 'medium';

  // 5) ที่มา + ข้อความคำถาม
  const src = document.getElementById('q-source');
  if(src) src.value = q.source || '';
  document.getElementById('q-text-input').value = q.question || '';
  document.getElementById('q-explain').value = q.explanation || '';

  // 6) ตัวเลือก + เลย
  const maps = [['c-0', q.choice_a], ['c-1', q.choice_b], ['c-2', q.choice_c], ['c-3', q.choice_d]];
  maps.forEach(function(pair){
    const el = document.getElementById(pair[0]);
    if(el) el.value = pair[1] || '';
  });
  const ansIdx = ['a','b','c','d'].indexOf(String(q.answer || '').toLowerCase());
  document.querySelectorAll('input[name="ans-radio"]').forEach(function(r, i){
    r.checked = (i === ansIdx);
  });
  if(ansIdx >= 0 && typeof updateAnsMsg === 'function'){
    updateAnsMsg(ansIdx, ['ก','ข','ค','ง'][ansIdx]);
  }

  // 7) สถานะเผยแพร่
  const pub = document.getElementById('publish-chk');
  if(pub) pub.checked = (q.status === 'เผยแพร่');

  showToast('โหลดข้อมูลข้อสอบ #' + q.id + ' แล้ว', 'success');
}

// ออกจากฟอร์มโดยรีเซ็ตสถานะกลับเป็น "เพิ่มใหม่"
function cancelQuestionForm(){
  resetQuestionForm();
  goPage('questions', null);
}

// รีเซ็ตฟอร์มกลับเป็นโหมด "เพิ่มใหม่"
function resetQuestionForm(){
  editingId = null;
  document.getElementById('form-title').textContent = 'เพิ่มข้อสอบใหม่';
  const sub = document.querySelector('#page-add-question .form-header-sub');
  if(sub) sub.textContent = 'กรอกข้อมูลให้ครบถ้วนแล้วกดบันทึก';
  document.getElementById('q-text-input').value = '';
  document.getElementById('q-explain').value = '';
  const src = document.getElementById('q-source');
  if(src) src.value = '';
  ['c-0','c-1','c-2','c-3'].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.querySelectorAll('input[name="ans-radio"]').forEach(function(r){ r.checked = false; });
  const msg = document.getElementById('ans-ok-msg');
  if(msg) msg.style.display = 'none';
  const sel = document.getElementById('q-subject');
  if(sel) sel.value = '';
}

function openDeleteModal(){
  const ids=[...selectedIds];
  if(ids.length===0){showToast('กรุณาเลือกข้อสอบก่อน','danger');return;}
  const items=questions.filter(q=>ids.includes(q.id));
  document.getElementById('del-list').innerHTML=`
    <div style="font-size:11px;font-weight:500;color:var(--danger);margin-bottom:6px">รายการที่จะถูกลบ (${items.length} รายการ)</div>
    ${items.map(q=>`<div class="del-item"><span style="flex-shrink:0">—</span><span>#${q.id} ${q.question.length>50?q.question.slice(0,50)+'...':q.question}</span></div>`).join('')}`;
  document.getElementById('del-btn-label').textContent=`ลบ ${items.length} รายการ`;
  document.getElementById('btn-confirm-del').disabled=true;
  document.getElementById('pin-err').textContent='';
  pinVal='';
  const container=document.getElementById('pin-inputs');
  container.innerHTML='';
  for(let i=0;i<6;i++){
    const inp=document.createElement('input');
    inp.type='password';inp.maxLength=1;inp.dataset.idx=i;
    inp.addEventListener('input',onPinInput);
    inp.addEventListener('keydown',onPinKey);
    container.appendChild(inp);
  }
  document.getElementById('delete-modal').classList.add('open');
  setTimeout(()=>container.children[0]?.focus(),100);
}

function onPinInput(e){
  const inp=e.target,idx=+inp.dataset.idx;
  inp.classList.remove('pin-err');
  if(inp.value){
    const next=inp.parentElement.children[idx+1];
    if(next)next.focus();
  }
  updatePin();
}

function onPinKey(e){
  const inp=e.target,idx=+inp.dataset.idx;
  if(e.key==='Backspace'&&!inp.value&&idx>0){
    inp.parentElement.children[idx-1].focus();
  }
}

function updatePin(){
  const inputs=[...document.getElementById('pin-inputs').children];
  pinVal=inputs.map(i=>i.value).join('');
  if(pinVal.length===6){
    if(pinVal===DELETE_PIN){
      document.getElementById('btn-confirm-del').disabled=false;
      document.getElementById('pin-err').textContent='';
      inputs.forEach(i=>i.classList.remove('pin-err'));
    } else {
      document.getElementById('btn-confirm-del').disabled=true;
      document.getElementById('pin-err').textContent='รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่';
      inputs.forEach(i=>i.classList.add('pin-err'));
      setTimeout(()=>{
        inputs.forEach(i=>{i.value='';i.classList.remove('pin-err');});
        inputs[0].focus();pinVal='';
        document.getElementById('pin-err').textContent='';
      },800);
    }
  } else {
    document.getElementById('btn-confirm-del').disabled=true;
  }
}

function closeDeleteModal(){
  document.getElementById('delete-modal').classList.remove('open');
  pinVal='';
}

async function confirmDelete(){
  const ids=[...selectedIds];
  const ok=await dbDeleteQuestions(ids);
  if(ok){
    questions=questions.filter(q=>!ids.includes(q.id));
    filtered=filtered.filter(q=>!ids.includes(q.id));
    selectedIds.clear();
    updateBulkBar();
    renderTable();
    closeDeleteModal();
    showToast(`ลบ ${ids.length} ข้อสอบแล้ว`,'success');
  } else {
    showToast('เกิดข้อผิดพลาด กรุณาลองใหม่','danger');
  }
}

function initChoicesForm(){
  const labels=['ก','ข','ค','ง'];
  let selAns=null;
  const wrap=document.getElementById('choices-form');
  wrap.innerHTML=labels.map((lbl,i)=>`
    <div class="choice-row">
      <input type="radio" name="ans-radio" class="choice-radio" value="${i}" id="radio-${i}" onchange="updateAnsMsg(${i},'${lbl}')">
      <span class="choice-lbl">${lbl}</span>
      <input type="text" placeholder="ตัวเลือก ${lbl}..." style="flex:1" id="c-${i}">
      <div class="img-zone">📷 รูปตัวเลือก</div>
    </div>`).join('');
}

function updateAnsMsg(idx,lbl){
  const val=document.getElementById(`c-${idx}`)?.value||'(ยังไม่ได้กรอก)';
  const msg=document.getElementById('ans-ok-msg');
  msg.style.display='block';
  msg.textContent=`✓ เฉลยที่เลือก: ${lbl}. ${val}`;
}

function toggleChip(el,e){
  e.preventDefault();
  e.stopPropagation();
  el.classList.toggle('on');
  const chk=el.querySelector('input[type=checkbox]');
  if(chk) chk.checked=el.classList.contains('on');
  updateChipNotice();
  // เปลี่ยนหน่วย/ระดับ → อัปเดตข้อความช่วยของช่องวิชา
  if(typeof updateSubjectHint==='function') updateSubjectHint();
}

// แสดงชื่อหน่วยที่เลือก (อ่านจาก value ไม่ใช่ textContent เพราะชื่อมี emoji/ช่องว่างได้)
function updateChipNotice(){
  const notice=document.getElementById('unit-notice');
  if(!notice) return;

  const ids=[...document.querySelectorAll('#unit-checks .check-chip.on input')].map(i=>i.value);
  const span=notice.querySelector('span')||notice;

  if(ids.length===0){
    span.textContent='ยังไม่ได้เลือกหน่วยงาน';
    return;
  }
  // อ่านชื่อจาก chip ที่ติ๊ก (textContent จะมี emoji นำหน้าด้วย)
  const names=[...document.querySelectorAll('#unit-checks .check-chip.on')]
    .map(c=>c.textContent.trim())
    .filter(Boolean);
  span.textContent='ข้อสอบนี้จะปรากฏใน: '+(names.join(', ')||ids.join(', '));
}

async function saveQuestion(){
  // รวบรวมข้อมูลจากฟอร์ม
  const units=[...document.querySelectorAll('#unit-checks .check-chip.on')]
    .map(c=>c.querySelector('input')?.value||'')
    .filter(Boolean);
  const levels=[...document.querySelectorAll('#level-checks .check-chip.on')]
    .map(c=>c.querySelector('input')?.value||'')
    .filter(Boolean);
  const question=document.getElementById('q-text-input')?.value?.trim()||'';
  if(!question){showToast('กรุณากรอกคำถาม','danger');return;}
  if(units.length===0){showToast('กรุณาเลือกหน่วยงาน','danger');return;}
  if(levels.length===0){showToast('กรุณาเลือกระดับชั้น','danger');return;}

  const radioEl=document.querySelector('input[name="ans-radio"]:checked');
  if(!radioEl){showToast('กรุณาเลือกเฉลยที่ถูกต้อง','danger');return;}
  const answerMap=['a','b','c','d'];
  const answer=radioEl?answerMap[+radioEl.value]:'a';
  const choices=['a','b','c','d'].map((_,i)=>document.getElementById('c-'+i)?.value?.trim()||'');
  if(choices.some(c=>!c)){showToast('กรุณากรอกตัวเลือกให้ครบทั้ง 4 ข้อ','danger');return;}

  // แปลงชื่อวิชาที่เลือก → subject_id (สร้างใหม่ถ้าหน่วยนี้ยังไม่มี)
  const subjName=selectedSubjectName();
  if(!subjName){showToast('กรุณาเลือกวิชา','danger');return;}

  const subj=await ensureSubjectForUnit(subjName, units[0], levels[0]);
  if(subj.error){showToast(subj.error,'danger');return;}
  const subject_id=subj.id;

  const formData={
    units, levels,
    subject_id,
    question,
    choice_a:choices[0], choice_b:choices[1],
    choice_c:choices[2], choice_d:choices[3],
    answer,
    explanation:document.getElementById('q-explain')?.value?.trim()||'',
    difficulty:document.getElementById('q-difficulty')?.value||'medium',
    source:document.getElementById('q-source')?.value?.trim()||'',
    published:document.getElementById('publish-chk')?.checked||false
  };

  // เลือกเส้นทาง: แก้ไขของเดิม หรือ สร้างใหม่
  const isEdit = (editingId !== null);
  showToast(isEdit ? 'กำลังบันทึกการแก้ไข...' : 'กำลังบันทึก...', '');

  const res = isEdit
    ? await dbUpdateQuestion(editingId, formData)
    : await dbInsertQuestion(formData);

  if(res.ok){
    showToast(isEdit ? 'แก้ไขข้อสอบ #'+editingId+' แล้ว' : 'เพิ่มข้อสอบใหม่แล้ว', 'success');
    resetQuestionForm();
    await initQuestions();
    setTimeout(()=>goPage('questions',null),600);
  } else {
    showToast('บันทึกไม่สำเร็จ: '+(res.error||'เกิดข้อผิดพลาด'), 'danger');
  }
}

let toastTimer;
function showToast(msg,type=''){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.className='toast show'+(type?' '+type:'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.className='toast',3000);
}
/* ============================================================
   ตัวช่วยของฟอร์มเพิ่ม/แก้ไขข้อสอบ — ผูกกับข้อมูลจริงใน Supabase
   ============================================================ */

/* ============================================================
   ตัวช่วยอ่านค่าจากฟอร์มเพิ่ม/แก้ไขข้อสอบ
   ============================================================ */

// หน่วยแรกที่ติ๊กเลือกในฟอร์ม
function selectedUnit(){
  const el=document.querySelector('#unit-checks .check-chip.on input');
  return el?el.value:'';
}

// ระดับแรกที่ติ๊กเลือกในฟอร์ม
function selectedLevel(){
  const el=document.querySelector('#level-checks .check-chip.on input');
  return el?el.value:'';
}

// หมายเหตุ: refreshFormSubjects() อยู่ใน app-settings.js
// เมื่อเปิดหน้าเพิ่มข้อสอบ ให้เตรียมข้อมูลทั้งหมดจากฐานข้อมูล
// ลำดับ: 1 หน่วยงาน → 2 ระดับชั้น → 3 วิชา
// หมายเหตุ: ถ้าเป็นการกดจากปุ่ม "แก้ไข" (editQ) ฟังก์ชันนั้นจะเติมค่าฟอร์มเอง
async function prepareAddForm(){
  initChoicesForm();

  // โหลดตัวเลือกระดับความยาก
  if(typeof loadDifficultyOptions==='function') loadDifficultyOptions();

  // โหลดรายชื่อวิชาสำหรับ dropdown
  if(typeof initSubjectField==='function') await initSubjectField();

  // ถ้าเป็นการเปิดฟอร์มเพิ่มใหม่ (ไม่ใช่แก้ไข) ให้ล้างค่าเก่า + เริ่มจาก ตม.
  if(editingId === null){
    resetQuestionForm();
    if(typeof loadUnitChips==='function') await loadUnitChips([]);
  }
}
