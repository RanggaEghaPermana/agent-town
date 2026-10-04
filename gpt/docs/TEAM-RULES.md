# Aturan tim Agent Town

Slogan: **Maksimalkan hasil, minimalkan usage.** Ukur pemakaian sampai pekerjaan memenuhi kriteria, termasuk revisi. Routing awal adalah kebijakan yang perlu dikalibrasi, bukan klaim kombinasi model paling hemat.

## Batas berhenti

Setiap agent menyelesaikan wilayahnya sendiri sampai beres tanpa bertanya. Ia berhenti dan bertanya ke pengguna hanya untuk: (1) autentikasi yang tidak bisa ia lakukan sendiri (form login, password, CAPTCHA/2FA, API key yang belum ada); (2) tindakan yang tidak bisa dibatalkan atau memakan biaya (hapus data/layanan, pembayaran, ganti paket, kirim pesan, publikasi, push atau deploy kode BARU ke produksi); (3) keputusan produk yang mengubah hasil. Restart atau deploy ulang layanan yang sudah ada, membaca log dan dashboard, serta perubahan lokal yang bisa dibatalkan tidak perlu izin. Jawaban pengguna adalah perintah; pertanyaan yang sudah dijawab tidak boleh diulang.

Tindakan di situs web yang mengubah sesuatu (misalnya tombol restart di dashboard hosting) dijaga juga oleh sistem izin Chrome bawaan Codex: tindakan itu lolos bila brief memang memintanya, dan ditolak bila tidak. Saat ditolak, agent bertanya sekali untuk tindakan itu dan melanjutkan di sesi yang sama setelah pengguna mengizinkan; ia tidak mengakalinya lewat alat lain. Hanya pemilik wilayah yang memperbaiki: QA tidak me-restart, mengubah kode, atau mengubah pengaturan.

## Pemimpin per kondisi

Atlas memilih jalur dan pemimpin tugas dari kondisinya, sehingga hanya agent yang relevan yang dipanggil:

- Pertanyaan/investigasi: Atlas menjawab langsung.
- Cek situs atau laporan cacat yang terlihat di browser: Echo memimpin; cacat dilempar ke pemiliknya, lalu Echo menguji ulang.
- Pekerjaan operasional (layanan mati, restart, deploy, migrasi, konfigurasi): pemilik wilayahnya memimpin (Vector untuk API/server/data/hosting, Pixel untuk kode klien/build, Prism untuk aset desain), lalu Echo memverifikasi kriteria.
- Membangun/mengubah fitur: alur tim lengkap.

Browser Chrome dipasang ke engineer hanya saat pekerjaannya memang ada di situs web (misalnya dashboard hosting): ditandai Atlas, ditandai Echo pada temuannya, atau diminta engineer itu sendiri. Di panggilan lain browser tidak ikut, sesuai slogan.

## Peran

- **CEO / Atlas:** membaca project asli, menentukan pertanyaan informasi atau implementasi, scope, rencana, ketergantungan dan kompleksitas. Pertanyaan informasi dijawab langsung tanpa PM/engineer/QA. Menentukan apakah backend dan desain baru diperlukan. Bertanya ketika maksud pengguna belum jelas.
- **PM / Nova:** kebutuhan, alur pengguna, validasi, kondisi gagal dan kriteria penerimaan yang bisa diuji. Menulis kontrak API sebelum implementasi. Perubahan kontrak harus diterapkan pada kedua engineer.
- **Designer / Prism:** menyelaraskan komponen, layout, warna, tipografi, spacing, ikon, responsivitas dan aksesibilitas dengan design system. Menentukan feedback setiap aksi, token durasi/easing/arah/intensitas animasi, perilaku klik berulang/batal, dan reduced motion.
- **Frontend / Pixel:** implementasi UI dan animasi, state, validasi, loading, kosong, sukses, error, serta penggunaan respons sesuai kontrak API. Mengikuti struktur frontend asli; index.html dan frontend/ hanya aturan mode Project baru sederhana.
- **Backend / Vector:** API, validasi, aturan bisnis dan penyimpanan persisten. Mengikuti struktur backend asli; backend/ hanya aturan mode Project baru sederhana. Tidak mengarang integrasi layanan yang belum tersedia.
- **QA / Echo:** pengujian browser nyata dari awal sampai akhir, kondisi tepi, kegagalan dan pemulihan, persistence, responsivitas, aksesibilitas, motion, serta integrasi API. Meninjau screenshot dan bukti eksekusi. Project sederhana memakai browser context terpisah per skenario; Chrome live memakai satu tab milik QA dengan persiapan dan pembersihan data uji; kesalahan tes diperbaiki QA melalui patch skenario, tanpa mengubah kode aplikasi yang benar. Setelah perbaikan, jalankan ulang seluruh skenario regresi.

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

