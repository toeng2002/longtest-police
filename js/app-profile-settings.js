/* ============================================================
   app-profile-settings.js — จัดการโปรไฟล์, ตั้งค่าธีม/ฟอนต์, และภาพพื้นหลัง
   ระบบจำลองข้อสอบตำรวจ
   ============================================================ */

let _tempProfileAvatarData = null;

// ============================================================
// 1. ระบบจัดการการตั้งค่ารูปลักษณ์ (Themes, Fonts, Sizing, Wallpaper)
// ============================================================

function initProfileAndSettings() {
  // โหลดค่าการตั้งค่าจาก localStorage
  const theme = localStorage.getItem('police_theme') || 'light';
  const font = localStorage.getItem('police_font') || 'sarabun';
  const fontSize = localStorage.getItem('police_font_size') || 'normal';
  const customBg = localStorage.getItem('police_custom_bg_image') || null;
  const customBgOpacity = localStorage.getItem('police_custom_bg_opacity') || '25';

  applyUserPreferences({ theme, font, fontSize, customBg, customBgOpacity });

  // ดักจับคลิกนอก Dropdown เพื่อปิดอัตโนมัติ
  document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('user-dropdown-menu');
    const profileBtn = document.getElementById('user-profile-btn');
    if (dropdown && dropdown.style.display !== 'none') {
      if (profileBtn && !profileBtn.contains(e.target) && !dropdown.contains(e.target)) {
        closeUserDropdown();
      }
    }
  });
}

function applyUserPreferences(pref) {
  const root = document.documentElement;
  const body = document.body;

  // 1) ธีม
  if (pref.theme) {
    root.setAttribute('data-theme', pref.theme);
    if (body) body.setAttribute('data-theme', pref.theme);
    updateThemeButtonsUI(pref.theme);
  }

  // 2) แบบฟอนต์
  if (pref.font) {
    root.setAttribute('data-font', pref.font);
    if (body) body.setAttribute('data-font', pref.font);
    updateFontButtonsUI(pref.font);
  }

  // 3) ขนาดตัวอักษร
  if (pref.fontSize) {
    root.setAttribute('data-font-size', pref.fontSize);
    if (body) body.setAttribute('data-font-size', pref.fontSize);
    updateFontSizeButtonsUI(pref.fontSize);
  }

  // 4) ภาพพื้นหลัง (Wallpaper)
  applyCustomWallpaper(pref.customBg, pref.customBgOpacity);

  // 5) อัปเดตลายน้ำตามธีม
  if (typeof updateSecurityWatermark === 'function') {
    try { updateSecurityWatermark(); } catch(e) {}
  }
}

function setUserTheme(theme) {
  localStorage.setItem('police_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
  if (document.body) {
    document.body.setAttribute('data-theme', theme);
  }
  updateThemeButtonsUI(theme);
  if (typeof updateSecurityWatermark === 'function') {
    try { updateSecurityWatermark(); } catch(e) {}
  }
}

function updateThemeButtonsUI(activeTheme) {
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    const t = btn.getAttribute('data-theme');
    if (t === activeTheme) {
      btn.style.borderColor = 'var(--accent)';
      btn.style.boxShadow = '0 0 0 2px var(--accent-border)';
    } else {
      btn.style.borderColor = 'var(--border)';
      btn.style.boxShadow = 'none';
    }
  });
}

function setUserFont(font) {
  localStorage.setItem('police_font', font);
  document.documentElement.setAttribute('data-font', font);
  updateFontButtonsUI(font);
}

function updateFontButtonsUI(activeFont) {
  document.querySelectorAll('.font-option-btn').forEach(btn => {
    const f = btn.getAttribute('data-font');
    if (f === activeFont) {
      btn.style.borderColor = 'var(--accent)';
      btn.style.background = 'var(--accent-bg)';
      btn.style.color = 'var(--accent)';
      btn.style.fontWeight = '600';
    } else {
      btn.style.borderColor = 'var(--border2)';
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--text)';
      btn.style.fontWeight = '400';
    }
  });
}

function setUserFontSize(size) {
  localStorage.setItem('police_font_size', size);
  document.documentElement.setAttribute('data-font-size', size);
  updateFontSizeButtonsUI(size);
}

function updateFontSizeButtonsUI(activeSize) {
  document.querySelectorAll('.fontsize-option-btn').forEach(btn => {
    const s = btn.getAttribute('data-size');
    if (s === activeSize) {
      btn.style.borderColor = 'var(--accent)';
      btn.style.background = 'var(--accent-bg)';
      btn.style.color = 'var(--accent)';
      btn.style.fontWeight = '600';
    } else {
      btn.style.borderColor = 'var(--border2)';
      btn.style.background = 'var(--surface)';
      btn.style.color = 'var(--text)';
      btn.style.fontWeight = '400';
    }
  });
}

