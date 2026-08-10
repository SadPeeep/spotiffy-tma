import { api } from './api.js';
import { Player, initSpotifySDK } from './player.js';
import { shareTrackToStory } from './stories.js';
import { saveTrackOffline, isTrackOffline } from './indexeddb.js';

const tg = window.Telegram?.WebApp;
tg?.expand();
tg?.setHeaderColor?.('#121212');
tg?.setBackgroundColor?.('#121212');

let player, favoritesSet = new Set(), searchTimer = null, currentFilter = 'track,artist,album';
let spotifyConnected = false;

async function init() {
  lucide.createIcons();
  player = new Player({ onTrackChange, onPlayPause, onProgress });
  setupNavigation();
  setupSearch();
  setupProfile();
  setupPlayerControls();
  setupModals();
  await Promise.all([
    loadHome(),
    loadUserProfile(),
    loadFavorites(),
    initSpotifyConnection(),
  ]);
}

// ================================================================
// SPOTIFY CONNECTION
// ================================================================
async function initSpotifyConnection() {
  // 1. Сначала пробуем серверный токен (твой Premium аккаунт работает для всех)
  try {
    const appData = await api.getAppToken();
    if (appData.access_token) {
      showSpotifyBadge(true);
      try {
        const sdkOk = await initSpotifySDK(appData.access_token);
        if (sdkOk) {
          console.log('\u2705 Using server Spotify token — Premium for all users');
          return; // всё ок, юзерский токен не нужен
        }
      } catch (e) {
        console.error('SDK init with server token failed:', e);
      }
    }
  } catch {
    // серверный токен не настроен или ошибка — fallback на юзерский
  }

  // 2. Fallback: собственный токен юзера (если подключил свой Spotify)
  try {
    const data = await api.getSpotifyToken();
    if (data.connected && data.access_token) {
      spotifyConnected = true;
      showSpotifyBadge(true);
      try {
        await initSpotifySDK(data.access_token);
        showToast('\u2705 Spotify Premium \u0430\u043a\u0442\u0438\u0432\u0435\u043d');
      } catch (e) {
        console.error('SDK init failed:', e);
      }
    } else {
      showSpotifyBadge(false);
    }
  } catch {
    showSpotifyBadge(false);
  }
}

function showSpotifyBadge(connected) {
  const banner = document.getElementById('spotify-connect-banner');
  const badge  = document.getElementById('spotify-connected-badge');
  if (connected) {
    banner?.classList.add('hidden');
    badge?.classList.remove('hidden');
  } else {
    banner?.classList.remove('hidden');
    badge?.classList.add('hidden');
  }
}

async function connectSpotify() {
  try {
    showToast('\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u043c Spotify...');
    const data = await api.getSpotifyLoginUrl();
    if (data.auth_url) {
      tg?.openLink(data.auth_url);
      showToast('\u0410\u0432\u0442\u043e\u0440\u0438\u0437\u0443\u0439\u0441\u044f \u0438 \u0432\u0435\u0440\u043d\u0438\u0441\u044c \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435', 5000);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 20) { clearInterval(poll); return; }
        try {
          const t = await api.getSpotifyToken();
          if (t.connected && t.access_token) {
            clearInterval(poll);
            spotifyConnected = true;
            showSpotifyBadge(true);
            await initSpotifySDK(t.access_token);
            showToast('\u2705 Spotify \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d! \u041c\u043e\u0436\u043d\u043e \u0441\u043b\u0443\u0448\u0430\u0442\u044c.');
          }
        } catch {}
      }, 3000);
    }
  } catch (e) {
    showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message);
  }
}

// ================================================================
// NAVIGATION
// ================================================================
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    })
  );

  document.getElementById('btn-my-wave')?.addEventListener('click', async () => {
    try {
      showToast('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u041c\u043e\u044e \u0412\u043e\u043b\u043d\u0443...');
      const data = await api.myWave();
      if (data.tracks?.length) {
        player.loadQueue(data.tracks);
        player.playTrack(0);
      } else {
        showToast('\u041d\u0435\u0442 \u0442\u0440\u0435\u043a\u043e\u0432 \u0432 \u041c\u043e\u0435\u0439 \u0412\u043e\u043b\u043d\u0435');
      }
    } catch (e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message); }
  });
}

