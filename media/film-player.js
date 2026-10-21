(() => {
  const section = document.querySelector('.vision-film');
  if (!section) return;
  const video = section.querySelector('video');
  const start = section.querySelector('.film-start');
  const fullscreen = section.querySelector('.film-fullscreen');
  const ja = document.documentElement.lang === 'ja';
  let player = null;
  let initialized = false;
  const showRetry = () => {
    start.hidden = false;
    start.disabled = false;
    start.querySelector('span').textContent = ja ? 'もう一度、再生する' : 'Try playing again';
  };
  const play = () => {
    start.disabled = true;
    start.querySelector('span').textContent = ja ? '読み込み中…' : 'Loading…';
    if (!initialized) {
      initialized = true;
      if (window.Hls && Hls.isSupported()) {
        player = new Hls({ maxBufferLength: 20, maxMaxBufferLength: 40 });
        player.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(showRetry));
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          player.destroy();
          player = null;
          initialized = false;
          showRetry();
        });
        player.loadSource(video.dataset.stream);
        player.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = video.dataset.stream;
        video.play().catch(showRetry);
      } else {
        initialized = false;
        start.disabled = false;
        start.querySelector('span').textContent = ja ? '最新のブラウザーでご覧ください' : 'Please use a current browser';
      }
    } else video.play().catch(showRetry);
  };
  start.addEventListener('click', play);
  video.addEventListener('playing', () => { start.hidden = true; start.disabled = false; });
  video.addEventListener('error', showRetry);
  fullscreen.addEventListener('click', () => {
    if (!initialized) play();
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });
})();
