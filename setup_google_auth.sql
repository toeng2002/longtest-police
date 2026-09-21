-- ============================================================
-- setup_google_auth.sql — เตรียมตาราง users สำหรับรองรับ Google OAuth
-- รันไฟล์นี้ใน Supabase SQL Editor (ครั้งเดียว)
-- ============================================================

-- 1) เพิ่มคอลัมน์ auth_id (UUID ของ Supabase Auth) หากยังไม่มี
alter table public.users 
  add column if not exists auth_id uuid unique,
  add column if not exists avatar_url text;

-- 2) ปรับให้คอลัมน์ password อนุญาตให้เป็น null ได้ (เพราะผู้ใช้ที่ล็อกอินผ่าน Google ไม่มีรหัสผ่าน)
alter table public.users 
  alter column password drop not null;

-- 3) สร้าง Index สำหรับค้นหาด้วย email และ auth_id ให้เร็วขึ้น
create index if not exists idx_users_email on public.users(email);
create index if not exists idx_users_auth_id on public.users(auth_id);

-- 4) กำหนดสิทธิ์ RLS สำหรับตาราง public.users (เปิดให้ค้นหาและเพิ่มผู้ใช้ใหม่ที่มาจาก Google ได้)
-- ตรวจสอบว่าเปิด RLS หรือยัง
alter table public.users enable row level security;

-- นโยบายให้อ่านข้อมูล users สำหรับการตรวจสอบสิทธิ์
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'users' and policyname = 'Allow read users for auth'
  ) then
    create policy "Allow read users for auth" on public.users
      for select using (true);
  end if;
end $$;

-- นโยบายให้อนุญาตเพิ่มผู้ใช้ใหม่ (สำหรับการลงทะเบียนผ่าน Google OAuth ครั้งแรก)
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'users' and policyname = 'Allow insert new user via auth'
  ) then
    create policy "Allow insert new user via auth" on public.users
      for insert with check (true);
  end if;
end $$;

-- นโยบายให้อนุญาตอัปเดตข้อมูลผู้ใช้ (เช่น อัปเดต auth_id, avatar_url, session_token)
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'users' and policyname = 'Allow update user via auth'
  ) then
    create policy "Allow update user via auth" on public.users
      for update using (true);
  end if;
end $$;
