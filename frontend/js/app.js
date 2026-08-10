import { api } from './api.js';
import { Player } from './player.js';
import { shareTrackToStory } from './stories.js';
import { saveTrackOffline, isTrackOffline } from './indexeddb.js';

const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.setHeaderColor?.('#121212');
tg?.setBackgroundColor?.('#121212');

let player, favoritesSet = new Set(), searchTimer = null, currentFilter = 'track,artist,album';

async function init() {
  lucide.createIcons();
  player = new Player({ onTrackChange, onPlayPause, onProgress });
  setupNavigation();
  setupSearch();
  setupProfile();
  setupPlayerControls();
  setupModals();
  await Promise.all([loadHome(), loadUserProfile(), loadFavorites()]);
}

async function loadUserProfile() {
  try {
    const tgUser = tg?.initDataUnsafe?.user;
    if (tgUser) {
      document.getElementById('home-username').textContent = tgUser.first_name || tgUser.username || 'Привет!';
      document.getElementById('profile-name').textContent = tgUser.first_name || tgUser.username || '';
      document.getElementById('profile-username').textContent = tgUser.username ? `@${tgUser.username}` : '';
      if (tgUser.photo_url) {
        ['home-avatar','profile-avatar'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.src = tgUser.photo_url; el.classList.remove('hidden'); }
        });
      }
    }
  } catch {}
}

async function loadFavorites() {
  try {
    const favs = await api.getFavorites();
    favoritesSet = new Set(favs.map(f => f.track_id));
    const container = document.getElementById('profile-favorites');
    if (!favs.length) {
      container.innerHTML = '<p class="text-sp-muted text-sm text-center py-8">Пока нет избранных треков</p>';
      return;
    }
    container.innerHTML = favs.map(f => `
      <div class="track-card" onclick="playFav('${f.track_id}','${f.title.replace(/'/g,"&#39;")}','${f.artist.replace(/'/g,"&#39;")}','${f.cover_url||''}')">
        <img src="${f.cover_url||''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
        <div class="flex-1 min-w-0"><p class="font-medium text-sm truncate">${f.title}</p><p class="text-xs text-sp-muted truncate">${f.artist}</p></div>
        <button class="p-1.5 text-sp-muted hover:text-red-400 transition-colors" onclick="event.stopPropagation();removeFav('${f.track_id}')">
          <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
      </div>
    `).join('');
    lucide.createIcons();
  } catch {}
}

window.playFav = (id, title, artist, coverUrl) => {
  player.loadQueue([{ id, title, artist, cover_url: coverUrl }]);
  player.playTrack(0);
};

window.removeFav = async (trackId) => {
  try { await api.removeFavorite(trackId); await loadFavorites(); showToast('Удалено из избранного'); } catch {}
};

function trackCardHTML(track) {
  const liked = favoritesSet.has(track.id);
  const safeTrack = JSON.stringify(track).replace(/"/g, '&quot;');
  return `
    <div class="track-card" data-track="${safeTrack}">
      <img src="${track.cover_url||''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
      <div class="flex-1 min-w-0">
        <p class="font-medium text-sm truncate">${track.title}</p>
        <p class="text-xs text-sp-muted truncate">${track.artist}</p>
      </div>
      <button class="like-btn p-1.5 ${liked?'text-sp-accent':'text-sp-muted'}" data-track-id="${track.id}"
        onclick="event.stopPropagation();toggleFav(${safeTrack})">
        <i data-lucide="heart" class="w-5 h-5 ${liked?'fill-current':''}"></i>
      </button>
    </div>
  `;
}

window.toggleFav = async (track) => {
  if (favoritesSet.has(track.id)) {
    await api.removeFavorite(track.id); favoritesSet.delete(track.id); showToast('Убрано из избранного');
  } else {
    await api.addFavorite(track); favoritesSet.add(track.id); showToast('Добавлено в избранное');
  }
  await loadFavorites();
};

function setupProfile() {
  document.querySelectorAll('.profile-tab').forEach(tab =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`profile-${tab.dataset.ptab}`)?.classList.remove('hidden');
      if (tab.dataset.ptab === 'playlists') loadPlaylists();
    })
  );
  document.getElementById('offline-toggle').addEventListener('change', e =>
    showToast(e.target.checked ? 'Оффлайн-режим включён' : 'Оффлайн-режим выключен')
  );
}

