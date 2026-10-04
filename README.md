# Agent Town

Kantor AI lokal dengan React, TypeScript, Three.js, Node.js/Fastify, WebSocket, dan SQLite. Kantor berupa **scene 3D dengan geometri terpisah**, kamera orthographic/isometrik, material pixel, pencahayaan, dan bayangan. Susunan dan palet mengacu ke ilustrasi pengguna; model 3D merupakan rekonstruksi bergaya voxel, belum replika detail 1:1 ilustrasi.

## Menjalankan

```bash
npm install
npx playwright install chromium
npm run dev
```

Buka **http://127.0.0.1:5178**. Backend berjalan di **http://127.0.0.1:4317**. Node.js 22 atau lebih baru direkomendasikan. Login engine dengan `claude auth login`; aplikasi mendeteksi login lokal tanpa menyimpan kredensial sendiri.

Untuk menjalankan build produksi:

```bash
npm run build
npm start
```

Buka http://127.0.0.1:4317. `npm test` membangun aplikasi lalu menjalankan pengujian alur, API, UI kantor di browser sungguhan, serta adapter CLI memakai executable uji tanpa memanggil AI. File tes berjalan bergantian agar browser WebGL tidak berebut CPU saat render software. Pengujian kantor memakai database dan folder project sementara yang terpisah. Chromium harus terpasang (`npx playwright install chromium`); `AGENT_TOWN_BROWSER` dapat menunjuk executable Chromium lain.

## Fitur versi pertama

- Kantor 3D dengan lantai 22 × 17 unit (sebelumnya 16 × 12): meja kerja terpisah, jalur sirkulasi lebar, pantry, papan tugas, server, ruang meeting, tanaman, dan lounge. Furnitur dan karakter tetap pada ukuran awal. Klik karakter 3D atau kartu tim untuk membuka aktivitas laptop.
- Drag memutar kamera, klik kanan drag untuk geser, scroll untuk zoom. Tombol putar, tampilan dari atas, reset isometrik, dan layar penuh. Papan tugas 3D dapat diklik.
- Karakter memiliki kepala, lengan, dan kaki terpisah. Animasi ngetik mengikuti status kerja; dua karakter lingkungan berjalan. Tombol kopi mengumpulkan tim ke meja meeting dan mengembalikannya melalui jalur yang menghindari furnitur, tanpa memanggil AI.
- Enam role: CEO (Prelude), PM (Stanza), Designer (Lyric), Frontend (Verse), Backend (Prose), QA (Coda). Nama mengikuti keluarga Claude yang memakai bentuk karya (Opus, Sonnet, Haiku): pembuka, bait, lirik, larik, prosa, penutup.
- Tema kantor Claude mengikuti identitas Anthropic: latar ivory, teks slate, aksen clay, judul berhuruf serif, terminal gelap bergaya Claude Code, dan tiap agent memakai satu warna palet (clay, olive, fig, sky, kraft, heather). Semua aturan tema dibatasi ke kantor Claude sehingga kantor GPT tidak ikut berubah. Aturan lengkap: [docs/TEAM-RULES.md](docs/TEAM-RULES.md).
- Tugas antre, dikerjakan bergantian, dan progres dikirim langsung melalui WebSocket.
- Mode **Akses laptop** menjadi default di UI: Claude Code memakai tool native untuk membaca/mencari file, mengedit project asli, menjalankan terminal, memasang dependensi yang diperlukan, dan memakai script/CLI integrasi project yang tersedia. Pilih folder kerja lewat tombol folder atau ketik path. Folder itu tempat mulai bekerja; akses tidak dibatasi ke sana. Hak akun Linux tetap berlaku, tanpa pemberian root otomatis.
- Pertanyaan informasi seperti daftar project dijawab langsung CEO berdasarkan pembacaan filesystem. Hanya permintaan implementasi yang diteruskan ke PM, engineer dan QA.
- Mode **Project baru sederhana** dan Demo mempertahankan runtime HTML/CSS/ES modules serta backend JavaScript/store JSON terisolasi. Project yang sudah ada mengikuti framework, struktur, kontrak dan design system aslinya.
- Laporan PLAN.md, SPEC.md, DESIGN.md, FRONTEND.md, BACKEND.md, QA.md, CONTRACT.json, TEAM-RULES.md, CONVENTIONS.md dan DESIGN-SYSTEM.md. Bukti browser disimpan di qa/run-N/.
- Jeda setelah tahap aktif, lanjut, stop, klarifikasi lewat UI, perbaikan otomatis berdasarkan temuan QA, routing Sonnet/Opus dan effort eksplisit per tahap. Pada batas percobaan hasil tetap belum terverifikasi dan bisa dilanjutkan.
- File viewer dan unduh file asli yang diubah, laporan terpisah, screenshot QA, preview server aplikasi yang sebenarnya, serta riwayat/usage per tahap di SQLite. Folder kerja terakhir tersimpan di browser.
- Jawaban dan laporan Markdown ditampilkan dengan judul, paragraf, daftar, tabel serta kode yang rapi. Tombol **Baca lebar** membuka penjelasan lengkap dengan huruf 14–20px (ukuran tersimpan) dan tombol salin. File `.md` memiliki pilihan Tampilan baca/Teks asli; isi laporan dan unduhan tetap sama, tanpa memanggil agent lagi.
- Demo catatan memakai 0 token AI dan tetap diuji pada browser nyata.
- Demo mempertahankan catatan valid saat data browser rusak, serta menjaga input dan catatan ketika penyimpanan gagal agar pengguna dapat mencoba lagi.
- Preferensi reduced motion membekukan animasi ambient/ngetik dan memindahkan karakter langsung ke tujuan meeting. Kamera dan pemilihan karakter tetap berfungsi.
- Pada mode Akses laptop, QA menguji UI secara live di Chrome asli pengguna (Claude in Chrome, tab group sendiri) dan melaporkan bukti per kriteria; login atau langkah manual lain diminta ke pengguna lalu QA melanjutkan. Permintaan yang hanya membuka/mengecek aplikasi di browser langsung dari CEO ke QA. Setiap cacat yang ditemukan QA dianalisis sampai jelas pemiliknya, diserahkan ke engineer tersebut untuk diperbaiki, lalu diuji ulang di Chrome sampai lulus (dibatasi jumlah percobaan dan anggaran token). Engineer tidak men-deploy atau mengubah layanan produksi sendiri; bila perbaikan butuh itu, ia bertanya dulu.
- Pada mode Project baru sederhana, QA merencanakan skenario dari spek/kode/DOM, menjalankan Playwright, lalu meninjau hasil dan screenshot. Perubahan non-web diuji lewat perintah terminal dengan assertion dan exit code nyata. Seluruh kriteria wajib tercakup sebelum status Siap; verdict AI tidak dapat menimpa tes yang gagal.

