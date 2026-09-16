-- ============================================================
-- migration_unit_id_to_int.sql
-- คำสั่งปรับปรุงโครงสร้างฐานข้อมูล Supabase:
-- 1. เปลี่ยน units.id จาก text ('tm', 'ss'...) เป็น integer (SERIAL Primary Key: 1, 2, 3...)
-- 2. เพิ่มคอลัมน์ id SERIAL PRIMARY KEY ให้กับตาราง question_units
-- 3. ปรับปรุง unit_id ในตาราง subjects, question_units, exam_history ให้เป็น integer
--
-- วิธีใช้: คัดลอกทั้งหมดไปวางใน Supabase Dashboard → SQL Editor → กด Run
-- ============================================================

BEGIN;

-- ---------- ขั้นที่ 1: ปลด Foreign Key เดิม (ถ้ามี) ----------
ALTER TABLE IF EXISTS subjects DROP CONSTRAINT IF EXISTS subjects_unit_id_fkey;
ALTER TABLE IF EXISTS question_units DROP CONSTRAINT IF EXISTS question_units_unit_id_fkey;
ALTER TABLE IF EXISTS exam_history DROP CONSTRAINT IF EXISTS exam_history_unit_id_fkey;

-- ---------- ขั้นที่ 2: ปรับปรุงตาราง units ----------
-- เพิ่มคอลัมน์ code ไว้เก็บตัวย่อ/รหัสเดิม ('tm', 'ss', 'jr', 'pp', 'ak', 'nr', 'test')
ALTER TABLE units ADD COLUMN IF NOT EXISTS code text;
UPDATE units SET code = id WHERE code IS NULL;
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_code_key;
ALTER TABLE units ADD CONSTRAINT units_code_key UNIQUE (code);

-- เพิ่มคอลัมน์ new_id สำหรับกำหนดเลข ID ใหม่ให้เรียงลำดับชัดเจน
ALTER TABLE units ADD COLUMN IF NOT EXISTS new_id integer;

UPDATE units SET new_id = 1 WHERE code = 'tm';
UPDATE units SET new_id = 2 WHERE code = 'ss';
UPDATE units SET new_id = 3 WHERE code = 'jr';
UPDATE units SET new_id = 4 WHERE code = 'pp';
UPDATE units SET new_id = 5 WHERE code = 'ak';
UPDATE units SET new_id = 6 WHERE code = 'nr';
UPDATE units SET new_id = 7 WHERE code = 'test';

-- สำหรับหน่วยอื่น ๆ ที่อาจมีเพิ่ม ให้รันหมายเลขต่อจาก 8 เป็นต้นไป
WITH numbered AS (
  SELECT code, ROW_NUMBER() OVER (ORDER BY code) + 7 AS num
  FROM units
  WHERE new_id IS NULL
)
UPDATE units u
SET new_id = n.num
FROM numbered n
WHERE u.code = n.code AND u.new_id IS NULL;

-- ---------- ขั้นที่ 3: ปรับปรุงตาราง subjects ----------
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS new_unit_id integer;
UPDATE subjects s
SET new_unit_id = u.new_id
FROM units u
WHERE s.unit_id = u.code;

-- ---------- ขั้นที่ 4: ปรับปรุงตาราง question_units ----------
ALTER TABLE question_units ADD COLUMN IF NOT EXISTS new_unit_id integer;
UPDATE question_units qu
SET new_unit_id = u.new_id
FROM units u
WHERE qu.unit_id = u.code;

-- เพิ่มคอลัมน์ id SERIAL PRIMARY KEY ให้ question_units
ALTER TABLE question_units DROP CONSTRAINT IF EXISTS question_units_pkey;
ALTER TABLE question_units ADD COLUMN IF NOT EXISTS id serial;
ALTER TABLE question_units ADD PRIMARY KEY (id);

-- ---------- ขั้นที่ 5: ปรับปรุงตาราง exam_history ----------
ALTER TABLE exam_history ADD COLUMN IF NOT EXISTS new_unit_id integer;
UPDATE exam_history eh
SET new_unit_id = u.new_id
FROM units u
WHERE eh.unit_id = u.code;

-- ---------- ขั้นที่ 6: สลับคอลัมน์ใน units ให้ id เป็น integer PK ----------
ALTER TABLE units DROP CONSTRAINT IF EXISTS units_pkey CASCADE;
ALTER TABLE units DROP COLUMN id;
ALTER TABLE units RENAME COLUMN new_id TO id;
ALTER TABLE units ALTER COLUMN id SET NOT NULL;
ALTER TABLE units ADD PRIMARY KEY (id);

-- สร้าง sequence ให้ units.id เป็น auto-increment
CREATE SEQUENCE IF NOT EXISTS units_id_seq OWNED BY units.id;
ALTER TABLE units ALTER COLUMN id SET DEFAULT nextval('units_id_seq');
SELECT setval('units_id_seq', COALESCE((SELECT MAX(id) FROM units), 1));

-- ---------- ขั้นที่ 7: สลับคอลัมน์ unit_id ในตารางต่าง ๆ ----------
-- 7.1 subjects
ALTER TABLE subjects DROP COLUMN IF EXISTS unit_id;
ALTER TABLE subjects RENAME COLUMN new_unit_id TO unit_id;
ALTER TABLE subjects ADD CONSTRAINT subjects_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

-- 7.2 question_units
ALTER TABLE question_units DROP COLUMN IF EXISTS unit_id;
ALTER TABLE question_units RENAME COLUMN new_unit_id TO unit_id;
ALTER TABLE question_units ADD CONSTRAINT question_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;
ALTER TABLE question_units DROP CONSTRAINT IF EXISTS question_units_q_u_lv_key;
ALTER TABLE question_units ADD CONSTRAINT question_units_q_u_lv_key UNIQUE (question_id, unit_id, level);

-- 7.3 exam_history
ALTER TABLE exam_history DROP COLUMN IF EXISTS unit_id;
ALTER TABLE exam_history RENAME COLUMN new_unit_id TO unit_id;

-- ---------- ขั้นที่ 8: กำหนดสิทธิ์ RLS ----------
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "units_all" ON units;
CREATE POLICY "units_all" ON units FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "subjects_all" ON subjects;
CREATE POLICY "subjects_all" ON subjects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "question_units_all" ON question_units;
CREATE POLICY "question_units_all" ON question_units FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "exam_history_all" ON exam_history;
CREATE POLICY "exam_history_all" ON exam_history FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- ตรวจสอบผลลัพธ์
SELECT id, code, name, short_name, icon FROM units ORDER BY id;
