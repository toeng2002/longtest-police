/* ============================================================
   app-quiz.js — โหมดผู้ใช้: เลือกหน่วย/ระดับ/วิชา, ทำข้อสอบ, ผลคะแนน, ประวัติ
   ต้องโหลดหลัง exam-db.js
   ============================================================ */

/* หมายเหตุ: DB / SUPA_* / supa / SESSION_ID / currentUser ถูกประกาศไว้ใน exam-db.js แล้ว
   ไม่ประกาศซ้ำที่นี่ เพื่อไม่ให้เกิด "Identifier has already been declared" */

// ===== state ของโหมดทำข้อสอบ =====
let state = {
  unit:'', unitName:'', unitShort:'',
  level:'', examType:'', selSubj:'', selSubjName:'', quizMode:'',
  questions:[], cur:0, ans:[], done:[],
  history:[]
};

// ===== units cache สำหรับ map unit_id ↔ ชื่อจริง / code =====
let _unitsCache = null;
async function getUnitsMap(){
  if(!_unitsCache){
    const units = await loadUnits();
    _unitsCache = {};
    units.forEach(u => {
      _unitsCache[u.id] = u;
      if(u.code) _unitsCache[u.code] = u;
    });
  }
  return _unitsCache;
}

// โหลดข้อสอบจาก Supabase
async function loadQuestions(unitId, level, subjId=null){
  try {
    const uMap = await getUnitsMap();
    const resolvedUnitId = uMap[unitId] ? uMap[unitId].id : unitId;

    let q = supa
      .from('question_units')
      .select(`
        level,
        questions!inner (
          id, question, choice_a, choice_b, choice_c, choice_d,
          choice_a_image, choice_b_image, choice_c_image, choice_d_image,
          answer, explanation, question_image, subject_id, published,
          subjects ( name )
        )
      `)
      .eq('unit_id', resolvedUnitId)
      .eq('questions.published', true);

    if(level && level!=='both') q=q.in('level',[level,'both']);
    // กรองตามวิชา — ใช้ subject_id เท่านั้น
    if(subjId!=null && subjId!=='') q=q.eq('questions.subject_id', subjId);

    const {data,error}=await q;
    if(error) throw error;

    // แปลงให้ตรงกับ format เดิม
    return (data||[]).map(row=>{
      const qq=row.questions;
      if(!qq) return null;
      const choices=[qq.choice_a,qq.choice_b,qq.choice_c,qq.choice_d];
      const images=[qq.choice_a_image,qq.choice_b_image,qq.choice_c_image,qq.choice_d_image];
      const ansIdx={'a':0,'b':1,'c':2,'d':3}[qq.answer]??0;
      return {
        id:qq.id, q:qq.question,
        c:choices, cImg:images,
        a:ansIdx, e:qq.explanation||'',
        img:qq.question_image||null,
        subjId:qq.subject_id,
        subj:qq.subjects?.name||'', subjIcon:'📄'
      };
    }).filter(Boolean);
  } catch(err){
    console.error('loadQuestions error:',err);
    return [];
  }
}

// โหลดหน่วยงานจาก Supabase
async function loadUnits(){
  try {
    const {data,error}=await supa.from('units').select('*');
    if(error) throw error;
    return data||[];
  } catch(e){ return []; }
}

async function loadSubjects(unitId, level){
  try {
    const uMap = await getUnitsMap();
    const resolvedUnitId = uMap[unitId] ? uMap[unitId].id : unitId;
    // 'both' = ต้องการทุกระดับ → เอามาทั้ง p และ s
    const lv = level==='p' ? ['p','both']
             : level==='s' ? ['s','both']
             : ['p','s','both'];
    const {data,error}=await supa
      .from('subjects')
      .select('*')
      .eq('unit_id',resolvedUnitId)
      .in('level',lv)
      .order('id');
    if(error) throw error;
    return data||[];
  } catch(e){ return []; }
}

