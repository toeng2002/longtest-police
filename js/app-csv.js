/* ============================================================
   app-csv.js — นำเข้าข้อสอบจากไฟล์ CSV
   ขั้นตอน: 1 ดาวน์โหลด template → 2 อัปโหลด → 3 ตรวจสอบ → 4 นำเข้า
   ต้องโหลดหลัง exam-db.js และ app-settings.js
   ============================================================ */

// ---------- ตัวช่วยสร้างสตริง (เลี่ยงปัญหา escape ของตัวแก้ไฟล์) ----------
const C = String.fromCharCode;
const NL = C(10);              // ขึ้นบรรทัดใหม่
const CR = C(13);              // carriage return
const DQ = C(34);              // "
const BOM = C(65279);          // byte order mark
const DASH = C(45);            // -

// คอลัมน์ที่ต้องมี
const CSV_REQUIRED = ['unit', 'level', 'subject', 'question', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'answer'];
const CSV_OPTIONAL = ['explanation', 'difficulty', 'source', 'question_image_url',
  'choice_a_image_url', 'choice_b_image_url', 'choice_c_image_url', 'choice_d_image_url',
  'explanation_image_url', 'publish'];

let CSV_ROWS = [];        // แถวที่อ่านและตรวจแล้ว
let CSV_FILE_NAME = '';
let CSV_LOOKUP_BY_ID = {};     // key = subject_lookup.id → ทะเบียนวิชา
let CSV_LOOKUP_BY_NAME = {};   // key = lowercase name → ทะเบียนวิชา
let CSV_SUBJ_CACHE = {};       // key = unit|level|name → subjects.id (ที่จัดลงหน่วยงาน)
let CSV_SUBJ_BY_NAME = {};     // key = lowercase name → array of subjects rows

/* ============================================================
   1) ดาวน์โหลดไฟล์ template
   ============================================================ */

// ครอบค่าด้วย " ถ้าจำเป็น (มี comma, quote, ขึ้นบรรทัดใหม่)
function csvCell(v) {
  const s = (v == null ? '' : String(v));
  if (s.indexOf(DQ) !== -1 || s.indexOf(',') !== -1 || s.indexOf(NL) !== -1 || s.indexOf(CR) !== -1) {
    return DQ + s.split(DQ).join(DQ + DQ) + DQ;
  }
  return s;
}

function csvLine(arr) {
  return arr.map(csvCell).join(',');
}

function csvText(rows) {
  // BOM + CRLF ให้ Excel เปิดภาษาไทยได้ถูกต้อง
  return BOM + rows.map(csvLine).join(CR + NL) + CR + NL;
}