async function loadPlaylists() {
  try {
    const playlists = await api.getPlaylists();
    const container = document.getElementById('playlists-list');
    if (!playlists.length) { container.innerHTML = '<p class="text-sp-muted text-sm text-center py-4">Нет плейлистов</p>'; return; }
    container.innerHTML = playlists.map(p => `
      <div class="track-card" onclick="openPlaylist(${p.id})">
        <img src="${p.cover_url||''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
        <div class="flex-1 min-w-0"><p class="font-medium text-sm truncate">${p.title}</p><p class="text-xs text-sp-muted">${p.tracks_count} треков</p></div>
        <i data-lucide="chevron-right" class="w-5 h-5 text-sp-muted"></i>
      </div>
    `).join('');
    lucide.createIcons();
  } catch {}
}

window.openPlaylist = async (id) => {
  try { const d = await api.getPlaylist(id); player.loadQueue(d.tracks); player.playTrack(0); showToast(`▶ ${d.title}`); } catch {}
};

window.openArtist = async (artistId) => {
  const modal = document.getElementById('artist-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
  try {
    const data = await api.getArtist(artistId);
    document.getElementById('artist-modal-img').src = data.image_url || '';
    document.getElementById('artist-modal-name').textContent = data.name;
    document.getElementById('artist-modal-followers').textContent = `${(data.followers||0).toLocaleString()} слушателей`;
    document.getElementById('artist-modal-tracks').innerHTML = data.top_tracks.slice(0, 5).map(t => trackCardHTML(t)).join('');
    document.getElementById('artist-modal-albums').innerHTML = data.albums.map(a => `
      <div class="grid-card">
        <img src="${a.cover_url||''}" class="w-full aspect-square object-cover rounded-lg mb-2" />
        <p class="text-sm font-medium truncate">${a.title}</p>
        <p class="text-xs text-sp-muted">${a.release_date?.slice(0,4)||''}</p>
      </div>
    `).join('');
    document.getElementById('artist-shuffle-all').onclick = () => {
      player.loadQueue(data.top_tracks); player.shuffle = true; player.playTrack(0);
      modal.classList.add('hidden'); modal.classList.remove('flex');
    };
    lucide.createIcons();
    modal.querySelectorAll('[data-track]').forEach(el =>
      el.addEventListener('click', () => { const t = JSON.parse(el.dataset.track); player.loadQueue([t]); player.playTrack(0); })
    );
  } catch { showToast('Ошибка загрузки артиста'); }
};

document.getElementById('artist-modal-close').addEventListener('click', () => {
  document.getElementById('artist-modal').classList.add('hidden');
  document.getElementById('artist-modal').classList.remove('flex');
});

function setupModals() {
  const importModal = document.getElementById('import-modal');
  document.getElementById('btn-import-playlist').addEventListener('click', () => importModal.classList.remove('hidden'));
  document.getElementById('import-cancel').addEventListener('click', () => importModal.classList.add('hidden'));
  document.getElementById('import-confirm').addEventListener('click', async () => {
    const url = document.getElementById('import-url-input').value.trim();
    if (!url) return;
    importModal.classList.add('hidden');
    try {
      showToast('Импортируем плейлист...');
      const data = await api.importPlaylist(url);
      showToast(`✓ Импортировано: ${data.title}`);
      await loadPlaylists();
    } catch (e) { showToast('Ошибка: ' + e.message); }
  });
}

function setupPlayerControls() {
  document.getElementById('mini-player-expand').addEventListener('click', openFullPlayer);
  document.getElementById('player-close').addEventListener('click', closeFullPlayer);
  document.getElementById('mini-play-pause').addEventListener('click', () => player.togglePlay());
  document.getElementById('ctrl-play').addEventListener('click',   () => player.togglePlay());
  document.getElementById('ctrl-prev').addEventListener('click',   () => player.prev());
  document.getElementById('ctrl-next').addEventListener('click',   () => player.next());
  document.getElementById('ctrl-shuffle').addEventListener('click', () => {
    player.shuffle = !player.shuffle;
    document.getElementById('ctrl-shuffle').classList.toggle('text-sp-accent', player.shuffle);
  });
  document.getElementById('ctrl-repeat').addEventListener('click', () => {
    player.repeat = !player.repeat;
    document.getElementById('ctrl-repeat').classList.toggle('text-sp-accent', player.repeat);
  });
  const seekBar = document.getElementById('seek-bar');
  seekBar.addEventListener('input', () => player.seek(seekBar.value));
  document.getElementById('player-lyrics-btn').addEventListener('click', () =>
    document.getElementById('flip-container').classList.toggle('flipped')
  );
  document.getElementById('player-share').addEventListener('click', () => {
    if (player.currentTrack) shareTrackToStory(player.currentTrack);
  });
  document.getElementById('player-like').addEventListener('click', () => {
    if (player.currentTrack) toggleFav(player.currentTrack);
  });
  document.getElementById('mini-like').addEventListener('click', () => {
    if (player.currentTrack) toggleFav(player.currentTrack);
  });
  document.getElementById('player-artist-btn').addEventListener('click', () => {
    const t = player.currentTrack;
    if (t?.artist_id) openArtist(t.artist_id);
  });
  document.getElementById('offline-save-btn').addEventListener('click', async () => {
    const track = player.currentTrack;
    if (!track) return;
    if (await isTrackOffline(track.id)) { showToast('Уже сохранено'); return; }
    showToast('Сохраняем оффлайн...');
    try {
      const sd = await api.stream(track.id, track.artist, track.title);
      const audioBlob = await (await fetch(sd.stream_url)).blob();
      let coverBlob = null;
      if (track.cover_url) try { coverBlob = await (await fetch(track.cover_url)).blob(); } catch {}
      await saveTrackOffline(track.id, audioBlob, coverBlob, track);
      showToast('✓ Сохранено для оффлайна');
    } catch { showToast('Ошибка сохранения'); }
  });
}

function openFullPlayer() {
  const fp = document.getElementById('fullscreen-player');
  fp.classList.remove('hidden'); fp.classList.add('flex', 'entering');
  setTimeout(() => fp.classList.remove('entering'), 400);
  document.getElementById('flip-container').classList.remove('flipped');
}

function closeFullPlayer() {
  document.getElementById('fullscreen-player').classList.add('hidden');
  document.getElementById('fullscreen-player').classList.remove('flex');
}

let parsedLyrics = [];
async function loadLyrics(track) {
  parsedLyrics = [];
  const lyricsContainer = document.getElementById('lyrics-container');
  const loading = document.getElementById('lyrics-loading');
  const empty = document.getElementById('lyrics-empty');
  lyricsContainer.innerHTML = ''; loading.classList.remove('hidden'); empty.classList.add('hidden');
  try {
    const data = await api.lyrics(track.title, track.artist);
    loading.classList.add('hidden');
    if (data.synced) {
      parsedLyrics = data.synced.split('\n').map(line => {
        const m = line.match(/^\[(\d{2}):(\d{2}\.\d+)\](.*)/);
        return m ? { time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3].trim() } : null;
      }).filter(Boolean);
      lyricsContainer.innerHTML = parsedLyrics.map((line, i) =>
        `<p class="lyric-line" data-index="${i}">${line.text || '&nbsp;'}</p>`
      ).join('');
    } else if (data.plain) {
      lyricsContainer.innerHTML = data.plain.split('\n').map(l =>
        `<p class="lyric-line text-sp-muted/60">${l||'&nbsp;'}</p>`
      ).join('');
    } else {
      empty.classList.remove('hidden');
    }
  } catch { loading.classList.add('hidden'); empty.classList.remove('hidden'); }
}