## Batas versi ini

- Detail geometri, karakter voxel, dan tekstur prosedural belum identik per piksel dengan ilustrasi. Gambar asli dipertahankan sebagai referensi dan potret di kartu tim; bukan latar viewport kantor.
- Gerakan meeting adalah visualisasi: belum memicu percakapan AI antar-agent. Agent yang sedang bekerja tetap menuju meja kerjanya.
- Navigasi menghindari tapak furnitur; belum ada penghindaran tabrakan antar-karakter atau editor layout.
- Scene memerlukan WebGL2. Render memakai anti-aliasing dan resolusi layar hingga DPR 2, tetap konsisten saat kamera digeser. Tekstur memakai mipmap dan anisotropic filtering hingga 8× untuk mengurangi gerigi dan pola berkelip. Geometri statis digabungkan untuk mengurangi draw call.
- Pengujian browser tidak membuktikan ketiadaan semua bug; status Siap berarti kriteria dan cakupan yang dicatat telah lulus. Project lama tanpa bukti browser ditandai belum terverifikasi.
- Routing adalah baseline berbasis jenis tugas dan kegagalan, belum hasil benchmark optimasi usage khusus workload pengguna.
- Preview memakai iframe sandbox. Dalam Akses laptop, QA/preview menjalankan command server project atau membuka URL server yang sudah berjalan. Data mengikuti konfigurasi aplikasi asli dan **tidak dihapus otomatis**; QA harus menyiapkan dan membersihkan fixture melalui UI/API project. Server yang dimulai kantor dihentikan setelah QA/preview; server yang sudah berjalan tidak dimatikan. Preview memiliki batas masa hidup 20 menit dan maksimal tiga runtime; port disimpan agar localStorage bertahan saat dibuka kembali.
- Runtime store JSON dan isolasi data QA berlaku pada mode Project baru sederhana/Demo. Mode Akses laptop memakai runtime/database/dependensi project asli. Akses desktop mouse/keyboard bukan kemampuan umum yang ditambahkan; otomasi browser QA tersedia lewat Playwright, integrasi lain bergantung pada tool yang terpasang.
- Token tercatat berasal dari hasil sesi CLI; persentase sisa limit langganan tidak tersedia.
- Belum ada chat satu-agent, editor layout, rekrut karakter, atau fitur mood.
- Stop menghentikan proses CLI/terminal aktif dan mencegah tahap berikutnya. Adapter menunggu proses keluar, lalu memaksa penghentian bila SIGTERM diabaikan. Exit code gagal selalu ditolak. Edit dan efek perintah yang sudah terjadi tidak dibatalkan; jeda menyelesaikan tahap aktif dahulu.
- Setelah server restart, pekerjaan yang belum selesai ditandai dihentikan dan tidak otomatis memanggil AI lagi. Lanjut membersihkan permintaan jeda lama. Jika pertanyaan klarifikasi belum dijawab, lanjut menampilkan pertanyaan yang tersimpan tanpa panggilan agent tambahan.
- Tahap revisi yang sudah selesai tersimpan sebagai checkpoint, sehingga stop/lanjut tidak mengulang agent tersebut. Keberadaan laporan lama tidak menggantikan checkpoint ketika rencana dan spek sedang disegarkan setelah klarifikasi.

