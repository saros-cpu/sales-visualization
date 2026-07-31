(() => {
  const WALLPAPER_API = Object.freeze({
    map: '/api/wallpaper/map',
    settings: '/api/wallpaper/settings',
    settingsPreview: '/api/wallpaper/settings/preview',
    settingsPreviewCommit: '/api/wallpaper/settings/preview/commit',
    editMode: '/api/wallpaper/edit-mode',
    refresh: '/api/wallpaper/refresh',
  });

  const i18n = {
    zh: {
      title: '壁纸设置',
      subtitle: '调整显示、刷新和 HUD 布局。',
      loading: '正在读取配置...',
      currentStatus: '当前状态',
      statusVersion: '当前版本',
      statusApi: 'API 地址',
      statusAuth: '授权状态',
      statusData: '数据状态',
      statusRefresh: '刷新时间',
      statusUpdate: '自动更新',
      authConfigured: '已配置',
      authMissing: '未配置',
      updateOn: '开启',
      updateOff: '关闭',
      dataChecking: '检查中...',
      dataFull: '完整数据',
      dataPublic: '公开数据',
      dataUnavailable: '不可达',
      general: '基础',
      language: '语言',
      refreshAt: '每日刷新时间',
      refreshSeconds: '兜底刷新秒数',
      autoCheck: '自动检查更新',
      autoInstall: '自动安装更新',
      hud: 'HUD 显示',
      showSales: '销售汇总',
      showRates: '汇率',
      showInventoryAlerts: '库存预警',
      yearVolume: '年销量',
      yearTons: '年吨位',
      yearAmount: '年销售额',
      monthVolume: '月销量',
      monthTons: '月吨位',
      monthAmount: '月销售额',
      usd: '美元/索姆',
      cny: '人民币/索姆',
      map: '地图视野',
      showActiveStations: '显示在营站',
      showClosedStations: '显示停业/装修站',
      showDepotMarkers: '显示油库点位',
      showInventoryAlertOnly: '仅显示低库存点位',
      layout: 'HUD 布局',
      dragLayout: '拖拽调整',
      saveDragLayout: '保存拖拽布局',
      cancelDragLayout: '取消拖拽',
      topScale: '顶部缩放',
      topX: '顶部 X 偏移',
      topY: '顶部 Y 偏移',
      salesScale: '销售块缩放',
      salesX: '销售块 X 偏移',
      salesY: '销售块 Y 偏移',
      save: '保存并应用',
      refresh: '立即刷新',
      loaded: '配置已读取。打开此窗口期间，壁纸 HUD 可拖动预览。',
      editStarted: 'HUD 拖拽已开启。',
      dragSaved: '拖拽布局已保存并应用。',
      dragCancelled: '已取消拖拽调整。',
      dragNoChange: '没有检测到拖拽调整。',
      saved: '设置已保存，壁纸正在重启应用。',
      refreshed: '已请求壁纸刷新。',
      failed: '操作失败，请查看日志。',
    },
    ru: {
      title: 'Настройки обоев',
      subtitle: 'Настройка отображения, обновления данных и блоков HUD.',
      loading: 'Чтение конфигурации...',
      currentStatus: 'Текущее состояние',
      statusVersion: 'Версия',
      statusApi: 'API',
      statusAuth: 'Доступ',
      statusData: 'Данные',
      statusRefresh: 'Обновление',
      statusUpdate: 'Автообновление',
      authConfigured: 'Настроен',
      authMissing: 'Не настроен',
      updateOn: 'Включено',
      updateOff: 'Выключено',
      dataChecking: 'Проверка...',
      dataFull: 'Полные данные',
      dataPublic: 'Публичные данные',
      dataUnavailable: 'Недоступно',
      general: 'Основное',
      language: 'Язык',
      refreshAt: 'Ежедневное обновление',
      refreshSeconds: 'Резервный интервал, сек.',
      autoCheck: 'Автопроверка обновлений',
      autoInstall: 'Автоустановка обновлений',
      hud: 'Блоки HUD',
      showSales: 'Продажи',
      showRates: 'Курсы валют',
      showInventoryAlerts: 'Предупреждения запасов',
      yearVolume: 'Годовой объем',
      yearTons: 'Годовой вес',
      yearAmount: 'Годовая сумма',
      monthVolume: 'Месячный объем',
      monthTons: 'Месячный вес',
      monthAmount: 'Месячная сумма',
      usd: 'USD/KGS',
      cny: 'CNY/KGS',
      map: 'Камера карты',
      showActiveStations: 'Показывать рабочие АЗС',
      showClosedStations: 'Показывать закрытые/ремонт',
      showDepotMarkers: 'Показывать нефтебазы',
      showInventoryAlertOnly: 'Только низкие запасы',
      layout: 'Размещение HUD',
      dragLayout: 'Переместить HUD',
      saveDragLayout: 'Сохранить расположение',
      cancelDragLayout: 'Отменить перемещение',
      topScale: 'Масштаб сверху',
      topX: 'Смещение X сверху',
      topY: 'Смещение Y сверху',
      salesScale: 'Масштаб блока продаж',
      salesX: 'Смещение X продаж',
      salesY: 'Смещение Y продаж',
      save: 'Сохранить',
      refresh: 'Обновить сейчас',
      loaded: 'Конфигурация загружена. Пока окно открыто, HUD можно двигать для предпросмотра.',
      editStarted: 'Режим перемещения HUD включен.',
      dragSaved: 'Расположение сохранено и применено.',
      dragCancelled: 'Перемещение отменено.',
      dragNoChange: 'Перемещения HUD не обнаружено.',
      saved: 'Настройки сохранены, обои перезапускаются.',
      refreshed: 'ЗапрCTY-05ено обновление обоев.',
      failed: 'Операция не выполнена. Проверьте журналы.',
    },
  };

  const numericKeys = new Set([
    'refreshSeconds',
    'mapCenterX',
    'mapCenterY',
    'mapCenterZ',
    'hudTopScale',
    'hudTopOffsetX',
    'hudTopOffsetY',
    'hudSalesScale',
    'hudSalesOffsetX',
    'hudSalesOffsetY',
  ]);
  const previewKeys = [
    'hudTopScale',
    'hudTopOffsetX',
    'hudTopOffsetY',
    'hudSalesScale',
    'hudSalesOffsetX',
    'hudSalesOffsetY',
  ];
  const form = document.getElementById('settingsForm');
  const statusText = document.getElementById('statusText');
  const saveBtn = document.getElementById('saveBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const dragHudBtn = document.getElementById('dragHudBtn');
  const saveDragBtn = document.getElementById('saveDragBtn');
  const cancelDragBtn = document.getElementById('cancelDragBtn');
  const langToggle = document.getElementById('langToggle');
  const runtimeVersion = document.getElementById('runtimeVersion');
  const runtimeApi = document.getElementById('runtimeApi');
  const runtimeAuth = document.getElementById('runtimeAuth');
  const runtimeData = document.getElementById('runtimeData');
  const runtimeRefresh = document.getElementById('runtimeRefresh');
  const runtimeUpdate = document.getElementById('runtimeUpdate');
  let lang = localStorage.getItem('salesWallpaperSettingsLang') || 'zh';
  let previewTimer = 0;
  let previewPollTimer = 0;
  let editMode = false;

  function text(key) {
    return (i18n[lang] && i18n[lang][key]) || i18n.zh[key] || key;
  }

  function applyLanguage() {
    document.documentElement.lang = lang === 'ru' ? 'ru' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = text(node.dataset.i18n);
    });
    langToggle.textContent = lang === 'ru' ? '中文' : 'RU';
  }

  function setStatus(key, tone = '') {
    statusText.textContent = text(key);
    statusText.className = `settings-status ${tone}`.trim();
  }

  function setText(node, value) {
    if (node) node.textContent = value || '--';
  }

  function applyRuntimeStatus(settings) {
    const status = settings.runtimeStatus || {};
    setText(runtimeVersion, status.version);
    setText(runtimeApi, status.apiHost);
    setText(runtimeAuth, status.hasToken ? `${text('authConfigured')} ${status.keySource || ''}`.trim() : text('authMissing'));
    setText(runtimeRefresh, status.refreshAtLocalTime || `${status.refreshSeconds || '--'}s`);
    const updateState = status.autoUpdateEnabled ? text('updateOn') : text('updateOff');
    const installState = status.autoInstallUpdates ? text('updateOn') : text('updateOff');
    setText(runtimeUpdate, `${updateState} / ${installState}`);
  }

  async function loadRuntimeDataStatus() {
    setText(runtimeData, text('dataChecking'));
    try {
      const response = await fetch(`${WALLPAPER_API.map}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json();
      const payload = body && body.data ? body.data : body;
      const summary = payload.summary || {};
      const stationCount = summary.stationCount || (Array.isArray(payload.stations) ? payload.stations.length : 0);
      const label = payload.sensitiveData ? text('dataFull') : text('dataPublic');
      setText(runtimeData, `${label} · ${stationCount || '--'}`);
    } catch {
      setText(runtimeData, text('dataUnavailable'));
    }
  }

  function setBusy(busy) {
    [saveBtn, refreshBtn, dragHudBtn, saveDragBtn, cancelDragBtn].forEach((button) => {
      button.disabled = busy;
    });
    if (!busy) setEditState(editMode);
  }

  function field(name) {
    return form.elements.namedItem(name);
  }

  function setField(name, value) {
    const input = field(name);
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = value !== false;
      return;
    }
    input.value = value ?? '';
  }

  function collect() {
    const data = {};
    Array.from(form.elements).forEach((input) => {
      if (!input.name) return;
      if (input.type === 'checkbox') {
        data[input.name] = input.checked;
      } else if (numericKeys.has(input.name)) {
        const number = Number(input.value);
        if (Number.isFinite(number)) data[input.name] = number;
      } else {
        data[input.name] = input.value;
      }
    });
    return data;
  }

  function localApiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const nonce = String((window.SALES_RUNTIME_CONFIG && window.SALES_RUNTIME_CONFIG.localApiNonce) || '').trim();
    if (nonce) headers['X-Sales-Wallpaper-Nonce'] = nonce;
    return headers;
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: localApiHeaders(),
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json().catch(() => ({}));
  }

  function stopPreviewPolling() {
    clearInterval(previewPollTimer);
    previewPollTimer = 0;
  }

  function startPreviewPolling() {
    stopPreviewPolling();
    previewPollTimer = window.setInterval(() => {
      loadSettings({ quiet: true, previewOnly: true });
    }, 800);
  }

  function setEditState(enabled) {
    editMode = Boolean(enabled);
    dragHudBtn.classList.toggle('is-active', editMode);
    saveDragBtn.disabled = !editMode;
    cancelDragBtn.disabled = !editMode;
    if (editMode) {
      startPreviewPolling();
    } else {
      stopPreviewPolling();
    }
  }

  function applySettings(settings, previewOnly = false) {
    Object.keys(settings).forEach((key) => {
      if (key === 'editMode') return;
      if (previewOnly && !previewKeys.includes(key)) return;
      setField(key, settings[key]);
    });
    setEditState(Boolean(settings.editMode));
  }

  function schedulePreview() {
    if (!editMode) return;
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(async () => {
      const data = collect();
      const preview = {};
      previewKeys.forEach((key) => {
        if (typeof data[key] === 'number') preview[key] = data[key];
      });
      try {
        await postJson(WALLPAPER_API.settingsPreview, preview);
      } catch {
        setStatus('failed', 'error');
      }
    }, 250);
  }

  async function setServerEditMode(enabled, clearPreview = false) {
    const result = await postJson(WALLPAPER_API.editMode, { enabled, clearPreview });
    setEditState(Boolean(result.editMode));
    return result;
  }

  async function loadSettings(options = {}) {
    const { quiet = false, previewOnly = false } = options;
    try {
      const response = await fetch(WALLPAPER_API.settings, { cache: 'no-store' });
      if (!response.ok) throw new Error(await response.text());
      const settings = await response.json();
      applySettings(settings, previewOnly);
      if (!previewOnly) {
        applyRuntimeStatus(settings);
        loadRuntimeDataStatus();
      }
      if (!quiet) setStatus('loaded', 'ok');
    } catch {
      if (!quiet) setStatus('failed', 'error');
    }
  }

  dragHudBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      await setServerEditMode(true);
      await loadSettings({ quiet: true, previewOnly: true });
      setStatus('editStarted', 'ok');
    } catch {
      setStatus('failed', 'error');
    } finally {
      setBusy(false);
    }
  });

  saveDragBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      await loadSettings({ quiet: true, previewOnly: true });
      const result = await postJson(WALLPAPER_API.settingsPreviewCommit, {});
      await loadSettings({ quiet: true });
      setStatus(result.saved ? 'dragSaved' : 'dragNoChange', 'ok');
    } catch {
      setStatus('failed', 'error');
    } finally {
      setBusy(false);
    }
  });

  cancelDragBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      await setServerEditMode(false, true);
      await loadSettings({ quiet: true });
      setStatus('dragCancelled', 'ok');
    } catch {
      setStatus('failed', 'error');
    } finally {
      setBusy(false);
    }
  });

  saveBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      await postJson(WALLPAPER_API.settings, collect());
      setStatus('saved', 'ok');
    } catch {
      setStatus('failed', 'error');
    } finally {
      setBusy(false);
    }
  });

  refreshBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      await postJson(WALLPAPER_API.refresh, {});
      await loadRuntimeDataStatus();
      setStatus('refreshed', 'ok');
    } catch {
      setStatus('failed', 'error');
    } finally {
      setBusy(false);
    }
  });

  form.addEventListener('input', (event) => {
    if (event.target && event.target.dataset.preview) schedulePreview();
  });

  langToggle.addEventListener('click', () => {
    lang = lang === 'ru' ? 'zh' : 'ru';
    localStorage.setItem('salesWallpaperSettingsLang', lang);
    applyLanguage();
    loadSettings({ quiet: true });
  });

  applyLanguage();
  loadSettings();
})();
