export const DEMO_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Catatan kecil</title>
  <style>
    * { box-sizing: border-box }
    body { margin: 0; background: #f6f2e9; color: #282e29; font: 16px/1.5 system-ui }
    main { max-width: 850px; margin: 48px auto; padding: 24px }
    h1 { font-size: 38px; margin-bottom: 8px }
    input, textarea, button { font: inherit; border: 1px solid #d1d6ca; border-radius: 8px; padding: 12px; width: 100%; margin: 6px 0 }
    textarea { min-height: 100px }
    button { background: #3b6553; color: #fff; cursor: pointer; border: 0 }
    form { margin: 28px 0 }
    .notes { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 16px }
    article { padding: 20px; background: white; border: 1px solid #e0dfd4; border-radius: 12px; overflow-wrap: anywhere }
    article p { white-space: pre-wrap }
    article button { background: #eee9df; color: #404640 }
    #empty { color: #747a70 }
    #storage-status { min-height: 1.5em; color: #8f5f35; overflow-wrap: anywhere }
  </style>
</head>
<body>
<main>
  <h1>Catatan kecil.</h1><p>Simpan ide sebelum lupa.</p>
  <form id="form">
    <label>Judul<input id="title" required maxlength="200" placeholder="Ide hari ini"></label>
    <label>Isi<textarea id="body" placeholder="Tulis di sini..."></textarea></label>
    <button>Simpan catatan</button>
  </form>
  <p id="storage-status" role="status" aria-live="polite"></p>
  <label>Cari catatan<input id="search" type="search" placeholder="Cari judul..."></label>
  <p id="empty"></p><div class="notes" id="notes"></div>
</main>
<script>
  const key = 'agent-town-demo-notes';
  const byId = id => document.getElementById(id);
  let notes = [];

  function notify(message) { byId('storage-status').textContent = message; }

  function loadNotes() {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(stored)) throw new Error('Invalid notes');
      const ids = new Set();
      notes = stored.filter(note => {
        if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) ||
            typeof note.title !== 'string' || !note.title.trim() || typeof note.body !== 'string') return false;
        ids.add(note.id); return true;
      });
      if (notes.length !== stored.length) notify('Sebagian data rusak. Catatan yang valid tetap tersedia.');
    } catch { notify('Data catatan tidak dapat dibaca. Penyimpanan mungkin dibatasi atau data rusak.'); }
  }

  function commit(nextNotes) {
    try { localStorage.setItem(key, JSON.stringify(nextNotes)); }
    catch { notify('Gagal menyimpan perubahan. Isi form dan catatan tetap ada; periksa penyimpanan lalu coba lagi.'); return false; }
    notes = nextNotes; notify('Perubahan tersimpan.'); render(); return true;
  }

  function render() {
    const query = byId('search').value.toLowerCase();
    const visible = notes.filter(note => note.title.toLowerCase().includes(query));
    byId('notes').replaceChildren();
    byId('empty').textContent = visible.length ? '' : 'Belum ada catatan yang cocok.';
    for (const note of visible) {
      const card = document.createElement('article');
      const heading = document.createElement('h2'), body = document.createElement('p'), remove = document.createElement('button');
      heading.textContent = note.title; body.textContent = note.body; remove.textContent = 'Hapus';
      remove.onclick = () => commit(notes.filter(item => item.id !== note.id));
      card.append(heading, body, remove); byId('notes').append(card);
    }
  }

  byId('form').onsubmit = event => {
    event.preventDefault();
    const title = byId('title').value.trim();
    if (!title) { notify('Judul tidak boleh kosong.'); byId('title').focus(); return; }
    const note = { id: crypto.randomUUID(), title, body: byId('body').value };
    if (commit([note, ...notes])) byId('form').reset();
  };
  byId('search').oninput = render;
  loadNotes(); render();
</script>
</body>
</html>`;
