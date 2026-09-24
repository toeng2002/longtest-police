// ============================================================
// Service Worker — ระบบจำลองข้อสอบตำรวจ PWA
// ============================================================

const CACHE_NAME = 'police-exam-v22';
const PRECACHE_URLS = [
  './',
  './index.html',
  './police_exam.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-apple.png',
  './icons/favicon.png',
  './js/supabase.min.js',
  './js/bcrypt.min.js',
  './js/exam-db.js',
  './js/app-quiz.js',
  './js/app-admin.js',
  './js/app-settings.js',
  './js/app-auth.js',
  './js/app-profile-settings.js',
  './js/app-csv.js',
  './js/anti-cheat.js'
];

// ติดตั้ง Service Worker และบันทึกไฟล์แคชเริ่มต้น
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS.map(u => new Request(u, { cache: 'reload' }))).catch(err => {
        console.warn('Precache partial fail:', err);
      });
    })
  );
});

// เคลียร์แคชเก่าเมื่อมีการอัปเดตเวอร์ชัน
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ดักจับ Network Requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ไม่แคชคำขอไปยัง Supabase API หรือ OAuth Callback URL เพื่อให้ล็อกอินสดใหม่เสมอ
  if (url.hostname.includes('supabase.co') || url.searchParams.has('code') || url.searchParams.has('error')) {
    return;
  }

  // Network First with Cache Fallback สำหรับไฟล์ทั่วไป
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // หากดาวน์โหลดสำเร็จ บันทึกลงแคชเพื่อใช้วันหลัง
        if (response && response.status === 200 && event.request.method === 'GET') {
          const respClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
        }
        return response;
      })
      .catch(() => {
        // หากไม่มีอินเทอร์เน็ต ใช้ไฟล์จากแคช
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
