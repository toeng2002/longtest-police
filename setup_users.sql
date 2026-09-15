-- ตาราง users สำหรับระบบ login
create table if not exists users (
  id serial primary key,
  username text unique not null,
  password text not null,
  role text not null default 'user', -- 'user' | 'admin' | 'both'
  display_name text,
  created_at timestamptz default now()
);

-- เพิ่ม user ตัวอย่าง (password ควรเปลี่ยนก่อนใช้จริง)
insert into users (username, password, role, display_name) values
  ('admin',   '123456', 'admin', 'ผู้ดูแลระบบ'),
  ('user001', '123456', 'user',  'ผู้ใช้ทั่วไป')
on conflict (username) do nothing;
-- ============================================================
-- แก้ปัญหา: เดิมตาราง users เก็บรหัสผ่านเป็นข้อความธรรมดา (plaintext)
-- ซึ่งใครมี publishable key ก็อ่านได้ → ต้องเปลี่ยนเป็น bcrypt hash
-- ============================================================

-- 1) เปิดส่วนขยาย pgcrypto (มีอยู่แล้วบน Supabase)
create extension if not exists pgcrypto with schema extensions;

-- 2) เพิ่มคอลัมน์เก็บ hash
alter table users add column if not exists password_hash text;

-- 3) ย้ายรหัสเดิมไป hash แบบ bcrypt
update users
set password_hash = extensions.crypt(password, extensions.gen_salt('bf', 10))
where password_hash is null;

-- 4) ตรวจผลลัพธ์ก่อนลบคอลัมน์เดิม (ควรได้ 2 แถว และ hash ขึ้นต้นด้วย $2)
--    select id, username, role,
--           password_hash,
--           (password_hash = extensions.crypt('123456', password_hash)) as matches_123456
--    from users;

-- 5) ลบคอลัมน์ plaintext เมื่อตรวจแล้วว่า hash ถูกต้อง
--    *** ทำขั้นนี้เป็นขั้นสุดท้ายหลังยืนยันข้อ 4 แล้วเท่านั้น ***
-- alter table users drop column password;

-- 6) เปลี่ยนชื่อคอลัมน์ hash ให้เป็นชื่อที่แอปใช้ (หลังลบของเดิมแล้ว)
-- alter table users rename column password_hash to password;

-- ============================================================
-- ทางลัด: ถ้าต้องการตั้งรหัสผ่านใหม่ให้ user คนใดคนหนึ่งแบบ hash เลย
--   update users
--   set password = extensions.crypt('รหัสใหม่ของคุณ', extensions.gen_salt('bf', 10))
--   where username = 'admin';
-- ============================================================