// บันทึก history ลง Supabase + localStorage (fallback)
async function saveHistory(rec){
  // localStorage fallback
  state.history.unshift(rec);
  if(state.history.length>100) state.history=state.history.slice(0,100);
  localStorage.setItem('examHistory',JSON.stringify(state.history));
  // Supabase
  try {
    const uMap = await getUnitsMap();
    const resolvedUnitId = uMap[rec.unit] ? uMap[rec.unit].id : rec.unit;
    await supa.from('exam_history').insert({
      session_id: SESSION_ID,
      unit_id: resolvedUnitId,
      level: rec.level,
      exam_type: rec.examType,
      quiz_mode: rec.quizMode,
      subject_name: rec.subjName,
      score: rec.score,
      total: rec.total,
      pct: rec.pct
    });
  } catch(e){ console.warn('saveHistory Supabase error:',e); }
}

// โหลด history จาก Supabase
async function loadHistory(){
  try {
    const unitsMap = await getUnitsMap();
    const {data,error}=await supa
      .from('exam_history')
      .select('*')
      .eq('session_id',SESSION_ID)
      .order('created_at',{ascending:false})
      .limit(100);
    if(error) throw error;
    return (data||[]).map(h=>({
      id:h.id, date:new Date(h.created_at).toLocaleString('th-TH'),
      unit:h.unit_id,
      unitShort: unitsMap[h.unit_id]?.short_name || h.unit_id?.toUpperCase(),
      unitName:  unitsMap[h.unit_id]?.name  || h.unit_id,
      level:h.level,
      lvLabel:h.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร',
      examType:h.exam_type, quizMode:h.quiz_mode,
      subj:'', subjName:h.subject_name,
      score:h.score, total:h.total, pct:h.pct
    }));
  } catch(e){
    // fallback localStorage
    return JSON.parse(localStorage.getItem('examHistory')||'[]');
  }
}

function shuffle(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function goScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}

function makeBc(items){
  return items.map((it,i)=>`<span class="${i===items.length-1?'cur':''}">${it}</span>${i<items.length-1?'<span class="bc-sep">›</span>':''}`).join('');
}

