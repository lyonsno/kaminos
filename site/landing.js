const header = document.querySelector('[data-header]');
const menuButton = document.querySelector('[data-menu-button]');
const nav = document.querySelector('[data-nav]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setMenuOpen(open) {
  menuButton?.setAttribute('aria-expanded', String(open));
  nav?.classList.toggle('is-open', open);
  header?.classList.toggle('is-menu-open', open);
  document.body.classList.toggle('menu-open', open);
}

menuButton?.addEventListener('click', () => {
  setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
});

nav?.addEventListener('click', event => {
  if (event.target instanceof HTMLAnchorElement) setMenuOpen(false);
});

window.addEventListener('scroll', () => {
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
}, { passive: true });

const sections = [...document.querySelectorAll('[data-observe]')];

if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  sections.forEach(section => section.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  sections.forEach(section => observer.observe(section));
}
