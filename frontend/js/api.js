const API_BASE = window.BACKEND_URL || 'http://localhost:8000';

async function apiRequest(endpoint, options = {}) {
  const initData = window.Telegram?.WebApp?.initData || '';
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  search: (q, type = 'track,artist,album') =>
    apiRequest(`/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`),

  stream: (trackId, artist, title) =>
    apiRequest(
      `/api/stream?track_id=${encodeURIComponent(trackId)}&artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`
    ),

  lyrics: (trackName, artistName, albumName = '', duration = 0) =>
    apiRequest(
      `/api/lyrics?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}&album_name=${encodeURIComponent(albumName)}&duration=${duration}`
    ),

  myWave: () => apiRequest('/api/my-wave'),
  home:   () => apiRequest('/api/home'),
  me:     () => apiRequest('/api/me'),

  getFavorites: () => apiRequest('/api/favorites'),
  addFavorite: (track) =>
    apiRequest('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ track_id: track.id, title: track.title, artist: track.artist, cover_url: track.cover_url }),
    }),
  removeFavorite: (trackId) =>
    apiRequest(`/api/favorites/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),

  getPlaylists: () => apiRequest('/api/playlists'),
  importPlaylist: (url) =>
    apiRequest('/api/playlists/import', { method: 'POST', body: JSON.stringify({ url }) }),
  getPlaylist: (id) => apiRequest(`/api/playlists/${id}`),

  getArtist: (artistId) => apiRequest(`/api/artist/${encodeURIComponent(artistId)}`),
};