**Uji cara kerja bawaan.** Di Koneksi kantor, satu peran dapat dipilih untuk memakai cara kerja bawaan Codex ditambah aturan kantor pada tugas baru. Ini eksperimen: jalankan tugas yang sama dengan dan tanpa pilihan itu, lalu bandingkan total pemakaian sampai tugas berakhir dengan `npm run usage`. Jangan dijadikan bawaan sebelum angkanya mendukung.

## Efisiensi tanpa mengurangi verifikasi

- **Alat per peran.** Aturan peran membatasi Atlas dan Nova ke analisis, Echo ke verifikasi, serta perubahan implementasi ke engineer pemiliknya. Plugin tambahan dimatikan pada proses Codex kantor; Chrome dan REPL hanya dimuat untuk tahap yang memerlukan browser. Pengaturan ini berlaku pada proses kantor, tanpa mengubah konfigurasi Codex pengguna. Angka penghematan Claude tidak dianggap sebagai pengukuran GPT.
- **Panggilan yang tidak menambah hasil dilewati.** Untuk pekerjaan kecil dan jelas tanpa backend maupun desain, Atlas menulis kriterianya sendiri dan Nova dilewati. Engineer yang membangun menyerahkan cara menjalankan aplikasinya (`localVerification` jenis live), sehingga panggilan persiapan QA dilewati; tes terminal tetap ditulis QA.
- **Kriteria seperlunya.** Hanya yang diminta brief; setiap kriteria dibayar dengan pengujian browser dan bisa memicu perubahan kode.
- **Browser hemat giliran.** QA memakai `mcp__cua_repl` dan mengikuti dokumentasi yang dikembalikan tool. Satu tab dipakai selama sesi, aksi yang relevan digabung bila API mengizinkan, dan uji ulang menerima catatan langkah sebelumnya. Pengamatan tetap melalui DOM/hasil visual yang benar-benar tampil, konsol, dan jaringan.
- **Yang tidak boleh dikorbankan.** QA menyegarkan berkas ter-cache sebelum menguji, menilai dari yang benar-benar terlihat (teks tersembunyi bukan bukti), dan memeriksa error konsol setelah tiap alur. Aturan ini menambah waktu tiap uji, dan dipertahankan karena tanpa itu halaman rusak pernah diloloskan.
- **Keluaran ringkas.** Tulisan agent adalah bagian paling lambat dan mahal: tanpa narasi di antara pemanggilan alat, ringkasan satu kalimat, laporan sependek yang dibutuhkan peran berikutnya.

## Routing awal

Semua peran mulai GPT-6.1 Sol 5.5 Medium untuk scope jelas. Klasifikasi demanding memilih GPT-6.1 Sol High untuk frontend/backend/QA. Klasifikasi complex memilih GPT-6 Astra Medium untuk pekerjaan teknis dan QA. Dua kegagalan pada peran yang sama memicu GPT-6 Astra Medium untuk diagnosis. Keputusan per panggilan terlihat di UI. Schema output disesuaikan per role agar tidak mengirim struktur yang tidak diperlukan; handoff ringkas tanpa menduplikasi isi file. CEO pertama memakai GPT-6.1 Sol Medium untuk menilai brief. Jika kompleks, rencana ditinjau ulang oleh GPT-6 Astra Medium sebelum PM/implementasi.

