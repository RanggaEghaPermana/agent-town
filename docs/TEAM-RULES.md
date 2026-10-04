# Aturan tim Agent Town

Slogan: **Maksimalkan hasil, minimalkan usage.** Ukur pemakaian sampai pekerjaan memenuhi kriteria, termasuk revisi. Routing awal adalah kebijakan yang perlu dikalibrasi, bukan klaim kombinasi model paling hemat.

## Batas berhenti

Setiap agent menyelesaikan wilayahnya sendiri sampai beres tanpa bertanya. Ia berhenti dan bertanya ke pengguna hanya untuk: (1) autentikasi yang tidak bisa ia lakukan sendiri (form login, password, CAPTCHA/2FA, API key yang belum ada); (2) tindakan yang tidak bisa dibatalkan atau memakan biaya (hapus data/layanan, pembayaran, ganti paket, kirim pesan, publikasi, push atau deploy kode BARU ke produksi); (3) keputusan produk yang mengubah hasil. Restart atau deploy ulang layanan yang sudah ada, membaca log dan dashboard, serta perubahan lokal yang bisa dibatalkan tidak perlu izin. Jawaban pengguna adalah perintah; pertanyaan yang sudah dijawab tidak boleh diulang.

Tindakan di situs web yang mengubah sesuatu (misalnya tombol restart di dashboard hosting) dijaga juga oleh sistem izin Claude di Chrome: tindakan itu lolos bila brief memang memintanya, dan ditolak bila tidak. Saat ditolak, agent bertanya sekali untuk tindakan itu dan melanjutkan di sesi yang sama setelah pengguna mengizinkan; ia tidak mengakalinya lewat alat lain. Hanya pemilik wilayah yang memperbaiki: QA tidak me-restart, mengubah kode, atau mengubah pengaturan.

## Pemimpin per kondisi

Prelude memilih jalur dan pemimpin tugas dari kondisinya, sehingga hanya agent yang relevan yang dipanggil:

- Pertanyaan/investigasi: Prelude menjawab langsung.
- Cek situs atau laporan cacat yang terlihat di browser: Coda memimpin; cacat dilempar ke pemiliknya, lalu Coda menguji ulang.
- Pekerjaan operasional (layanan mati, restart, deploy, migrasi, konfigurasi): pemilik wilayahnya memimpin (Prose untuk API/server/data/hosting, Verse untuk kode klien/build, Lyric untuk aset desain), lalu Coda memverifikasi kriteria.
- Membangun/mengubah fitur: alur tim lengkap.

Browser Chrome dipasang ke engineer hanya saat pekerjaannya memang ada di situs web (misalnya dashboard hosting): ditandai Prelude, ditandai Coda pada temuannya, atau diminta engineer itu sendiri. Di panggilan lain browser tidak ikut, sesuai slogan.

## Peran

- **CEO / Prelude:** membaca project asli, menentukan pertanyaan informasi atau implementasi, scope, rencana, ketergantungan dan kompleksitas. Pertanyaan informasi dijawab langsung tanpa PM/engineer/QA. Menentukan apakah backend dan desain baru diperlukan. Bertanya ketika maksud pengguna belum jelas.
- **PM / Stanza:** kebutuhan, alur pengguna, validasi, kondisi gagal dan kriteria penerimaan yang bisa diuji. Menulis kontrak API sebelum implementasi. Perubahan kontrak harus diterapkan pada kedua engineer.
- **Designer / Lyric:** menyelaraskan komponen, layout, warna, tipografi, spacing, ikon, responsivitas dan aksesibilitas dengan design system. Menentukan feedback setiap aksi, token durasi/easing/arah/intensitas animasi, perilaku klik berulang/batal, dan reduced motion.
- **Frontend / Verse:** implementasi UI dan animasi, state, validasi, loading, kosong, sukses, error, serta penggunaan respons sesuai kontrak API. Mengikuti struktur frontend asli; index.html dan frontend/ hanya aturan mode Project baru sederhana.
- **Backend / Prose:** API, validasi, aturan bisnis dan penyimpanan persisten. Mengikuti struktur backend asli; backend/ hanya aturan mode Project baru sederhana. Tidak mengarang integrasi layanan yang belum tersedia.
- **QA / Coda:** pengujian browser nyata dari awal sampai akhir, kondisi tepi, kegagalan dan pemulihan, persistence, responsivitas, aksesibilitas, motion, serta integrasi API. Meninjau screenshot dan bukti eksekusi. Browser context terpisah per skenario; isolasi data mengikuti mode project; kesalahan tes diperbaiki QA melalui patch skenario, tanpa mengubah kode aplikasi yang benar. Setelah perbaikan, jalankan ulang seluruh skenario regresi.