window.syncLyricsGlobal = (currentTime) => {
  if (!parsedLyrics.length) return;
  let activeIdx = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (parsedLyrics[i].time <= currentTime) activeIdx = i; else break;
  }
  if (activeIdx < 0) return;
  document.querySelectorAll('.lyric-line').forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  document.querySelector(`.lyric-line[data-index="${activeIdx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function onTrackChange(track) {
  if (!track) return;
  document.getElementById('mini-player').classList.remove('hidden');
  ['mini-cover','player-cover'].forEach(id => document.getElementById(id).src = track.cover_url||'');
  document.getElementById('mini-title').textContent = track.title;
  document.getElementById('mini-artist').textContent = track.artist;
  document.getElementById('player-title').textContent = track.title;
  document.getElementById('player-artist-btn').textContent = track.artist;
  const bg = document.getElementById('player-bg');
  if (track.cover_url) bg.style.backgroundImage = `url(${track.cover_url})`;
  const liked = favoritesSet.has(track.id);
  ['player-like','mini-like'].forEach(id => document.getElementById(id).classList.toggle('text-sp-accent', liked));
  loadLyrics(track);
  lucide.createIcons();
}

function onPlayPause(isPlaying) {
  ['play-icon','mini-play-icon'].forEach(id =>
    document.getElementById(id).setAttribute('data-lucide', isPlaying ? 'pause' : 'play')
  );
  lucide.createIcons();
}

function onProgress(current, duration) {
  const pct = duration ? (current / duration) * 100 : 0;
  document.getElementById('mini-progress').style.width = `${pct}%`;
  document.getElementById('seek-bar').value = pct;
  document.getElementById('time-current').textContent = formatTime(current);
  document.getElementById('time-total').textContent = formatTime(duration);
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}

function showToast(msg, duration = 2200) {
  const toast = document.getElementById('toast');
  const content = document.getElementById('toast-content');
  content.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

window.showToast = showToast;
init().catch(console.error);
