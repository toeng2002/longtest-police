-- ============================================================
-- migration_units_active.sql
-- คำสั่งเพิ่มคอลัมน์ active ในตาราง units สำหรับเปิด/ปิดการเข้าใช้งานหน่วยงาน
--
-- วิธีใช้: คัดลอกทั้งหมดไปวางใน Supabase Dashboard → SQL Editor → กด Run
-- ============================================================

-- 1) เพิ่มคอลัมน์ active ในตาราง units (ค่าเริ่มต้นเป็น true = เปิดใช้งาน)
ALTER TABLE units ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

-- 2) อัปเดตข้อมูลหน่วยงานเดิมทั้งหมดให้ active = true
UPDATE units SET active = true WHERE active IS NULL;

-- 3) ตรวจสอบและตั้งสิทธิ์ RLS สำหรับตาราง units ให้รองรับการอัปเดตสถานะ
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "units_all" ON units;
CREATE POLICY "units_all" ON units FOR ALL USING (true) WITH CHECK (true);
