-- ============================================================
-- setup_subscriptions.sql — รากฐานระบบสมาชิกและแพ็กเกจรายเดือน
-- รันไฟล์นี้ใน Supabase SQL Editor เพื่อเตรียมฐานข้อมูลให้พร้อม
-- ============================================================

-- 1) เพิ่มคอลัมน์ในตาราง users เพื่อรองรับระบบสมาชิกและวันหมดอายุ
alter table users 
  add column if not exists plan text not null default 'free',
  add column if not exists status text not null default 'active',
  add column if not exists subscription_until timestamptz,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists line_id text,
  add column if not exists notes text;

-- กำหนดให้ admin มีสถานะ VIP ตลอดชีพ
update users
set plan = 'vip', status = 'active'
where role in ('admin', 'both');

-- 2) สร้างตาราง payment_orders สำหรับบันทึกคำสั่งซื้อและการชำระเงิน (รองรับ GB Prime Pay / PromptPay / บัตร)
create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  user_id int references users(id) on delete set null,
  plan text not null,                     -- เช่น 'premium_1m', 'premium_3m'
  amount numeric(10,2) not null,          -- จำนวนเงิน เช่น 199.00
  duration_days int not null default 30,  -- จำนวนวันที่ต่ออายุ
  status text not null default 'pending', -- 'pending' (รอชำระ), 'paid' (ชำระแล้ว), 'failed', 'expired'
  payment_method text default 'promptpay',-- 'promptpay', 'credit_card', 'slip'
  gateway_ref text,                       -- รหัสอ้างอิงจาก Payment Gateway (GB Prime Pay)
  slip_url text,                          -- ลิงก์รูปสลิป (ถ้ามี)
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- Index สำหรับค้นหาคำสั่งซื้ออย่างรวดเร็ว
create index if not exists idx_payment_orders_user on payment_orders(user_id);
create index if not exists idx_payment_orders_order_no on payment_orders(order_no);
create index if not exists idx_payment_orders_status on payment_orders(status);

-- 3) สิทธิ์ความปลอดภัย (Row Level Security - RLS)
alter table payment_orders enable row level security;

-- นโยบายการอ่าน/เขียนคำสั่งซื้อ
create policy "Allow read payment_orders" on payment_orders
  for select using (true);

create policy "Allow insert payment_orders" on payment_orders
  for insert with check (true);

create policy "Allow update payment_orders" on payment_orders
  for update using (true);
