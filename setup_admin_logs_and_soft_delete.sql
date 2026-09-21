-- ============================================================
-- setup_admin_logs_and_soft_delete.sql
-- 1) ตาราง admin_logs บันทึกกิจกรรมของ Admin (เพิ่ม, ลบ, แก้ไข, นำเข้า)
-- 2) เพิ่มคอลัมน์ removed_by ในตารางหลักเพื่อทำ Soft Delete
-- ============================================================

-- ------------------------------------------------------------
-- 1. เพิ่มคอลัมน์ removed_by (ค่าเริ่มต้นเป็น 0) สำหรับ Soft Delete
-- ------------------------------------------------------------
alter table questions add column if not exists removed_by integer not null default 0;
alter table units add column if not exists removed_by integer not null default 0;
alter table subjects add column if not exists removed_by integer not null default 0;
alter table difficulty_levels add column if not exists removed_by integer not null default 0;
alter table users add column if not exists removed_by integer not null default 0;

-- อัปเดตข้อมูลที่มีอยู่เดิมให้มีค่า removed_by = 0 แน่นอน
update questions set removed_by = 0 where removed_by is null;
update units set removed_by = 0 where removed_by is null;
update subjects set removed_by = 0 where removed_by is null;
update difficulty_levels set removed_by = 0 where removed_by is null;
update users set removed_by = 0 where removed_by is null;

-- สร้าง Index เพื่อความรวดเร็วในการ Query คัดกรองข้อมูลที่ยังไม่ถูกลบ
create index if not exists idx_questions_removed_by on questions(removed_by);
create index if not exists idx_units_removed_by on units(removed_by);
create index if not exists idx_subjects_removed_by on subjects(removed_by);
create index if not exists idx_users_removed_by on users(removed_by);

-- ------------------------------------------------------------
-- 2. สร้างตาราง admin_logs สำหรับบันทึกประวัติการทำงานของผู้ดูแลระบบ
-- ------------------------------------------------------------
create table if not exists admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id int references users(id) on delete set null,
  admin_username text,
  action text not null,          -- 'create', 'update', 'delete', 'import', 'toggle_publish', 'toggle_active'
  target_table text not null,    -- 'questions', 'units', 'subjects', 'difficulty_levels', 'users'
  target_id text,                -- ID ของแถวข้อมูลเป้าหมาย
  details text,                  -- รายละเอียด เช่น หัวข้อข้อสอบ, ชื่อวิชา, หรือข้อความอธิบาย
  ip_address text,               -- IP address ของ Admin ขณะทำรายการ
  created_at timestamptz default now()
);

-- Index สำหรับค้นหา Log ตามเวลา, ผู้ทำ, หรือตารางเป้าหมาย
create index if not exists idx_admin_logs_created_at on admin_logs(created_at desc);
create index if not exists idx_admin_logs_admin_id on admin_logs(admin_id);
create index if not exists idx_admin_logs_target on admin_logs(target_table, target_id);

-- ------------------------------------------------------------
-- 3. กำหนดสิทธิ์ความปลอดภัย (Row Level Security - RLS)
-- ------------------------------------------------------------
alter table admin_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'admin_logs' and policyname = 'Allow read admin_logs'
  ) then
    create policy "Allow read admin_logs" on admin_logs for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'admin_logs' and policyname = 'Allow insert admin_logs'
  ) then
    create policy "Allow insert admin_logs" on admin_logs for insert with check (true);
  end if;
end $$;