// ================================================================
// HOME
// ================================================================
async function loadHome() {
  try {
    const data = await api.home();

    const releasesEl = document.getElementById('new-releases');
    if (data.new_releases?.length) {
      releasesEl.innerHTML = data.new_releases.map(a => `
        <div class="flex-shrink-0 w-36 cursor-pointer" onclick="window.openAlbumSearch('${esc(a.artist)}')">
          <img src="${a.cover_url || ''}" class="w-36 h-36 rounded-xl object-cover mb-2"
            loading="lazy" onerror="this.src=''" />
          <p class="text-sm font-medium truncate">${a.title}</p>
          <p class="text-xs text-sp-muted truncate">${a.artist}</p>
        </div>
      `).join('');
    } else {
      releasesEl.innerHTML = '<p class="text-sp-muted text-sm py-4">\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445</p>';
    }

    const featuredEl = document.getElementById('featured-playlists');
    if (data.featured_playlists?.length) {
      featuredEl.innerHTML = data.featured_playlists.map(p => `
        <div class="bg-sp-surface rounded-xl overflow-hidden cursor-pointer"
          onclick="window.openSpotifyPlaylist('${p.id}','${esc(p.title)}')">
          <img src="${p.cover_url || ''}" class="w-full aspect-square object-cover"
            loading="lazy" onerror="this.src=''" />
          <div class="p-2">
            <p class="text-sm font-medium truncate">${p.title}</p>
            <p class="text-xs text-sp-muted truncate">${(p.description || '').slice(0, 40)}</p>
          </div>
        </div>
      `).join('');
    } else {
      featuredEl.innerHTML = '<p class="text-sp-muted text-sm col-span-2 py-4">\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445</p>';
    }
  } catch (e) {
    console.error('loadHome error:', e);
  }
}

function esc(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

window.openAlbumSearch = async (artist) => {
  try {
    const data = await api.search(artist, 'track');
    if (data.tracks?.length) { player.loadQueue(data.tracks); player.playTrack(0); }
  } catch {}
};

window.openSpotifyPlaylist = async (playlistId) => {
  try {
    showToast('\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c...');
    const url = 'https://open.spotify.com/playlist/' + playlistId;
    const data = await api.importPlaylist(url);
    if (data.tracks?.length) { player.loadQueue(data.tracks); player.playTrack(0); }
  } catch { showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438'); }
};

// ================================================================
// SEARCH
// ================================================================
function setupSearch() {
  const input = document.getElementById('search-input');
  const genreGrid = document.getElementById('genre-grid');

  const genres = [
    { name: '\u041f\u043e\u043f',             color: '#e91e8c', q: 'pop' },
    { name: '\u0420\u044d\u043f',             color: '#1e3264', q: 'hip-hop' },
    { name: '\u0420\u043e\u043a',             color: '#e13300', q: 'rock' },
    { name: '\u042d\u043b\u0435\u043a\u0442\u0440\u043e', color: '#8d67ab', q: 'electronic' },
    { name: 'K-Pop',            color: '#148a08', q: 'k-pop' },
    { name: '\u0414\u0436\u0430\u0437',             color: '#477d95', q: 'jazz' },
  ];

  genreGrid.innerHTML = genres.map(g =>
    `<div class="genre-chip text-white rounded-xl font-bold text-base p-6"
      style="background:${g.color}"
      onclick="window.searchGenre('${g.q}','${g.name}')">${g.name}</div>`
  ).join('');

  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      const q = input.value.trim();
      if (q) doSearch(q);
    })
  );

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) {
      document.getElementById('search-results').innerHTML = '';
      genreGrid.classList.remove('hidden');
      return;
    }
    genreGrid.classList.add('hidden');
    searchTimer = setTimeout(() => doSearch(q), 450);
  });
}

window.searchGenre = async (q, name) => {
  document.getElementById('search-input').value = name;
  document.getElementById('genre-grid').classList.add('hidden');
  await doSearch(q);
};

