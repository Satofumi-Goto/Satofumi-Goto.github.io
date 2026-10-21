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
  const showRetry = () => {
    start.hidden = false;
    start.disabled = false;
    start.querySelector('span').textContent = ja ? 'もう一度、再生する' : 'Try playing again';
  };
  const stream = () => language.value === 'en' ? video.dataset.streamEn : video.dataset.stream;
  const load = (position = 0, resume = true) => {
    const version = ++generation;
    if (player) { player.destroy(); player = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    initialized = true;
    start.disabled = true;
    start.querySelector('span').textContent = ja ? '読み込み中…' : 'Loading…';
    const ready = () => {
      if (version !== generation) return;
      video.currentTime = Math.min(position, Math.max(0, (video.duration || 300) - .1));
      start.disabled = false;
      if (resume) video.play().catch(showRetry);
      else { start.hidden = position > 0; start.querySelector('span').textContent = ja ? '▶ 映像を見る（4分41秒）' : '▶ Watch the film (4:41)'; }
    };
    if (window.Hls && Hls.isSupported()) {
      player = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 40 });
      player.on(Hls.Events.MANIFEST_PARSED, ready);
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || version !== generation) return;
        player.destroy(); player = null; initialized = false; showRetry();
      });
      player.loadSource(stream());
      player.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.addEventListener('loadedmetadata', ready, { once: true });
      video.src = stream();
    } else {
      initialized = false; start.disabled = false;
      start.querySelector('span').textContent = ja ? '最新のブラウザーでご覧ください' : 'Please use a current browser';
    }
  };
  const play = () => initialized ? video.play().catch(showRetry) : load();
  language.addEventListener('change', () => {
    video.lang = language.value;
    if (initialized) load(video.currentTime, !video.paused);
  });
  video.lang = language.value;
  start.addEventListener('click', play);
  video.addEventListener('playing', () => { start.hidden = true; start.disabled = false; });
  video.addEventListener('error', showRetry);
  fullscreen.addEventListener('click', () => {
    if (!initialized) play();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
})();