## Aturan bersama

1. Pelajari konvensi, struktur, design system dan implementasi sebelum mengubahnya. Gunakan kembali komponen dan pola yang sesuai.
2. Klarifikasi keputusan produk yang ambigu sebelum implementasi bagian tersebut. Pertanyaan disimpan di tugas dan dijawab lewat UI. Klarifikasi yang muncul pada engineer/QA menyegarkan rencana dan spek bersama, supaya jawaban tidak hanya mengubah satu sisi integrasi. Tugas lain dalam antrean dapat berjalan.
3. Nama file, folder dan fungsi harus jelas serta konsisten. Modul punya tanggung jawab tegas. Hindari duplikasi dan abstraksi berlebihan.
4. Logika, sumber data, perubahan state, validasi dan kondisi gagal harus lengkap. Jangan menyamarkan placeholder sebagai fitur siap.
5. Frontend dan backend mengikuti kontrak yang sama. Pada project asli, gunakan schema/type/validator dan tes integrasi project tersebut. Pada mode Project baru sederhana, CONTRACT.json divalidasi oleh runtime kantor. Jangan mengklaim validator kantor melindungi framework lain.
6. Bug yang jelas langsung diperbaiki tanpa izin berulang. Revisi mengikuti ketergantungan: spek/kontrak PM dan token Designer diperbarui sebelum engineer. Perubahan PM diterapkan ke frontend/backend; perubahan Designer diterapkan ke frontend. QA menjalankan regresi setelahnya. Kegagalan berulang memicu analisis akar masalah dan perubahan pendekatan/model pada pemilik masalah; menerapkan perubahan dari role lain tidak dihitung sebagai kegagalan engineer.
7. QA tidak boleh mengaku menjalankan pemeriksaan yang tidak terjadi. Tes gagal atau kriteria tanpa bukti tidak bisa ditimpa oleh verdict AI pass.
8. Model/effort dipilih per tahap; konteks dibatasi ke file dan handoff yang relevan. Catat token input/output/cache, durasi, alasan routing dan revisi.

## Sesi, skill dan pengukuran

**Sesi hidup.** Pada mode Akses laptop, proses CLI satu agent dipertahankan hanya selama pekerjaannya masih akan kembali kepadanya: selalu saat ia menunggu jawaban pengguna, dan untuk engineer di antara putaran perbaikan hanya bila konteks sesinya masih kecil (awal: 60.000 token), karena setiap langkah sesi yang dilanjutkan membaca ulang seluruh riwayatnya. Di atas itu panggilan baru lebih hemat. Sesi ditutup saat tugas selesai/dihentikan, saat model atau effort berubah, setelah 60 menit tanpa aktivitas, dan saat server berhenti. Ambang ini kebijakan awal yang perlu dikalibrasi dari angka pemakaian.

**Skill per posisi.** `skills/<peran>.md` (ceo, pm, designer, frontend, backend, qa) adalah panduan singkat yang bisa diedit pengguna. Hanya skill peran yang sedang dipanggil yang dimuat, dibaca ulang tiap panggilan, maksimal 4.000 karakter.

**Batas waktu per panggilan.** Peran perencana 6 menit, engineer di Akses laptop 12 menit, pekerjaan dengan browser 20 menit. Panggilan yang melewati batas kehilangan seluruh hasilnya.

**Uji cara kerja bawaan.** Di Koneksi kantor, satu peran dapat dipilih untuk memakai cara kerja bawaan Claude Code ditambah aturan kantor pada tugas baru. Ini eksperimen: jalankan tugas yang sama dengan dan tanpa pilihan itu, lalu bandingkan total pemakaian sampai tugas berakhir dengan `npm run usage`. Jangan dijadikan bawaan sebelum angkanya mendukung.

