(function () {
  var NAV_COLLAPSED_KEY = 'ef-demo-nav-collapsed';
  var NAV_WIDTH_EXPANDED = '280px';
  var NAV_WIDTH_COLLAPSED = '56px';

  function normalizePath(pathname) {
    var path = pathname || '/';
    if (path.length > 1) {
      path = path.replace(/\/+$/, '');
    }
    return path;
  }

  function stripHtml(path) {
    return path.replace(/\.html$/i, '');
  }

  function samePage(a, b) {
    return normalizePath(stripHtml(a)) === normalizePath(stripHtml(b));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureNavStyles() {
    if (!document.getElementById('app-global-nav-fonts')) {
      var fonts = document.createElement('link');
      fonts.id = 'app-global-nav-fonts';
      fonts.rel = 'stylesheet';
      fonts.href = 'https://fonts.googleapis.com/css2?family=Urbanist:wght@400;600;700&family=Noto+Sans:wght@400;600;700&display=swap';
      document.head.appendChild(fonts);
    }

    if (document.querySelector('link[href*="app-global-nav.css"]')) {
      return;
    }

    ['genesys-nav-tokens.css', 'app-global-nav.css', 'ef-update-banner.css'].forEach(function (fileName) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/css/' + fileName;
      document.head.appendChild(css);
    });
  }

  function loadUpdateBannerScript(callback) {
    if (window.EfUpdateBanner) {
      callback();
      return;
    }

    if (document.querySelector('script[data-ef-update-banner]')) {
      var existing = document.querySelector('script[data-ef-update-banner]');
      existing.addEventListener('load', callback, { once: true });
      return;
    }

    var script = document.createElement('script');
    script.src = '/scripts/ef-update-banner.js';
    script.setAttribute('data-ef-update-banner', 'true');
    script.addEventListener('load', callback, { once: true });
    script.addEventListener('error', function () {
      console.warn('[site-shell] Unable to load ef-update-banner.js');
    }, { once: true });
    document.head.appendChild(script);
  }

  function groupNavItems(navItems, groups) {
    var grouped = {};
    groups.forEach(function (group) {
      grouped[group.id] = [];
    });

    navItems.forEach(function (item) {
      var groupId = item.group || 'other';
      if (!grouped[groupId]) {
        grouped[groupId] = [];
      }
      grouped[groupId].push(item);
    });

    return grouped;
  }

  function buildSubmenuLink(item, currentPath) {
    var href = item.href;
    var label = item.label || item.title || href;
    var selected = samePage(href, currentPath) ? ' is-selected' : '';
    var ariaCurrent = selected ? ' aria-current="page"' : '';

    return (
      '<li class="menu-item-container sublink-title-container">' +
        '<a class="nav-item nav-link sublink-title' + selected + '" href="' + escapeHtml(href) + '"' + ariaCurrent + '>' +
          '<span class="link-title">' + escapeHtml(label) + '</span>' +
          '<span class="sublink-path">' + escapeHtml(href) + '</span>' +
        '</a>' +
      '</li>'
    );
  }

  function buildMainGroupItem(group) {
    return (
      '<li class="menu-item-container" data-nav-group="' + escapeHtml(group.id) + '">' +
        '<button type="button" class="nav-item command-nav__group-toggle" data-nav-group-toggle aria-expanded="false">' +
          '<span class="title-items">' +
            '<span class="nav-icon" aria-hidden="true">' + escapeHtml(group.icon || '•') + '</span>' +
            '<div class="link-title">' + escapeHtml(group.label) + '</div>' +
          '</span>' +
          '<span class="action-icons-hovers" aria-hidden="true">›</span>' +
        '</button>' +
      '</li>'
    );
  }

  function buildSubmenuPanel(group, items, currentPath) {
    if (!items.length) {
      return '';
    }

    var links = items.map(function (item) {
      return buildSubmenuLink(item, currentPath);
    }).join('');

    return (
      '<div class="command-nav__submenu-panel" data-submenu-panel="' + escapeHtml(group.id) + '" hidden>' +
        '<ul class="submenu-scroll-container">' +
          '<li class="submenu-specifics">' +
            '<div class="nav-item submenu-title">' + escapeHtml(group.label) + '</div>' +
            '<div class="submenu-return-container">' +
              '<button type="button" class="nav-item submenu-return" data-nav-submenu-return>' +
                '<span aria-hidden="true">←</span>' +
                '<div>Return to main menu</div>' +
              '</button>' +
            '</div>' +
          '</li>' +
          links +
        '</ul>' +
      '</div>'
    );
  }

  function buildFlatMainLink(item, currentPath) {
    var href = item.href;
    var label = item.label || item.title || href;
    var selected = samePage(href, currentPath) ? ' selected' : '';
    var ariaCurrent = selected ? ' aria-current="page"' : '';

    return (
      '<li class="menu-item-container">' +
        '<a class="nav-item nav-link' + selected + '" href="' + escapeHtml(href) + '"' + ariaCurrent + '>' +
          '<span class="title-items">' +
            '<span class="nav-icon" aria-hidden="true">•</span>' +
            '<span class="link-title">' + escapeHtml(label) + '</span>' +
          '</span>' +
        '</a>' +
      '</li>'
    );
  }

  function buildSidebar(navItems, groups, currentPath) {
    var grouped = groupNavItems(navItems, groups);
    var mainItems = [];
    var submenuPanels = [];

    groups.forEach(function (group) {
      var items = grouped[group.id] || [];
      if (!items.length) {
        return;
      }
      mainItems.push(buildMainGroupItem(group));
      submenuPanels.push(buildSubmenuPanel(group, items, currentPath));
    });

    if (!mainItems.length && navItems.length) {
      navItems.forEach(function (item) {
        mainItems.push(buildFlatMainLink(item, currentPath));
      });
    }

    return (
      '<aside id="app-global-nav" class="command-nav app-global-nav submenu-only" data-collapsed="false" data-submenu-open="false">' +
        '<div class="logo-group submenu-only">' +
          '<div class="logo">' +
            '<a href="/example.html" class="logo-image" aria-label="Embeddable Framework home">' +
              '<span class="icon-logo-genesys" aria-hidden="true">G</span>' +
            '</a>' +
          '</div>' +
          '<button type="button" id="navigation-menu" class="main-menu-toggle" aria-expanded="true" aria-label="Close Menu">' +
            '<span class="main-menu-toggle__close" aria-hidden="true">✕</span>' +
            '<span class="main-menu-toggle__open" aria-hidden="true">☰</span>' +
            '<span class="main-menu-toggle-menu-text">Menu</span>' +
          '</button>' +
        '</div>' +
        '<div class="nav-container">' +
          '<div class="command-nav__viewport">' +
            '<div class="command-nav__track" id="command-nav-track">' +
              '<div class="command-nav__panel command-nav__panel--main">' +
                '<nav aria-label="Application pages">' +
                  '<ul class="command-nav__list">' + mainItems.join('') + '</ul>' +
                '</nav>' +
              '</div>' +
              '<div class="command-nav__panel command-nav__panel--sub">' + submenuPanels.join('') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</aside>'
    );
  }

  function setNavCollapsed(nav, collapsed) {
    nav.dataset.collapsed = collapsed ? 'true' : 'false';
    document.documentElement.style.setProperty(
      '--app-nav-width',
      collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH_EXPANDED
    );
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');

    var toggle = nav.querySelector('#navigation-menu');
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Open Navigation Menu' : 'Close Menu');
    }

    if (collapsed) {
      closeSubmenu(nav);
    }
  }

  function closeSubmenu(nav) {
    nav.dataset.submenuOpen = 'false';
    nav.dataset.activeSubmenu = '';

    nav.querySelectorAll('[data-nav-group-toggle]').forEach(function (button) {
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('selected');
    });

    nav.querySelectorAll('[data-submenu-panel]').forEach(function (panel) {
      panel.hidden = true;
      panel.classList.remove('is-active');
    });
  }

  function openSubmenu(nav, groupId) {
    closeSubmenu(nav);

    var toggle = nav.querySelector('[data-nav-group="' + groupId + '"] [data-nav-group-toggle]');
    var submenuPanel = nav.querySelector('[data-submenu-panel="' + groupId + '"]');

    if (!toggle || !submenuPanel) {
      return;
    }

    nav.dataset.submenuOpen = 'true';
    nav.dataset.activeSubmenu = groupId;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.classList.add('selected');
    submenuPanel.hidden = false;
    submenuPanel.classList.add('is-active');
  }

  function initializeAppNav(nav) {
    var savedCollapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
    setNavCollapsed(nav, savedCollapsed);

    var menuToggle = nav.querySelector('#navigation-menu');
    if (menuToggle) {
      menuToggle.addEventListener('click', function () {
        setNavCollapsed(nav, nav.dataset.collapsed !== 'true');
      });
    }

    nav.querySelectorAll('[data-nav-group-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var group = button.closest('[data-nav-group]');
        var groupId = group && group.dataset.navGroup;
        if (!groupId) {
          return;
        }

        if (nav.dataset.collapsed === 'true') {
          setNavCollapsed(nav, false);
          openSubmenu(nav, groupId);
          return;
        }

        var isOpen =
          nav.dataset.submenuOpen === 'true' &&
          nav.dataset.activeSubmenu === groupId;

        if (isOpen) {
          closeSubmenu(nav);
          return;
        }

        openSubmenu(nav, groupId);
      });
    });

    nav.querySelectorAll('[data-nav-submenu-return]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeSubmenu(nav);
      });
    });

    var currentPath = normalizePath(window.location.pathname);
    groupsLoop: for (var i = 0; i < (window.__APP_NAV__ || []).length; i += 1) {
      var item = window.__APP_NAV__[i];
      if (samePage(item.href, currentPath) && item.group) {
        if (nav.dataset.collapsed !== 'true') {
          openSubmenu(nav, item.group);
        }
        break groupsLoop;
      }
    }
  }

  function buildShell() {
    if (!document.body || document.getElementById('app-shell-root')) {
      return;
    }

    ensureNavStyles();

    var navItems = Array.isArray(window.__APP_NAV__) ? window.__APP_NAV__ : [];
    var groups = Array.isArray(window.__APP_NAV_GROUPS__) ? window.__APP_NAV_GROUPS__ : [];
    var currentPath = normalizePath(window.location.pathname);

    document.body.classList.add('app-shell-ready');

    var shell = document.createElement('div');
    shell.id = 'app-shell-root';
    shell.className = 'app-shell';
    shell.setAttribute('data-app-shell', 'true');
    shell.innerHTML = buildSidebar(navItems, groups, currentPath);

    var main = document.createElement('div');
    main.className = 'app-main';
    main.id = 'app-main-root';

    while (document.body.firstChild) {
      main.appendChild(document.body.firstChild);
    }

    shell.appendChild(main);
    document.body.appendChild(shell);

    var nav = shell.querySelector('#app-global-nav');
    if (nav) {
      initializeAppNav(nav);
    }

    loadUpdateBannerScript(function () {
      if (window.EfUpdateBanner && typeof window.EfUpdateBanner.refresh === 'function') {
        window.EfUpdateBanner.refresh();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildShell);
  } else {
    buildShell();
  }
}());
