(function () {
  const DEFAULT_SAMPLE = {
    id: 'e3957cf4-590e-422a-8913-fb8ca572da13',
    startTime: '2026-04-10T19:56:00.607Z',
    endTime: '2026-04-10T19:56:33.601Z',
    participants: []
  };

  function escapeMermaidText(value) {
    return String(value == null ? '' : value)
      .replace(/\r?\n/g, ' ')
      .replace(/"/g, '\\"')
      .trim();
  }

  function sanitizeMermaidId(value) {
    return String(value == null ? 'item' : value)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function toDurationSeconds(startTime, endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return '1s';
    }

    return `${Math.max(1, Math.round((end - start) / 1000))}s`;
  }

  function buildConversationGantt(conversation) {
    if (!conversation || typeof conversation !== 'object') {
      throw new Error('Invalid JSON payload');
    }

    const participants = Array.isArray(conversation.participants)
      ? conversation.participants.slice()
      : [];

    participants.sort(
      (a, b) => new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime()
    );

    const lines = [];
    lines.push('gantt');
    lines.push(`    title Conversation ${escapeMermaidText(conversation.id || '')}`);
    lines.push('    dateFormat YYYY-MM-DDTHH:mm:ss.SSSZ');
    lines.push('    axisFormat %H:%M:%S');
    lines.push('    todayMarker off');
    lines.push('');

    participants.forEach((participant) => {
      const sectionName =
        participant.name ||
        participant.participantType ||
        participant.purpose ||
        participant.id ||
        'Participant';
      const calls = Array.isArray(participant.calls) ? participant.calls.slice() : [];
      let taskCount = 0;

      lines.push(`    section ${escapeMermaidText(sectionName)}`);

      calls.forEach((call) => {
        const segments = Array.isArray(call.segments) ? call.segments.slice() : [];
        segments.sort(
          (a, b) => new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime()
        );

        segments.forEach((segment) => {
          if (!segment || !segment.startTime) {
            return;
          }

          const startTime = segment.startTime;
          const endTime = segment.endTime || segment.startTime;
          const labelParts = [segment.type || 'Segment'];

          if (segment.howEnded) {
            labelParts.push(`(${segment.howEnded})`);
          }

          const label = escapeMermaidText(labelParts.join(' '));
          const taskId = sanitizeMermaidId(
            `${participant.id || 'participant'}_${call.id || 'call'}_${String(taskCount++)}`
          );

          lines.push(`    ${label} :${taskId}, ${startTime}, ${toDurationSeconds(startTime, endTime)}`);
        });
      });

      if (taskCount === 0) {
        const fallbackStart = conversation.startTime || new Date().toISOString();
        lines.push(
          `    No segments found :${sanitizeMermaidId(participant.id || sectionName)}, ${fallbackStart}, 1s`
        );
      }

      lines.push('');
    });

    return lines.join('\n');
  }

  function setStatus(message, isError) {
    const statusEl = document.getElementById('status');
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  async function renderChart() {
    const inputEl = document.getElementById('conversationJson');
    const codeEl = document.getElementById('mermaidCode');
    const chartEl = document.getElementById('chart');

    if (!inputEl || !codeEl || !chartEl) {
      return;
    }

    setStatus('Rendering...', false);
    chartEl.innerHTML = '';
    codeEl.textContent = '';

    let payload;
    try {
      payload = JSON.parse(inputEl.value);
    } catch (error) {
      const msg = `Invalid JSON: ${error.message || error}`;
      codeEl.textContent = msg;
      setStatus(msg, true);
      return;
    }

    try {
      const mermaidText = buildConversationGantt(payload);
      codeEl.textContent = mermaidText;
      chartEl.innerHTML = `<div class="mermaid">${mermaidText.replace(/</g, '&lt;')}</div>`;
      await window.mermaid.run({ nodes: [chartEl.querySelector('.mermaid')] });
      setStatus('Rendered successfully.', false);
    } catch (error) {
      const msg = String(error.message || error);
      codeEl.textContent = msg;
      setStatus(msg, true);
    }
  }

  function init() {
    const inputEl = document.getElementById('conversationJson');
    const renderBtn = document.getElementById('renderBtn');
    const sampleBtn = document.getElementById('loadSampleBtn');

    if (!inputEl || !renderBtn) {
      return;
    }

    if (!inputEl.value.trim()) {
      inputEl.value = JSON.stringify(DEFAULT_SAMPLE, null, 2);
    }

    renderBtn.addEventListener('click', renderChart);
    if (sampleBtn) {
      sampleBtn.addEventListener('click', () => {
        inputEl.value = JSON.stringify(DEFAULT_SAMPLE, null, 2);
        renderChart();
      });
    }

    renderChart();
  }

  window.addEventListener('DOMContentLoaded', init);
  window.buildConversationGantt = buildConversationGantt;
})();