Tidak ada tangga wajib Medium → High → GPT-6 Astra. Low, Xhigh dan Max bukan pilihan otomatis sampai evaluasi workload membuktikan manfaatnya. Harga API atau jumlah token mentah tidak sama dengan persentase limit langganan.

## Kesiapan dan batas operasional

Pertanyaan informasi selesai setelah CEO menyampaikan jawaban berbasis pembacaan nyata; tahap lainnya dilewati. Pekerjaan implementasi siap hanya setelah semua kriteria memiliki skenario bermakna yang lulus, semua pemeriksaan wajib lulus, browser tidak memiliki exception/request gagal tak terduga, kontrak terverifikasi, dan review QA menyatakan pass tanpa findings/issues tersisa. Hasil pass yang masih melaporkan defek wajib diteruskan untuk diagnosis. Setelah siap, temuan aktif dan antrean revisi dikosongkan; riwayatnya tetap tersedia pada laporan/log QA.

Batas token awal 300.000 token tercatat (cache yang dibaca ulang tidak dihitung) per project, dapat diatur di Koneksi kantor. Ini pagar operasional sebelum panggilan berikutnya, bukan batas keras per panggilan atau konversi kuota langganan. Melanjutkan pekerjaan yang mencapai batas menambah 50.000 token.

Batas operasional awal enam putaran perbaikan untuk mencegah loop tanpa arah; ini bukan batas kualitas atau alasan menandai hasil selesai. Pada batas tersebut status **Belum terverifikasi**, temuan tetap tersimpan, dan tombol **Lanjutkan diagnosis** menambah tiga putaran. Timeout engine/browser atau infrastruktur yang tidak tersedia juga tidak bisa menjadi siap.

Stop–lanjut saat menunggu klarifikasi menggunakan kembali pertanyaan yang belum dijawab tanpa memanggil agent lagi. Setelah restart, pekerjaan aktif ditandai dihentikan; lanjut menghapus permintaan jeda lama agar tahap berikutnya dapat berjalan. Pekerjaan tidak otomatis dilanjutkan saat server hidup kembali.

Revisi menyimpan checkpoint setelah setiap role selesai. Stop–lanjut hanya mengulang pekerjaan yang belum selesai; file laporan lama tidak boleh membuat pembaruan rencana/spek dilewati. Pembatalan CLI menunggu proses keluar dan meningkatkan penghentian ke SIGKILL bila SIGTERM diabaikan. Output dengan exit code gagal tidak diterima sebagai hasil sukses.

## Akses laptop dan project asli

UI memakai mode Akses laptop sebagai default. Tool native Codex menyediakan terminal, pembacaan/pencarian file, patch kode dan web; Chrome dimuat pada tahap yang memerlukannya. Tidak ada daftar perintah terminal atau batas path aplikasi; tool orchestration tambahan tidak dimuat karena antrean tim diatur host. Kantor menggunakan tool native Codex dengan approvalPolicy=never dan sandbox=danger-full-access pada mode Akses laptop. Agent boleh membaca/mencari/mengedit file, menjalankan terminal, memasang dependensi yang diperlukan, serta menggunakan script/CLI integrasi project sesuai tugas. Plugin tambahan dan agent tambahan dimatikan per proses; Chrome diaktifkan hanya bila dibutuhkan. Prompt ringkas per role dan pembacaan konvensi project secara eksplisit mengurangi konteks yang tidak relevan. Folder kerja menentukan cwd awal, bukan pagar filesystem; lokasi lain, file tersembunyi dan symlink mengikuti hak akun Linux. Tidak ada pemberian root otomatis. Komunikasi ke pihak lain atau publikasi tetap harus diminta dalam tugas.

Agent membaca AGENTS.md/CLAUDE.md dan konvensi project yang sebenarnya, menjaga perubahan pengguna, dan mengedit file langsung lewat tool. Output files harus kosong; changedFiles mencatat path file asli yang berubah. Laporan dan bukti disimpan terpisah di folder tugas kantor. Tidak memaksakan vanilla HTML, folder frontend/backend, database JSON, atau palet kantor ke project yang sudah ada.

