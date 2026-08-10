import { getOfflineTrack } from './indexeddb.js';

// Spotify Web Playback SDK state
let _sdkPlayer = null;
let _deviceId = null;
let _accessToken = null;
let _progressInterval = null;
let _sdkReady = false;
let _sdkFailed = false;

/**
 * Initialize the Spotify Web Playback SDK.
 * Resolves true when ready, false if SDK fails or times out.
 */
export function initSpotifySDK(token) {
  _accessToken = token;
  _sdkFailed = false; // сброс — позволяет переподключиться
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!_sdkReady) {
        console.warn('Spotify SDK timed out — will use preview_url fallback');
        _sdkFailed = true;
        resolve(false);
      }
    }, 10000);

    const setup = () => {
      try {
        _sdkPlayer = new window.Spotify.Player({
          name: 'Spotiffy TMA',
          getOAuthToken: cb => cb(_accessToken),
          volume: 0.8,
        });

        _sdkPlayer.addListener('ready', ({ device_id }) => {
          clearTimeout(timeout);
          _deviceId = device_id;
          _sdkReady = true;
          _sdkFailed = false;
          console.log('\u2705 Spotify SDK ready, device_id:', device_id);
          resolve(true);
        });

        _sdkPlayer.addListener('not_ready', () => {
          console.warn('Spotify SDK not_ready');
          _deviceId = null;
          _sdkReady = false;
        });

        _sdkPlayer.addListener('initialization_error', ({ message }) => {
          clearTimeout(timeout);
          console.error('SDK init error:', message);
          _sdkFailed = true;
          resolve(false);
        });

        _sdkPlayer.addListener('authentication_error', ({ message }) => {
          clearTimeout(timeout);
          console.error('SDK auth error:', message);
          _sdkFailed = true;
          resolve(false);
        });

        _sdkPlayer.addListener('account_error', ({ message }) => {
          clearTimeout(timeout);
          console.error('SDK account error (Premium required):', message);
          _sdkFailed = true;
          resolve(false);
        });

        _sdkPlayer.connect().then(success => {
          if (!success) {
            clearTimeout(timeout);
            console.error('SDK connect() returned false');
            _sdkFailed = true;
            resolve(false);
          }
        });
      } catch (e) {
        clearTimeout(timeout);
        console.error('SDK setup exception:', e);
        _sdkFailed = true;
        resolve(false);
      }
    };

    if (window.Spotify?.Player) {
      setup();
    } else {
      const prev = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (prev) prev();
        setup();
      };
    }
  });
}

export function updateSpotifyToken(token) {
  _accessToken = token;
}

export function isSDKReady() {
  return !!(_deviceId && _accessToken && _sdkReady);
}

// FIX: убрали onPlayPause из параметров — не зовём его оптимистично
async function _playViaSDK(trackId) {
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
      return true;
    }
    // FIX: если девайс пропал — сбрасываем state чтобы следующий вызов сразу упал на fallback
    if (resp.status === 404) {
      console.warn('SDK device not found, resetting deviceId');
      _deviceId = null;
      _sdkReady = false;
    }
    const errBody = await resp.json().catch(() => ({}));
    console.error('SDK play error:', resp.status, errBody);
    return false;
  } catch (e) {
    console.error('SDK play exception:', e);
    return false;
  }
}

export class Player {
  constructor({ onTrackChange, onPlayPause, onProgress }) {
    this.audio = new Audio();
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
    this._playId = 0; // FIX: счётчик для отмены устаревших async вызовов
    this._stateChangedHandler = null;

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

    // FIX 1: уникальный ID этого вызова — если появится новый, этот отменяется
    const playId = ++this._playId;

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
      if (playId !== this._playId) return; // устарело — другой трек уже запущен
      if (offline?.audio) {
        this.audio.src = URL.createObjectURL(offline.audio);
        await this.audio.play();
        this.isLoading = false;
        return;
      }

      // 2. Spotify Web Playback SDK (полный трек, требует Premium)
      if (!_sdkFailed && _sdkReady && _deviceId && _accessToken && track.id) {
        const ok = await _playViaSDK(track.id); // FIX: без onPlayPause
        if (playId !== this._playId) return; // устарело
        if (ok) {
          this._usingSDK = true;
          this._startSDKProgress();
          this.isLoading = false;
          return;
        }
      }

      // 3. 30-сек превью fallback
      if (track.preview_url) {
        this.audio.src = track.preview_url;
        if (playId !== this._playId) return; // устарело
        try {
          await this.audio.play();
          window.showToast?.('\u26a1 30\u0441 \u043f\u0440\u0435\u0432\u044c\u044e');
        } catch (e) {
          window.showToast?.('\u041d\u0430\u0436\u043c\u0438 \u25B6 \u0434\u043b\u044f \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f');
        }
        this.isLoading = false;
        return;
      }

      window.showToast?.('\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0433\u043e \u0430\u0443\u0434\u0438\u043e.');
    } catch (e) {
      if (playId !== this._playId) return;
      console.error('playTrack error:', e);
      window.showToast?.('\u041e\u0448\u0438\u0431\u043a\u0430: ' + (e?.message || ''));
    } finally {
      if (playId === this._playId) this.isLoading = false;
    }
  }

  _startSDKProgress() {
    this._stopSDKProgress();

    // FIX 2: слушаем player_state_changed для надёжного определения конца трека
    if (_sdkPlayer) {
      this._stateChangedHandler = (state) => {
        if (!state || !this._usingSDK) return;
        // Трек закончился: встал на паузу, позиция 0, есть предыдущий трек
        if (state.paused && state.position === 0 && state.track_window?.previous_tracks?.length > 0) {
          this._stopSDKProgress();
          this._onEnd();
        }
      };
      _sdkPlayer.addListener('player_state_changed', this._stateChangedHandler);
    }

    _progressInterval = setInterval(async () => {
      if (!_sdkPlayer) return;
      try {
        const state = await _sdkPlayer.getCurrentState();
        if (!state) return;
        const pos = state.position / 1000;
        const dur = state.duration / 1000;
        this._onProgress(pos, dur);
        if (window.syncLyricsGlobal) window.syncLyricsGlobal(pos);
        // FIX: onPlayPause теперь здесь — реальное состояние, не оптимистичное
        this._onPlayPause(!state.paused);
        // FIX 3: расширяем окно до 1500мс чтобы не пропустить конец между polls
        if (!state.paused && dur > 0 && state.position >= state.duration - 1500) {
          this._stopSDKProgress();
          this._onEnd();
        }
      } catch (e) {
        console.error('SDK state poll error:', e);
      }
    }, 1000);
  }

  _stopSDKProgress() {
    if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
    if (_sdkPlayer && this._stateChangedHandler) {
      _sdkPlayer.removeListener('player_state_changed', this._stateChangedHandler);
      this._stateChangedHandler = null;
    }
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