async function renderUnitCards(){
  const wrap = document.getElementById('unit-cards-wrap');
  if(!wrap) return;
  const units = await loadUnits();
  if(!units || units.length === 0) return;

  wrap.innerHTML = `
    <div class="card-grid col2" style="margin-bottom:10px">
      ${units.map(u => `
        <div class="unit-card ${String(state.unit)===String(u.id)?'sel':''}" id="u-${u.id}" onclick="pickUnit(${typeof u.id==='number'?u.id:`'${u.id}'`},'${u.name}','${u.short_name || u.name}')">
          <div class="unit-icon">${u.icon || '🏢'}</div>
          <div class="unit-name">${u.short_name || u.name}</div>
          <div class="unit-desc">${u.name}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function goHome(){
  document.querySelectorAll('.unit-card').forEach(c=>c.classList.remove('sel'));
  const btn = document.getElementById('btn-home');
  if(btn) btn.disabled=true;
  state.unit='';
  goScreen('s-home');
  renderUnitCards();
}

function pickUnit(id,name,short){
  state.unit=id; state.unitName=name; state.unitShort=short;
  document.querySelectorAll('.unit-card').forEach(c=>c.classList.remove('sel'));
  const card = document.getElementById('u-'+id) || (id==1?document.getElementById('u-tm'):null);
  if(card) card.classList.add('sel');
  const btn = document.getElementById('btn-home');
  if(btn) btn.disabled=false;
}

function goLevel(){
  if(!state.unit) return;
  document.getElementById('bc-level').innerHTML=makeBc([state.unitShort,'เลือกระดับ']);
  document.getElementById('sub-level').textContent=state.unitName;
  ['lv-p','lv-s'].forEach(id=>document.getElementById(id).classList.remove('sel'));
  document.getElementById('btn-level').disabled=true;
  state.level='';
  goScreen('s-level');
}

function pickLevel(lv){
  state.level=lv;
  document.getElementById('lv-p').classList.toggle('sel',lv==='p');
  document.getElementById('lv-s').classList.toggle('sel',lv==='s');
  document.getElementById('btn-level').disabled=false;
}

function goType(){
  const lvLabel=state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร';
  document.getElementById('bc-type').innerHTML=makeBc([state.unitShort,lvLabel,'รูปแบบ']);
  document.getElementById('sub-type').textContent=state.unitName+' — '+lvLabel;
  ['tp-sub','tp-full'].forEach(id=>document.getElementById(id).classList.remove('sel'));
  document.getElementById('btn-type').disabled=true;
  state.examType='';
  goScreen('s-type');
}

function pickType(t){
  state.examType=t;
  document.getElementById('tp-sub').classList.toggle('sel',t==='sub');
  document.getElementById('tp-full').classList.toggle('sel',t==='full');
  document.getElementById('btn-type').disabled=false;
}

function goSubjOrRatio(){
  if(state.examType==='sub') goSubj();
  else goRatio();
}

async function goSubj(){
  const lvLabel=state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร';
  document.getElementById('bc-subj').innerHTML=makeBc([state.unitShort,lvLabel,'แยกวิชา','เลือกวิชา']);
  document.getElementById('sub-subj').textContent=state.unitName+' — '+lvLabel+' — เลือกวิชาที่ต้องการฝึก';
  const list=document.getElementById('subj-list');
  list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px">⏳ กำลังโหลดวิชา...</div>';
  state.selSubj='';
  state.selSubjName='';
  document.getElementById('btn-subj').disabled=true;
  goScreen('s-subj');

  // ดึงวิชาจากตาราง subjects + นับข้อสอบจริงจาก questions
  const [dbSubjs, qs] = await Promise.all([
    loadSubjects(state.unit, state.level),
    loadQuestions(state.unit, state.level)
  ]);

  const counts={};
  const byId={};
  dbSubjs.forEach(s=>{
    byId[s.id]={id:s.id, name:s.name, icon:'📄'};
    counts[s.id]=0;
  });
  qs.forEach(x=>{
    if(x.subjId==null) return;
    counts[x.subjId]=(counts[x.subjId]||0)+1;
    if(!byId[x.subjId]) byId[x.subjId]={id:x.subjId,name:x.subj||'ไม่ระบุวิชา',icon:'📄'};
  });

  const subjs=Object.values(byId).sort((a,b)=>a.name.localeCompare(b.name,'th'));

  if(subjs.length===0){
    list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text2);font-size:13px">ไม่พบวิชาในชุดนี้ กรุณาตรวจสอบข้อมูลใน Supabase</div>';
    return;
  }

  list.innerHTML='';
  subjs.forEach(subj=>{
    const row=document.createElement('div');
    row.className='subj-row';
    row.id='srow-'+subj.id;
    const n=counts[subj.id]||0;
    const hasQs=n>0;
    if(!hasQs) row.style.opacity='0.6';
    row.innerHTML=`<div class="subj-left"><div class="subj-ico">${subj.icon||'📄'}</div><div><div class="subj-name">${subj.name}</div><div class="subj-count">${n} ข้อในฐานข้อมูล</div></div></div><span class="tag tag-gray" id="stag-${subj.id}">${hasQs?'เลือก':'ยังไม่มีข้อสอบ'}</span>`;
    if(hasQs){
      row.onclick=()=>{
        state.selSubj=subj.id;
        state.selSubjName=subj.name;
        subjs.forEach(s=>{
          const t=document.getElementById('stag-'+s.id);
          if(t && counts[s.id]>0){t.className='tag tag-gray';t.textContent='เลือก';}
        });
        const tsel=document.getElementById('stag-'+subj.id);
        if(tsel){tsel.className='tag tag-blue';tsel.textContent='✓ เลือกแล้ว';}
        document.getElementById('btn-subj').disabled=false;
      };
    }
    list.appendChild(row);
  });
}

