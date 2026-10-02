// Scroll-aware visual navigation. Keep tabs available to keyboard and screen readers.
export function initNavigation() {
  const bar = document.querySelector('.tabbar');
  const compact = matchMedia('(max-width: 1199px), (any-pointer: coarse)');
  const editable = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="file"]), textarea, [contenteditable="true"]';
  let suspended = false, last = 0, direction = 0, travel = 0, scheduled = false, resizingUntil = 0;
  const position = () => {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return { max, y: Math.min(max, Math.max(0, scrollY)) };
  };
  const inNavigation = () => bar.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
  const editing = () => !suspended && compact.matches && document.activeElement?.matches(editable);
  function reveal() { bar.classList.remove('nav-hidden'); }
  function reset() {
    last = position().y; direction = 0; travel = 0;
    reveal(); bar.classList.toggle('nav-editing', Boolean(editing()));
  }
  function update() {
    scheduled = false;
    const { y, max } = position(), delta = y - last;
    last = y;
    if (!compact.matches || suspended || inNavigation() || performance.now() < resizingUntil) { reveal(); travel = 0; return; }
    if (editing()) { travel = 0; return; }
    // Hiện ở đầu trang và trang ngắn. Ở cuối trang KHÔNG tự hiện: chỉ hiện khi người dùng kéo ngược lên.
    // y đã bị kẹp trong [0, max] nên hiệu ứng nảy (rubber-band) ở cuối trang không tạo ra delta.
    if (y <= 64 || max <= 96) { reveal(); travel = 0; direction = 0; return; }
    if (Math.abs(delta) < 1) return;
    const nextDirection = Math.sign(delta);
    if (nextDirection !== direction) { direction = nextDirection; travel = 0; }
    travel += Math.abs(delta);
    // Ignore a small finger wobble; restore more readily than we hide.
    if (direction > 0 && travel >= 36) bar.classList.add('nav-hidden');
    else if (direction < 0 && travel >= 14) reveal();
  }
  addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }, { passive:true });
  // Rotation and keyboard resizing can move content through scroll anchoring.
  function resized() { resizingUntil = performance.now() + 180; reset(); }
  addEventListener('resize', resized, { passive:true });
  addEventListener('pageshow', reset);
  compact.addEventListener('change', resized);
  window.visualViewport?.addEventListener('resize', resized, { passive:true });
  document.addEventListener('focusin', reset);
  document.addEventListener('focusout', () => requestAnimationFrame(reset));
  reset();
  return { reset, suspend(value) { suspended = value; reset(); } };
}