// สร้างและดาวน์โหลดไฟล์
function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ตัวช่วยสร้าง HTML (กรณี app-settings.js ยังไม่ถูกโหลดหรือมีปัญหา)
function esc(s) {
  return String(s == null ? '' : s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

// จัดรูปแบบข้อความที่มีการขึ้นบรรทัดใหม่จาก CSV หรือ Excel (Alt+Enter หรือ \n หรือ <br>)
function normalizeCsvNewlines(val) {
  if (val == null) return '';
  return String(val)
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

// ล้างค่า URL รูปภาพ ป้องกันค่าบูลีน 'true'/'false' หรือข้อความว่างหลุดเข้ามา
function cleanImgUrl(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || /^(true|false|null|undefined|0|1|none)$/i.test(s)) return null;
  return s;
}

// template เปล่า: หัวคอลัมน์ + ตัวอย่าง 3 แถว (อิงตาม Unit ID และ Subject ID จากทะเบียนวิชา subject_lookup เช่น 1=ตม., 1=กฎหมาย ตม.)
function buildTemplateCsv() {
  const head = CSV_REQUIRED.concat(CSV_OPTIONAL);
  const rows = [head];

  rows.push(['1', 'p', '1', 'พ.ร.บ. คนเข้าเมือง พ.ศ. 2522 มีผลบังคับใช้เมื่อใด?',
    '1 มกราคม 2522', '27 กุมภาพันธ์ 2523', '1 มีนาคม 2522', '31 ธันวาคม 2522',
    'b', 'มีผลบังคับใช้ตั้งแต่วันที่ 27 กุมภาพันธ์ 2523' + NL + NL + 'อ้างอิง: มาตรา 2 แห่ง พ.ร.บ. คนเข้าเมือง พ.ศ. 2522', 'medium', 'ข้อสอบปี 2565 รอบ 1',
    '', '', '', '', '', '', 'true']);

  rows.push(['1', 'p', '2', 'ข้อใดเขียนถูกต้อง?',
    'กระเพราะ', 'กระเพาะ', 'กะเพราะ', 'กะเพาะ',
    'b', 'สะกดถูกต้องตามพจนานุกรมฉบับราชบัณฑิตยสถาน', 'easy', '',
    '', '', '', '', '', '', 'true']);

  rows.push(['1,3', 'p,s', '3', 'ประเทศไทยมีกี่จังหวัด?',
    '75 จังหวัด', '76 จังหวัด', '77 จังหวัด', '78 จังหวัด',
    'c', 'ประเทศไทยมีทั้งหมด 77 จังหวัด', 'easy', 'ข้อสอบปี 2564',
    '', '', '', '', '', '', 'true']);

  return csvText(rows);
}

function downloadCsvTemplate() {
  downloadTextFile('template-ข้อสอบ.csv', buildTemplateCsv());
  showToast('ดาวน์โหลด template แล้ว', 'success');
}

// ตัวอย่างเต็ม 5 ข้อ (ให้เห็นรูปแบบครบ อิงตาม Unit ID และ Subject ID จากทะเบียนวิชา subject_lookup)
function buildSampleCsv() {
  const head = CSV_REQUIRED.concat(CSV_OPTIONAL);
  const qs = [
    ['1', 'p', '1', 'คนต่างด้าวที่เข้ามาโดยไม่ได้รับอนุญาต มีความผิดตามมาตราใด?',
      'มาตรา 11', 'มาตรา 54', 'มาตรา 81', 'มาตรา 101', 'c',
      'มาตรา 81 โทษจำคุกไม่เกิน 2 ปี หรือปรับไม่เกิน 20,000 บาท', 'medium', 'ข้อสอบปี 2565'],
    ['1', 'p', '1', 'ใครมีอำนาจสั่งเนรเทศคนต่างด้าวออกนอกราชอาณาจักร?',
      'ผบ.ตร.', 'อธิบดีกรมการปกครอง', 'รัฐมนตรีว่าการกระทรวงมหาดไทย', 'นายกรัฐมนตรี', 'c',
      'รัฐมนตรีว่าการกระทรวงมหาดไทย มีอำนาจสั่งเนรเทศ', 'hard', ''],
    ['1', 's', '7', 'Choose the correct sentence.',
      'He don not have a visa.', 'He does not have a visa.', 'He not have a visa.', 'He have not a visa.', 'b',
      'ประธานเป็นบุรุษที่ 3 เอกพจน์ ใช้ does not', 'medium', ''],
    ['1', 'p', '3', 'ASEAN มีสมาชิกกี่ประเทศ?',
      '8 ประเทศ', '9 ประเทศ', '10 ประเทศ', '11 ประเทศ', 'c',
      'อาเซียนมีสมาชิก 10 ประเทศ', 'easy', ''],
    ['1', 's', '4', 'โทษทางอาญาตาม ป.อาญา มีกี่สถาน?',
      '3 สถาน', '4 สถาน', '5 สถาน', '6 สถาน', 'c',
      'มี 5 สถาน: ประหารชีวิต จำคุก กักขัง ปรับ ริบทรัพย์สิน', 'medium', '']
  ];
  const rows = [head];
  qs.forEach(function (q) {
    rows.push(q.concat(['', '', '', '', '', '', 'true']));
  });
  return csvText(rows);
}

function downloadCsvSample() {
  downloadTextFile('ตัวอย่างข้อสอบ-5ข้อ.csv', buildSampleCsv());
  showToast('ดาวน์โหลดตัวอย่างแล้ว', 'success');
}

// รายชื่อหน่วย+วิชาที่มีในระบบ (อิงรหัสวิชาจากทะเบียนวิชา subject_lookup และแสดงการจัดลงหน่วยงานใน subjects)
async function downloadCsvSubjects() {
  showToast('กำลังสร้างไฟล์...', '');
  try {
    const [uRes, lRes, sRes] = await Promise.all([
      supa.from('units').select('*').order('id'),
      supa.from('subject_lookup').select('*').order('sort_order').order('id'),
      supa.from('subjects').select('*').order('unit_id').order('id')
    ]);

    const units = uRes.data || [];
    const lookups = lRes.data || [];
    const subjects = sRes.data || [];

    const unitById = {};
    units.forEach(function (u) { unitById[u.id] = u; });

    const rows = [
      ['subject_id (รหัสวิชา)', 'subject_name (ชื่อวิชา)', 'unit_id (รหัสหน่วย)', 'unit_name (ชื่อหน่วย)', 'short_name', 'level (ระดับ)', 'ratio (สัดส่วน)']
    ];

    lookups.forEach(function (l) {
      const mappings = subjects.filter(function (s) {
        return s.name && s.name.trim().toLowerCase() === l.name.trim().toLowerCase();
      });

      if (mappings.length > 0) {
        mappings.forEach(function (m) {
          const u = unitById[m.unit_id];
          rows.push([
            l.id,
            l.name,
            m.unit_id,
            u ? u.name : '',
            u ? (u.short_name || '') : '',
            m.level,
            m.ratio == null ? '' : m.ratio
          ]);
        });
      } else {
        rows.push([
          l.id,
          l.name,
          '',
          '',
          '',
          '',
          ''
        ]);
      }
    });

    downloadTextFile('รายชื่อหน่วยและวิชา-อิงID.csv', csvText(rows));
    showToast('ดาวน์โหลดรายชื่ออิง ID แล้ว', 'success');
  } catch (e) {
    showToast('สร้างไฟล์ไม่สำเร็จ: ' + e.message, 'danger');
  }
}
/* ============================================================
   2) ตัวอ่านไฟล์ CSV (parser)
   รองรับ: เครื่องหมายคำพูด, comma ในข้อความ, ขึ้นบรรทัดใหม่ใน cell
   ============================================================ */
function parseCsv(text) {
  // ตัด BOM ถ้ามี
  if (text.charCodeAt(0) === 65279) text = text.slice(1);

  // ตรวจสอบ delimiter อัตโนมัติ (, หรือ ;) จากบรรทัดแรก
  const firstLine = (text.split(/\r\n|\r|\n/)[0] || '').trim();
  let delimiter = ',';
  if (firstLine) {
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    if (semiCount > commaCount && commaCount <= 2) {
      delimiter = ';';
    }
  }

  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuote) {
      if (ch === DQ) {
        if (text[i + 1] === DQ) { cell += DQ; i++; }   // "" → "
        else inQuote = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === DQ) { inQuote = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === NL || ch === CR) {
      if (ch === CR && text[i + 1] === NL) i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  // เก็บ cell สุดท้าย (ถ้าไฟล์ไม่จบด้วยบรรทัดใหม่)
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // ตัดบรรทัดว่างทิ้ง
  return rows.filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ''; });
  });
}

