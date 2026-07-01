// Adds `.in` to `.reveal` elements as they enter the viewport. No-op when the
// user prefers reduced motion (CSS already shows them; this just avoids observing).
// Mark document as JS-ready so CSS can safely apply the hidden state; without
// this flag, .reveal elements are fully visible (no-JS fallback).
document.documentElement.classList.add('js-ready');
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
