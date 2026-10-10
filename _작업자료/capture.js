/* 송쌤과학 GIF 스튜디오 — 화면 공유·녹화·로컬 프레임 추출 */
(function (global) {
  'use strict';

  const MAX_BYTES = 128 * 1024 * 1024;
  const now = () => performance.now();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const abortError = () => new DOMException('작업을 취소했어요.', 'AbortError');
  const callback = (fn, value) => {
    if (typeof fn === 'function') {
      try { fn(value); } catch (error) { console.error('캡처 상태 표시 오류', error); }
    }
  };
  const captureMessage = (error) => {
    const name = error && error.name;
    if (name === 'NotAllowedError') return '화면 공유가 허용되지 않았어요. 다시 선택하거나 브라우저와 macOS의 화면 녹화 권한을 확인해 주세요.';
    if (name === 'AbortError') return '화면 공유 또는 작업을 취소했어요. 다시 선택해 주세요.';
    if (name === 'NotReadableError') return '선택한 화면을 읽을 수 없어요. 시스템 화면 녹화 권한을 확인한 뒤 브라우저를 다시 열어 주세요.';
    if (name === 'NotFoundError') return '공유할 화면을 찾지 못했어요. 녹화할 창이나 탭을 먼저 열어 주세요.';
    if (name === 'InvalidStateError') return '화면 선택은 활성 화면에서 단추를 눌러 시작해 주세요.';
    if (name === 'SecurityError') return '이 페이지에서는 화면 공유가 차단되어 있어요. HTTPS 또는 localhost에서 열어 주세요.';
    return error && error.message ? error.message : '화면을 처리하지 못했어요. 공유를 종료한 뒤 다시 선택해 주세요.';
  };

  function waitEvent(target, event, {signal, timeout = 15000, errorEvent = 'error'} = {}) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener(event, success);
        if (errorEvent) target.removeEventListener(errorEvent, fail);
        if (signal) signal.removeEventListener('abort', aborted);
      };
      const success = (value) => { cleanup(); resolve(value); };
      const fail = () => { cleanup(); reject(new Error('영상을 읽을 수 없어요. 이 브라우저가 지원하는 녹화 형식인지 확인해 주세요.')); };
      const aborted = () => { cleanup(); reject(abortError()); };
      target.addEventListener(event, success, {once: true});
      if (errorEvent) target.addEventListener(errorEvent, fail, {once: true});
      if (signal) signal.addEventListener('abort', aborted, {once: true});
      timer = setTimeout(() => { cleanup(); reject(new Error('영상 준비가 너무 오래 걸려요. 구간이나 출력 크기를 줄여 다시 시도해 주세요.')); }, timeout);
    });
  }

  function pngBlob(canvas, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(abortError()); return; }
      canvas.toBlob((blob) => {
        if (signal && signal.aborted) { reject(abortError()); return; }
        if (blob) resolve(blob);
        else reject(new Error('화면 이미지를 만들지 못했어요. 출력 크기를 줄여 다시 시도해 주세요.'));
      }, 'image/png');
    });
  }

  class GifCapture {
    constructor({onState, onPreview, onProgress, onError} = {}) {
      this.onState = onState;
      this.onPreview = onPreview;
      this.onProgress = onProgress;
      this.onError = onError;
      this.state = 'idle';
      this.mode = 'record';
      this.stream = null;
      this.video = null;
      this.recorder = null;
      this.result = null;
      this.sourceInfo = null;
      this.maxSeconds = 15;
      this._epoch = 0;
      this._elapsed = 0;
      this._activeSince = 0;
      this._chunks = [];
      this._byteCount = 0;
      this._tickTimer = null;
      this._countTimer = null;
      this._countReject = null;
      this._stopPromise = null;
      this._stopResolve = null;
      this._stopReject = null;
      this._recordingError = null;
    }

    static support() {
      const display = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
      const secure = global.isSecureContext !== false;
      return {
        capture: display && secure,
        recording: display && secure && typeof MediaRecorder !== 'undefined',
        reason: !secure ? ' 화면 녹화는 HTTPS 또는 localhost에서 사용할 수 있어요.' : !display ? '이 브라우저는 화면 공유를 지원하지 않아요. PC의 Chrome 또는 Edge에서 열어 주세요.' : typeof MediaRecorder === 'undefined' ? '이 브라우저는 영상 녹화를 지원하지 않아요. PC의 Chrome 또는 Edge에서 열어 주세요.' : ''
      };
    }

    static mimeType() {
      if (typeof MediaRecorder === 'undefined') return '';
      const choices = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'];
      if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
      return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    }

    elapsed() {
      return this._elapsed + (this.state === 'recording' && this._activeSince ? (now() - this._activeSince) / 1000 : 0);
    }

    _emit(state, extra = {}) {
      this.state = state;
      callback(this.onState, {state, elapsed: this.elapsed(), maxSeconds: this.maxSeconds, mode: this.mode, selectedSurface: this.sourceInfo?.displaySurface || 'unknown', sourceWidth: this.sourceInfo?.width || 0, sourceHeight: this.sourceInfo?.height || 0, ...extra});
    }

    _error(error) {
      const message = captureMessage(error);
      callback(this.onError, message);
      return new Error(message, {cause: error});
    }

    _clearTimers() {
      clearInterval(this._tickTimer);
      clearTimeout(this._countTimer);
      this._tickTimer = this._countTimer = null;
    }

    _releaseStream() {
      const stream = this.stream;
      this.stream = null;
      if (stream) stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      if (this.video) {
        this.video.pause();
        this.video.srcObject = null;
        this.video.remove();
        this.video = null;
      }
      callback(this.onPreview, null);
    }

    async select(mode = 'record') {
      const support = GifCapture.support();
      if (!support.capture || (mode !== 'snapshot' && !support.recording)) {
        throw this._error(new Error(support.reason));
      }
      this.close();
      this.mode = ['record', 'tab', 'snapshot', 'region'].includes(mode) ? mode : 'record';
      const epoch = this._epoch;
      this.result = null;
      this._emit('selecting');
      // displaySurface is a preference for the browser's picker, never a forced
      // screen selection. The permission call stays in the initiating click.
      const request = this.mode === 'tab'
        ? {video: {displaySurface: 'browser'}, audio: false, preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include'}
        : this.mode === 'region'
          ? {video: {displaySurface: 'monitor'}, audio: false, preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude'}
          : {video: true, audio: false};
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(request);
        if (epoch !== this._epoch) {
          stream.getTracks().forEach((track) => track.stop());
          throw abortError();
        }
        const track = stream.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') throw new Error('공유할 영상이 없어요. 화면이나 탭을 다시 선택해 주세요.');
        // Explicitly discard accidental audio tracks even if a browser supplies one.
        stream.getAudioTracks().forEach((audioTrack) => { audioTrack.stop(); stream.removeTrack(audioTrack); });
        this.stream = stream;
        this.video = document.createElement('video');
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute('aria-hidden', 'true');
        this.video.srcObject = stream;
        if (this.video.readyState < 1) await waitEvent(this.video, 'loadedmetadata');
        if (epoch !== this._epoch) throw abortError();
        await this.video.play();
        if (epoch !== this._epoch) throw abortError();
        const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
        this.sourceInfo = {
          displaySurface: ['monitor', 'window', 'browser'].includes(settings.displaySurface) ? settings.displaySurface : 'unknown',
          width: this.video.videoWidth || settings.width || 0,
          height: this.video.videoHeight || settings.height || 0
        };
        track.onended = () => {
          if (['recording', 'paused', 'stopping'].includes(this.state)) {
            this.stop().catch(() => {});
          } else {
            this.close();
          }
        };
        callback(this.onPreview, stream);
        this._emit(this.mode === 'snapshot' ? 'snapshot' : 'ready');
        return stream;
      } catch (error) {
        if (stream && stream !== this.stream) stream.getTracks().forEach((track) => track.stop());
        if (epoch === this._epoch) {
          this._releaseStream();
          this._emit('idle');
          throw this._error(error);
        }
        throw abortError();
      }
    }

    async start({countdown = 3, maxSeconds = 15} = {}) {
      if (this.state !== 'ready' || !this.stream) throw this._error(new Error('먼저 녹화할 화면을 선택해 주세요.'));
      const epoch = this._epoch;
      this.maxSeconds = clamp(Number(maxSeconds) || 15, 1, 30);
      this._elapsed = 0;
      this._activeSince = 0;
      this._chunks = [];
      this._byteCount = 0;
      this.result = null;
      this._recordingError = null;
      const seconds = clamp(Number(countdown) || 0, 0, 5);
      if (seconds > 0) {
        const finishAt = now() + seconds * 1000;
        await new Promise((resolve, reject) => {
          this._countReject = reject;
          const tick = () => {
            if (epoch !== this._epoch || !this.stream) { this._countReject = null; reject(abortError()); return; }
            const remaining = Math.max(0, Math.ceil((finishAt - now()) / 1000));
            if (!remaining) { this._countReject = null; this._countTimer = null; resolve(); return; }
            this._emit('countdown', {remaining});
            this._countTimer = setTimeout(tick, Math.min(150, finishAt - now()));
          };
          tick();
        });
      }
      if (epoch !== this._epoch || !this.stream) throw abortError();
      try {
        const mimeType = GifCapture.mimeType();
        this.recorder = new MediaRecorder(this.stream, mimeType ? {mimeType} : {});
        this._stopPromise = new Promise((resolve, reject) => { this._stopResolve = resolve; this._stopReject = reject; });
        // Automatic stop may happen before the caller explicitly awaits stop().
        this._stopPromise.catch(() => {});
        const recorder = this.recorder;
        recorder.ondataavailable = (event) => {
          if (epoch !== this._epoch) return;
          if (event.data && event.data.size) {
            this._chunks.push(event.data);
            this._byteCount += event.data.size;
          }
          if (this._byteCount >= MAX_BYTES && ['recording', 'paused'].includes(this.state)) {
            callback(this.onProgress, {phase: 'recording', message: '녹화 데이터가 128MB에 도달해 자동 정지했어요. 녹화 결과는 유지했어요. 구간이나 크기를 줄여 주세요.', elapsed: this.elapsed(), maxSeconds: this.maxSeconds});
            this.stop().catch(() => {});
          } else if (this.state === 'recording' && this.elapsed() >= this.maxSeconds) {
            this.stop().catch(() => {});
          }
        };
        recorder.onerror = (event) => {
          this._recordingError = event.error || new Error('녹화를 이어갈 수 없어요. 준비된 영상이 있으면 결과를 유지해요. 다시 화면을 선택해 주세요.');
          callback(this.onError, captureMessage(this._recordingError));
          this.stop().catch(() => {});
        };
        recorder.onstop = () => {
          if (epoch !== this._epoch) return;
          if (this.state === 'recording') this._freezeElapsed();
          this._clearTimers();
          const settings = this.stream && this.stream.getVideoTracks()[0] ? this.stream.getVideoTracks()[0].getSettings() : {};
          const width = (this.video && this.video.videoWidth) || settings.width || 0;
          const height = (this.video && this.video.videoHeight) || settings.height || 0;
          const mime = recorder.mimeType || (this._chunks[0] && this._chunks[0].type) || mimeType || 'video/webm';
          const blob = new Blob(this._chunks, {type: mime});
          this._chunks = [];
          this.recorder = null;
          this._releaseStream();
          if (!blob.size) {
            const error = this._error(this._recordingError || new Error('녹화 영상이 비어 있어요. 화면을 다시 선택하고 조금 더 길게 녹화해 주세요.'));
            this._emit('idle');
            if (this._stopReject) this._stopReject(error);
          } else {
            this.result = {blob, duration: this._elapsed, width, height, mime};
            this._emit('recorded', {result: this.result});
            if (this._stopResolve) this._stopResolve(this.result);
          }
          this._stopResolve = this._stopReject = null;
        };
        recorder.start(500);
        this._activeSince = now();
        this._emit('recording');
        this._tickTimer = setInterval(() => {
          if (this.state !== 'recording') return;
          this._emit('recording');
          callback(this.onProgress, {phase: 'recording', elapsed: this.elapsed(), maxSeconds: this.maxSeconds});
          if (this.elapsed() >= this.maxSeconds) this.stop().catch(() => {});
        }, 100);
      } catch (error) {
        this._clearTimers();
        if (this._stopReject) this._stopReject(error);
        this._stopResolve = this._stopReject = null;
        this.recorder = null;
        this._releaseStream();
        this._emit('idle');
        throw this._error(error);
      }
    }

    _freezeElapsed() {
      if (this._activeSince) this._elapsed += (now() - this._activeSince) / 1000;
      this._activeSince = 0;
    }

    pause() {
      if (this.state !== 'recording' || !this.recorder || this.recorder.state !== 'recording') return false;
      this.recorder.pause();
      this._freezeElapsed();
      this._emit('paused');
      return true;
    }

    resume() {
      if (this.state !== 'paused' || !this.recorder || this.recorder.state !== 'paused') return false;
      this.recorder.resume();
      this._activeSince = now();
      this._emit('recording');
      return true;
    }

    async stop() {
      if (this.state === 'recorded' && this.result) return this.result;
      if (this.state === 'stopping') return this._stopPromise;
      if (this.state === 'countdown') {
        this._clearTimers();
        if (this._countReject) this._countReject(abortError());
        this._countReject = null;
        this._emit('ready');
        return null;
      }
      if (!this.recorder || !['recording', 'paused'].includes(this.state)) return null;
      const promise = this._stopPromise;
      if (this.state === 'recording') this._freezeElapsed();
      this._emit('stopping');
      this._clearTimers();
      if (this.recorder.state !== 'inactive') {
        try { this.recorder.stop(); }
        catch (error) {
          this._releaseStream();
          this.recorder = null;
          this._emit('idle');
          const reported = this._error(error);
          if (this._stopReject) this._stopReject(reported);
          this._stopResolve = this._stopReject = null;
        }
      }
      return promise;
    }

    async snapshot() {
      if (this.state !== 'snapshot' || !this.stream || !this.video) throw this._error(new Error('한 장 캡처에서 공유할 화면을 먼저 선택해 주세요.'));
      const epoch = this._epoch;
      const video = this.video;
      try {
        if (video.readyState < 2) await waitEvent(video, 'loadeddata');
        if (epoch !== this._epoch) throw abortError();
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!sourceWidth || !sourceHeight) throw new Error('공유 영상이 아직 준비되지 않았어요. 잠시 뒤 캡처해 주세요.');
        const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', {alpha: false});
        if (!context) throw new Error('이미지 처리 화면을 준비하지 못했어요. 다른 작업을 닫고 다시 캡처해 주세요.');
        context.drawImage(video, 0, 0, width, height);
        const blob = await pngBlob(canvas);
        canvas.width = canvas.height = 1;
        if (epoch !== this._epoch) throw abortError();
        return {blob, width, height};
      } catch (error) {
        if (epoch !== this._epoch) throw abortError();
        throw this._error(error);
      }
    }

    close() {
      this._epoch++;
      this._clearTimers();
      if (this._countReject) this._countReject(abortError());
      this._countReject = null;
      if (this.recorder) {
        this.recorder.ondataavailable = this.recorder.onerror = this.recorder.onstop = null;
        if (this.recorder.state !== 'inactive') { try { this.recorder.stop(); } catch (_) {} }
        this.recorder = null;
      }
      if (this._stopReject) this._stopReject(abortError());
      this._stopResolve = this._stopReject = null;
      this._stopPromise = null;
      this._chunks = [];
      this._byteCount = 0;
      this.result = null;
      this.sourceInfo = null;
      this._releaseStream();
      this._elapsed = this._activeSince = 0;
      this._emit('idle');
    }

    destroy() { this.close(); }
  }

  async function seekVideo(video, time, signal) {
    if (signal && signal.aborted) throw abortError();
    // Reuse the decoded frame only if no seek is needed and pixels are available.
    if (Math.abs(video.currentTime - time) < 0.0001 && !video.seeking) {
      if (video.readyState < 2) await waitEvent(video, 'loadeddata', {signal});
      return;
    }
    await new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', complete);
        video.removeEventListener('error', fail);
        if (signal) signal.removeEventListener('abort', aborted);
      };
      const complete = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('영상 위치를 읽지 못했어요. 구간을 줄여 다시 시도해 주세요.')); };
      const aborted = () => { cleanup(); reject(abortError()); };
      video.addEventListener('seeked', complete, {once: true});
      video.addEventListener('error', fail, {once: true});
      if (signal) signal.addEventListener('abort', aborted, {once: true});
      timer = setTimeout(fail, 15000);
      try { video.currentTime = time; }
      catch (error) { cleanup(); reject(error); }
    });
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', {signal});
  }

  async function finiteDuration(video, endHint, signal) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    // MediaRecorder WebM often has no duration header. A seek to the end lets
    // the browser inspect the last timestamp without rewriting the video.
    try {
      await seekVideo(video, 1e10, signal);
    } catch (error) {
      if (signal && signal.aborted) throw error;
      if (!Number.isFinite(endHint) || endHint <= 0) throw error;
    }
    let duration = video.duration;
    if ((!Number.isFinite(duration) || duration <= 0) && video.seekable.length) duration = video.seekable.end(video.seekable.length - 1);
    if (!Number.isFinite(duration) || duration <= 0) duration = endHint;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('영상 길이를 읽지 못했어요. 화면을 다시 녹화해 주세요.');
    return duration;
  }

  function sourceRegionPixels(region, sourceWidth, sourceHeight) {
    if (region == null) return {x: 0, y: 0, width: sourceWidth, height: sourceHeight};
    const values = ['x', 'y', 'w', 'h'].map(key => Number(region[key]));
    if (values.some(value => !Number.isFinite(value))) throw new Error('녹화 영역 좌표를 읽지 못했어요. 화면 안에서 영역을 다시 선택해 주세요.');
    const x = clamp(values[0], 0, 1);
    const y = clamp(values[1], 0, 1);
    const w = clamp(values[2], 0, 1 - x);
    const h = clamp(values[3], 0, 1 - y);
    if (w <= 0 || h <= 0) throw new Error('녹화 영역이 비어 있어요. 너비와 높이가 있는 영역을 다시 선택해 주세요.');
    const left = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth + 1e-7));
    const top = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight + 1e-7));
    const right = Math.min(sourceWidth, Math.ceil((x + w) * sourceWidth - 1e-7));
    const bottom = Math.min(sourceHeight, Math.ceil((y + h) * sourceHeight - 1e-7));
    return {x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top)};
  }

  async function extractGifFrames(blob, {start = 0, end, fps = 10, width = 800, region, maxFrames = 600, onProgress, signal} = {}) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error('프레임으로 만들 녹화 영상이 없어요.');
    if (signal && signal.aborted) throw abortError();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(blob);
    const canvas = document.createElement('canvas');
    const frames = [];
    try {
      video.src = url;
      if (video.readyState < 1) await waitEvent(video, 'loadedmetadata', {signal});
      const duration = await finiteDuration(video, Number(end), signal);
      const from = clamp(Number(start) || 0, 0, duration);
      const to = Number.isFinite(Number(end)) ? clamp(Number(end), from, duration) : duration;
      const length = to - from;
      if (length < 0.02) throw new Error('변환할 구간을 0.02초 이상 선택해 주세요.');
      const rate = clamp(Number(fps) || 10, 1, 30);
      const limit = Math.floor(clamp(Number(maxFrames) || 600, 1, 600));
      const count = Math.ceil(length * rate - 1e-7);
      if (count > limit) throw new Error('선택한 구간은 ' + count + '프레임이에요. 최대 ' + limit + '프레임이 되도록 FPS를 줄이거나 구간을 짧게 선택해 주세요.');
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) throw new Error('영상 크기를 읽지 못했어요. 다시 녹화해 주세요.');
      // Area selection uses normalized source coordinates. Crop before sizing so
      // the selected area's aspect ratio and output dimensions remain accurate.
      const sourceRegion = sourceRegionPixels(region, sourceWidth, sourceHeight);
      const requestedWidth = clamp(Number(width) || 800, 1, 1280);
      const scale = Math.min(1, requestedWidth / sourceRegion.width, 1280 / Math.max(sourceRegion.width, sourceRegion.height));
      const targetWidth = Math.max(1, Math.round(sourceRegion.width * scale));
      const targetHeight = Math.max(1, Math.round(sourceRegion.height * scale));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) throw new Error('이미지 처리 화면을 준비하지 못했어요. 출력 크기를 줄여 다시 시도해 주세요.');
      callback(onProgress, {phase: 'extracting', current: 0, total: count});
      for (let i = 0; i < count; i++) {
        if (signal && signal.aborted) throw abortError();
        const position = from + i / rate;
        // The last sample is inside the decodable range, never at video.duration.
        await seekVideo(video, Math.min(position, Math.max(0, duration - 0.001)), signal);
        context.drawImage(video, sourceRegion.x, sourceRegion.y, sourceRegion.width, sourceRegion.height, 0, 0, targetWidth, targetHeight);
        const imageBlob = await pngBlob(canvas, signal);
        const remaining = (to - position) * 1000;
        frames.push({blob: imageBlob, width: targetWidth, height: targetHeight, delay: Math.max(20, Math.min(1000 / rate, remaining))});
        callback(onProgress, {phase: 'extracting', current: i + 1, total: count});
      }
      return {frames, width: targetWidth, height: targetHeight, sourceRegion, duration: frames.reduce((sum, frame) => sum + frame.delay, 0) / 1000};
    } catch (error) {
      frames.length = 0;
      if (error && error.name === 'AbortError') throw error;
      throw new Error(captureMessage(error), {cause: error});
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 1;
    }
  }

  global.GifCapture = GifCapture;
  global.extractGifFrames = extractGifFrames;
})(window);