Pada mode Akses laptop, QA menguji UI secara live di Chrome asli pengguna (plugin Chrome bawaan Codex, tab group sendiri) dan melaporkan bukti per kriteria; login atau langkah manual lain diminta ke pengguna lalu QA melanjutkan. Permintaan yang hanya membuka/mengecek aplikasi di browser langsung dari CEO ke QA. Setiap cacat yang ditemukan QA dianalisis sampai jelas pemiliknya, diserahkan ke engineer tersebut untuk diperbaiki, lalu diuji ulang di Chrome sampai lulus (dibatasi jumlah percobaan dan anggaran token). Engineer tidak men-deploy atau mengubah layanan produksi sendiri; bila perbaikan butuh itu, ia bertanya dulu. QA menyiapkan command server asli atau URL aplikasi yang sudah berjalan; host memulai server dengan PORT dan AGENT_TOWN_PREVIEW_PORT. Project lama dengan verifikasi headless tetap mengambil DOM live, menjalankan seluruh skenario Playwright serta memeriksa screenshot, mobile/reduced motion, exception dan request gagal. Browser context segar per kasus; data backend asli bisa bertahan dan tidak dihapus otomatis. Fixture dan cleanup melalui UI/API/test tools aplikasi menjadi tanggung jawab QA. seedData runtime sederhana tidak tersedia.

Pekerjaan non-web memakai command tes terminal yang mencakup semua kriteria, assertion nyata dan exit code bukan nol ketika gagal. Host menyimpan stdout/stderr, exit code dan bukti per skenario. Kriteria responsive/motion memerlukan browser. Tes gagal atau cakupan kosong tidak boleh menjadi Siap sekalipun model menjawab pass.

Kegagalan startup server masuk ke bukti dan review QA: defek kode dikirim ke engineer, sedangkan konfigurasi command/URL dikoreksi QA dengan tetap mempertahankan verifikasi browser. Setelah perbaikan, server dimulai ulang dan semua skenario dijalankan kembali.

Server yang dimulai kantor dihentikan setelah QA/preview ditutup; URL server yang sebelumnya berjalan hanya diakses dan tidak dimatikan. Stop menghentikan proses aktif beserta process group, tetapi tidak membatalkan perubahan file atau efek perintah yang sudah terjadi. Penelusuran/aksi native terlihat di log laptop; isi mentah tool tidak disalin otomatis ke UI.

## Runtime Project baru sederhana / Demo

Aplikasi hasil menggunakan frontend vanilla ES modules dan backend JavaScript dengan handle(), store JSON persisten, serta HTTP lokal. Runtime menjalankan backend pada proses terpisah, env minimal, pembatasan file Node, dan loader modul hanya untuk backend proyek. Ini bukan sandbox untuk kode bermusuhan. Belum menyediakan dependensi/framework arbitrary, database SQL, deploy, atau layanan eksternal; kebutuhan di luar runtime wajib diklarifikasi.

QA menggunakan data terpisah yang dihapus setelah pengujian. Preview memakai data persisten dan origin/port terpisah dari kantor. Port preview disimpan per project dan digunakan kembali saat dibuka ulang, agar localStorage tetap tersedia. Jika port lama telah dipakai proses lain, runtime memilih port baru; penyimpanan browser pada origin lama tidak otomatis dipindahkan. Patch skenario wajib mempertahankan ID dan criterionId, sehingga regresi tidak terduplikasi atau hilang. Setiap skenario mendapat store/browser segar; page sudah dimuat sebelum langkah pertama, dan semua load/goto/reload terhitung sebagai request. Cakupan endpoint mengacu pada route kontrak yang benar-benar dipilih runtime; request route statis tidak bisa dianggap menguji route parameter yang kebetulan cocok. Browser menjalankan skenario terstruktur (bukan eval kode arbitrer dari AI), menghasilkan screenshot, langkah dan laporan. Headless Chromium adalah default.