async function doSearch(q) {
  const container = document.getElementById('search-results');
  container.innerHTML = '<div class="flex justify-center py-8"><div class="loading-spinner"></div></div>';
  try {
    const data = await api.search(q, currentFilter);
    let html = '';

    if (data.tracks?.length) {
      html += `<p class="text-xs text-sp-muted font-bold tracking-widest mb-2 mt-3">\u0422\u0420\u0415\u041a\u0418</p>`;
      html += data.tracks.map(t => trackCardHTML(t)).join('');
    }
    if (data.artists?.length) {
      html += `<p class="text-xs text-sp-muted font-bold tracking-widest mb-2 mt-4">\u0410\u0420\u0422\u0418\u0421\u0422\u042b</p>`;
      html += data.artists.map(a => `
        <div class="track-card" onclick="window.openArtist('${a.id}')">
          <img src="${a.image_url || ''}" class="w-12 h-12 rounded-full object-cover flex-shrink-0" loading="lazy" />
          <div class="flex-1 min-w-0">
            <p class="font-medium text-sm truncate">${a.name}</p>
            <p class="text-xs text-sp-muted">${(a.followers || 0).toLocaleString()} \u0441\u043b\u0443\u0448\u0430\u0442\u0435\u043b\u0435\u0439</p>
          </div>
          <i data-lucide="chevron-right" class="w-5 h-5 text-sp-muted"></i>
        </div>
      `).join('');
    }
    if (data.albums?.length) {
      html += `<p class="text-xs text-sp-muted font-bold tracking-widest mb-2 mt-4">\u0410\u041b\u042c\u0411\u041e\u041c\u042b</p>`;
      html += '<div class="grid grid-cols-2 gap-3">' +
        data.albums.map(a => `
          <div class="bg-sp-surface rounded-xl overflow-hidden">
            <img src="${a.cover_url || ''}" class="w-full aspect-square object-cover" loading="lazy" />
            <div class="p-2">
              <p class="text-sm font-medium truncate">${a.title}</p>
              <p class="text-xs text-sp-muted truncate">${a.artist}</p>
            </div>
          </div>
        `).join('') + '</div>';
    }
    if (!html) html = '<p class="text-sp-muted text-sm text-center py-8">\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e</p>';
    container.innerHTML = html;

    container.querySelectorAll('[data-track]').forEach(el =>
      el.addEventListener('click', () => {
        try { const t = JSON.parse(el.dataset.track); player.loadQueue([t]); player.playTrack(0); } catch {}
      })
    );
    lucide.createIcons();
  } catch (e) {
    container.innerHTML = `<p class="text-sp-muted text-sm text-center py-8">\u041e\u0448\u0438\u0431\u043a\u0430: ${e.message}</p>`;
  }
}

// ================================================================
// USER PROFILE
// ================================================================
async function loadUserProfile() {
  try {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return;

    document.getElementById('profile-name').textContent =
      tgUser.first_name || tgUser.username || '';
    document.getElementById('profile-username').textContent =
      tgUser.username ? `@${tgUser.username}` : '';

    if (tgUser.photo_url) {
      const profileAvatar = document.getElementById('profile-avatar');
      if (profileAvatar) {
        profileAvatar.src = tgUser.photo_url;
        profileAvatar.classList.remove('hidden');
      }
      document.getElementById('profile-avatar-placeholder')?.classList.add('hidden');

      const navAvatar = document.getElementById('nav-avatar');
      const navIcon   = document.getElementById('nav-profile-icon');
      if (navAvatar) { navAvatar.src = tgUser.photo_url; navAvatar.classList.remove('hidden'); }
      if (navIcon)   { navIcon.classList.add('hidden'); }
    }
  } catch {}
}

