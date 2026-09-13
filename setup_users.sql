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