## Folder

- `src/`: UI React dan viewport Three.js; `src/scene/` berisi geometri kantor, tekstur pixel, karakter, dan navigasi.
- `server/`: engine CLI, antrean role, API, validasi file, SQLite.
- `skills/<peran>.md`: panduan per posisi yang bisa diedit; dimuat hanya untuk peran yang dipanggil.
- `scripts/usage.ts`: laporan pemakaian per tugas dan per agent (`npm run usage`, atau `npm run usage -- 20` untuk 20 tugas terakhir).
- `shared/`: tipe data dan profil agent.
- `projects/<task-id>/`: laporan/bukti tiap tugas; kode mode Project baru sederhana/Demo juga disimpan di sini. Kode mode Akses laptop diedit langsung pada folder kerja yang dipilih.
- `.agent-town/office.sqlite`: riwayat lokal (diabaikan Git).

Server hanya bind ke localhost. API dan WebSocket memerlukan Host localhost serta origin yang diizinkan; mutasi memerlukan header aplikasi. Dalam Akses laptop, Claude berjalan dengan `--dangerously-skip-permissions`, sandbox Claude dimatikan, dan cwd menunjuk project asli. Safe mode menonaktifkan pemuatan otomatis skill/plugin/hook/MCP tambahan; tool baca/cari/edit file, notebook, Bash, dan web tetap aktif. Prompt role yang ringkas menggantikan prompt umum CLI, dan konvensi project dibaca secara eksplisit supaya konteks fokus. File tersembunyi, symlink, path di luar cwd, serta terminal mengikuti hak akun yang menjalankan server. Ukuran viewer dibatasi 800KB; batas ini tidak membatasi tool filesystem Claude.

Dalam Project baru sederhana/Demo, output file tetap divalidasi backend (path traversal, konfigurasi tersembunyi, symlink dan jenis file dibatasi). Backend hasil berjalan pada child process dengan env minimal, pembatasan filesystem Node dan VM loader; ini bukan sandbox keamanan untuk kode bermusuhan. `node --check` memeriksa sintaks sebelum runtime, dan browser dibatasi ke origin project. Laporan kantor tetap memakai penyimpanan yang divalidasi pada kedua mode.

`AGENT_TOWN_WORKSPACE` bisa mengatur lokasi folder hasil. `PORT` bisa mengubah port produksi/backend; untuk development sesuaikan proxy Vite jika port backend berubah.

Uji provider nyata (memakai token) dapat dijalankan secara eksplisit dengan `npx tsx scripts/verify-local-access.ts`; uji ini membuat project sementara dan membersihkannya setelah selesai. Bukti pemeriksaan terbaru: [output/LOCAL-ACCESS-VERIFICATION.md](output/LOCAL-ACCESS-VERIFICATION.md).

## Lisensi

[MIT](LICENSE). Project ini tidak berafiliasi dengan Anthropic maupun OpenAI. Claude, Claude Code, ChatGPT, dan Codex adalah merek dagang pemiliknya masing-masing; tema dan tanda visual kedua kantor adalah ilustrasi buatan sendiri, bukan logo resmi.