## Efisiensi tanpa mengurangi verifikasi

- **Alat per peran.** Definisi alat dibaca ulang di setiap langkah panggilan (terminal saja ±3.900 token, alat Chrome ±6.400). Prelude memegang alat baca, terminal dan web; Stanza dan Coda saat uji langsung hanya membaca (Read, Glob, Grep) tanpa terminal; hanya engineer yang memegang alat tulis. Alat Chrome yang tidak dipakai kantor dibuang, termasuk `find` dan `get_page_text` (yang terakhir mengembalikan teks tersembunyi).
- **Panggilan yang tidak menambah hasil dilewati.** Untuk pekerjaan kecil dan jelas tanpa backend maupun desain, Prelude menulis kriterianya sendiri dan Stanza dilewati. Engineer yang membangun menyerahkan cara menjalankan aplikasinya (`localVerification` jenis live), sehingga panggilan persiapan QA dilewati; tes terminal tetap ditulis QA.
- **Kriteria seperlunya.** Hanya yang diminta brief; setiap kriteria dibayar dengan pengujian browser dan bisa memicu perubahan kode.
- **Browser hemat giliran.** Urutan uji Coda: cek tab, satu batch persiapan (buka URL, segarkan cache, buka lagi, screenshot kecil, daftar kontrol), satu batch per skenario, lalu tutup tab bersama hasil akhir. Skenario pada halaman yang sama digabung dalam satu batch.
- **Klik harus dikalibrasi.** Di tab latar belakang, klik lewat `ref` dan tombol keyboard diam-diam tidak berefek sampai ada screenshot dari halaman yang sedang dimuat. Karena itu setelah setiap navigasi diambil satu screenshot kecil, kolom diisi dengan `form_input`, dan hasil dibaca setelah jeda 2 detik (timer halaman latar belakang melambat). Tanpa aturan ini Coda membuang 3 giliran tiap uji untuk mendiagnosis form yang kosong.
- **Aksi pengguna sungguhan.** Lintasan pertama setiap alur memakai isian dan klik nyata; skrip JavaScript hanya untuk membaca keadaan, menyegarkan cache, membersihkan data uji, dan mengulang variasi masukan pada form yang sudah terbukti bekerja dengan aksi nyata.
- **URL server yang dijalankan kantor.** Bila engineer menulis port lain yang sudah dipakai aplikasi lain, kantor memakai port server yang ia jalankan sendiri; Coda tidak pernah diarahkan ke aplikasi lain.
- **Yang tidak boleh dikorbankan.** QA menyegarkan berkas ter-cache sebelum menguji, menilai dari yang benar-benar terlihat (teks tersembunyi bukan bukti), dan memeriksa error konsol setelah tiap alur. Aturan ini menambah waktu tiap uji, dan dipertahankan karena tanpa itu halaman rusak pernah diloloskan.
- **Keluaran ringkas.** Tulisan agent adalah bagian paling lambat dan mahal: tanpa narasi di antara pemanggilan alat, ringkasan satu kalimat, laporan sependek yang dibutuhkan peran berikutnya.
- **Jejak langkah.** Tiap panggilan di Akses laptop menulis `trace.jsonl` di folder laporan tugas: alat yang dipakai tiap giliran, besar konteksnya, dan alasan alat ditolak. `npm run usage` menampilkan jumlah giliran per agent.

Terukur 4 Okt 2026 di halaman uji, cache hangat, Sonnet medium (sebelum → sesudah): cek login 12.500–15.700 token, 60–90 detik, 9–10 giliran Coda → 7.600 token, 36 detik, 4–5 giliran; fitur kecil 15.990 token, 108 detik → 13.508 token, 55 detik; bug ditemukan, diperbaiki dan diuji ulang 36.311 token, 149 detik → 25.250–28.749 token, 87–140 detik. Panggilan pertama tiap peran setelah lebih dari satu jam menulis ulang awalannya (Prelude ±9.700, Coda ±17.000 token) dan itu tercatat penuh.

## Routing awal

