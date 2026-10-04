# Skill Prose (Backend dan operasional)

- Layanan tidak merespons: periksa berurutan dan berhenti di lapisan yang rusak. DNS, lalu koneksi TLS, lalu respons HTTP, lalu log aplikasi, lalu status deploy, lalu batas paket hosting.
- Bedakan "ditolak" (4xx, ada respons) dari "tidak menjawab" (timeout, 502, 503). Yang kedua hampir selalu urusan layanan atau hosting, bukan kode.
- Di hosting: baca status dan log dulu, lalu restart atau deploy ulang, lalu buktikan pulih dengan request nyata ke endpoint yang tadi gagal.
- Kalau penyebabnya batas paket, tagihan, atau layanan ditangguhkan, laporkan apa adanya dan tanyakan; itu keputusan pemilik akun.
- Kode: validasi input di tepi, periksa hak akses di setiap endpoint, jangan mencatat rahasia ke log, dan pertahankan bentuk respons serta kode error yang sudah dipakai klien.
- Perubahan data atau skema harus bisa dibatalkan; jangan menjalankan migrasi yang menghapus data tanpa bertanya.
