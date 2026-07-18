(function () {
  'use strict';

  const ROOT = document.getElementById('app');
  if (!ROOT) return;

  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ACTIVE_ANIMATIONS = new Set();
  const MANAGED_SELECTOR = [
    '.screen',
    '.topbar', '.page-titlebar', '.subpage-titlebar', '.v4-home-header',
    '.lux-home-header', '.lux-search', '.lux-motto', '.lux-hero',
    '.lux-shortcuts', '.lux-daily', '.lux-page-heading',
    '.lux-level-hero', '.lux-feature-list', '.lux-settings-hero',
    '.profile-name-card', '.name-setup-sheet', '.lux-stats-hero',
    '.search-wrap', '.segmented', '.list-toolbar', '.favorite-level-tabs',
    '.v4-continue-hero', '.v4-daily-card', '.v4-quick-actions', '.v4-simple-actions',
    '.hero-card', '.stats-hero', '.test-hero', '.writing-intro', '.cards-hero',
    '.word-focus-card', '.question-card', '.ghost-writing-card', '.guided-writing-card',
    '.complete-card', '.result-hero', '.empty-state', '.favorite-level-summary',
    '.settings-group', '.privacy-card',
    '.round-card', '.round-mini', '.word-row', '.level-card', '.stat-card',
    '.deck-card', '.manual-card-row', '.mistake-row', '.answer-option', '.mode-option',
    '.size-option', '.source-option', '.quick-card', '.v4-quick-card', '.v4-simple-card',
    '.home-more-link', '.more-tools-grid', '.more-tool-card', '.more-review-banner',
    '.lux-metric', '.lux-shortcut', '.lux-feature-card'
  ].join(',');

  let scheduledFrame = 0;
  let renderGeneration = 0;

  installMotionStyles();
  updateMotionMode();

  const rootObserver = new MutationObserver(() => scheduleEntrance());
  rootObserver.observe(ROOT, { childList: true, subtree: true });

  const modeObserver = new MutationObserver(updateMotionMode);
  modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });

  if (typeof REDUCED_MOTION.addEventListener === 'function') {
    REDUCED_MOTION.addEventListener('change', updateMotionMode);
  } else if (typeof REDUCED_MOTION.addListener === 'function') {
    REDUCED_MOTION.addListener(updateMotionMode);
  }

  scheduleEntrance();

  function installMotionStyles() {
    if (document.getElementById('motion-v4-styles')) return;
    const style = document.createElement('style');
    style.id = 'motion-v4-styles';
    style.textContent = `
      html.motion-v4-on .motion-v4-managed{animation:none!important}
      html.motion-v4-on button:not(:disabled){transition:transform 150ms ease,box-shadow 180ms ease,border-color 180ms ease,background-color 180ms ease,color 180ms ease}
      html.motion-v4-on button:not(:disabled):active{transform:translateY(1px) scale(.988)!important}
      @media (hover:hover){html.motion-v4-on button:not(:disabled):hover{transition-duration:150ms}}
      html.motion-v4-on .v4-continue-hero:after{animation:none!important}
      html.motion-v4-on .hero-card:before,html.motion-v4-on .hero-card:after{animation:none!important}
      html.motion-v4-on .empty-illustration{animation:none!important}
      html.motion-v4-on .focus-fav.active .icon,html.motion-v4-on .row-action.favorite .icon{animation:motion-v4-heart 280ms cubic-bezier(.22,.72,.28,1) both!important}
      html.motion-v4-on .nav-item.active>.icon,html.motion-v4-on .nav-item.active .nav-orb{animation:motion-v4-nav 260ms cubic-bezier(.22,.72,.28,1) both!important}
      html.motion-v4-on .complete-icon{animation:motion-v4-reveal 340ms cubic-bezier(.22,.72,.28,1) both!important}
      html.motion-v4-on .progress-ring,html.motion-v4-on .daily-ring,html.motion-v4-on .result-ring{animation:motion-v4-reveal 360ms cubic-bezier(.22,.72,.28,1) both!important}
      html.motion-v4-on .favorite-level-tabs button.active{animation:motion-v4-nav 240ms cubic-bezier(.22,.72,.28,1) both!important}
      html.motion-v4-on .mini-track i,html.motion-v4-on .wide-track i,html.motion-v4-on .learn-track i{animation-duration:380ms!important;animation-delay:40ms!important}
      html.motion-v4-on .sound-btn.speaking:before,html.motion-v4-on .example-sound-btn.speaking:before{animation-duration:420ms!important}
      html.motion-v4-on .sound-btn.speaking .icon,html.motion-v4-on .example-sound-btn.speaking .icon{animation-duration:210ms!important;animation-iteration-count:2!important}
      @keyframes motion-v4-heart{0%{transform:scale(.96)}55%{transform:scale(1.07)}100%{transform:none}}
      @keyframes motion-v4-nav{from{opacity:.68;transform:translateY(2px)}to{opacity:1;transform:none}}
      @keyframes motion-v4-reveal{from{opacity:.58;transform:translateY(5px)}to{opacity:1;transform:none}}
      html.motion-v4-off *,html.motion-v4-off *:before,html.motion-v4-off *:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
      @media (prefers-reduced-motion:reduce){
        html *,html *:before,html *:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
      }
    `;
    document.head.appendChild(style);
  }

  function motionEnabled() {
    return !REDUCED_MOTION.matches && document.documentElement.dataset.motion !== 'reduced';
  }

  function updateMotionMode() {
    const enabled = motionEnabled();
    document.documentElement.classList.toggle('motion-v4-on', enabled);
    document.documentElement.classList.toggle('motion-v4-off', !enabled);
    if (!enabled) {
      cancelActiveAnimations();
      return;
    }
    scheduleEntrance();
  }

  function cancelActiveAnimations() {
    ACTIVE_ANIMATIONS.forEach(animation => {
      try { animation.cancel(); } catch (_error) { /* Animation may already be detached. */ }
    });
    ACTIVE_ANIMATIONS.clear();
  }

  function scheduleEntrance() {
    if (!motionEnabled() || scheduledFrame) return;
    const generation = ++renderGeneration;
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = 0;
      if (generation !== renderGeneration || !motionEnabled()) return;
      animateCurrentScreen();
    });
  }

  function animateCurrentScreen() {
    const screen = ROOT.querySelector(':scope > .screen');
    if (!screen || screen.dataset.motionV4Ready === 'true') return;
    screen.dataset.motionV4Ready = 'true';

    const managed = Array.from(screen.querySelectorAll(MANAGED_SELECTOR));
    managed.unshift(screen);
    managed.forEach(element => element.classList.add('motion-v4-managed'));

    runAnimation(screen, [
      { opacity: 0.72 },
      { opacity: 1 }
    ], { duration: 220, delay: 0 });

    const targets = entranceTargets(screen);
    targets.forEach((element, index) => {
      const isPrimaryCard = element.matches('.word-focus-card,.question-card,.ghost-writing-card,.guided-writing-card,.complete-card,.result-hero');
      const isAnswered = element.matches('.answered-correct,.answered-wrong');
      const delay = Math.min(index * 24, 144);
      const duration = isPrimaryCard ? 340 : 280;
      let frames = [
        { opacity: 0, transform: 'translateY(7px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ];
      if (isAnswered && element.classList.contains('answered-wrong')) {
        frames = [
          { opacity: 0.76, transform: 'translateX(4px)' },
          { opacity: 1, transform: 'translateX(-3px)', offset: 0.55 },
          { opacity: 1, transform: 'translateX(0)' }
        ];
      }
      runAnimation(element, frames, { duration, delay });
    });
  }

  function entranceTargets(screen) {
    if (screen.classList.contains('home-screen')) {
      return directMatches(screen, [
        '.lux-home-header', '.lux-search', '.lux-motto', '.lux-hero',
        '.lux-shortcuts', '.lux-daily',
        '.v4-home-header', '.search-wrap', '.v4-continue-hero',
        '.v4-daily-card', '.v4-quick-actions', '.v4-simple-actions',
        '.home-more-link', '.section'
      ]).slice(0, 10);
    }

    const priority = directMatches(screen, [
      'header', '.lux-page-heading', '.lux-level-hero', '.lux-settings-hero',
      '.lux-stats-hero', '.profile-name-card', '.name-setup-sheet',
      '.search-wrap', '.segmented', '.list-toolbar', '.favorite-level-tabs',
      '.hero-card', '.stats-hero', '.test-hero', '.writing-intro', '.cards-hero',
      '.word-focus-card', '.question-card', '.ghost-writing-card', '.guided-writing-card',
      '.complete-card', '.result-hero', '.favorite-level-summary', '.empty-state',
      '.settings-group', '.privacy-card', '.section', '.complete-actions',
      '.more-tools-grid', '.more-review-banner'
    ]);

    const listItems = Array.from(screen.querySelectorAll([
      '.round-card', '.round-mini', '.word-row', '.level-card', '.stat-card',
      '.deck-card', '.manual-card-row', '.mistake-row', '.answer-option',
      '.mode-option', '.size-option', '.source-option', '.quick-card', '.v4-quick-card',
      '.v4-simple-card', '.more-tool-card', '.lux-metric', '.lux-shortcut',
      '.lux-feature-card'
    ].join(','))).slice(0, 8);

    return uniqueElements(priority.concat(listItems)).slice(0, 12);
  }

  function directMatches(parent, selectors) {
    const children = Array.from(parent.children);
    return children.filter(child => selectors.some(selector => child.matches(selector)));
  }

  function uniqueElements(elements) {
    return elements.filter((element, index) => elements.indexOf(element) === index);
  }

  function runAnimation(element, keyframes, options) {
    if (!element || typeof element.animate !== 'function' || !motionEnabled()) return;
    const animation = element.animate(keyframes, {
      duration: options.duration,
      delay: options.delay,
      easing: 'cubic-bezier(.22,.72,.28,1)',
      fill: 'both'
    });
    ACTIVE_ANIMATIONS.add(animation);
    const finish = () => {
      ACTIVE_ANIMATIONS.delete(animation);
      try { animation.cancel(); } catch (_error) { /* Node may have been replaced. */ }
    };
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', () => ACTIVE_ANIMATIONS.delete(animation), { once: true });
  }
})();
