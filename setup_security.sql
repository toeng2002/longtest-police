-- ============================================================
-- setup_security.sql — ระบบความปลอดภัยและการจำกัดการเข้าสู่ระบบ
-- รันไฟล์นี้ใน Supabase SQL Editor
-- ============================================================

-- 1) เพิ่มคอลัมน์ในตาราง users สำหรับตรวจสอบ Session และ IP ล่าสุด
alter table users 
  add column if not exists current_session_token text,
  add column if not exists last_login_ip text,
  add column if not exists last_active_at timestamptz default now();

-- 2) สร้าง Index เพื่อการค้นหาและเปรียบเทียบ session token ที่รวดเร็ว
create index if not exists idx_users_session_token on users(current_session_token);

-- 3) เปิดใช้งาน Supabase Realtime สำหรับตาราง users
-- เพื่อให้เครื่องเก่าตรวจจับการล็อกอินซ้อนจากเครื่องอื่นได้ทันที (Instant Kick)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'users'
  ) then
    alter publication supabase_realtime add table users;
  end if;
end $$;

-- 4) อัปเดตนโยบายสิทธิ์ (RLS) เพื่อให้อัปเดต session ได้ราบรื่น
do $$
begin
  if exists (
    select 1 from pg_tables 
    where schemaname = 'public' and tablename = 'users' and rowsecurity = true
  ) then
    drop policy if exists "Allow update users session" on users;
    create policy "Allow update users session" on users for update using (true) with check (true);
  end if;
end $$;
