(function (global) {
  'use strict';

  var MAX_AUTH_POLL_ATTEMPTS = 120;
  var DEFAULT_POLL_MS = 3000;

  function resolveApiBaseUrlFromIframeSrc() {
    var iframeSrc = global.__EF_IFRAME_SRC__ || '';
    var match = iframeSrc.match(/^https:\/\/apps\.([^.]+\.pure\.cloud)/i);
    if (match && match[1]) {
      return 'https://api.' + match[1];
    }
    return '';
  }

  function createDiagnosticsAuth(options) {
    options = options || {};
    var iframe = options.iframe || null;
    var pollMs = options.pollIntervalMs || DEFAULT_POLL_MS;
    var authPollTimer = null;
    var authPollAttempts = 0;
    var state = {
      accessToken: null,
      userId: null,
      apiBaseUrl: null,
      userDisplayName: null
    };
    var onCredentials = options.onCredentials || null;

    function stopPolling() {
      if (authPollTimer) {
        clearInterval(authPollTimer);
        authPollTimer = null;
      }
    }

    function applyAuthPayload(data) {
      if (!data || !data.token) {
        return false;
      }

      state.accessToken = data.token;
      state.userId =
        data.userId ||
        (data.user && data.user.id) ||
        state.userId ||
        null;
      state.apiBaseUrl =
        data.apiBaseUrl ||
        data.baseUrl ||
        state.apiBaseUrl ||
        resolveApiBaseUrlFromIframeSrc() ||
        null;

      if (data.user && (data.user.name || data.user.id)) {
        state.userDisplayName = data.user.name || data.user.id;
      }

      stopPolling();

      if (onCredentials) {
        onCredentials(Object.assign({}, state));
      }

      return true;
    }

    function requestAuthTokenFromIframe() {
      if (!iframe || !iframe.contentWindow) {
        return;
      }

      authPollAttempts += 1;
      if (authPollAttempts > MAX_AUTH_POLL_ATTEMPTS) {
        stopPolling();
        return;
      }

      iframe.contentWindow.postMessage(JSON.stringify({
        type: 'diagnosticsGetAuthToken'
      }), '*');
    }

    function beginPolling() {
      if (authPollTimer || state.accessToken) {
        return;
      }
      authPollAttempts = 0;
      requestAuthTokenFromIframe();
      authPollTimer = setInterval(requestAuthTokenFromIframe, pollMs);
    }

    function handleWindowMessage(event) {
      var parsed;
      if (typeof event.data !== 'string') {
        return;
      }
      try {
        parsed = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (parsed && parsed.type === 'diagnosticsAuthToken') {
        applyAuthPayload(parsed.data || {});
        return;
      }

      if (parsed && parsed.type === 'efLifecycle' && parsed.data && parsed.data.stage === 'initialSetup-complete') {
        beginPolling();
      }
    }

    function bind() {
      global.addEventListener('message', handleWindowMessage);
      beginPolling();
    }

    function unbind() {
      stopPolling();
      global.removeEventListener('message', handleWindowMessage);
    }

    function setIframe(el) {
      iframe = el;
    }

    function getState() {
      return Object.assign({}, state);
    }

    function setAccessToken(token) {
      state.accessToken = token || null;
    }

    function setApiBaseUrl(url) {
      state.apiBaseUrl = url || null;
    }

    return {
      bind: bind,
      unbind: unbind,
      setIframe: setIframe,
      beginPolling: beginPolling,
      stopPolling: stopPolling,
      getState: getState,
      setAccessToken: setAccessToken,
      setApiBaseUrl: setApiBaseUrl,
      applyAuthPayload: applyAuthPayload
    };
  }

  global.EfDiagnosticsAuth = {
    create: createDiagnosticsAuth,
    resolveApiBaseUrlFromIframeSrc: resolveApiBaseUrlFromIframeSrc
  };
}(window));
