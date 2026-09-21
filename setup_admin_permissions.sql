-- ============================================================
-- setup_admin_permissions.sql
-- เพิ่มคอลัมน์ permissions ในตาราง users เพื่อรองรับการควบคุมสิทธิ์เมนูรายคนโดย Superadmin
-- ============================================================

-- 1. เพิ่มคอลัมน์ permissions (JSONB) ค่าเริ่มต้นมีสิทธิ์ครบทุกเมนู
alter table users 
add column if not exists permissions jsonb 
default '["dashboard","questions","add_question","import_csv","settings","manage_users","test_exam"]'::jsonb;

-- 2. อัปเดตข้อมูลผู้ใช้งานระดับ admin และ superadmin เดิมให้ได้รับสิทธิ์เริ่มต้นครบถ้วน
update users
set permissions = '["dashboard","questions","add_question","import_csv","settings","manage_users","test_exam"]'::jsonb
where permissions is null and (role = 'admin' or role = 'superadmin' or role = 'both');

-- 3. ตรวจสอบผลลัพธ์
select id, username, role, display_name, permissions
from users
order by id;

