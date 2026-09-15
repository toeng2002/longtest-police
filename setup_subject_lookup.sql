-- ============================================================
-- ตาราง lookup วิชา (master list) — สำหรับทำ dropdown ในฟอร์มเพิ่มข้อสอบ
--
-- หลักการ:
--   subject_lookup = ทะเบียนรายชื่อวิชา ใช้ "เรียก dropdown" เท่านั้น
--   subjects       = ตารางที่เก็บข้อมูลจริง (ผูกกับหน่วย+ระดับ+สัดส่วน)
--   questions      = ตอนบันทึกข้อสอบ จะเก็บ subject_id ที่ชี้ไปที่ subjects
--
-- วิธีใช้: คัดลอกไปวางใน Supabase → SQL Editor → Run
-- ============================================================

-- ---------- 1) สร้างตาราง lookup ----------
create table if not exists subject_lookup (
  id         serial primary key,
  name       text unique not null,     -- ชื่อวิชา (ไม่ซ้ำ)
  short_name text,                     -- ชื่อย่อ (ไม่บังคับ)
  icon       text,                     -- emoji (ไม่บังคับ)
  category   text,                     -- หมวด เช่น กฎหมาย / ภาษา / ทั่วไป
  active     boolean default true,     -- ปิดการใช้งานโดยไม่ต้องลบ
  sort_order int default 0,
  created_at timestamptz default now()
);

-- ---------- 2) ย้ายชื่อวิชาที่มีอยู่แล้วใน subjects เข้า lookup ----------
-- ใช้ชื่อไม่ซ้ำ (distinct) กันข้อมูลซ้ำ
insert into subject_lookup (name, sort_order)
select distinct s.name, 0
from subjects s
where s.name is not null
on conflict (name) do nothing;

-- ---------- 3) สิทธิ์การเข้าถึง ----------
alter table subject_lookup enable row level security;

drop policy if exists "subject_lookup_all" on subject_lookup;
create policy "subject_lookup_all" on subject_lookup
  for all using (true) with check (true);

-- ---------- 4) ตรวจผล ----------
-- select * from subject_lookup order by sort_order, name;

-- ============================================================
-- หมายเหตุ: ถ้าต้องการให้ dropdown ของแต่ละหน่วยแสดงคนละชุด
-- ให้เพิ่มคอลัมน์ unit_id แล้วกรองตามหน่วย:
--   alter table subject_lookup add column unit_id text;
-- ============================================================
