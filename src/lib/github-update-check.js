'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(projectRoot, 'package.json');

const DEFAULT_REPO = 'James-Rhodes-G/EFTool';
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;

let releaseCache = { result: null, fetchedAt: 0, error: null };
let lastAlertedLatest = null;

function isUpdateCheckEnabled() {
  return String(process.env.UPDATE_CHECK_ENABLED ?? '1').trim() !== '0';
}

function getGithubRepo() {
  return String(process.env.GITHUB_REPO || DEFAULT_REPO).trim();
}

function getCacheTtlMs() {
  const parsed = Number(process.env.UPDATE_CHECK_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function getIntervalMs() {
  const parsed = Number(process.env.UPDATE_CHECK_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

function normalizeVersionTag(tag) {
  return String(tag || '').trim().replace(/^v/i, '');
}

function parseVersionParts(version) {
  const normalized = normalizeVersionTag(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    hasPrerelease: /-/.test(normalized.slice(match[0].length))
  };
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) {
    return 0;
  }
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }
  if (left.hasPrerelease && !right.hasPrerelease) {
    return -1;
  }
  if (!left.hasPrerelease && right.hasPrerelease) {
    return 1;
  }
  return 0;
}

function isVersionOlder(current, latest) {
  return compareVersions(current, latest) < 0;
}

function readServerPackageVersion() {
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return String(parsed.version || '').trim() || '0.0.0';
  } catch (_error) {
    return '0.0.0';
  }
}

async function fetchLatestReleaseFromGithub() {
  const repo = getGithubRepo();
  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ef-tool-local-server'
  };
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  try {
    const response = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
      headers: headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error('GitHub API ' + response.status);
    }
    const payload = await response.json();
    const version = normalizeVersionTag(payload.tag_name);
    if (!version) {
      throw new Error('Release tag missing');
    }
    return {
      version: version,
      url: String(payload.html_url || '').trim(),
      publishedAt: payload.published_at || null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCachedLatestRelease(options) {
  options = options || {};
  const forceRefresh = !!options.forceRefresh;

  if (!isUpdateCheckEnabled()) {
    return { release: null, checkedAt: Date.now(), error: 'disabled' };
  }

  const now = Date.now();
  const ttl = getCacheTtlMs();
  if (!forceRefresh && releaseCache.result && now - releaseCache.fetchedAt < ttl) {
    return { release: releaseCache.result, checkedAt: releaseCache.fetchedAt, error: null };
  }

  try {
    const release = await fetchLatestReleaseFromGithub();
    releaseCache = { result: release, fetchedAt: now, error: null };
    return { release: release, checkedAt: now, error: null };
  } catch (error) {
    releaseCache = {
      result: releaseCache.result,
      fetchedAt: releaseCache.fetchedAt,
      error: error.message
    };
    return {
      release: releaseCache.result,
      checkedAt: releaseCache.fetchedAt || now,
      error: error.message
    };
  }
}

function buildComponentStatus(current, latest) {
  return {
    current: current || null,
    updateAvailable: Boolean(current && latest && isVersionOlder(current, latest))
  };
}

async function getUpdateStatus(options) {
  options = options || {};
  const forceRefresh = !!options.forceRefresh;
  const serverCurrent = readServerPackageVersion();
  const cached = await getCachedLatestRelease({ forceRefresh: forceRefresh });
  const release = cached.release;
  const checkedAt = cached.checkedAt;
  const error = cached.error;
  const latestVersion = release && release.version ? release.version : null;
  const releaseUrl = release && release.url ? release.url : null;
  const server = buildComponentStatus(serverCurrent, latestVersion);

  const result = {
    checkedAt: checkedAt,
    latestVersion: latestVersion,
    releaseUrl: releaseUrl,
    updateAvailable: server.updateAvailable,
    server: server
  };

  if (error === 'disabled') {
    result.disabled = true;
  } else if (error && !release) {
    result.error = error;
  }

  return result;
}

async function runServerUpdateCheck(options) {
  options = options || {};
  const onServerUpdateAvailable = options.onServerUpdateAvailable;
  const forceRefresh = !!options.forceRefresh;

  if (!isUpdateCheckEnabled()) {
    return;
  }

  const status = await getUpdateStatus({ forceRefresh: forceRefresh });
  if (!status.server.updateAvailable || !status.latestVersion) {
    return;
  }

  if (lastAlertedLatest === status.latestVersion) {
    return;
  }
  lastAlertedLatest = status.latestVersion;

  if (typeof onServerUpdateAvailable === 'function') {
    onServerUpdateAvailable({
      current: status.server.current,
      latest: status.latestVersion,
      releaseUrl: status.releaseUrl
    });
  }
}

function startUpdateChecks(options) {
  options = options || {};
  const onServerUpdateAvailable = options.onServerUpdateAvailable;

  if (!isUpdateCheckEnabled()) {
    return;
  }

  runServerUpdateCheck({ onServerUpdateAvailable: onServerUpdateAvailable }).catch(function (error) {
    console.warn('Update check failed: ' + error.message);
  });

  const intervalMs = getIntervalMs();
  setInterval(function () {
    runServerUpdateCheck({
      onServerUpdateAvailable: onServerUpdateAvailable,
      forceRefresh: true
    }).catch(function (error) {
      console.warn('Update check failed: ' + error.message);
    });
  }, intervalMs).unref();
}

module.exports = {
  compareVersions: compareVersions,
  normalizeVersionTag: normalizeVersionTag,
  readServerPackageVersion: readServerPackageVersion,
  getUpdateStatus: getUpdateStatus,
  startUpdateChecks: startUpdateChecks,
  isUpdateCheckEnabled: isUpdateCheckEnabled
};
