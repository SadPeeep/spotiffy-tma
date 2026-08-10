import { getOfflineTrack } from './indexeddb.js';

// Spotify Web Playback SDK state
let _sdkPlayer = null;
let _deviceId = null;
let _accessToken = null;
let _progressInterval = null;

/**
 * Call once when you have a Spotify access token.
 * Resolves when the SDK player is ready (device_id obtained).
 */
export function initSpotifySDK(token) {
  _accessToken = token;
  return new Promise((resolve) => {
    const setup = () => {
      _sdkPlayer = new window.Spotify.Player({
        name: 'Spotiffy',
        getOAuthToken: cb => cb(_accessToken),
        volume: 0.8,
      });
      _sdkPlayer.addListener('ready', ({ device_id }) => {
        _deviceId = device_id;
        console.log('Spotify SDK ready, device_id:', device_id);
        resolve(true);
      });
      _sdkPlayer.addListener('not_ready', () => { _deviceId = null; });
      _sdkPlayer.addListener('initialization_error', ({ message }) =>
        console.error('SDK init error:', message));
      _sdkPlayer.addListener('authentication_error', ({ message }) =>
        console.error('SDK auth error:', message));
      _sdkPlayer.addListener('account_error', ({ message }) =>
        console.error('SDK account error (Premium required):', message));
      _sdkPlayer.connect();
    };
    if (window.Spotify) {
      setup();
    } else {
      window.onSpotifyWebPlaybackSDKReady = setup;
    }
  });
}

export function updateSpotifyToken(token) {
  _accessToken = token;
}

export function isSDKReady() {
  return !!(  _deviceId && _accessToken);
}

async function _playViaSDK(trackId, onPlayPause) {
  if (!_deviceId || !_accessToken) return false;
  try {
    const url = 'https://api.spotify.com/v1/me/player/play?device_id=' + encodeURIComponent(_deviceId);
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + _accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: ['spotify:track:' + trackId] }),
    });
    if (resp.status === 204 || resp.ok) {
      onPlayPause(true);
      return true;
    }
    const err = await resp.json().catch(() => ({}));
    console.error('SDK play error:', resp.status, err);
  } catch (e) {
    console.error('SDK play exception:', e);
  }
  return false;
}

export class Player {
  constructor({ onTrackChange, onPlayPause, onProgress }) {
    this.audio = new Audio(); // fallback: Spotify preview_url
    this.queue = [];
    this.currentIndex = -1;
    this.currentTrack = null;
    this.shuffle = false;
    this.repeat = false;
    this.isLoading = false;
    this._onTrackChange = onTrackChange;
    this._onPlayPause = onPlayPause;
    this._onProgress = onProgress;
    this._usingSDK = false;

    this.audio.addEventListener('timeupdate', () => {
      if (this._usingSDK) return;
      this._onProgress(this.audio.currentTime, this.audio.duration || 0);
      if (window.syncLyricsGlobal) window.syncLyricsGlobal(this.audio.currentTime);
    });
    this.audio.addEventListener('ended',  () => { if (!this._usingSDK) this._onEnd(); });
    this.audio.addEventListener('play',   () => { if (!this._usingSDK) this._onPlayPause(true); });
    this.audio.addEventListener('pause',  () => { if (!this._usingSDK) this._onPlayPause(false); });
    this.audio.addEventListener('error',  () => {
      if (!this.isLoading) window.showToast?.('\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f');
    });
  }

  loadQueue(tracks) { this.queue = tracks; this.currentIndex = -1; }

  async playTrack(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[index];
    this.currentTrack = track;
    this._onTrackChange(track);
    this.isLoading = true;
    this._usingSDK = false;
    this._stopSDKProgress();
    this.audio.pause();
    this.audio.src = '';

    try {
      // 1. Offline cache
      const offline = await getOfflineTrack(track.id);
      if (offline?.audio) {
        this.audio.src = URL.createObjectURL(offline.audio);
        await this.audio.play();
        return;
      }

      // 2. Spotify Web Playback SDK — full track, Premium
      if (_deviceId && _accessToken && track.id) {
        const ok = await _playViaSDK(track.id, this._onPlayPause.bind(this));
        if (ok) {
          this._usingSDK = true;
          this._startSDKProgress();
          return;
        }
      }

      // 3. Fallback: Spotify 30-sec preview
      if (track.preview_url) {
        this.audio.src = track.preview_url;
        await this.audio.play();
        window.showToast?.('\u26a1 30\u0441 \u043f\u0440\u0435\u0432\u044c\u044e (п\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435 Spotify \u0434\u043b\u044f \u043f\u043e\u043b\u043d\u044b\u0445 \u0442\u0440\u0435\u043a\u043e\u0432)');
        return;
      }

      window.showToast?.('\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0433\u043e \u0430\u0443\u0434\u0438\u043e');
    } catch (e) {
      window.showToast?.('\u041e\u0448\u0438\u0431\u043a\u0430: ' + (e?.message || ''));
    } finally {
      this.isLoading = false;
    }
  }

  _startSDKProgress() {
    this._stopSDKProgress();
    _progressInterval = setInterval(async () => {
      if (!_sdkPlayer) return;
      const state = await _sdkPlayer.getCurrentState();
      if (!state) return;
      const pos = state.position / 1000;
      const dur = state.duration / 1000;
      this._onProgress(pos, dur);
      if (window.syncLyricsGlobal) window.syncLyricsGlobal(pos);
      this._onPlayPause(!state.paused);
      // Auto-advance when track ends
      if (!state.paused && dur > 0 && state.position >= state.duration - 500) {
        this._stopSDKProgress();
        this._onEnd();
      }
    }, 1000);
  }

  _stopSDKProgress() {
    if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
  }

  togglePlay() {
    if (this._usingSDK && _sdkPlayer) {
      _sdkPlayer.togglePlay();
    } else if (this.audio.src) {
      this.audio.paused ? this.audio.play() : this.audio.pause();
    }
  }

  seek(pct) {
    if (this._usingSDK && _sdkPlayer) {
      _sdkPlayer.getCurrentState().then(state => {
        if (state) _sdkPlayer.seek((pct / 100) * state.duration);
      });
    } else if (this.audio.duration) {
      this.audio.currentTime = (pct / 100) * this.audio.duration;
    }
  }

  prev() {
    if (this.currentIndex > 0) this.playTrack(this.currentIndex - 1);
    else if (this.repeat) this.playTrack(this.queue.length - 1);
  }

  next() {
    if (this.shuffle) {
      this.playTrack(Math.floor(Math.random() * this.queue.length));
    } else if (this.currentIndex < this.queue.length - 1) {
      this.playTrack(this.currentIndex + 1);
    } else if (this.repeat) {
      this.playTrack(0);
    }
  }

  _onEnd() {
    if (this.repeat && this.queue.length === 1) {
      if (this._usingSDK && _sdkPlayer) _sdkPlayer.seek(0);
      else { this.audio.currentTime = 0; this.audio.play(); }
    } else {
      this.next();
    }
  }
}
