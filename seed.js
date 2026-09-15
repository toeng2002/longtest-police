/* ============================================================
   seed.js — ใส่ข้อมูลเริ่มต้น (หน่วยงาน + วิชา) ลง Supabase
   ใช้:  node seed.js

   ต้องมีข้อมูล 2 ตารางนี้ก่อน ถึงจะเพิ่มข้อสอบได้:
     units    → หน่วยงาน (ตม. สส. จร. ปป. อก. พยาบาล)
     subjects → วิชาในแต่ละหน่วย + ระดับชั้น + สัดส่วนคะแนน
   ============================================================ */

const U = 'https://dbkhyhtnhwwqhibbsgce.supabase.co';
const K = 'sb_publishable_SG2sdbQteFee7G4L60WOew_o5CrLoVe';

const HEAD = {
  apikey: K,
  Authorization: 'Bearer ' + K,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
};

// ---- หน่วยงาน ----------------
// คอลัมน์จริงของตาราง units: id, name, icon, short_name
// (ยืนยันจาก error ของ Postgres แล้ว — ไม่มีคอลัมน์ 'short')
const UNITS = [
  { id: 'tm', name: 'ตรวจคนเข้าเมือง',    short_name: 'ตม.',   icon: '✈️' },
  { id: 'ss', name: 'สายสอบสวน',          short_name: 'ส.',   icon: '🔍' },
  { id: 'jr', name: 'สายจราจร',            short_name: 'จร.',   icon: '🚦' },
  { id: 'pp', name: 'สายป้องกันปราบปราม', short_name: 'ป.',   icon: '🛡️' },
  { id: 'ak', name: 'สายอำนวยการ',         short_name: 'อก.',   icon: '🏢' },
  { id: 'nr', name: 'สายพยาบาล',           short_name: 'พยาบาล', icon: '⚕️' }
];

// ---- วิชา --------------
// คอลัมน์จริงของตาราง subjects: id, unit_id, name, level, ratio
// (ไม่มีคอลัมน์ 'icon' — ยืนยันจาก error ของ Postgres แล้ว)
// level: 'p' = ชั้นประทวน, 's' = ชั้นสัญญาบัตร, 'both' = ทั้งสอง
const SUBJECTS = [
  // ตม. — ชั้นประทวน
  { unit_id: 'tm', level: 'p', name: 'กฎหมาย ตม.',   ratio: 40 },
  { unit_id: 'tm', level: 'p', name: 'ภาษาไทย',       ratio: 30 },
  { unit_id: 'tm', level: 'p', name: 'ความรู้ทั่วไป', ratio: 30 },
  // ตม. — ชั้นสัญญาบัตร
  { unit_id: 'tm', level: 's', name: 'กฎหมาย ตม.',   ratio: 35 },
  { unit_id: 'tm', level: 's', name: 'ภาษาอังกฤษ',    ratio: 25 },
  { unit_id: 'tm', level: 's', name: 'กฎหมายอาญา',   ratio: 25 },
  { unit_id: 'tm', level: 's', name: 'ความรู้ทั่วไป', ratio: 15 }
];

async function req(method, path, body) {
  const r = await fetch(U + '/rest/v1/' + path, {
    method,
    headers: HEAD,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function count(table) {
  const r = await fetch(U + '/rest/v1/' + table + '?select=id', {
    headers: { apikey: K, Authorization: 'Bearer ' + K, Prefer: 'count=exact' }
  });
  if (!r.ok) return '?';
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : '?';
}

(async () => {
  console.log('=== ตรวจสอบตาราง ===');
  console.log('units    ก่อน: ' + await count('units') + ' แถว');
  console.log('subjects ก่อน: ' + await count('subjects') + ' แถว');

  // ---------- 1) หน่วยงาน ----------
  console.log('\n=== ใส่หน่วยงาน ===');
  let r = await req('POST', 'units?on_conflict=id', UNITS);
  if (!r.ok) {
    console.log('  ล้มเหลว HTTP ' + r.status);
    console.log('  ' + JSON.stringify(r.data).slice(0, 500));
    console.log('\n หมายเหตุ: on_conflict=id ต้องมี UNIQUE/PK ที่คอลัมน์ id');
  } else {
    console.log('  สำเร็จ ' + (Array.isArray(r.data) ? r.data.length : '') + ' หน่วย');
  }

  // ---------- 2) วิชา ----------
  console.log('\n=== ใส่วิชา ===');
  let subjRows = SUBJECTS;
  r = await req('POST', 'subjects', subjRows);
  if (!r.ok) {
    console.log('  ล้มเหลว HTTP ' + r.status);
    console.log('  ' + JSON.stringify(r.data).slice(0, 800));
  } else {
    console.log('  สำเร็จ ' + (Array.isArray(r.data) ? r.data.length : '') + ' วิชา');
  }

  // ---------- 3) ตรวจผล ----------
  console.log('\n=== ตรวจสอบตาราง ===');
  console.log('units    หลัง: ' + await count('units') + ' แถว');
  console.log('subjects หลัง: ' + await count('subjects') + ' แถว');
})();
