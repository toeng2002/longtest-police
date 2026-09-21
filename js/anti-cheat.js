/* ============================================================
   anti-cheat.js — ระบบความปลอดภัยและการป้องกันการคัดลอกข้อสอบ
   - ป้องกันการคลิกขวา (Context Menu)
   - ป้องกันการคัดลอก/ตัดข้อความ (Copy/Cut/Select)
   - ป้องกันปุ่มลัด DevTools, View Source, Print Screen
   - เบลอหน้าจอเมื่อสลับหน้าต่างหรือใช้โปรแกรมแคปภาพ (Blur on Focus Loss)
   - แสดงลายน้ำระบุตัวตนแบบไดนามิก (Dynamic Security Watermark)
   ============================================================ */

(function () {
  'use strict';

  // 1. เพิ่ม CSS สำหรับการป้องกันและการเบลอหน้าจอ
  const style = document.createElement('style');
  style.id = 'anti-cheat-styles';
  style.textContent = `
    /* ป้องกันการลากคลุมข้อความในส่วนข้อสอบ */
    .q-stem, .opt-card, .opt-text, #s-quiz, #s-summary, .question-wrap, .exam-screen {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
    }

    /* อนุญาตให้พิมพ์และเลือกข้อความใน input และ textarea ได้ตามปกติ */
    input, textarea, [contenteditable="true"] {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      -ms-user-select: auto !important;
      user-select: auto !important;
    }

    /* เอฟเฟกต์เบลอเมื่อหน้าจอหลุดโฟกัส (ป้องกัน Snipping Tool) */
    body.screen-blur-active #s-quiz {
      filter: blur(28px) !important;
      pointer-events: none !important;
      transition: filter 0.08s ease;
    }

    /* กล่องเตือนเมื่อหน้าต่างหลุดโฟกัสระหว่างทำข้อสอบ */
    #anti-cheat-blur-notice {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 99999;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
      color: #fff;
    }
    body.screen-blur-active #anti-cheat-blur-notice {
      display: flex;
    }
    .blur-notice-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 28px 24px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }

    /* เลเยอร์ลายน้ำระบุตัวตน (Security Watermark) */
    #security-watermark-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 9998;
      overflow: hidden;
      opacity: 0.07;
    }
  `;
  document.head.appendChild(style);

  // 2. สร้างกล่อง Overlay เตือนเมื่อหน้าจอหลุดโฟกัส
  function ensureBlurNotice() {
    if (document.getElementById('anti-cheat-blur-notice')) return;
    const notice = document.createElement('div');
    notice.id = 'anti-cheat-blur-notice';
    notice.innerHTML = `
      <div class="blur-notice-box">
        <div style="font-size: 40px; margin-bottom: 12px;">🛡️</div>
        <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">หน้าต่างข้อสอบถูกซ่อนชั่วคราว</div>
        <div style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 18px;">
          ตรวจพบการสลับหน้าต่าง หรือการใช้งานเครื่องมือจับภาพหน้าจอ กรุณาคลิกที่หน้าต่างนี้เพื่อทำข้อสอบต่อ
        </div>
        <button onclick="document.body.classList.remove('screen-blur-active'); window.focus();" 
          style="background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%;">
          คลิกเพื่อทำข้อสอบต่อ
        </button>
      </div>
    `;
    document.body.appendChild(notice);
  }

  // 3. ตรวจจับการคลิกขวา (Context Menu)
  document.addEventListener('contextmenu', function (e) {
    // ยกเว้นช่องกรอกข้อมูลฟอร์ม
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    e.preventDefault();
    if (typeof showToast === 'function') {
      showToast('ไม่อนุญาตให้คลิกขวาในระบบข้อสอบ', 'warning');
    }
  });

  // 4. ตรวจจับการคัดลอกและตัดข้อความ (Copy / Cut)
  document.addEventListener('copy', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    e.preventDefault();
    if (typeof showToast === 'function') {
      showToast('ไม่อนุญาตให้คัดลอกข้อความในระบบ', 'warning');
    }
  });

  document.addEventListener('cut', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    e.preventDefault();
  });

  // 5. ป้องกันการลากคลุมข้อความในพื้นที่ข้อสอบ
  document.addEventListener('selectstart', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    const isProtected = e.target.closest('#s-quiz, #s-summary, .question-wrap, .exam-screen, .quiz-body');
    if (isProtected) {
      e.preventDefault();
    }
  });

  // 6. ตรวจจับปุ่มลัดคีย์บอร์ด (DevTools, Print, View Source)
  document.addEventListener('keydown', function (e) {
    const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);

    // F12 (DevTools)
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      if (typeof showToast === 'function') showToast('ไม่อนุญาตให้เปิด Developer Tools', 'warning');
      return false;
    }

    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (DevTools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      return false;
    }

    // Ctrl+U (View Source)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u')) {
      e.preventDefault();
      return false;
    }

    // Ctrl+S (Save Webpage)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      return false;
    }

    // Ctrl+P (Print / PDF)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      if (typeof showToast === 'function') showToast('ไม่อนุญาตให้พิมพ์หรือบันทึกข้อสอบเป็น PDF', 'warning');
      return false;
    }

    // Ctrl+C (Copy นอก input)
    if (!isInput && (e.ctrlKey || e.metaKey) && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      if (typeof showToast === 'function') showToast('ไม่อนุญาตให้คัดลอกข้อสอบ', 'warning');
      return false;
    }
  });

  // 7. ตรวจจับปุ่ม PrintScreen
  document.addEventListener('keyup', function (e) {
    if (e.key === 'PrintScreen' || e.keyCode === 44) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(''); // เคลียร์คลิปบอร์ดทันที
        }
      } catch (err) {}
      if (typeof showToast === 'function') {
        showToast('⚠️ ไม่อนุญาตให้บันทึกภาพหน้าจอข้อสอบ', 'danger');
      }
    }
  });

  // 8. ตรวจจับเมื่อหน้าต่างหลุดโฟกัส (Window Blur / Snipping Tool Detection)
  window.addEventListener('blur', function () {
    const quizScreen = document.getElementById('s-quiz');
    const isQuizActive = quizScreen && (quizScreen.classList.contains('active') || quizScreen.style.display === 'block');
    if (isQuizActive) {
      ensureBlurNotice();
      document.body.classList.add('screen-blur-active');
    }
  });

  window.addEventListener('focus', function () {
    document.body.classList.remove('screen-blur-active');
  });

  // 9. ระบบลายน้ำระบุตัวตนแบบไดนามิก (Dynamic Security Watermark)
  window.updateSecurityWatermark = function () {
    let overlay = document.getElementById('security-watermark-overlay');
    if (typeof currentUser === 'undefined' || !currentUser) {
      if (overlay) overlay.style.display = 'none';
      return;
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'security-watermark-overlay';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';

    const username = currentUser.username || 'User';
    const dispName = currentUser.display_name || '';
    const userId = currentUser.id || '';
    const text = `${username} (${dispName}) • ID:${userId}`;

    // สร้างลวดลาย SVG ข้อความเอียง 25 องศา กระจายทั่วทั้งหน้าจอ
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="220">
      <text x="50%" y="50%" transform="rotate(-25 170 110)"
        fill="#000000" font-family="'Sarabun', system-ui, sans-serif" font-size="13" font-weight="600"
        text-anchor="middle" dominant-baseline="middle">${text}</text>
    </svg>`;
    const encoded = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    overlay.style.backgroundImage = `url("${encoded}")`;
    overlay.style.backgroundRepeat = 'repeat';
  };

  // เรียกเตรียมกล่องแจ้งเตือนเมื่อโหลดหน้าเสร็จ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureBlurNotice);
  } else {
    ensureBlurNotice();
  }
})();
