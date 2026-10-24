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
  let scoreFile = null;
  let importedFile = false;
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
        ...(body === undefined ? {} : {'Content-Type': 'application/json'})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      const code = response.status;
      const result = await response.json().catch(() => ({}));
      const detail = typeof result.message === 'string' ? result.message.slice(0, 240) : '未提供原因';
      const operation = `${method} ${path.split('?')[0]}`;
      if (code === 401 || code === 403) throw new Error(`GitHub ${code}（${operation}）：${detail}。請檢查權杖是否選了 Hey966/pianotouch-scores，且 Contents 為 Read and write。`);
      if (code === 409 || code === 422) throw new Error(`GitHub ${code}（${operation}）：${detail}。請重新整理後重試。`);
      throw new Error(`GitHub ${code}（${operation}）：${detail}`);
    }
    return response.json();
  }
  async function readFile(path) {
    const response = await api('GET', `/contents/${path}?ref=${branch}`);
    if (response.type !== 'file') throw new Error('找不到樂譜檔');
    const blob = response.content ? response : await api('GET', `/git/blobs/${response.sha}`);
    if (blob.encoding !== 'base64' || !blob.content) throw new Error('無法讀取樂譜檔');
    return JSON.parse(decodeBase64(blob.content));
  }
  async function loadCatalog() {
    const value = await readFile('catalog.json');
    if (value.version !== 1 || !Array.isArray(value.songs) || value.songs.length > 100) throw new Error('樂譜清單格式不支援');
    const ids = new Set();
    for (const song of value.songs) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(song.id) || !/^songs\/[a-zA-Z0-9_-]+\.pianotouch\.json$/.test(song.file) || ids.has(song.id)) throw new Error('樂譜清單包含無效項目');
      ids.add(song.id);
    }
    value.albums = value.albums ?? [];
    if (!Array.isArray(value.albums) || value.albums.length > 100) throw new Error('專輯清單格式不支援');
    const albumIds = new Set();
    for (const album of value.albums) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(album.id) || typeof album.name !== 'string' || !album.name.trim() || album.name.length > 120 || typeof album.artist !== 'string' || album.artist.length > 80 || albumIds.has(album.id)) throw new Error('專輯清單包含無效項目');
      albumIds.add(album.id);
    }
    return value;
  }
  function renderAlbumOptions() {
    const albums = catalog?.albums || [];
    $('albumNames').replaceChildren(); $('albumArtists').replaceChildren();
    $('existingAlbum').replaceChildren();
    const fresh = document.createElement('option'); fresh.value = ''; fresh.textContent = '建立新專輯'; $('existingAlbum').append(fresh);
    for (const album of albums) {
      const option = document.createElement('option'); option.value = album.id;
      option.textContent = `${album.name} · ${album.artist}`; $('existingAlbum').append(option);
    }
    for (const name of [...new Set(albums.map(a => a.name))].sort()) {
      const option = document.createElement('option'); option.value = name; $('albumNames').append(option);
    }
    const artists = [...new Set([...albums.map(a => a.artist), ...(catalog?.songs || []).map(s => s.artist)].filter(Boolean))].sort();
    for (const artist of artists) {
      const option = document.createElement('option'); option.value = artist; $('albumArtists').append(option);
    }
  }
  function toggleAlbumFields() { $('albumFields').classList.toggle('hidden', $('category').value !== 'album'); }
  function renderList() {
    $('songs').replaceChildren();
    if (!catalog.songs.length) {
      const p = document.createElement('p'); p.textContent = '目前沒有線上樂譜。'; $('songs').append(p); return;
    }
    for (const song of catalog.songs) {
      const card = document.createElement('div'); card.className = 'song';
      const title = document.createElement('strong'); title.textContent = song.title;
      const album = catalog.albums.find(a => a.id === song.albumId);
      const info = document.createElement('p'); info.textContent = `${album ? '專輯：' + album.name : '單曲'} · ${song.artist || '未標示作者'} · ${song.noteCount} 個音符 · ${song.bpm} BPM`;
      const edit = document.createElement('button'); edit.textContent = '編輯'; edit.addEventListener('click', () => editSong(song));
      const remove = document.createElement('button'); remove.textContent = '移除'; remove.className = 'danger'; remove.addEventListener('click', () => removeSong(song));
      card.append(title, info, edit, remove); $('songs').append(card);
    }
  }
  function showEditor() { $('editor').classList.remove('hidden'); $('editor').scrollIntoView({behavior:'smooth'}); }
  function clearEditor() { $('editor').classList.add('hidden'); $('importFile').value = ''; editing = null; scoreFile = null; importedFile = false; }
  function newSong() {
    editing = null; scoreFile = null; importedFile = false;
    $('editorHeading').textContent = '新增歌曲';
    $('editorHint').textContent = '選擇 PianoTouch 樂譜 JSON，確認歌曲名稱與作者後即可上傳。';
    $('fileLabel').textContent = '選擇樂譜 JSON（必填）'; $('save').textContent = '上傳歌曲';
    $('category').value = 'single'; $('albumName').value = ''; $('albumArtist').value = '';
    renderAlbumOptions(); $('existingAlbum').value = ''; toggleAlbumFields();
    $('title').value = ''; $('artist').value = '';
    $('songId').value = `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    $('importFile').value = ''; showEditor();
  }
  async function editSong(song) {
    if (busy) return;
    setBusy(true); status('讀取樂譜中…');
    try {
      const file = await readFile(song.file);
      validateScoreFile(file);
      editing = song; scoreFile = file; importedFile = false;
      $('editorHeading').textContent = '編輯歌曲';
      $('editorHint').textContent = '可修改歌曲名稱、作者與分類；要更換音符，請選新的樂譜 JSON。';
      $('fileLabel').textContent = '替換樂譜 JSON（可選）'; $('save').textContent = '儲存變更';
      const album = catalog.albums.find(a => a.id === song.albumId);
      $('category').value = album ? 'album' : 'single';
      $('albumName').value = album?.name || ''; $('albumArtist').value = album?.artist || '';
      renderAlbumOptions(); $('existingAlbum').value = album?.id || ''; toggleAlbumFields();
      $('title').value = song.title; $('artist').value = song.artist || '';
      $('songId').value = song.id; $('importFile').value = '';
      showEditor(); status('修改資料後按儲存；音符內容仍由 JSON 檔決定。');
    } catch (error) { status(error.message); }
    finally { setBusy(false); }
  }
  function validateScoreFile(file) {
    if (file?.format !== 'pianotouch-score' || file.version !== 1 || !file.score || !Array.isArray(file.score.events)) throw new Error('不是可匯入的 PianoTouch 樂譜檔。');
    const score = file.score;
    const bpm = Number(score.bpm);
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) throw new Error('JSON 裡的 BPM 須為 20～300。');
    if (score.events.length < 1 || score.events.length > 5000) throw new Error('JSON 須包含 1～5000 個音符。');
    score.events.forEach((event, i) => {
      const beat = Number(event.beat), length = Number(event.length);
      if (!keys.includes(event.key) || !Number.isFinite(beat) || beat < 0 || !Number.isFinite(length) || length <= 0 || beat + length > bpm * 20) throw new Error(`JSON 第 ${i+1} 個音符的鍵位或時間無效。`);
    });
    return bpm;
  }
  function buildSong() {
    if (!scoreFile) throw new Error('請先選擇 PianoTouch 樂譜 JSON 檔。');
    const title = $('title').value.trim(), artist = $('artist').value.trim();
    if (!title || title.length > 120) throw new Error('請輸入 1～120 字的歌曲名稱。');
    if (artist.length > 80) throw new Error('作者名稱不可超過 80 字。');
    const isAlbum = $('category').value === 'album';
    const albumName = $('albumName').value.trim(), albumArtist = $('albumArtist').value.trim();
    if (isAlbum && (!albumName || albumName.length > 120 || !albumArtist || albumArtist.length > 80)) throw new Error('請填寫專輯名稱與專輯演唱者／作者。');
    const bpm = validateScoreFile(scoreFile);
    const score = {...scoreFile.score, title, bpm, reviewed:false, sourceImage:''};
    const content = JSON.stringify({...scoreFile, score}, null, 2) + '\n';
    if (new TextEncoder().encode(content).length > 2_000_000) throw new Error('樂譜檔超過 App 支援的 2 MB。');
    return {title, artist, bpm, noteCount:score.events.length, content, albumMeta:isAlbum ? {name:albumName, artist:albumArtist} : null};
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
    try {
      if (!editing && !importedFile) throw new Error('請先選擇 PianoTouch 樂譜 JSON 檔。');
      song = buildSong();
    } catch (error) { status(error.message); return; }
    setBusy(true); status('儲存到 GitHub 中…');
    try {
      const latest = await loadCatalog();
      const id = $('songId').value;
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('歌曲 ID 無效。');
      if (editing && !latest.songs.some(s => s.id === editing.id && s.file === editing.file)) throw new Error('這首歌曲已被移動或移除，請重新整理。');
      if (!editing && latest.songs.some(s => s.id === id)) throw new Error('歌曲 ID 已存在，請重新新增。');
      const path = editing ? editing.file : `songs/${id}.pianotouch.json`;
      const albums = [...latest.albums];
      let albumId = null;
      if (song.albumMeta) {
        let album = albums.find(a => a.name.toLocaleLowerCase() === song.albumMeta.name.toLocaleLowerCase() && a.artist.toLocaleLowerCase() === song.albumMeta.artist.toLocaleLowerCase());
        if (!album) {
          if (albums.length >= 100) throw new Error('最多可建立 100 個專輯。');
          album = {id:`album-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`, ...song.albumMeta};
          albums.push(album);
        }
        albumId = album.id;
      }
      const entry = {id, title:song.title, artist:song.artist, bpm:song.bpm, noteCount:song.noteCount, file:path, ...(albumId ? {albumId} : {})};
      const list = editing ? latest.songs.map(s => s.id === id ? entry : s) : [...latest.songs, entry];
      if (list.length > 100) throw new Error('線上樂譜庫最多 100 首歌曲。');
      const changes = [];
      if (!editing || importedFile || scoreFile.score.title !== song.title) changes.push({path, content:song.content});
      changes.push({path:'catalog.json', content:JSON.stringify({version:1, albums, songs:list}, null, 2) + '\n'});
      await commitFiles(changes, editing ? `Update score ${id}` : `Add score ${id}`);
      catalog = {version:1, albums, songs:list}; clearEditor(); renderList(); status('已儲存。GitHub Pages 更新後，App 重新整理即可看到變更。');
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
      const changes = [{path:'catalog.json', content:JSON.stringify({version:1, albums:latest.albums, songs:list}, null, 2) + '\n'}];
      if (!list.some(s => s.file === song.file)) changes.push({path:song.file, content:null});
      await commitFiles(changes, `Remove score ${song.id}`);
      catalog = {version:1, albums:latest.albums, songs:list}; clearEditor(); renderList(); status('已從線上樂譜庫移除。手機裡已下載的副本仍保留。');
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
  $('category').addEventListener('change', toggleAlbumFields);
  $('existingAlbum').addEventListener('change', () => {
    const album = (catalog?.albums || []).find(a => a.id === $('existingAlbum').value);
    $('albumName').value = album?.name || ''; $('albumArtist').value = album?.artist || '';
    if (album && !$('artist').value.trim()) $('artist').value = album.artist;
  });
  $('albumName').addEventListener('input', () => {
    const matches = (catalog?.albums || []).filter(a => a.name.toLocaleLowerCase() === $('albumName').value.trim().toLocaleLowerCase());
    $('existingAlbum').value = matches.length === 1 ? matches[0].id : '';
    if (matches.length === 1) {
      $('albumArtist').value = matches[0].artist;
      if (!$('artist').value.trim()) $('artist').value = matches[0].artist;
    }
  });
  $('albumArtist').addEventListener('input', () => {
    const album = (catalog?.albums || []).find(a => a.id === $('existingAlbum').value);
    if (album && album.artist !== $('albumArtist').value.trim()) $('existingAlbum').value = '';
  });
  $('reload').addEventListener('click', async () => { if (busy) return; setBusy(true); status('重新整理中…'); try { catalog = await loadCatalog(); clearEditor(); renderList(); status('已更新。'); } catch (error) { status(error.message); } finally { setBusy(false); } });
  $('disconnect').addEventListener('click', disconnect);
  $('save').addEventListener('click', saveSong);
  $('cancel').addEventListener('click', clearEditor);
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    importedFile = false;
    try {
      if (file.size > 2_000_000) throw new Error('檔案超過 2 MB。');
      const data = JSON.parse(await file.text());
      validateScoreFile(data);
      $('title').value = data.score.title || '';
      scoreFile = data; importedFile = true;
      status(editing ? '檔案已讀取，檢查內容後按儲存變更。' : '檔案已讀取，確認歌曲名稱與作者後按上傳。');
    } catch (error) { $('importFile').value = ''; status(error.message); }
  });
  window.addEventListener('pagehide', () => { token = ''; });
})();