// ------------------------------------------------------------
// จัดการภาพพื้นหลังส่วนตัว (Custom Motivation Wallpaper)
// ------------------------------------------------------------
function applyCustomWallpaper(imageData, opacityVal) {
  let bgEl = document.getElementById('user-custom-bg');
  if (!bgEl) {
    bgEl = document.createElement('div');
    bgEl.id = 'user-custom-bg';
    document.body.prepend(bgEl);
  }

  const thumb = document.getElementById('wallpaper-thumb-preview');
  const opacityBox = document.getElementById('wallpaper-opacity-box');
  const removeBtn = document.getElementById('btn-remove-wallpaper');
  const slider = document.getElementById('wallpaper-opacity-slider');
  const opacityValEl = document.getElementById('wallpaper-opacity-val');

  if (imageData) {
    const opacityDec = (parseInt(opacityVal || 25, 10) / 100);
    bgEl.style.backgroundImage = `url("${imageData}")`;
    bgEl.style.opacity = opacityDec;
    bgEl.style.display = 'block';

    if (thumb) {
      thumb.innerHTML = `<img src="${imageData}" style="width:100%;height:100%;object-fit:cover">`;
    }
    if (opacityBox) opacityBox.style.display = 'block';
    if (removeBtn) removeBtn.style.display = 'inline-block';
    if (slider) slider.value = opacityVal || 25;
    if (opacityValEl) opacityValEl.textContent = (opacityVal || 25) + '%';
  } else {
    bgEl.style.backgroundImage = 'none';
    bgEl.style.display = 'none';

    if (thumb) {
      thumb.innerHTML = '<span style="font-size:20px;color:var(--text3)">🌄</span>';
    }
    if (opacityBox) opacityBox.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

function handleWallpaperUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // บีบอัดและปรับขนาดความละเอียดสูงสุด 1600px เพื่อประหยัดพื้นที่ localStorage
      let width = img.width;
      let height = img.height;
      const maxDim = 1600;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const optimizedBase64 = canvas.toDataURL('image/jpeg', 0.75);

      try {
        localStorage.setItem('police_custom_bg_image', optimizedBase64);
        const opacity = localStorage.getItem('police_custom_bg_opacity') || '25';
        applyCustomWallpaper(optimizedBase64, opacity);
        if (typeof showToast === 'function') {
          showToast('เปลี่ยนภาพพื้นหลังเรียบร้อยแล้ว', 'success');
        }
      } catch (err) {
        console.error('Storage full error:', err);
        alert('รูปภาพมีขนาดใหญ่เกินกว่าที่เบราว์เซอร์จะบันทึกได้ กรุณาเลือกรูปอื่น');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function changeWallpaperOpacity(val) {
  localStorage.setItem('police_custom_bg_opacity', val);
  const valEl = document.getElementById('wallpaper-opacity-val');
  if (valEl) valEl.textContent = val + '%';
  const bgEl = document.getElementById('user-custom-bg');
  if (bgEl) {
    bgEl.style.opacity = (parseInt(val, 10) / 100);
  }
}

function removeUserWallpaper() {
  localStorage.removeItem('police_custom_bg_image');
  applyCustomWallpaper(null, '25');
  if (typeof showToast === 'function') {
    showToast('ลบภาพพื้นหลังและคืนค่าเริ่มต้นแล้ว');
  }
}


// ============================================================
// 2. Avatar & Dropdown UI ใน Topbar
// ============================================================

function getAvatarInitials(name) {
  if (!name) return 'U';
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  // ถ้ามี space ให้ดึงตัวแรกของคำแรกและคำที่สอง
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return trimmed.substring(0, 2).toUpperCase();
}

function updateUserAvatarUI() {
  if (!currentUser) return;

  const name = currentUser.display_name || currentUser.username || 'ผู้ใช้';
  const initials = getAvatarInitials(name);
  const avatarUrl = currentUser.avatar_url || null;

  // 1) Topbar Avatar Wrap
  const topbarWrap = document.getElementById('user-avatar-img-wrap');
  if (topbarWrap) {
    if (avatarUrl) {
      topbarWrap.innerHTML = `<img src="${avatarUrl}" alt="${name}" style="width:100%;height:100%;object-fit:cover;display:block">`;
    } else {
      topbarWrap.innerHTML = `<span style="font-size:12px;font-weight:600">${initials}</span>`;
    }
  }

  // 2) Topbar Name
  const tbName = document.getElementById('user-topbar-name');
  if (tbName) {
    tbName.textContent = name;
  }

  // 3) Dropdown Header
  const dropName = document.getElementById('dropdown-user-fullname');
  if (dropName) {
    dropName.textContent = name;
  }
  const dropPlan = document.getElementById('dropdown-user-plan');
  if (dropPlan) {
    const isVip = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.plan === 'vip';
    if (isVip) {
      dropPlan.innerHTML = '<span style="color:#D97706">⭐ สมาชิก VIP</span>';
    } else if (currentUser.subscription_until && new Date(currentUser.subscription_until) > new Date()) {
      const days = typeof getSubscriptionDaysRemaining === 'function' ? getSubscriptionDaysRemaining(currentUser) : 0;
      dropPlan.innerHTML = `<span style="color:#16A34A">⚡ สมาชิกพรีเมียม (เหลือ ${days} วัน)</span>`;
    } else {
      dropPlan.innerHTML = '<span style="color:var(--text2)">👤 สมาชิกทั่วไป (Free)</span>';
    }
  }

  // 4) Admin Layout Avatar (ถ้ามี)
  const adminAv = document.getElementById('admin-avatar');
  if (adminAv) {
    if (avatarUrl) {
      adminAv.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      adminAv.textContent = initials;
    }
  }
}

function toggleUserDropdown(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('user-dropdown-menu');
  if (!menu) return;
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
  } else {
    menu.style.display = 'block';
  }
}

function closeUserDropdown() {
  const menu = document.getElementById('user-dropdown-menu');
  if (menu) menu.style.display = 'none';
}


// ============================================================
// 3. Modal "จัดการโปรไฟล์" (Profile Management Modal)
// ============================================================

function openProfileModal() {
  if (!currentUser) return;
  _tempProfileAvatarData = null;

  const modal = document.getElementById('modal-user-profile');
  if (!modal) return;

  // แยกชื่อ - นามสกุล จาก display_name
  const fullName = (currentUser.display_name || '').trim();
  let firstName = fullName;
  let lastName = '';
  if (fullName.includes(' ')) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
  }

  document.getElementById('prof-firstname').value = firstName;
  document.getElementById('prof-lastname').value = lastName;
  document.getElementById('prof-phone').value = currentUser.phone || '';
  document.getElementById('prof-email').value = currentUser.email || '';

  // Avatar Preview ใน Modal
  renderProfileModalAvatar(currentUser.avatar_url, fullName || currentUser.username);

  // สถานะสมาชิกและวันหมดอายุ
  renderProfileSubscriptionInfo();

  modal.style.display = 'flex';
}

function closeProfileModal() {
  const modal = document.getElementById('modal-user-profile');
  if (modal) modal.style.display = 'none';
  _tempProfileAvatarData = null;
}

function renderProfileModalAvatar(url, name) {
  const wrap = document.getElementById('modal-profile-avatar-wrap');
  if (!wrap) return;
  if (url) {
    wrap.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;display:block">`;
  } else {
    wrap.innerHTML = `<span>${getAvatarInitials(name)}</span>`;
  }
}

function renderProfileSubscriptionInfo() {
  const badge = document.getElementById('prof-plan-badge');
  const text = document.getElementById('prof-expiry-text');
  if (!badge || !text || !currentUser) return;

  const isVip = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.plan === 'vip';

  if (isVip) {
    badge.textContent = 'VIP ตลอดชีพ';
    badge.style.background = '#FEF3C7';
    badge.style.color = '#B45309';
    text.innerHTML = 'วันหมดอายุ: <b>ใช้งานได้ไม่จำกัด (ตลอดชีพ)</b>';
    return;
  }

  if (currentUser.subscription_until) {
    const expiryDate = new Date(currentUser.subscription_until);
    const now = new Date();
    const days = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    const dateStr = expiryDate.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    if (days > 0) {
      badge.textContent = 'Premium';
      badge.style.background = 'var(--success-bg)';
      badge.style.color = 'var(--success)';
      text.innerHTML = `วันหมดอายุ: <b>${dateStr}</b> (เหลือเวลาอีก <b>${days} วัน</b>)`;
    } else {
      badge.textContent = 'หมดอายุแล้ว';
      badge.style.background = 'var(--danger-bg)';
      badge.style.color = 'var(--danger)';
      text.innerHTML = `หมดอายุแล้วเมื่อ: <b style="color:var(--danger)">${dateStr}</b> (กรุณาต่ออายุสมาชิก)`;
    }
  } else {
    badge.textContent = 'Free Plan';
    badge.style.background = 'var(--surface)';
    badge.style.color = 'var(--text2)';
    badge.style.border = '1px solid var(--border2)';
    text.innerHTML = 'วันหมดอายุ: <b>ยังไม่มีแพ็กเกจสมาชิกรายเดือน</b>';
  }
}

function handleProfileAvatarUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (!file.type.startsWith('image/')) {
    alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // ครอปและย่อให้เป็นสี่เหลี่ยมจัตุรัส 200x200 px คุณภาพ 82% เพื่อให้ขนาดไฟล์เล็ก (15-25 KB)
      const canvas = document.createElement('canvas');
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;

      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      const base64Avatar = canvas.toDataURL('image/jpeg', 0.82);
      _tempProfileAvatarData = base64Avatar;

      // อัปเดตพรีวิวใน Modal ทันที
      renderProfileModalAvatar(base64Avatar, 'ME');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

async function saveUserProfile() {
  if (!currentUser) return;

  const btn = document.getElementById('btn-save-profile');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';
  }

  try {
    const firstName = document.getElementById('prof-firstname').value.trim();
    const lastName = document.getElementById('prof-lastname').value.trim();
    const newDisplayName = (firstName + ' ' + lastName).trim();
    const phone = document.getElementById('prof-phone').value.trim();
    const email = document.getElementById('prof-email').value.trim();

    const updatePayload = {
      display_name: newDisplayName || currentUser.username,
      phone: phone,
      email: email
    };

    if (_tempProfileAvatarData) {
      updatePayload.avatar_url = _tempProfileAvatarData;
    }

    const { data, error } = await supa
      .from('users')
      .update(updatePayload)
      .eq('id', currentUser.id)
      .select('id, username, display_name, phone, email, avatar_url, plan, subscription_until')
      .single();

    if (error) {
      console.error('Update profile error:', error);
      alert('บันทึกข้อมูลไม่สำเร็จ: ' + (error.message || 'โปรดลองใหม่อีกครั้ง'));
      return;
    }

    // อัปเดตสถานะ currentUser ใน memory
    currentUser.display_name = updatePayload.display_name;
    currentUser.phone = phone;
    currentUser.email = email;
    if (_tempProfileAvatarData) {
      currentUser.avatar_url = _tempProfileAvatarData;
    }

    // อัปเดตลายน้ำหน้าจอ
    if (typeof updateSecurityWatermark === 'function') {
      try { updateSecurityWatermark(); } catch(w) {}
    }

    // อัปเดต UI ทั่วทั้งหน้า
    updateUserAvatarUI();
    closeProfileModal();

    if (typeof showToast === 'function') {
      showToast('บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว', 'success');
    }
  } catch (err) {
    console.error('Save profile exception:', err);
    alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || '💾 บันทึกข้อมูล';
    }
  }
}