async function loadFavorites() {
  try {
    const favs = await api.getFavorites();
    favoritesSet = new Set(favs.map(f => f.track_id));
    const container = document.getElementById('profile-favorites');
    if (!favs.length) {
      container.innerHTML =
        '<p class="text-sp-muted text-sm text-center py-8">\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u0442\u0440\u0435\u043a\u043e\u0432</p>';
      return;
    }
    container.innerHTML = favs.map(f => `
      <div class="track-card"
        onclick="window.playFav('${f.track_id}','${esc(f.title)}','${esc(f.artist)}','${f.cover_url || ''}')">
        <img src="${f.cover_url || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
        <div class="flex-1 min-w-0">
          <p class="font-medium text-sm truncate">${f.title}</p>
          <p class="text-xs text-sp-muted truncate">${f.artist}</p>
        </div>
        <button class="p-1.5 text-sp-muted"
          onclick="event.stopPropagation();window.removeFav('${f.track_id}')">
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
  try {
    await api.removeFavorite(trackId);
    await loadFavorites();
    showToast('\u0423\u0434\u0430\u043b\u0435\u043d\u043e \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e');
  } catch {}
};

const _trackCache = {};

function trackCardHTML(track) {
  _trackCache[track.id] = track;
  const liked = favoritesSet.has(track.id);
  const safeTrack = JSON.stringify(track).replace(/"/g, '&quot;');
  return `
    <div class="track-card" data-track="${safeTrack}">
      <img src="${track.cover_url || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" loading="lazy" />
      <div class="flex-1 min-w-0">
        <p class="font-medium text-sm truncate">${track.title}</p>
        <p class="text-xs text-sp-muted truncate">${track.artist}</p>
      </div>
      <button class="like-btn p-1.5 ${liked ? 'text-sp-accent' : 'text-sp-muted'}"
        data-tid="${track.id}"
        onclick="event.stopPropagation();window._toggleFavById('${track.id}')">
        <i data-lucide="heart" class="w-5 h-5 ${liked ? 'fill-current' : ''}"></i>
      </button>
    </div>
  `;
}

window._toggleFavById = async (id) => {
  const track = _trackCache[id];
  if (track) await window.toggleFav(track);
};

window.toggleFav = async (track) => {
  _trackCache[track.id] = track;
  try {
    if (favoritesSet.has(track.id)) {
      await api.removeFavorite(track.id);
      favoritesSet.delete(track.id);
      showToast('\u0423\u0431\u0440\u0430\u043d\u043e \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e');
    } else {
      await api.addFavorite(track);
      favoritesSet.add(track.id);
      showToast('\u2764\uFE0F \u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435');
    }
    document.querySelectorAll(`.like-btn[data-tid="${track.id}"]`).forEach(btn => {
      const isLiked = favoritesSet.has(track.id);
      btn.classList.toggle('text-sp-accent', isLiked);
      btn.classList.toggle('text-sp-muted', !isLiked);
      const icon = btn.querySelector('i');
      if (icon) icon.classList.toggle('fill-current', isLiked);
    });
    await loadFavorites();
  } catch {}
};

// ================================================================
// PROFILE TABS
// ================================================================
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
    showToast(e.target.checked
      ? '\u2713 \u041e\u0444\u0444\u043b\u0430\u0439\u043d-\u0440\u0435\u0436\u0438\u043c \u0432\u043a\u043b\u044e\u0447\u0451\u043d'
      : '\u041e\u0444\u0444\u043b\u0430\u0439\u043d-\u0440\u0435\u0436\u0438\u043c \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d')
  );
  document.getElementById('btn-connect-spotify')?.addEventListener('click', connectSpotify);
}

async function loadPlaylists() {
  try {
    const playlists = await api.getPlaylists();
    const container = document.getElementById('playlists-list');
    if (!playlists.length) {
      container.innerHTML =
        '<p class="text-sp-muted text-sm text-center py-4">\u041d\u0435\u0442 \u043f\u043b\u0435\u0439\u043b\u0438\u0441\u0442\u043e\u0432</p>';
      return;
    }
    container.innerHTML = playlists.map(p => `
      <div class="track-card" onclick="window.openPlaylist(${p.id})">
        <img src="${p.cover_url || ''}" class="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <p class="font-medium text-sm truncate">${p.title}</p>
          <p class="text-xs text-sp-muted">${p.tracks_count} \u0442\u0440\u0435\u043a\u043e\u0432</p>
        </div>
        <i data-lucide="chevron-right" class="w-5 h-5 text-sp-muted"></i>
      </div>
    `).join('');
    lucide.createIcons();
  } catch {}
}

window.openPlaylist = async (id) => {
  try {
    const d = await api.getPlaylist(id);
    player.loadQueue(d.tracks);
    player.playTrack(0);
    showToast(`\u25B6 ${d.title}`);
  } catch {}
};

window.openArtist = async (artistId) => {
  const modal = document.getElementById('artist-modal');
  modal.classList.remove('hidden'); modal.classList.add('flex');
  try {
    const data = await api.getArtist(artistId);
    document.getElementById('artist-modal-img').src = data.image_url || '';
    document.getElementById('artist-modal-name').textContent = data.name;
    document.getElementById('artist-modal-followers').textContent =
      `${(data.followers || 0).toLocaleString()} \u0441\u043b\u0443\u0448\u0430\u0442\u0435\u043b\u0435\u0439`;
    document.getElementById('artist-modal-tracks').innerHTML =
      data.top_tracks.slice(0, 5).map(t => trackCardHTML(t)).join('');
    document.getElementById('artist-modal-albums').innerHTML = data.albums.map(a => `
      <div>
        <img src="${a.cover_url || ''}" class="w-full aspect-square object-cover rounded-lg mb-2" />
        <p class="text-sm font-medium truncate">${a.title}</p>
        <p class="text-xs text-sp-muted">${(a.release_date || '').slice(0, 4)}</p>
      </div>
    `).join('');
    document.getElementById('artist-shuffle-all').onclick = () => {
      player.loadQueue(data.top_tracks); player.shuffle = true; player.playTrack(0);
      modal.classList.add('hidden'); modal.classList.remove('flex');
    };
    lucide.createIcons();
    modal.querySelectorAll('[data-track]').forEach(el =>
      el.addEventListener('click', () => {
        try { const t = JSON.parse(el.dataset.track); player.loadQueue([t]); player.playTrack(0); } catch {}
      })
    );
  } catch { showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0430\u0440\u0442\u0438\u0441\u0442\u0430'); }
};

document.getElementById('artist-modal-close').addEventListener('click', () => {
  document.getElementById('artist-modal').classList.add('hidden');
  document.getElementById('artist-modal').classList.remove('flex');
});

// ================================================================
// MODALS
// ================================================================
function setupModals() {
  const importModal = document.getElementById('import-modal');
  document.getElementById('btn-import-playlist')
    .addEventListener('click', () => importModal.classList.remove('hidden'));
  document.getElementById('import-cancel')
    .addEventListener('click', () => importModal.classList.add('hidden'));
  document.getElementById('import-confirm').addEventListener('click', async () => {
    const url = document.getElementById('import-url-input').value.trim();
    if (!url) return;
    importModal.classList.add('hidden');
    try {
      showToast('\u0418\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u0443\u0435\u043c...');
      const data = await api.importPlaylist(url);
      showToast(`\u2713 \u0418\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u043e: ${data.title}`);
      await loadPlaylists();
    } catch (e) { showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message); }
  });
}

// ================================================================
// PLAYER CONTROLS
// ================================================================
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
    document.querySelector('.flip-container')?.classList.toggle('flipped')
  );
  document.getElementById('player-share').addEventListener('click', () => {
    if (player.currentTrack) shareTrackToStory(player.currentTrack);
  });
  document.getElementById('player-like').addEventListener('click', () => {
    if (player.currentTrack) window.toggleFav(player.currentTrack);
  });
  document.getElementById('mini-like').addEventListener('click', () => {
    if (player.currentTrack) window.toggleFav(player.currentTrack);
  });
  document.getElementById('player-artist-btn').addEventListener('click', () => {
    const t = player.currentTrack;
    if (t?.artist_id) window.openArtist(t.artist_id);
  });
  document.getElementById('offline-save-btn').addEventListener('click', async () => {
    const track = player.currentTrack;
    if (!track) return;
    if (await isTrackOffline(track.id)) { showToast('\u0423\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e'); return; }
    showToast('\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c \u043e\u0444\u0444\u043b\u0430\u0439\u043d...');
    try {
      const sd = await api.stream(track.id, track.artist, track.title);
      const audioBlob = await (await fetch(sd.stream_url)).blob();
      let coverBlob = null;
      if (track.cover_url) {
        try { coverBlob = await (await fetch(track.cover_url)).blob(); } catch {}
      }
      await saveTrackOffline(track.id, audioBlob, coverBlob, track);
      showToast('\u2713 \u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e \u0434\u043b\u044f \u043e\u0444\u0444\u043b\u0430\u0439\u043d\u0430');
    } catch { showToast('\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f'); }
  });
}

function openFullPlayer() {
  const fp = document.getElementById('fullscreen-player');
  fp.classList.remove('hidden');
  fp.classList.add('flex', 'entering');
  setTimeout(() => fp.classList.remove('entering'), 400);
  document.querySelector('.flip-container')?.classList.remove('flipped');
}

function closeFullPlayer() {
  const fp = document.getElementById('fullscreen-player');
  fp.classList.add('hidden');
  fp.classList.remove('flex');
}

// ================================================================
// LYRICS
// ================================================================
let parsedLyrics = [];

async function loadLyrics(track) {
  parsedLyrics = [];
  const container = document.getElementById('lyrics-container');
  const loading  = document.getElementById('lyrics-loading');
  const empty    = document.getElementById('lyrics-empty');
  container.innerHTML = '';
  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  try {
    const data = await api.lyrics(track.title, track.artist);
    loading.classList.add('hidden');
    if (data.synced) {
      parsedLyrics = data.synced.split('\n').map(line => {
        const m = line.match(/^\[(\d{2}):(\d{2}\.\d+)\](.*)/);
        return m ? { time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() } : null;
      }).filter(Boolean);
      container.innerHTML = parsedLyrics.map((l, i) =>
        `<p class="lyric-line" data-index="${i}">${l.text || '&nbsp;'}</p>`
      ).join('');
    } else if (data.plain) {
      container.innerHTML = data.plain.split('\n').map(l =>
        `<p class="lyric-line text-sp-muted/60">${l || '&nbsp;'}</p>`
      ).join('');
    } else {
      empty.classList.remove('hidden');
    }
  } catch {
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

window.syncLyricsGlobal = (currentTime) => {
  if (!parsedLyrics.length) return;
  let idx = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (parsedLyrics[i].time <= currentTime) idx = i; else break;
  }
  if (idx < 0) return;
  document.querySelectorAll('.lyric-line')
    .forEach((el, i) => el.classList.toggle('active', i === idx));
  document.querySelector(`.lyric-line[data-index="${idx}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ================================================================
// PLAYER CALLBACKS
// ================================================================
function onTrackChange(track) {
  if (!track) return;
  document.getElementById('mini-player').classList.remove('hidden');
  ['mini-cover', 'player-cover'].forEach(id =>
    document.getElementById(id).src = track.cover_url || '');
  document.getElementById('mini-title').textContent  = track.title;
  document.getElementById('mini-artist').textContent = track.artist;
  document.getElementById('player-title').textContent = track.title;
  document.getElementById('player-artist-btn').textContent = track.artist;
  const bg = document.getElementById('player-bg');
  if (track.cover_url) bg.style.backgroundImage = `url(${track.cover_url})`;
  const liked = favoritesSet.has(track.id);
  ['player-like', 'mini-like'].forEach(id =>
    document.getElementById(id).classList.toggle('text-sp-accent', liked));
  loadLyrics(track);
  lucide.createIcons();
}

function onPlayPause(isPlaying) {
  ['play-icon', 'mini-play-icon'].forEach(id =>
    document.getElementById(id).setAttribute('data-lucide', isPlaying ? 'pause' : 'play'));
  lucide.createIcons();
}

function onProgress(current, duration) {
  const pct = duration ? (current / duration) * 100 : 0;
  document.getElementById('mini-progress').style.width = `${pct}%`;
  document.getElementById('seek-bar').value = pct;
  document.getElementById('time-current').textContent = fmt(current);
  document.getElementById('time-total').textContent   = fmt(duration);
}

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ================================================================
// TOAST
// ================================================================
function showToast(msg, ms = 2200) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-content').textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add('hidden'), ms);
}

window.showToast = showToast;
init().catch(console.error);