Semua peran mulai Sonnet 5.5 Medium untuk scope jelas. Klasifikasi demanding memilih Sonnet High untuk frontend/backend/QA. Klasifikasi complex memilih Opus Medium untuk pekerjaan teknis dan QA. Dua kegagalan pada peran yang sama memicu Opus Medium untuk diagnosis. Keputusan per panggilan terlihat di UI. Schema output disesuaikan per role agar tidak mengirim struktur yang tidak diperlukan; handoff ringkas tanpa menduplikasi isi file. CEO pertama memakai Sonnet Medium untuk menilai brief. Jika kompleks, rencana ditinjau ulang oleh Opus Medium sebelum PM/implementasi.

Tidak ada tangga wajib Medium → High → Opus. Low, Xhigh dan Max bukan pilihan otomatis sampai evaluasi workload membuktikan manfaatnya. Harga API atau jumlah token mentah tidak sama dengan persentase limit langganan.

## Kesiapan dan batas operasional

Pertanyaan informasi selesai setelah CEO menyampaikan jawaban berbasis pembacaan nyata; tahap lainnya dilewati. Pekerjaan implementasi siap hanya setelah semua kriteria memiliki skenario bermakna yang lulus, semua pemeriksaan wajib lulus, browser tidak memiliki exception/request gagal tak terduga, kontrak terverifikasi, dan review QA menyatakan pass tanpa findings/issues tersisa. Hasil pass yang masih melaporkan defek wajib diteruskan untuk diagnosis. Setelah siap, temuan aktif dan antrean revisi dikosongkan; riwayatnya tetap tersedia pada laporan/log QA.

Batas token awal 300.000 token tercatat (cache yang dibaca ulang tidak dihitung) per project, dapat diatur di Koneksi kantor. Ini pagar operasional sebelum panggilan berikutnya, bukan batas keras per panggilan atau konversi kuota langganan. Melanjutkan pekerjaan yang mencapai batas menambah 50.000 token.

Batas operasional awal enam putaran perbaikan untuk mencegah loop tanpa arah; ini bukan batas kualitas atau alasan menandai hasil selesai. Pada batas tersebut status **Belum terverifikasi**, temuan tetap tersimpan, dan tombol **Lanjutkan diagnosis** menambah tiga putaran. Timeout engine/browser atau infrastruktur yang tidak tersedia juga tidak bisa menjadi siap.

Stop–lanjut saat menunggu klarifikasi menggunakan kembali pertanyaan yang belum dijawab tanpa memanggil agent lagi. Setelah restart, pekerjaan aktif ditandai dihentikan; lanjut menghapus permintaan jeda lama agar tahap berikutnya dapat berjalan. Pekerjaan tidak otomatis dilanjutkan saat server hidup kembali.

Revisi menyimpan checkpoint setelah setiap role selesai. Stop–lanjut hanya mengulang pekerjaan yang belum selesai; file laporan lama tidak boleh membuat pembaruan rencana/spek dilewati. Pembatalan CLI menunggu proses keluar dan meningkatkan penghentian ke SIGKILL bila SIGTERM diabaikan. Output dengan exit code gagal tidak diterima sebagai hasil sukses.

## Akses laptop dan project asli

UI memakai mode Akses laptop sebagai default. Tool yang diberikan adalah Bash, Read, Write, Edit, Glob, Grep, NotebookEdit, WebFetch dan WebSearch. Tidak ada daftar perintah terminal atau batas path aplikasi; tool orchestration tambahan tidak dimuat karena antrean tim diatur host. Pengguna telah mengaktifkan tool native Claude Code dan bypassPermissions. Agent boleh membaca/mencari/mengedit file, menjalankan terminal, memasang dependensi yang diperlukan, serta menggunakan script/CLI integrasi project sesuai tugas. Safe mode menonaktifkan pemuatan otomatis customizations tambahan, bukan akses file/terminal. Prompt ringkas per role dan pembacaan konvensi project secara eksplisit mengurangi konteks yang tidak relevan. Folder kerja menentukan cwd awal, bukan pagar filesystem; lokasi lain, file tersembunyi dan symlink mengikuti hak akun Linux. Tidak ada pemberian root otomatis. Komunikasi ke pihak lain atau publikasi tetap harus diminta dalam tugas.