// ============================================================
// 4. Modal "ตั้งค่า" (Settings Modal)
// ============================================================

function openSettingsModal() {
  const modal = document.getElementById('modal-user-settings');
  if (!modal) return;

  const currentTheme = localStorage.getItem('police_theme') || 'light';
  const currentFont = localStorage.getItem('police_font') || 'sarabun';
  const currentSize = localStorage.getItem('police_font_size') || 'normal';
  const currentWallpaper = localStorage.getItem('police_custom_bg_image') || null;
  const currentOpacity = localStorage.getItem('police_custom_bg_opacity') || '25';

  updateThemeButtonsUI(currentTheme);
  updateFontButtonsUI(currentFont);
  updateFontSizeButtonsUI(currentSize);
  applyCustomWallpaper(currentWallpaper, currentOpacity);

  modal.style.display = 'flex';
}

function closeSettingsModal() {
  const modal = document.getElementById('modal-user-settings');
  if (modal) modal.style.display = 'none';
}


// ============================================================
// 5. Modal "เติมเวลา / ต่ออายุสมาชิก" (Renew Subscription Modal)
// ============================================================

function openRenewModal() {
  const modal = document.getElementById('modal-renew-subscription');
  if (modal) modal.style.display = 'flex';
}

function closeRenewModal() {
  const modal = document.getElementById('modal-renew-subscription');
  if (modal) modal.style.display = 'none';
}


// เริ่มต้นระบบ Preferences ทันทีที่ไฟล์โหลด
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfileAndSettings);
} else {
  initProfileAndSettings();
}