async function goRatio(){
  const lvLabel=state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร';
  document.getElementById('bc-ratio').innerHTML=makeBc([state.unitShort,lvLabel,'จำลองสอบ','โหมด']);
  document.getElementById('sub-ratio').textContent=state.unitName+' — '+lvLabel;

  const rl=document.getElementById('ratio-list');
  rl.innerHTML='<div style="padding:12px 0;color:var(--text2);font-size:12px">กำลังโหลดสัดส่วน...</div>';

  // ดึงสัดส่วนจริงจากตาราง subjects ตามหน่วย+ระดับ
  const subjs=await loadSubjects(state.unit, state.level);

  if(subjs.length===0){
    rl.innerHTML='<div style="padding:12px 0;color:var(--text2);font-size:12px">ยังไม่มีข้อมูลสัดส่วนสำหรับชุดนี้ กรุณาตรวจสอบข้อมูลใน Supabase</div>';
  } else {
    rl.innerHTML='';
    subjs.forEach(s=>{
      const ratio=(s.ratio==null)?0:s.ratio;
      const row=document.createElement('div');
      row.className='ratio-row';
      row.innerHTML=`<span style="font-size:13px;color:var(--text)">${s.icon||'📄'} ${s.name}</span><div style="display:flex;align-items:center;gap:8px"><div class="ratio-bar-track"><div class="ratio-bar-fill" style="width:${ratio}%"></div></div><span style="font-size:12px;color:var(--text2);min-width:30px;text-align:right">${ratio}%</span></div>`;
      rl.appendChild(row);
    });
  }

  ['fm-i','fm-e'].forEach(id=>document.getElementById(id).classList.remove('sel'));
  document.getElementById('btn-ratio').disabled=true;
  state.quizMode='';
  goScreen('s-ratio');
}

function pickFMode(m){
  state.quizMode=m;
  document.getElementById('fm-i').classList.toggle('sel',m==='instant');
  document.getElementById('fm-e').classList.toggle('sel',m==='exam');
  document.getElementById('btn-ratio').disabled=false;
}

function goMode(from){
  const lvLabel=state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร';
  const subjName=state.selSubjName||'วิชาที่เลือก';
  document.getElementById('bc-mode').innerHTML=makeBc([state.unitShort,lvLabel,'แยกวิชา',subjName,'โหมด']);
  document.getElementById('sub-mode').textContent=state.unitName+' — '+subjName;
  ['sm-i','sm-e'].forEach(id=>document.getElementById(id).classList.remove('sel'));
  document.getElementById('btn-mode').disabled=true;
  state.quizMode='';
  goScreen('s-mode');
}

function pickSMode(m){
  state.quizMode=m;
  document.getElementById('sm-i').classList.toggle('sel',m==='instant');
  document.getElementById('sm-e').classList.toggle('sel',m==='exam');
  document.getElementById('btn-mode').disabled=false;
}

// สุ่มตัวเลือกและจำตำแหน่งเฉลยใหม่ต่อ 1 ข้อ
function shuffleChoices(q){
  const indexed=q.c.map((text,i)=>({text,isAnswer:i===q.a}));
  const shuffled=shuffle(indexed);
  return {
    ...q,
    c: shuffled.map(x=>x.text),
    a: shuffled.findIndex(x=>x.isAnswer)
  };
}

async function startQuiz(){
  goScreen('s-quiz');
  document.getElementById('q-text').textContent='กำลังโหลดข้อสอบ...';
  document.getElementById('q-choices').innerHTML='';
  document.getElementById('q-tags').innerHTML='';
  document.getElementById('q-img-wrap').style.display='none';
  document.getElementById('q-feedback').style.display='none';
  ['qb-prev','qb-next','qb-submit'].forEach(id=>document.getElementById(id).style.display='none');

  // ดึงข้อสอบจริงจาก Supabase
  const rawQs=await loadQuestions(state.unit, state.level, state.examType==='sub'?state.selSubj:null);

  if(rawQs.length===0){
    document.getElementById('q-text').textContent='ไม่พบข้อสอบในชุดนี้ กรุณาเลือกวิชา/ระดับอื่น หรือตรวจสอบข้อมูลใน Supabase';
    document.getElementById('q-choices').innerHTML='<button class="btn btn-outline" onclick="goHome()" style="margin-top:16px;width:100%">← กลับหน้าหลัก</button>';
    return;
  }

  // สุ่มลำดับข้อ + สุ่มตัวเลือกแต่ละข้อ
  state.questions=shuffle(rawQs).map(q=>shuffleChoices(q));
  state.cur=0;
  state.ans=Array(state.questions.length).fill(null);
  state.done=Array(state.questions.length).fill(false);
  renderQ();
}

