-- ============================================================
-- setup_superadmin.sql
-- สร้างหรืออัปเดตผู้ดูแลระบบระดับสูงสุด (Superadmin)
-- Username: toeng2002
-- Password: vpjkglnvd@Aa1 (เก็บเป็น bcrypt hash อย่างปลอดภัย)
-- ============================================================

-- 1. ตรวจสอบและเปิดส่วนขยาย pgcrypto สำหรับการทำ bcrypt hash
create extension if not exists pgcrypto with schema extensions;

-- 2. สร้างหรืออัปเดตข้อมูลผู้ใช้ toeng2002 ให้เป็น superadmin
insert into users (
  username,
  password,
  role,
  display_name,
  plan,
  status,
  removed_by
)
values (
  'toeng2002',
  extensions.crypt('vpjkglnvd@Aa1', extensions.gen_salt('bf', 10)),
  'superadmin',
  'Super Admin (toeng2002)',
  'vip',
  'active',
  0
)
on conflict (username) do update set
  password = extensions.crypt('vpjkglnvd@Aa1', extensions.gen_salt('bf', 10)),
  role = 'superadmin',
  display_name = 'Super Admin (toeng2002)',
  plan = 'vip',
  status = 'active',
  removed_by = 0;

-- 3. ตรวจสอบผลลัพธ์
select id, username, role, display_name, plan, status, removed_by,
       (password = extensions.crypt('vpjkglnvd@Aa1', password)) as password_matches
from users
where username = 'toeng2002';
