import '/shared/viewer/model-viewer.js';

for (const card of document.querySelectorAll('.model-preview')) {
  const host = card.querySelector('.model-host');
  const status = card.querySelector('.model-status');
  const clips = card.querySelector('.model-clips');
  const play = card.querySelector('.model-play');
  const rest = card.querySelector('.model-rest');
  const speed = card.querySelector('.model-speed');
  const seek = card.querySelector('.model-seek');
  const time = card.querySelector('.model-time');
  let viewer, generation = 0;
  function controls(enabled) {
    for (const control of [play, speed, seek]) control.disabled = !enabled;
  }
  function update() {
    const duration = viewer?.duration || 0;
    const current = viewer?.currentTime || 0;
    seek.max = duration || 1;
    seek.value = current;
    time.textContent = `${current.toFixed(2)} / ${duration.toFixed(2)} s`;
    play.textContent = viewer?.paused ? 'Play' : 'Pause';
  }
  function loadRest() {
    const currentGeneration = ++generation;
    viewer?.pause();
    viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', card.dataset.src);
    viewer.setAttribute('alt', card.dataset.name);
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('touch-action', 'pan-y');
    viewer.setAttribute('shadow-intensity', '1');
    viewer.setAttribute('animation-crossfade-duration', '0');
    viewer.setAttribute('interaction-prompt', 'none');
    viewer.setAttribute('loading', 'eager');
    viewer.timeScale = Number(speed.value);
    controls(false); clips.disabled = true; rest.disabled = true;
    status.textContent = 'Loading 3D preview…';
    clips.replaceChildren(new Option('Rest pose', ''));
    viewer.addEventListener('load', () => {
      if (generation !== currentGeneration) return;
      const names = viewer.availableAnimations;
      names.forEach((name, i) => clips.add(new Option(name.replace(/^.*\|/, '').replace(/\.\d+$/, '').replaceAll('_', ' '), String(i))));
      clips.disabled = !names.length; rest.disabled = false;
      status.textContent = names.length ? `${names.length} animations · choose a clip. Drag to rotate; pinch or scroll to zoom.` : 'No animations embedded. Drag to rotate; pinch or scroll to zoom.';
      update();
    });
    viewer.addEventListener('error', () => { status.textContent = '3D preview could not load. You can still download the model below.'; controls(false); clips.disabled = true; rest.disabled = true; });
    viewer.addEventListener('play', update);
    viewer.addEventListener('pause', update);
    host.replaceChildren(viewer);
    update();
  }
  clips.addEventListener('change', async () => {
    if (clips.value === '') return loadRest();
    const selected = viewer; const version = generation;
    selected.pause(); selected.animationName = selected.availableAnimations[Number(clips.value)];
    await selected.updateComplete;
    if (viewer !== selected || generation !== version) return;
    selected.currentTime = 0; selected.timeScale = Number(speed.value); selected.play(); controls(true); update();
  });
  play.addEventListener('click', () => { viewer.paused ? viewer.play() : viewer.pause(); update(); });
  rest.addEventListener('click', loadRest);
  speed.addEventListener('change', () => { viewer.timeScale = Number(speed.value); });
  seek.addEventListener('input', () => { const targetTime = Number(seek.value); viewer.pause(); const rate = viewer.timeScale; viewer.timeScale = 1; viewer.currentTime = targetTime; viewer.timeScale = rate; update(); });
  loadRest();
  // Only update visible active players; model-viewer suspends offscreen rendering.
  setInterval(() => { if (!document.hidden && viewer && !viewer.paused) update(); }, 100);
}


