'use strict';
require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { GenesysClient } = require('./src/bridge/genesysClient');
const { evaluateBridgeRequest } = require('./src/bridge/bridgeService');
const { getUpdateStatus, startUpdateChecks } = require('./src/lib/github-update-check');
const { printServerUpdateAlert } = require('./src/lib/update-terminal-alert');

const app = express();
app.use(express.json({ limit: '5mb' }));

function logRequest(req, res, next) {
  const start = Date.now();
  const requestLine = '[' + new Date().toISOString() + '] ' + req.method + ' ' + req.originalUrl;
  const origin = req.headers.origin || '-';
  const referer = req.headers.referer || '-';
  const userAgent = req.headers['user-agent'] || '-';

  console.log(requestLine);
  console.log('  host=' + (req.headers.host || '-') + ' origin=' + origin);
  console.log('  referer=' + referer);
  console.log('  user-agent=' + userAgent);

  res.on('finish', function() {
    console.log('  -> ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });

  next();
}

app.use(logRequest);

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', 'https://apps.usw2.pure.cloud');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader(
    'Permissions-Policy',
    'camera=*, microphone=*, autoplay=*, hid=*, local-network-access=*, local-network=*, loopback-network=*'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.static(__dirname + '/src'));

app.get('/framework.js', function(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'src', 'framework.js'));
});

app.get('/ca.crt', function(req, res) {
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.sendFile(path.join(__dirname, 'https-requirements', 'ca.crt'));
});

function readHtmlTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/<title>([^<]+)<\/title>/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (error) {
    console.error('Unable to read title from ' + filePath + ':', error && error.message ? error.message : error);
  }

  return path.basename(filePath, '.html').replace(/[-_]+/g, ' ');
}

function routeForPage(relativePath) {
  const baseName = path.basename(relativePath, '.html');
  if (baseName === 'campaign-display' || baseName === 'conversation-gantt') {
    return '/' + baseName;
  }

  return '/' + relativePath.split(path.sep).join('/');
}

const NAV_MANIFEST = [
  {
    id: 'embedded-framework',
    label: 'Embedded Framework',
    icon: '☎',
    pages: [
      { path: 'paypaltrouble.html', label: 'EF Message Logger' },
      { path: 'user-notifications.html', label: 'User Notifications' },
      { path: 'ef-message-parser.html', label: 'EF Message Parser' },
      { path: 'ef-phone-diagnostics.html', label: 'EF Phone Diagnostics' },
      { path: 'media-helper-gate.html', label: 'EF Phone Diagnostics (Media Helper)' },
      { path: 'example.html', label: 'Embeddable Framework Example' },
    ],
  },
  {
    id: 'streaming-tests',
    label: 'Streaming Tests',
    icon: '📡',
    pages: [
      { path: 'campaign-display.html', label: 'Campaign Display' },
      { path: 'paypal-callback-builder.html', label: 'Call Back Builder' },
      { path: 'transcription.html', label: 'Transcription Display' },
    ],
  },
  {
    id: 'general-tools',
    label: 'General Tools',
    icon: '🛠',
    pages: [
      { path: 'mermaid.html', label: 'Mermaid Live Editor' },
      { path: 'conversation-gantt.html', label: 'Conversation Gantt' },
    ],
  },
  {
    id: 'out-of-date',
    label: 'Out of Date',
    icon: '⚠',
    pages: [
      { path: 'EFLaunchPad.html', label: 'EF Launchpad' },
      { path: 'logout-handler.html', label: 'Logout Handler' },
      { path: 'launchpad.html', label: 'Genesys Launchpad' },
    ],
  },
];

const NAV_GROUP_DEFINITIONS = NAV_MANIFEST.map(function (group) {
  return {
    id: group.id,
    label: group.label,
    icon: group.icon,
  };
});

function buildNavPages() {
  const srcDir = path.join(__dirname, 'src');
  const entries = [];

  NAV_MANIFEST.forEach(function (group) {
    group.pages.forEach(function (page) {
      const fullPath = path.join(srcDir, page.path);

      if (!fs.existsSync(fullPath)) {
        console.warn('Nav page missing: ' + page.path);
        return;
      }

      entries.push({
        href: routeForPage(page.path),
        label: page.label || readHtmlTitle(fullPath),
        fileName: path.basename(page.path),
        group: group.id,
      });
    });
  });

  return entries;
}

function getBridgeConfig() {
  const env = process.env;
  //console.log(env);
  return {
    baseUrl: env.GENESYS_BASE_URL || '',
    oauthBaseUrl: env.GENESYS_OAUTH_BASE_URL || '',
    clientId: env.GENESYS_CLIENT_ID || '',
    clientSecret: env.GENESYS_CLIENT_SECRET || '',
    conversationPathTemplate: env.GENESYS_CONVERSATION_PATH_TEMPLATE || '/api/v2/conversations/calls/{conversationId}',
    dataTableId: env.GENESYS_DATA_TABLE_ID || '',
    dataTableKeyField: env.GENESYS_DATA_TABLE_KEY_FIELD || 'dnis',
    dataTableAnchorField: env.GENESYS_DATA_TABLE_ANCHOR_FIELD || 'conferenceConversationId',
    dataTableGetPathTemplate: env.GENESYS_DATA_TABLE_GET_PATH_TEMPLATE || '/api/v2/flows/datatables/{dataTableId}/rows/{rowId}',
    dataTableUpdatePathTemplate: env.GENESYS_DATA_TABLE_UPDATE_PATH_TEMPLATE || '/api/v2/flows/datatables/{dataTableId}/rows/{rowId}',
    mergeActionPathTemplate: env.GENESYS_MERGE_ACTION_PATH_TEMPLATE || '',
    mergeActionMethod: env.GENESYS_MERGE_ACTION_METHOD || 'POST',
    disconnectActionPathTemplate: env.GENESYS_DISCONNECT_ACTION_PATH_TEMPLATE || '',
    disconnectActionMethod: env.GENESYS_DISCONNECT_ACTION_METHOD || 'POST',
  };
}

