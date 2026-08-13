/**
 * Shared client helpers for lobby + table pages.
 * Pages may call PP.registerToastTitles({...}) for page-specific titles.
 */
(function (global) {
  'use strict';

  const BASE_TOAST_TITLES = {
    TableFullException: 'Стол заполнен',
    ChipAmountException: 'Ошибка фишек',
    PlayerAlreadyJoinedException: 'Вы уже за столом',
  };

  let extraToastTitles = {};

  function registerToastTitles(map) {
    if (!map || typeof map !== 'object') return;
    Object.assign(extraToastTitles, map);
  }

  function showToast(type, errorType, message) {
    const errorTitles = Object.assign({}, BASE_TOAST_TITLES, extraToastTitles);
    const titleText = errorTitles[errorType] || errorType || 'Уведомление';

    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    let icon = '⚠️';
    let colorClass = 'toast-warning';

    if (type === 'error') {
      icon = '❌';
      colorClass = 'toast-error';
    } else if (type === 'success') {
      icon = '✅';
      colorClass = 'toast-success';
    }

    toast.className = `poker-toast ${colorClass}`;
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <span class="toast-title">${titleText}</span>
        <span>${message}</span>
      </div>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  function formatPokerAmount(value) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) {
      return value != null ? String(value) : '0';
    }

    if (n >= 1_000_000) {
      const scaled = n / 1_000_000;
      if (scaled === Math.floor(scaled)) {
        return `${Math.floor(scaled)}M`;
      }
      return `${parseFloat(scaled.toFixed(1))}M`;
    }

    if (n >= 1_000) {
      const scaled = n / 1_000;
      if (scaled === Math.floor(scaled)) {
        return `${Math.floor(scaled)}K`;
      }
      return `${parseFloat(scaled.toFixed(1))}K`;
    }

    return String(n);
  }

  const RECONNECT_DELAYS = [500, 1000, 2000, 5000];
  const FAST_RECONNECT_DELAY_MS = 500;
  const RESYNC_RETRY_DELAYS = [500, 1000, 2000];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isTokenPresent(token) {
    return Boolean(token && token !== 'None' && String(token).trim() !== '');
  }

  /**
   * @param {object} deps
   * @param {() => boolean} [deps.isDevMode]
   * @param {() => boolean|Promise<boolean>} [deps.onDevMode] - custom dev-mode return
   * @param {() => string} deps.getToken
   * @param {(token: string) => void} deps.setToken
   * @param {(balance: number) => void} [deps.onWalletBalance]
   */
  async function fetchFreshToken(deps = {}) {
    const isDevMode = typeof deps.isDevMode === 'function' ? deps.isDevMode : () => false;
    const getToken = typeof deps.getToken === 'function' ? deps.getToken : () => '';
    const setToken = typeof deps.setToken === 'function' ? deps.setToken : () => {};

    if (isDevMode()) {
      if (typeof deps.onDevMode === 'function') {
        return deps.onDevMode();
      }
      return isTokenPresent(getToken());
    }

    try {
      const response = await fetch('/api/session/token');
      const data = await response.json();

      if (response.status === 401 || data.redirect) {
        window.location.href = data.redirect || '/login?error=session_expired';
        return false;
      }

      if (data.token) {
        setToken(data.token);
      }
      if (data.wallet_balance !== undefined && typeof deps.onWalletBalance === 'function') {
        deps.onWalletBalance(data.wallet_balance);
      }
      return isTokenPresent(getToken());
    } catch (err) {
      console.error('Не удалось получить актуальный токен:', err);
      return false;
    }
  }

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @param {number} [retries]
   * @param {object} [deps]
   * @param {() => boolean} [deps.isDevMode]
   */
  async function fetchWithRetry(url, options = {}, retries = 3, deps = {}) {
    const isDevMode = typeof deps.isDevMode === 'function' ? deps.isDevMode : () => false;
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, options);
        let data = {};
        try {
          data = await response.json();
        } catch (_) {
          data = {};
        }

        if (response.status === 401 || data.redirect) {
          if (isDevMode()) {
            console.warn('Dev mode: пропускаем редирект на login для', url);
            return null;
          }
          window.location.href = data.redirect || '/login?error=session_expired';
          return null;
        }

        if (response.status === 503 && data.retry) {
          throw new Error(data.message || 'Сервис временно недоступен');
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return { response, data };
      } catch (err) {
        lastError = err;
        if (attempt < retries - 1) {
          const delay = RESYNC_RETRY_DELAYS[attempt] || 2000;
          console.warn(`🔁 Retry ${attempt + 1}/${retries - 1} для ${url} через ${delay}ms`);
          await sleep(delay);
        }
      }
    }

    throw lastError || new Error('Запрос не удался');
  }

  /**
   * Builds a page-specific reconnect scheduler that owns delay ladder logic.
   * @param {object} options
   * @param {() => boolean} [options.isDevMode]
   * @param {() => { isIntentionalReload: boolean, isReconnectScheduled: boolean, reconnectAttempt: number }} options.getFlags
   * @param {(partial: object) => void} options.setFlags
   * @param {(timer: number|null) => void} options.setTimer
   * @param {() => void} options.cleanup
   * @param {() => void} options.connect
   * @param {string} [options.logSuffix] - e.g. "лобби"
   */
  function createReconnectScheduler(options) {
    const isDevMode = typeof options.isDevMode === 'function' ? options.isDevMode : () => false;
    const logSuffix = options.logSuffix || '';

    return function scheduleReconnect(reason, fast = false) {
      if (isDevMode()) return;

      const flags = options.getFlags();
      if (flags.isIntentionalReload || flags.isReconnectScheduled) return;

      options.cleanup();

      const delay = fast
        ? FAST_RECONNECT_DELAY_MS
        : RECONNECT_DELAYS[Math.min(flags.reconnectAttempt, RECONNECT_DELAYS.length - 1)];

      const nextAttempt = flags.reconnectAttempt + 1;
      options.setFlags({
        reconnectAttempt: nextAttempt,
        isReconnectScheduled: true,
      });

      const label = logSuffix ? ` ${logSuffix}` : '';
      console.log(`⏳ ${reason}. Переподключение${label} через ${delay} мс (попытка ${nextAttempt})...`);

      const timer = setTimeout(() => {
        options.setFlags({ isReconnectScheduled: false });
        options.setTimer(null);
        options.connect();
      }, delay);
      options.setTimer(timer);
    };
  }

  const PP = {
    registerToastTitles,
    showToast,
    formatPokerAmount,
    fetchFreshToken,
    fetchWithRetry,
    createReconnectScheduler,
    sleep,
    RECONNECT_DELAYS,
    FAST_RECONNECT_DELAY_MS,
    RESYNC_RETRY_DELAYS,
  };

  global.PP = PP;
  global.showToast = showToast;
  global.formatPokerAmount = formatPokerAmount;
})(window);
