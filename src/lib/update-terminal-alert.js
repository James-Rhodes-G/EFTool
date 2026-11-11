'use strict';

const WIDTH = 70;
const border = '='.repeat(WIDTH);

function ansi(code, text) {
  return process.stdout.isTTY ? '\u001b[' + code + 'm' + text + '\u001b[0m' : text;
}

function printServerUpdateAlert(details) {
  const current = details.current;
  const latest = details.latest;
  const releaseUrl = details.releaseUrl;
  const title = ansi('1;33', '  EF TOOL — SERVER UPDATE AVAILABLE');
  const lines = [
    border,
    title,
    border,
    '  Installed:  v' + current,
    '  Latest:     v' + latest,
    '',
    '  Update the Node server (pull the latest release and restart).',
    '',
    releaseUrl
      ? '  Release: ' + releaseUrl
      : '  Release: see GitHub releases for this repository.',
    border
  ];

  lines.forEach(function (line) {
    console.warn(line);
  });
}

module.exports = {
  printServerUpdateAlert: printServerUpdateAlert
};
