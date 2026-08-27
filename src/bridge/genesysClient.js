'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildUrl(template, vars) {
  return String(template || '').replace(/\{([^}]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key];
      return value === undefined || value === null ? '' : encodeURIComponent(String(value));
    }
    return match;
  });
}

function redactSecret(value) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= 8) return '********';
  return str.slice(0, 4) + '…' + str.slice(-4);
}

function requestJson({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers || {},
    };

    const req = transport.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const contentType = String(res.headers['content-type'] || '');
        let parsedBody = raw;
        if (raw && contentType.includes('application/json')) {
          try {
            parsedBody = JSON.parse(raw);
          } catch (parseError) {
            // keep raw string
          }
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsedBody });
          return;
        }

        const error = new Error(`HTTP ${res.statusCode} from ${method} ${url}`);
        error.statusCode = res.statusCode;
        error.headers = res.headers;
        error.body = parsedBody;
        reject(error);
      });
    });

    req.on('error', reject);

    if (body !== undefined && body !== null) {
      const serialized = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(serialized);
    }

    req.end();
  });
}

class GenesysClient {
  constructor(config) {
    this.config = Object.assign({}, config || {});
    this._tokenCache = null;
  }

  describeConfig() {
    return {
      baseUrl: trimTrailingSlash(this.config.baseUrl),
      oauthBaseUrl: trimTrailingSlash(this.config.oauthBaseUrl || this.config.baseUrl),
      conversationPathTemplate: this.config.conversationPathTemplate,
      dataTableGetPathTemplate: this.config.dataTableGetPathTemplate,
      dataTableUpdatePathTemplate: this.config.dataTableUpdatePathTemplate,
      mergeActionPathTemplate: this.config.mergeActionPathTemplate,
      disconnectActionPathTemplate: this.config.disconnectActionPathTemplate,
      dataTableId: this.config.dataTableId,
      dataTableKeyField: this.config.dataTableKeyField,
      dataTableAnchorField: this.config.dataTableAnchorField,
      clientId: redactSecret(this.config.clientId),
      clientSecret: redactSecret(this.config.clientSecret),
    };
  }

  async getAccessToken() {
    const now = Date.now();
    if (this._tokenCache && this._tokenCache.accessToken && this._tokenCache.expiresAt > now + 60_000) {
      return this._tokenCache.accessToken;
    }

    const oauthBaseUrl = trimTrailingSlash(this.config.oauthBaseUrl || this.config.baseUrl);
    if (!oauthBaseUrl) {
      throw new Error('GENESYS_BASE_URL is required');
    }
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('GENESYS_CLIENT_ID and GENESYS_CLIENT_SECRET are required');
    }

    const tokenUrl = `${oauthBaseUrl}/oauth/token`;
    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');

    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const response = await requestJson({
      method: 'POST',
      url: tokenUrl,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: form.toString(),
    });

    const body = response.body || {};
    if (!body.access_token) {
      throw new Error('Genesys token response did not include an access_token');
    }

    const expiresInSeconds = Number(body.expires_in || 1800);
    this._tokenCache = {
      accessToken: body.access_token,
      expiresAt: now + (expiresInSeconds * 1000),
      scope: body.scope || '',
      tokenType: body.token_type || 'bearer',
      raw: body,
    };

    return this._tokenCache.accessToken;
  }

  async apiRequest(method, pathOrUrl, body, extraHeaders) {
    const baseUrl = trimTrailingSlash(this.config.baseUrl);
    if (!baseUrl) {
      throw new Error('GENESYS_BASE_URL is required');
    }

    const url = /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : `${baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const token = await this.getAccessToken();
    const headers = Object.assign({
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    }, extraHeaders || {});

    let requestBody = body;
    if (requestBody !== undefined && requestBody !== null && typeof requestBody !== 'string' && !Buffer.isBuffer(requestBody)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      requestBody = JSON.stringify(requestBody);
    }

    return requestJson({ method, url, headers, body: requestBody });
  }

  async getConversation(conversationId) {
    const template = this.config.conversationPathTemplate || '/api/v2/conversations/calls/{conversationId}';
    const path = buildUrl(template, { conversationId });
    return this.apiRequest('GET', path);
  }

  async getDataTableRow(dataTableId, rowId) {
    const template = this.config.dataTableGetPathTemplate || '/api/v2/flows/datatables/{dataTableId}/rows/{rowId}';
    const path = buildUrl(template, { dataTableId, rowId });
    return this.apiRequest('GET', path);
  }

  async updateDataTableRow(dataTableId, rowId, rowBody) {
    const template = this.config.dataTableUpdatePathTemplate || '/api/v2/flows/datatables/{dataTableId}/rows/{rowId}';
    const path = buildUrl(template, { dataTableId, rowId });
    return this.apiRequest('PUT', path, rowBody);
  }

  async runConfiguredAction({ method, template, vars, body }) {
    if (!template) {
      return null;
    }
    const path = buildUrl(template, vars || {});
    return this.apiRequest(method || 'POST', path, body);
  }
}

module.exports = {
  GenesysClient,
  buildUrl,
};
