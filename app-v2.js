(function () {
  'use strict';

  const WORDS = Array.isArray(window.WORDS_DATA) ? window.WORDS_DATA : [];
  const APP_KEY = 'oxford3000ArabicApp.v4';
  const PREVIOUS_APP_KEYS = ['oxford3000ArabicApp.v3', 'oxford3000ArabicApp.v2'];
  const OLD_PROGRESS_KEY = 'oxford3000ArabicExamplesProgress.v1';
  const LEVELS = ['A1', 'A2', 'B1', 'B2'];
  const LEVEL_NAMES = { A1: 'مبتدئ', A2: 'فوق المبتدئ', B1: 'متوسط', B2: 'فوق المتوسط' };
  const SCREENS = ['home', 'levels', 'learn', 'tests', 'writing', 'cards', 'favorites', 'stats', 'settings', 'more'];
  const TEST_MODES = ['meaning', 'reverse', 'listening', 'spelling', 'mixed'];
  const TEST_SIZES = [10, 25, 50, 'all'];
  const TEST_SESSION_LEVELS = ['A1', 'A2', 'B1', 'B2', 'ALL'];
  const DAILY_SIZE = 50;
  const ROOT = document.getElementById('app');
  const TOAST = document.getElementById('toast');
  const WORD_BY_ID = new Map(WORDS.map(word => [Number(word.id), word]));
  const LEVEL_WORDS = Object.fromEntries(LEVELS.map(level => [level, WORDS.filter(word => word.level === level)]));
  const MIXED_WORDS = buildMixedWords();

  let toastTimer = null;
  let speechAnimationTimer = null;
  let activeSpeechButton = null;
  let autoSpeechTimer = null;
  let autoSentenceTimer = null;
  let testAudioTimer = null;
  let lastAutoSpokenToken = '';
  let lastTestAudioToken = '';
  let lastWritingAudioToken = '';
  let lastCardAudioToken = '';
  let undoSnapshot = null;
  let actionLocked = false;
  let navigationDepth = 0;
  let uiAudioContext = null;
  let velvetSoundPool = [];
  let velvetSoundCursor = 0;
  let state = loadState();

  if (!validateDataset()) {
    ROOT.innerHTML = `<div class="error-card"><h1>تعذّر تحميل الكلمات</h1><p>بيانات القاموس غير مكتملة. أعد تثبيت التطبيق.</p></div>`;
    return;
  }

  migrateOldProgress();
  ensureDailyPlan();
  normalizeActiveSession();
  applyTheme(false);
  installHistory();
  saveState();
  render();

  function validateDataset() {
    if (WORDS.length !== 3308 || WORD_BY_ID.size !== WORDS.length) return false;
    return WORDS.every(word => Number.isInteger(Number(word.id)) && word.word && word.arabic && word.level && Array.isArray(word.examples));
  }

  function buildMixedWords() {
    const mixed = [];
    const max = Math.max(...LEVELS.map(level => LEVEL_WORDS[level].length));
    for (let index = 0; index < max; index += 1) {
      LEVELS.forEach(level => {
        if (LEVEL_WORDS[level][index]) mixed.push(LEVEL_WORDS[level][index]);
      });
    }
    return mixed;
  }

  function defaultState() {
    return {
      version: 4,
      theme: 'light',
      screen: 'home',
      userName: '',
      nameSetupSkipped: false,
      activeLevel: 'A1',
      progress: {},
      favorites: [],
      activityDates: [],
      positions: {},
      daily: null,
      activeSession: null,
      search: '',
      favoriteSearch: '',
      favoriteFilter: 'ALL',
      settings: {
        autoSpeakWord: true,
        autoSpeakSentence: false,
        haptics: true,
        animations: true,
        speechRate: 0.86,
        navigationSounds: true
      },
      mastery: {},
      mistakes: {},
      testHistory: [],
      testSession: null,
      testView: 'center',
      testConfig: { level: 'A1', size: 10, mode: 'mixed' },
      mistakeFilter: 'ALL',
      writingSource: 'daily',
      writingSession: null,
      cardDecks: [],
      selectedDeckId: '',
      cardsView: 'center',
      editingCardId: '',
      cardTestMode: 'mixed',
      cardPractice: null,
      cardStats: {},
      cardHistory: [],
      migratedV1: false
    };
  }

  function loadState() {
    const defaults = defaultState();
    let stored = null;
    for (const key of [APP_KEY, ...PREVIOUS_APP_KEYS]) {
      try {
        const candidate = JSON.parse(localStorage.getItem(key));
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          stored = candidate;
          break;
        }
      } catch (_error) {
        // Fall back to the previous schema or a clean state.
      }
    }
    if (!stored) return defaults;

    const baseSettings = Object.assign({}, defaults.settings);
    const merged = Object.assign(defaults, stored);
    merged.version = 4;
    if (!['light', 'dark'].includes(merged.theme)) merged.theme = 'light';
    if (!SCREENS.includes(merged.screen)) merged.screen = 'home';
    merged.userName = cleanManualText(stored.userName, 24);
    merged.nameSetupSkipped = stored.nameSetupSkipped === true;
    if (!LEVELS.includes(merged.activeLevel)) merged.activeLevel = 'A1';
    if (!merged.progress || typeof merged.progress !== 'object' || Array.isArray(merged.progress)) merged.progress = {};
    if (!Array.isArray(merged.favorites)) merged.favorites = [];
    if (!Array.isArray(merged.activityDates)) merged.activityDates = [];
    if (!merged.positions || typeof merged.positions !== 'object' || Array.isArray(merged.positions)) merged.positions = {};

    const rawSettings = stored.settings && typeof stored.settings === 'object' ? stored.settings : {};
    merged.settings = Object.assign({}, baseSettings, rawSettings);
    merged.settings.autoSpeakWord = merged.settings.autoSpeakWord !== false;
    merged.settings.autoSpeakSentence = merged.settings.autoSpeakSentence === true;
    merged.settings.haptics = merged.settings.haptics !== false;
    merged.settings.animations = merged.settings.animations !== false;
    merged.settings.navigationSounds = merged.settings.navigationSounds !== false;
    const requestedRate = Number(merged.settings.speechRate);
    merged.settings.speechRate = [0.72, 0.86, 1].includes(requestedRate) ? requestedRate : 0.86;

    merged.favorites = [...new Set(merged.favorites.map(Number).filter(id => WORD_BY_ID.has(id)))];
    merged.activityDates = [...new Set(merged.activityDates.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].slice(-180);
    Object.keys(merged.progress).forEach(id => {
      if (!WORD_BY_ID.has(Number(id)) || !['learned', 'review'].includes(merged.progress[id])) delete merged.progress[id];
    });

    const normalizedMastery = {};
    if (stored.mastery && typeof stored.mastery === 'object' && !Array.isArray(stored.mastery)) {
      Object.entries(stored.mastery).forEach(([id, value]) => {
        if (!WORD_BY_ID.has(Number(id)) || !value || typeof value !== 'object') return;
        normalizedMastery[id] = {
          score: clampInt(value.score, 0, 5),
          correct: clampInt(value.correct, 0, 100000),
          wrong: clampInt(value.wrong, 0, 100000),
          streak: clampInt(value.streak, 0, 100000),
          lastSeen: Number(value.lastSeen) || 0
        };
      });
    }
    merged.mastery = normalizedMastery;

    const normalizedMistakes = {};
    if (stored.mistakes && typeof stored.mistakes === 'object' && !Array.isArray(stored.mistakes)) {
      Object.entries(stored.mistakes).forEach(([id, value]) => {
        if (!WORD_BY_ID.has(Number(id)) || !value || typeof value !== 'object') return;
        normalizedMistakes[id] = {
          count: clampInt(value.count, 1, 100000),
          lastWrongAt: Number(value.lastWrongAt) || 0,
          lastType: TEST_MODES.includes(value.lastType) ? value.lastType : 'mixed',
          correctStreak: clampInt(value.correctStreak, 0, 3),
          active: value.active !== false
        };
      });
    }
    merged.mistakes = normalizedMistakes;

    merged.testHistory = Array.isArray(stored.testHistory) ? stored.testHistory.filter(item => item && typeof item === 'object' && TEST_SESSION_LEVELS.includes(item.level) && Number(item.total) > 0).slice(0, 30) : [];
    merged.testSession = normalizeTestSession(stored.testSession);
    merged.testView = ['center', 'setup', 'session', 'result', 'mistakes'].includes(stored.testView) ? stored.testView : 'center';
    if (!merged.testSession && ['session', 'result'].includes(merged.testView)) merged.testView = 'center';
    const rawConfig = stored.testConfig && typeof stored.testConfig === 'object' ? stored.testConfig : {};
    merged.testConfig = {
      level: LEVELS.includes(rawConfig.level) ? rawConfig.level : 'A1',
      size: TEST_SIZES.includes(rawConfig.size) ? rawConfig.size : 10,
      mode: TEST_MODES.includes(rawConfig.mode) ? rawConfig.mode : 'mixed'
    };
    merged.mistakeFilter = stored.mistakeFilter === 'ALL' || LEVELS.includes(stored.mistakeFilter) ? stored.mistakeFilter : 'ALL';
    merged.search = typeof stored.search === 'string' ? stored.search.slice(0, 120) : '';
    merged.favoriteSearch = typeof stored.favoriteSearch === 'string' ? stored.favoriteSearch.slice(0, 120) : '';
    merged.favoriteFilter = stored.favoriteFilter === 'ALL' || LEVELS.includes(stored.favoriteFilter) ? stored.favoriteFilter : 'ALL';
    merged.writingSource = stored.writingSource === 'daily' || LEVELS.includes(stored.writingSource) ? stored.writingSource : 'daily';
    merged.writingSession = normalizeWritingSession(stored.writingSession);
    merged.cardDecks = normalizeCardDecks(stored.cardDecks);
    merged.selectedDeckId = merged.cardDecks.some(deck => deck.id === String(stored.selectedDeckId || '')) ? String(stored.selectedDeckId) : (merged.cardDecks[0] ? merged.cardDecks[0].id : '');
    merged.cardsView = ['center', 'deck', 'deck-form', 'card-form', 'practice', 'result'].includes(stored.cardsView) ? stored.cardsView : 'center';
    merged.editingCardId = typeof stored.editingCardId === 'string' ? stored.editingCardId : '';
    merged.cardTestMode = TEST_MODES.includes(stored.cardTestMode) ? stored.cardTestMode : 'mixed';
    merged.cardPractice = normalizeCardPractice(stored.cardPractice, merged.cardDecks);
    if (!merged.cardPractice && ['practice', 'result'].includes(merged.cardsView)) merged.cardsView = merged.selectedDeckId ? 'deck' : 'center';
    const validCardIds = new Set(merged.cardDecks.flatMap(deck => deck.cards.map(card => card.id)));
    merged.cardStats = normalizeCardStats(stored.cardStats, validCardIds);
    merged.cardHistory = Array.isArray(stored.cardHistory) ? stored.cardHistory.filter(item => item && typeof item === 'object' && Number(item.total) > 0 && merged.cardDecks.some(deck => deck.id === String(item.deckId || ''))).slice(0, 30) : [];
    return merged;
  }

  function normalizeWritingSession(value) {
    if (!value || typeof value !== 'object') return null;
    const source = value.source === 'daily' || LEVELS.includes(value.source) ? value.source : 'daily';
    const ids = Array.isArray(value.ids) ? [...new Set(value.ids.map(Number).filter(id => WORD_BY_ID.has(id)))] : [];
    if (!ids.length) return null;
    return {
      id: String(value.id || `writing-${Date.now()}`),
      source,
      ids,
      index: clampInt(value.index, 0, ids.length),
      correct: clampInt(value.correct, 0, ids.length),
      skipped: clampInt(value.skipped, 0, ids.length),
      hintVisible: value.hintVisible !== false,
      feedback: value.feedback && typeof value.feedback === 'object' ? {
        correct: value.feedback.correct === true,
        typed: String(value.feedback.typed || '').slice(0, 120)
      } : null,
      startedAt: Number(value.startedAt) || Date.now()
    };
  }

  function cleanManualText(value, max = 120) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeCardDecks(value) {
    if (!Array.isArray(value)) return [];
    const deckIds = new Set();
    const cardIds = new Set();
    return value.map((rawDeck, deckIndex) => {
      if (!rawDeck || typeof rawDeck !== 'object') return null;
      let id = String(rawDeck.id || `deck-${deckIndex}-${Date.now()}`);
      if (deckIds.has(id)) id = `${id}-${deckIndex}`;
      deckIds.add(id);
      const name = cleanManualText(rawDeck.name, 60) || `مجموعة ${deckIndex + 1}`;
      const cards = Array.isArray(rawDeck.cards) ? rawDeck.cards.map((rawCard, cardIndex) => {
        if (!rawCard || typeof rawCard !== 'object') return null;
        const english = cleanManualText(rawCard.english || rawCard.word, 120);
        const arabic = cleanManualText(rawCard.arabic || rawCard.meaning, 180);
        if (!english || !arabic) return null;
        let cardId = String(rawCard.id || `card-${deckIndex}-${cardIndex}-${Date.now()}`);
        if (cardIds.has(cardId)) cardId = `${cardId}-${deckIndex}-${cardIndex}`;
        cardIds.add(cardId);
        return { id: cardId, english, arabic, createdAt: Number(rawCard.createdAt) || Date.now(), updatedAt: Number(rawCard.updatedAt) || 0 };
      }).filter(Boolean) : [];
      return { id, name, cards, createdAt: Number(rawDeck.createdAt) || Date.now() };
    }).filter(Boolean).slice(0, 100);
  }

  function normalizeCardPractice(value, decks) {
    if (!value || typeof value !== 'object') return null;
    const deck = decks.find(item => item.id === String(value.deckId || ''));
    if (!deck) return null;
    const validIds = new Set(deck.cards.map(card => card.id));
    const ids = Array.isArray(value.ids) ? [...new Set(value.ids.map(String).filter(id => validIds.has(id)))] : [];
    if (!ids.length) return null;
    return {
      id: String(value.id || `cards-${Date.now()}`),
      deckId: deck.id,
      mode: TEST_MODES.includes(value.mode) ? value.mode : 'mixed',
      ids,
      index: clampInt(value.index, 0, ids.length),
      correct: clampInt(value.correct, 0, ids.length),
      answers: Array.isArray(value.answers) ? value.answers.filter(answer => answer && validIds.has(String(answer.id || ''))).slice(0, ids.length) : [],
      feedback: value.feedback && typeof value.feedback === 'object' ? value.feedback : null,
      status: value.status === 'result' ? 'result' : 'active',
      seed: clampInt(value.seed, 1, 2147483646),
      startedAt: Number(value.startedAt) || Date.now(),
      completedAt: Number(value.completedAt) || 0,
      historySaved: value.historySaved === true
    };
  }

  function normalizeCardStats(value, validIds) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    Object.entries(value).forEach(([id, raw]) => {
      if (!validIds.has(String(id)) || !raw || typeof raw !== 'object') return;
      result[id] = {
        seen: clampInt(raw.seen, 0, 100000),
        correct: clampInt(raw.correct, 0, 100000),
        wrong: clampInt(raw.wrong, 0, 100000),
        lastSeen: Number(raw.lastSeen) || 0
      };
    });
    return result;
  }

  function normalizeTestSession(value) {
    if (!value || typeof value !== 'object' || !TEST_SESSION_LEVELS.includes(value.level) || !TEST_MODES.includes(value.mode)) return null;
    const ids = Array.isArray(value.ids) ? value.ids.map(Number).filter(id => WORD_BY_ID.has(id)) : [];
    if (!ids.length || new Set(ids).size !== ids.length) return null;
    const answers = Array.isArray(value.answers) ? value.answers.filter(answer => answer && WORD_BY_ID.has(Number(answer.id))).slice(0, ids.length) : [];
    const status = value.status === 'result' ? 'result' : 'active';
    return {
      schema: 1,
      id: String(value.id || `test-${Date.now()}`),
      status,
      level: value.level,
      mode: value.mode,
      source: value.source === 'mistakes' ? 'mistakes' : 'level',
      ids,
      index: clampInt(value.index, 0, ids.length),
      correct: clampInt(value.correct, 0, ids.length),
      answers,
      feedback: value.feedback && typeof value.feedback === 'object' ? value.feedback : null,
      seed: clampInt(value.seed, 1, 2147483646),
      startedAt: Number(value.startedAt) || Date.now(),
      completedAt: Number(value.completedAt) || 0,
      historySaved: value.historySaved === true
    };
  }

  function saveState() {
    try {
      localStorage.setItem(APP_KEY, JSON.stringify(state));
    } catch (_error) {
      showToast('تعذّر حفظ التقدم على هذا الجهاز');
    }
  }

  function migrateOldProgress() {
    if (state.migratedV1) return;
    try {
      const old = JSON.parse(localStorage.getItem(OLD_PROGRESS_KEY));
      if (old && typeof old === 'object') {
        Object.entries(old).forEach(([id, value]) => {
          if (!WORD_BY_ID.has(Number(id)) || !value || typeof value !== 'object') return;
          const known = Number(value.known || 0);
          const review = Number(value.review || 0);
          if (known > 0 && known >= review) state.progress[id] = 'learned';
          else if (review > known) state.progress[id] = 'review';
        });
      }
    } catch (_error) {
      // A damaged V1 value should never stop V2 from loading.
    }
    state.migratedV1 = true;
    saveState();
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dateSeed(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const localMidnight = new Date(year, month - 1, day).getTime();
    const epoch = new Date(2026, 0, 1).getTime();
    return Math.max(0, Math.floor((localMidnight - epoch) / 86400000));
  }

  function dailyIdsFor(dateKey) {
    const start = (dateSeed(dateKey) * DAILY_SIZE) % MIXED_WORDS.length;
    return Array.from({ length: DAILY_SIZE }, (_, offset) => MIXED_WORDS[(start + offset) % MIXED_WORDS.length].id);
  }

  function ensureDailyPlan() {
    const today = localDateKey();
    const dailyValid = state.daily
      && Array.isArray(state.daily.ids)
      && state.daily.ids.length === DAILY_SIZE
      && new Set(state.daily.ids).size === DAILY_SIZE
      && state.daily.ids.every(id => WORD_BY_ID.has(Number(id)));

    if (dailyValid && !state.daily.completed && Number(state.daily.index) < DAILY_SIZE) {
      state.daily.index = clampInt(state.daily.index, 0, DAILY_SIZE);
      return state.daily;
    }
    if (dailyValid && state.daily.date === today) {
      state.daily.index = clampInt(state.daily.index, 0, DAILY_SIZE);
      return state.daily;
    }

    state.daily = {
      date: today,
      ids: dailyIdsFor(today),
      index: 0,
      completed: false
    };
    saveState();
    return state.daily;
  }

  function normalizeActiveSession() {
    if (!state.activeSession || typeof state.activeSession !== 'object') {
      state.activeSession = null;
      if (!state.testSession && ['session', 'result'].includes(state.testView)) state.testView = 'center';
      return;
    }
    const session = resolveSession(state.activeSession);
    if (!session.ids.length) {
      state.activeSession = null;
    }
    if (!state.testSession && ['session', 'result'].includes(state.testView)) state.testView = 'center';
  }

  function clampInt(value, min, max) {
    const number = Number.parseInt(value, 10);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#039;');
  }

  function normalizeSearch(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0640\u064B-\u065F\u0670]/g, '')
      .replace(/\s+/g, ' ');
  }

  function icon(name, extraClass = '') {
    return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function applyTheme(persist = true) {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.motion = state.settings.animations ? 'full' : 'reduced';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = state.theme === 'dark' ? '#0b1020' : '#f7f7ff';
    if (window.AndroidUi && typeof window.AndroidUi.setDarkMode === 'function') {
      try { window.AndroidUi.setDarkMode(state.theme === 'dark'); } catch (_error) { /* Web fallback. */ }
    }
    if (window.AndroidUi && typeof window.AndroidUi.setHapticsEnabled === 'function') {
      try { window.AndroidUi.setHapticsEnabled(state.settings.haptics); } catch (_error) { /* Web fallback. */ }
    }
    if (persist) saveState();
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    render();
  }

  function playVelvetClick(kind) {
    try {
      const slot = velvetSoundCursor % 2;
      velvetSoundCursor += 1;
      let sound = velvetSoundPool[slot];
      if (!sound) {
        sound = new Audio('ui-velvet-click.wav');
        sound.preload = 'auto';
        velvetSoundPool[slot] = sound;
      }
      sound.pause();
      sound.currentTime = 0;
      sound.volume = 1;
      sound.playbackRate = kind === 'back' ? 0.88 : 1;
      const playback = sound.play();
      if (playback && typeof playback.catch === 'function') playback.catch(() => playSynthUiTone(kind));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function playSynthUiTone(kind) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!uiAudioContext) uiAudioContext = new AudioContextClass();
      const emit = () => {
        if (!uiAudioContext || uiAudioContext.state === 'closed') return;
        const now = uiAudioContext.currentTime;
        const oscillator = uiAudioContext.createOscillator();
        const gain = uiAudioContext.createGain();
        const startFrequency = kind === 'success' ? 620 : kind === 'back' ? 390 : 470;
        const endFrequency = kind === 'back' ? 330 : startFrequency + 90;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(startFrequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + 0.075);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.022, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        oscillator.connect(gain);
        gain.connect(uiAudioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.095);
      };
      if (uiAudioContext.state === 'suspended') {
        const resumeResult = uiAudioContext.resume();
        if (resumeResult && typeof resumeResult.then === 'function') resumeResult.then(emit).catch(() => {});
        else emit();
      } else emit();
    } catch (_error) {
      // Navigation audio is a lightweight enhancement and must never block use.
    }
  }

  function playUiSound(kind = 'navigate') {
    if (!state.settings.navigationSounds || document.visibilityState === 'hidden') return;
    if ((kind === 'navigate' || kind === 'back') && playVelvetClick(kind)) return;
    playSynthUiTone(kind);
  }

  function installHistory() {
    const hashScreen = location.hash.replace('#', '');
    if (SCREENS.includes(hashScreen)) state.screen = hashScreen;
    history.replaceState({ screen: state.screen }, '', `#${state.screen}`);
    window.addEventListener('popstate', event => {
      navigationDepth = Math.max(0, navigationDepth - 1);
      const next = event.state && event.state.screen;
      state.screen = SCREENS.includes(next) ? next : 'home';
      saveState();
      playUiSound('back');
      render();
    });
  }

  function scrollAppTop() {
    if (ROOT) {
      try {
        ROOT.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch (_error) {
        ROOT.scrollTop = 0;
      }
    }
    const documentScroller = document.scrollingElement;
    if (documentScroller && documentScroller !== ROOT) documentScroller.scrollTop = 0;
  }

  function navigate(screen, push = true) {
    if (!SCREENS.includes(screen)) return;
    if (screen !== state.screen) playUiSound('navigate');
    if (screen !== 'learn') clearAutoSpeechTimers();
    state.screen = screen;
    saveState();
    if (push && location.hash !== `#${screen}`) {
      history.pushState({ screen }, '', `#${screen}`);
      navigationDepth += 1;
    }
    render();
    scrollAppTop();
  }

  window.appHandleBack = function () {
    if (state.screen === 'cards' && state.cardsView !== 'center') {
      stopSpeech();
      state.cardsView = state.cardsView === 'practice' || state.cardsView === 'result' || state.cardsView === 'card-form' ? 'deck' : 'center';
      saveState();
      playUiSound('back');
      render();
      return true;
    }
    if (state.screen === 'writing' && state.writingSession) {
      stopSpeech();
      state.writingSession = null;
      saveState();
      playUiSound('back');
      render();
      return true;
    }
    if (state.screen === 'tests' && state.testView !== 'center') {
      state.testView = 'center';
      saveState();
      playUiSound('back');
      render();
      return true;
    }
    if (navigationDepth > 0) {
      history.back();
      return true;
    }
    if (state.screen !== 'home') {
      state.screen = 'home';
      saveState();
      history.replaceState({ screen: 'home' }, '', '#home');
      render();
      return true;
    }
    return false;
  };

  function resolveSession(sessionState) {
    const raw = sessionState || {};
    const frozenIds = Array.isArray(raw.ids) ? raw.ids.map(Number).filter(id => WORD_BY_ID.has(id)) : [];
    if (raw.kind === 'daily') {
      const daily = ensureDailyPlan();
      return { kind: 'daily', key: `daily:${daily.date}`, title: 'التعلّم اليومي', ids: frozenIds.length ? frozenIds : daily.ids.map(Number), returnScreen: raw.returnScreen || 'home' };
    }
    if (raw.kind === 'round' && LEVELS.includes(raw.level)) {
      const round = clampInt(raw.round, 0, Math.ceil(LEVEL_WORDS[raw.level].length / 50) - 1);
      const ids = frozenIds.length ? frozenIds : LEVEL_WORDS[raw.level].slice(round * 50, round * 50 + 50).map(word => word.id);
      return { kind: 'round', key: `round:${raw.level}:${round}`, title: `${raw.level} — الجولة ${round + 1}`, ids, level: raw.level, round, returnScreen: raw.returnScreen || 'levels' };
    }
    if (raw.kind === 'favorites') {
      const level = LEVELS.includes(raw.level) ? raw.level : 'ALL';
      const favorites = state.favorites.filter(id => WORD_BY_ID.has(Number(id)) && (level === 'ALL' || WORD_BY_ID.get(Number(id)).level === level)).map(Number);
      const ids = frozenIds.length ? frozenIds : favorites;
      return { kind: 'favorites', key: `favorites:${level}`, title: level === 'ALL' ? 'مراجعة كل المحفوظات' : `مراجعة محفوظات ${level}`, ids, level, returnScreen: raw.returnScreen || 'favorites' };
    }
    if (raw.kind === 'review') {
      const ids = frozenIds.length ? frozenIds : Object.keys(state.progress).filter(id => state.progress[id] === 'review' && WORD_BY_ID.has(Number(id))).map(Number);
      return { kind: 'review', key: 'review', title: 'مراجعة الكلمات', ids, returnScreen: raw.returnScreen || 'home' };
    }
    if (raw.kind === 'single' && WORD_BY_ID.has(Number(raw.wordId))) {
      return { kind: 'single', key: `single:${Number(raw.wordId)}`, title: 'تفاصيل الكلمة', ids: [Number(raw.wordId)], returnScreen: raw.returnScreen || 'home' };
    }
    return { kind: 'none', key: 'none', title: '', ids: [], returnScreen: 'home' };
  }

  function sessionPosition(session) {
    if (session.kind === 'daily') return clampInt(state.daily.index, 0, session.ids.length);
    return clampInt(state.positions[session.key], 0, session.ids.length);
  }

  function setSessionPosition(session, position) {
    const safe = clampInt(position, 0, session.ids.length);
    if (session.kind === 'daily') {
      state.daily.index = safe;
      state.daily.completed = safe >= session.ids.length;
    } else {
      state.positions[session.key] = safe;
    }
  }

  function startSession(kind, options = {}) {
    clearAutoSpeechTimers(true);
    const returnScreen = options.returnScreen || state.screen || 'home';
    if (kind === 'daily') ensureDailyPlan();
    state.activeSession = { kind, returnScreen };
    if (kind === 'round') {
      state.activeSession.level = LEVELS.includes(options.level) ? options.level : state.activeLevel;
      state.activeSession.round = clampInt(options.round, 0, 99);
    }
    if (kind === 'single') state.activeSession.wordId = Number(options.wordId);
    if (kind === 'favorites') state.activeSession.level = LEVELS.includes(options.level) ? options.level : 'ALL';

    const session = resolveSession(state.activeSession);
    if (!session.ids.length) {
      state.activeSession = null;
      showToast(kind === 'favorites' ? 'لا توجد كلمات محفوظة للمراجعة بعد' : 'لا توجد كلمات للمراجعة');
      render();
      return;
    }
    state.activeSession.ids = session.ids.slice();
    if (options.reset || (kind === 'round' && sessionPosition(session) >= session.ids.length)) setSessionPosition(session, 0);
    state.screen = 'learn';
    saveState();
    if (location.hash !== '#learn') {
      history.pushState({ screen: 'learn' }, '', '#learn');
      navigationDepth += 1;
    }
    render();
    scrollAppTop();
  }

  function recordActivity() {
    const today = localDateKey();
    if (!state.activityDates.includes(today)) state.activityDates.push(today);
    state.activityDates = [...new Set(state.activityDates)].slice(-180);
  }

  function masteryRecord(id) {
    const existing = state.mastery[id];
    if (existing) return existing;
    return {
      score: state.progress[id] === 'learned' ? 2 : state.progress[id] === 'review' ? 1 : 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      lastSeen: 0
    };
  }

  function ensureMastery(id) {
    if (!state.mastery[id]) state.mastery[id] = Object.assign({}, masteryRecord(id));
    return state.mastery[id];
  }

  function masteryStatus(id) {
    const record = masteryRecord(id);
    if ((state.mistakes[id] && state.mistakes[id].active) || state.progress[id] === 'review') return { label: 'تحتاج مراجعة', className: 'needs-review' };
    if (record.score >= 4 && record.streak >= 3) return { label: 'متقنة', className: 'mastered' };
    if (record.score > 0 || state.progress[id] === 'learned') return { label: 'قيد التعلّم', className: 'learning' };
    return { label: 'جديدة', className: 'new' };
  }

  function activeMistakeIds(level = null) {
    return Object.entries(state.mistakes)
      .filter(([id, value]) => value && value.active && WORD_BY_ID.has(Number(id)) && (!level || WORD_BY_ID.get(Number(id)).level === level))
      .sort((a, b) => (b[1].count - a[1].count) || (b[1].lastWrongAt - a[1].lastWrongAt))
      .map(([id]) => Number(id));
  }

  function haptic(type) {
    if (!state.settings.haptics) return;
    if (window.AndroidUi && typeof window.AndroidUi.haptic === 'function') {
      try { window.AndroidUi.haptic(String(type || 'tap')); } catch (_error) { /* Haptics are optional. */ }
    }
  }

  function advanceWord(action) {
    if (actionLocked || !state.activeSession) return;
    actionLocked = true;
    window.setTimeout(() => { actionLocked = false; }, 260);

    const session = resolveSession(state.activeSession);
    const position = sessionPosition(session);
    if (position >= session.ids.length) return;
    const id = session.ids[position];

    undoSnapshot = {
      expiresAt: Date.now() + 5000,
      activeSession: JSON.parse(JSON.stringify(state.activeSession)),
      position,
      id,
      hadProgress: Object.prototype.hasOwnProperty.call(state.progress, id),
      previousProgress: state.progress[id],
      previousMastery: state.mastery[id] ? Object.assign({}, state.mastery[id]) : null,
      activityDates: state.activityDates.slice()
    };

    if (action === 'learned') {
      state.progress[id] = 'learned';
      const mastery = ensureMastery(id);
      mastery.score = Math.max(mastery.score, 2);
      mastery.lastSeen = Date.now();
      recordActivity();
      haptic('success');
    } else if (action === 'review') {
      state.progress[id] = 'review';
      const mastery = ensureMastery(id);
      mastery.score = Math.min(mastery.score, 2);
      mastery.lastSeen = Date.now();
      recordActivity();
      haptic('selection');
    } else {
      haptic('tap');
    }

    setSessionPosition(session, position + 1);
    saveState();
    render();
    scrollAppTop();
    if (action === 'learned') showToast('تم حفظ الكلمة كتعلّمتها', 'تراجع', 'undo-word', 5000);
    if (action === 'review') showToast('أُضيفت إلى قائمة المراجعة', 'تراجع', 'undo-word', 5000);
    if (action === 'skip') showToast('تم تخطي الكلمة', 'تراجع', 'undo-word', 5000);
  }

  function undoLastWordAction() {
    const snapshot = undoSnapshot;
    if (!snapshot || snapshot.expiresAt < Date.now()) {
      undoSnapshot = null;
      showToast('انتهت مهلة التراجع');
      return;
    }
    state.activeSession = snapshot.activeSession;
    const session = resolveSession(state.activeSession);
    setSessionPosition(session, snapshot.position);
    if (snapshot.hadProgress) state.progress[snapshot.id] = snapshot.previousProgress;
    else delete state.progress[snapshot.id];
    if (snapshot.previousMastery) state.mastery[snapshot.id] = snapshot.previousMastery;
    else delete state.mastery[snapshot.id];
    state.activityDates = snapshot.activityDates;
    undoSnapshot = null;
    haptic('selection');
    saveState();
    render();
    scrollAppTop();
    showToast('تم التراجع عن الاختيار');
  }

  function toggleFavorite(id) {
    const numericId = Number(id);
    if (!WORD_BY_ID.has(numericId)) return;
    const existing = state.favorites.indexOf(numericId);
    if (existing >= 0) {
      state.favorites.splice(existing, 1);
      showToast('أُزيلت من المراجعة');
    } else {
      state.favorites.unshift(numericId);
      showToast('أُضيفت إلى المراجعة');
    }
    haptic('favorite');
    saveState();
    render();
  }

  function speak(text, requestedRate = state.settings.speechRate) {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (window.AndroidSpeech && typeof window.AndroidSpeech.speak === 'function') {
      try {
        window.AndroidSpeech.speak(clean, Number(requestedRate) || 0.86, 1.0);
        return;
      } catch (_error) { /* Use browser fallback. */ }
    }
    if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = 'en-US';
      utterance.rate = Number(requestedRate) || 0.86;
      speechSynthesis.speak(utterance);
    } else {
      showToast('الصوت غير متاح على هذا الجهاز');
    }
  }

  function animateSpeechButton(button) {
    if (!button || !button.classList) return;
    if (activeSpeechButton && activeSpeechButton !== button) activeSpeechButton.classList.remove('speaking');
    activeSpeechButton = button;
    button.classList.remove('speaking');
    void button.offsetWidth;
    button.classList.add('speaking');
    clearTimeout(speechAnimationTimer);
    speechAnimationTimer = window.setTimeout(() => {
      button.classList.remove('speaking');
      if (activeSpeechButton === button) activeSpeechButton = null;
    }, 900);
  }

  function clearAutoSpeechTimers(resetToken = false) {
    clearTimeout(autoSpeechTimer);
    clearTimeout(autoSentenceTimer);
    clearTimeout(testAudioTimer);
    autoSpeechTimer = null;
    autoSentenceTimer = null;
    testAudioTimer = null;
    if (resetToken) {
      lastAutoSpokenToken = '';
      lastTestAudioToken = '';
    }
  }

  function stopSpeech() {
    clearAutoSpeechTimers(false);
    if (window.AndroidSpeech && typeof window.AndroidSpeech.stop === 'function') {
      try { window.AndroidSpeech.stop(); } catch (_error) { /* Optional bridge. */ }
    } else if ('speechSynthesis' in window) {
      try { speechSynthesis.cancel(); } catch (_error) { /* Optional browser fallback. */ }
    }
  }

  function scheduleAutoSpeech() {
    if (state.screen !== 'learn' || !state.activeSession || !state.settings.autoSpeakWord || document.visibilityState === 'hidden') return;
    const session = resolveSession(state.activeSession);
    const position = sessionPosition(session);
    const word = WORD_BY_ID.get(Number(session.ids[position]));
    if (!word) return;
    const token = `${session.key}:${position}:${word.id}`;
    if (token === lastAutoSpokenToken) return;
    lastAutoSpokenToken = token;
    clearTimeout(autoSpeechTimer);
    clearTimeout(autoSentenceTimer);
    autoSpeechTimer = window.setTimeout(() => {
      if (state.screen !== 'learn' || document.visibilityState === 'hidden' || token !== lastAutoSpokenToken) return;
      const button = document.querySelector('[data-action="speak"][data-id="' + word.id + '"]');
      if (button) animateSpeechButton(button);
      speak(word.word);
    }, 280);
    if (state.settings.autoSpeakSentence && word.examples[0] && word.examples[0].en) {
      const sentenceDelay = 1500 + Math.min(1800, String(word.word).length * 90);
      autoSentenceTimer = window.setTimeout(() => {
        if (state.screen !== 'learn' || document.visibilityState === 'hidden' || token !== lastAutoSpokenToken) return;
        const button = document.querySelector('[data-action="speak-example"][data-id="' + word.id + '"]');
        if (button) animateSpeechButton(button);
        speak(word.examples[0].en);
      }, sentenceDelay);
    }
  }

  window.__onAndroidSpeechStatus = function (ready, message) {
    window.__androidSpeechReady = Boolean(ready);
    window.__androidSpeechMessage = String(message || '');
  };

  function learnedCount(words = WORDS) {
    return words.reduce((count, word) => count + (state.progress[word.id] === 'learned' ? 1 : 0), 0);
  }

  function pointsCount() {
    const testCorrect = state.testHistory.reduce((sum, item) => sum + Number(item.correct || 0), 0);
    const cardCorrect = state.cardHistory.reduce((sum, item) => sum + Number(item.correct || 0), 0);
    return learnedCount() * 10 + (testCorrect + cardCorrect) * 5;
  }

  function reviewIds() {
    return Object.keys(state.progress).filter(id => state.progress[id] === 'review' && WORD_BY_ID.has(Number(id))).map(Number);
  }

  function streakCount() {
    if (!state.activityDates.length) return 0;
    const set = new Set(state.activityDates);
    let cursor = new Date();
    if (!set.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (set.has(localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function greetingText() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'أهلًا بعودتك';
    return `${greeting}${state.userName ? `، ${esc(state.userName)}` : ''} 👋`;
  }

  function posArabic(pos) {
    const value = String(pos || '').toLowerCase();
    if (value.includes('phrasal')) return 'فعل مركّب';
    if (value.includes('adj')) return 'صفة';
    if (value.includes('adv')) return 'حال';
    if (value.includes('prep')) return 'حرف جر';
    if (value.includes('pron')) return 'ضمير';
    if (value.includes('conj')) return 'أداة ربط';
    if (value.includes('det')) return 'محدّد';
    if (value.includes('exclam')) return 'تعجّب';
    if (value.includes('v')) return 'فعل';
    if (value.includes('n')) return 'اسم';
    return pos || 'كلمة';
  }

  function progressPercent(level) {
    const words = LEVEL_WORDS[level];
    return Math.round((learnedCount(words) / words.length) * 100);
  }

  function seededShuffle(source, seed) {
    const result = source.slice();
    let value = (Number(seed) >>> 0) || 1;
    const random = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function testModeLabel(mode) {
    return {
      meaning: 'اختيار المعنى',
      reverse: 'العربية إلى الإنجليزية',
      listening: 'اختبار الاستماع',
      spelling: 'اختبار التهجئة',
      mixed: 'اختبار مختلط'
    }[mode] || 'اختبار مختلط';
  }

  function testModeIcon(mode) {
    return { meaning: 'translate', reverse: 'arrow', listening: 'headphones', spelling: 'keyboard', mixed: 'spark' }[mode] || 'quiz';
  }

  function createTestSession(ids, options = {}) {
    const cleanIds = [...new Set(ids.map(Number).filter(id => WORD_BY_ID.has(id)))];
    if (!cleanIds.length) {
      showToast('لا توجد كلمات متاحة لهذا الاختبار');
      return false;
    }
    const seed = clampInt(options.seed || (Date.now() % 2147483646), 1, 2147483646);
    state.testSession = {
      schema: 1,
      id: `test-${Date.now()}-${seed}`,
      status: 'active',
      level: TEST_SESSION_LEVELS.includes(options.level) ? options.level : 'ALL',
      mode: TEST_MODES.includes(options.mode) ? options.mode : 'mixed',
      source: options.source === 'mistakes' ? 'mistakes' : 'level',
      ids: seededShuffle(cleanIds, seed),
      index: 0,
      correct: 0,
      answers: [],
      feedback: null,
      seed,
      startedAt: Date.now(),
      completedAt: 0,
      historySaved: false
    };
    state.screen = 'tests';
    state.testView = 'session';
    lastTestAudioToken = '';
    saveState();
    render();
    scrollAppTop();
    return true;
  }

  function startConfiguredTest() {
    if (state.testSession && state.testSession.status === 'active') {
      showToast('لديك اختبار مستمر؛ أكمله أو احذفه أولًا');
      return;
    }
    const config = state.testConfig;
    const levelIds = LEVEL_WORDS[config.level].map(word => Number(word.id));
    const seed = clampInt(Date.now() % 2147483646, 1, 2147483646);
    const ordered = seededShuffle(levelIds, seed);
    const count = config.size === 'all' ? ordered.length : Math.min(Number(config.size), ordered.length);
    createTestSession(ordered.slice(0, count), { level: config.level, mode: config.mode, source: 'level', seed });
  }

  function startMistakesTest(ids = activeMistakeIds(state.mistakeFilter === 'ALL' ? null : state.mistakeFilter)) {
    const level = state.mistakeFilter === 'ALL' ? 'ALL' : state.mistakeFilter;
    createTestSession(ids, { level, mode: 'mixed', source: 'mistakes' });
  }

  function currentTestQuestion() {
    const session = state.testSession;
    if (!session || session.status !== 'active' || session.index >= session.ids.length) return null;
    const target = WORD_BY_ID.get(Number(session.ids[session.index]));
    if (!target) return null;
    const mixedModes = ['meaning', 'reverse', 'listening', 'spelling'];
    const mode = session.mode === 'mixed' ? mixedModes[session.index % mixedModes.length] : session.mode;
    return {
      target,
      mode,
      options: mode === 'spelling' ? [] : buildTestOptions(target, mode, session.seed + (session.index + 1) * 7919)
    };
  }

  function buildTestOptions(target, mode, seed) {
    const field = mode === 'meaning' ? 'arabic' : 'word';
    const targetLabel = String(target[field] || '');
    const targetKey = normalizeSearch(targetLabel);
    const sameLevel = LEVEL_WORDS[target.level].filter(word => Number(word.id) !== Number(target.id));
    const samePos = sameLevel.filter(word => String(word.pos || '') === String(target.pos || ''));
    const others = sameLevel.filter(word => String(word.pos || '') !== String(target.pos || ''));
    const candidates = seededShuffle(samePos, seed).concat(seededShuffle(others, seed ^ 0x5f3759df));
    const chosen = [{ id: Number(target.id), label: targetLabel }];
    const labels = new Set([targetKey]);
    for (const word of candidates) {
      const label = String(word[field] || '');
      const key = normalizeSearch(label);
      if (!key || labels.has(key)) continue;
      labels.add(key);
      chosen.push({ id: Number(word.id), label });
      if (chosen.length === 4) break;
    }
    return seededShuffle(chosen, seed ^ 0x9e3779b9);
  }

  function normalizeSpelling(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’`]/g, "'")
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function updateTestLearning(id, correct, mode) {
    const mastery = ensureMastery(id);
    mastery.lastSeen = Date.now();
    if (correct) {
      mastery.correct += 1;
      mastery.streak += 1;
      mastery.score = Math.min(5, mastery.score + (mode === 'spelling' ? 2 : 1));
      const mistake = state.mistakes[id];
      if (mistake && mistake.active) {
        mistake.correctStreak = Math.min(3, mistake.correctStreak + 1);
        if (mistake.correctStreak >= 3) mistake.active = false;
      }
      if (mastery.score >= 4 && mastery.streak >= 3) state.progress[id] = 'learned';
    } else {
      mastery.wrong += 1;
      mastery.streak = 0;
      mastery.score = Math.max(0, mastery.score - 1);
      state.progress[id] = 'review';
      const existing = state.mistakes[id] || { count: 0, lastWrongAt: 0, lastType: mode, correctStreak: 0, active: true };
      existing.count += 1;
      existing.lastWrongAt = Date.now();
      existing.lastType = mode;
      existing.correctStreak = 0;
      existing.active = true;
      state.mistakes[id] = existing;
    }
  }

  function answerTest(value) {
    const session = state.testSession;
    const question = currentTestQuestion();
    if (!session || !question || session.feedback || session.answers.some(answer => answer.index === session.index)) return;
    const isSpelling = question.mode === 'spelling';
    const correct = isSpelling
      ? normalizeSpelling(value) === normalizeSpelling(question.target.word)
      : Number(value) === Number(question.target.id);
    const compactAnswer = {
      index: session.index,
      id: Number(question.target.id),
      mode: question.mode,
      correct,
      answer: isSpelling ? String(value || '').slice(0, 120) : Number(value)
    };
    session.answers.push(compactAnswer);
    if (correct) session.correct += 1;
    session.feedback = {
      correct,
      selectedId: isSpelling ? null : Number(value),
      typed: isSpelling ? String(value || '').slice(0, 120) : '',
      expectedId: Number(question.target.id),
      mode: question.mode
    };
    updateTestLearning(question.target.id, correct, question.mode);
    recordActivity();
    haptic(correct ? 'success' : 'error');
    saveState();
    render();
  }

  function nextTestQuestion() {
    const session = state.testSession;
    if (!session || session.status !== 'active' || !session.feedback) return;
    session.feedback = null;
    session.index += 1;
    lastTestAudioToken = '';
    if (session.index >= session.ids.length) completeTest();
    else {
      saveState();
      render();
      scrollAppTop();
    }
  }

  function completeTest() {
    const session = state.testSession;
    if (!session) return;
    session.status = 'result';
    session.completedAt = Date.now();
    session.feedback = null;
    if (!session.historySaved && !state.testHistory.some(item => item.id === session.id)) {
      state.testHistory.unshift({
        id: session.id,
        level: session.level,
        mode: session.mode,
        total: session.ids.length,
        correct: session.correct,
        startedAt: session.startedAt,
        completedAt: session.completedAt
      });
      state.testHistory = state.testHistory.slice(0, 30);
      session.historySaved = true;
    }
    state.testView = 'result';
    haptic('success');
    saveState();
    render();
    scrollAppTop();
  }

  function retryWrongAnswers() {
    const session = state.testSession;
    if (!session) return;
    const wrongIds = [...new Set(session.answers.filter(answer => !answer.correct).map(answer => Number(answer.id)))];
    if (!wrongIds.length) {
      showToast('لا توجد أخطاء لإعادتها');
      return;
    }
    createTestSession(wrongIds, { level: session.level, mode: 'mixed', source: 'mistakes' });
  }

  function discardTest() {
    state.testSession = null;
    state.testView = 'center';
    lastTestAudioToken = '';
    saveState();
    render();
    showToast('تم حذف الاختبار المحفوظ');
  }

  function masteredCount(level = null) {
    const words = level ? LEVEL_WORDS[level] : WORDS;
    return words.reduce((count, word) => count + (masteryStatus(word.id).className === 'mastered' ? 1 : 0), 0);
  }

  function overallTestAccuracy() {
    const total = state.testHistory.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const correct = state.testHistory.reduce((sum, item) => sum + Number(item.correct || 0), 0);
    return total ? Math.round((correct / total) * 100) : 0;
  }

  function scheduleTestAudio() {
    const question = currentTestQuestion();
    const session = state.testSession;
    if (state.screen !== 'tests' || state.testView !== 'session' || !session || !question) return;
    const shouldSpeakPrompt = !session.feedback && (question.mode === 'meaning' || question.mode === 'listening');
    const shouldSpeakAnswer = Boolean(session.feedback) && (question.mode === 'reverse' || question.mode === 'spelling');
    if (!shouldSpeakPrompt && !shouldSpeakAnswer) return;
    const token = `${session.id}:${session.index}:${question.target.id}:${session.feedback ? 'answer' : 'prompt'}`;
    if (token === lastTestAudioToken) return;
    lastTestAudioToken = token;
    clearTimeout(testAudioTimer);
    testAudioTimer = window.setTimeout(() => {
      if (state.screen !== 'tests' || state.testView !== 'session' || token !== lastTestAudioToken || document.visibilityState === 'hidden') return;
      const button = document.querySelector(`[data-action="test-speak"][data-id="${question.target.id}"]`);
      if (button) animateSpeechButton(button);
      speak(question.target.word);
    }, 380);
  }

  function writingSourceLabel(source) {
    return source === 'daily' ? 'كلمات اليوم' : `المستوى ${source}`;
  }

  function writingIdsFor(source) {
    if (source === 'daily') return ensureDailyPlan().ids.map(Number);
    return LEVELS.includes(source) ? LEVEL_WORDS[source].map(word => Number(word.id)) : [];
  }

  function startWritingSession() {
    const source = state.writingSource === 'daily' || LEVELS.includes(state.writingSource) ? state.writingSource : 'daily';
    const ids = writingIdsFor(source);
    if (!ids.length) {
      showToast('لا توجد كلمات متاحة للتدريب');
      return;
    }
    state.writingSession = {
      id: `writing-${Date.now()}`,
      source,
      ids,
      index: 0,
      correct: 0,
      skipped: 0,
      hintVisible: true,
      feedback: null,
      startedAt: Date.now()
    };
    lastWritingAudioToken = '';
    saveState();
    render();
    scrollAppTop();
  }

  function currentWritingWord() {
    const session = state.writingSession;
    if (!session || session.index >= session.ids.length) return null;
    return WORD_BY_ID.get(Number(session.ids[session.index])) || null;
  }

  function verifyWriting(value) {
    const session = state.writingSession;
    const word = currentWritingWord();
    if (!session || !word || session.feedback) return;
    const typed = String(value || '').slice(0, 120);
    if (!normalizeSpelling(typed)) {
      showToast('اكتب الكلمة أولًا أو اختر تخطي');
      return;
    }
    const correct = normalizeSpelling(typed) === normalizeSpelling(word.word);
    session.feedback = { correct, typed };
    if (correct) session.correct += 1;
    updateTestLearning(word.id, correct, 'spelling');
    recordActivity();
    haptic(correct ? 'success' : 'error');
    lastWritingAudioToken = '';
    saveState();
    render();
  }

  function nextWritingWord(skipped = false) {
    const session = state.writingSession;
    if (!session || session.index >= session.ids.length) return;
    if (skipped) session.skipped += 1;
    session.index += 1;
    session.feedback = null;
    lastWritingAudioToken = '';
    saveState();
    haptic(skipped ? 'tap' : 'selection');
    render();
    scrollAppTop();
  }

  function scheduleWritingAudio() {
    const session = state.writingSession;
    const word = currentWritingWord();
    if (state.screen !== 'writing' || !session || !word || !session.feedback) return;
    const token = `${session.id}:${session.index}:${word.id}`;
    if (token === lastWritingAudioToken) return;
    lastWritingAudioToken = token;
    autoSpeechTimer = window.setTimeout(() => {
      if (state.screen !== 'writing' || token !== lastWritingAudioToken || document.visibilityState === 'hidden') return;
      const button = document.querySelector(`[data-action="writing-speak"][data-id="${word.id}"]`);
      if (button) animateSpeechButton(button);
      speak(word.word);
    }, 320);
  }

  function renderWriting() {
    const session = state.writingSession;
    if (!session) return renderWritingSetup();
    if (session.index >= session.ids.length) return renderWritingComplete();
    const word = currentWritingWord();
    if (!word) return renderWritingSetup();
    const feedback = session.feedback;
    const percent = Math.round((session.index / session.ids.length) * 100);
    return `<section class="screen writing-screen guided-writing-screen">
      <header class="learn-top writing-top"><button class="back-btn" type="button" data-action="close-writing" aria-label="إغلاق التدريب">${icon('close')}</button><div class="learn-top-info"><div class="learn-title">تدريب الكتابة · ${writingSourceLabel(session.source)}</div><div class="learn-count">${session.index + 1} / ${session.ids.length}</div><div class="learn-track" role="progressbar" aria-valuemin="0" aria-valuemax="${session.ids.length}" aria-valuenow="${session.index}"><i style="width:${percent}%"></i></div></div><span class="score-chip">${session.correct} صحيحة</span></header>
      <article class="guided-writing-card ghost-writing-card ${feedback ? (feedback.correct ? 'answered-correct' : 'answered-wrong') : ''}">
        <span class="writing-kicker">${icon('keyboard', 'icon-sm')} اكتب الكلمة الإنجليزية</span>
        <h1 class="writing-arabic" lang="ar">${esc(word.arabic)}</h1>
        ${feedback ? `<div class="writing-reveal"><strong lang="en" dir="ltr">${esc(word.word)}</strong><span>${esc(word.arabic)}</span><button class="sound-btn" type="button" data-action="writing-speak" data-id="${word.id}" aria-label="نطق الكلمة">${icon('volume', 'icon-lg')}</button></div><div class="answer-feedback ${feedback.correct ? 'correct' : 'wrong'}"><span class="feedback-icon">${icon(feedback.correct ? 'check' : 'close')}</span><div><strong>${feedback.correct ? 'كتابة صحيحة!' : 'قريبة، حاول تثبيت شكلها'}</strong><p>${feedback.correct ? 'أحسنت. استمع إلى النطق ثم انتقل.' : `كتبت: <b lang="en" dir="ltr">${esc(feedback.typed)}</b>`}</p></div></div>` : `<form id="guidedWritingForm" class="guided-writing-form"><label for="guidedWritingInput">اكتب فوق التلميح</label><div class="ghost-input-wrap"><span class="ghost-word ${session.hintVisible ? '' : 'hidden'}" lang="en" dir="ltr" aria-hidden="true">${esc(word.word)}</span><input id="guidedWritingInput" type="text" lang="en" dir="ltr" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="120" aria-describedby="writingHintNote"></div><div class="writing-form-actions"><button class="hint-toggle" type="button" data-action="toggle-writing-hint" aria-pressed="${session.hintVisible}">${icon(session.hintVisible ? 'close' : 'spark', 'icon-sm')} ${session.hintVisible ? 'إخفاء التلميح' : 'إظهار التلميح'}</button><button class="primary-btn" type="submit">تحقق</button></div><small id="writingHintNote">التلميح شفاف ليساعد يدك على تذكّر شكل الكلمة.</small></form>`}
      </article>
      <div class="writing-footer-actions">${feedback ? `<button class="primary-btn wide-btn" type="button" data-action="next-writing">الكلمة التالية ${icon('arrow', 'icon-sm')}</button>` : `<button class="secondary-btn wide-btn" type="button" data-action="skip-writing">${icon('skip')} تخطي الكتابة</button>`}</div>
    </section>${renderBottomNav('learn')}`;
  }

  function renderWritingSetup() {
    return `<section class="screen writing-setup-screen guided-writing-screen">
      <header class="page-titlebar"><div><h1>تدريب الكتابة</h1><p>ثبّت شكل الكلمة بالكتابة فوق تلميح خفيف</p></div>${headerActions()}</header>
      <article class="writing-intro"><span>${icon('keyboard')}</span><div><span class="hero-eyebrow">تدريب موجّه</span><h2>من المعنى إلى الكتابة</h2><p>اختر مصدرك، اكتب الإنجليزية، ثم شاهد الكلمة واسمع نطقها فقط.</p></div></article>
      <div class="setup-section"><h2>اختر مصدر الكلمات</h2><div class="writing-source-grid">${['daily', ...LEVELS].map(source => `<button type="button" class="source-option ${state.writingSource === source ? 'active' : ''}" data-action="set-writing-source" data-source="${source}" aria-pressed="${state.writingSource === source}"><strong>${source === 'daily' ? 'اليوم' : source}</strong><span>${source === 'daily' ? '50 كلمة' : `${LEVEL_WORDS[source].length} كلمة`}</span></button>`).join('')}</div></div>
      <article class="test-summary"><span>${icon('volume')}</span><div><strong>لن يكشف الصوت الإجابة</strong><p>يبدأ نطق الكلمة الإنجليزية بعد التحقق أو التخطي فقط.</p></div></article>
      <button class="primary-btn wide-btn" type="button" data-action="start-writing">${icon('play')} ابدأ تدريب ${writingSourceLabel(state.writingSource)}</button>
    </section>${renderBottomNav('learn')}`;
  }

  function renderWritingComplete() {
    const session = state.writingSession;
    const total = session ? session.ids.length : 0;
    const percent = total ? Math.round((session.correct / total) * 100) : 0;
    return `<section class="screen writing-complete-screen guided-writing-screen"><article class="complete-card"><div class="complete-icon">${icon('keyboard')}</div><h1>أنهيت تدريب الكتابة</h1><p>${session ? writingSourceLabel(session.source) : ''} · تم حفظ تقدم الكلمات</p><div class="complete-stats"><div class="complete-stat"><strong>${session ? session.correct : 0}</strong><span>صحيحة</span></div><div class="complete-stat"><strong>${session ? session.skipped : 0}</strong><span>تخطي</span></div><div class="complete-stat"><strong>${percent}%</strong><span>الدقة</span></div></div><div class="complete-actions"><button class="primary-btn" type="button" data-action="restart-writing">إعادة التدريب</button><button class="secondary-btn" type="button" data-action="close-writing">اختيار مصدر آخر</button></div></article></section>${renderBottomNav('learn')}`;
  }

  function makeLocalId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function selectedDeck() {
    return state.cardDecks.find(deck => deck.id === state.selectedDeckId) || null;
  }

  function manualCardById(id) {
    for (const deck of state.cardDecks) {
      const card = deck.cards.find(item => item.id === String(id));
      if (card) return { card, deck };
    }
    return null;
  }

  function cardStatsFor(id) {
    if (!state.cardStats[id]) state.cardStats[id] = { seen: 0, correct: 0, wrong: 0, lastSeen: 0 };
    return state.cardStats[id];
  }

  function startCardPractice() {
    const deck = selectedDeck();
    if (!deck || !deck.cards.length) {
      showToast('أضف بطاقة واحدة على الأقل');
      return;
    }
    let mode = state.cardTestMode;
    if (deck.cards.length < 4 && ['meaning', 'reverse', 'mixed'].includes(mode)) {
      mode = 'spelling';
      showToast('لأن المجموعة أقل من 4 بطاقات بدأنا تدريب الكتابة');
    }
    const seed = clampInt(Date.now() % 2147483646, 1, 2147483646);
    state.cardPractice = {
      id: `cards-${Date.now()}-${seed}`,
      deckId: deck.id,
      mode,
      ids: seededShuffle(deck.cards.map(card => card.id), seed),
      index: 0,
      correct: 0,
      answers: [],
      feedback: null,
      status: 'active',
      seed,
      startedAt: Date.now(),
      completedAt: 0,
      historySaved: false
    };
    state.cardsView = 'practice';
    lastCardAudioToken = '';
    saveState();
    render();
    scrollAppTop();
  }

  function currentCardQuestion() {
    const session = state.cardPractice;
    const deck = session && state.cardDecks.find(item => item.id === session.deckId);
    if (!session || !deck || session.status !== 'active' || session.index >= session.ids.length) return null;
    const target = deck.cards.find(card => card.id === session.ids[session.index]);
    if (!target) return null;
    let mode = session.mode;
    if (mode === 'mixed') mode = ['meaning', 'reverse', 'listening', 'spelling'][session.index % 4];
    if (deck.cards.length < 4 && mode !== 'listening') mode = 'spelling';
    const inputMode = mode === 'spelling' || (mode === 'listening' && deck.cards.length < 4);
    return { target, deck, mode, inputMode, options: inputMode ? [] : buildCardOptions(deck, target, mode, session.seed + (session.index + 1) * 3571) };
  }

  function buildCardOptions(deck, target, mode, seed) {
    const field = mode === 'meaning' ? 'arabic' : 'english';
    const candidates = seededShuffle(deck.cards.filter(card => card.id !== target.id), seed);
    const chosen = [{ id: target.id, label: target[field] }];
    const labels = new Set([normalizeSearch(target[field])]);
    for (const card of candidates) {
      const key = normalizeSearch(card[field]);
      if (!key || labels.has(key)) continue;
      labels.add(key);
      chosen.push({ id: card.id, label: card[field] });
      if (chosen.length === 4) break;
    }
    return seededShuffle(chosen, seed ^ 0x9e3779b9);
  }

  function answerCardPractice(value) {
    const session = state.cardPractice;
    const question = currentCardQuestion();
    if (!session || !question || session.feedback) return;
    const typedAnswer = question.inputMode;
    const typed = typedAnswer ? String(value || '').slice(0, 120) : '';
    if (typedAnswer && !normalizeSpelling(typed)) {
      showToast('اكتب الكلمة أولًا');
      return;
    }
    const correct = typedAnswer ? normalizeSpelling(typed) === normalizeSpelling(question.target.english) : String(value) === question.target.id;
    const answer = { index: session.index, id: question.target.id, mode: question.mode, correct, answer: typedAnswer ? typed : String(value) };
    session.answers.push(answer);
    if (correct) session.correct += 1;
    session.feedback = { correct, typed, selectedId: typedAnswer ? '' : String(value), expectedId: question.target.id };
    const stats = cardStatsFor(question.target.id);
    stats.seen += 1;
    stats.correct += correct ? 1 : 0;
    stats.wrong += correct ? 0 : 1;
    stats.lastSeen = Date.now();
    haptic(correct ? 'success' : 'error');
    lastCardAudioToken = '';
    saveState();
    render();
  }

  function nextCardQuestion() {
    const session = state.cardPractice;
    if (!session || !session.feedback) return;
    session.feedback = null;
    session.index += 1;
    lastCardAudioToken = '';
    if (session.index >= session.ids.length) completeCardPractice();
    else {
      saveState();
      render();
      scrollAppTop();
    }
  }

  function completeCardPractice() {
    const session = state.cardPractice;
    const deck = session && state.cardDecks.find(item => item.id === session.deckId);
    if (!session || !deck) return;
    session.status = 'result';
    session.completedAt = Date.now();
    session.feedback = null;
    if (!session.historySaved) {
      state.cardHistory.unshift({ id: session.id, deckId: deck.id, deckName: deck.name, mode: session.mode, total: session.ids.length, correct: session.correct, completedAt: session.completedAt });
      state.cardHistory = state.cardHistory.slice(0, 30);
      session.historySaved = true;
    }
    state.cardsView = 'result';
    haptic('success');
    playUiSound('success');
    saveState();
    render();
    scrollAppTop();
  }

  function scheduleCardAudio() {
    const session = state.cardPractice;
    const question = currentCardQuestion();
    if (state.screen !== 'cards' || state.cardsView !== 'practice' || !session || !question) return;
    const promptAudio = !session.feedback && (question.mode === 'meaning' || question.mode === 'listening');
    const answerAudio = Boolean(session.feedback) && (question.mode === 'reverse' || question.mode === 'spelling');
    if (!promptAudio && !answerAudio) return;
    const token = `${session.id}:${session.index}:${question.target.id}:${session.feedback ? 'answer' : 'prompt'}`;
    if (token === lastCardAudioToken) return;
    lastCardAudioToken = token;
    testAudioTimer = window.setTimeout(() => {
      if (state.screen !== 'cards' || token !== lastCardAudioToken || document.visibilityState === 'hidden') return;
      const button = document.querySelector(`[data-action="card-speak"][data-card-id="${question.target.id}"]`);
      if (button) animateSpeechButton(button);
      speak(question.target.english);
    }, 360);
  }

  function renderCards() {
    if (state.cardsView === 'deck-form') return renderDeckForm();
    if (state.cardsView === 'card-form') return renderManualCardForm();
    if (state.cardsView === 'practice' && state.cardPractice && state.cardPractice.status === 'active') return renderCardPractice();
    if (state.cardsView === 'result' && state.cardPractice && state.cardPractice.status === 'result') return renderCardResult();
    if (state.cardsView === 'deck' && selectedDeck()) return renderDeckDetail();
    return renderCardsCenter();
  }

  function renderCardsCenter() {
    const totalCards = state.cardDecks.reduce((sum, deck) => sum + deck.cards.length, 0);
    return `<section class="screen cards-screen">
      <header class="page-titlebar"><div><h1>بطاقاتي</h1><p>كلماتك الخارجية في مجموعات مستقلة</p></div>${headerActions()}</header>
      <article class="cards-hero"><span class="cards-hero-icon">${icon('book')}</span><div><span class="hero-eyebrow">مكتبتك الخاصة</span><h2>${state.cardDecks.length} مجموعات · ${totalCards} بطاقات</h2><p>أضف الإنجليزية ومعناها، ثم تدرّب بالاختيار أو الاستماع أو الكتابة الشفافة.</p></div><button class="white-btn" type="button" data-action="new-manual-card">إضافة بطاقة</button></article>
      <div class="cards-toolbar"><button class="primary-btn" type="button" data-action="new-manual-card">${icon('keyboard', 'icon-sm')} بطاقة جديدة</button><button class="secondary-btn" type="button" data-action="new-deck">${icon('book', 'icon-sm')} مجموعة جديدة</button></div>
      ${state.cardDecks.length ? `<div class="deck-grid">${state.cardDecks.map(deck => {
        const attempts = state.cardHistory.filter(item => item.deckId === deck.id).length;
        return `<button class="deck-card" type="button" data-action="open-deck" data-deck-id="${esc(deck.id)}"><span class="deck-icon">${icon('book')}</span><span><strong>${esc(deck.name)}</strong><small>${deck.cards.length} بطاقات · ${attempts} اختبارات</small></span>${icon('chevron')}</button>`;
      }).join('')}</div>` : `<div class="empty-state cards-empty"><div class="empty-illustration">${icon('book')}</div><h2>أنشئ مجموعتك الأولى</h2><p>هذه المساحة لا تستقبل كلمات التطبيق تلقائيًا؛ أنت من يضيف بطاقاتها.</p><button class="primary-btn" type="button" data-action="new-deck">إنشاء مجموعة</button></div>`}
      ${state.cardHistory.length ? `<div class="section"><div class="section-head"><h2>آخر نتائج بطاقاتك</h2></div><div class="test-history">${state.cardHistory.slice(0, 4).map(item => { const pct = Math.round((item.correct / item.total) * 100); return `<div class="history-row"><span class="history-score ${pct >= 80 ? 'great' : pct >= 60 ? 'good' : ''}">${pct}%</span><span><strong>${esc(item.deckName)}</strong><small>${testModeLabel(item.mode)} · ${item.correct}/${item.total}</small></span></div>`; }).join('')}</div></div>` : ''}
    </section>${renderBottomNav('learn')}`;
  }

  function renderDeckForm() {
    return `<section class="screen cards-form-screen"><header class="subpage-titlebar"><button class="back-btn" type="button" data-action="cards-center" aria-label="العودة">${icon('arrow')}</button><div><h1>مجموعة جديدة</h1><p>اختر اسمًا واضحًا يسهل الرجوع إليه</p></div></header><form id="deckForm" class="manual-form"><label for="deckName">اسم المجموعة</label><input id="deckName" name="deckName" type="text" maxlength="60" autocomplete="off" placeholder="مثال: كلمات السفر" required><button class="primary-btn wide-btn" type="submit">إنشاء المجموعة</button></form></section>${renderBottomNav('learn')}`;
  }

  function renderManualCardForm() {
    const found = state.editingCardId ? manualCardById(state.editingCardId) : null;
    const card = found ? found.card : null;
    const deckId = found ? found.deck.id : (state.selectedDeckId || (state.cardDecks[0] && state.cardDecks[0].id) || '');
    return `<section class="screen cards-form-screen"><header class="subpage-titlebar"><button class="back-btn" type="button" data-action="close-card-form" aria-label="العودة">${icon('arrow')}</button><div><h1>${card ? 'تعديل البطاقة' : 'بطاقة جديدة'}</h1><p>هذه البطاقة مستقلة عن قاموس التطبيق</p></div></header>
      <form id="manualCardForm" class="manual-form" data-card-id="${card ? esc(card.id) : ''}"><label for="cardEnglish">الكلمة الإنجليزية</label><input id="cardEnglish" name="english" type="text" lang="en" dir="ltr" maxlength="120" autocomplete="off" autocapitalize="none" spellcheck="false" value="${card ? esc(card.english) : ''}" placeholder="English word" required><label for="cardArabic">المعنى العربي</label><input id="cardArabic" name="arabic" type="text" lang="ar" dir="rtl" maxlength="180" autocomplete="off" value="${card ? esc(card.arabic) : ''}" placeholder="المعنى بالعربية" required>
      <label for="cardDeck">المجموعة</label><select id="cardDeck" name="deckId">${state.cardDecks.map(deck => `<option value="${esc(deck.id)}" ${deck.id === deckId ? 'selected' : ''}>${esc(deck.name)}</option>`).join('')}</select><div class="form-divider"><span>أو</span></div><label for="newDeckName">إنشاء مجموعة جديدة لهذه البطاقة</label><input id="newDeckName" name="newDeckName" type="text" maxlength="60" autocomplete="off" placeholder="اتركه فارغًا لاستخدام المجموعة المختارة"><button class="primary-btn wide-btn" type="submit">${card ? 'حفظ التعديلات' : 'إضافة البطاقة'}</button></form>
    </section>${renderBottomNav('learn')}`;
  }

  function renderDeckDetail() {
    const deck = selectedDeck();
    if (!deck) return renderCardsCenter();
    const mastered = deck.cards.filter(card => { const stats = state.cardStats[card.id]; return stats && stats.correct >= 3 && stats.correct > stats.wrong; }).length;
    return `<section class="screen deck-detail-screen"><header class="subpage-titlebar"><button class="back-btn" type="button" data-action="cards-center" aria-label="العودة">${icon('arrow')}</button><div><h1>${esc(deck.name)}</h1><p>${deck.cards.length} بطاقات · ${mastered} متقنة</p></div><button class="icon-btn" type="button" data-action="new-manual-card" aria-label="إضافة بطاقة">${icon('keyboard')}</button></header>
      ${deck.cards.length ? `<div class="setup-section"><h2>نوع التدريب</h2><div class="mode-grid">${TEST_MODES.map(mode => `<button type="button" class="mode-option ${state.cardTestMode === mode ? 'active' : ''}" data-action="set-card-mode" data-mode="${mode}" aria-pressed="${state.cardTestMode === mode}"><span>${icon(testModeIcon(mode))}</span><strong>${testModeLabel(mode)}</strong><small>${mode === 'spelling' ? 'كتابة بتلميح شفاف' : mode === 'listening' ? 'استمع وحدد أو اكتب' : mode === 'mixed' ? 'تنويع تلقائي' : 'اختيارات سريعة'}</small></button>`).join('')}</div></div><button class="primary-btn wide-btn" type="button" data-action="start-card-practice">${icon('play')} ابدأ تدريب المجموعة</button><p class="test-save-note">${deck.cards.length < 4 ? 'المجموعة الصغيرة تعمل تلقائيًا بالكتابة والاستماع.' : 'ستتدرّب على كل بطاقات المجموعة ويُحفظ تقدمك.'}</p><div class="section"><div class="section-head"><h2>البطاقات</h2><button type="button" data-action="new-manual-card">إضافة</button></div><div class="manual-card-list">${deck.cards.map(card => { const stats = state.cardStats[card.id] || { correct: 0, wrong: 0 }; return `<article class="manual-card-row"><button class="row-action" type="button" data-action="card-speak" data-card-id="${esc(card.id)}" aria-label="نطق الكلمة">${icon('volume', 'icon-sm')}</button><span><strong lang="en" dir="ltr">${esc(card.english)}</strong><small>${esc(card.arabic)} · ${stats.correct} صحيحة / ${stats.wrong} خاطئة</small></span><button class="row-action" type="button" data-action="edit-manual-card" data-card-id="${esc(card.id)}" aria-label="تعديل البطاقة">${icon('settings', 'icon-sm')}</button><button class="row-action danger" type="button" data-action="delete-manual-card" data-card-id="${esc(card.id)}" aria-label="حذف البطاقة">${icon('close', 'icon-sm')}</button></article>`; }).join('')}</div></div>` : `<div class="empty-state"><div class="empty-illustration">${icon('keyboard')}</div><h2>المجموعة فارغة</h2><p>أضف أول كلمة ومعناها لبدء التدريب.</p><button class="primary-btn" type="button" data-action="new-manual-card">إضافة بطاقة</button></div>`}
      <button class="text-danger-btn deck-delete-btn" type="button" data-action="delete-deck" data-deck-id="${esc(deck.id)}">حذف المجموعة</button>
    </section>${renderBottomNav('learn')}`;
  }

  function renderCardPractice() {
    const session = state.cardPractice;
    const question = currentCardQuestion();
    if (!session || !question) return renderCardsCenter();
    const feedback = session.feedback;
    const percent = Math.round((session.index / session.ids.length) * 100);
    const modePrompt = question.mode === 'meaning' ? 'اختر المعنى الصحيح' : question.mode === 'reverse' ? 'اختر الكلمة الإنجليزية' : question.mode === 'listening' ? (question.inputMode ? 'استمع ثم اكتب الكلمة' : 'استمع ثم اختر الكلمة') : 'اكتب الكلمة الإنجليزية';
    const prompt = question.mode === 'meaning' ? `<div class="manual-prompt-word"><h1 lang="en" dir="ltr">${esc(question.target.english)}</h1><button class="sound-btn" type="button" data-action="card-speak" data-card-id="${esc(question.target.id)}">${icon('volume', 'icon-lg')}</button></div>` : question.mode === 'listening' ? `<button class="test-listen-btn sound-btn" type="button" data-action="card-speak" data-card-id="${esc(question.target.id)}">${icon('volume', 'icon-lg')}<span>اضغط للاستماع</span></button>` : `<h1 lang="ar" dir="rtl">${esc(question.target.arabic)}</h1>`;
    return `<section class="screen card-practice-screen"><header class="learn-top test-top"><button class="back-btn" type="button" data-action="exit-card-practice">${icon('close')}</button><div class="learn-top-info"><div class="learn-title">${esc(question.deck.name)}</div><div class="learn-count">${session.index + 1} / ${session.ids.length}</div><div class="learn-track"><i style="width:${percent}%"></i></div></div><span class="score-chip">${session.correct} صحيحة</span></header><article class="question-card ${feedback ? (feedback.correct ? 'answered-correct' : 'answered-wrong') : ''}"><div class="question-mode">${icon(testModeIcon(question.mode), 'icon-sm')} ${testModeLabel(question.mode)}</div><p class="question-instruction">${modePrompt}</p><div class="question-prompt">${prompt}</div>${question.inputMode ? renderCardWritingInput(question, feedback) : renderCardChoices(question, feedback)}${feedback ? `<div class="card-answer-reveal"><button class="sound-btn" type="button" data-action="card-speak" data-card-id="${esc(question.target.id)}">${icon('volume')}</button><span><strong lang="en" dir="ltr">${esc(question.target.english)}</strong><small>${esc(question.target.arabic)}</small></span></div><div class="answer-feedback ${feedback.correct ? 'correct' : 'wrong'}"><span class="feedback-icon">${icon(feedback.correct ? 'check' : 'close')}</span><div><strong>${feedback.correct ? 'إجابة صحيحة!' : 'الإجابة تحتاج مراجعة'}</strong><p>${feedback.correct ? 'تم تسجيل تقدم البطاقة.' : `الصحيح: <b lang="en" dir="ltr">${esc(question.target.english)}</b>`}</p></div></div>` : ''}</article>${feedback ? `<button class="primary-btn wide-btn" type="button" data-action="next-card-question">${session.index + 1 >= session.ids.length ? 'عرض النتيجة' : 'البطاقة التالية'} ${icon('arrow', 'icon-sm')}</button>` : ''}</section>`;
  }

  function renderCardChoices(question, feedback) {
    return `<div class="answer-grid">${question.options.map(option => { let cls = ''; if (feedback) { if (option.id === question.target.id) cls = 'correct-answer'; else if (option.id === feedback.selectedId) cls = 'wrong-answer'; } return `<button class="answer-option ${cls}" type="button" data-action="answer-card" data-card-answer="${esc(option.id)}" ${feedback ? 'disabled' : ''}><span lang="${question.mode === 'meaning' ? 'ar' : 'en'}" dir="${question.mode === 'meaning' ? 'rtl' : 'ltr'}">${esc(option.label)}</span>${feedback && option.id === question.target.id ? icon('check', 'icon-sm') : ''}</button>`; }).join('')}</div>`;
  }

  function renderCardWritingInput(question, feedback) {
    const showGhost = question.mode === 'spelling' && !feedback;
    return `<form id="cardWritingForm" class="guided-writing-form"><label for="cardWritingInput">إجابتك</label><div class="ghost-input-wrap">${showGhost ? `<span class="ghost-word" lang="en" dir="ltr" aria-hidden="true">${esc(question.target.english)}</span>` : ''}<input id="cardWritingInput" type="text" lang="en" dir="ltr" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="120" value="${feedback ? esc(feedback.typed) : ''}" ${feedback ? 'disabled' : ''}></div>${feedback ? '' : `<button class="primary-btn" type="submit">تحقق من الكتابة</button>`}</form>`;
  }

  function renderCardResult() {
    const session = state.cardPractice;
    const deck = session && state.cardDecks.find(item => item.id === session.deckId);
    if (!session || !deck) return renderCardsCenter();
    const total = session.ids.length;
    const percent = Math.round((session.correct / total) * 100);
    return `<section class="screen test-result-screen"><article class="result-hero"><div class="result-ring" style="--pct:${percent}"><div><strong>${percent}%</strong><span>النتيجة</span></div></div><div><span class="hero-eyebrow">${esc(deck.name)}</span><h1>${percent >= 80 ? 'أداء رائع!' : 'كل محاولة تقوّيك'}</h1><p>${testModeLabel(session.mode)} · ${total} بطاقات</p></div></article><div class="result-stats"><div><strong>${session.correct}</strong><span>صحيحة</span></div><div><strong>${total - session.correct}</strong><span>خاطئة</span></div><div><strong>${total}</strong><span>بطاقات</span></div></div><div class="complete-actions"><button class="primary-btn" type="button" data-action="restart-card-practice">إعادة المجموعة</button><button class="secondary-btn" type="button" data-action="back-to-deck">العودة إلى المجموعة</button><button class="secondary-btn" type="button" data-action="cards-center">كل المجموعات</button></div></section>${renderBottomNav('learn')}`;
  }

  function createManualDeck(name) {
    const cleanName = cleanManualText(name, 60);
    if (!cleanName) return null;
    const duplicate = state.cardDecks.find(deck => normalizeSearch(deck.name) === normalizeSearch(cleanName));
    if (duplicate) return duplicate;
    const deck = { id: makeLocalId('deck'), name: cleanName, cards: [], createdAt: Date.now() };
    state.cardDecks.unshift(deck);
    state.selectedDeckId = deck.id;
    return deck;
  }

  function saveManualCard(form) {
    const english = cleanManualText(form.elements.english && form.elements.english.value, 120);
    const arabic = cleanManualText(form.elements.arabic && form.elements.arabic.value, 180);
    const newDeckName = cleanManualText(form.elements.newDeckName && form.elements.newDeckName.value, 60);
    let deck = newDeckName ? createManualDeck(newDeckName) : state.cardDecks.find(item => item.id === String(form.elements.deckId && form.elements.deckId.value || ''));
    if (!english || !arabic) {
      showToast('أدخل الكلمة الإنجليزية ومعناها العربي');
      return;
    }
    if (!deck) {
      showToast('اختر مجموعة أو اكتب اسم مجموعة جديدة');
      return;
    }
    const editingId = String(form.dataset.cardId || '');
    const found = editingId ? manualCardById(editingId) : null;
    if (found) {
      found.card.english = english;
      found.card.arabic = arabic;
      found.card.updatedAt = Date.now();
      if (found.deck.id !== deck.id) {
        found.deck.cards = found.deck.cards.filter(card => card.id !== found.card.id);
        deck.cards.unshift(found.card);
      }
      showToast('تم حفظ تعديلات البطاقة');
    } else {
      const duplicate = deck.cards.find(card => normalizeSearch(card.english) === normalizeSearch(english));
      if (duplicate) {
        duplicate.arabic = arabic;
        duplicate.updatedAt = Date.now();
        showToast('كانت الكلمة موجودة؛ تم تحديث معناها');
      } else {
        deck.cards.unshift({ id: makeLocalId('card'), english, arabic, createdAt: Date.now(), updatedAt: 0 });
        showToast('أُضيفت البطاقة إلى المجموعة');
      }
    }
    state.selectedDeckId = deck.id;
    state.editingCardId = '';
    state.cardsView = 'deck';
    haptic('success');
    saveState();
    playUiSound('success');
    render();
  }

  function deleteManualCard(id) {
    const found = manualCardById(id);
    if (!found) return;
    if (!window.confirm(`حذف بطاقة “${found.card.english}” من المجموعة؟`)) return;
    found.deck.cards = found.deck.cards.filter(card => card.id !== found.card.id);
    delete state.cardStats[found.card.id];
    if (state.cardPractice && state.cardPractice.ids.includes(found.card.id)) state.cardPractice = null;
    saveState();
    haptic('selection');
    render();
    showToast('تم حذف البطاقة');
  }

  function deleteManualDeck(id) {
    const deck = state.cardDecks.find(item => item.id === String(id));
    if (!deck || !window.confirm(`حذف مجموعة “${deck.name}” وبطاقاتها؟`)) return;
    deck.cards.forEach(card => delete state.cardStats[card.id]);
    state.cardDecks = state.cardDecks.filter(item => item.id !== deck.id);
    state.cardHistory = state.cardHistory.filter(item => item.deckId !== deck.id);
    if (state.cardPractice && state.cardPractice.deckId === deck.id) state.cardPractice = null;
    state.selectedDeckId = state.cardDecks[0] ? state.cardDecks[0].id : '';
    state.cardsView = 'center';
    saveState();
    haptic('selection');
    render();
    showToast('تم حذف المجموعة');
  }

  function render() {
    applyTheme(false);
    if (state.screen === 'levels') ROOT.innerHTML = renderLevels();
    else if (state.screen === 'learn') ROOT.innerHTML = renderLearn();
    else if (state.screen === 'tests') ROOT.innerHTML = renderTests();
    else if (state.screen === 'writing') ROOT.innerHTML = renderWriting();
    else if (state.screen === 'cards') ROOT.innerHTML = renderCards();
    else if (state.screen === 'favorites') ROOT.innerHTML = renderFavorites();
    else if (state.screen === 'stats') ROOT.innerHTML = renderStats();
    else if (state.screen === 'settings') ROOT.innerHTML = renderSettings();
    else if (state.screen === 'more') ROOT.innerHTML = renderMore();
    else ROOT.innerHTML = renderHome();
    if (!state.userName && !state.nameSetupSkipped) ROOT.insertAdjacentHTML('beforeend', renderNameSetup());
    window.requestAnimationFrame(() => {
      scheduleAutoSpeech();
      scheduleTestAudio();
      scheduleWritingAudio();
      scheduleCardAudio();
    });
  }

  function renderNameSetup() {
    return `<div class="name-setup-overlay" role="presentation">
      <section class="name-setup-sheet" role="dialog" aria-modal="true" aria-labelledby="nameSetupTitle" aria-describedby="nameSetupDescription">
        <svg class="lux-avatar" viewBox="0 0 80 80" aria-hidden="true"><use href="#avatar-boy"></use></svg>
        <h2 id="nameSetupTitle">كيف تحب أن نناديك؟</h2>
        <p id="nameSetupDescription">سيظهر اسمك في ترحيب الصفحة الرئيسية، ويبقى محفوظًا على جهازك فقط.</p>
        <form id="nameSetupForm" class="profile-name-form">
          <label for="nameSetupInput">اسمك</label>
          <input id="nameSetupInput" name="userName" type="text" maxlength="24" autocomplete="name" enterkeyhint="done" placeholder="اكتب اسمك هنا" required>
          <button class="primary-btn" type="submit">متابعة</button>
        </form>
        <button class="skip-name" type="button" data-action="skip-name-setup">تخطي الآن</button>
      </section>
    </div>`;
  }

  function themeButton() {
    const dark = state.theme === 'dark';
    return `<button class="icon-btn" type="button" data-action="theme" aria-label="${dark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}">${icon(dark ? 'sun' : 'moon')}</button>`;
  }

  function settingsButton() {
    return `<button class="icon-btn" type="button" data-action="nav" data-screen="settings" aria-label="الإعدادات">${icon('settings')}</button>`;
  }

  function headerActions() {
    return `<div class="top-actions">${settingsButton()}${themeButton()}</div>`;
  }

  function renderBottomNav() {
    const items = [
      ['home', 'home', 'الرئيسية', 'nav'],
      ['favorites', 'heart', 'المراجعة', 'nav'],
      ['tests', 'trophy', 'التحدي', 'open-challenge'],
      ['levels', 'layers', 'المستويات', 'nav'],
      ['more', 'more', 'المزيد', 'nav']
    ];
    let current = ['home', 'favorites', 'tests', 'levels', 'more'].includes(state.screen) ? state.screen : 'more';
    if (state.screen === 'learn' && state.activeSession) {
      const returnScreen = resolveSession(state.activeSession).returnScreen;
      current = ['home', 'favorites', 'tests', 'levels'].includes(returnScreen) ? returnScreen : 'more';
    }
    return `<nav class="bottom-nav" aria-label="التنقل الرئيسي">${items.map(([screen, iconName, label, action]) => {
      const selected = current === screen;
      return `<button type="button" class="nav-item ${selected ? 'active' : ''}" data-action="${action}" ${action === 'nav' ? `data-screen="${screen}"` : ''} aria-current="${selected ? 'page' : 'false'}">
        ${icon(iconName)}<span>${label}</span>
      </button>`;
    }).join('')}</nav>`;
  }

  function renderHome() {
    const daily = ensureDailyPlan();
    const done = clampInt(daily.index, 0, DAILY_SIZE);
    const dailyPercent = Math.round((done / DAILY_SIZE) * 100);
    const activeSession = state.activeSession ? resolveSession(state.activeSession) : null;
    const activePosition = activeSession && activeSession.ids.length ? sessionPosition(activeSession) : done;
    const continueTitle = activeSession && activeSession.ids.length ? activeSession.title : 'كلمات اليوم';
    const continueTotal = activeSession && activeSession.ids.length ? activeSession.ids.length : DAILY_SIZE;
    const continuePercent = Math.round((Math.min(activePosition, continueTotal) / Math.max(1, continueTotal)) * 100);
    const continueIds = activeSession && activeSession.ids.length ? activeSession.ids : daily.ids;
    const lastWordRecord = continueIds && activePosition > 0 ? WORD_BY_ID.get(Number(continueIds[Math.min(activePosition, continueIds.length) - 1])) : null;
    const savedReviews = state.favorites.length;
    const levelPercent = progressPercent(state.activeLevel);
    const formattedPoints = pointsCount().toLocaleString('en-US');
    return `<section class="screen home-screen">
      <header class="lux-home-header">
        <div class="lux-metrics" aria-label="سلسلة الأيام والنقاط">
          <span class="lux-metric" aria-label="سلسلة الأيام ${streakCount()}"><span class="lux-metric-icon">${icon('flame')}</span><span><strong>${streakCount()}</strong><small>سلسلة الأيام</small></span></span>
          <span class="lux-metric" aria-label="النقاط ${formattedPoints}"><span class="lux-metric-icon">${icon('star')}</span><span><strong>${formattedPoints}</strong><small>النقاط</small></span></span>
        </div>
        <button class="lux-profile" type="button" data-action="edit-profile" aria-label="تعديل الاسم والملف الشخصي">
          <span class="lux-avatar-wrap" data-progress="${levelPercent}%" style="--avatar-progress:${levelPercent}%"><svg class="lux-avatar" viewBox="0 0 80 80" aria-hidden="true"><use href="#avatar-boy"></use></svg></span>
          <span class="lux-profile-copy"><h1>${greetingText()}</h1><span class="lux-profile-level"><b>${esc(state.activeLevel)}</b>${esc(LEVEL_NAMES[state.activeLevel])}</span></span>
        </button>
      </header>
      <label class="lux-search">${icon('search')}<input id="homeSearch" type="search" dir="auto" autocomplete="off" value="${esc(state.search)}" placeholder="ابحث عن كلمة أو معنى..." aria-label="ابحث عن كلمة أو معنى"></label>
      <div id="searchResults">${state.search ? renderSearchResults(state.search) : ''}</div>
      <div class="lux-motto"><strong>كل كلمة تقرّبك من الطلاقة</strong></div>
      <article class="lux-hero">
        <span class="lux-hero-label">${icon('book', 'icon-sm')} استكمل تعلّمك</span>
        <svg class="lux-rocket-scene" viewBox="0 0 250 210" aria-hidden="true"><use href="#scene-rocket"></use></svg>
        <div class="lux-continue-card"><span class="eyebrow">رحلتك الحالية</span><h2>${esc(continueTitle)}</h2><p>${Math.max(0, continueTotal - activePosition)} كلمة متبقية${lastWordRecord ? ` · آخر كلمة <b lang="en" dir="ltr">${esc(lastWordRecord.word)}</b>` : ''}</p><div class="mini-track"><i style="width:${continuePercent}%"></i></div><button type="button" data-action="${activeSession && activeSession.ids.length ? 'resume-learning' : 'start-daily'}">${icon('play', 'icon-sm')} ${activePosition ? 'استمر الآن' : 'ابدأ الآن'}</button></div>
      </article>
      <div class="lux-shortcuts">
        <button class="lux-shortcut" type="button" data-action="nav" data-screen="writing"><span class="lux-shortcut-icon">${icon('pen')}</span><strong>تدريب الكتابة</strong><small>ثبّت شكل الكلمة</small></button>
        <button class="lux-shortcut" type="button" data-action="nav" data-screen="favorites"><span class="lux-shortcut-icon">${icon('book')}</span><strong>المراجعة</strong><small>${savedReviews} كلمة محفوظة</small></button>
        <button class="lux-shortcut cards-shortcut" type="button" data-action="nav" data-screen="cards"><span class="lux-shortcut-icon">${icon('cards')}</span><strong>بطاقاتي</strong><small>${state.cardDecks.length} مجموعات خاصة</small></button>
        <button class="lux-shortcut tests-shortcut" type="button" data-action="open-challenge"><span class="lux-shortcut-icon">${icon('trophy')}</span><strong>الاختبارات</strong><small>${state.testHistory.length ? `${state.testHistory.length} نتائج محفوظة` : 'اختبر مستواك'}</small></button>
      </div>
      <article class="lux-daily">
        <svg class="lux-target" viewBox="0 0 110 110" aria-hidden="true"><use href="#scene-target"></use></svg>
        <div class="lux-daily-copy"><h2>هدف اليوم</h2><p>${daily.completed ? 'اكتمل هدف اليوم.' : `تبقّى ${Math.max(0, DAILY_SIZE - done)} كلمة.`}</p><button type="button" data-action="start-daily">${daily.completed ? 'مراجعة اليوم' : 'ابدأ الآن'} ${icon('play', 'icon-sm')}</button></div>
        <div class="lux-daily-ring" style="--pct:${dailyPercent}"><span><strong>${done}</strong><small>من 50</small></span></div>
      </article>
    </section>${renderBottomNav('home')}`;
  }

  function renderMore() {
    const reviews = reviewIds().length;
    const tools = [
      ['levels', 'list', 'المستويات والجولات', `${LEVELS.length} مستويات · جولات من 50 كلمة`, 'nav'],
      ['tests', 'quiz', 'مركز الاختبارات', `${state.testHistory.length} نتائج محفوظة`, 'open-tests'],
      ['writing', 'keyboard', 'تدريب الكتابة', 'اكتب فوق التلميح الشفاف', 'nav'],
      ['favorites', 'heart', 'المراجعة', `${state.favorites.length} كلمات محفوظة`, 'nav'],
      ['stats', 'chart', 'الإحصائيات', `${learnedCount()} كلمات متعلّمة`, 'nav'],
      ['settings', 'settings', 'الإعدادات', 'الصوت · الحركة · الوضع الليلي', 'nav']
    ];
    return `<section class="screen more-screen">
      <header class="page-titlebar"><div><h1>المزيد</h1><p>كل أدواتك في مكان واحد، بدون ازدحام الرئيسية</p></div>${headerActions()}</header>
      <div class="search-wrap">${icon('search')}<input id="homeSearch" class="search-input" type="search" dir="auto" autocomplete="off" value="${esc(state.search)}" placeholder="ابحث عن كلمة أو معنى" aria-label="ابحث عن كلمة أو معنى"></div>
      <div id="searchResults">${state.search ? renderSearchResults(state.search) : ''}</div>
      <div class="more-tools-grid">${tools.map(([screen, iconName, title, caption, action]) => `<button class="more-tool-card ${screen === 'favorites' ? 'favorite-tool' : ''}" type="button" data-action="${action}" ${action === 'nav' ? `data-screen="${screen}"` : ''}><span class="more-tool-icon">${icon(iconName)}</span><span><strong>${title}</strong><small>${caption}</small></span>${icon('chevron', 'icon-sm')}</button>`).join('')}</div>
      <button class="more-review-banner" type="button" data-action="start-review"><span>${icon('review')}</span><span><strong>المراجعة الذكية</strong><small>${reviews ? `${reviews} كلمة جاهزة للمراجعة` : 'لا توجد كلمات معلّقة الآن'}</small></span>${icon('chevron')}</button>
    </section>${renderBottomNav('more')}`;
  }

  function searchMatches(query, source = WORDS) {
    const clean = normalizeSearch(query);
    if (!clean) return [];
    return source.filter(word => {
      const examples = word.examples.map(example => `${example.en} ${example.ar}`).join(' ');
      return normalizeSearch(`${word.word} ${word.arabic} ${word.pos} ${word.level} ${examples}`).includes(clean);
    }).slice(0, 30);
  }

  function renderSearchResults(query) {
    const matches = searchMatches(query);
    if (!matches.length) return `<div class="search-panel"><div class="search-empty">لا توجد نتائج مطابقة</div></div>`;
    return `<div class="search-panel"><div class="search-meta">${matches.length === 30 ? 'أول 30 نتيجة' : `${matches.length} نتيجة`}</div>${matches.map(renderWordRow).join('')}</div>`;
  }

  function renderWordRow(word) {
    const favorite = state.favorites.includes(Number(word.id));
    return `<div class="word-row" data-word-id="${word.id}">
      <button class="word-main" type="button" data-action="open-word" data-id="${word.id}"><strong>${esc(word.word)}</strong><span>${esc(word.arabic)}</span></button>
      <span class="word-level">${esc(word.level)}</span>
      <button class="row-action ${favorite ? 'favorite' : ''}" type="button" data-action="favorite" data-id="${word.id}" aria-label="${favorite ? 'إزالة من المراجعة' : 'إضافة إلى المراجعة'}">${icon('heart', 'icon-sm')}</button>
    </div>`;
  }

  function roundCardsFor(level) {
    const words = LEVEL_WORDS[level];
    const count = Math.ceil(words.length / 50);
    return Array.from({ length: count }, (_, round) => {
      const ids = words.slice(round * 50, round * 50 + 50).map(word => word.id);
      const key = `round:${level}:${round}`;
      const position = clampInt(state.positions[key], 0, ids.length);
      const learned = ids.filter(id => state.progress[id] === 'learned').length;
      const percent = Math.round((Math.max(position, learned) / ids.length) * 100);
      return { level, round, ids, position, learned, percent };
    });
  }

  function roundStatus(round) {
    if (round.position >= round.ids.length) return 'مكتملة — اضغط لإعادتها';
    if (round.position > 0) return `مستمرة — ${round.position} من ${round.ids.length}`;
    if (round.learned > 0) return `${round.learned} كلمة متعلّمة مسبقًا`;
    return 'لم تبدأ';
  }

  function renderRoundMini(round) {
    return `<button class="round-mini" type="button" data-action="start-round" data-level="${round.level}" data-round="${round.round}"><div class="round-mini-head"><div><h3>الجولة ${round.round + 1}</h3><p>الكلمات ${round.round * 50 + 1}–${round.round * 50 + round.ids.length}</p></div><strong>${round.percent}%</strong></div><div class="mini-track"><i style="width:${round.percent}%"></i></div></button>`;
  }

  function renderLevels() {
    const rounds = roundCardsFor(state.activeLevel);
    return `<section class="screen levels-screen">
      <header class="lux-page-heading"><div><h1>المستويات والجولات</h1><p>اختر المستوى ثم ابدأ من أي مجموعة</p></div>${headerActions()}</header>
      <div class="segmented" role="tablist">${LEVELS.map(level => `<button type="button" role="tab" class="segment ${state.activeLevel === level ? 'active' : ''}" data-action="select-level" data-level="${level}" aria-selected="${state.activeLevel === level}">${level}</button>`).join('')}</div>
      <article class="lux-level-hero"><div><h2>رحلتك نحو الإتقان</h2><p>ابدأ باختبار أو تابع جولات من 50 كلمة.</p><span class="hero-chip">${state.activeLevel} · ${esc(LEVEL_NAMES[state.activeLevel])}</span></div><svg class="lux-planet-scene" viewBox="0 0 180 135" aria-hidden="true"><use href="#scene-books-planet"></use></svg></article>
      <div class="lux-feature-list">
        <button class="lux-feature-card" type="button" data-action="open-level-test" data-level="${state.activeLevel}"><span class="lux-feature-illustration">${icon('quiz')}</span><span><h2>اختبار ${state.activeLevel}</h2><p>10 أو 25 أو 50 كلمة، أو المستوى كاملًا.</p></span><span class="circle-arrow">${icon('chevron')}</span></button>
        <button class="lux-feature-card" type="button" data-action="nav" data-screen="favorites"><span class="lux-feature-illustration">${icon('heart')}</span><span><h2>المراجعة</h2><p>ارجع إلى كلماتك المحفوظة في جلسة خاصة.</p></span><span class="circle-arrow">${icon('chevron')}</span></button>
      </div>
      <div class="section-head"><h2>${state.activeLevel} — ${LEVEL_NAMES[state.activeLevel]}</h2><span class="section-caption">${LEVEL_WORDS[state.activeLevel].length} مدخل</span></div>
      <div class="round-list">${rounds.map(round => `<button class="round-card" type="button" data-action="start-round" data-level="${round.level}" data-round="${round.round}"><div><h3>الجولة ${round.round + 1}</h3><p>الكلمات ${round.round * 50 + 1}–${round.round * 50 + round.ids.length} · ${round.ids.length} كلمة</p><span class="status-label">${roundStatus(round)}</span></div><div class="round-progress" style="--pct:${round.percent}"><strong>${round.percent}%</strong></div></button>`).join('')}</div>
    </section>${renderBottomNav('levels')}`;
  }

  function renderFavorites() {
    const query = normalizeSearch(state.favoriteSearch);
    const source = favoriteWordsForFilter(state.favoriteFilter);
    const matches = query ? searchMatches(query, source) : source;
    return `<section class="screen">
      <header class="page-titlebar"><div><h1>المراجعة</h1><p>${state.favorites.length} كلمة محفوظة حسب المستوى</p></div>${headerActions()}</header>
      ${state.favorites.length ? `<div class="favorite-level-tabs" role="tablist">${['ALL', ...LEVELS].map(level => { const count = favoriteWordsForFilter(level).length; return `<button type="button" role="tab" class="${state.favoriteFilter === level ? 'active' : ''}" data-action="filter-favorites" data-level="${level}" aria-selected="${state.favoriteFilter === level}">${level === 'ALL' ? 'الكل' : level}<small>${count}</small></button>`; }).join('')}</div>
      <article class="favorite-level-summary"><div><span class="hero-eyebrow">${state.favoriteFilter === 'ALL' ? 'كل المستويات' : `المستوى ${state.favoriteFilter}`}</span><h2>${source.length} كلمة للمراجعة</h2><p>إزالة القلب تُخرج الكلمة من الحفظ فقط ولا تحذف تقدمك.</p></div><strong>${source.length}</strong><button type="button" data-action="start-favorites" data-level="${state.favoriteFilter}" ${source.length ? '' : 'disabled'}>${icon('play', 'icon-sm')} ابدأ المراجعة</button></article>
      <div class="search-wrap">${icon('search')}<input id="favoriteSearch" class="search-input" type="search" dir="auto" value="${esc(state.favoriteSearch)}" placeholder="ابحث داخل المراجعة" aria-label="ابحث داخل المراجعة"></div>
      <div id="favoriteList" class="word-list">${matches.length ? matches.map(renderWordRow).join('') : '<div class="search-empty">لا توجد نتيجة في هذا المستوى</div>'}</div>` : `<div class="empty-state"><div class="empty-illustration">${icon('heart')}</div><h2>لا توجد كلمات محفوظة بعد</h2><p>اضغط رمز القلب بجانب أي كلمة؛ ستذهب تلقائيًا إلى مجموعة مستواها.</p><button class="primary-btn" type="button" data-action="start-daily">ابدأ التعلّم</button></div>`}
    </section>${renderBottomNav('favorites')}`;
  }

  function favoriteWordsForFilter(level = 'ALL') {
    return state.favorites.map(id => WORD_BY_ID.get(Number(id))).filter(word => word && (level === 'ALL' || word.level === level));
  }

  function renderStats() {
    const learned = learnedCount();
    const reviews = reviewIds().length;
    const overall = Math.round((learned / WORDS.length) * 100);
    const daily = ensureDailyPlan();
    return `<section class="screen stats-screen">
      <header class="lux-page-heading"><div><h1>إحصائياتك</h1><p>تقدّم الكلمات والاختبارات</p></div>${headerActions()}</header>
      <article class="lux-stats-hero"><div><h2>ملخص تقدّمك</h2><p>نتائج الكلمات والاختبارات</p><strong class="lux-stats-score">${overall}%</strong></div><svg class="lux-trophy-scene" viewBox="0 0 165 145" aria-hidden="true"><use href="#scene-trophy"></use></svg></article>
      <div class="stat-grid four"><div class="stat-card"><strong>${learned}</strong><span>تعلّمتها</span></div><div class="stat-card"><strong>${masteredCount()}</strong><span>متقنة</span></div><div class="stat-card"><strong>${overallTestAccuracy()}%</strong><span>دقة الاختبارات</span></div><div class="stat-card"><strong>${streakCount()}</strong><span>سلسلة الأيام</span></div></div>
      <div class="section"><div class="section-head"><h2>هدف اليوم</h2><span>${daily.index} / 50</span></div><div class="wide-track"><i style="width:${Math.round((daily.index / 50) * 100)}%"></i></div></div>
      <div class="section"><div class="section-head"><h2>تقدم المستويات</h2></div><div class="level-stats">${LEVELS.map(level => {
        const learnedLevel = learnedCount(LEVEL_WORDS[level]);
        const percent = progressPercent(level);
        return `<div class="level-stat"><div class="level-stat-head"><strong>${level}</strong><span>${learnedLevel} من ${LEVEL_WORDS[level].length} · ${percent}%</span></div><div class="wide-track"><i style="width:${percent}%"></i></div></div>`;
      }).join('')}</div></div>
      <div class="section"><div class="quick-grid"><button class="quick-card" type="button" data-action="start-review"><span class="quick-icon">${icon('review')}</span><span><strong>${reviews}</strong><span>جلسة مراجعة</span></span></button><button class="quick-card" type="button" data-action="nav" data-screen="favorites"><span class="quick-icon pink">${icon('heart')}</span><span><strong>${state.favorites.length}</strong><span>محفوظة للمراجعة</span></span></button></div></div>
    </section>${renderBottomNav('stats')}`;
  }

  function renderTests() {
    if (state.testView === 'session' && state.testSession && state.testSession.status === 'active') return renderTestSession();
    if (state.testView === 'result' && state.testSession && state.testSession.status === 'result') return renderTestResult();
    if (state.testView === 'setup') return renderTestSetup();
    if (state.testView === 'mistakes') return renderMistakesBook();
    return renderTestCenter();
  }

  function renderTestCenter() {
    const active = state.testSession && state.testSession.status === 'active' ? state.testSession : null;
    const mistakes = activeMistakeIds();
    return `<section class="screen tests-screen">
      <header class="page-titlebar"><div><h1>مركز الاختبارات</h1><p>اختبر مستواك وابنِ إتقانًا حقيقيًا</p></div>${headerActions()}</header>
      <article class="test-hero">
        <div class="test-hero-icon">${icon('quiz')}</div>
        <div><span class="hero-eyebrow">تحدٍ ذكي</span><h2>${active ? `اختبار ${active.level === 'ALL' ? 'دفتر الأخطاء' : active.level} مستمر` : 'جاهز لاختبار جديد؟'}</h2><p>${active ? `${active.index + 1} من ${active.ids.length} · تقدمك محفوظ` : 'اختر مستوى ونوع الاختبار، وسيتولى التطبيق تسجيل أخطائك وإتقانك.'}</p></div>
        ${active ? `<button class="white-btn" type="button" data-action="resume-test">متابعة الاختبار</button>` : `<button class="white-btn" type="button" data-action="open-test-setup" data-level="${state.testConfig.level}">ابدأ اختبارًا</button>`}
      </article>
      ${active ? `<div class="active-test-actions"><button class="text-danger-btn" type="button" data-action="discard-test">حذف الاختبار المحفوظ</button></div>` : ''}
      <div class="section"><div class="section-head"><h2>اختر المستوى</h2><span class="section-caption">A1 إلى B2</span></div>
        <div class="test-level-grid">${LEVELS.map(level => {
          const mastered = masteredCount(level);
          const total = LEVEL_WORDS[level].length;
          const percent = Math.round((mastered / total) * 100);
          const errors = activeMistakeIds(level).length;
          return `<button class="test-level-card" type="button" data-action="open-test-setup" data-level="${level}"><span class="test-level-name">${level}</span><strong>${LEVEL_NAMES[level]}</strong><span>${mastered} متقنة · ${errors} أخطاء</span><div class="mini-track"><i style="width:${percent}%"></i></div></button>`;
        }).join('')}</div>
      </div>
      <button class="mistakes-shortcut" type="button" data-action="open-mistakes"><span class="mistake-icon">${icon('alert')}</span><span><strong>دفتر الأخطاء</strong><small>${mistakes.length ? `${mistakes.length} كلمة تحتاج تدريبًا` : 'لا توجد أخطاء نشطة الآن'}</small></span><span class="mistake-count">${mistakes.length}</span>${icon('chevron')}</button>
      <div class="section"><div class="section-head"><h2>آخر النتائج</h2></div>${renderTestHistory()}</div>
    </section>${renderBottomNav('learn')}`;
  }

  function renderTestHistory() {
    if (!state.testHistory.length) return `<div class="history-empty">ستظهر نتائج اختباراتك هنا بعد أول محاولة.</div>`;
    return `<div class="test-history">${state.testHistory.slice(0, 5).map(item => {
      const percent = Math.round((Number(item.correct) / Number(item.total)) * 100);
      const date = new Date(Number(item.completedAt) || Date.now()).toLocaleDateString('ar-AE', { day: 'numeric', month: 'short' });
      return `<div class="history-row"><span class="history-score ${percent >= 80 ? 'great' : percent >= 60 ? 'good' : ''}">${percent}%</span><span><strong>${item.level === 'ALL' ? 'دفتر الأخطاء' : `المستوى ${item.level}`}</strong><small>${testModeLabel(item.mode)} · ${item.correct}/${item.total}</small></span><time>${esc(date)}</time></div>`;
    }).join('')}</div>`;
  }

  function renderTestSetup() {
    const config = state.testConfig;
    const levelCount = LEVEL_WORDS[config.level].length;
    const selectedCount = config.size === 'all' ? levelCount : Number(config.size);
    const estimated = Math.max(2, Math.ceil(selectedCount * (config.mode === 'spelling' ? 0.22 : 0.13)));
    const active = state.testSession && state.testSession.status === 'active';
    return `<section class="screen tests-screen">
      <header class="subpage-titlebar"><button class="back-btn" type="button" data-action="test-center" aria-label="العودة لمركز الاختبارات">${icon('arrow')}</button><div><h1>إعداد اختبار ${config.level}</h1><p>خصص المحاولة بالطريقة المناسبة لك</p></div>${settingsButton()}</header>
      <div class="setup-section"><h2>المستوى</h2><div class="segmented" aria-label="اختيار المستوى">${LEVELS.map(level => `<button type="button" class="segment ${config.level === level ? 'active' : ''}" data-action="set-test-level" data-level="${level}" aria-pressed="${config.level === level}">${level}</button>`).join('')}</div></div>
      <div class="setup-section"><h2>عدد الأسئلة</h2><div class="size-grid">${TEST_SIZES.map(size => {
        const label = size === 'all' ? `كل المستوى` : `${size} كلمة`;
        const caption = size === 'all' ? `${levelCount} كلمة · قابل للاستكمال` : size === 10 ? 'اختبار سريع' : size === 25 ? 'جلسة متوسطة' : 'تحدٍ كامل';
        return `<button type="button" class="size-option ${config.size === size ? 'active' : ''}" data-action="set-test-size" data-size="${size}" aria-pressed="${config.size === size}"><strong>${label}</strong><span>${caption}</span></button>`;
      }).join('')}</div></div>
      <div class="setup-section"><h2>نوع الاختبار</h2><div class="mode-grid">${TEST_MODES.map(mode => `<button type="button" class="mode-option ${config.mode === mode ? 'active' : ''}" data-action="set-test-mode" data-mode="${mode}" aria-pressed="${config.mode === mode}"><span>${icon(testModeIcon(mode))}</span><strong>${testModeLabel(mode)}</strong><small>${mode === 'meaning' ? 'إنجليزي إلى عربي' : mode === 'reverse' ? 'عربي إلى إنجليزي' : mode === 'listening' ? 'استمع ثم اختر' : mode === 'spelling' ? 'اكتب الكلمة' : 'تنويع تلقائي'}</small></button>`).join('')}</div></div>
      <article class="test-summary"><span>${icon('spark')}</span><div><strong>${selectedCount} سؤالًا · حوالي ${estimated} دقائق</strong><p>يُحفظ تقدمك تلقائيًا ويمكنك المتابعة لاحقًا.</p></div></article>
      ${active ? `<div class="inline-warning">لديك اختبار مستمر. أكمله أو احذفه من مركز الاختبارات قبل بدء اختبار جديد.</div><button class="primary-btn wide-btn" type="button" data-action="resume-test">متابعة الاختبار الحالي</button>` : `<button class="primary-btn wide-btn start-test-btn" type="button" data-action="start-test">${icon('play')} ابدأ الاختبار</button>`}
    </section>${renderBottomNav('learn')}`;
  }

  function renderTestSession() {
    const session = state.testSession;
    const question = currentTestQuestion();
    if (!session || !question) return renderTestCenter();
    const feedback = session.feedback;
    const percent = Math.round((session.index / session.ids.length) * 100);
    const modePrompt = question.mode === 'meaning' ? 'اختر المعنى الصحيح' : question.mode === 'reverse' ? 'اختر الكلمة الإنجليزية' : question.mode === 'listening' ? 'استمع ثم اختر الكلمة' : 'اكتب الكلمة بالإنجليزية';
    const mainPrompt = question.mode === 'meaning' ? `<div class="english-test-prompt"><h1 lang="en" dir="ltr">${esc(question.target.word)}</h1><button class="sound-btn prompt-sound-btn" type="button" data-action="test-speak" data-id="${question.target.id}" aria-label="نطق الكلمة">${icon('volume', 'icon-lg')}</button></div>`
      : question.mode === 'listening' ? `<button class="test-listen-btn sound-btn" type="button" data-action="test-speak" data-id="${question.target.id}" aria-label="تشغيل صوت الكلمة">${icon('volume', 'icon-lg')}<span>اضغط للاستماع</span></button><button class="slow-speech-btn" type="button" data-action="test-speak-slow" data-id="${question.target.id}">نطق بطيء</button>`
      : `<h1 lang="ar" dir="rtl">${esc(question.target.arabic)}</h1>`;
    return `<section class="screen test-session-screen">
      <header class="learn-top test-top"><button class="back-btn" type="button" data-action="exit-test" aria-label="حفظ الاختبار والخروج">${icon('close')}</button><div class="learn-top-info"><div class="learn-title">اختبار ${session.level === 'ALL' ? 'دفتر الأخطاء' : session.level}</div><div class="learn-count">${session.index + 1} / ${session.ids.length}</div><div class="learn-track" role="progressbar" aria-label="تقدم الاختبار" aria-valuemin="0" aria-valuemax="${session.ids.length}" aria-valuenow="${session.index}"><i style="width:${percent}%"></i></div></div><span class="score-chip">${session.correct} صحيحة</span></header>
      <article class="question-card ${feedback ? (feedback.correct ? 'answered-correct' : 'answered-wrong') : ''}">
        <div class="question-mode">${icon(testModeIcon(question.mode), 'icon-sm')} ${testModeLabel(question.mode)}</div>
        <p class="question-instruction">${modePrompt}</p>
        <div class="question-prompt">${mainPrompt}</div>
        ${question.mode === 'spelling' ? renderSpellingAnswer(question, feedback) : renderChoiceAnswers(question, feedback)}
        ${feedback ? renderTestFeedback(question, feedback) : ''}
      </article>
      ${feedback ? `<button class="primary-btn wide-btn next-question-btn" type="button" data-action="next-test-question">${session.index + 1 >= session.ids.length ? 'عرض النتيجة' : 'السؤال التالي'} ${icon('arrow', 'icon-sm')}</button>` : ''}
      <p class="test-save-note">${icon('check', 'icon-sm')} يُحفظ تقدم الاختبار بعد كل إجابة</p>
    </section>`;
  }

  function renderChoiceAnswers(question, feedback) {
    return `<div class="answer-grid">${question.options.map(option => {
      let className = '';
      if (feedback) {
        if (Number(option.id) === Number(question.target.id)) className = 'correct-answer';
        else if (Number(option.id) === Number(feedback.selectedId)) className = 'wrong-answer';
      }
      return `<button class="answer-option ${className}" type="button" data-action="answer-test" data-answer-id="${option.id}" ${feedback ? 'disabled' : ''}><span lang="${question.mode === 'meaning' ? 'ar' : 'en'}" dir="${question.mode === 'meaning' ? 'rtl' : 'ltr'}">${esc(option.label)}</span>${feedback && Number(option.id) === Number(question.target.id) ? icon('check', 'icon-sm') : ''}</button>`;
    }).join('')}</div>`;
  }

  function renderSpellingAnswer(question, feedback) {
    const typed = feedback ? feedback.typed : '';
    return `<form id="testSpellingForm" class="spelling-form"><label for="spellingInput">إجابتك</label><input id="spellingInput" class="spelling-input ${feedback ? (feedback.correct ? 'correct' : 'wrong') : ''}" type="text" lang="en" dir="ltr" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="120" value="${esc(typed)}" placeholder="Type the English word" ${feedback ? 'disabled' : ''}>${feedback ? '' : `<button class="primary-btn" type="submit">تحقق من الإجابة</button>`}</form>`;
  }

  function renderTestFeedback(question, feedback) {
    return `<div class="answer-feedback ${feedback.correct ? 'correct' : 'wrong'}" role="status" aria-live="polite"><span class="feedback-icon">${icon(feedback.correct ? 'check' : 'close')}</span><div><strong>${feedback.correct ? 'إجابة صحيحة!' : 'ليست صحيحة'}</strong><p>${feedback.correct ? `ارتفعت درجة إتقان «${esc(question.target.word)}».` : `الإجابة الصحيحة: <b lang="en" dir="ltr">${esc(question.target.word)}</b> — ${esc(question.target.arabic)}`}</p></div>${question.mode === 'reverse' || question.mode === 'spelling' ? `<button class="sound-btn feedback-sound-btn" type="button" data-action="test-speak" data-id="${question.target.id}" aria-label="نطق الإجابة">${icon('volume')}</button>` : ''}</div>`;
  }

  function renderTestResult() {
    const session = state.testSession;
    if (!session) return renderTestCenter();
    const total = session.ids.length;
    const correct = session.correct;
    const wrong = total - correct;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    const duration = Math.max(1, Math.round(((session.completedAt || Date.now()) - session.startedAt) / 60000));
    const wrongIds = [...new Set(session.answers.filter(answer => !answer.correct).map(answer => Number(answer.id)))];
    const title = percent >= 90 ? 'نتيجة أسطورية!' : percent >= 75 ? 'أداء رائع!' : percent >= 60 ? 'تقدم جميل' : 'كل محاولة تقرّبك';
    return `<section class="screen test-result-screen">
      <article class="result-hero"><div class="result-ring" style="--pct:${percent}"><div><strong>${percent}%</strong><span>النتيجة</span></div></div><div><span class="hero-eyebrow">اختبار ${session.level === 'ALL' ? 'دفتر الأخطاء' : session.level}</span><h1>${title}</h1><p>${testModeLabel(session.mode)} · ${total} سؤالًا</p></div></article>
      <div class="result-stats"><div><strong>${correct}</strong><span>صحيحة</span></div><div><strong>${wrong}</strong><span>خاطئة</span></div><div><strong>${duration}</strong><span>دقيقة</span></div></div>
      ${wrongIds.length ? `<div class="section"><div class="section-head"><h2>كلمات تحتاج تركيزًا</h2><span>${wrongIds.length}</span></div><div class="result-wrong-list">${wrongIds.slice(0, 6).map(id => { const word = WORD_BY_ID.get(id); return `<div><span lang="en" dir="ltr">${esc(word.word)}</span><small>${esc(word.arabic)}</small></div>`; }).join('')}</div></div>` : `<div class="perfect-result">${icon('trophy')}<strong>أجبت عن كل الكلمات بشكل صحيح</strong><span>استمر بهذا المستوى!</span></div>`}
      <div class="complete-actions">${wrongIds.length ? `<button class="primary-btn" type="button" data-action="retry-wrong">${icon('review')} اختبر أخطائي الآن</button>` : ''}<button class="secondary-btn" type="button" data-action="new-test">اختبار جديد</button><button class="secondary-btn" type="button" data-action="test-center">العودة إلى المركز</button></div>
    </section>${renderBottomNav('learn')}`;
  }

  function renderMistakesBook() {
    const level = state.mistakeFilter === 'ALL' ? null : state.mistakeFilter;
    const ids = activeMistakeIds(level);
    return `<section class="screen mistakes-screen">
      <header class="subpage-titlebar"><button class="back-btn" type="button" data-action="test-center" aria-label="العودة">${icon('arrow')}</button><div><h1>دفتر الأخطاء</h1><p>تختفي الكلمة بعد 3 إجابات صحيحة متتالية</p></div>${settingsButton()}</header>
      <div class="mistake-tabs">${['ALL', ...LEVELS].map(item => `<button type="button" class="${state.mistakeFilter === item ? 'active' : ''}" data-action="filter-mistakes" data-level="${item}" aria-pressed="${state.mistakeFilter === item}">${item === 'ALL' ? 'الكل' : item}</button>`).join('')}</div>
      ${ids.length ? `<div class="list-toolbar"><button class="primary-btn" type="button" data-action="start-mistakes-test">${icon('quiz')} اختبر هذه الكلمات (${ids.length})</button></div><div class="mistake-list">${ids.map(id => renderMistakeRow(id)).join('')}</div>` : `<div class="empty-state"><div class="empty-illustration">${icon('trophy')}</div><h2>رائع! دفتر الأخطاء فارغ</h2><p>الكلمات التي تخطئ فيها ستظهر هنا تلقائيًا حتى تتقنها.</p><button class="primary-btn" type="button" data-action="open-test-setup" data-level="${state.testConfig.level}">ابدأ اختبارًا جديدًا</button></div>`}
    </section>${renderBottomNav('learn')}`;
  }

  function renderMistakeRow(id) {
    const word = WORD_BY_ID.get(Number(id));
    const mistake = state.mistakes[id];
    const status = masteryStatus(id);
    const favorite = state.favorites.includes(Number(id));
    return `<article class="mistake-row"><div class="mistake-main"><span class="mistake-word" lang="en" dir="ltr">${esc(word.word)}</span><span>${esc(word.arabic)}</span><div><span class="mastery-pill ${status.className}">${status.label}</span><small>${mistake.count} ${mistake.count === 1 ? 'خطأ' : 'أخطاء'} · ${mistake.correctStreak}/3 صحيحة</small></div></div><button class="row-action" type="button" data-action="speak" data-id="${id}" aria-label="نطق الكلمة">${icon('volume', 'icon-sm')}</button><button class="row-action ${favorite ? 'favorite' : ''}" type="button" data-action="favorite" data-id="${id}" aria-label="المراجعة">${icon('heart', 'icon-sm')}</button></article>`;
  }

  function settingToggle(key, iconName, title, description) {
    const enabled = Boolean(state.settings[key]);
    return `<button class="setting-row" type="button" data-action="toggle-setting" data-setting="${key}" aria-pressed="${enabled}"><span class="setting-icon">${icon(iconName)}</span><span class="setting-copy"><strong>${title}</strong><small>${description}</small></span><span class="switch ${enabled ? 'on' : ''}" aria-hidden="true"><i></i></span></button>`;
  }

  function renderSettings() {
    return `<section class="screen settings-screen">
      <header class="lux-page-heading"><div><h1>الإعدادات</h1><p>اجعل تجربة التعلم مناسبة لك</p></div><div class="heading-actions">${themeButton()}<button class="back-btn" type="button" data-action="close-settings" aria-label="العودة">${icon('arrow')}</button></div></header>
      <article class="lux-settings-hero"><div><h2>خصّص تجربتك</h2><p>تحكّم بالصوت والحركة واسمك من مكان واحد.</p></div><svg class="lux-headphones-scene" viewBox="0 0 170 130" aria-hidden="true"><use href="#scene-headphones"></use></svg></article>
      <article class="profile-name-card" id="profileNameCard"><h2>اسمك في التطبيق</h2><p>يظهر في ترحيب الصفحة الرئيسية، ويُحفظ على جهازك فقط.</p><form id="profileNameForm" class="profile-name-form"><label for="profileNameInput">الاسم</label><input id="profileNameInput" name="userName" type="text" maxlength="24" autocomplete="name" enterkeyhint="done" value="${esc(state.userName)}" placeholder="اكتب اسمك"><button type="submit">حفظ</button></form></article>
      <div class="settings-group"><h2>الصوت</h2>${settingToggle('autoSpeakWord', 'volume', 'نطق الكلمة عند ظهورها', 'يعمل تلقائيًا في بداية كل بطاقة')}${settingToggle('autoSpeakSentence', 'headphones', 'نطق الجملة تلقائيًا', 'يبدأ بعد نطق الكلمة ويمكن إيقافه')}${settingToggle('navigationSounds', 'spark', 'صوت Velvet للتنقل', 'يعمل للأقسام الرئيسية والرجوع، ومستواه يتبع صوت الجهاز')}</div>
      <div class="settings-group"><div class="setting-heading"><span class="setting-icon">${icon('volume')}</span><span><strong>سرعة النطق</strong><small>يمكن تغييرها في أي وقت</small></span></div><div class="speech-rate-options">${[[0.72, 'بطيئة'], [0.86, 'عادية'], [1, 'سريعة']].map(([rate, label]) => `<button type="button" class="${state.settings.speechRate === rate ? 'active' : ''}" data-action="set-speech-rate" data-rate="${rate}" aria-pressed="${state.settings.speechRate === rate}">${label}</button>`).join('')}</div><button class="preview-speech-btn" type="button" data-action="preview-speech">${icon('volume', 'icon-sm')} تجربة الصوت</button></div>
      <div class="settings-group"><h2>التفاعل</h2>${settingToggle('haptics', 'spark', 'الاهتزاز الذكي', 'اهتزاز خفيف للنجاح ومختلف للخطأ')}${settingToggle('animations', 'spark', 'الحركات والمؤثرات', 'يحترم أيضًا إعداد تقليل الحركة في الهاتف')}<button class="preview-haptic-btn" type="button" data-action="preview-haptic">تجربة الاهتزاز</button></div>
      <div class="settings-group"><h2>المظهر</h2><div class="theme-options"><button type="button" class="${state.theme === 'light' ? 'active' : ''}" data-action="set-theme" data-theme="light" aria-pressed="${state.theme === 'light'}">${icon('sun')} فاتح</button><button type="button" class="${state.theme === 'dark' ? 'active' : ''}" data-action="set-theme" data-theme="dark" aria-pressed="${state.theme === 'dark'}">${icon('moon')} ليلي</button></div></div>
      <article class="privacy-card"><span>${icon('check')}</span><div><strong>خصوصية كاملة</strong><p>لا حساب، لا إعلانات، ولا تتبع. كلماتك وتقدمك محفوظان محليًا على جهازك.</p></div></article>
      <div class="app-version"><strong>English Boost</strong><span>الإصدار 4.0.0 · يعمل دون إنترنت</span></div>
    </section>${renderBottomNav(state.activeSession ? 'learn' : 'home')}`;
  }

  function renderLearningHub() {
    const daily = ensureDailyPlan();
    const reviews = reviewIds().length;
    const activeTest = state.testSession && state.testSession.status === 'active' ? state.testSession : null;
    return `<section class="screen learning-hub-screen">
      <header class="page-titlebar"><div><h1>تعلّم بطريقتك</h1><p>جلسات واضحة واختبارات تحفظ تقدمك</p></div>${headerActions()}</header>
      <article class="learning-launch daily-launch">
        <span class="launch-icon">${icon('book')}</span>
        <div><span class="launch-eyebrow">هدف اليوم</span><h2>التعلّم اليومي</h2><p>${daily.index} من 50 كلمة · يُحفظ موضعك تلقائيًا</p></div>
        <button class="white-btn" type="button" data-action="start-daily">${daily.index ? 'متابعة' : 'ابدأ الآن'}</button>
      </article>
      <article class="learning-launch test-launch">
        <span class="launch-icon">${icon('quiz')}</span>
        <div><span class="launch-eyebrow">تحدَّ نفسك</span><h2>مركز الاختبارات</h2><p>اختبارات A1–B2 مع استماع وتهجئة ودفتر أخطاء.</p></div>
        <button class="primary-btn" type="button" data-action="open-tests">${activeTest ? `متابعة ${activeTest.index + 1}/${activeTest.ids.length}` : 'افتح الاختبارات'}</button>
      </article>
      <div class="quick-grid hub-quick-grid">
        <button class="quick-card" type="button" data-action="nav" data-screen="writing"><span class="quick-icon">${icon('keyboard')}</span><span><strong>اكتب الكلمة</strong><span>تلميح شفاف ونطق بعد الإجابة</span></span></button>
        <button class="quick-card" type="button" data-action="nav" data-screen="cards"><span class="quick-icon">${icon('book')}</span><span><strong>${state.cardDecks.length}</strong><span>مجموعات بطاقاتي</span></span></button>
        <button class="quick-card" type="button" data-action="start-review"><span class="quick-icon">${icon('review')}</span><span><strong>${reviews}</strong><span>جلسة مراجعة</span></span></button>
        <button class="quick-card" type="button" data-action="nav" data-screen="favorites"><span class="quick-icon pink">${icon('heart')}</span><span><strong>${state.favorites.length}</strong><span>كلمات للمراجعة</span></span></button>
      </div>
    </section>${renderBottomNav('learn')}`;
  }

  function renderLearn() {
    if (!state.activeSession) {
      return renderLearningHub();
    }
    const session = resolveSession(state.activeSession);
    if (!session.ids.length) {
      return `<section class="screen"><div class="empty-state"><div class="empty-illustration">${icon(session.kind === 'favorites' ? 'heart' : 'review')}</div><h2>لا توجد كلمات في هذه الجلسة</h2><p>أضف كلمات ثم عُد لبدء الجلسة.</p><button class="secondary-btn" type="button" data-action="close-session">العودة</button></div></section>${renderBottomNav('learn')}`;
    }
    const position = sessionPosition(session);
    if (position >= session.ids.length) return renderComplete(session);
    const word = WORD_BY_ID.get(Number(session.ids[position]));
    if (!word) {
      setSessionPosition(session, position + 1);
      saveState();
      return renderLearn();
    }
    const percent = Math.round((position / session.ids.length) * 100);
    const favorite = state.favorites.includes(Number(word.id));
    const wordState = state.progress[word.id];
    const example = word.examples[0];
    return `<section class="screen learn-screen">
      <header class="learn-top">
        <button class="back-btn" type="button" data-action="close-session" aria-label="إغلاق الجلسة">${icon('close')}</button>
        <div class="learn-top-info"><div class="learn-title">${esc(session.title)}</div><div class="learn-count">${position + 1} / ${session.ids.length}</div><div class="learn-track" role="progressbar" aria-label="تقدم الجلسة" aria-valuemin="0" aria-valuemax="${session.ids.length}" aria-valuenow="${position}"><i style="width:${percent}%"></i></div></div>
        <button class="icon-btn learn-quiz-btn" type="button" data-action="open-tests" aria-label="مركز الاختبارات">${icon('quiz')}</button>
      </header>
      <article class="word-focus-card">
        <div class="word-meta"><span class="pill">${esc(word.level)}</span><span class="pill">${esc(posArabic(word.pos))}</span><span class="mastery-pill ${masteryStatus(word.id).className}">${masteryStatus(word.id).label}</span></div>
        <h1 class="focus-word" lang="en" dir="ltr" tabindex="-1">${esc(word.word)}</h1><div class="focus-ar" lang="ar">${esc(word.arabic)}</div>
        <div class="focus-tools"><button class="sound-btn" type="button" data-action="speak" data-id="${word.id}" aria-label="نطق الكلمة">${icon('volume', 'icon-lg')}</button><button class="focus-fav ${favorite ? 'active' : ''}" type="button" data-action="favorite" data-id="${word.id}" aria-label="${favorite ? 'إزالة من المراجعة' : 'إضافة إلى المراجعة'}">${icon('heart', 'icon-lg')}</button></div>
        ${example ? `<div class="examples-box"><div class="example-item"><div class="example-en" lang="en"><span class="example-label">1</span><span class="example-text">${esc(example.en)}</span><button class="example-sound-btn" type="button" data-action="speak-example" data-id="${word.id}" data-example="0" aria-label="نطق الجملة">${icon('volume', 'icon-sm')}</button></div><div class="example-ar" lang="ar">${esc(example.ar)}</div></div></div>` : ''}
      </article>
      <div class="learn-actions"><button class="learn-action skip" type="button" data-action="word-action" data-kind="skip">${icon('skip')} تخطي</button><button class="learn-action review" type="button" data-action="word-action" data-kind="review">${icon('review')} راجعها</button><button class="learn-action learned" type="button" data-action="word-action" data-kind="learned">${icon('check')} تعلّمتها</button></div>
      <p class="word-state-note">${wordState === 'learned' ? 'سبق أن صنّفتها: تعلّمتها' : wordState === 'review' ? 'هذه الكلمة موجودة في المراجعة' : 'يُحفظ اختيارك تلقائيًا'}</p>
    </section>${renderBottomNav('learn')}`;
  }

  function renderComplete(session) {
    const learned = session.ids.filter(id => state.progress[id] === 'learned').length;
    const review = session.ids.filter(id => state.progress[id] === 'review').length;
    const favorites = session.ids.filter(id => state.favorites.includes(Number(id))).length;
    const hasNextRound = session.kind === 'round' && session.round + 1 < Math.ceil(LEVEL_WORDS[session.level].length / 50);
    return `<section class="screen learn-screen"><div class="complete-card"><div class="complete-icon">${icon('trophy')}</div><h1>أحسنت، أكملت الجلسة!</h1><p>${esc(session.title)} انتهت، وتم حفظ كل اختياراتك.</p><div class="complete-stats"><div class="complete-stat"><strong>${learned}</strong><span>تعلّمتها</span></div><div class="complete-stat"><strong>${review}</strong><span>للمراجعة</span></div><div class="complete-stat"><strong>${favorites}</strong><span>محفوظة</span></div></div><div class="complete-actions">${hasNextRound ? `<button class="primary-btn" type="button" data-action="next-round">ابدأ الخمسين التالية ${icon('arrow', 'icon-sm')}</button>` : ''}<button class="secondary-btn" type="button" data-action="reset-session">إعادة هذه الجلسة</button><button class="secondary-btn" type="button" data-action="close-session">العودة</button></div></div></section>${renderBottomNav('learn')}`;
  }

  function closeSession() {
    clearAutoSpeechTimers(true);
    stopSpeech();
    const returnScreen = resolveSession(state.activeSession).returnScreen || 'home';
    if (navigationDepth > 0) {
      history.back();
      return;
    }
    state.screen = returnScreen;
    saveState();
    history.replaceState({ screen: returnScreen }, '', `#${returnScreen}`);
    render();
    scrollAppTop();
  }

  function showToast(message, actionLabel = '', actionName = '', duration = 1900) {
    if (!TOAST) return;
    TOAST.replaceChildren();
    const text = document.createElement('span');
    text.textContent = String(message || '');
    TOAST.appendChild(text);
    if (actionLabel && actionName) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = actionName;
      button.textContent = String(actionLabel);
      TOAST.appendChild(button);
      TOAST.classList.add('actionable');
    } else {
      TOAST.classList.remove('actionable');
    }
    TOAST.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      TOAST.classList.remove('show', 'actionable');
      if (actionName === 'undo-word') undoSnapshot = null;
    }, duration);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'theme') toggleTheme();
    else if (action === 'nav') navigate(target.dataset.screen);
    else if (action === 'edit-profile') {
      navigate('settings');
      window.setTimeout(() => {
        const input = document.getElementById('profileNameInput');
        if (!input) return;
        input.scrollIntoView({ behavior: state.settings.animations ? 'smooth' : 'auto', block: 'center' });
        input.focus({ preventScroll: true });
        input.select();
      }, state.settings.animations ? 260 : 0);
    }
    else if (action === 'skip-name-setup') {
      state.nameSetupSkipped = true;
      saveState();
      playUiSound('back');
      render();
    }
    else if (action === 'resume-learning') {
      if (state.activeSession && resolveSession(state.activeSession).ids.length) navigate('learn');
      else startSession('daily', { returnScreen: 'home' });
    }
    else if (action === 'open-tests' || action === 'open-challenge') {
      state.testView = state.testSession && state.testSession.status === 'active' ? 'session' : 'center';
      saveState();
      navigate('tests');
    } else if (action === 'open-level-test' || action === 'open-test-setup') {
      const level = LEVELS.includes(target.dataset.level) ? target.dataset.level : state.testConfig.level;
      state.testConfig.level = level;
      state.testView = 'setup';
      saveState();
      navigate('tests');
    } else if (action === 'test-center') {
      state.screen = 'tests';
      state.testView = 'center';
      saveState();
      render();
      scrollAppTop();
    } else if (action === 'set-test-level') {
      if (LEVELS.includes(target.dataset.level)) state.testConfig.level = target.dataset.level;
      saveState();
      render();
    } else if (action === 'set-test-size') {
      const size = target.dataset.size === 'all' ? 'all' : Number(target.dataset.size);
      if (TEST_SIZES.includes(size)) state.testConfig.size = size;
      saveState();
      render();
    } else if (action === 'set-test-mode') {
      if (TEST_MODES.includes(target.dataset.mode)) state.testConfig.mode = target.dataset.mode;
      saveState();
      render();
    } else if (action === 'start-test') startConfiguredTest();
    else if (action === 'resume-test') {
      if (state.testSession && state.testSession.status === 'active') {
        state.screen = 'tests';
        state.testView = 'session';
        saveState();
        render();
      }
    } else if (action === 'discard-test') discardTest();
    else if (action === 'exit-test') {
      stopSpeech();
      state.testView = 'center';
      saveState();
      render();
      showToast('حُفظ تقدم الاختبار');
    } else if (action === 'answer-test') answerTest(target.dataset.answerId);
    else if (action === 'next-test-question') nextTestQuestion();
    else if (action === 'test-speak' || action === 'test-speak-slow') {
      const word = WORD_BY_ID.get(Number(target.dataset.id));
      if (word) {
        clearTimeout(testAudioTimer);
        animateSpeechButton(target);
        speak(word.word, action === 'test-speak-slow' ? 0.62 : state.settings.speechRate);
      }
    } else if (action === 'retry-wrong') retryWrongAnswers();
    else if (action === 'new-test') {
      state.testSession = null;
      state.testView = 'setup';
      saveState();
      render();
    } else if (action === 'open-mistakes') {
      state.testView = 'mistakes';
      saveState();
      render();
      scrollAppTop();
    } else if (action === 'filter-mistakes') {
      const level = target.dataset.level;
      if (level === 'ALL' || LEVELS.includes(level)) state.mistakeFilter = level;
      saveState();
      render();
    } else if (action === 'start-mistakes-test') startMistakesTest();
    else if (action === 'start-daily') startSession('daily', { returnScreen: state.screen });
    else if (action === 'start-review') startSession('review', { returnScreen: state.screen });
    else if (action === 'start-favorites') startSession('favorites', { returnScreen: 'favorites', level: target.dataset.level });
    else if (action === 'filter-favorites') {
      const level = target.dataset.level;
      if (level === 'ALL' || LEVELS.includes(level)) state.favoriteFilter = level;
      saveState();
      render();
    }
    else if (action === 'open-level') {
      state.activeLevel = target.dataset.level;
      saveState();
      navigate('levels');
    } else if (action === 'select-level') {
      state.activeLevel = target.dataset.level;
      saveState();
      render();
    } else if (action === 'start-round') {
      startSession('round', { level: target.dataset.level, round: Number(target.dataset.round), returnScreen: 'levels' });
    } else if (action === 'favorite') toggleFavorite(target.dataset.id);
    else if (action === 'open-word') startSession('single', { wordId: target.dataset.id, returnScreen: state.screen });
    else if (action === 'speak') {
      const word = WORD_BY_ID.get(Number(target.dataset.id));
      if (word) {
        clearAutoSpeechTimers(false);
        animateSpeechButton(target);
        speak(word.word);
      }
    } else if (action === 'speak-example') {
      const word = WORD_BY_ID.get(Number(target.dataset.id));
      const example = word && word.examples[clampInt(target.dataset.example, 0, word.examples.length - 1)];
      if (example && example.en) {
        clearAutoSpeechTimers(false);
        animateSpeechButton(target);
        speak(example.en);
      }
    } else if (action === 'set-writing-source') {
      const source = target.dataset.source;
      if (source === 'daily' || LEVELS.includes(source)) state.writingSource = source;
      saveState();
      render();
    } else if (action === 'start-writing') startWritingSession();
    else if (action === 'toggle-writing-hint') {
      if (state.writingSession && !state.writingSession.feedback) {
        state.writingSession.hintVisible = !state.writingSession.hintVisible;
        saveState();
        haptic('selection');
        render();
      }
    } else if (action === 'skip-writing') nextWritingWord(true);
    else if (action === 'next-writing') nextWritingWord(false);
    else if (action === 'restart-writing') startWritingSession();
    else if (action === 'close-writing') {
      stopSpeech();
      state.writingSession = null;
      lastWritingAudioToken = '';
      saveState();
      playUiSound('back');
      render();
    } else if (action === 'writing-speak') {
      const word = WORD_BY_ID.get(Number(target.dataset.id));
      if (word) {
        animateSpeechButton(target);
        speak(word.word);
      }
    } else if (action === 'cards-center') {
      stopSpeech();
      state.cardsView = 'center';
      state.editingCardId = '';
      saveState();
      playUiSound('back');
      render();
    } else if (action === 'new-deck') {
      state.cardsView = 'deck-form';
      saveState();
      render();
    } else if (action === 'new-manual-card') {
      state.editingCardId = '';
      state.cardsView = 'card-form';
      saveState();
      render();
    } else if (action === 'close-card-form') {
      state.editingCardId = '';
      state.cardsView = selectedDeck() ? 'deck' : 'center';
      saveState();
      playUiSound('back');
      render();
    } else if (action === 'open-deck') {
      if (state.cardDecks.some(deck => deck.id === target.dataset.deckId)) {
        state.selectedDeckId = target.dataset.deckId;
        state.cardsView = 'deck';
        saveState();
        render();
      }
    } else if (action === 'set-card-mode') {
      if (TEST_MODES.includes(target.dataset.mode)) state.cardTestMode = target.dataset.mode;
      saveState();
      render();
    } else if (action === 'start-card-practice') startCardPractice();
    else if (action === 'answer-card') answerCardPractice(target.dataset.cardAnswer);
    else if (action === 'next-card-question') nextCardQuestion();
    else if (action === 'exit-card-practice' || action === 'back-to-deck') {
      stopSpeech();
      state.cardsView = selectedDeck() ? 'deck' : 'center';
      saveState();
      playUiSound('back');
      render();
    } else if (action === 'restart-card-practice') startCardPractice();
    else if (action === 'card-speak') {
      const found = manualCardById(target.dataset.cardId);
      if (found) {
        animateSpeechButton(target);
        speak(found.card.english);
      }
    } else if (action === 'edit-manual-card') {
      if (manualCardById(target.dataset.cardId)) {
        state.editingCardId = target.dataset.cardId;
        state.cardsView = 'card-form';
        saveState();
        render();
      }
    } else if (action === 'delete-manual-card') deleteManualCard(target.dataset.cardId);
    else if (action === 'delete-deck') deleteManualDeck(target.dataset.deckId);
    else if (action === 'word-action') advanceWord(target.dataset.kind);
    else if (action === 'undo-word') undoLastWordAction();
    else if (action === 'close-session') closeSession();
    else if (action === 'toggle-setting') {
      const key = target.dataset.setting;
      if (['autoSpeakWord', 'autoSpeakSentence', 'haptics', 'animations', 'navigationSounds'].includes(key)) {
        state.settings[key] = !state.settings[key];
        if ((key === 'autoSpeakWord' || key === 'autoSpeakSentence') && !state.settings[key]) stopSpeech();
        if (key === 'autoSpeakWord' && state.settings[key]) lastAutoSpokenToken = '';
        applyTheme();
        render();
        if (key === 'haptics' && state.settings.haptics) haptic('success');
        if (key === 'navigationSounds' && state.settings.navigationSounds) playUiSound('navigate');
      }
    } else if (action === 'set-speech-rate') {
      const rate = Number(target.dataset.rate);
      if ([0.72, 0.86, 1].includes(rate)) state.settings.speechRate = rate;
      saveState();
      render();
    } else if (action === 'preview-speech') {
      animateSpeechButton(target);
      speak('Learning English is a wonderful journey.');
    } else if (action === 'preview-haptic') {
      if (state.settings.haptics) haptic('success');
      else showToast('فعّل الاهتزاز أولًا');
    } else if (action === 'set-theme') {
      if (['light', 'dark'].includes(target.dataset.theme)) state.theme = target.dataset.theme;
      applyTheme();
      render();
    } else if (action === 'close-settings') {
      if (navigationDepth > 0) history.back();
      else navigate('home', false);
    }
    else if (action === 'reset-session') {
      const session = resolveSession(state.activeSession);
      setSessionPosition(session, 0);
      saveState();
      render();
    } else if (action === 'next-round') {
      const session = resolveSession(state.activeSession);
      if (session.kind === 'round') startSession('round', { level: session.level, round: session.round + 1, returnScreen: 'levels', reset: false });
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id === 'nameSetupForm' || form.id === 'profileNameForm') {
      event.preventDefault();
      const input = form.elements.userName;
      const name = cleanManualText(input && input.value, 24);
      if (form.id === 'nameSetupForm' && !name) {
        showToast('اكتب اسمك أولًا');
        if (input) input.focus();
        return;
      }
      state.userName = name;
      state.nameSetupSkipped = true;
      saveState();
      haptic('success');
      playUiSound('success');
      render();
      showToast(name ? 'تم حفظ اسمك' : 'سيظهر ترحيب عام');
    } else if (form.id === 'testSpellingForm') {
      event.preventDefault();
      const input = document.getElementById('spellingInput');
      answerTest(input ? input.value : '');
    } else if (form.id === 'guidedWritingForm') {
      event.preventDefault();
      const input = document.getElementById('guidedWritingInput');
      verifyWriting(input ? input.value : '');
    } else if (form.id === 'cardWritingForm') {
      event.preventDefault();
      const input = document.getElementById('cardWritingInput');
      answerCardPractice(input ? input.value : '');
    } else if (form.id === 'deckForm') {
      event.preventDefault();
      const deck = createManualDeck(form.elements.deckName && form.elements.deckName.value);
      if (!deck) {
        showToast('اكتب اسمًا للمجموعة');
        return;
      }
      state.selectedDeckId = deck.id;
      state.cardsView = 'deck';
      saveState();
      playUiSound('success');
      render();
      showToast('تم إنشاء المجموعة');
    } else if (form.id === 'manualCardForm') {
      event.preventDefault();
      saveManualCard(form);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopSpeech();
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'homeSearch') {
      state.search = event.target.value;
      saveState();
      const container = document.getElementById('searchResults');
      if (container) container.innerHTML = state.search ? renderSearchResults(state.search) : '';
    }
    if (event.target.id === 'favoriteSearch') {
      state.favoriteSearch = event.target.value;
      saveState();
      const container = document.getElementById('favoriteList');
      if (container) {
        const source = favoriteWordsForFilter(state.favoriteFilter);
        const matches = normalizeSearch(state.favoriteSearch) ? searchMatches(state.favoriteSearch, source) : source;
        container.innerHTML = matches.length ? matches.map(renderWordRow).join('') : '<div class="search-empty">لا توجد نتيجة داخل المراجعة</div>';
      }
    }
  });
})();
