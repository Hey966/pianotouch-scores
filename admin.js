(() => {
  'use strict';
  const repo = 'Hey966/pianotouch-scores';
  const base = `https://api.github.com/repos/${repo}`;
  const branch = 'main';
  const keys = ['低','中','高'].flatMap(range => [1,'♯1',2,'♯2',3,4,'♯4',5,'♯5',6,'♯6',7].map(n => range + n));
  const $ = id => document.getElementById(id);
  let token = '';
  let catalog = null;
  let editing = null;
  let original = null;
  let events = [];
  let busy = false;

  function status(message) { $('status').textContent = message; }
  function setBusy(value) {
    busy = value;
    for (const button of document.querySelectorAll('button')) button.disabled = value;
  }
  function decodeBase64(value) {
    const binary = atob(value.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  }
  async function api(method, path, body) {
    const response = await fetch(base + path, {
      method, cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : {'Content-Type': 'application/json'})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const code = response.status;
      if (code === 401 || code === 403) throw new Error(`GitHub ${code}：請確認權杖可存取此儲存庫，且 Contents 權限為 Read and write。`);
      if (code === 409 || code === 422) throw new Error(`GitHub ${code}：檔案可能已被別處更新，請重新整理後重試。`);
      throw new Error(`GitHub ${code}：操作失敗。`);
    }
    return response.json();
  }
  async function readFile(path) {
    const response = await api('GET', `/contents/${path}?ref=${branch}`);
    if (response.type !== 'file' || typeof response.content !== 'string') throw new Error('找不到樂譜檔');
    return JSON.parse(decodeBase64(response.content));
  }
  async function loadCatalog() {
    const value = await readFile('catalog.json');
    if (value.version !== 1 || !Array.isArray(value.songs) || value.songs.length > 100) throw new Error('樂譜清單格式不支援');
    const ids = new Set();
    for (const song of value.songs) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(song.id) || !/^songs\/[a-zA-Z0-9_-]+\.pianotouch\.json$/.test(song.file) || ids.has(song.id)) throw new Error('樂譜清單包含無效項目');
      ids.add(song.id);
    }
    return value;
  }
  function renderList() {
    $('songs').replaceChildren();
    if (!catalog.songs.length) {
      const p = document.createElement('p'); p.textContent = '目前沒有線上樂譜。'; $('songs').append(p); return;
    }
    for (const song of catalog.songs) {
      const card = document.createElement('div'); card.className = 'song';
      const title = document.createElement('strong'); title.textContent = song.title;
      const info = document.createElement('p'); info.textContent = `${song.artist || '未標示作者'} · ${song.noteCount} 個音符 · ${song.bpm} BPM`;
      const edit = document.createElement('button'); edit.textContent = '編輯'; edit.addEventListener('click', () => editSong(song));
      const remove = document.createElement('button'); remove.textContent = '移除'; remove.className = 'danger'; remove.addEventListener('click', () => removeSong(song));
      card.append(title, info, edit, remove); $('songs').append(card);
    }
  }
  function addEvent(event = {key:'中1', beat:0, length:1, enabled:true, warning:''}) {
    events.push({...event}); renderEvents();
  }
  function renderEvents() {
    $('notes').replaceChildren();
    events.forEach((event, i) => {
      const row = document.createElement('div'); row.className = 'note';
      const keyLabel = document.createElement('label'); keyLabel.textContent = `音符 ${i+1} 鍵位`;
      const key = document.createElement('select');
      for (const name of keys) { const option = document.createElement('option'); option.value = name; option.textContent = name; key.append(option); }
      key.value = event.key; key.addEventListener('change', () => { event.key = key.value; }); keyLabel.append(key);
      const beatLabel = document.createElement('label'); beatLabel.textContent = '開始拍';
      const beat = document.createElement('input'); beat.type = 'number'; beat.min = '0'; beat.step = '0.01'; beat.value = event.beat; beat.addEventListener('input', () => { event.beat = Number(beat.value); }); beatLabel.append(beat);
      const lengthLabel = document.createElement('label'); lengthLabel.textContent = '長度（拍）';
      const length = document.createElement('input'); length.type = 'number'; length.min = '0.01'; length.step = '0.01'; length.value = event.length; length.addEventListener('input', () => { event.length = Number(length.value); }); lengthLabel.append(length);
      const enabledLabel = document.createElement('label'); enabledLabel.textContent = '啟用 ';
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = event.enabled !== false; enabled.addEventListener('change', () => { event.enabled = enabled.checked; }); enabledLabel.append(enabled);
      const remove = document.createElement('button'); remove.textContent = '刪除'; remove.className = 'danger'; remove.addEventListener('click', () => { events.splice(i,1); renderEvents(); });
      row.append(keyLabel, beatLabel, lengthLabel, enabledLabel, remove); $('notes').append(row);
    });
  }
  function showEditor() { $('editor').classList.remove('hidden'); $('editor').scrollIntoView({behavior:'smooth'}); }
  function clearEditor() { $('editor').classList.add('hidden'); $('importFile').value = ''; editing = null; original = null; events = []; }
  function newSong() {
    editing = null; original = null; events = [];
    $('editorHeading').textContent = '新增歌曲'; $('title').value = ''; $('artist').value = ''; $('bpm').value = '60';
    $('songId').value = `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    $('importFile').value = ''; addEvent(); showEditor();
  }
  async function editSong(song) {
    if (busy) return;
    setBusy(true); status('讀取樂譜中…');
    try {
      const file = await readFile(song.file);
      if (file.format !== 'pianotouch-score' || file.version !== 1 || !file.score || !Array.isArray(file.score.events)) throw new Error('樂譜格式不支援');
      editing = song; original = file.score; events = file.score.events.map(e => ({...e}));
      $('editorHeading').textContent = '編輯歌曲'; $('title').value = song.title; $('artist').value = song.artist || '';
      $('bpm').value = file.score.bpm; $('songId').value = song.id; $('importFile').value = '';
      renderEvents(); showEditor(); status('編輯完成後按儲存，網站與 App 清單會更新。');
    } catch (error) { status(error.message); }
    finally { setBusy(false); }
  }
  function buildSong() {
    const title = $('title').value.trim(); const artist = $('artist').value.trim(); const bpm = Number($('bpm').value);
    if (!title || title.length > 120) throw new Error('請輸入 1～120 字的歌曲名稱。');
    if (artist.length > 80) throw new Error('作者名稱不可超過 80 字。');
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) throw new Error('BPM 須為 20～300。');
    if (events.length < 1 || events.length > 5000) throw new Error('每首歌曲須有 1～5000 個音符。');
    const notes = events.map((e, i) => {
      if (!keys.includes(e.key) || !Number.isFinite(e.beat) || e.beat < 0 || !Number.isFinite(e.length) || e.length <= 0 || e.beat + e.length > bpm * 20) throw new Error(`第 ${i+1} 個音符的鍵位或時間無效。`);
      return {key:e.key, beat:e.beat, length:e.length, enabled:e.enabled !== false, warning:typeof e.warning === 'string' ? e.warning : ''};
    });
    const score = {title, bpm, reviewed:false, sourceImage:'', endBeat:Math.max(...notes.map(e => e.beat + e.length)), issues:Array.isArray(original?.issues) ? original.issues : [], events:notes};
    const content = JSON.stringify({format:'pianotouch-score', version:1, score}, null, 2) + '\n';
    if (new TextEncoder().encode(content).length > 2_000_000) throw new Error('樂譜檔超過 App 支援的 2 MB。');
    return {title, artist, bpm, noteCount:notes.length, content};
  }
  async function commitFiles(changes, message) {
    const ref = await api('GET', `/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const oldCommit = await api('GET', `/git/commits/${head}`);
    const tree = [];
    for (const change of changes) {
      if (change.content === null) tree.push({path:change.path, mode:'100644', type:'blob', sha:null});
      else {
        const blob = await api('POST', '/git/blobs', {content:change.content, encoding:'utf-8'});
        tree.push({path:change.path, mode:'100644', type:'blob', sha:blob.sha});
      }
    }
    const newTree = await api('POST', '/git/trees', {base_tree:oldCommit.tree.sha, tree});
    const commit = await api('POST', '/git/commits', {message, tree:newTree.sha, parents:[head]});
    await api('PATCH', `/git/refs/heads/${branch}`, {sha:commit.sha, force:false});
  }
  async function saveSong() {
    if (busy) return;
    let song;
    try { song = buildSong(); } catch (error) { status(error.message); return; }
    setBusy(true); status('儲存到 GitHub 中…');
    try {
      const latest = await loadCatalog();
      const id = $('songId').value;
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('歌曲 ID 無效。');
      if (editing && !latest.songs.some(s => s.id === editing.id && s.file === editing.file)) throw new Error('這首歌曲已被移動或移除，請重新整理。');
      if (!editing && latest.songs.some(s => s.id === id)) throw new Error('歌曲 ID 已存在，請重新新增。');
      const path = editing ? editing.file : `songs/${id}.pianotouch.json`;
      const entry = {id, title:song.title, artist:song.artist, bpm:song.bpm, noteCount:song.noteCount, file:path};
      const list = editing ? latest.songs.map(s => s.id === id ? entry : s) : [...latest.songs, entry];
      if (list.length > 100) throw new Error('線上樂譜庫最多 100 首歌曲。');
      await commitFiles([{path, content:song.content}, {path:'catalog.json', content:JSON.stringify({version:1, songs:list}, null, 2) + '\n'}], editing ? `Update score ${id}` : `Add score ${id}`);
      catalog = {version:1, songs:list}; clearEditor(); renderList(); status('已儲存。GitHub Pages 更新後，App 重新整理即可看到變更。');
    } catch (error) { status(error.message); }
    finally { setBusy(false); }
  }
  async function removeSong(song) {
    if (busy || !confirm(`確定從線上樂譜庫移除「${song.title}」？手機裡已下載的副本不會刪除。`)) return;
    setBusy(true); status('移除線上樂譜中…');
    try {
      const latest = await loadCatalog();
      if (!latest.songs.some(s => s.id === song.id && s.file === song.file)) throw new Error('這首歌曲已被移動或移除，請重新整理。');
      const list = latest.songs.filter(s => s.id !== song.id);
      const changes = [{path:'catalog.json', content:JSON.stringify({version:1, songs:list}, null, 2) + '\n'}];
      if (!list.some(s => s.file === song.file)) changes.push({path:song.file, content:null});
      await commitFiles(changes, `Remove score ${song.id}`);
      catalog = {version:1, songs:list}; clearEditor(); renderList(); status('已從線上樂譜庫移除。手機裡已下載的副本仍保留。');
    } catch (error) { status(error.message); }
    finally { setBusy(false); }
  }
  async function connect() {
    if (busy) return;
    token = $('token').value.trim();
    if (!token) { status('請先輸入 GitHub 權杖。'); return; }
    $('token').value = '';
    setBusy(true); status('連接 GitHub 中…');
    try { catalog = await loadCatalog(); $('loginPanel').classList.add('hidden'); $('manager').classList.remove('hidden'); renderList(); status('已連接。'); }
    catch (error) { token = ''; status(error.message); }
    finally { setBusy(false); }
  }
  function disconnect() { token = ''; catalog = null; clearEditor(); $('manager').classList.add('hidden'); $('loginPanel').classList.remove('hidden'); $('songs').replaceChildren(); status('已登出。'); }
  $('connect').addEventListener('click', connect);
  $('token').addEventListener('keydown', event => { if (event.key === 'Enter') connect(); });
  $('newSong').addEventListener('click', newSong);
  $('reload').addEventListener('click', async () => { if (busy) return; setBusy(true); status('重新整理中…'); try { catalog = await loadCatalog(); clearEditor(); renderList(); status('已更新。'); } catch (error) { status(error.message); } finally { setBusy(false); } });
  $('disconnect').addEventListener('click', disconnect);
  $('addNote').addEventListener('click', () => addEvent());
  $('save').addEventListener('click', saveSong);
  $('cancel').addEventListener('click', clearEditor);
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('檔案超過 2 MB。');
      const data = JSON.parse(await file.text());
      if (data.format !== 'pianotouch-score' || data.version !== 1 || !data.score || !Array.isArray(data.score.events)) throw new Error('不是可匯入的 PianoTouch 樂譜檔。');
      $('title').value = data.score.title || ''; $('bpm').value = data.score.bpm;
      original = data.score; events = data.score.events.map(e => ({...e})); renderEvents(); status('檔案已讀取，檢查後按儲存。');
    } catch (error) { status(error.message); }
  });
  window.addEventListener('pagehide', () => { token = ''; });
})();