// แปลงแถวเป็น object โดยใช้หัวคอลัมน์ (รองรับชื่อ alias)
function csvToObjects(rows) {
  if (rows.length < 2) return { head: [], items: [] };
  const rawHead = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });

  const aliasMap = {
    'unit_id': 'unit',
    'unit id': 'unit',
    'หน่วย': 'unit',
    'หน่วยงาน': 'unit',
    'level': 'level',
    'ระดับ': 'level',
    'subject_id': 'subject',
    'subject id': 'subject',
    'รหัสวิชา': 'subject',
    'id วิชา': 'subject',
    'id_subject': 'subject',
    'subject_name': 'subject',
    'subject': 'subject',
    'วิชา': 'subject',
    'ชื่อวิชา': 'subject',
    'question': 'question',
    'โจทย์': 'question',
    'คำถาม': 'question',
    'choice a': 'choice_a',
    'ข้อ a': 'choice_a',
    'choice b': 'choice_b',
    'ข้อ b': 'choice_b',
    'choice c': 'choice_c',
    'ข้อ c': 'choice_c',
    'choice d': 'choice_d',
    'ข้อ d': 'choice_d',
    'ans': 'answer',
    'answer': 'answer',
    'เฉลย': 'answer',
    'explanation': 'explanation',
    'คำอธิบาย': 'explanation',
    'difficulty': 'difficulty',
    'ความยาก': 'difficulty',
    'source': 'source',
    'ที่มา': 'source',
    'publish': 'publish',
    'เผยแพร่': 'publish',
    'question_image_url': 'question_image_url',
    'question_image': 'question_image_url',
    'question image': 'question_image_url',
    'image': 'question_image_url',
    'รูป': 'question_image_url',
    'รูปภาพ': 'question_image_url',
    'รูปคำถาม': 'question_image_url',
    'รูปภาพคำถาม': 'question_image_url',
    'choice_a_image_url': 'choice_a_image_url',
    'choice_a_image': 'choice_a_image_url',
    'choice_b_image_url': 'choice_b_image_url',
    'choice_b_image': 'choice_b_image_url',
    'choice_c_image_url': 'choice_c_image_url',
    'choice_c_image': 'choice_c_image_url',
    'choice_d_image_url': 'choice_d_image_url',
    'choice_d_image': 'choice_d_image_url',
    'explanation_image_url': 'explanation_image_url',
    'explanation_image': 'explanation_image_url',
    'รูปเฉลย': 'explanation_image_url',
    'รูปภาพเฉลย': 'explanation_image_url'
  };

  const head = rawHead.map(function (h) {
    return aliasMap[h] || h;
  });

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const o = { __row: i + 1 };   // เลขแถวในไฟล์ (เริ่มที่ 1 รวมหัว)
    head.forEach(function (h, j) {
      const val = rows[i][j] == null ? '' : String(rows[i][j]).trim();
      if (h === 'subject' && o.subject && /^\d+$/.test(val)) {
        o.subject = val;
      } else if (!o[h] || val) {
        o[h] = val;
      }
    });
    items.push(o);
  }
  return { head: head, items: items };
}
/* ============================================================
   3) อัปโหลดไฟล์ + ตรวจสอบข้อมูล
   ============================================================ */
function setCsvStep(n) {
  document.querySelectorAll('#csv-steps .csv-step').forEach(function (el) {
    const s = Number(el.dataset.step);
    el.classList.remove('done', 'active', 'wait');
    if (s < n) el.classList.add('done');
    else if (s === n) el.classList.add('active');
    else el.classList.add('wait');
  });
}

// ผู้ใช้เลือกไฟล์แล้ว
function onCsvPicked(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  readCsvFile(file);
  try { input.value = ''; } catch (e) {}
}

function readCsvFile(file) {
  if (!/\.csv$/i.test(file.name)) {
    showToast('รองรับเฉพาะไฟล์ .csv เท่านั้น', 'danger');
    return;
  }
  CSV_FILE_NAME = file.name;

  const reader = new FileReader();
  reader.onload = async function (e) {
    const buffer = e.target.result;
    let text = '';
    // ตรวจสอบการถอดรหัส UTF-8 และ fallback เป็น windows-874 สำหรับภาษาไทยจาก Excel บน Windows
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (err) {
      try {
        text = new TextDecoder('windows-874').decode(buffer);
      } catch (err2) {
        text = new TextDecoder('utf-8').decode(buffer);
      }
    }
    await reviewCsv(text);
  };
  reader.onerror = function () { showToast('อ่านไฟล์ไม่สำเร็จ', 'danger'); };
  reader.readAsArrayBuffer(file);
}