const genesysClient = new GenesysClient(getBridgeConfig());
const navPages = buildNavPages();

app.get('/nav.js', function(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(
    'window.__APP_NAV_GROUPS__ = ' + JSON.stringify(NAV_GROUP_DEFINITIONS, null, 2) + ';\n' +
    'window.__APP_NAV__ = ' + JSON.stringify(navPages, null, 2) + ';'
  );
});

app.get('/api/app/update', async function(req, res) {
  try {
    const status = await getUpdateStatus();
    res.json(status);
  } catch (error) {
    res.status(503).json({
      updateAvailable: false,
      error: error && error.message ? error.message : 'Update check failed'
    });
  }
});

app.get('/campaign-display', function(req, res) {
  res.sendFile(path.join(__dirname, 'src', 'campaign-display.html'));
});

app.get('/conversation-gantt', function(req, res) {
  res.sendFile(path.join(__dirname, 'src', 'conversation-gantt.html'));
});

app.get('/bridge-poc', function(req, res) {
  res.sendFile(path.join(__dirname, 'src', 'bridge-poc.html'));
});

app.get('/api/bridge-poc/health', async function(req, res) {
  const config = genesysClient.describeConfig();
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    config: config,
  });
});

app.get('/api/bridge-poc/config', async function(req, res) {
  res.json({
    ok: true,
    config: genesysClient.describeConfig(),
  });
});

app.post('/api/bridge-poc/evaluate', async function(req, res, next) {
  try {
    const result = await evaluateBridgeRequest(req.body || {}, genesysClient, getBridgeConfig());
    res.json({ ok: true, result: result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/bridge-poc/auth-test', async (req, res) => {
    try {
        const client = new GenesysClient(getBridgeConfig());

        const response = await client.apiRequest(
            'GET',
            '/api/v2/organizations/me'
        );

        res.json({
            authenticated: true,
            organization: response.body
        });
    } catch (err) {
        res.status(500).json({
            authenticated: false,
            error: err.message,
            statusCode: err.statusCode || 500,
            details: err.body || null
        });
    }
});

app.get('/api/bridge-poc/conversation/:conversationId', async (req, res) => {
    try {
        const client = new GenesysClient(getBridgeConfig());

        const response = await client.getConversation(
            req.params.conversationId
        );

        res.json(response.body);
    } catch (err) {
        res.status(err.statusCode || 500).json({
            error: err.message,
            details: err.body || null
        });
    }
});

app.use(function(req, res) {
  console.error('Route not found: ' + req.method + ' ' + req.originalUrl);
  res.status(404).send('Not found');
});

app.use(function(err, req, res, next) {
  console.error('Unhandled application error for ' + req.method + ' ' + req.originalUrl);
  console.error(err && err.stack ? err.stack : err);
  res.status(500).json({
    ok: false,
    error: err && err.message ? err.message : 'Internal server error'
  });
});

app.set('port', (process.env.PORT || 8080));

let sslOptions = null;
try {
  sslOptions = {
    key: fs.readFileSync('https-requirements/localhost.key'),
    cert: fs.readFileSync('https-requirements/localhost.crt'),
    ca: fs.readFileSync('https-requirements/ca.crt'),
    requestCert: false,
    rejectUnauthorized: false
  };
} catch (error) {
  console.warn('HTTPS certificates could not be loaded. HTTPS will be disabled until the cert files are present.');
  console.warn(error && error.message ? error.message : error);
}

const httpServer = http.createServer(app);
const httpsServer = sslOptions ? https.createServer(sslOptions, app) : null;

const httpsPort = 443;

httpServer.on('error', function(err) {
  console.error('HTTP server error:', err);
});

if (httpsServer) {
  httpsServer.on('error', function(err) {
    console.error('HTTPS server error:', err);
  });
}

httpServer.on('clientError', function(err, socket) {
  console.error('HTTP client error:', err);
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

if (httpsServer) {
  httpsServer.on('secureConnection', function(tlsSocket) {
    console.log('HTTPS connection from ' + (tlsSocket.remoteAddress || 'unknown'));
  });

  httpsServer.on('clientError', function(err, socket) {
    console.error('HTTPS client error:', err && err.message ? err.message : err);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
}

process.on('uncaughtException', function(err) {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', function(err) {
  console.error('Unhandled rejection:', err);
});

function startServers() {
  console.log('starting on ' + app.get('port') + ' (http)');
  if (httpsServer) {
    console.log('starting on ' + httpsPort + ' (https)');
  }
  httpServer.listen(app.get('port'));
  if (httpsServer) {
    httpsServer.listen(httpsPort);
  }
  startUpdateChecks({ onServerUpdateAvailable: printServerUpdateAlert });
}

if (require.main === module) {
  startServers();
}

module.exports = {
  app,
  genesysClient,
  startServers,
};
