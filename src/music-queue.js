import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} from '@discordjs/voice';
import { spawn } from 'child_process';

export const LOOP_MODE = {
  NONE: 'none',
  TRACK: 'track',
  QUEUE: 'queue',
};

const STAY_DURATION_MS = 24 * 60 * 60 * 1000;

function formatSeconds(sec) {
  if (!sec || isNaN(sec)) return '?:??';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const YTDLP_COMMON = ['--extractor-args', 'youtube:player_client=android'];

async function ytdlpSearch(query) {
  const isUrl = query.startsWith('http://') || query.startsWith('https://');
  const args = isUrl
    ? ['--dump-json', '--no-playlist', '--no-warnings', ...YTDLP_COMMON, query]
    : ['--dump-json', '--no-playlist', '--no-warnings', ...YTDLP_COMMON, `ytsearch1:${query}`];

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { timeout: 20000 });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (!out.trim()) return reject(new Error(err || 'No results'));
      try {
        const line = out.trim().split('\n')[0];
        const info = JSON.parse(line);
        resolve({
          title: info.title || 'Unknown',
          url: info.webpage_url || info.url || query,
          duration: formatSeconds(info.duration),
          thumbnail: info.thumbnail || `https://img.youtube.com/vi/${info.id}/mqdefault.jpg`,
          author: info.uploader || info.channel || 'Unknown',
        });
      } catch (e) {
        reject(new Error('Failed to parse result'));
      }
    });
    proc.on('error', reject);
  });
}