// ตรวจข้อมูลทั้งไฟล์ แล้วแสดงผลให้ผู้ใช้เห็นก่อนนำเข้า
async function reviewCsv(text) {
  const raw = parseCsv(text);
  if (raw.length < 2) {
    showToast('ไฟล์ว่าง หรือไม่มีข้อมูล (ต้องมีหัวคอลัมน์ + อย่างน้อย 1 แถว)', 'danger');
    return;
  }

  const parsed = csvToObjects(raw);
  const head = parsed.head;

  // เช็คหัวคอลัมน์ที่จำเป็น
  const missing = CSV_REQUIRED.filter(function (c) { return head.indexOf(c) === -1; });
  if (missing.length > 0) {
    setCsvStep(2);
    showCsvFatal('ไฟล์ขาดคอลัมน์ที่จำเป็น: ' + missing.join(', '),
      'คอลัมน์ที่ต้องมี: ' + CSV_REQUIRED.join(', '));
    return;
  }

  // โหลดแคชวิชาและหน่วยงานล่วงหน้า เพื่อใช้ตรวจสอบ ID
  try {
    await csvLoadSubjects();
  } catch (e) {
    console.warn('โหลดรายวิชาล่วงหน้าไม่สำเร็จ:', e);
  }

  // ตรวจทีละแถว
  const rows = [];
  parsed.items.forEach(function (o) {
    rows.push(validateCsvRow(o));
  });

  CSV_ROWS = rows;
  renderCsvReview(parsed.items.length);
}

// แสดงข้อความ error แบบหยุดการทำงาน
function showCsvFatal(msg, detail) {
  const el = document.getElementById('csv-review');
  el.style.display = 'block';
  document.getElementById('csv-summary').innerHTML =
    '<div class="notice danger" style="display:flex">' +
    '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/></svg>' +
    '<div><b>' + esc(msg) + '</b><br><span style="font-size:12px">' + esc(detail || '') + '</span></div></div>';
  document.getElementById('csv-errors').innerHTML = '';
  document.getElementById('csv-preview').innerHTML = '';
  document.getElementById('csv-import-btn').style.display = 'none';
  document.getElementById('csv-done').style.display = 'none';
}