const labels=['ก','ข','ค','ง'];

function formatMultiline(s){
  if(s==null) return '';
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
}

function escapeHtml(s){
  if(s==null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderQ(){
  const q=state.questions[state.cur];
  const total=state.questions.length;
  const pct=Math.round((state.cur/total)*100);
  document.getElementById('pbar-fill').style.width=pct+'%';
  document.getElementById('q-num').textContent='ข้อ '+(state.cur+1)+' / '+total;

  const modeTag=state.quizMode==='instant'
    ?'<span class="tag tag-blue">💡 ฝึกซ้อม</span>'
    :'<span class="tag tag-yellow">📋 จำลองสอบ</span>';
  const shuffleTag='<span class="tag" style="background:var(--surface2);color:var(--text3);border:1px solid var(--border)">🔀 สุ่มแล้ว</span>';
  document.getElementById('q-tags').innerHTML=`<span class="tag" style="background:var(--surface2);color:var(--text2);border:1px solid var(--border)">${q.subjIcon||''} ${q.subj||''}</span>${modeTag}${shuffleTag}`;
  document.getElementById('q-text').textContent=formatMultiline(q.q);

  const imgWrap=document.getElementById('q-img-wrap');
  if(q.img){imgWrap.style.display='block';document.getElementById('q-img').src=q.img;}
  else imgWrap.style.display='none';

  const ch=document.getElementById('q-choices');
  ch.innerHTML='';
  q.c.forEach((c,i)=>{
    const btn=document.createElement('button');
    btn.className='choice-btn';
    let cls='';
    if(state.ans[state.cur]===i){
      if(state.quizMode==='instant'&&state.done[state.cur]) cls=i===q.a?'ok':'ng';
      else cls='sel';
    } else if(state.quizMode==='instant'&&state.done[state.cur]&&i===q.a) cls='ok';
    if(cls) btn.classList.add(cls);
    if(state.quizMode==='instant'&&state.done[state.cur]) btn.disabled=true;
    btn.innerHTML=`<span class="choice-lbl">${labels[i]}</span><span>${escapeHtml(formatMultiline(c))}</span>`;
    btn.onclick=()=>pickAns(i);
    ch.appendChild(btn);
  });

  const fb=document.getElementById('q-feedback');
  if(state.quizMode==='instant'&&state.done[state.cur]){
    const ok=state.ans[state.cur]===q.a;
    fb.className='feedback '+(ok?'ok':'ng');
    document.getElementById('fb-title').textContent=ok?'✓ ถูกต้อง':'✗ ไม่ถูกต้อง';
    document.getElementById('fb-body').textContent=formatMultiline(q.e);
    fb.style.display='block';
  } else fb.style.display='none';

  const prev=document.getElementById('qb-prev');
  const next=document.getElementById('qb-next');
  const sub=document.getElementById('qb-submit');
  prev.style.display=state.cur>0?'block':'none';
  if(state.quizMode==='exam'){
    next.style.display=state.cur<total-1?'block':'none';
    sub.style.display=state.cur===total-1&&state.ans.every(a=>a!==null)?'block':'none';
  } else {
    next.style.display=state.done[state.cur]&&state.cur<total-1?'block':'none';
    sub.style.display=state.done[state.cur]&&state.cur===total-1?'block':'none';
  }
}

function pickAns(i){
  if(state.quizMode==='instant'&&state.done[state.cur]) return;
  state.ans[state.cur]=i;
  if(state.quizMode==='instant') state.done[state.cur]=true;
  renderQ();
}
function qPrev(){if(state.cur>0){state.cur--;renderQ();}}
function qNext(){if(state.cur<state.questions.length-1){state.cur++;renderQ();}}

async function showResult(){
  const score=state.ans.filter((a,i)=>a===state.questions[i].a).length;
  const total=state.questions.length;
  const pct=Math.round((score/total)*100);
  document.getElementById('r-score').textContent=score+' / '+total;
  document.getElementById('r-pct').textContent='คะแนน '+pct+'% — '+state.unitShort+' '+(state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร');

  const prevScores=state.history.filter(h=>h.unit===state.unit&&h.level===state.level&&h.subj===(state.selSubj||'all')).map(h=>h.pct);
  const avg=prevScores.length>0?Math.round(prevScores.reduce((a,b)=>a+b,0)/prevScores.length):null;
  const best=prevScores.length>0?Math.max(...prevScores):null;
  const diff=avg!==null?pct-avg:null;

  document.getElementById('r-stats').innerHTML=`
    <div class="stat-box"><div class="stat-val" style="color:${pct>=70?'var(--success)':pct>=50?'var(--warning)':'var(--danger)'}">${pct}%</div><div class="stat-lbl">ครั้งนี้</div></div>
    <div class="stat-box"><div class="stat-val">${avg!==null?avg+'%':'—'}</div><div class="stat-lbl">เฉลี่ย</div></div>
    <div class="stat-box"><div class="stat-val">${best!==null?best+'%':'—'}</div><div class="stat-lbl">สูงสุด</div></div>
    <div class="stat-box"><div class="stat-val" style="color:${diff===null?'var(--text)':diff>=0?'var(--success)':'var(--danger)'}">${diff===null?'—':(diff>=0?'+':'')+diff+'%'}</div><div class="stat-lbl">จากเฉลี่ย</div></div>`;

  const dots=document.getElementById('r-dots');
  dots.innerHTML='';
  state.questions.forEach((_,i)=>{
    const ok=state.ans[i]===state.questions[i].a;
    const d=document.createElement('div');
    d.className='rdot '+(ok?'ok':'ng');
    d.textContent=i+1;
    dots.appendChild(d);
  });

  const rev=document.getElementById('r-review');
  rev.innerHTML='';
  state.questions.forEach((q,i)=>{
    const ok=state.ans[i]===q.a;
    const userAns=state.ans[i]!=null&&state.ans[i]>=0?`${labels[state.ans[i]]}. ${escapeHtml(formatMultiline(q.c[state.ans[i]]))}`:'(ไม่ได้ตอบ)';
    const d=document.createElement('div');
    d.className='review-item';
    d.innerHTML=`<div class="review-q">ข้อ ${i+1}: ${escapeHtml(formatMultiline(q.q))}</div>
    <div class="review-ans" style="color:${ok?'var(--success)':'var(--danger)'}">คำตอบของคุณ: ${userAns} ${ok?'✓':'✗'}</div>
    ${!ok?`<div class="review-ans" style="color:var(--success)">เฉลย: ${labels[q.a]}. ${escapeHtml(formatMultiline(q.c[q.a]))}</div>`:''}
    <div class="review-explain">${escapeHtml(formatMultiline(q.e))}</div>`;
    rev.appendChild(d);
  });

  const subjName=state.examType==='full'?'จำลองสอบจริง (รวมทุกวิชา)':(state.selSubjName||'');
  const rec={
    id:Date.now(),
    date:new Date().toLocaleString('th-TH'),
    unit:state.unit, unitShort:state.unitShort, unitName:state.unitName,
    level:state.level, lvLabel:state.level==='p'?'ชั้นประทวน':'ชั้นสัญญาบัตร',
    examType:state.examType, quizMode:state.quizMode,
    subj:state.selSubj||'all', subjName,
    score, total, pct
  };
  await saveHistory(rec);

  goScreen('s-result');
}

function restartSame(){
  startQuiz();
}

async function goHistory(){
  document.getElementById('h-list').innerHTML='<div class="empty-hist"><div class="big">⏳</div><p>กำลังโหลด...</p></div>';
  goScreen('s-history');
  state.history=await loadHistory();
  renderHistory('all');
}

function renderHistory(filterUnit){
  const hist=state.history;
  const units=[...new Set(hist.map(h=>h.unit))];

  const stats=document.getElementById('h-stats');
  if(hist.length===0){
    stats.innerHTML='';
  } else {
    const filtered=filterUnit==='all'?hist:hist.filter(h=>h.unit===filterUnit);
    const avg=filtered.length?Math.round(filtered.reduce((a,b)=>a+b.pct,0)/filtered.length):0;
    const best=filtered.length?Math.max(...filtered.map(h=>h.pct)):0;
    const subjCount=[...new Set(filtered.map(h=>h.subjName))].length;
    stats.innerHTML=`
      <div class="hist-stat"><div class="hist-stat-val" style="color:var(--accent)">${filtered.length}</div><div class="hist-stat-lbl">ครั้งที่สอบ</div></div>
      <div class="hist-stat"><div class="hist-stat-val" style="color:${avg>=70?'var(--success)':avg>=50?'var(--warning)':'var(--danger)'}">${avg}%</div><div class="hist-stat-lbl">เฉลี่ย</div></div>
      <div class="hist-stat"><div class="hist-stat-val" style="color:var(--success)">${best}%</div><div class="hist-stat-lbl">สูงสุด</div></div>
      <div class="hist-stat"><div class="hist-stat-val">${subjCount}</div><div class="hist-stat-lbl">รูปแบบ</div></div>`;
  }

  const filters=document.getElementById('h-filters');
  filters.innerHTML=`<button class="filter-btn ${filterUnit==='all'?'active':''}" onclick="renderHistory('all')">ทั้งหมด</button>`;
  units.forEach(u=>{
    const s=hist.find(h=>h.unit===u);
    if(s) filters.innerHTML+=`<button class="filter-btn ${filterUnit===u?'active':''}" onclick="renderHistory('${u}')">${s.unitShort}</button>`;
  });

  const list=document.getElementById('h-list');
  const filtered=filterUnit==='all'?hist:hist.filter(h=>h.unit===filterUnit);
  if(filtered.length===0){
    list.innerHTML=`<div class="empty-hist"><div class="big">📋</div><p>ยังไม่มีประวัติการสอบ<br>เริ่มทำข้อสอบแล้วผลจะปรากฏที่นี่</p></div>`;
    return;
  }
  list.innerHTML='<div class="hlist">';
  filtered.forEach(h=>{
    const color=h.pct>=70?'var(--success)':h.pct>=50?'var(--warning)':'var(--danger)';
    const dotColor=h.pct>=70?'var(--success)':h.pct>=50?'var(--warning)':'var(--danger)';
    const modeLabel=h.quizMode==='instant'?'ฝึกซ้อม':'จำลองสอบ';
    list.innerHTML+=`<div class="hitem">
      <div class="hdot" style="background:${dotColor}"></div>
      <div class="hitem-body">
        <div class="hitem-title">${h.unitShort} — ${h.lvLabel}</div>
        <div class="hitem-sub">${h.subjName} · ${modeLabel}</div>
        <div class="hitem-time">${h.date}</div>
      </div>
      <div class="hitem-right">
        <div class="hitem-score" style="color:${color}">${h.pct}%</div>
        <div style="font-size:11px;color:var(--text3)">${h.score}/${h.total}</div>
      </div>
    </div>`;
  });
  list.innerHTML+='</div>';
}

async function clearHistory(){
  if(!confirm('ลบประวัติการสอบทั้งหมด?')) return;
  state.history=[];
  localStorage.removeItem('examHistory');
  try{
    await supa.from('exam_history').delete().eq('session_id',SESSION_ID);
  }catch(e){console.warn(e);}
  renderHistory('all');
}
