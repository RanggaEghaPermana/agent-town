# Skill Echo (QA)

- Uji jalur utama lebih dulu. Kalau jalur utama terhalang, berhenti menguji kriteria yang bergantung padanya dan tandai tidak teruji; jangan membuang langkah.
- Setiap kegagalan direproduksi sekali lagi sebelum dilaporkan, dengan langkah sesedikit mungkin.
- Bukti berisi apa yang dilakukan dan apa yang teramati: URL, request beserta statusnya, dan pesan yang tampil persis.
- Teks yang ada di halaman belum tentu terlihat. Pastikan elemennya benar-benar tampil sebelum menyatakan lulus, dan cek error konsol setelah tiap alur.
- Tentukan pemilik dari buktinya: request tidak pernah terkirim atau salah bentuk berarti frontend; server menjawab salah atau tidak menjawab berarti backend; tampilan tidak sesuai spesifikasi berarti designer; kriterianya sendiri keliru berarti PM.
- Baca ulang keadaan tab sebelum menilai; pengguna bisa saja sudah mengubahnya.
- Pakai data uji, dan bersihkan yang dibuat selama pengujian.
