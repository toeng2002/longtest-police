-- ============================================================
-- ตั้งค่าฐานข้อมูลสำหรับเมนู "ตั้งค่า" ของหน้าผู้ดูแลระบบ
-- วิธีใช้: คัดลอกทั้งหมดไปวางใน Supabase → SQL Editor → Run
-- ============================================================

-- ---------- 1) ตารางระดับความยาก ----------
-- เพื่อให้แอดมินเพิ่ม/แก้ระดับความยากได้เอง
create table if not exists difficulty_levels (
  id         serial primary key,
  code       text unique not null,   -- เก็บลงคอลัมน์ questions.difficulty (เช่น easy)
  name       text not null,          -- ชื่อที่แสดง (เช่น ง่าย)
  color      text default 'gray',    -- gray | green | yellow | red | blue | purple
  sort_order int  default 0,         -- ลำดับการแสดง
  created_at timestamptz default now()
);

-- ใส่ระดับเริ่มต้น (ตรงกับที่โค้ดใช้อยู่: easy / medium / hard)
insert into difficulty_levels (code, name, color, sort_order) values
  ('easy',   'ง่าย',      'green',  1),
  ('medium', 'ปานกลาง',   'yellow', 2),
  ('hard',   'ยาก',       'red',    3)
on conflict (code) do nothing;

-- ---------- 2) สิทธิ์การเข้าถึง (RLS) ----------
-- เปิด RLS แล้วให้ anon key อ่าน/เขียนได้ (เหมาะกับช่วงพัฒนา)
-- ถ้าใช้งานจริงควรจำกัดสิทธิ์ให้แคบกว่านี้
alter table difficulty_levels enable row level security;

drop policy if exists "difficulty_levels_all" on difficulty_levels;
create policy "difficulty_levels_all" on difficulty_levels
  for all using (true) with check (true);

-- ทำแบบเดียวกันกับตารางอื่นที่เมนูตั้งค่าต้องใช้
alter table units    enable row level security;
alter table subjects enable row level security;
alter table users    enable row level security;

drop policy if exists "units_all"    on units;
drop policy if exists "subjects_all" on subjects;
drop policy if exists "users_all"    on users;

create policy "units_all"    on units    for all using (true) with check (true);
create policy "subjects_all" on subjects for all using (true) with check (true);
create policy "users_all"    on users    for all using (true) with check (true);

-- ============================================================
-- 3) แนะนำเพิ่มเติม: hash รหัสผ่านผู้ใช้
--    ตอนนี้ตาราง users เก็บรหัสผ่านเป็นข้อความธรรมดา (plaintext)
--    ใครมี key ก็อ่านได้ → ควรเปลี่ยนเป็น bcrypt hash
--    (รายละเอียดอยู่ใน setup_users.sql)
-- ============================================================
