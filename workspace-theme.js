// ==UserScript==
// @name         Workspace Theme (enxuto)
// @description  Troca o tema do Vivaldi conforme o workspace, com transição suave
//               e um painel de configuração na página Configurações → Temas.
//               Sem rede, sem IA, sem dependências. Feito para o Vivaldi 8.3.
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG_FILE = 'workspace-theme.json';
  const CHANNEL = 'workspace-theme';
  const PANEL_ID = 'workspace-theme-panel';
  const NONE = ''; // "não mudar"
  const DURATION = { min: 100, max: 3000, step: 50, def: 800 };
  const EASINGS = {
    linear: { label: 'easeLinear', css: 'linear' },
    suave: { label: 'easeSmooth', css: 'ease-in-out' },
  };

  // ---------- idioma ----------
  // Segue o idioma da interface do Vivaldi (Configurações → Geral → Idioma).
  // Português para pt-*, inglês para qualquer outro.
  const STRINGS = {
    en: {
      title: 'Workspace theme',
      unnamed: 'Unnamed',
      noWorkspaces: 'No workspaces yet.',
      useDefault: '(use default)',
      noChange: "(don't change)",
      defaultRow: 'Default (tabs without a workspace or theme)',
      smooth: 'Smooth transition',
      duration: 'Duration',
      curve: 'Curve',
      easeLinear: 'Linear',
      easeSmooth: 'Smooth',
      hint: 'Tip: set <b>Theme Schedule</b> below to <b>No Schedule</b>, otherwise it overrides this mod.',
    },
    pt: {
      title: 'Tema por workspace',
      unnamed: 'Sem nome',
      noWorkspaces: 'Nenhum workspace criado ainda.',
      useDefault: '(usar o padrão)',
      noChange: '(não mudar)',
      defaultRow: 'Padrão (abas sem workspace ou sem tema definido)',
      smooth: 'Transição suave',
      duration: 'Duração',
      curve: 'Curva',
      easeLinear: 'Linear',
      easeSmooth: 'Suave',
      hint: 'Dica: em <b>Agendamento de Temas</b>, mais abaixo, deixe <b>Sem Agendamento</b>, senão ele troca o tema por cima deste mod.',
    },
  };
  // Idioma escolhido nas configurações (intl.app_locale). Vale na hora, mesmo antes
  // de reiniciar o Vivaldi. Sem ele, usa o idioma com que a interface iniciou.
  let chosenLanguage = '';
  const uiLanguage = () =>
    chosenLanguage ||
    document.getElementById('browser')?.lang ||
    chrome.i18n?.getUILanguage?.() ||
    navigator.language || 'en';
  const refreshLanguage = async () => {
    const v = await getPref('intl.app_locale');
    chosenLanguage = typeof v === 'string' ? v : '';
  };
  const t = (key) => {
    const lang = String(uiLanguage()).toLowerCase().startsWith('pt') ? 'pt' : 'en';
    return STRINGS[lang][key] ?? STRINGS.en[key];
  };

  // ---------- configuração ----------
  // O Vivaldi não persiste o localStorage da interface, então a config fica num
  // arquivo no armazenamento interno do navegador (OPFS), que persiste.
  // { map: { [workspaceId]: themeId }, fallback: themeId|'', smooth: bool,
  //   duration: ms, easing: 'linear'|'suave' }
  const clampDuration = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(DURATION.max, Math.max(DURATION.min, n)) : DURATION.def;
  };
  const normalize = (c) => ({
    map: (c && typeof c.map === 'object' && c.map) || {},
    fallback: (c && c.fallback) || NONE,
    smooth: !c || c.smooth !== false,
    duration: c && c.duration != null ? clampDuration(c.duration) : DURATION.def,
    easing: c && EASINGS[c.easing] ? c.easing : 'linear',
  });
  let config = normalize(null);

  const fileHandle = async (create) =>
    (await navigator.storage.getDirectory()).getFileHandle(CONFIG_FILE, { create });

  async function loadConfig() {
    try {
      const file = await (await fileHandle(false)).getFile();
      return normalize(JSON.parse(await file.text()));
    } catch {
      return normalize(null); // ainda não existe
    }
  }

  let writeChain = Promise.resolve();
  function writeConfig() {
    const data = JSON.stringify(config);
    writeChain = writeChain.then(async () => {
      const w = await (await fileHandle(true)).createWritable();
      await w.write(data);
      await w.close();
    }).catch((e) => console.warn('[workspace-theme] falha ao salvar', e));
    return writeChain;
  }

  // Avisa as outras janelas (ex.: a janela de configurações) quando a config muda.
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e) => {
    config = normalize(e.data);
    lastApplied = null;
    applyForActiveTab();
  };

  const saveConfig = async () => {
    await writeConfig();
    channel.postMessage(config);
    lastApplied = null;
    applyForActiveTab();
  };

  // ---------- acesso às preferências do Vivaldi ----------
  const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const getPref = async (path) => {
    try { return unwrap(await vivaldi.prefs.get(path)); } catch { return undefined; }
  };
  const setPref = (path, value) => vivaldi.prefs.set({ path, value });

  const getWorkspaces = async () => {
    const l = await getPref('vivaldi.workspaces.list');
    return Array.isArray(l) ? l : [];
  };
  const getThemes = async () => {
    const [sys, user] = await Promise.all([
      getPref('vivaldi.themes.system'),
      getPref('vivaldi.themes.user'),
    ]);
    return [...(Array.isArray(sys) ? sys : []), ...(Array.isArray(user) ? user : [])]
      .filter((t) => t && t.id)
      .map((t) => ({ id: t.id, name: t.name || t.id }));
  };

  // ---------- descobrir o workspace da aba ativa ----------
  const parseExt = (v) => {
    if (!v) return {};
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return {}; }
  };
  async function workspaceIdOf(tab) {
    if (!tab) return undefined;
    let ext = parseExt(tab.vivExtData);
    if (ext.workspaceId == null && vivaldi.tabsPrivate?.get) {
      try { ext = parseExt((await vivaldi.tabsPrivate.get(tab.id))?.vivExtData); } catch { /* ignore */ }
    }
    return ext.workspaceId == null ? undefined : String(ext.workspaceId);
  }

  // ---------- transição suave ----------
  // Anima só as cores da interface (não cobre a página aberta).
  // Fade com View Transition: o navegador fotografa a interface antiga e faz UM fade
  // dela para a nova na GPU (fluido, inclusive com foto de fundo). As páginas abertas
  // ficam fora do fade. Sem suporte, cai num fade só de cores.
  const timeout = (ms) => new Promise((r) => setTimeout(r, ms));

  async function themeImageOf(themeId) {
    const themes = [
      ...((await getPref('vivaldi.themes.system')) || []),
      ...((await getPref('vivaldi.themes.user')) || []),
    ];
    return themes.find((t) => t && t.id === themeId)?.backgroundImage || '';
  }

  async function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
    await Promise.race([img.decode().catch(() => {}), timeout(1000)]);
  }

  // O Vivaldi aplica o tema em etapas: cores primeiro, depois a foto (e a versão
  // desfocada dela). Só libera o fade quando a foto nova já está no #browser.
  function waitForThemeApplied(imageUrl) {
    const target = document.getElementById('browser') || document.documentElement;
    const key = imageUrl ? imageUrl.split('/').pop() : '';
    const imageReady = () =>
      !key || target.style.getPropertyValue('--browserBackgroundImage').includes(key);
    return new Promise((resolve) => {
      let settle;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        obs.disconnect();
        resolve();
      };
      const check = () => {
        clearTimeout(settle);
        // Depois da foto, espera um instante pela versão desfocada.
        if (imageReady()) settle = setTimeout(done, 80);
      };
      const obs = new MutationObserver(check);
      obs.observe(target, { attributes: true, attributeFilter: ['style', 'class'] });
      setTimeout(done, 1500); // segurança
    });
  }

  function viewTransitionStyle(ms, ease) {
    const st = document.createElement('style');
    st.textContent = `
      ::view-transition { pointer-events: none; }
      ::view-transition-old(root), ::view-transition-new(root) {
        animation-duration: ${ms}ms; animation-timing-function: ${ease};
      }
      ::view-transition-group(*.wt-page),
      ::view-transition-new(*.wt-page) { animation: none; }
      ::view-transition-old(*.wt-page) { display: none; }`;
    document.head.appendChild(st);
    return st;
  }

  function colorOnlyFallback(ms, ease) {
    const st = document.createElement('style');
    st.textContent = `#browser, #browser *:not(webview):not(iframe) {
      transition: background-color ${ms}ms ${ease}, color ${ms}ms ${ease},
                  border-color ${ms}ms ${ease}, fill ${ms}ms ${ease} !important; }`;
    document.head.appendChild(st);
    setTimeout(() => st.remove(), ms + 400);
  }

  async function switchTheme(themeId) {
    if (!config.smooth) return setPref('vivaldi.themes.current', themeId);
    const ms = config.duration;
    const ease = EASINGS[config.easing].css;
    if (document.hidden) return setPref('vivaldi.themes.current', themeId); // janela oculta: sem fade
    if (!document.startViewTransition) {
      colorOnlyFallback(ms, ease);
      return setPref('vivaldi.themes.current', themeId);
    }
    const imageUrl = await themeImageOf(themeId);
    await preloadImage(imageUrl);
    // Sites abertos saem do fade (ficam "ao vivo"). Páginas internas, como a
    // página inicial, entram: é nelas que a foto de fundo mais aparece.
    const pages = [...document.querySelectorAll('.webpageview.visible:not(.internal)')];
    pages.forEach((el, i) => {
      el.style.viewTransitionName = `wt-page-${i}`;
      el.style.viewTransitionClass = 'wt-page';
    });
    const st = viewTransitionStyle(ms, ease);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      st.remove();
      pages.forEach((el) => { el.style.viewTransitionName = ''; el.style.viewTransitionClass = ''; });
    };
    try {
      const vt = document.startViewTransition(async () => {
        const applied = waitForThemeApplied(imageUrl);
        await setPref('vivaldi.themes.current', themeId);
        await applied;
      });
      vt.finished.finally(cleanup);
      setTimeout(() => { if (!cleaned) { vt.skipTransition(); cleanup(); } }, ms + 2500); // trava de segurança
      await Promise.race([vt.updateCallbackDone, timeout(2000)]);
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  // ---------- aplicar tema ----------
  let lastApplied = null;
  let busy = false;
  let pending = false;

  async function applyForActiveTab() {
    if (busy) { pending = true; return; }
    busy = true;
    try {
      // Só janelas normais: focar a janela de configurações não troca o tema.
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
      if (!tab) return;
      const wsId = await workspaceIdOf(tab);
      const themeId = (wsId !== undefined && config.map[wsId]) || config.fallback;
      if (!themeId || themeId === lastApplied) return;
      const current = await getPref('vivaldi.themes.current');
      lastApplied = themeId;
      if (current === themeId) return;
      await switchTheme(themeId);
    } catch (e) {
      console.warn('[workspace-theme]', e);
    } finally {
      busy = false;
      if (pending) { pending = false; applyForActiveTab(); }
    }
  }

  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(applyForActiveTab, 120); };

  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab?.active && ('vivExtData' in info)) schedule();
  });
  chrome.windows.onFocusChanged.addListener((w) => {
    if (w !== chrome.windows.WINDOW_ID_NONE) schedule();
  });

  // ---------- painel em Configurações → Temas ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const options = (themes, selected, noneLabel) =>
    `<option value="">${esc(noneLabel)}</option>` +
    themes.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? ' selected' : ''}>${esc(t.name)}</option>`).join('');

  async function renderPanel(panel) {
    const [workspaces, themes] = await Promise.all([getWorkspaces(), getThemes(), refreshLanguage()]);
    const rows = workspaces.map((w) => `
      <div class="wt-row">
        <span class="wt-name">${esc(w.name || t('unnamed'))}</span>
        <select data-ws="${esc(w.id)}">${options(themes, config.map[String(w.id)], t('useDefault'))}</select>
      </div>`).join('');

    panel.innerHTML = `
      <h2>${t('title')}</h2>
      ${workspaces.length ? rows : `<p class="wt-empty">${t('noWorkspaces')}</p>`}
      <div class="wt-row">
        <span class="wt-name wt-muted">${t('defaultRow')}</span>
        <select data-fallback>${options(themes, config.fallback, t('noChange'))}</select>
      </div>
      <label class="wt-check">
        <input type="checkbox" data-smooth ${config.smooth ? 'checked' : ''}> ${t('smooth')}
      </label>
      <div class="wt-row wt-sub" data-transition-opts ${config.smooth ? '' : 'hidden'}>
        <span class="wt-name">${t('duration')}</span>
        <input type="range" data-duration min="${DURATION.min}" max="${DURATION.max}" step="${DURATION.step}" value="${config.duration}">
        <span class="wt-value" data-duration-label>${(config.duration / 1000).toFixed(2)} s</span>
      </div>
      <div class="wt-row wt-sub" data-transition-opts ${config.smooth ? '' : 'hidden'}>
        <span class="wt-name">${t('curve')}</span>
        <select data-easing>${Object.entries(EASINGS).map(([k, v]) =>
          `<option value="${k}"${k === config.easing ? ' selected' : ''}>${t(v.label)}</option>`).join('')}</select>
      </div>
      <p class="wt-muted wt-hint">${t('hint')}</p>`;

    panel.querySelectorAll('select[data-ws]').forEach((s) => s.addEventListener('change', () => {
      if (s.value) config.map[s.dataset.ws] = s.value; else delete config.map[s.dataset.ws];
      saveConfig();
    }));
    panel.querySelector('select[data-fallback]').addEventListener('change', (e) => {
      config.fallback = e.target.value;
      saveConfig();
    });
    panel.querySelector('input[data-smooth]').addEventListener('change', (e) => {
      config.smooth = e.target.checked;
      panel.querySelectorAll('[data-transition-opts]').forEach((el) => { el.hidden = !config.smooth; });
      saveConfig();
    });
    const range = panel.querySelector('input[data-duration]');
    const label = panel.querySelector('[data-duration-label]');
    range.addEventListener('input', () => { label.textContent = `${(range.value / 1000).toFixed(2)} s`; });
    range.addEventListener('change', () => {
      config.duration = clampDuration(range.value);
      saveConfig();
    });
    panel.querySelector('select[data-easing]').addEventListener('change', (e) => {
      config.easing = e.target.value;
      saveConfig();
    });
  }

  function injectStyles() {
    if (document.getElementById(PANEL_ID + '-style')) return;
    const st = document.createElement('style');
    st.id = PANEL_ID + '-style';
    st.textContent = `
      #${PANEL_ID} { margin-bottom: 24px; }
      #${PANEL_ID} .wt-row { display: flex; align-items: center; gap: 12px; margin: 6px 0; max-width: 520px; }
      #${PANEL_ID} .wt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${PANEL_ID} select { flex: 0 0 220px; }
      #${PANEL_ID} .wt-muted { opacity: .7; }
      #${PANEL_ID} .wt-check { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
      #${PANEL_ID} .wt-hint { font-size: 12px; margin-top: 8px; }
      #${PANEL_ID} .wt-sub { padding-left: 24px; }
      #${PANEL_ID} .wt-sub[hidden] { display: none; }
      #${PANEL_ID} input[type=range] { flex: 0 0 160px; }
      #${PANEL_ID} .wt-value { flex: 0 0 52px; text-align: right; font-variant-numeric: tabular-nums; }`;
    document.head.appendChild(st);
  }

  // Detecta a página de Temas pelo DOM (funciona com configurações em aba ou em janela).
  let ready = false; // não monta o painel antes de ler a config salva
  function tryInjectPanel() {
    if (!ready) return;
    const previews = document.querySelector('.ThemePreviews');
    const section = previews && (previews.closest('.setting-section') || previews.parentElement);
    const existing = document.getElementById(PANEL_ID);
    // O Vivaldi troca as páginas de configuração sem recriar o documento: se a
    // página de Temas saiu da tela, o painel (que não é dele) sai junto.
    if (existing && (!section || existing.nextElementSibling !== section)) existing.remove();
    if (!section?.parentElement || document.getElementById(PANEL_ID)) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'setting-section';
    section.parentElement.insertBefore(panel, section);
    renderPanel(panel);
  }

  let injectTimer;
  new MutationObserver(() => {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(tryInjectPanel, 150);
  }).observe(document.body, { childList: true, subtree: true });

  // Atualiza o painel aberto se workspaces, temas ou idioma mudarem.
  vivaldi.prefs.onChanged?.addListener(async (ch) => {
    const p = ch?.path || '';
    if (p === 'intl.app_locale') await refreshLanguage();
    if (p === 'vivaldi.workspaces.list' || p === 'vivaldi.themes.user' || p === 'intl.app_locale') {
      const panel = document.getElementById(PANEL_ID);
      if (panel) renderPanel(panel);
    }
  });

  // Só começa depois de ler a config salva e o idioma.
  Promise.all([loadConfig(), refreshLanguage()]).then(([c]) => {
    config = c;
    ready = true;
    tryInjectPanel();
    applyForActiveTab();
  });
})();