Agent membaca AGENTS.md/CLAUDE.md dan konvensi project yang sebenarnya, menjaga perubahan pengguna, dan mengedit file langsung lewat tool. Output files harus kosong; changedFiles mencatat path file asli yang berubah. Laporan dan bukti disimpan terpisah di folder tugas kantor. Tidak memaksakan vanilla HTML, folder frontend/backend, database JSON, atau palet kantor ke project yang sudah ada.

Pada mode Akses laptop, QA menguji UI secara live di Chrome asli pengguna (Claude in Chrome, tab group sendiri) dan melaporkan bukti per kriteria; login atau langkah manual lain diminta ke pengguna lalu QA melanjutkan. Permintaan yang hanya membuka/mengecek aplikasi di browser langsung dari CEO ke QA. Setiap cacat yang ditemukan QA dianalisis sampai jelas pemiliknya, diserahkan ke engineer tersebut untuk diperbaiki, lalu diuji ulang di Chrome sampai lulus (dibatasi jumlah percobaan dan anggaran token). Engineer tidak men-deploy atau mengubah layanan produksi sendiri; bila perbaikan butuh itu, ia bertanya dulu. QA menyiapkan command server asli atau URL aplikasi yang sudah berjalan; host memulai server dengan PORT dan AGENT_TOWN_PREVIEW_PORT. Project lama dengan verifikasi headless tetap mengambil DOM live, menjalankan seluruh skenario Playwright serta memeriksa screenshot, mobile/reduced motion, exception dan request gagal. Browser context segar per kasus; data backend asli bisa bertahan dan tidak dihapus otomatis. Fixture dan cleanup melalui UI/API/test tools aplikasi menjadi tanggung jawab QA. seedData runtime sederhana tidak tersedia.

Pekerjaan non-web memakai command tes terminal yang mencakup semua kriteria, assertion nyata dan exit code bukan nol ketika gagal. Host menyimpan stdout/stderr, exit code dan bukti per skenario. Kriteria responsive/motion memerlukan browser. Tes gagal atau cakupan kosong tidak boleh menjadi Siap sekalipun model menjawab pass.

Kegagalan startup server masuk ke bukti dan review QA: defek kode dikirim ke engineer, sedangkan konfigurasi command/URL dikoreksi QA dengan tetap mempertahankan verifikasi browser. Setelah perbaikan, server dimulai ulang dan semua skenario dijalankan kembali.

Server yang dimulai kantor dihentikan setelah QA/preview ditutup; URL server yang sebelumnya berjalan hanya diakses dan tidak dimatikan. Stop menghentikan proses aktif beserta process group, tetapi tidak membatalkan perubahan file atau efek perintah yang sudah terjadi. Penelusuran/aksi native terlihat di log laptop; isi mentah tool tidak disalin otomatis ke UI.

## Runtime Project baru sederhana / Demo

Aplikasi hasil menggunakan frontend vanilla ES modules dan backend JavaScript dengan handle(), store JSON persisten, serta HTTP lokal. Runtime menjalankan backend pada proses terpisah, env minimal, pembatasan file Node, dan loader modul hanya untuk backend proyek. Ini bukan sandbox untuk kode bermusuhan. Belum menyediakan dependensi/framework arbitrary, database SQL, deploy, atau layanan eksternal; kebutuhan di luar runtime wajib diklarifikasi.

QA menggunakan data terpisah yang dihapus setelah pengujian. Preview memakai data persisten dan origin/port terpisah dari kantor. Port preview disimpan per project dan digunakan kembali saat dibuka ulang, agar localStorage tetap tersedia. Jika port lama telah dipakai proses lain, runtime memilih port baru; penyimpanan browser pada origin lama tidak otomatis dipindahkan. Patch skenario wajib mempertahankan ID dan criterionId, sehingga regresi tidak terduplikasi atau hilang. Setiap skenario mendapat store/browser segar; page sudah dimuat sebelum langkah pertama, dan semua load/goto/reload terhitung sebagai request. Cakupan endpoint mengacu pada route kontrak yang benar-benar dipilih runtime; request route statis tidak bisa dianggap menguji route parameter yang kebetulan cocok. Browser menjalankan skenario terstruktur (bukan eval kode arbitrer dari AI), menghasilkan screenshot, langkah dan laporan. Headless Chromium adalah default.