function createYtdlpStream(url) {
  const proc = spawn('yt-dlp', [
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    ...YTDLP_COMMON,
    '-o', '-',
    url,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  const resource = createAudioResource(proc.stdout, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
  });

  resource._ytdlpProc = proc;
  return resource;
}

export class MusicQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.connection = null;
    this.player = createAudioPlayer();
    this._currentResource = null;

    this.tracks = [];
    this.currentTrack = null;
    this.isPlaying = false;
    this.volume = 0.8;

    this.loopMode = LOOP_MODE.NONE;
    this.loopCount = 0;
    this.loopRemaining = 0;

    this.stayTimer = null;
    this.stayUntil = null;

    this.textChannel = null;
    this.nowPlayingMessage = null;

    this._setupPlayerEvents();
  }

  _setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Playing, () => {
      console.log(`▶ يعزف: ${this.currentTrack?.title}`);
      this.isPlaying = true;
      this._sendNowPlaying(this.currentTrack).catch(() => {});
    });

    this.player.on(AudioPlayerStatus.Idle, async () => {
      if (!this.isPlaying) return;
      console.log('⏹ Track ended (idle)');
      this.isPlaying = false;
      this._killCurrentProc();
      await this._handleTrackEnd();
    });

    this.player.on('error', async (err) => {
      console.error('❌ Player error:', err.message);
      this.isPlaying = false;
      this._killCurrentProc();
      if (this.textChannel) {
        const { errorEmbed } = await import('./embeds.js');
        this.textChannel.send({ embeds: [errorEmbed(`❌ خطأ في التشغيل: ${err.message}`)] }).catch(() => {});
      }
      await this._handleTrackEnd();
    });
  }

  _killCurrentProc() {
    try {
      if (this._currentResource?._ytdlpProc) {
        this._currentResource._ytdlpProc.kill('SIGKILL');
      }
    } catch {}
    this._currentResource = null;
  }

  async joinChannel(channelId, guild) {
    if (this.connection) {
      const state = this.connection.state.status;
      if (
        state !== VoiceConnectionStatus.Destroyed &&
        state !== VoiceConnectionStatus.Disconnected
      ) {
        return;
      }
      try { this.connection.destroy(); } catch {}
      this.connection = null;
    }

    console.log(`🔊 Joining voice channel ${channelId}`);
    this.connection = joinVoiceChannel({
      channelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.player);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (!this.stayTimer) this.destroy();
      }
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      console.log('✅ Voice connected');
    } catch {
      console.error('❌ Voice connection timed out');
      this.connection.destroy();
      this.connection = null;
      throw new Error('فشل الاتصال بالقناة الصوتية. تأكد أن البوت لديه صلاحية الانضمام.');
    }
  }

  setTextChannel(channel) {
    this.textChannel = channel;
  }

  async search(query) {
    console.log(`🔎 Searching: ${query.slice(0, 60)}`);
    return await ytdlpSearch(query);
  }

  async addTrack(trackInfo, requestedBy) {
    const track = { ...trackInfo, requestedBy };
    this.tracks.push(track);
    if (!this.isPlaying) await this._playNext();
    return track;
  }

  async _handleTrackEnd() {
    if (!this.currentTrack) return;

    if (this.loopMode === LOOP_MODE.TRACK) {
      if (this.loopCount === 0) {
        await this._playTrack(this.currentTrack);
        return;
      }
      if (this.loopRemaining > 0) {
        this.loopRemaining--;
        if (this.loopRemaining > 0) {
          await this._playTrack(this.currentTrack);
          return;
        }
      }
    }

    if (this.loopMode === LOOP_MODE.QUEUE) {
      this.tracks.push({ ...this.currentTrack });
    }

    await this._playNext();
  }

  async _playNext() {
    if (!this.tracks.length) {
      this.currentTrack = null;
      if (!this.stayTimer) setTimeout(() => this.destroy(), 2000);
      return;
    }
    const next = this.tracks.shift();
    await this._playTrack(next);
  }

  async _playTrack(track) {
    if (!this.connection) return;
    this.currentTrack = track;
    this.isPlaying = true;
    this._killCurrentProc();

    console.log(`▶ Loading: ${track.title}`);
    try {
      const resource = createYtdlpStream(track.url);
      this._currentResource = resource;
      if (resource.volume) resource.volume.setVolume(this.volume);
      this.player.play(resource);
    } catch (err) {
      console.error('❌ Stream error:', err.message);
      this.isPlaying = false;
      await this._playNext();
    }
  }

  async _sendNowPlaying(track) {
    if (!this.textChannel || !track) return;
    try {
      const { startedPlayingEmbed, controlButtons } = await import('./embeds.js');
      const embed = startedPlayingEmbed(track, this.getLoopInfo());
      const components = controlButtons(false, this.isStayEnabled());

      if (this.nowPlayingMessage) {
        try { await this.nowPlayingMessage.delete(); } catch {}
        this.nowPlayingMessage = null;
      }

      this.nowPlayingMessage = await this.textChannel.send({ embeds: [embed], components });
    } catch (err) {
      console.error('خطأ في إرسال Now Playing:', err.message);
    }
  }

  async updateNowPlayingButtons(isPaused) {
    if (!this.nowPlayingMessage) return;
    try {
      const { startedPlayingEmbed, controlButtons } = await import('./embeds.js');
      const embed = startedPlayingEmbed(this.currentTrack, this.getLoopInfo());
      const components = controlButtons(isPaused, this.isStayEnabled());
      await this.nowPlayingMessage.edit({ embeds: [embed], components });
    } catch {}
  }

  pause() {
    if (this.player.state.status !== AudioPlayerStatus.Playing) return false;
    this.player.pause();
    return true;
  }

  resume() {
    if (this.player.state.status !== AudioPlayerStatus.Paused) return false;
    this.player.unpause();
    return true;
  }

  skip() {
    this.loopMode = LOOP_MODE.NONE;
    this._killCurrentProc();
    this.player.stop(true);
    return true;
  }

  stop() {
    this.tracks = [];
    this.currentTrack = null;
    this.loopMode = LOOP_MODE.NONE;
    this._killCurrentProc();
    this.player.stop(true);
    this.isPlaying = false;
  }

  seek(seconds) {
    if (!this.currentTrack) return false;
    const track = this.currentTrack;
    this._killCurrentProc();

    const args = [
      '-f', 'bestaudio[ext=webm]/bestaudio/best',
      '--no-playlist', '--no-warnings',
      ...YTDLP_COMMON,
      '-o', '-',
      '--download-sections', `*${seconds}-inf`,
      track.url,
    ];

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const resource = createAudioResource(proc.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    resource._ytdlpProc = proc;
    if (resource.volume) resource.volume.setVolume(this.volume);
    this._currentResource = resource;
    this.player.play(resource);
    return true;
  }

  setVolume(level) {
    this.volume = level / 100;
    if (this._currentResource?.volume) {
      this._currentResource.volume.setVolume(this.volume);
    }
    return true;
  }

  getPosition() {
    return this._currentResource?.playbackDuration ?? 0;
  }

  enableStay() {
    if (this.stayTimer) clearTimeout(this.stayTimer);
    this.stayUntil = new Date(Date.now() + STAY_DURATION_MS);
    this.stayTimer = setTimeout(() => {
      this.stayTimer = null;
      this.stayUntil = null;
      if (!this.isPlaying) this.destroy();
    }, STAY_DURATION_MS);
    return this.stayUntil;
  }

  disableStay() {
    if (this.stayTimer) { clearTimeout(this.stayTimer); this.stayTimer = null; }
    this.stayUntil = null;
  }

  isStayEnabled() { return this.stayTimer !== null; }
  getStayUntil() { return this.stayUntil; }

  setLoop(mode, count = 0) {
    this.loopMode = mode;
    this.loopCount = count;
    this.loopRemaining = count;
  }

  getLoopInfo() {
    if (this.loopMode === LOOP_MODE.NONE) return { mode: 'none', label: '❌ لا يوجد تكرار' };
    if (this.loopMode === LOOP_MODE.TRACK) {
      if (this.loopCount === 0) return { mode: 'track', label: '🔂 تكرار لا نهائي للأغنية' };
      return { mode: 'track', label: `🔂 تكرار الأغنية ${this.loopRemaining} مرة` };
    }
    if (this.loopMode === LOOP_MODE.QUEUE) return { mode: 'queue', label: '🔁 تكرار القائمة بأكملها' };
    return { mode: 'none', label: '❌ لا يوجد تكرار' };
  }

  getQueue() { return this.tracks; }
  getCurrentTrack() { return this.currentTrack; }

  destroy() {
    this.disableStay();
    this.stop();
    if (this.connection) {
      try { this.connection.destroy(); } catch {}
      this.connection = null;
    }
    queues.delete(this.guildId);
  }
}

export const queues = new Map();

export function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, new MusicQueue(guildId));
  }
  return queues.get(guildId);
}

export function deleteQueue(guildId) {
  const q = queues.get(guildId);
  if (q) q.destroy();
  queues.delete(guildId);
}
