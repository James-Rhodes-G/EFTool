(function (global) {
  'use strict';

  var REGIONS_URL = '/data/genesys_regions.json';
  var REGION_STORAGE_KEY = 'ef_demo_genesys_region';
  var DEFAULT_REGION_ID = 'us-west-2';
  var regionsCache = null;
  var readyPromise = null;
  var connectionState = {
    regions: [],
    regionSelect: null,
    accessTokenField: null
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function loadRegions() {
    if (regionsCache) {
      return Promise.resolve(regionsCache);
    }

    return fetch(REGIONS_URL, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load Genesys regions (' + response.status + ')');
      }
      return response.json();
    }).then(function (regions) {
      regionsCache = Array.isArray(regions) ? regions : [];
      return regionsCache;
    });
  }

  function findRegion(regionId) {
    return connectionState.regions.find(function (region) {
      return region.id === regionId;
    });
  }

  function getApiBaseUrlForRegion(regionId) {
    var region = findRegion(regionId);
    if (!region || !region.domain) {
      return '';
    }

    return 'https://api.' + String(region.domain).replace(/^api\./, '').replace(/\/$/, '');
  }

  function populateRegionSelect(selectEl, regions, selectedRegionId) {
    if (!selectEl) {
      return;
    }

    selectEl.innerHTML = regions.map(function (region) {
      return (
        '<option value="' + escapeAttr(region.id) + '">' +
        escapeHtml(region.label || region.id) +
        '</option>'
      );
    }).join('');

    if (selectedRegionId) {
      selectEl.value = selectedRegionId;
    }

    if (!selectEl.value && regions.length) {
      selectEl.value = regions[0].id;
    }
  }

  function createAccessTokenField(fieldEl) {
    var actualValue = '';
    var isMasked = false;

    function maskValue(value) {
      return value.replace(/./g, '\u2022');
    }

    function getValue() {
      if (isMasked) {
        return actualValue;
      }
      return fieldEl.value.trim();
    }

    function setValue(value) {
      actualValue = String(value || '');
      isMasked = false;
      fieldEl.value = actualValue;
    }

    fieldEl.addEventListener('input', function () {
      if (!isMasked) {
        actualValue = fieldEl.value;
      }
    });

    fieldEl.addEventListener('focus', function () {
      if (isMasked && actualValue) {
        isMasked = false;
        fieldEl.value = actualValue;
      }
    });

    fieldEl.addEventListener('blur', function () {
      if (isMasked) {
        return;
      }

      actualValue = fieldEl.value.trim();
      if (!actualValue) {
        fieldEl.value = '';
        return;
      }

      isMasked = true;
      fieldEl.value = maskValue(actualValue);
    });

    return {
      getValue: getValue,
      setValue: setValue
    };
  }

  function initialize(options) {
    options = options || {};

    var regionSelectId = options.regionSelectId || 'genesysRegionSelect';
    var accessTokenId = options.accessTokenId || 'accessToken';
    var storageKey = options.storageKey || REGION_STORAGE_KEY;
    var defaultRegionId = options.defaultRegionId || DEFAULT_REGION_ID;

    var regionSelect = document.getElementById(regionSelectId);
    var accessTokenEl = document.getElementById(accessTokenId);

    if (!regionSelect) {
      return Promise.reject(new Error('Region select #' + regionSelectId + ' was not found.'));
    }

    return loadRegions().then(function (regions) {
      connectionState.regions = regions;
      connectionState.regionSelect = regionSelect;

      var savedRegionId = localStorage.getItem(storageKey) || defaultRegionId;
      populateRegionSelect(regionSelect, regions, savedRegionId);

      regionSelect.addEventListener('change', function () {
        localStorage.setItem(storageKey, regionSelect.value);
      });

      if (accessTokenEl) {
        connectionState.accessTokenField = createAccessTokenField(accessTokenEl);
      }

      return connectionState;
    });
  }

  function getApiBaseUrl() {
    if (!connectionState.regionSelect) {
      return '';
    }
    return getApiBaseUrlForRegion(connectionState.regionSelect.value);
  }

  function getAccessToken() {
    if (!connectionState.accessTokenField) {
      var field = document.getElementById('accessToken');
      return field ? field.value.trim() : '';
    }
    return connectionState.accessTokenField.getValue();
  }

  function getRegionId() {
    return connectionState.regionSelect ? connectionState.regionSelect.value : '';
  }

  function boot() {
    if (!document.getElementById('genesysRegionSelect')) {
      readyPromise = Promise.resolve(connectionState);
      return readyPromise;
    }

    readyPromise = initialize().catch(function (error) {
      console.error('[GenesysConnectionFields]', error);
      var regionSelect = document.getElementById('genesysRegionSelect');
      if (regionSelect) {
        regionSelect.innerHTML = '<option value="">Failed to load regions</option>';
      }
      throw error;
    });

    return readyPromise;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.GenesysConnectionFields = {
    initialize: initialize,
    get ready() {
      return readyPromise || boot();
    },
    getApiBaseUrl: getApiBaseUrl,
    getAccessToken: getAccessToken,
    getRegionId: getRegionId,
    getApiBaseUrlForRegion: function (regionId) {
      return getApiBaseUrlForRegion(regionId);
    }
  };
}(window));
