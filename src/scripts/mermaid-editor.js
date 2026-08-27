(function () {
  const DEFAULT_SAMPLE = `flowchart TD
  A[Paste Mermaid text here] --> B[Edit the text]
  B --> C[Chart redraws automatically]`;

const MARKER_OWNER = 'mermaid';  
  const state = {
    editor: null,
    statusEl: null,
    chartEl: null,
    renderToken: 0,
    renderTimer: null,
    monacoReady: false,
    pendingInit: []
  };

  function setStatus(message, isError) {
    if (!state.statusEl) {
      return;
    }
    state.statusEl.textContent = message;
    state.statusEl.classList.toggle('error', Boolean(isError));
  }

function clearMessages() {
  document.querySelectorAll('div[id^="dmermaid_"]').forEach((el) => el.remove());
  
}

  function clearMarkers() {
    if (!window.monaco || !state.editor) {
      return;
    }
    const model = state.editor.getModel();
    if (model) {
      window.monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    }
  }

  function setMarkersFromError(error) {
    if (!window.monaco || !state.editor) {
      return;
    }

    const model = state.editor.getModel();
    if (!model) {
      return;
    }

    const message = String(error && error.message ? error.message : error || 'Invalid Mermaid syntax');
    const markers = [];

    // Mermaid often emits errors with line/column information in the message.
    // This regex handles common forms such as "Parse error on line 3:"
    const lineMatch = message.match(/line\s+(\d+)(?:\s*,\s*column\s+(\d+))?/i);
    const lineNumber = lineMatch ? Math.max(1, Number(lineMatch[1])) : 1;
    const columnNumber = lineMatch && lineMatch[2] ? Math.max(1, Number(lineMatch[2])) : 1;

    markers.push({
      severity: window.monaco.MarkerSeverity.Error,
      message,
      startLineNumber: lineNumber,
      startColumn: columnNumber,
      endLineNumber: lineNumber,
      endColumn: Math.max(columnNumber + 1, columnNumber)
    });

    window.monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }

  async function renderMermaid() {
    if (!state.editor || !state.chartEl) {
      return;
    }

    const token = ++state.renderToken;
    const code = state.editor.getValue();
    const trimmed = code.trim();
    console.log('cleaing everything')
    clearMessages();
    clearMarkers();

    if (!trimmed) {
      state.chartEl.innerHTML = '';
      setStatus('Enter Mermaid text to render.', false);
      return;
    }

    setStatus('Rendering...', false);

    try {
      const renderId = `mermaid_${Date.now()}_${token}`;
      const result = await window.mermaid.render(renderId, trimmed);
      if (token !== state.renderToken) {
        return;
      }

      state.chartEl.innerHTML = result.svg;
      if (typeof result.bindFunctions === 'function') {
        result.bindFunctions(state.chartEl);
      }
      clearMessages
      clearMarkers();
      setStatus('Rendered successfully.', false);
    } catch (error) {
      if (token !== state.renderToken) {
        return;
      }

      state.chartEl.innerHTML = '';
      setMarkersFromError(error);
      setStatus('Invalid Mermaid: ' + (error && error.message ? error.message : String(error)), true);
    }
  }

  function scheduleRender() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(renderMermaid, 200);
  }

  function createEditor() {
    const editorHost = document.getElementById('mermaidEditorMount');
    if (!editorHost || !window.monaco) {
      return;
    }

    state.editor = window.monaco.editor.create(editorHost, {
      value: DEFAULT_SAMPLE,
      language: 'plaintext',
      minimap: { enabled: false },
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      theme: 'vs'
    });

    state.editor.onDidChangeModelContent(scheduleRender);
    scheduleRender();
  }

  function initMonaco() {
    if (state.monacoReady) {
      return;
    }
    state.monacoReady = true;

    window.monaco.languages.register({ id: 'mermaid' });

    // Light token styling for Mermaid-ish text. Monaco still gives the editor
    // experience even without a full Mermaid grammar.
    window.monaco.languages.setMonarchTokensProvider('mermaid', {
      tokenizer: {
        root: [
          [/^\s*(gantt|flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|journey|gitGraph|pie|mindmap)\b/i, 'keyword'],
          [/^\s*section\b/i, 'keyword'],
          [/-->|---|==>|-.->|--x|--o/, 'operator'],
          [/\[[^\]]*\]/, 'string'],
          [/\([^\)]*\)/, 'string'],
          [/"([^"]|\\")*"/, 'string'],
          [/%%.*$/, 'comment']
        ]
      }
    });

    createEditor();
  }

  function loadMonaco() {
    return new Promise((resolve, reject) => {
      if (window.monaco) {
        resolve();
        return;
      }

      window.require.config({
        paths: {
          vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs'
        }
      });

      window.require(['vs/editor/editor.main'], function () {
        resolve();
      }, reject);
    });
  }

  function init() {
    state.statusEl = document.getElementById('status');
    state.chartEl = document.getElementById('chart');
    const mountEl = document.getElementById('mermaidEditorMount');
    const loadSampleBtn = document.getElementById('loadSampleBtn');

    if (!state.statusEl || !state.chartEl || !mountEl) {
      return;
    }

    loadMonaco()
      .then(function () {
        initMonaco();
      })
      .catch(function (error) {
        setStatus('Failed to load Monaco Editor: ' + (error && error.message ? error.message : String(error)), true);
      });

    if (loadSampleBtn) {
      loadSampleBtn.addEventListener('click', function () {
        if (state.editor) {
          state.editor.setValue(DEFAULT_SAMPLE);
          scheduleRender();
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
