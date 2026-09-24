import http.server
import socketserver
import webbrowser
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    # เปลี่ยนโฟลเดอร์ทำงานมาที่โฟลเดอร์ของไฟล์นี้เสมอ
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    print("\n" + "=" * 50)
    print("  🚀 Police Exam - Local Web Server (Python)")
    print(f"  🌐 เปิดเว็บที่: http://localhost:{PORT}")
    print(f"  🌐 หรือ:       http://127.0.0.1:{PORT}")
    print("  ⌨️  กด Ctrl + C เพื่อหยุดการทำงาน")
    print("=" * 50 + "\n")
    
    # อนุญาตให้นำพอร์ตกลับมาใช้ใหม่ได้ทันทีหลังจากปิด
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
            # เปิดเบราว์เซอร์อัตโนมัติ
            try:
                webbrowser.open(f"http://localhost:{PORT}/index.html")
            except Exception:
                pass
            httpd.serve_forever()
    except OSError as e:
        if getattr(e, 'winerror', 0) == 10048 or "address already in use" in str(e).lower():
            print(f"⚠️ พอร์ต {PORT} ถูกใช้งานอยู่ กรุณารันด้วยพอร์ตอื่น เช่น:")
            print(f"   python serve.py 8081\n")
        else:
            print(f"❌ เกิดข้อผิดพลาด: {e}\n")
    except KeyboardInterrupt:
        print("\n🛑 หยุดการทำงานของเซิร์ฟเวอร์เรียบร้อยแล้ว\n")
