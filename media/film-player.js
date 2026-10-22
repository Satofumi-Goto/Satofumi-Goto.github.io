(() => {
  const section = document.querySelector('.vision-film');
  if (!section) return;
  const video = section.querySelector('video');
  const start = section.querySelector('.film-start');
  const fullscreen = section.querySelector('.film-fullscreen');
  const language = section.querySelector('.film-language');
  const ja = document.documentElement.lang === 'ja';
  let player = null;
  let initialized = false;
  let generation = 0;
  let metadataReady = null;
  const showRetry = () => {
    start.hidden = false;
    start.disabled = false;
    start.querySelector('span').textContent = ja ? 'もう一度、再生する' : 'Try playing again';
  };
  const requestPlay = (version = generation) => {
    const attempt = video.play();
    if (attempt) attempt.catch(() => {
      if (version === generation) showRetry();
    });
  };
  const stream = () => language.value === 'en' ? video.dataset.streamEn : video.dataset.stream;
  const load = (position = 0, resume = true) => {
    const version = ++generation;
    if (metadataReady) video.removeEventListener('loadedmetadata', metadataReady);
    if (player) { player.destroy(); player = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    initialized = true;
    start.disabled = true;
    start.querySelector('span').textContent = ja ? '読み込み中…' : 'Loading…';
    metadataReady = () => {
      if (version !== generation) return;
      if (position > 0) video.currentTime = Math.min(position, Math.max(0, (video.duration || 300) - .1));
      start.disabled = false;
      if (!resume) { start.hidden = position > 0; start.querySelector('span').textContent = ja ? '再生して見る▶︎' : 'Play & watch ▶︎'; }
    };
    video.addEventListener('loadedmetadata', metadataReady, { once: true });
    // Prefer Safari/iPhone's native HLS path. ManagedMediaSource requires
    // additional AirPlay configuration and can otherwise stall before loading.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream();
      video.load();
      // Keep this inside the user's click/change handler. Waiting for metadata
      // loses the user gesture required for audible playback on iOS.
      if (resume) requestPlay(version);
    } else if (window.Hls && Hls.isSupported()) {
      player = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 40 });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        if (version !== generation) return;
        start.disabled = false;
        if (resume) requestPlay(version);
      });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || version !== generation) return;
        player.destroy(); player = null; initialized = false; showRetry();
      });
      player.loadSource(stream());
      player.attachMedia(video);
    } else {
      initialized = false; start.disabled = false;
      start.querySelector('span').textContent = ja ? '最新のブラウザーでご覧ください' : 'Please use a current browser';
    }
  };
  const play = () => { video.controls = true; return initialized ? requestPlay() : load(); };
  language.addEventListener('change', () => {
    video.lang = language.value;
    if (initialized) load(video.currentTime, !video.paused);
  });
  video.lang = language.value;
  start.addEventListener('click', play);
  video.addEventListener('playing', () => { start.hidden = true; start.disabled = false; });
  video.addEventListener('error', () => { initialized = false; showRetry(); });
  fullscreen.addEventListener('click', () => {
    if (!initialized) play();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) {
      // iPhone may reject fullscreen until metadata is available; inline
      // playback must keep working and the button remains available to retry.
      try { video.webkitEnterFullscreen(); } catch (_error) {}
    }
  });
})();
