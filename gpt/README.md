# Agent Town GPT

Kantor GPT terpisah untuk langganan ChatGPT melalui Codex app-server lokal. Login `codex login` harus memakai ChatGPT; jalur ini tidak beralih diam-diam ke API berbayar. Model dan effort yang tersedia dibaca dari katalog akun. Baseline GPT-6.1 Sol Medium, demanding memakai High untuk engineer/QA, complex dan kegagalan berulang memakai GPT-6 Astra Medium. Ini kebijakan awal yang bisa dikalibrasi dari total pemakaian, bukan klaim kombinasi paling hemat.

Slogan: **Maksimalkan hasil, minimalkan usage.**

## Menjalankan

`npm run dev` menjalankan Claude (4317), GPT (4318), dan frontend dengan switch (5178). `npm run dev:gpt` dapat menambah server GPT pada sesi dev Claude/frontend yang sudah berjalan. Setelah `npm run build`, `npm start` menjalankan gateway 4319 dan kedua kantor. `npm run start:claude` mempertahankan command server Claude lama.

Switch Claude/GPT berada di header desktop dan di bagian bawah pada layar kecil. Switch tidak menghentikan tugas yang sedang berjalan. Riwayat, hasil, pilihan folder, ukuran teks dan eksperimen cara kerja bawaan dipisahkan. Pilihan kantor terakhir disimpan di browser.

## Batas pemisahan

- `server/`, `shared/`, `skills/`, `docs/TEAM-RULES.md`, `src/App.tsx`, dan seluruh scene/CSS Claude dipertahankan tanpa perubahan. `src/main.tsx` hanya memasang wrapper switch.
- `gpt/server/`, `gpt/shared/`, dan `gpt/skills/` adalah salinan alur kantor saat penambahan GPT, dengan adapter provider baru. Penyimpanan: `.agent-town-gpt/office.sqlite` dan `gpt-projects/<id>/`.
- GPT memakai endpoint `/gpt/api/` dan WebSocket `/gpt/ws`. Proxy/gateway hanya mengantar request; tidak mencampur runner atau database.
- Tema putih, graphite, mint; lantai dan dinding panel ringan, monitor tipis, portrait pixel baru. Atlas CEO, Nova PM, Prism Designer, Pixel Frontend, Vector Backend, Echo QA. Role serta tanggung jawab tetap sama.

## Kesamaan alur

Empat jalur `answer`, `verify`, `operate`, `work`, pemilihan role, kontrak frontend/backend, konvensi/design system, clarifications, perbaikan oleh pemilik bug, regresi, checkpoint, stop/pause/continue, token budget, enam putaran perbaikan awal dan syarat Siap mengikuti kantor Claude. Enam skill per posisi dibaca ulang tiap panggilan.

QA lokal menggunakan plugin Chrome bawaan Codex (`mcp__cua_repl`) pada Chrome pengguna, dengan tab milik agent. Engineer mendapat Chrome hanya jika pekerjaannya membutuhkan situs/dashboard. Sesi per role tetap hidup selama pertanyaan/manual step atau perbaikan dengan konteks ≤60.000 token, dan dibuang jika model/effort/toolset berubah, tugas berakhir atau idle 60 menit. Browser selalu mengamati hasil terlihat, konsol, jaringan dan seluruh kriteria; verdict pass tanpa cakupan/bukti tidak menjadi Siap. Project sederhana/Demo tetap memakai Playwright dan runtime JSON yang sama.

OpenAI structured output mewakili field opsional dengan null. Schema kontrak API arbitrary dikirim sebagai string JSON dan dikembalikan menjadi objek sebelum validator kantor. Usage mencatat fresh input, output, cache read/write, durasi, revisi dan status. Cache baca dipisah dari budget; panggilan yang tidak memiliki usage ditandai tidak terukur. `npm run usage:gpt` menampilkan rincian.

## Browser QA: yang terbukti dan batasnya

QA memakai API `cua_repl` yang tersedia pada sesi Chrome, membaca dokumentasinya sebelum memakai capability, dan mengamati hasil UI setiap langkah. Locator, reload, screenshot, konsol, viewport, serta emulasi `prefers-reduced-motion` sudah diuji pada Chrome pengguna. Emulasi hanya memakai `Emulation.setEmulatedMedia`, dibuktikan melalui `matchMedia`, lalu dipulihkan. Intersepsi request serta CDP Network/Fetch/Runtime tidak digunakan. Error server diuji melalui data kontrol fixture sementara pada server lokal.

Saat Chrome melaporkan blokir kontrol, engine langsung menghentikan sesi, menampilkan alasan nyata dan mempertahankan status belum terverifikasi. Pengguna memulihkan kontrol lalu menekan Lanjutkan diagnosis; engine membuka sesi baru. Pertanyaan role lainnya tetap ditampilkan untuk jawaban pengguna, tanpa pengulangan generation otomatis. Jangan menganggap sebuah ekstensi tertentu sebagai penyebab tanpa bukti. Teks kosong berulang lebih dari 8.192 karakter menghentikan sesi agar tidak menghabiskan kuota. Batas waktu tetap berlaku untuk tahap lainnya.

Pada 4 Okt 2026, jejak beberapa tugas QA mencatat penolakan ketika memuat ulang halaman. Tugas kemudian selesai setelah pengguna melanjutkan diagnosis. Pemeriksaan kantor terbaru juga berhasil menjalankan reload pada Chrome yang sama. Jadi penolakan tidak terjadi pada setiap reload, dan keberadaan bingkai ekstensi belum membuktikan penyebabnya. Parameter `fresh=<waktu>` dapat dipakai untuk halaman awal yang perlu menghindari cache; parameter ini tidak memulihkan izin kontrol yang telah ditolak. Jika kontrol ditolak, hentikan sesi dan tunggu pemulihan pengguna sebelum melanjutkan.

Jejak ringkas browser disimpan di `gpt-projects/<id>/browser-trace.jsonl`. Pada proyek laptop, akses terminal mengikuti akun Linux pengguna. Perbedaan izin/tool antara provider tidak membuat tanggung jawab role berubah; CEO/PM/designer/QA tetap mengikuti batas peran dan QA tidak memperbaiki kode implementasi sendiri.

## Verifikasi

- `AGENT_TOWN_BROWSER=/path/to/chrome npx tsx --test --test-concurrency=1 gpt/tests/*.test.ts`: tes alur yang disalin dari baseline Claude, adapter Codex, switch kantor, API/WS, file dan preview.
- `npx tsx scripts/verify-gpt-access.ts`: uji provider nyata di project/database sementara, termasuk implementasi frontend/backend dan Chrome QA. Memakai usage langganan; tidak mengubah riwayat kantor pengguna.
- Bukti dan screenshot berada di `output/gpt-office/`.

Dokumentasi provider: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [autentikasi ChatGPT](https://learn.chatgpt.com/docs/auth).
