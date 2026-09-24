/**
 * Google Apps Script — ระบบส่งอีเมล OTP (Police Exam OTP Mailer)
 * ส่งอีเมลออกจากบัญชี Gmail ของคุณเอง ฟรี 100% (โควตา 100-500 ฉบับ/วัน)
 * 
 * วิธีติดตั้ง:
 * 1. เข้าไปที่ https://script.google.com/home (ล็อกอินด้วย Gmail ของคุณ)
 * 2. กดปุ่ม "+ โครงการใหม่" (New Project)
 * 3. ลบโค้ดเดิมทั้งหมด แล้วคัดลอกโค้ดนี้ไปวาง
 * 4. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) -> "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 * 5. เลือกประเภท: "เว็บแอป" (Web app)
 *    - คำอธิบาย: Police Exam Mailer
 *    - ดำเนินการในฐานะ: ตัวฉัน (Me - อีเมลของคุณ)
 *    - ผู้มีสิทธิ์เข้าถึง: ทุกคน (Anyone)  <-- สำคัญมาก!
 * 6. กด "ทำให้ใช้งานได้" (Deploy) -> กดยินยอมสิทธิ์ (Authorize access)
 * 7. คัดลอก "URL เว็บแอป" (Web App URL) ที่ได้ (ขึ้นต้นด้วย https://script.google.com/macros/s/...)
 *    นำมาใช้งานในหน้าเว็บ
 */

function doPost(e) {
  try {
    var contents = e.postData ? e.postData.contents : '';
    if (!contents) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'No data' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var data = JSON.parse(contents);
    var toEmail = data.to;
    var otp = data.otp;
    var username = data.username || 'ผู้ใช้งาน';
    var appName = data.appName || 'ระบบจำลองข้อสอบตำรวจ';
    var flow = data.flow || 'reset_password';

    if (!toEmail || !otp) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Missing to or otp' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var subject = flow === 'register'
      ? '🔑 รหัส OTP ยืนยันการสมัครสมาชิก - ' + appName
      : '🔑 รหัส OTP สำหรับรีเซ็ตรหัสผ่าน - ' + appName;

    var actionTitle = flow === 'register' ? 'ยืนยันการสมัครสมาชิกใหม่' : 'ตั้งรหัสผ่านใหม่';
    var actionDesc = flow === 'register'
      ? 'คุณได้ทำรายการสมัครสมาชิก <b>' + appName + '</b> ด้วยบัญชี: <b>' + username + '</b>'
      : 'คุณได้ทำรายการขอรีเซ็ตรหัสผ่านสำหรับบัญชี: <b>' + username + '</b>';

    var htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Sarabun', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="font-size: 32px; margin-bottom: 4px;">👮‍♂️</div>
          <h2 style="color: #1e293b; margin: 0 0 6px 0; font-size: 20px;">` + appName + `</h2>
          <span style="display: inline-block; padding: 4px 14px; background: #eff6ff; color: #2563eb; border-radius: 20px; font-size: 13px; font-weight: 600;">` + actionTitle + `</span>
        </div>
        
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 8px 0;">สวัสดีครับ/ค่ะ <b>` + username + `</b>,</p>
        <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">` + actionDesc + ` กรุณาใช้รหัสยืนยัน OTP ด้านล่างนี้เพื่อดำเนินการต่อ:</p>
        
        <div style="background: #f8fafc; border: 2px dashed #93c5fd; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">รหัสยืนยัน OTP (มีอายุ 10 นาที)</div>
          <div style="font-size: 38px; font-weight: 800; letter-spacing: 10px; color: #1d4ed8; font-family: monospace;">` + otp + `</div>
        </div>
        
        <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 10px 14px; margin-bottom: 20px; font-size: 12px; color: #b45309; line-height: 1.5; text-align: center;">
          ⚠️ <b>คำแนะนำ:</b> กรุณากรอกรหัส 6 หลักนี้ในหน้าเว็บเดิม (ห้ามเปิดเผยรหัสแก่ผู้อื่น)
        </div>
        
        <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; text-align: center; margin: 0;">
          หากคุณไม่ได้เป็นผู้ทำรายการนี้ สามารถเพิกเฉยต่ออีเมลฉบับนี้ได้ บัญชีของคุณยังคงปลอดภัย
        </p>
        
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0 14px 0;">
        <div style="text-align: center; color: #cbd5e1; font-size: 11px;">
          ข้อความอัตโนมัติจากระบบ ` + appName + `
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: toEmail,
      subject: subject,
      htmlBody: htmlBody
    });

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'Police Exam OTP Mailer is active!' }))
    .setMimeType(ContentService.MimeType.JSON);
}
