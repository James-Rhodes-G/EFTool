(function (global) {
  'use strict';

  var BANNER_ID = 'ef-update-banner';
  var DISMISS_KEY = 'ef_update_banner_dismissed';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getDismissedVersion() {
    try {
      return sessionStorage.getItem(DISMISS_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function setDismissedVersion(version) {
    try {
      sessionStorage.setItem(DISMISS_KEY, version);
    } catch (error) {
      // ignore
    }
  }

  function getMainRoot() {
    return document.getElementById('app-main-root');
  }

  function removeBanner() {
    var existing = document.getElementById(BANNER_ID);
    if (existing) {
      existing.remove();
    }
  }

  function renderBanner(payload) {
    var mainRoot = getMainRoot();
    if (!mainRoot) {
      return;
    }

    var latest = payload.latestVersion;
    if (!payload.server || !payload.server.updateAvailable || !latest) {
      removeBanner();
      return;
    }

    if (getDismissedVersion() === latest) {
      removeBanner();
      return;
    }

    var current = payload.server.current || 'unknown';
    var releaseLink = payload.releaseUrl
      ? '<a href="' + escapeHtml(payload.releaseUrl) + '" target="_blank" rel="noopener noreferrer">View release on GitHub</a>'
      : '';

    var banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.className = 'ef-update-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      mainRoot.insertBefore(banner, mainRoot.firstChild);
    }

    banner.innerHTML =
      '<div class="ef-update-banner__content">' +
        '<strong>Update available.</strong> ' +
        'EF Tool server is on <code>v' + escapeHtml(current) + '</code>; latest release is <code>v' + escapeHtml(latest) + '</code>. ' +
        'Pull the latest release and restart the server. ' +
        releaseLink +
      '</div>' +
      '<button type="button" class="ef-update-banner__dismiss" aria-label="Dismiss update notice">Dismiss</button>';

    var dismissBtn = banner.querySelector('.ef-update-banner__dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        setDismissedVersion(latest);
        removeBanner();
      });
    }
  }

  function refreshUpdateBanner() {
    return fetch('/api/app/update', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          removeBanner();
          return null;
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || payload.disabled || !payload.updateAvailable) {
          removeBanner();
          return;
        }
        renderBanner(payload);
      })
      .catch(function () {
        removeBanner();
      });
  }

  global.EfUpdateBanner = {
    refresh: refreshUpdateBanner
  };
}(window));