// ตรวจแถวเดียว → คืน { data, errors, warnings, ok }
function validateCsvRow(o) {
  const errors = [];
  const warnings = [];
  const rawSubj = (o.subject || '').trim();
  let subjectId = null;
  let subjectName = rawSubj;

  const data = {
    row: o.__row,
    units: (o.unit || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    levels: (o.level || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    subject: '',
    subject_id: null,
    subjectLabel: '',
    question: normalizeCsvNewlines(o.question),
    choice_a: normalizeCsvNewlines(o.choice_a),
    choice_b: normalizeCsvNewlines(o.choice_b),
    choice_c: normalizeCsvNewlines(o.choice_c),
    choice_d: normalizeCsvNewlines(o.choice_d),
    answer: (o.answer || '').trim().toLowerCase(),
    explanation: normalizeCsvNewlines(o.explanation),
    difficulty: o.difficulty || 'medium',
    source: o.source || '',
    question_image: cleanImgUrl(o.question_image_url),
    choice_a_image: cleanImgUrl(o.choice_a_image_url),
    choice_b_image: cleanImgUrl(o.choice_b_image_url),
    choice_c_image: cleanImgUrl(o.choice_c_image_url),
    choice_d_image: cleanImgUrl(o.choice_d_image_url),
    explanation_image: cleanImgUrl(o.explanation_image_url),
    published: /^(true|1|yes|y)$/i.test(o.publish || '')
  };

  const legacyCodeToId = { 'tm': '1', 'ss': '2', 'jr': '3', 'pp': '4', 'ak': '5', 'nr': '6', 'test': '7' };
  if (data.units.length === 0) {
    // ถ้ายังไม่มี unit แต่ subject เป็นเลข ID จะพยายามดึงจาก subject ด้านล่าง
  } else {
    data.units = data.units.map(function (u) {
      if (/^\d+$/.test(u)) return u;
      const lower = u.toLowerCase();
      if (legacyCodeToId[lower]) {
        warnings.push('แปลงรหัสหน่วย "' + u + '" เป็น ID ' + legacyCodeToId[lower] + ' อัตโนมัติ (แนะนำให้ใช้ ID ตัวเลขโดยตรง)');
        return legacyCodeToId[lower];
      }
      errors.push('รหัสหน่วยงาน (unit) ต้องเป็น ID ตัวเลข เช่น 1, 2, 3 หรือ 1,3 (พบ: "' + u + '" — ดู ID ได้จากปุ่ม "รายชื่อหน่วย+วิชาที่มี")');
      return u;
    });
  }

  // ตรวจสอบคอลัมน์ subject (อิงรหัสวิชาจากทะเบียนวิชา subject_lookup หรือชื่อวิชา)
  if (!rawSubj) {
    errors.push('ไม่มีรหัสวิชาหรือชื่อวิชา (subject)');
  } else if (/^\d+$/.test(rawSubj)) {
    subjectId = Number(rawSubj);
    const found = CSV_LOOKUP_BY_ID[subjectId] || CSV_LOOKUP_BY_ID[String(subjectId)];
    if (found) {
      subjectName = found.name;
    } else {
      errors.push('ไม่พบรหัสวิชา (subject ID) "' + rawSubj + '" ในทะเบียนวิชา (subject_lookup) — กรุณาดู ID ที่ถูกต้องจากปุ่ม "รายชื่อหน่วย+วิชาที่มี"');
    }
  } else {
    subjectName = rawSubj;
    const found = CSV_LOOKUP_BY_NAME[rawSubj.toLowerCase()];
    if (found) {
      subjectId = found.id;
    }
  }

  // ถ้ายังไม่ได้ระบุ unit หรือ level แต่ใน subjects มีการจัดวิชานี้ไว้แค่หน่วยเดียว สามารถเติมให้อัตโนมัติได้
  if (subjectName && CSV_SUBJ_BY_NAME && CSV_SUBJ_BY_NAME[subjectName.toLowerCase()]) {
    const mappings = CSV_SUBJ_BY_NAME[subjectName.toLowerCase()];
    if (data.units.length === 0) {
      const distinctUnits = [];
      mappings.forEach(function (m) {
        const uStr = String(m.unit_id);
        if (distinctUnits.indexOf(uStr) === -1) distinctUnits.push(uStr);
      });
      if (distinctUnits.length === 1) {
        data.units = distinctUnits;
      }
    }
    if (data.levels.length === 0) {
      const distinctLevels = [];
      mappings.forEach(function (m) {
        if (distinctLevels.indexOf(m.level) === -1) distinctLevels.push(m.level);
      });
      if (distinctLevels.length === 1) {
        data.levels = distinctLevels[0] === 'both' ? ['p', 's'] : [distinctLevels[0]];
      }
    }
  }

  data.subject = subjectName;
  data.subject_id = subjectId;
  data.subjectLabel = subjectId ? (subjectName + ' (ID: ' + subjectId + ')') : subjectName;

  if (data.units.length === 0) {
    errors.push('ไม่มีรหัสหน่วยงาน (unit)');
  }

  if (data.levels.length === 0) errors.push('ไม่มีระดับชั้น (level)');
  data.levels.forEach(function (lv) {
    if (lv !== 'p' && lv !== 's' && lv !== 'both') {
      errors.push('level ต้องเป็น p / s / both (พบ: ' + lv + ')');
    }
  });

  if (!data.subject) errors.push('ไม่มีชื่อวิชา (subject)');
  if (!data.question) errors.push('ไม่มีข้อความคำถาม (question)');

  ['choice_a', 'choice_b', 'choice_c', 'choice_d'].forEach(function (k) {
    if (!data[k]) errors.push('ตัวเลือก ' + k.slice(-1).toUpperCase() + ' ว่าง');
  });

  if (['a', 'b', 'c', 'd'].indexOf(data.answer) === -1) {
    errors.push('เฉลย (answer) ต้องเป็น a / b / c / d (พบ: ' + (o.answer || 'ว่าง') + ')');
  }

  // เตือน (ไม่บล็อกการนำเข้า)
  if (!data.explanation) warnings.push('ไม่มีคำอธิบายเฉลย');

  return { data: data, errors: errors, warnings: warnings, ok: errors.length === 0 };
}
/* ============================================================
   แสดงผลการตรวจสอบ (ขั้นตอนที่ 3)
   ============================================================ */
function renderCsvReview(total) {
  setCsvStep(3);
  document.getElementById('csv-review').style.display = 'block';
  document.getElementById('csv-done').style.display = 'none';
  document.getElementById('csv-import-btn').style.display = '';

  const okRows = CSV_ROWS.filter(function (r) { return r.ok; });
  const badRows = CSV_ROWS.filter(function (r) { return !r.ok; });
  const warnCount = okRows.filter(function (r) { return r.warnings.length > 0; }).length;

  // สรุป
  const sum = document.getElementById('csv-summary');
  let html = '<div style="display:flex;gap:10px;flex-wrap:wrap">';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:var(--accent)">' + total + '</div><div class="hist-stat-lbl">แถวทั้งหมด</div></div>';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:var(--success)">' + okRows.length + '</div><div class="hist-stat-lbl">นำเข้าได้</div></div>';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:' + (badRows.length ? 'var(--danger)' : 'var(--text3)') + '">' + badRows.length + '</div><div class="hist-stat-lbl">มีข้อผิดพลาด</div></div>';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:var(--warning)">' + warnCount + '</div><div class="hist-stat-lbl">มีคำเตือน</div></div>';
  html += '</div>';

  html += '<div style="font-size:12px;color:var(--text2);margin-top:10px">ไฟล์: <b>' + esc(CSV_FILE_NAME) + '</b></div>';
  if (badRows.length > 0) {
    html += '<div class="notice danger" style="margin-top:12px"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/></svg>' +
      '<div>แถวที่มีข้อผิดพลาดจะถูก<b>ข้าม</b> ระบบจะนำเข้าเฉพาะ ' + okRows.length + ' แถวที่ถูกต้อง</div></div>';
  }
  sum.innerHTML = html;

  // รายการ error
  const errBox = document.getElementById('csv-errors');
  if (badRows.length === 0 && warnCount === 0) {
    errBox.innerHTML = '<div class="notice info" style="display:flex"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2.5"/></svg><div>ข้อมูลถูกต้องทุกแถว พร้อมนำเข้า</div></div>';
  } else {
    let e = '';
    if (badRows.length > 0) {
      e += '<div style="font-size:12px;font-weight:500;color:var(--danger);margin-bottom:6px">ข้อผิดพลาด (' + badRows.length + ' แถว)</div>';
      badRows.forEach(function (r) {
        e += '<div class="del-item" style="color:var(--danger)"><span style="flex-shrink:0">แถว ' + r.data.row + '</span><span>' + esc(r.errors.join(' / ')) + '</span></div>';
      });
    }
    if (warnCount > 0) {
      e += '<div style="font-size:12px;font-weight:500;color:var(--warning);margin:10px 0 6px">คำเตือน (' + warnCount + ' แถว) — นำเข้าได้</div>';
      okRows.filter(function (r) { return r.warnings.length > 0; }).forEach(function (r) {
        e += '<div class="del-item" style="color:var(--warning)"><span style="flex-shrink:0">แถว ' + r.data.row + '</span><span>' + esc(r.warnings.join(' / ')) + '</span></div>';
      });
    }
    errBox.innerHTML = e;
  }

  // ตารางตัวอย่าง
  const cols = ['แถว', 'สถานะ', 'หน่วย', 'ระดับ', 'วิชา', 'คำถาม', 'เฉลย', 'ความยาก'];
  let t = '<thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
  CSV_ROWS.forEach(function (r) {
    const d = r.data;
    const st = r.ok
      ? (r.warnings.length ? '<span class="tag tag-yellow">เตือน</span>' : '<span class="tag tag-green">ผ่าน</span>')
      : '<span class="tag tag-red">ผิดพลาด</span>';
    const q = d.question.length > 55 ? esc(d.question.slice(0, 55)) + '...' : esc(d.question);
    t += '<tr>' +
      '<td>' + d.row + '</td>' +
      '<td>' + st + '</td>' +
      '<td style="font-size:11px">' + esc(d.units.join(', ') || DASH) + '</td>' +
      '<td style="font-size:11px">' + esc(d.levels.join(', ') || DASH) + '</td>' +
      '<td style="font-size:12px">' + esc(d.subjectLabel || d.subject || DASH) + '</td>' +
      '<td style="font-size:12px">' + q + '</td>' +
      '<td>' + esc(d.answer || DASH) + '</td>' +
      '<td style="font-size:11px">' + esc(d.difficulty) + '</td>' +
      '</tr>';
  });
  t += '</tbody>';
  document.getElementById('csv-preview').innerHTML = t;

  // ปุ่มนำเข้า
  const btn = document.getElementById('csv-import-btn');
  btn.disabled = okRows.length === 0;
  btn.textContent = okRows.length === 0 ? 'ไม่มีแถวที่นำเข้าได้' : 'นำเข้า ' + okRows.length + ' แถว';
}

// เริ่มใหม่
function resetCsvImport() {
  CSV_ROWS = [];
  CSV_FILE_NAME = '';
  const f = document.getElementById('csv-file');
  if (f) f.value = '';
  document.getElementById('csv-review').style.display = 'none';
  document.getElementById('csv-done').style.display = 'none';
  setCsvStep(2);
  window.scrollTo(0, 0);
}
/* ============================================================
   ขั้นตอนที่ 4 — นำเข้าข้อมูลจริง
   ต่อ 1 แถว:
     1) หา/สร้าง subject ของแต่ละหน่วย+ระดับ → subject_id
     2) insert ลง questions
     3) insert ลง question_units (หน่วย × ระดับ)
   ============================================================ */

// แคช subject ที่มีอยู่ เพื่อไม่สร้างซ้ำในไฟล์เดียว

async function csvLoadSubjects() {
  // 1) โหลดทะเบียนวิชาหลักจาก subject_lookup
  let lookups = [];
  try {
    const { data, error } = await supa.from('subject_lookup').select('*').order('id');
    if (!error && data) lookups = data;
  } catch (e) {
    console.warn('โหลด subject_lookup ไม่สำเร็จ:', e);
  }

  // 2) โหลดข้อมูล subjects ที่บันทึกการจัดลงหน่วยงาน+ระดับ
  let subjects = [];
  try {
    const { data, error } = await supa.from('subjects').select('*');
    if (!error && data) subjects = data;
  } catch (e) {
    console.warn('โหลด subjects ไม่สำเร็จ:', e);
  }

  CSV_LOOKUP_BY_ID = {};
  CSV_LOOKUP_BY_NAME = {};
  CSV_SUBJ_CACHE = {};
  CSV_SUBJ_BY_NAME = {};

  lookups.forEach(function (l) {
    CSV_LOOKUP_BY_ID[l.id] = l;
    CSV_LOOKUP_BY_ID[String(l.id)] = l;
    if (l.name) {
      CSV_LOOKUP_BY_NAME[l.name.trim().toLowerCase()] = l;
    }
  });

  subjects.forEach(function (s) {
    if (s.name) {
      const lower = s.name.trim().toLowerCase();
      if (!CSV_LOOKUP_BY_NAME[lower]) {
        CSV_LOOKUP_BY_NAME[lower] = { id: s.id, name: s.name };
      }
      if (!CSV_SUBJ_BY_NAME[lower]) CSV_SUBJ_BY_NAME[lower] = [];
      CSV_SUBJ_BY_NAME[lower].push(s);
    }
    // แคช key = unit_id|level|name → subjects.id
    CSV_SUBJ_CACHE[s.unit_id + '|' + s.level + '|' + s.name] = s.id;
    if (s.level === 'both') {
      CSV_SUBJ_CACHE[s.unit_id + '|p|' + s.name] = s.id;
      CSV_SUBJ_CACHE[s.unit_id + '|s|' + s.name] = s.id;
    }
  });

  return { lookups: lookups, subjects: subjects };
}

// หา/สร้าง subject ในตาราง subjects (ที่เก็บว่าวิชาจาก subject_lookup ไปลงที่หน่วยไหน ระดับไหน)
async function csvEnsureSubject(unitId, level, name) {
  const parsedUnitId = isNaN(Number(unitId)) ? unitId : Number(unitId);
  const keyExact = parsedUnitId + '|' + level + '|' + name;
  const keyBoth = parsedUnitId + '|both|' + name;

  if (CSV_SUBJ_CACHE[keyExact]) return { id: CSV_SUBJ_CACHE[keyExact], created: false };
  if (CSV_SUBJ_CACHE[keyBoth]) return { id: CSV_SUBJ_CACHE[keyBoth], created: false };

  // ตรวจสอบใน Supabase อีกครั้ง
  const lv = level === 'p' ? ['p', 'both'] : level === 's' ? ['s', 'both'] : ['p', 's', 'both'];
  const { data: existing } = await supa.from('subjects')
    .select('id, level')
    .eq('unit_id', parsedUnitId)
    .eq('name', name)
    .in('level', lv)
    .limit(1);

  if (existing && existing.length > 0) {
    CSV_SUBJ_CACHE[keyExact] = existing[0].id;
    return { id: existing[0].id, created: false };
  }

  // ตรวจสอบและบันทึกเข้าทะเบียน subject_lookup ถ้ายังไม่มี
  try {
    const lower = name.trim().toLowerCase();
    if (!CSV_LOOKUP_BY_NAME[lower]) {
      const insL = await supa.from('subject_lookup').insert({ name: name, active: true, sort_order: 0 }).select().single();
      if (insL.data) {
        CSV_LOOKUP_BY_ID[insL.data.id] = insL.data;
        CSV_LOOKUP_BY_NAME[lower] = insL.data;
      }
    }
  } catch (e) {
    console.warn('บันทึกทะเบียน subject_lookup ไม่สำเร็จ:', e);
  }

  // ถ้ายังไม่มีใน subjects ให้สร้างใหม่สำหรับหน่วยและระดับนี้
  const res = await supa.from('subjects')
    .insert({ name: name, unit_id: parsedUnitId, level: level, ratio: 0 })
    .select().single();
  if (res.error) throw new Error('สร้างวิชา "' + name + '" ให้หน่วยนี้ไม่สำเร็จ: ' + res.error.message);

  CSV_SUBJ_CACHE[keyExact] = res.data.id;
  return { id: res.data.id, created: true };
}

async function runCsvImport() {
  const okRows = CSV_ROWS.filter(function (r) { return r.ok; });
  if (okRows.length === 0) { showToast('ไม่มีแถวที่นำเข้าได้', 'danger'); return; }

  const btn = document.getElementById('csv-import-btn');
  btn.disabled = true;
  btn.textContent = 'กำลังนำเข้า...';

  setCsvStep(4);

  const result = { ok: 0, failed: 0, subjectsCreated: 0, errors: [] };

  try {
    await csvLoadSubjects();
    let units = [];
    try {
      const uRes = await supa.from('units').select('*');
      if (!uRes.error && uRes.data && uRes.data.length > 0) units = uRes.data;
    } catch (e) {}
    if (units.length === 0 && typeof loadUnits === 'function') {
      units = await loadUnits();
    }

    const unitMap = {};
    const legacyNumToCode = { '1': 'tm', '2': 'ss', '3': 'jr', '4': 'pp', '5': 'ak', '6': 'nr', '7': 'test' };

    units.forEach(function (u) {
      if (typeof u.id === 'number' || /^\d+$/.test(String(u.id))) {
        const numId = Number(u.id);
        unitMap[String(numId)] = numId;
        if (u.code) unitMap[String(u.code).toLowerCase()] = numId;
        if (u.short_name) unitMap[String(u.short_name).toLowerCase()] = numId;
        if (u.name) unitMap[String(u.name).toLowerCase()] = numId;
      } else {
        const code = String(u.id).toLowerCase();
        for (const [k, v] of Object.entries(legacyNumToCode)) {
          if (v === code) unitMap[k] = code;
        }
        unitMap[code] = code;
        if (u.short_name) unitMap[String(u.short_name).toLowerCase()] = code;
        if (u.name) unitMap[String(u.name).toLowerCase()] = code;
      }
    });

    for (let i = 0; i < okRows.length; i++) {
      const d = okRows[i].data;
      btn.textContent = 'กำลังนำเข้า ' + (i + 1) + '/' + okRows.length + '...';

      try {
        // ตรวจสอบและแปลงหน่วยงานเป็น ID ตัวเลข
        const resolvedUnits = [];
        for (const u of d.units) {
          const matched = unitMap[String(u).toLowerCase()];
          if (!matched) throw new Error('ไม่พบหน่วยงาน ID "' + u + '" ในระบบ (กรุณาดูที่ไฟล์ รายชื่อหน่วยและวิชา-อิงID.csv)');
          if (resolvedUnits.indexOf(matched) === -1) resolvedUnits.push(matched);
        }

        // 1) สร้าง/หา subject ของแต่ละหน่วย × ระดับ ในตาราง subjects
        // (subject_lookup คือทะเบียนวิชา ส่วน subjects คือที่เก็บว่าวิชาจาก subject_lookup ไปลงที่หน่วยไหน ระดับไหน)
        const pairs = [];
        for (const u of resolvedUnits) {
          for (const lv of d.levels) {
            const key = u + '|' + lv;
            if (pairs.some(function (p) { return p.key === key; })) continue;

            const s = await csvEnsureSubject(u, lv, d.subject);
            if (s.created) result.subjectsCreated++;
            pairs.push({ key: key, unit: u, level: lv, subject_id: s.id });
          }
        }

        // 2) insert ข้อสอบ (subject_id ใน questions ชี้ไปที่ subjects.id)
        const primarySubjectId = pairs[0].subject_id;

        const qRes = await supa.from('questions').insert({
          question: d.question,
          choice_a: d.choice_a, choice_b: d.choice_b, choice_c: d.choice_c, choice_d: d.choice_d,
          choice_a_image: d.choice_a_image, choice_b_image: d.choice_b_image,
          choice_c_image: d.choice_c_image, choice_d_image: d.choice_d_image,
          question_image: d.question_image,
          explanation: d.explanation || null,
          answer: d.answer,
          difficulty: d.difficulty || 'medium',
          source: d.source || null,
          published: d.published,
          subject_id: primarySubjectId
        }).select().single();


        if (qRes.error) throw new Error(qRes.error.message);

        // 3) ผูกกับทุกหน่วย × ทุกระดับ (unit_id เป็นตัวเลข)
        const linkRows = pairs.map(function (p) {
          const targetUnit = typeof p.unit === 'number' ? p.unit : (isNaN(Number(p.unit)) ? p.unit : Number(p.unit));
          return { question_id: qRes.data.id, unit_id: targetUnit, level: p.level };
        });
        const lRes = await supa.from('question_units').insert(linkRows);
        if (lRes.error) {
          // ย้อนลบข้อสอบที่เพิ่งสร้าง เพื่อไม่ให้เหลือข้อมูลค้าง
          await supa.from('questions').delete().eq('id', qRes.data.id);
          throw new Error('ผูกหน่วยงานไม่สำเร็จ: ' + lRes.error.message);
        }

        result.ok++;
      } catch (rowErr) {
        result.failed++;
        result.errors.push({ row: d.row, msg: rowErr.message });
      }
    }
  } catch (e) {
    result.errors.push({ row: 0, msg: e.message });
  }

  renderCsvResult(result);
}

function renderCsvResult(result) {
  const box = document.getElementById('csv-result');
  const btn = document.getElementById('csv-import-btn');
  btn.textContent = 'นำเข้าข้อมูล';
  btn.disabled = false;

  let html = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:var(--success)">' + result.ok + '</div><div class="hist-stat-lbl">นำเข้าสำเร็จ</div></div>';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:' + (result.failed ? 'var(--danger)' : 'var(--text3)') + '">' + result.failed + '</div><div class="hist-stat-lbl">ล้มเหลว</div></div>';
  html += '<div class="hist-stat" style="flex:1;min-width:110px"><div class="hist-stat-val" style="color:var(--accent)">' + result.subjectsCreated + '</div><div class="hist-stat-lbl">วิชาที่สร้างใหม่</div></div>';
  html += '</div>';

  if (result.ok > 0 && result.failed === 0) {
    html += '<div class="notice info" style="display:flex"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2.5"/></svg><div>นำเข้าข้อสอบสำเร็จทั้งหมด ' + result.ok + ' ข้อ</div></div>';
  }
  if (result.errors.length > 0) {
    html += '<div style="font-size:12px;font-weight:500;color:var(--danger);margin-bottom:6px">แถวที่ล้มเหลว</div>';
    result.errors.forEach(function (e) {
      html += '<div class="del-item" style="color:var(--danger)"><span style="flex-shrink:0">' + (e.row ? 'แถว ' + e.row : 'ทั้งไฟล์') + '</span><span>' + esc(e.msg) + '</span></div>';
    });
  }

  box.innerHTML = html;
  document.getElementById('csv-review').style.display = 'none';
  document.getElementById('csv-done').style.display = 'block';
  showToast('นำเข้าสำเร็จ ' + result.ok + ' ข้อ', result.failed ? 'danger' : 'success');

  // อัปเดตแคชข้อสอบในหน้า admin
  if (typeof initQuestions === 'function') initQuestions();
}

/* ============================================================
   drag & drop สำหรับ zone อัปโหลด
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  const zone = document.getElementById('csv-zone');
  if (!zone) return;

  ['dragenter', 'dragover'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = 'var(--accent)';
      zone.style.color = 'var(--accent)';
      zone.style.background = 'var(--accent-bg)';
    });
  });

  ['dragleave', 'drop'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '';
      zone.style.color = '';
      zone.style.background = '';
    });
  });

  zone.addEventListener('drop', function (e) {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readCsvFile(f);
  });
});
