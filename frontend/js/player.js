import { api } from './api.js';
import { getOfflineTrack } from './indexeddb.js';

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

    this.audio.addEventListener('timeupdate', () => {
      this._onProgress(this.audio.currentTime, this.audio.duration || 0);
      if (window.syncLyricsGlobal) window.syncLyricsGlobal(this.audio.currentTime);
    });
    this.audio.addEventListener('ended', () => this._onEnd());
    this.audio.addEventListener('play',  () => this._onPlayPause(true));
    this.audio.addEventListener('pause', () => this._onPlayPause(false));
    // Don't auto-skip on audio error — user should manually skip
    this.audio.addEventListener('error', () => {
      if (this.isLoading) return; // already handling in playTrack
      window.showToast?.('\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u043e\u0441\u043f\u0440\u043e\u0438\u0437\u0432\u0435\u0434\u0435\u043d\u0438\u044f');
    });
  }

  loadQueue(tracks) { this.queue = tracks; this.currentIndex = -1; }

  async playTrack(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[index];
    this.currentTrack = track;
    this._onTrackChange(track);
    this.audio.pause();
    this.audio.src = '';
    this.isLoading = true;

    try {
      // 1. Offline cache
      const offline = await getOfflineTrack(track.id);
      if (offline?.audio) {
        this.audio.src = URL.createObjectURL(offline.audio);
        await this.audio.play();
        return;
      }

      // 2. Spotify preview_url (30s, most reliable)
      if (track.preview_url) {
        this.audio.src = track.preview_url;
        await this.audio.play();
        return;
      }

      // 3. yt-dlp stream via backend (full track, may fail)
      try {
        const streamData = await api.stream(track.id, track.artist, track.title);
        if (streamData?.stream_url) {
          this.audio.src = streamData.stream_url;
          await this.audio.play();
          return;
        }
      } catch {}

      window.showToast?.('\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0433\u043e \u0430\u0443\u0434\u0438\u043e');
    } catch (e) {
      window.showToast?.('\u041e\u0448\u0438\u0431\u043a\u0430: ' + (e?.message || ''));
    } finally {
      this.isLoading = false;
    }
  }

  togglePlay() {
    if (this.audio.src) {
      this.audio.paused ? this.audio.play() : this.audio.pause();
    }
  }

  seek(pct) {
    if (this.audio.duration) this.audio.currentTime = (pct / 100) * this.audio.duration;
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
      this.audio.currentTime = 0;
      this.audio.play();
    } else {
      this.next();
    }
  }
}
