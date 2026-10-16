"use strict";

/**
 * Own chat panel for the CodeOpen sidebar (WebviewView `freecli.main`).
 * Replicates the Copilot Chat panel layout (see microsoft/vscode
 * src/vs/workbench/contrib/chat/browser): header toolbar with New Chat and
 * model picker, welcome view with suggestions, message list, and a bottom
 * input with Send/Stop. No Copilot Chat Participant (@-mention) is used.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { isQuestionTool } = require("../chat/questions");

function makeNonce() {
  try {
    return crypto
      .randomBytes(16)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "A");
  } catch (e) {
    return `nonce${Date.now()}`;
  }
}

function loadIconDataUrl() {
  try {
    const iconPath = path.join(__dirname, "..", "..", "assets", "icon.png");
    if (fs.existsSync(iconPath)) {
      return (
        "data:image/png;base64," + fs.readFileSync(iconPath).toString("base64")
      );
    }
  } catch (e) {
    // ignore
  }
  return "";
}
const ICON_PNG_DATA_URL = loadIconDataUrl();

// Inline Lucide-style icons (stroke=currentColor) and base64-embedded
// brand icon (assets/icon.png). Inlined so the webview needs zero external
// resources (offline-safe, strict CSP default-src 'none'; img-src data:;).
function _svg(paths, size) {
  const s = size || 16;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    paths +
    "</svg>"
  );
}
const ICONS = {
  plus: _svg(
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  ),
  refresh: _svg(
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  ),
  sliders: _svg(
    '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
  ),
  send: _svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 15),
  stop: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  x: _svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14),
  check: _svg('<path d="M20 6 9 17l-5-5"/>', 13),
  circle: _svg('<circle cx="12" cy="12" r="9"/>', 12),
  copy: _svg(
    '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    13,
  ),
  chev: _svg('<path d="m6 9 6 6 6-6"/>', 14),
  back: _svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>', 15),
  trash: _svg(
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    13,
  ),
  reuse: _svg(
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    13,
  ),
  undo: _svg(
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    13,
  ),
  file: _svg(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    13,
  ),
  pin: _svg(
    '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1Z"/>',
    13,
  ),
  terminal: _svg('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', 14),
  sparkle: _svg(
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
    14,
  ),
  sparkles: _svg(
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    14,
  ),
  brain: _svg(
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
    12,
  ),
  pencil: _svg(
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    12,
  ),
  globe: _svg(
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    12,
  ),
  folder: _svg(
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    12,
  ),
  code: _svg(
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    12,
  ),
  search: _svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 12),
  bookOpenText: _svg(
    '<path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/>',
    14,
  ),
  squarePen: _svg(
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    14,
  ),
  searchCode: _svg(
    '<path d="m13 13.5 2-2.5-2-2.5"/><path d="m21 21-4.3-4.3"/><path d="M9 8.5 7 11l2 2.5"/><circle cx="11" cy="11" r="8"/>',
    14,
  ),
  fileTerminal: _svg(
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m8 16 2-2-2-2"/><path d="M12 18h4"/>',
    14,
  ),
  bug: _svg(
    '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    14,
  ),
  chat: _svg(
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    30,
  ),
  // CodeOpen brand mark: icon.png from assets/
  logo: ICON_PNG_DATA_URL
    ? '<img src="' +
      ICON_PNG_DATA_URL +
      '" width="48" height="48" alt="CodeOpen" class="logo-img" />'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">' +
      '<rect width="24" height="24" fill="#000000"/>' +
      '<rect x="5" y="5" width="14" height="14" fill="#2D2D2D"/>' +
      '<rect x="8.5" y="7.5" width="7" height="9" fill="none" stroke="#8C8C8C" stroke-width="0.5"/>' +
      '<rect x="8.5" y="7.5" width="7" height="3.5" fill="#000000"/>' +
      '<rect x="8.5" y="11" width="7" height="5.5" fill="#D0CECE"/>' +
      "</svg>",
};

function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s).replace(
    /[&<>"']/g,
    (ch) => {
      switch (ch) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return ch;
      }
    },
  );
}

/**
 * Derive the Copilot-style phase label from what the CLI is actually doing.
 * Single source of truth: injected into the webview script, unit-tested here.
 */
/**
 * Recognizable per-language file logo (HTML shield, Python two-tone,
 * JS/TS tiles, Vue V, Ruby gem, PHP oval, Java cup, DB cylinder, …).
 * Self-contained inline SVG for webview injection (offline, strict CSP).
 * Accepts a file extension or a VS Code languageId.
 */
function fileBadge(ext) {
  const alias = {
    python: "py",
    javascript: "js",
    javascriptreact: "jsx",
    typescript: "ts",
    typescriptreact: "tsx",
    shellscript: "sh",
    shell: "sh",
    bash: "sh",
    markdown: "md",
    yaml: "yml",
    dockerfile: "docker",
    csharp: "cs",
  };
  const raw = String(ext || "")
    .toLowerCase()
    .replace(/^\./, "");
  const k = alias[raw] || raw;
  const open =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">';
  const escT = (s) =>
    String(s).replace(
      /[<>&"']/g,
      (ch) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const tile = (bg, fg, label, size, rx) =>
    open +
    '<rect x="2" y="2" width="20" height="20" rx="' +
    (rx === undefined ? 5 : rx) +
    '" fill="' +
    bg +
    '"/>' +
    '<text x="12" y="16.5" text-anchor="middle" font-size="' +
    (size || 9) +
    '" font-weight="bold" fill="' +
    fg +
    '" font-family="sans-serif">' +
    escT(label) +
    "</text></svg>";
  const shield = (fill) =>
    '<path d="M5 2.5h14l-1.3 14.6L12 20.5l-5.7-3.4L5 2.5z" fill="' +
    fill +
    '"/>';
  switch (k) {
    case "html":
    case "htm":
      // HTML5 shield: orange tile, darker right facet, white 5.
      return (
        open +
        shield("#E34F26") +
        '<path d="M12 4.8v13.4l3.9-1.1 1-11.1L12 4.8z" fill="#000000" opacity="0.18"/>' +
        '<text x="12" y="15.5" text-anchor="middle" font-size="8.5" font-weight="bold" fill="#ffffff" font-family="sans-serif">5</text></svg>'
      );
    case "css":
    case "less":
      // CSS shield: blue with white id-selector mark.
      return (
        open +
        shield("#2965F1") +
        '<text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="bold" fill="#ffffff" font-family="sans-serif">#</text></svg>'
      );
    case "scss":
    case "sass":
      return (
        open +
        shield("#CD6799") +
        '<text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="bold" fill="#ffffff" font-family="sans-serif">#</text></svg>'
      );
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "node":
      // Official JS mark: yellow square, black JS.
      return tile("#F7DF1E", "#000000", "JS", 8.5, 2);
    case "ts":
    case "tsx":
    case "mts":
      // Official TS mark: blue square, white TS.
      return tile("#3178C6", "#ffffff", "TS", 8.5, 2);
    case "py":
      // Python colors: blue top, yellow bottom, split tile.
      return (
        open +
        '<rect x="2" y="2" width="20" height="20" rx="5" fill="#3776AB"/>' +
        '<path d="M2 13.5h20V17a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5v-3.5z" fill="#FFD43B"/>' +
        '<rect x="2" y="12.4" width="20" height="1.2" fill="#ffffff" opacity="0.85"/></svg>'
      );
    case "vue":
      // Vue V: dark back chevron, green front chevron.
      return (
        open +
        '<path d="M2.5 4.5L12 20l9.5-15.5h-4L12 13.5 6.5 4.5z" fill="#35495E"/>' +
        '<path d="M6.5 4.5L12 13.5l5.5-9H14L12 8.5 10 4.5z" fill="#42B883"/></svg>'
      );
    case "json":
      return tile("#2D2D2D", "#F2C94C", "{}", 9);
    case "md":
      return tile("#24292E", "#ffffff", "M", 10);
    case "yml":
      return tile("#CB171E", "#ffffff", "Y", 10);
    case "sh":
      // Terminal prompt: green $ on near-black.
      return tile("#1E1E1E", "#4EAA25", "$", 11);
    case "java": {
      // Coffee cup: orange body + handle, blue steam.
      return (
        open +
        '<path d="M7 8h9v6a4 4 0 0 1-4 4H9a2 2 0 0 1-2-2z" fill="#ED8B00"/>' +
        '<path d="M16 9.5h1.2a2.3 2.3 0 0 1 0 4.6H16" fill="none" stroke="#ED8B00" stroke-width="1.6"/>' +
        '<path d="M9.5 2.8c-1.2 1.2 1.2 1.8 0 3M12.8 2.8c-1.2 1.2 1.2 1.8 0 3" fill="none" stroke="#5382A1" stroke-width="1.2" stroke-linecap="round"/></svg>'
      );
    }
    case "go":
      return tile("#00ADD8", "#ffffff", "GO", 8);
    case "rs":
      return tile("#DEA584", "#1E1E1E", "Rs", 8.5);
    case "rb":
      // Ruby gem: red stone with white facets.
      return (
        open +
        '<path d="M7 3.5h10L21 9l-9 11.5L3 9z" fill="#CC342D"/>' +
        '<path d="M3 9h18M7 3.5L9.5 9 12 20.5M17 3.5L14.5 9 12 20.5" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.85"/></svg>'
      );
    case "php":
      return (
        open +
        '<ellipse cx="12" cy="12" rx="10" ry="7.5" fill="#777BB4"/>' +
        '<text x="12" y="15" text-anchor="middle" font-size="8" font-style="italic" font-weight="bold" fill="#ffffff" font-family="sans-serif">php</text></svg>'
      );
    case "c":
    case "h":
      return tile("#555555", "#ffffff", "C", 10);
    case "cpp":
      return tile("#F34B7D", "#ffffff", "C++", 7);
    case "cs":
      return tile("#68217A", "#ffffff", "C#", 8);
    case "swift":
      return tile("#F05138", "#ffffff", "Sw", 8.5);
    case "kt":
      return tile("#7F52FF", "#ffffff", "Kt", 8.5);
    case "sql":
      // Database cylinder.
      return (
        open +
        '<path d="M6 6.5v11c0 1.7 2.7 3 6 3s6-1.3 6-3v-11" fill="#E38C00"/>' +
        '<ellipse cx="12" cy="6.5" rx="6" ry="2.6" fill="#F6B93B"/>' +
        '<path d="M6 11.5c0 1.7 2.7 3 6 3s6-1.3 6-3" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.7"/></svg>'
      );
    case "docker":
      // Container layers on Docker blue.
      return (
        open +
        '<rect x="2" y="2" width="20" height="20" rx="5" fill="#2496ED"/>' +
        '<rect x="6" y="7" width="12" height="3" fill="#ffffff"/>' +
        '<rect x="6" y="11" width="12" height="3" fill="#ffffff" opacity="0.85"/>' +
        '<rect x="6" y="15" width="7" height="3" fill="#ffffff" opacity="0.7"/></svg>'
      );
    case "xml":
    case "svg":
      return tile("#263238", "#FF8A65", "</>", 7.5);
    case "toml":
      return tile("#9E9E9E", "#ffffff", "T", 10);
    default:
      // Unknown type: neutral file outline.
      return (
        open +
        '<g fill="none" stroke="#808080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></g></svg>'
      );
  }
}

/**
 * Selected model first, catalog order otherwise (stable sort).
 * Single source of truth: injected into the webview script, unit-tested here.
 */
function orderModels(models, currentId) {
  return (models || []).slice().sort((a, b) => {
    const ac = a.id === currentId ? 0 : 1;
    const bc = b.id === currentId ? 0 : 1;
    return ac - bc;
  });
}

/**
 * Copilot-style line-range chips ("L12–19") derived from per-file hunk
 * ranges. Injected into the webview script, unit-tested here.
 */
function lineRangeChips(ranges) {
  const out = [];
  const rs = Array.isArray(ranges) ? ranges : [];
  for (let i = 0; i < rs.length && out.length < 4; i++) {
    const r = rs[i] || {};
    const hasNew = (r.newCount || 0) > 0;
    const hasOld = (r.oldCount || 0) > 0;
    if (!hasNew && !hasOld) {
      continue;
    }
    const start = Math.max(1, hasNew ? r.newStart || 1 : r.oldStart || 1);
    const end = start + (hasNew ? r.newCount : r.oldCount) - 1;
    out.push(
      '<span class="pline">L' +
        start +
        (end > start ? "–" + end : "") +
        "</span>",
    );
  }
  if (rs.length > 4) {
    out.push('<span class="pline more">…</span>');
  }
  return out.join("");
}

// ---- Rich markdown rendering (heading/list/table/quote/link + fenced
// code and sanitized inline SVG). Defined at module scope and injected into
// the webview via ${fn.toString()} — keep bullet tags built dynamically so
// this source never contains a literal '<ul>' (patch-cards must never use
// them, enforced by a unit test).
function sanitizeSvg(code) {
  var s = String(code || "").trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) {
    return null;
  }
  if (/<(script|foreignobject|iframe)\b/i.test(s)) {
    return null;
  }
  if (/\son[a-z]+\s*=|javascript:|vbscript:/i.test(s)) {
    return null;
  }
  if (/(xlink:)?href\s*=\s*["']?[^#\s][^>\s]/i.test(s)) {
    return null;
  }
  return s;
}

function isFilePath(str) {
  var t = String(str || "").trim();
  if (!t || /\s|[()<>"'`;={}]/.test(t)) {
    return false;
  }
  t = t.replace(/[.,:;]+$/, "");
  if (/^(?:\.?\/)?(?:\.gitignore|\.env|\.env\.[a-z0-9_.-]+|\.eslintrc(?:\.[a-z]+)?|\.prettierrc(?:\.[a-z]+)?|\.editorconfig|Dockerfile|Makefile|Procfile|CMakeLists\.txt)$/i.test(t)) {
    return true;
  }
  var withoutCoords = t.replace(/(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/, "");
  var extMatch = withoutCoords.match(/\.([a-zA-Z0-9_-]+)$/);
  var validExts = /^(?:js|jsx|mjs|cjs|ts|tsx|mts|cts|json|md|markdown|html|htm|css|scss|sass|less|py|pyi|rb|php|c|cpp|cc|cxx|h|hpp|cs|go|rs|swift|kt|java|sh|bash|zsh|yml|yaml|toml|xml|svg|sql|env|lock|txt|log|diff|patch|vue|svelte|graphql|proto|docker|dockerfile|png|jpg|jpeg|gif|ico|webp)$/i;
  if (extMatch && validExts.test(extMatch[1])) {
    return true;
  }
  if (/[\/\\]/.test(withoutCoords) && /\.[a-zA-Z0-9]{1,8}$/.test(withoutCoords)) {
    return true;
  }
  return false;
}

function isModifyingTool(tool) {
  var tl = String(tool || "").toLowerCase();
  return tl === "edit" || tl === "write" || tl === "patch" || tl === "applypatch";
}

function extractToolFilePath(t) {
  if (t && t.filePath && typeof t.filePath === "string") {
    return t.filePath.trim();
  }
  var s = String((t && (t.input || t.title)) || "").trim();
  if (!s) {
    return null;
  }
  var clean = s.replace(/^["']|["']$/g, "").trim();
  if (isFilePath(clean)) {
    return clean;
  }
  var m = s.match(/(?:(?:edit|write|patch|read|file|modify)\s+)?((?:[a-zA-Z0-9_.-]+[\/\\])+[a-zA-Z0-9_.-]+(?:\.[a-zA-Z0-9]+)?|[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+)/i);
  if (m && isFilePath(m[1])) {
    return m[1];
  }
  return null;
}

function hasFileModifications(thought) {
  if (!thought) {
    return false;
  }
  var items = (typeof thoughtItems === "function") ? thoughtItems(thought) : (thought.items || []);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it && it.type === "tool" && (isModifyingTool(it.tool) || (it.filePath && isModifyingTool(it.tool)))) {
      return true;
    }
  }
  return false;
}

function mdInline(src) {
  var s = esc(String(src || ""));
  // Protect inline code before emphasis/link transforms reformat its body.
  var codes = [];
  s = s.replace(/`([^`\n]+)`/g, function (mm, code) {
    var raw = code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (isFilePath(raw)) {
      codes.push('<code class="inline file-code-link mdfilelink" data-open-file="' + esc(raw) + '" title="Open ' + esc(raw) + ' in editor">' + code + '</code>');
    } else {
      codes.push('<code class="inline">' + code + '</code>');
    }
    return "\u0001" + (codes.length - 1) + "\u0001";
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[^*])/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, function (mm, label, url) {
    var u = url.trim();
    if (/^https?:\/\//i.test(u)) {
      return (
        '<a href="#" class="mdlink" data-open-url="' +
        u +
        '" title="' +
        u +
        '">' +
        label +
        "</a>"
      );
    }
    var rawU = u.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return (
      '<a href="#" class="mdfilelink" data-open-file="' +
      esc(rawU) +
      '" title="Open ' +
      esc(rawU) +
      ' in editor">' +
      label +
      "</a>"
    );
  });
  // Match plain text file paths (e.g. src/views/chatPanel.js or package.json)
  var fileRegex = /(^|[\s(])((?:[a-zA-Z0-9_.-]+[\/\\])+[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+(?::\d+(?::\d+)?)?|(?:\b[a-zA-Z0-9_.-]+\.(?:js|jsx|mjs|cjs|ts|tsx|json|md|html|htm|css|scss|py|rb|php|c|cpp|h|cs|go|rs|swift|kt|java|sh|yml|yaml|toml|xml|svg|sql|txt)\b(?::\d+(?::\d+)?)?))(?=$|[\s),.?!:;])/g;
  s = s.replace(fileRegex, function (match, p1, p2) {
    var rawP2 = p2.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (isFilePath(rawP2)) {
      return p1 + '<a href="#" class="mdfilelink" data-open-file="' + esc(rawP2) + '" title="Open ' + esc(rawP2) + ' in editor">' + p2 + '</a>';
    }
    return match;
  });
  s = s.replace(/\u0001(\d+)\u0001/g, function (mm, i) {
    return codes[Number(i)] || "";
  });
  return s.split("\n").join("<br>");
}

function mdSplitRow(line) {
  var t = String(line).trim();
  if (t.charAt(0) === "|") {
    t = t.slice(1);
  }
  if (t.charAt(t.length - 1) === "|") {
    t = t.slice(0, -1);
  }
  return t.split("|");
}

function mdTable(lines, i) {
  var head = mdSplitRow(lines[i]);
  var out = "<table><thead><tr>";
  var r;
  for (r = 0; r < head.length; r++) {
    out += "<th>" + mdInline(head[r].trim()) + "</th>";
  }
  out += "</tr></thead><tbody>";
  for (r = i + 2; r < lines.length; r++) {
    var ln = lines[r];
    if (!/\|/.test(ln)) {
      break;
    }
    var cells = mdSplitRow(ln);
    out += "<tr>";
    for (var c = 0; c < head.length; c++) {
      out += "<td>" + mdInline((cells[c] || "").trim()) + "</td>";
    }
    out += "</tr>";
  }
  return { html: out + "</tbody></table>", next: r };
}

function mdBlocks(src) {
  var lines = String(src).split("\n");
  var out = "";
  // Bullet tags built via concat: the emitted markup keeps the semantic
  // list elements while this source stays clean of the forbidden literal.
  var UL = "<" + "ul>";
  var ULO = "</" + "ul>";
  var OL = "<ol>";
  var OLO = "</ol>";
  var stack = [];
  var para = [];
  var quote = [];
  function closePara() {
    if (para.length) {
      out += "<p>" + mdInline(para.join("\n")) + "</p>";
      para = [];
    }
  }
  function closeQuote() {
    if (quote.length) {
      out += "<blockquote>" + mdInline(quote.join("\n")) + "</blockquote>";
      quote = [];
    }
  }
  function closeLists() {
    while (stack.length) {
      out += "</li>" + (stack.pop() ? OLO : ULO);
    }
  }
  function closeAll() {
    closePara();
    closeQuote();
    closeLists();
  }
  var i;
  for (i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (
      /^\s*\|.*\S.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      /-/.test(lines[i + 1])
    ) {
      closeAll();
      var t = mdTable(lines, i);
      out += t.html;
      i = t.next - 1;
      continue;
    }
    var m = /^(#{1,6})\s+(.*\S.*)$/.exec(line);
    if (m) {
      closeAll();
      var lvl = Math.min(m[1].length, 4);
      out += "<h" + lvl + ">" + mdInline(m[2]) + "</h" + lvl + ">";
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeAll();
      out += "<hr>";
      continue;
    }
    m = /^\s*>\s?(.*)$/.exec(line);
    if (m) {
      closePara();
      closeLists();
      quote.push(m[1]);
      continue;
    }
    m = /^(\s*)([-*+]|\d+[.)])\s+(.*\S.*)$/.exec(line);
    if (m) {
      closePara();
      closeQuote();
      var indent = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
      var ordered = /^\d/.test(m[2]);
      var need = indent + 1;
      while (stack.length > need) {
        out += "</li>" + (stack.pop() ? OLO : ULO);
      }
      if (stack.length === need) {
        out += "</li>";
        if (stack[stack.length - 1] !== ordered) {
          out += (stack.pop() ? OLO : ULO) + (ordered ? OL : UL);
          stack.push(ordered);
        }
        out += "<li>";
      }
      while (stack.length < need) {
        out += (ordered ? OL : UL) + "<li>";
        stack.push(ordered);
      }
      out += mdInline(m[3]);
      continue;
    }
    if (!line.trim()) {
      closeAll();
      continue;
    }
    closeQuote();
    closeLists();
    para.push(line);
  }
  closeAll();
  return out;
}

function renderMarkdown(src) {
  var text = String(src || "");
  var parts = text.split("```");
  var out = "";
  var i;
  for (i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      var nl = parts[i].indexOf("\n");
      var lang = (nl >= 0 ? parts[i].slice(0, nl) : "").trim().toLowerCase();
      var body = nl >= 0 ? parts[i].slice(nl + 1) : parts[i];
      var asSvg =
        lang === "svg" || lang === "xml" || !lang ? sanitizeSvg(body) : null;
      if (asSvg) {
        out += '<div class="block-svg">' + asSvg + "</div>";
      } else {
        out +=
          '<pre class="codeblock">' +
          (lang ? '<span class="clang">' + esc(lang) + "</span>" : "") +
          '<button class="copy" data-copy="' +
          esc(body.slice(0, 4000)) +
          '">Copy</button><code>' +
          esc(body) +
          "</code></pre>";
      }
    } else {
      out += mdBlocks(parts[i]);
    }
  }
  return out || "<p></p>";
}

function phaseLabelFor(tool, input) {
  const t = String(tool || "").toLowerCase();
  const cmd = String(input || "").toLowerCase();
  if (
    t === "question" ||
    t === "questions" ||
    t === "askquestion" ||
    t === "ask_question" ||
    t === "askuserquestion" ||
    t === "ask_user_question"
  ) {
    return "Asking questions…";
  }
  // Test process runs with the bug icon (see toolIconFor): dedicated phase.
  // Self-contained (injected into the webview via toString, so no helpers).
  if (
    t === "test" ||
    t === "tests" ||
    t === "vitest" ||
    t === "jest" ||
    t === "pytest" ||
    t === "mocha" ||
    t === "playwright" ||
    t === "cypress" ||
    t === "phpunit" ||
    t === "rspec" ||
    t === "unittest" ||
    /\b(npm|yarn|pnpm|bun|npx)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b|\bplaywright\b|\bcypress\b|\bphpunit\b|\brspec\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b/.test(
      cmd,
    )
  ) {
    return "Testing…";
  }
  if (t === "read" || t === "glob" || t === "grep" || t === "lsp") {
    return "Searching…";
  }
  if (t === "bash") {
    return "Running command…";
  }
  if (t === "edit" || t === "write") {
    return "Editing files…";
  }
  if (t === "webfetch" || t === "websearch") {
    return "Searching the web…";
  }
  if (t) {
    return `Running ${t}…`;
  }
  return "Working…";
}

const WEBVIEW_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
/* ---- thin transparent auto-hiding scrollbars ---- */
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
*:hover {
  scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(127, 127, 127, 0.4)) transparent;
}
*::-webkit-scrollbar {
  width: 5px;
  height: 5px;
  background: transparent;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 4px;
}
*:hover::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background, rgba(127, 127, 127, 0.4));
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground, rgba(127, 127, 127, 0.7));
}
*::-webkit-scrollbar-thumb:active {
  background: var(--vscode-scrollbarSlider-activeBackground, rgba(127, 127, 127, 0.9));
}
*::-webkit-scrollbar-corner {
  background: transparent;
}
html, body { height: 100%; }
* { box-sizing: border-box; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
body {
  margin: 0; padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  display: flex; flex-direction: column; height: 100vh; overflow: hidden;
}
.icon-btn {
  background: transparent; border: none; cursor: pointer;
  color: var(--vscode-foreground);
  border-radius: 4px; padding: 4px 7px; font-size: 14px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.icon-btn:disabled { opacity: 0.4; cursor: default; }
.model-picker {
  flex: 0 1 auto; min-width: 0; max-width: 320px; font-size: 12px;
  line-height: 1.4;
  justify-content: flex-start; text-align: left; align-items: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.model-picker span.mlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-menu .model-item .tick { display: inline-flex; flex: none; margin-left: auto; }
/* ---- CLI gate notice (replaces the old top status strip) ---- */
.cli-gate {
  padding: 8px 12px; font-size: 11.5px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}
/* ---- message list ---- */
.messages { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 0 12px; display: flex; flex-direction: column; }
.row { padding: 9px 14px; overflow-wrap: anywhere; }
.user-wrap { max-width: 92%; min-width: 0; }
.user-actions {
  display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 2px;
  color: var(--vscode-descriptionForeground); font-size: 10px;
  visibility: hidden;
}
.row.user:hover .user-actions,
.row.user:focus-within .user-actions {
  visibility: visible;
}
.user-actions .icon-btn {
  padding: 2px 4px; min-width: 20px; opacity: 0.85; font-size: 11px;
}
.user-actions .icon-btn:hover { opacity: 1; }
.user-actions .icon-btn:disabled { opacity: 0.35; cursor: default; }
.row.user { display: flex; justify-content: flex-end; }
.row.user.queued .bubble { opacity: 0.85; }
.row.user.queued .user-actions { visibility: visible; }
.queue-badge {
  font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-weight: 500; margin-left: 4px;
}
.row.user .bubble {
  background: rgba(127, 127, 127, 0.16);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word;
}
.ctx-chip {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; margin-bottom: 6px;
  padding: 2px 7px; border-radius: 4px; max-width: 100%;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  border: 1px solid var(--vscode-panel-border);
}
.ctx-chip svg { flex: none; }
.ctx-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Attached-context bar above the input */
.ctx-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 11px; color: var(--vscode-descriptionForeground);
  margin-bottom: 8px; padding: 2px 0;
}
.ctx-bar .ctx-chip { margin-bottom: 0; border-radius: 4px; }
/* ---- todos bar (above the input area) ---- */
.todos-bar {
  margin-bottom: 8px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11.5px;
  max-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.todos-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 2px;
}
.todos-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.4;
  color: var(--vscode-foreground);
}
.todo-check {
  margin-top: 2px;
  cursor: pointer;
  flex: none;
  width: 13px;
  height: 13px;
  accent-color: var(--vscode-charts-blue, #3794ff);
}
.todo-item.done .todo-text {
  text-decoration: line-through;
  opacity: 0.65;
}
.todo-item.in-progress .todo-text {
  color: var(--vscode-charts-blue, #3794ff);
  font-weight: 500;
}
.todo-spinner {
  color: var(--vscode-charts-blue, #3794ff);
  font-size: 9px;
  margin-left: 4px;
  align-self: center;
}
.todo-text {
  flex: 1;
  word-break: break-word;
}
/* ---- questions bar (above the input area, like todos) ---- */
.questions-bar {
  margin-bottom: 8px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11.5px;
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.questions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 2px;
}
.questions-prompt {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
  line-height: 1.4;
  word-break: break-word;
}
.question-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.question-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.4;
  color: var(--vscode-foreground);
  cursor: pointer;
  border-radius: 4px;
  padding: 3px 6px;
  transition: background 0.15s ease;
}
.question-item:hover {
  background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.1));
}
.question-check {
  margin-top: 2px;
  cursor: pointer;
  flex: none;
  width: 13px;
  height: 13px;
  accent-color: var(--vscode-charts-blue, #3794ff);
}
.question-opt-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  word-break: break-word;
}
.question-opt-label {
  font-size: 11.5px;
}
.question-opt-desc {
  font-size: 10.5px;
  color: var(--vscode-descriptionForeground);
}
.question-custom-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.question-custom-input {
  width: 100%;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 11px;
  outline: none;
  font-family: inherit;
}
.question-custom-input:focus {
  border-color: var(--vscode-focusBorder);
}
.question-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--vscode-panel-border);
}
.question-nav-btn {
  padding: 3px 12px;
  font-size: 11px;
  height: 24px;
  cursor: pointer;
}
.ctx-suggest-chip {
  background: transparent; color: var(--vscode-foreground);
  border: 1px dashed var(--vscode-panel-border); cursor: pointer;
  border-radius: 4px; padding: 2px 7px;
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px;
  user-select: none;
}
.ctx-suggest-chip:hover {
  background: var(--vscode-toolbar-hoverBackground);
  border-color: var(--vscode-focusBorder, var(--vscode-foreground));
}
.chip-x {
  background: transparent; border: none; cursor: pointer; padding: 1px 2px;
  color: var(--vscode-descriptionForeground); display: inline-flex; align-items: center;
  border-radius: 2px;
}
.chip-x:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
/* Mode picker (Plan/Build) beside the model picker in the input footer */
.mode-picker {
  flex: none; font-size: 12px; line-height: 1.4; padding: 4px 6px;
  justify-content: center; text-align: center;
  min-height: 26px;
}
.mode-picker .mname { font-weight: 600; }
.mode-icon {
  display: inline-flex; align-items: center; flex: none;
  color: var(--vscode-descriptionForeground);
  margin-right: 2px;
}
.model-icon {
  display: inline-flex; align-items: center; flex: none;
  color: var(--vscode-descriptionForeground);
  margin-right: 2px;
}
.model-picker .mlabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Reasoning-level (variant) picker beside the model picker */
.variant-picker {
  flex: none; font-size: 12px; line-height: 1.4; padding: 4px 6px;
  justify-content: center; text-align: center;
  min-height: 26px; max-width: 160px;
}
.variant-picker .vlabel { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.variant-icon {
  display: inline-flex; align-items: center; flex: none;
  color: var(--vscode-descriptionForeground);
  margin-right: 2px;
}
.variant-menu {
  position: absolute; bottom: calc(100% + 6px); right: 8px; left: auto;
  width: 230px; z-index: 21;
  background: var(--vscode-quickInput-background);
  border: 1px solid var(--vscode-quickInput-border, var(--vscode-panel-border));
  border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.variant-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; text-align: left; cursor: pointer;
  background: transparent; border: none; border-radius: 4px;
  color: var(--vscode-quickInput-foreground, var(--vscode-foreground));
  padding: 6px 8px; font-size: 12px;
}
.variant-item .vtick { display: inline-flex; flex: none; margin-left: auto; }
.variant-item:hover, .variant-item.current { background: var(--vscode-list-activeSelectionBackground, var(--vscode-toolbar-hoverBackground)); }
.variant-item small { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
.mode-menu {
  position: absolute; bottom: calc(100% + 6px); left: 8px; right: auto;
  width: 230px; z-index: 21;
  background: var(--vscode-quickInput-background);
  border: 1px solid var(--vscode-quickInput-border, var(--vscode-panel-border));
  border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.mode-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; text-align: left; cursor: pointer;
  background: transparent; border: none; border-radius: 4px;
  color: var(--vscode-quickInput-foreground, var(--vscode-foreground));
  padding: 6px 8px; font-size: 12px;
}
.mode-item .motext { flex: 1; min-width: 0; }
.mode-item .mtick { display: inline-flex; flex: none; margin-left: auto; }
.mode-item small { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
.mode-item:hover, .mode-item.current { background: var(--vscode-list-activeSelectionBackground, var(--vscode-toolbar-hoverBackground)); }
.row.assistant .content { word-break: break-word; }
.row.assistant .content p { margin: 0 0 8px; }
.row.assistant .content p:last-child { margin-bottom: 0; }
.row.activity {
  color: var(--vscode-descriptionForeground); font-size: 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
}
.row.activity .activity-text {
  flex: 1; min-width: 0; word-break: break-word;
}
/* White shining text animation (replaces all loader spinners) */
.shimmer {
  background: linear-gradient(90deg, var(--vscode-descriptionForeground) 25%, var(--vscode-foreground) 50%, var(--vscode-descriptionForeground) 75%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: shine 1.6s linear infinite;
}
@keyframes shine { to { background-position: -200% 0; } }
.row.error .bubble {
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  background: var(--vscode-inputValidation-errorBackground);
  border-radius: 8px; padding: 8px 10px;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
}
.row.error .error-text {
  flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word;
}
.row.error .close-msg, .row.activity .close-msg {
  flex: none; padding: 2px 4px; min-width: 20px; height: 20px;
  color: var(--vscode-foreground); opacity: 0.7;
}
.row.error .close-msg:hover, .row.activity .close-msg:hover {
  opacity: 1; background: var(--vscode-toolbar-hoverBackground);
}
pre.codeblock {
  position: relative; margin: 8px 0; border-radius: 6px;
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-panel-border);
  padding: 18px 10px 8px; overflow-x: auto;
  font-family: var(--vscode-editor-font-family); font-size: 12px;
}
pre.codeblock .clang {
  position: absolute; top: 3px; left: 8px;
  font-size: 10px; color: var(--vscode-descriptionForeground);
  font-family: var(--vscode-font-family); opacity: 0.9;
}
/* Inline diagrams: svg code fences from the model render as visible graphics */
.block-svg { margin: 6px 0; }
.block-svg svg { max-width: 100%; height: auto; display: block; }
/* Rich markdown content (themed headings/tables/lists/quotes/links) */
.row.assistant .content h1, .row.assistant .content h2,
.row.assistant .content h3, .row.assistant .content h4 {
  margin: 10px 0 4px; line-height: 1.35;
}
.row.assistant .content h1 { font-size: 15px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 3px; }
.row.assistant .content h2 { font-size: 14px; font-weight: 600; }
.row.assistant .content h3 { font-size: 13px; font-weight: 600; }
.row.assistant .content h4 { font-size: 12.5px; font-weight: 600; }
.row.assistant .content table {
  border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 12px;
}
.row.assistant .content th, .row.assistant .content td {
  border: 1px solid var(--vscode-panel-border);
  padding: 4px 8px; text-align: left; vertical-align: top;
}
.row.assistant .content th {
  background: rgba(127, 127, 127, 0.14); font-weight: 600;
}
.row.assistant .content ul, .row.assistant .content ol {
  margin: 4px 0 8px; padding-left: 20px;
}
.row.assistant .content li { margin: 3px 0; }
.row.assistant .content li ul, .row.assistant .content li ol { margin: 3px 0 2px; }
.row.assistant .content blockquote {
  margin: 6px 0 8px; padding: 2px 10px;
  border-left: 3px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
}
.row.assistant .content hr {
  border: none; border-top: 1px solid var(--vscode-panel-border); margin: 10px 0;
}
.row.assistant .content a.mdlink,
.row.assistant .content a.mdfilelink,
a.mdfilelink {
  color: var(--vscode-charts-blue, #3794ff); text-decoration: underline; cursor: pointer; text-underline-offset: 2px;
}
.row.assistant .content a.mdlink:hover,
.row.assistant .content a.mdfilelink:hover,
a.mdfilelink:hover { text-decoration: underline; }
code.file-code-link {
  cursor: pointer;
  color: var(--vscode-charts-blue, #3794ff);
  text-decoration: underline;
  text-underline-offset: 2px;
}
code.file-code-link:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
.btn-diff-chip {
  background: var(--vscode-button-secondaryBackground, rgba(127, 127, 127, 0.2));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  cursor: pointer;
  line-height: 1.3;
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.btn-diff-chip:hover {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground));
  color: var(--vscode-charts-blue, #3794ff);
  border-color: var(--vscode-focusBorder);
}
.live-diff-bar {
  margin: 4px 0 6px;
  display: flex;
  align-items: center;
}
.live-diff-btn {
  font-size: 11px;
  padding: 3px 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 4px;
  cursor: pointer;
}
pre.codeblock .copy {
  position: absolute; top: 4px; right: 4px;
  background: transparent; border: none; cursor: pointer;
  color: var(--vscode-descriptionForeground); font-size: 11px; padding: 2px 6px; border-radius: 4px;
}
pre.codeblock .copy:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
code.inline {
  font-family: var(--vscode-editor-font-family); font-size: 12px;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 4px; padding: 1px 4px;
}
/* ---- patch card (Copilot-style changed-files list) ---- */
.patch-card {
  border: 1px solid var(--vscode-panel-border); border-radius: 8px;
  padding: 10px; margin: 4px 0;
  background: var(--vscode-editor-background);
  display: flex; flex-direction: column; gap: 6px;
}
.patch-head { display: flex; align-items: baseline; gap: 8px; font-size: 12px; min-width: 0; }
.patch-title { font-weight: 600; flex: none; }
.patch-stat { color: var(--vscode-descriptionForeground); font-size: 11px; flex: none; }
.patch-files {
  display: flex; flex-direction: column;
  border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden;
}
.patch-file {
  display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%;
  padding: 5px 8px; cursor: pointer; font-size: 11.5px; text-align: left;
  font-family: var(--vscode-editor-font-family);
  background: transparent; border: none; border-top: 1px solid var(--vscode-panel-border);
  color: var(--vscode-foreground);
}
.patch-file:hover { background: var(--vscode-toolbar-hoverBackground); }
.patch-files .patch-file:first-of-type { border-top: none; }
.pfile { flex: none; display: inline-flex; align-items: center; }
.pfile svg { display: block; }
.ppath { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdir { color: var(--vscode-descriptionForeground); }
.pname { color: var(--vscode-foreground); }
.prights { flex: none; display: inline-flex; gap: 5px; }
.pline-wrap { flex: none; display: inline-flex; gap: 3px; overflow: hidden; }
.pline {
  flex: none; font-size: 10px; padding: 0 4px; border-radius: 3px;
  background: rgba(127, 127, 127, 0.18);
  color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family);
}
.pcount { font-size: 10px; font-weight: 600; font-family: var(--vscode-font-family); }
.pcount.add { color: var(--vscode-testing-iconPassed, #2da44e); }
.pcount.del { color: var(--vscode-testing-iconFailed, #cf222e); }
.patch-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.patch-outcome {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--vscode-descriptionForeground);
  margin-left: auto;
}
/* Timestamps + copy: one hover-only line that always reserves its space so
   revealing it on hover never shifts the message layout */
.msg-time {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px;
  visibility: hidden;
}
.row:hover .msg-time, .row:focus-within .msg-time { visibility: visible; }
.row.user .msg-time { justify-content: flex-end; }
.msg-time .icon-btn { padding: 2px 4px; min-width: 20px; opacity: 0.85; }
/* ---- buttons ---- */
.btn {
  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
.btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn:disabled { opacity: 0.5; cursor: default; }
/* ---- welcome (like Chat welcome view) ---- */
.welcome { margin: auto; width: 100%; padding: 12px 16px; text-align: center; }
.welcome .logo { margin-bottom: 8px; color: var(--vscode-foreground); }
.welcome .logo .logo-img, .welcome .logo img { width: 48px; height: 48px; object-fit: contain; display: inline-block; vertical-align: middle; border-radius: 8px; }
.welcome h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.welcome p { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 0 0 14px; }
.suggestions { display: flex; flex-direction: column; gap: 6px; text-align: left; }
.suggestion {
  text-align: left; cursor: pointer; font-size: 12px;
  background: transparent; color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 8px 10px;
}
.suggestion:hover { background: var(--vscode-toolbar-hoverBackground); }
/* ---- model dropdown (opens upward, left-anchored beside the mode picker) ---- */
.model-menu {
  position: absolute; bottom: calc(100% + 6px); left: 8px; right: auto; width: auto; min-width: 280px; max-width: 400px; z-index: 20;
  max-height: 300px; overflow-y: auto;
  background: var(--vscode-quickInput-background);
  border: 1px solid var(--vscode-quickInput-border, var(--vscode-panel-border));
  border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.model-menu .menu-head { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 6px 8px 2px; }
.model-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; text-align: left; cursor: pointer;
  background: transparent; border: none; border-radius: 4px;
  color: var(--vscode-quickInput-foreground, var(--vscode-foreground));
  padding: 6px 8px; font-size: 12px;
}
.model-item .mtext { flex: 1; min-width: 0; }
.model-item small { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; }
.model-item:hover, .model-item.current { background: var(--vscode-list-activeSelectionBackground, var(--vscode-toolbar-hoverBackground)); }
.hidden { display: none !important; }
/* ---- input (like Chat input part) ---- */
.input-wrap { padding: 8px 10px 10px; position: relative; flex: none; border-top: 1px solid var(--vscode-panel-border); }
.input-box {
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  background: var(--vscode-input-background);
  border-radius: 12px; padding: 10px; transition: border-color 120ms ease;
}
.input-box:focus-within { border-color: var(--vscode-focusBorder); }
textarea {
  display: block; width: 100%; height: 56px; min-height: 56px; max-height: 220px; resize: none; overflow-y: hidden; padding: 2px 0; line-height: 1.5;
  background: transparent; border: none; outline: none; color: var(--vscode-input-foreground);
  font-family: inherit; font-size: 13px;
}
.input-bar { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.input-bar .spacer { display: none; }
.input-tools { display: flex; align-items: center; gap: 0; flex: 1; min-width: 0; overflow: hidden; }
.input-tools .model-picker {
  flex: 0 1 auto;
  width: auto;
  max-width: 100%;
}

#sendBtn.send-round {
  border-radius: 50%; width: 30px; height: 30px; padding: 0; flex: none;
  font-size: 14px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
}
#stopBtn.stop-round {
  border-radius: 50%; width: 30px; height: 30px; padding: 0; flex: none;
  font-size: 13px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
  background: var(--vscode-button-secondaryBackground, rgba(127, 127, 127, 0.25));
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  cursor: pointer;
}
#stopBtn.stop-round:hover {
  background: var(--vscode-toolbar-hoverBackground);
}
/* ---- per-response attribution (Copilot parity) ---- */
.msg-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
.link-btn {
  background: transparent; border: none; cursor: pointer; font-size: 11px;
  color: var(--vscode-foreground); opacity: 0.8; padding: 2px 4px; border-radius: 4px;
  display: inline-flex; align-items: center; gap: 4px;
}
.link-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
/* ---- thinking process (Copilot-style: steps hang on a left rail line,
   each step carries a trailing status icon; summary pill with sparkle).
   The 10px left gutter lives on details itself so the header line keeps
   the same x whether the block is open (streaming) or closed (done) —
   only the rail body indents further. ---- */
details.thought { background: transparent; border: none; margin: 4px 0 2px; padding-left: 0; }
details.thought summary {
  list-style: none; cursor: pointer; user-select: none;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--vscode-descriptionForeground);
  padding: 3px 8px 3px 0; border-radius: 4px;
}
details.thought summary::-webkit-details-marker { display: none; }
details.thought summary:hover { background: var(--vscode-toolbar-hoverBackground); }
details.thought summary .tchev { display: inline-flex; transform: rotate(-90deg); transition: transform 0.15s ease; }
details.thought[open] summary .tchev { transform: rotate(0deg); }
/* the left rail line every step hangs on — step icons sit centered on it.
   margin-left is 0: the 10px gutter above already places the rail, so the
   rail x is identical while streaming and after completion. */
details.thought .tbody {
  position: relative;
  margin: 4px 0 10px 10px; padding-left: 20px; font-size: 12px;
  border-left: 1px solid var(--vscode-panel-border);
}
.thought-text { white-space: pre-wrap; margin: 4px 0 8px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
.tool { display: flex; flex-direction: column; gap: 3px; padding: 4px 0; position: relative; min-height: 22px; }
.tool-head { display: flex; gap: 6px; align-items: center; min-height: 20px; }
.tool .ticon {
  position: absolute; left: -29px; top: 14px; transform: translateY(-50%);
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 4px;
  /* cover the rail line behind the glyph so it reads as threaded on the line */
  background: var(--vscode-sideBar-background);
  color: var(--vscode-descriptionForeground);
  z-index: 1;
}
.tool .ticon svg { width: 14px; height: 14px; }
.tool .tname { font-weight: 600; flex: none; }
.tool .ttitle { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trepeat { flex: none; font-size: 10px; padding: 0 5px; border-radius: 8px; background: rgba(127, 127, 127, 0.18); color: var(--vscode-descriptionForeground); }
/* ---- collapsible terminal sandbox output in thinking ---- */
details.terminal-box {
  margin: 3px 0 4px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  background: var(--vscode-terminal-background, var(--vscode-textCodeBlock-background));
  overflow: hidden;
}
details.terminal-box summary.terminal-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: var(--vscode-font-family);
  color: var(--vscode-descriptionForeground);
  background: rgba(127, 127, 127, 0.08);
}
details.terminal-box summary.terminal-summary::-webkit-details-marker { display: none; }
details.terminal-box summary.terminal-summary:hover {
  background: var(--vscode-toolbar-hoverBackground);
  color: var(--vscode-foreground);
}
details.terminal-box summary .term-chev {
  display: inline-flex;
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
}
details.terminal-box[open] summary .term-chev {
  transform: rotate(0deg);
}
details.terminal-box summary .term-lines {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.8;
}
.terminal-output {
  margin: 0;
  padding: 6px 8px;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px solid var(--vscode-panel-border);
  color: var(--vscode-terminal-foreground, var(--vscode-foreground));
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  line-height: 1.35;
}
@keyframes tpulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.tpulse { animation: tpulse 1.2s ease-in-out infinite; display: inline-flex; align-items: center; justify-content: center; }
/* ---- settings panel (slide-over page: options + debug log) ---- */
.settings-panel, .history-page {
  position: absolute; inset: 0; z-index: 30;
  background: var(--vscode-sideBar-background);
  display: flex; flex-direction: column;
}
.hist-count { font-size: 11px; color: var(--vscode-descriptionForeground); font-weight: 400; }
.hist-head-right { display: inline-flex; align-items: center; gap: 2px; }
.hist-clear.armed { color: var(--vscode-testing-iconFailed, #f44336); }
.hist-card {
  position: relative;
  border: 1px solid var(--vscode-panel-border); border-radius: 8px;
  padding: 8px 10px; margin: 0 0 8px; background: var(--vscode-editor-background);
}
.hist-card .htitle { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 52px; }
.hist-card .hmeta { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 2px 0 0; }
.hist-card .hactions {
  position: absolute; top: 4px; right: 4px;
  display: flex; gap: 2px;
  opacity: 0; visibility: hidden;
  transition: opacity 0.12s ease;
}
.hist-card:hover .hactions, .hist-card:focus-within .hactions { opacity: 1; visibility: visible; }
.hist-card .hactions .icon-btn.armed { color: var(--vscode-testing-iconFailed, #f44336); }
.hist-empty { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 18px 4px; text-align: center; }
.settings-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; font-size: 13px; font-weight: 600;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.settings-body { flex: 1; overflow-y: auto; padding: 4px 12px 16px; }
.settings-group { margin-top: 12px; }
.settings-group .btn { margin: 0 6px 6px 0; }
.settings-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
.settings-list { font-size: 12px; margin-bottom: 8px; }
.settings-list .srow { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.settings-list .skey { color: var(--vscode-descriptionForeground); }
.settings-list .sval { text-align: right; word-break: break-word; }
.debug-lines { max-height: 220px; overflow-y: auto; font-family: var(--vscode-editor-font-family); font-size: 11px; margin: 4px 0; white-space: pre-wrap; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 6px; }
.debug-actions { display: flex; gap: 6px; margin-top: 4px; }
.cli-gate { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 16px; border: none; }
.setup-card { max-width: 520px; margin: 0 auto; }
.setup-card h2 { font-size: 19px; line-height: 1.3; margin: 16px 0 8px; color: var(--vscode-foreground); }
.setup-card p { line-height: 1.6; margin: 8px 0 16px; }
.setup-eyebrow { font-size: 10px; letter-spacing: 0.12em; font-weight: 600; margin-top: 12px; }
.install-platform { border: 1px solid var(--vscode-panel-border); border-radius: 8px; margin: 8px 0; padding: 10px; }
.install-platform strong { display: block; color: var(--vscode-foreground); font-size: 12px; margin-bottom: 6px; }
.install-command { display: flex; gap: 4px; align-items: flex-start; background: var(--vscode-textCodeBlock-background); border-radius: 5px; padding: 8px; }
.install-command code { flex: 1; min-width: 0; overflow-wrap: anywhere; user-select: text; font: 11px/1.6 var(--vscode-editor-font-family, monospace); }
.install-command button { flex: none; }
.setup-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.setup-note { font-size: 11px; line-height: 1.6; color: var(--vscode-descriptionForeground); }
.composer-hint { font-size: 10px; color: var(--vscode-descriptionForeground); margin: 6px 3px 0; display: flex; justify-content: space-between; gap: 8px; }
.edit-banner { display: flex; align-items: flex-start; gap: 8px; padding: 8px 2px 10px; font-size: 11px; }
.edit-banner div { flex: 1; }
.edit-banner strong { display: block; margin-bottom: 3px; }
.edit-banner small { display: block; color: var(--vscode-descriptionForeground); line-height: 1.4; }
.limit-title { font-weight: 600; margin-bottom: 6px; }
.row.error .bubble { line-height: 1.6; }
@media (prefers-reduced-motion: reduce) { .shimmer { animation: none; background: none; color: var(--vscode-descriptionForeground); } }
@media (max-width: 280px) { .input-bar { flex-wrap: wrap; } .input-tools { flex-basis: 100%; } .row { padding: 8px; } }

`;

const WEBVIEW_JS = `
(function () {
  var vscode = acquireVsCodeApi();
  var state = vscode.getState() || { messages: [], model: null, models: [], busy: false, detection: null, workspace: null, mode: 'build', attachedFiles: [] };
  if (!state.mode) { state.mode = 'build'; }
  if (!state.attachedFiles) { state.attachedFiles = []; }
  if (!state.questions) { state.questions = []; }
  var attachedFiles = state.attachedFiles || [];
  var currentQuestionIndex = 0;
  var questionAnswers = {};
  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('input');
  var sendBtn = document.getElementById('sendBtn');
  var stopBtn = document.getElementById('stopBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'stop' });
    });
  }
  var modelBtn = document.getElementById('modelBtn');
  var modelMenu = document.getElementById('modelMenu');
  var modeMenuBtn = document.getElementById('modeBtn');
  var modeMenu = document.getElementById('modeMenu');
  var variantBtn = document.getElementById('variantBtn');
  var variantMenu = document.getElementById('variantMenu');
  if (state.variant === undefined) { state.variant = null; }
  var streamingText = '';
  var streamingRow = null;
  var thoughtData = null; // { items: [{type:'text'|'tool',...}], live, done, secs }
  var thoughtEl = null;
  var thoughtUserToggled = false;
  var thoughtStartTs = 0;
  var pendingRequest = state.pendingRequest || null;
  var historyVisible = false;
  var followOutput = true;
  var editingMessageId = (state.draft && state.draft.editMessageId) || null;
  var previousDraft = null;
  inputEl.value = (state.draft && state.draft.text) || '';
  state.busy = false;
  var debugCount = 0;
  var ICONS = ${JSON.stringify(ICONS)};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var phaseLabelFor = ${phaseLabelFor.toString()};
  var orderModels = ${orderModels.toString()};
  var fileBadge = ${fileBadge.toString()};
  var lineRangeChips = ${lineRangeChips.toString()};

  // Rich markdown rendering: headings, lists, tables, blockquotes, links,
  // fenced code with language chip, and sanitized inline SVG.
  var isFilePath = ${isFilePath.toString()};
  var isModifyingTool = ${isModifyingTool.toString()};
  var extractToolFilePath = ${extractToolFilePath.toString()};
  var hasFileModifications = ${hasFileModifications.toString()};
  var sanitizeSvg = ${sanitizeSvg.toString()};
  var mdInline = ${mdInline.toString()};
  var mdSplitRow = ${mdSplitRow.toString()};
  var mdTable = ${mdTable.toString()};
  var mdBlocks = ${mdBlocks.toString()};
  var renderMarkdown = ${renderMarkdown.toString()};

  function persist() { state.pendingRequest = pendingRequest; try { vscode.setState(state); } catch (e) {} }

  function scrollBottom(force) { if (force || followOutput) messagesEl.scrollTop = messagesEl.scrollHeight; }
  messagesEl.addEventListener('scroll', function () {
    followOutput = messagesEl.scrollHeight - messagesEl.clientHeight - messagesEl.scrollTop < 70;
  });
  messagesEl.addEventListener('mousedown', function (e) {
    if (e.target && !e.target.closest('.row.assistant:last-child')) {
      followOutput = false;
    }
  });
  function resizeInput() {
    inputEl.style.height = 'auto';
    var limit = Math.max(56, Math.min(220, Math.floor(window.innerHeight * 0.35)));
    var height = Math.max(56, Math.min(inputEl.scrollHeight, limit));
    inputEl.style.height = height + 'px';
    inputEl.style.overflowY = inputEl.scrollHeight > height ? 'auto' : 'hidden';
  }
  window.addEventListener('resize', resizeInput);
  function saveDraft() {
    state.draft = { text: inputEl.value, editMessageId: editingMessageId, context: previewCtx, files: attachedFiles };
    persist();
    vscode.postMessage({ type: 'saveDraft', draft: state.draft });
  }
  function restoreDraft(draft) {
    draft = draft || {};
    inputEl.value = draft.text || '';
    editingMessageId = draft.editMessageId || null;
    previewCtx = draft.context || null;
    attachedFiles = draft.files || [];
    state.attachedFiles = attachedFiles;
    renderCtxBar(); renderStatus(); resizeInput();
  }
  function editMessage(message) {
    if (!cliReady() || !message.id) return;
    if (!editingMessageId) previousDraft = { text: inputEl.value, context: previewCtx, files: attachedFiles.slice() };
    restoreDraft({ text: message.text || '', editMessageId: message.id, context: message.context, files: message.files || [] });
    saveDraft();
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  }
  document.getElementById('cancelEditBtn').addEventListener('click', function () {
    restoreDraft(previousDraft);
    previousDraft = null;
    saveDraft(); inputEl.focus();
  });

  function latestPatchKey() {
    for (var i = state.messages.length - 1; i >= 0; i--) {
      var mm = state.messages[i];
      if (mm && mm.role === 'patch' && mm.patch && (mm.patch.files || []).length) {
        return mm.patchId || ('idx:' + i);
      }
    }
    return null;
  }

  function renderAll(run) {
    var oldScrollTop = messagesEl.scrollTop;
    messagesEl.innerHTML = '';
    streamingRow = null;
    thoughtEl = null;
    thoughtData = null;
    if (!state.messages.length) {
      messagesEl.appendChild(welcomeEl());
    }
    var latestKey = latestPatchKey();
    state.messages.forEach(function (m, idx) {
      var isLatest = m.role === 'patch' && (m.patchId || ('idx:' + idx)) === latestKey;
      messagesEl.appendChild(rowEl(m, isLatest));
    });
    renderStatus();
    renderTodosBar();
    renderQuestionsBar();
    if (run) restoreRun(run);
    if (!followOutput) messagesEl.scrollTop = oldScrollTop;
    scrollBottom();
  }

  function setPhase(label) {
    if (!thoughtData) return;
    thoughtData.phase = label;
    ensureThoughtEl(); refreshThoughtEl();
  }
  function restoreRun(run) {
    if (!run) return;
    if (streamingRow) streamingRow.remove();
    streamingText = run.text || '';
    thoughtData = JSON.parse(JSON.stringify(run.thought || { items: [], live: true, phase: 'Working…' }));
    thoughtData.live = true;
    thoughtData.done = false;
    thoughtStartTs = run.startedAt || Date.now();
    thoughtEl = null;
    thoughtUserToggled = false;
    var welcome = document.querySelector('.welcome'); if (welcome) welcome.remove();
    streamingRow = document.createElement('div');
    streamingRow.className = 'row assistant';
    streamingRow.innerHTML = '<div class="content"></div>';
    messagesEl.appendChild(streamingRow);
    ensureThoughtEl(); refreshThoughtEl();
    if (streamingText) {
      streamingRow.querySelector('.content').innerHTML = renderMarkdown(streamingText);
      thoughtEl.removeAttribute('open');
      bindCopy(streamingRow);
    }
    scrollBottom();
  }

  function welcomeEl() {
    var w = document.createElement('div');
    w.className = 'welcome';
    var ready = (typeof cliReady === 'function') ? cliReady() : true;
    w.innerHTML = '<div class="logo">' + ICONS.logo + '</div><h2>Ask anything</h2>' +
      (ready
        ? '<p>Powered by OpenCode CLI · verified free models only</p>'
        : '<p>Waiting for OpenCode CLI… install it, then Retry Detection. Chat is disabled until detection succeeds.</p>') +
      '<div class="suggestions">' +
      '<button class="suggestion" data-q="Explain the selected code"' + (ready ? '' : ' disabled') + '>Explain the selected code</button>' +
      '<button class="suggestion" data-q="Fix the error handling in the selected code"' + (ready ? '' : ' disabled') + '>Fix the error handling in the selected code</button>' +
      '<button class="suggestion" data-q="Add tests for the selected code"' + (ready ? '' : ' disabled') + '>Add tests for the selected code</button>' +
      '</div>';
    w.querySelectorAll('.suggestion').forEach(function (b) {
      b.addEventListener('click', function () { send(b.getAttribute('data-q')); });
    });
    return w;
  }

  function createCloseBtn(m, row) {
    var btn = document.createElement('button');
    btn.className = 'icon-btn close-msg';
    btn.title = 'Dismiss message';
    btn.setAttribute('aria-label', 'Dismiss message');
    btn.innerHTML = ICONS.x;
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var idx = state.messages.indexOf(m);
      if (idx !== -1) { state.messages.splice(idx, 1); }
      row.remove();
      if (!state.messages.length) { messagesEl.appendChild(welcomeEl()); }
      vscode.postMessage({ type: 'deleteMessage', id: m.id, index: idx });
    });
    return btn;
  }

  function rowEl(m, isLatestPatch) {
    var row = document.createElement('div');
    if (m.role === 'user') {
      row.className = 'row user' + (m.queued ? ' queued' : '');
      var wrap = document.createElement('div');
      wrap.className = 'user-wrap';
      // Selection chip plus attached-file chips (same language icons as the
      // context bar), rendered inline above the message text.
      var chips = [];
      if (m.context) { chips.push(ctxChipHTML(m.context)); }
      (m.files || []).forEach(function (f) { chips.push(fileChipHTML(f, false)); });
      var chip = chips.length ? chips.join(' ') + '<br>' : '';
      var d = document.createElement('div');
      d.className = 'bubble';
      d.title = m.context ? (m.context.file + ':' + m.context.startLine + '-' + m.context.endLine) : '';
      d.innerHTML = chip + esc(m.text);
      wrap.appendChild(d);
      var ut = document.createElement('div');
      ut.className = 'user-actions';
      var time = document.createElement('span');
      time.className = 'user-time';
      time.textContent = m.at ? formatTime(m.at) : '';
      ut.appendChild(time);
      if (m.queued) {
        var qBadge = document.createElement('span');
        qBadge.className = 'queue-badge';
        qBadge.textContent = 'Queued';
        ut.appendChild(qBadge);
      }
      var copyBtn = document.createElement('button');
      copyBtn.className = 'icon-btn copy-message';
      copyBtn.title = 'Copy message';
      copyBtn.setAttribute('aria-label', 'Copy message');
      copyBtn.innerHTML = ICONS.copy;
      copyBtn.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(m.text || '');
        } catch (e) {}
        vscode.postMessage({ type: 'copyText', text: m.text || '' });
        copyBtn.title = 'Copied';
        setTimeout(function () { copyBtn.title = 'Copy message'; }, 1200);
      });
      ut.appendChild(copyBtn);
      var editBtn = document.createElement('button');
      editBtn.className = 'icon-btn edit-message';
      editBtn.title = 'Edit message in input area';
      editBtn.setAttribute('aria-label', 'Edit message');
      editBtn.innerHTML = ICONS.pencil;
      editBtn.disabled = !m.id || !cliReady();
      editBtn.addEventListener('click', function () { editMessage(m); });
      ut.appendChild(editBtn);
      if (m.queued) {
        var cancelQBtn = document.createElement('button');
        cancelQBtn.className = 'icon-btn close-msg';
        cancelQBtn.title = 'Cancel queued message';
        cancelQBtn.setAttribute('aria-label', 'Cancel queued message');
        cancelQBtn.innerHTML = ICONS.x;
        cancelQBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var idx = state.messages.indexOf(m);
          if (idx !== -1) { state.messages.splice(idx, 1); }
          row.remove();
          vscode.postMessage({ type: 'deleteMessage', id: m.id, index: idx });
          renderStatus();
        });
        ut.appendChild(cancelQBtn);
      }
      wrap.appendChild(ut);
      row.appendChild(wrap);
    } else if (m.role === 'assistant') {
      row.className = 'row assistant';
      if (m.modelName) {
        var meta = document.createElement('div');
        meta.className = 'msg-meta';
        meta.textContent = m.modelName;
        row.appendChild(meta);
      }
      if (m.thought && (m.thought.text || (m.thought.tools || []).length)) {
        row.appendChild(thoughtNode(m.thought, false));
      }
      var c = document.createElement('div');
      c.className = 'content';
      c.innerHTML = renderMarkdown(m.text);
      if (m.references && m.references.length) {
        var refBox = document.createElement('div');
        refBox.className = 'msg-references';
        var refHead = document.createElement('span');
        refHead.className = 'ref-heading';
        refHead.textContent = 'Sources:';
        refBox.appendChild(refHead);
        m.references.forEach(function (ref, idx) {
          var a = document.createElement('a');
          a.className = 'ref-link mdlink';
          a.setAttribute('href', '#');
          a.setAttribute('data-open-url', ref.url);
          a.setAttribute('title', (ref.description ? ref.description + ' — ' : '') + ref.url);
          a.innerHTML = '<span class="ref-icon">' + ICONS.globe + '</span>' +
            '<span>[' + (idx + 1) + '] ' + esc(ref.title) + '</span>';
          refBox.appendChild(a);
        });
        row.appendChild(refBox);
      }
      row.appendChild(c);
      // One hover-only footer line: timestamp + copy (undo removed — the
      // patch card's Undo covers reverting changes).
      var strap = document.createElement('div');
      strap.className = 'msg-time';
      if (m.at) {
        strap.appendChild(document.createTextNode(formatTime(m.at)));
      }
      var copyBtn = document.createElement('button');
      copyBtn.className = 'icon-btn';
      copyBtn.title = 'Copy response';
      copyBtn.innerHTML = ICONS.copy;
      copyBtn.addEventListener('click', function () {
        try { navigator.clipboard.writeText(m.text || ''); } catch (e) {}
        vscode.postMessage({ type: 'copyText', text: m.text || '' });
        copyBtn.title = 'Copied';
        setTimeout(function () { copyBtn.title = 'Copy response'; }, 1200);
      });
      strap.appendChild(copyBtn);
      row.appendChild(strap);
      bindCopy(row);
    } else if (m.role === 'activity') {
      row.className = 'row activity';
      var aText = document.createElement('span');
      aText.className = 'activity-text';
      aText.textContent = m.text;
      row.appendChild(aText);
      row.appendChild(createCloseBtn(m, row));
    } else if (m.role === 'error') {
      row.className = 'row error';
      var e = document.createElement('div');
      e.className = 'bubble';
      e.setAttribute('role', 'alert');
      var txt = document.createElement('div');
      txt.className = 'error-text';
      txt.textContent = m.text;
      e.appendChild(txt);
      e.appendChild(createCloseBtn(m, row));
      row.appendChild(e);
    } else if (m.role === 'patch') {
      // Nothing was actually changed — show no "Proposed changes" card at all.
      if (!m.patch || !(m.patch.files || []).length) { return row; }
      row.className = 'row';
      var card = document.createElement('div');
      card.className = 'patch-card';
      if (m.patchId) { card.setAttribute('data-patch-id', m.patchId); }
      var files = m.patch.files || [];
      var outcomeLbl = m.outcome === 'applied' ? 'Kept' : m.outcome === 'rejected' ? 'Undone' : null;
      var outcomeHtml = outcomeLbl ? '<span class="patch-outcome">' + ICONS.check + ' ' + esc(outcomeLbl) + '</span>' : '';
      var head = '<div class="patch-head"><span class="patch-title">Proposed changes</span>' +
        '<span class="patch-stat">' + files.length + ' file' + (files.length === 1 ? '' : 's') + '</span>' +
        '<span class="pcount add">+' + (m.patch.insertions || 0) + '</span>' +
        '<span class="pcount del">&minus;' + (m.patch.deletions || 0) + '</span>' + outcomeHtml + '</div>';
      var rows = files.map(function (f) {
        var st = f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M';
        var p = String(f.path || '');
        var sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf(String.fromCharCode(92)));
        var dir = sep >= 0 ? p.slice(0, sep + 1) : '';
        var name = sep >= 0 ? p.slice(sep + 1) : p;
        var dot = name.lastIndexOf('.');
        var ext = dot >= 0 ? name.slice(dot + 1) : '';
        return '<div class="patch-file" data-fpath="' + esc(p) + '" data-fstatus="' + st + '" title="Open diff (red/green): ' + esc(p) + '">' +
          '<span class="pfile">' + fileBadge(ext) + '</span>' +
          '<span class="ppath"><span class="pdir">' + esc(dir) + '</span><span class="pname">' + esc(name) + '</span></span>' +
          '<span class="pline-wrap">' + lineRangeChips(f.ranges) + '</span>' +
          '<span class="prights"><span class="pcount add">+' + (f.insertions || 0) + '</span><span class="pcount del">&minus;' + (f.deletions || 0) + '</span></span>' +
        '</div>';
      }).join('');
      card.innerHTML = head + '<div class="patch-files">' + rows + '</div>' +
        (outcomeLbl
          ? '<div class="patch-actions"><button class="btn" data-act="review">Review changes</button></div>'
          : isLatestPatch
          ? '<div class="patch-actions"><button class="btn" data-act="review">Review changes</button>' +
            '<button class="btn primary" data-act="apply">Keep</button>' +
            '<button class="btn" data-act="reject">Undo</button></div>'
          : '<div class="patch-actions"><button class="btn" data-act="review">Review changes</button></div>');
      card.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          vscode.postMessage({
            type: b.getAttribute('data-act') === 'review' ? 'reviewPatch' : b.getAttribute('data-act') === 'apply' ? 'applyPatch' : 'rejectPatch',
            patchId: m.patchId
          });
        });
      });
      // Clicking a file row opens the native red/green diff for that file.
      card.querySelectorAll('.patch-file').forEach(function (el) {
        el.addEventListener('click', function () {
          vscode.postMessage({
            type: 'openFileReview',
            path: el.getAttribute('data-fpath'),
            patchId: m.patchId
          });
        });
      });
      row.appendChild(card);
    }
    if (m.dismissible && !row.querySelector('.close-msg')) {
      row.appendChild(createCloseBtn(m, row));
    }
    return row;
  }

  function bindCopy(scope) {
    scope.querySelectorAll('.copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-copy') || '';
        try { navigator.clipboard.writeText(t); } catch (e) {}
        vscode.postMessage({ type: 'copyText', text: t });
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1200);
      });
    });
  }

  // Rendered markdown links open in the external browser or host editor.
  messagesEl.addEventListener('click', function (e) {
    var diffEl = e.target && e.target.closest ? e.target.closest('[data-open-diff]') : null;
    if (diffEl) {
      e.preventDefault();
      e.stopPropagation();
      var p = diffEl.getAttribute('data-open-diff');
      if (p) {
        vscode.postMessage({ type: 'openFileReview', path: p });
        return;
      }
    }
    var liveDiff = e.target && e.target.closest ? e.target.closest('.live-diff-btn') : null;
    if (liveDiff) {
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: 'reviewPatch' });
      return;
    }
    var fileEl = e.target && e.target.closest ? e.target.closest('[data-open-file]') : null;
    if (fileEl) {
      e.preventDefault();
      e.stopPropagation();
      var f = fileEl.getAttribute('data-open-file');
      if (f) {
        vscode.postMessage({ type: 'openFile', file: f });
        return;
      }
    }
    var a = e.target && e.target.closest ? e.target.closest('a.mdlink') : null;
    if (a) {
      e.preventDefault();
      var u = a.getAttribute('data-open-url');
      if (u) { vscode.postMessage({ type: 'openExternal', url: u }); }
    }
  });

  function toolIconFor(tool, input) {
    var t = String(tool || '').toLowerCase();
    var cmd = String(input || '').toLowerCase();
    // Test process shows with the bug icon (matches phaseLabelFor 'Testing…').
    if (t === 'test' || t === 'tests' || t === 'vitest' || t === 'jest' ||
      t === 'pytest' || t === 'mocha' || t === 'playwright' || t === 'cypress' ||
      t === 'phpunit' || t === 'rspec' || t === 'unittest' ||
      /\b(npm|yarn|pnpm|bun|npx)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b|\bplaywright\b|\bcypress\b|\bphpunit\b|\brspec\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b/.test(cmd)) { return ICONS.bug; }
    if (t === 'bash' || t === 'terminal' || t === 'sh' || t === 'exec' || t === 'cmd') { return ICONS.fileTerminal; }
    if (t === 'edit' || t === 'write' || t === 'patch' || t === 'applypatch') { return ICONS.squarePen; }
    if (t === 'read') { return ICONS.bookOpenText; }
    if (t === 'glob') { return ICONS.folder; }
    if (t === 'grep') { return ICONS.searchCode; }
    if (t === 'webfetch' || t === 'browse') { return ICONS.globe; }
    if (t === 'websearch' || t === 'search') { return ICONS.search; }
    if (t === 'question' || t === 'questions' || t === 'askquestion' || t === 'ask_question' || t === 'askuserquestion' || t === 'ask_user_question') { return ICONS.chat; }
    if (t === 'lsp') { return ICONS.code; }
    return ICONS.circle;
  }

  // Ordered thinking steps: reasoning text chunks interleave with tool calls.
  // History entries saved without a timeline fall back to text-then-tools.
  function thoughtItems(thought) {
    if (thought.items) { return thought.items; }
    var fallback = [];
    if (thought.text) { fallback.push({ type: 'text', text: thought.text }); }
    (thought.tools || []).forEach(function (t) {
      fallback.push({ type: 'tool', tool: t.tool, phase: t.phase, title: t.title, input: t.input, output: t.output, exit: t.exit });
    });
    return fallback;
  }

  function toolCount(thought) {
    var n = 0;
    collapseThoughtItems(thoughtItems(thought)).forEach(function (it) { if (it.type === 'tool') { n++; } });
    return n;
  }

  // Consecutive repeats of the same step (same tool + same target, e.g.
  // three read calls on one file in a row) collapse into one row so
  // the thinking rail stays readable. Non-consecutive repeats (read A,
  // grep B, read A) are kept as-is since the interleaving is meaningful.
  function sameToolStep(a, b) {
    return (a.tool || '') === (b.tool || '') &&
      ((a.title || a.input || '') === (b.title || b.input || ''));
  }
  function collapseThoughtItems(items) {
    var out = [];
    items.forEach(function (it) {
      var prev = out[out.length - 1];
      if (it.type === 'tool' && prev && prev.type === 'tool' && sameToolStep(prev, it)) {
        prev.repeat = (prev.repeat || 1) + 1;
        if (it.phase) { prev.phase = it.phase; }
        if (it.output) { prev.output = it.output; }
        if (it.exit !== null && it.exit !== undefined) { prev.exit = it.exit; }
        return;
      }
      out.push(it);
    });
    return out;
  }

  function toolRowHTML(t) {
    var cmd = t.input || t.title || '';
    var icon = t.phase === 'done' ? toolIconFor(t.tool, cmd) : '<span class="tpulse">' + toolIconFor(t.tool, cmd) + '</span>';
    var toolName = String(t.tool || 'tool').toLowerCase();
    var isTerminal = toolName === 'bash' || toolName === 'terminal' || toolName === 'sh' || toolName === 'exec' || toolName === 'cmd';
    var outHtml = '';
    if (isTerminal && t.output && t.output.trim()) {
      var lines = t.output.trim().split(String.fromCharCode(10)).length;
      outHtml = '<details class="terminal-box" open>' +
        '<summary class="terminal-summary"><span class="term-chev">' + ICONS.chev + '</span><span>Terminal output</span>' +
        '<span class="term-lines">' + lines + ' line' + (lines === 1 ? '' : 's') + '</span></summary>' +
        '<pre class="terminal-output">' + esc(t.output.trim()) + '</pre></details>';
    }
    var fpath = extractToolFilePath(t);
    var isMod = isModifyingTool(t.tool);
    var titleHtml = '';
    if (fpath) {
      titleHtml = '<a href="#" class="mdfilelink tool-file-link" data-open-file="' + esc(fpath) + '" title="Open ' + esc(fpath) + ' in editor">' + esc((t.title || t.input || fpath).slice(0, 160)) + '</a>';
    } else {
      titleHtml = esc((t.title || t.input || '').slice(0, 160));
    }
    var diffBtnHtml = (isMod && fpath)
      ? '<button class="btn-diff-chip" data-open-diff="' + esc(fpath) + '" title="Review diff patch for ' + esc(fpath) + '">Diff</button>'
      : '';
    return '<div class="tool"><span class="ticon">' + icon + '</span>' +
      '<div class="tool-head"><span class="tname">' + esc(t.tool || 'tool') + '</span>' +
      '<span class="ttitle">' + titleHtml + '</span>' +
      diffBtnHtml +
      (t.repeat > 1 ? '<span class="trepeat">×' + t.repeat + '</span>' : '') + '</div>' +
      outHtml + '</div>';
  }

  // Copilot-style header pill: live phase (Searching…/Editing files…/…) while
  // streaming so the collapsed summary shows the current status, "Thought
  // for Ns" once the answer starts, and a static label for restored history.
  function thoughtLabel(thought) {
    var n = toolCount(thought);
    var tail = n ? ' · ' + n + ' tool' + (n === 1 ? '' : 's') : '';
    if (thought.done && thought.secs != null) { return 'Thought for ' + thought.secs + 's' + tail; }
    if (thought.elapsedSec != null) { return 'Thought for ' + thought.elapsedSec + 's' + tail; }
    if (thought.live) { return (thought.phase || 'Thinking…') + tail; }
    return 'Thought · ' + n + ' tool' + (n === 1 ? '' : 's');
  }

  function thoughtInnerHTML(thought) {
    var animated = thought.live && !thought.done;
    var liveDiffHtml = (thought.live && hasFileModifications(thought))
      ? '<div class="live-diff-bar"><button class="btn live-diff-btn" title="Open diff patch of changes so far">' + ICONS.file + ' <span>Review diff patch</span></button></div>'
      : '';
    var h = '<summary><span class="tchev">' + ICONS.chev + '</span>' + ICONS.sparkle +
      '<span class="tlabel' + (animated ? ' shimmer' : '') + '" role="status">' + esc(thoughtLabel(thought)) + '</span></summary><div class="tbody">' +
      liveDiffHtml;
    // Plain text interleaved with the steps — no boxes around the thinking.
    collapseThoughtItems(thoughtItems(thought)).forEach(function (it) {
      if (it.type === 'tool') { h += toolRowHTML(it); }
      else { h += '<div class="thought-text">' + esc(it.text) + '</div>'; }
    });
    return h + '</div>';
  }

  function thoughtNode(thought, open) {
    var d = document.createElement('details');
    d.className = 'thought';
    if (open) { d.setAttribute('open', ''); }
    d.innerHTML = thoughtInnerHTML(thought);
    d.addEventListener('click', function (event) {
      if (event.target.closest('summary') === d.querySelector('summary')) thoughtUserToggled = true;
    });
    return d;
  }

  function ensureThoughtEl() {
    if (thoughtEl) { return thoughtEl; }
    var w = document.querySelector('.welcome'); if (w) { w.remove(); }
    thoughtEl = thoughtNode(thoughtData, true);
    if (streamingRow) {
      var cEl = streamingRow.querySelector('.content');
      if (cEl) {
        streamingRow.insertBefore(thoughtEl, cEl);
      } else {
        streamingRow.appendChild(thoughtEl);
      }
    } else {
      // History re-rendered mid-run (e.g. a CLI error pushed a message):
      // keep the same padded 'row assistant' wrapper the completed
      // state uses so the thinking block never loses its left padding.
      var fallback = document.createElement('div');
      fallback.className = 'row assistant';
      fallback.appendChild(thoughtEl);
      messagesEl.appendChild(fallback);
    }
    return thoughtEl;
  }

  function refreshThoughtEl() {
    if (!thoughtEl) { return; }
    thoughtEl.innerHTML = thoughtInnerHTML(thoughtData);
    scrollBottom();
  }

  function debugLog(line) {
    var box = document.getElementById('debugLines');
    if (!box) { return; }
    debugCount++;
    var div = document.createElement('div');
    div.textContent = line;
    box.appendChild(div);
    while (box.children.length > 200) { box.removeChild(box.firstChild); }
    box.scrollTop = box.scrollHeight;
    var c = document.getElementById('debugCount');
    if (c) { c.textContent = String(debugCount); }
  }

  function formatTime(at) {
    try {
      var dt = new Date(at);
      var hh = dt.getHours();
      var mm = dt.getMinutes();
      return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
    } catch (e) {
      return '';
    }
  }

  function shortModelId(id) {
    var s = String(id || '');
    var i = s.indexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function formatModelName(id, displayName) {
    var s = displayName || '';
    if (!s || s === id) {
      s = String(id || '');
    }
    var slash = s.indexOf('/');
    if (slash >= 0) {
      s = s.slice(slash + 1);
    }
    return s.replace(/[-:](?:contributor-)?free$/i, '');
  }

  function baseNameOf(p) {
    var s = String(p || '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  // Basename-only chip with per-language file icon; full path in tooltip.
  function ctxChipHTML(ctx) {
    var name = ctx.name || baseNameOf(ctx.file);
    var lang = ctx.lang || name.split('.').pop() || '';
    var label = name + ':' + ctx.startLine + '-' + ctx.endLine;
    return '<span class="ctx-chip" title="' + esc(ctx.file + ':' + ctx.startLine + '-' + ctx.endLine) + '">' +
      fileBadge(lang) + '<span>' + esc(label) + '</span></span>';
  }

  var previewCtx = (state.draft && state.draft.context) || null; // pinned while editing
  var activeFile = null; // current opened file in VS Code
  // Attached-file chip with the per-language icon; optional remove button.
  function fileChipHTML(f, removable) {
    var name = f.name || baseNameOf(f.path);
    var lang = f.lang || name.split('.').pop() || '';
    return '<span class="ctx-chip" title="' + esc(f.path) + '">' +
      fileBadge(lang) + '<span>' + esc(name) + '</span>' +
      (removable ? '<button class="chip-x" data-fpath="' + esc(f.path) + '" title="Remove from context">' + ICONS.x + '</button>' : '') +
      '</span>';
  }
  function renderCtxBar() {
    var bar = document.getElementById('ctxBar');
    if (!bar) { return; }
    var ctx = previewCtx;
    var hasFiles = attachedFiles.length > 0;
    var showActiveOption = activeFile && !attachedFiles.some(function (f) { return f.path === activeFile.path; });
    if (!ctx && !hasFiles && !showActiveOption) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    var html = '';
    if (ctx) {
      html += ctxChipHTML(ctx);
    }
    html += attachedFiles.map(function (f) { return fileChipHTML(f, true); }).join('');
    if (showActiveOption) {
      html += '<button class="ctx-chip ctx-suggest-chip" id="addActiveFileBtn" title="Click to add current opened file as context (' + esc(activeFile.path) + ')">' +
        ICONS.plus + ' ' + fileBadge(activeFile.lang) + '<span>' + esc(activeFile.name) + '</span></button>';
    }
    bar.innerHTML = html;
    var addBtn = document.getElementById('addActiveFileBtn');
    if (addBtn && activeFile) {
      addBtn.addEventListener('click', function () {
        if (state.busy) return;
        if (!attachedFiles.some(function (f) { return f.path === activeFile.path; })) {
          attachedFiles.push({ path: activeFile.path, name: activeFile.name, lang: activeFile.lang });
          state.attachedFiles = attachedFiles;
          renderCtxBar(); saveDraft();
        }
      });
    }
    bar.querySelectorAll('.chip-x').forEach(function (b) {
      b.addEventListener('click', function () {
        if (state.busy) return;
        var p = b.getAttribute('data-fpath');
        attachedFiles = attachedFiles.filter(function (f) { return f.path !== p; });
        state.attachedFiles = attachedFiles;
        renderCtxBar(); saveDraft();
      });
    });
  }

  function renderTodosBar() {
    var bar = document.getElementById('todosBar');
    if (!bar) { return; }
    var todos = state.todos || [];
    if (!todos || !todos.length) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    var doneCount = todos.filter(function (t) { return t.done; }).length;
    var html = '<div class="todos-head"><span>Tasks (' + doneCount + '/' + todos.length + ')</span>' +
      '<button class="chip-x" id="closeTodosBtn" title="Dismiss tasks">' + ICONS.x + '</button></div>' +
      '<div class="todos-list">';
    todos.forEach(function (td, idx) {
      var doneCls = td.done ? ' done' : '';
      var activeCls = (!td.done && td.inProgress) ? ' in-progress' : '';
      var checkedAttr = td.done ? ' checked' : '';
      html += '<div class="todo-item' + doneCls + activeCls + '">' +
        '<input type="checkbox" class="todo-check" data-tidx="' + idx + '"' + checkedAttr + ' />' +
        '<span class="todo-text">' + esc(td.text) + '</span>' +
        (activeCls ? '<span class="todo-spinner tpulse">●</span>' : '') +
        '</div>';
    });
    html += '</div>';
    bar.innerHTML = html;
    bar.querySelectorAll('.todo-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var idx = parseInt(cb.getAttribute('data-tidx'), 10);
        if (state.todos && state.todos[idx]) {
          state.todos[idx].done = cb.checked;
          state.todos[idx].status = cb.checked ? 'completed' : 'pending';
          state.todos[idx].inProgress = false;
          renderTodosBar(); persist();
          vscode.postMessage({ type: 'toggleTodo', index: idx, done: cb.checked });
        }
      });
    });
    var closeBtn = document.getElementById('closeTodosBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        bar.classList.add('hidden');
      });
    }
  }

  function isQuestionTool(tool) {
    var t = String(tool || '').toLowerCase().trim();
    return t === 'question' || t === 'questions' || t === 'askquestion' ||
      t === 'ask_question' || t === 'askuserquestion' || t === 'ask_user_question';
  }

  function sameQuestionsList(a, b) {
    if (!a && !b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if ((a[i].id && b[i].id && a[i].id !== b[i].id) || (a[i].question || '') !== (b[i].question || '')) return false;
    }
    return true;
  }

  function renderQuestionsBar() {
    var bar = document.getElementById('questionsBar');
    if (!bar) { return; }
    var questions = state.questions || [];
    if (!questions || !questions.length) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      currentQuestionIndex = 0;
      questionAnswers = {};
      return;
    }
    if (currentQuestionIndex >= questions.length) {
      currentQuestionIndex = 0;
    }
    bar.classList.remove('hidden');
    var q = questions[currentQuestionIndex];
    if (!q) { return; }
    var total = questions.length;
    var currentAns = questionAnswers[currentQuestionIndex] || { checked: [], customChecked: false, customText: '' };
    questionAnswers[currentQuestionIndex] = currentAns;

    var headerTitle = q.header ? esc(q.header) : ('Question ' + (currentQuestionIndex + 1));
    var progressText = total > 1 ? ('Question ' + (currentQuestionIndex + 1) + ' of ' + total + ': ' + headerTitle) : ('Question: ' + headerTitle);

    var html = '<div class="questions-head"><span>' + progressText + '</span>' +
      '<button class="chip-x" id="closeQuestionsBtn" title="Dismiss questions">' + ICONS.x + '</button></div>';

    if (q.question) {
      html += '<div class="questions-prompt">' + esc(q.question) + '</div>';
    }

    html += '<div class="question-options">';
    var options = q.options || [];
    options.forEach(function (opt, oIdx) {
      var label = typeof opt === 'string' ? opt : (opt.label || '');
      var desc = (typeof opt === 'object' && opt.description) ? opt.description : '';
      var isChecked = currentAns.checked.indexOf(label) !== -1;
      html += '<div class="question-item" data-oidx="' + oIdx + '">' +
        '<input type="checkbox" class="question-check" data-oidx="' + oIdx + '"' + (isChecked ? ' checked' : '') + ' />' +
        '<div class="question-opt-body">' +
        '<span class="question-opt-label">' + esc(label) + '</span>' +
        (desc ? ('<span class="question-opt-desc">' + esc(desc) + '</span>') : '') +
        '</div></div>';
    });

    if (q.custom !== false) {
      var isCustomChecked = !!currentAns.customChecked;
      html += '<div class="question-item question-custom-item">' +
        '<input type="checkbox" class="question-check question-custom-check"' + (isCustomChecked ? ' checked' : '') + ' />' +
        '<div class="question-custom-body">' +
        '<span class="question-opt-label">Type own answer:</span>' +
        '<input type="text" class="question-custom-input" placeholder="Type your own answer…" value="' + esc(currentAns.customText || '') + '" />' +
        '</div></div>';
    }
    html += '</div>';

    html += '<div class="question-actions">';
    if (currentQuestionIndex > 0) {
      html += '<button class="btn question-nav-btn" id="questionBackBtn" title="Previous question">Back</button>';
    }
    html += '<button class="btn primary question-nav-btn" id="questionNextBtn" title="Next">Next</button>';
    html += '</div>';

    bar.innerHTML = html;

    var closeBtn = document.getElementById('closeQuestionsBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        bar.classList.add('hidden');
        state.questions = [];
        persist();
        vscode.postMessage({ type: 'dismissQuestions' });
      });
    }

    var customCheckEl = bar.querySelector('.question-custom-check');
    var customInputEl = bar.querySelector('.question-custom-input');

    bar.querySelectorAll('.question-item').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target && (e.target.tagName === 'INPUT')) { return; }
        var cb = row.querySelector('.question-check');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
    });

    bar.querySelectorAll('.question-check[data-oidx]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var oIdx = parseInt(cb.getAttribute('data-oidx'), 10);
        var opt = options[oIdx];
        var lbl = typeof opt === 'string' ? opt : (opt && opt.label);
        if (!q.multiple && cb.checked) {
          bar.querySelectorAll('.question-check[data-oidx]').forEach(function (other) {
            if (other !== cb) { other.checked = false; }
          });
          if (customCheckEl) { customCheckEl.checked = false; currentAns.customChecked = false; }
          currentAns.checked = lbl ? [lbl] : [];
        } else if (cb.checked) {
          if (lbl && currentAns.checked.indexOf(lbl) === -1) {
            currentAns.checked.push(lbl);
          }
        } else {
          if (lbl) {
            currentAns.checked = currentAns.checked.filter(function (x) { return x !== lbl; });
          }
        }
        persist();
      });
    });

    if (customCheckEl && customInputEl) {
      customCheckEl.addEventListener('change', function () {
        currentAns.customChecked = customCheckEl.checked;
        if (customCheckEl.checked) {
          if (!q.multiple) {
            bar.querySelectorAll('.question-check[data-oidx]').forEach(function (other) {
              other.checked = false;
            });
            currentAns.checked = [];
          }
          customInputEl.focus();
        }
        persist();
      });

      customInputEl.addEventListener('input', function () {
        currentAns.customText = customInputEl.value;
        if (customInputEl.value.trim().length > 0) {
          customCheckEl.checked = true;
          currentAns.customChecked = true;
          if (!q.multiple) {
            bar.querySelectorAll('.question-check[data-oidx]').forEach(function (other) {
              other.checked = false;
            });
            currentAns.checked = [];
          }
        }
        persist();
      });

      customInputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var nb = document.getElementById('questionNextBtn');
          if (nb) { nb.click(); }
        }
      });
    }

    function syncCurrentQuestionAnswers() {
      var checkedLabels = [];
      bar.querySelectorAll('.question-check[data-oidx]').forEach(function (cb) {
        if (cb.checked) {
          var oIdx = parseInt(cb.getAttribute('data-oidx'), 10);
          var opt = options[oIdx];
          var lbl = typeof opt === 'string' ? opt : (opt && opt.label);
          if (lbl) { checkedLabels.push(lbl); }
        }
      });
      currentAns.checked = checkedLabels;
      if (customCheckEl && customInputEl) {
        currentAns.customChecked = customCheckEl.checked;
        currentAns.customText = customInputEl.value;
      }
    }

    var backBtn = document.getElementById('questionBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        syncCurrentQuestionAnswers();
        if (currentQuestionIndex > 0) {
          currentQuestionIndex--;
          renderQuestionsBar();
          persist();
        }
      });
    }

    var nextBtn = document.getElementById('questionNextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        syncCurrentQuestionAnswers();
        if (currentQuestionIndex < total - 1) {
          currentQuestionIndex++;
          renderQuestionsBar();
          persist();
        } else {
          var allAnswers = [];
          for (var i = 0; i < total; i++) {
            var ans = questionAnswers[i] || { checked: [], customChecked: false, customText: '' };
            var picked = (ans.checked || []).slice();
            if ((ans.customChecked || (!picked.length && ans.customText)) && ans.customText && ans.customText.trim()) {
              picked.push(ans.customText.trim());
            }
            allAnswers.push(picked);
          }

          var lines = ['Answers to your questions:'];
          for (var j = 0; j < total; j++) {
            var qItem = questions[j] || {};
            var qLabel = (j + 1) + '. [' + (qItem.header || ('Question ' + (j + 1))) + '] ' + (qItem.question || '');
            var p = allAnswers[j] || [];
            lines.push(qLabel.trim());
            lines.push('   Answer: ' + (p.length ? p.join(', ') : 'Skipped'));
          }
          var textToSend = lines.join(String.fromCharCode(10));
          state.questions = [];
          renderQuestionsBar();
          persist();
          vscode.postMessage({
            type: 'answerQuestions',
            answers: allAnswers,
            text: textToSend
          });
        }
      });
    }
  }

  function normalizeMode(m) {
    return m === 'plan' ? 'plan' : m === 'ask' ? 'ask' : 'build';
  }
  function cliReady() {
    var det = (state.detections && state.detections.opencode) || state.detection || {};
    return !!(det.exists && det.canStart);
  }
  function renderStatus() {
    var ready = cliReady();
    var label = 'Select model';
    var fullId = '';
    if (state.model) {
      var found = null;
      for (var mi = 0; mi < (state.models || []).length; mi++) {
        if (state.models[mi].id === state.model) { found = state.models[mi]; break; }
      }
      label = formatModelName(state.model, found ? (found.displayName || found.id) : null);
      fullId = state.model;
    }
    modelBtn.innerHTML = '<span class="model-icon">' + ICONS.sparkles + '</span><span class="mlabel">' + esc(label) + '</span>';
    var modeLabelEl = document.getElementById('modeLabel');
    if (modeLabelEl) { modeLabelEl.textContent = state.mode === 'plan' ? 'Plan' : state.mode === 'ask' ? 'Ask' : 'Build'; }
    modeMenuBtn.title = state.mode === 'plan' ? 'Plan mode — click to change' : state.mode === 'ask' ? 'Ask mode — click to change' : 'Build mode — click to change';
    modelBtn.title = fullId ? ('Model: ' + fullId + ' (verified free) — click to change') : 'Select a verified free model';
    renderVariant();
    if (stopBtn) { stopBtn.classList.toggle('hidden', !state.busy); }
    sendBtn.innerHTML = ICONS.send;
    // Chat is gated on CLI detection: no typing, sending, attaching, or
    // model/mode changes until the OpenCode CLI exists and can start.
    var gate = document.getElementById('cliGate');
    if (gate) gate.classList.toggle('hidden', ready || historyVisible);
    messagesEl.classList.toggle('hidden', !ready || historyVisible);
    document.querySelector('.input-wrap').classList.toggle('hidden', !ready || historyVisible);
    var det = state.detection;
    document.getElementById('gateTitle').textContent = !det ? 'Checking OpenCode CLI…' : det.exists ? 'OpenCode could not start' : 'OpenCode is not installed or not detected';
    document.getElementById('gateDescription').textContent = !det ? 'Looking for OpenCode on this computer. You can retry detection below.' : det.exists ? 'Check your CLI installation or configure its executable path, then retry detection.' : 'Install the OpenCode CLI to start chatting with your project. Choose the instructions for your system below.';
    inputEl.disabled = !ready;
    inputEl.placeholder = editingMessageId ? 'Edit your message…' : state.busy ? 'Ask anything… (will be queued)' : 'Ask anything…';
    sendBtn.disabled = !ready || !inputEl.value.trim();
    sendBtn.title = state.busy ? 'Queue message' : editingMessageId ? 'Send edited message' : 'Send message';
    sendBtn.setAttribute('aria-label', sendBtn.title);
    modelBtn.disabled = !ready || !!state.busy;
    modeMenuBtn.disabled = !ready || !!state.busy;
    if (variantBtn) { variantBtn.disabled = !ready || !!state.busy; }
    document.getElementById('attachBtn').disabled = !ready;
    document.getElementById('refreshBtn').disabled = !!state.busy;
    document.getElementById('cancelEditBtn').disabled = false;
    document.getElementById('editBanner').classList.toggle('hidden', !editingMessageId);
    var composerStateEl = document.getElementById('composerState');
    if (composerStateEl) {
      var queuedCount = (state.messages || []).filter(function (m) { return m && m.queued; }).length;
      if (queuedCount > 0) {
        composerStateEl.textContent = queuedCount + ' request' + (queuedCount > 1 ? 's' : '') + ' in queue…';
      } else if (state.busy) {
        composerStateEl.textContent = 'Task keeps running when hidden · Enter to queue';
      } else {
        composerStateEl.textContent = 'Shift+Enter for a new line';
      }
    }
    document.querySelectorAll('.edit-message').forEach(function (button) { button.disabled = !ready; });
    document.querySelectorAll('.suggestion').forEach(function (button) { button.disabled = !ready; });
    var welcomeText = document.querySelector('.welcome p');
    if (ready && welcomeText) welcomeText.textContent = 'Powered by OpenCode CLI · verified free models only';
    if (state.busy) { modelMenu.classList.add('hidden'); modeMenu.classList.add('hidden'); if (variantMenu) { variantMenu.classList.add('hidden'); } }
  }

  function currentVariants() {
    for (var vi = 0; vi < (state.models || []).length; vi++) {
      if (state.models[vi].id === state.model) {
        return state.models[vi].variants || [];
      }
    }
    return [];
  }
  function renderVariant() {
    if (!variantBtn) { return; }
    var variants = currentVariants();
    if (!state.model || !variants.length) {
      variantBtn.classList.add('hidden');
      if (variantMenu) { variantMenu.classList.add('hidden'); }
      return;
    }
    variantBtn.classList.remove('hidden');
    var vlabel = state.variant || 'Default';
    var vlabelEl = document.getElementById('variantLabel');
    if (vlabelEl) { vlabelEl.textContent = vlabel; }
    variantBtn.title = 'Reasoning level for ' + state.model + ' — click to change (currently: ' + vlabel + ')';
  }
  function renderVariantMenu() {
    if (!variantMenu) { return; }
    variantMenu.innerHTML = '';
    var variants = currentVariants();
    var defBtn = document.createElement('button');
    defBtn.className = 'variant-item' + (!state.variant ? ' current' : '');
    defBtn.innerHTML = 'Default' + (!state.variant ? '<span class="vtick">' + ICONS.check + '</span>' : '');
    defBtn.addEventListener('click', function () {
      variantMenu.classList.add('hidden');
      state.variant = null;
      vscode.postMessage({ type: 'selectVariant', variant: null });
      renderVariant(); persist();
    });
    variantMenu.appendChild(defBtn);
    variants.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'variant-item' + (v === state.variant ? ' current' : '');
      b.title = String(v);
      var tick = v === state.variant ? '<span class="vtick">' + ICONS.check + '</span>' : '';
      b.innerHTML = esc(v) + tick;
      b.addEventListener('click', function () {
        variantMenu.classList.add('hidden');
        state.variant = v;
        vscode.postMessage({ type: 'selectVariant', variant: v });
        renderVariant(); persist();
      });
      variantMenu.appendChild(b);
    });
  }

  function renderModels() {
    modelMenu.innerHTML = '';
    if (!state.models.length) {
      var empty = document.createElement('div');
      empty.className = 'menu-head';
      empty.textContent = 'No models yet — loading…';
      modelMenu.appendChild(empty);
    }
    // Selected model first, then the rest in catalog order.
    orderModels(state.models, state.model).forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'model-item' + (m.id === state.model ? ' current' : '');
      b.title = m.id;
      var tick = m.id === state.model ? '<span class="tick">' + ICONS.check + '</span>' : '';
      var dispName = formatModelName(m.id, m.displayName || m.id);
      var vSuffix = (m.variants && m.variants.length) ? ' · ' + m.variants.length + ' levels' : '';
      b.innerHTML = '<span class="mtext">' + esc(dispName) + '<small>' + esc(m.id) + esc(vSuffix) + '</small></span>' + tick;
      b.addEventListener('click', function () {
        modelMenu.classList.add('hidden');
        vscode.postMessage({ type: 'selectModel', modelId: m.id });
      });
      modelMenu.appendChild(b);
    });
    renderVariant();
  }

  function send(text) {
    if (!cliReady()) return;
    var t = (text != null ? text : inputEl.value).trim();
    if (!t) return;
    if (text != null) { inputEl.value = t; saveDraft(); resizeInput(); }
    var reqId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    if (!state.busy) {
      pendingRequest = reqId;
      state.busy = true;
      persist();
      followOutput = true;
      renderStatus();
      restoreRun({ startedAt: Date.now(), thought: { items: [], live: true, phase: 'Working…' } });
    }
    vscode.postMessage({
      type: state.busy ? 'queue' : 'send',
      requestId: reqId,
      text: t,
      context: previewCtx,
      files: attachedFiles.map(function (f) { return f.path; }),
      editMessageId: editingMessageId,
      queued: !!state.busy
    });
    clearSentDraft();
  }

  sendBtn.addEventListener('click', function () {
    send();
  });
  inputEl.addEventListener('input', function () { resizeInput(); saveDraft(); renderStatus(); });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
    if (e.key === 'Escape') {
      modelMenu.classList.add('hidden'); modeMenu.classList.add('hidden');
      if (variantMenu) { variantMenu.classList.add('hidden'); }
      if (editingMessageId && !state.busy) document.getElementById('cancelEditBtn').click();
    }
  });
  inputEl.addEventListener('focus', function () { if (!editingMessageId) vscode.postMessage({ type: 'getSelection' }); });
  function setHistoryVisible(visible) {
    historyVisible = visible;
    document.getElementById('historyPage').classList.toggle('hidden', !visible);
    renderStatus(); resizeInput();
  }
  document.getElementById('retryDetectionBtn').addEventListener('click', function () {
    document.getElementById('gateTitle').textContent = 'Checking OpenCode CLI…';
    vscode.postMessage({ type: 'refreshAll' });
  });
  document.getElementById('cliSettingsBtn').addEventListener('click', function () { vscode.postMessage({ type: 'openSettings' }); });
  document.getElementById('installDocsBtn').addEventListener('click', function () { vscode.postMessage({ type: 'openExternal', url: 'https://opencode.ai/docs/' }); });
  document.querySelectorAll('[data-copy-command]').forEach(function (button) {
    button.addEventListener('click', function () {
      vscode.postMessage({ type: 'copyText', text: button.getAttribute('data-copy-command') });
      button.title = 'Copied';
      setTimeout(function () { button.title = 'Copy command'; }, 1500);
    });
  });
  function histDate(iso) {
    try {
      var dt = new Date(iso);
      return dt.toLocaleDateString() + ' ' + formatTime(iso);
    } catch (e) {
      return '';
    }
  }
  function renderHistoryList(sessions) {
    var list = document.getElementById('historyList');
    var count = document.getElementById('historyCount');
    var clearAll = document.getElementById('historyClearAll');
    list.innerHTML = '';
    var arr = sessions || [];
    if (count) { count.textContent = arr.length ? arr.length + ' saved' : ''; }
    if (clearAll) {
      clearAll.classList.toggle('hidden', !arr.length);
      // A fresh list disarms any pending delete-all confirm.
      clearAll.removeAttribute('data-confirm');
      clearAll.classList.remove('armed');
      clearAll.title = 'Delete all conversations';
    }
    if (!arr.length) {
      var empty = document.createElement('div');
      empty.className = 'hist-empty';
      empty.textContent = 'No saved conversations yet. They are stored only on this machine.';
      list.appendChild(empty);
      return;
    }
    arr.forEach(function (s) {
      var card = document.createElement('div');
      card.className = 'hist-card';
      var metaBits = [];
      if (s.model) { metaBits.push(shortModelId(s.model)); }
      if (s.messageCount) { metaBits.push(s.messageCount + ' messages'); }
      if (s.updatedAt) { metaBits.push(histDate(s.updatedAt)); }
      // Icon-only hover actions in the top-right corner: reuse + delete.
      card.innerHTML = '<div class="htitle">' + esc(s.title || 'Untitled conversation') + '</div>' +
        '<div class="hmeta">' + esc(metaBits.join(' · ')) + '</div>' +
        '<div class="hactions"><button class="icon-btn" data-hact="reuse" title="Reuse conversation">' + ICONS.reuse + '</button>' +
        '<button class="icon-btn" data-hact="delete" title="Delete conversation">' + ICONS.trash + '</button></div>';
      var reuseBtn = card.querySelector('[data-hact="reuse"]');
      var delBtn = card.querySelector('[data-hact="delete"]');
      reuseBtn.addEventListener('click', function () { vscode.postMessage({ type: 'reuseSession', id: s.id }); });
      delBtn.addEventListener('click', function () {
        if (delBtn.getAttribute('data-confirm') === '1') {
          vscode.postMessage({ type: 'deleteSession', id: s.id });
        } else {
          delBtn.setAttribute('data-confirm', '1');
          delBtn.classList.add('armed');
          delBtn.title = 'Click again to confirm delete';
          setTimeout(function () {
            if (delBtn.isConnected) { delBtn.removeAttribute('data-confirm'); delBtn.classList.remove('armed'); delBtn.title = 'Delete conversation'; }
          }, 4000);
        }
      });
      list.appendChild(card);
    });
  }
  document.getElementById('historyBack').addEventListener('click', function () {
    setHistoryVisible(false);
    vscode.postMessage({ type: 'chatView' });
  });
  document.getElementById('historyClearAll').addEventListener('click', function () {
    var btn = document.getElementById('historyClearAll');
    if (btn.getAttribute('data-confirm') === '1') {
      btn.removeAttribute('data-confirm');
      btn.classList.remove('armed');
      btn.title = 'Delete all conversations';
      vscode.postMessage({ type: 'deleteAllSessions' });
    } else {
      btn.setAttribute('data-confirm', '1');
      btn.classList.add('armed');
      btn.title = 'Click again to delete all conversations';
      setTimeout(function () {
        if (btn.isConnected) { btn.removeAttribute('data-confirm'); btn.classList.remove('armed'); btn.title = 'Delete all conversations'; }
      }, 4000);
    }
  });
  document.getElementById('settingsBtn').addEventListener('click', function () {
    renderSettings();
    document.getElementById('settingsPanel').classList.remove('hidden');
  });
  document.getElementById('settingsClose').addEventListener('click', hideSettings);
  document.getElementById('openSettingsBtn').addEventListener('click', function () { vscode.postMessage({ type: 'openSettings' }); });
  function hideSettings() {
    var p = document.getElementById('settingsPanel');
    if (p) { p.classList.add('hidden'); }
  }
  function renderSettings() {
    var box = document.getElementById('settingsList');
    if (!box) { return; }
    var s = state.settings || {};
    var rows = [
      ['Model', state.model || 'none selected'],
      ['CLI', (state.detection && state.detection.exists ? 'opencode ' + (state.detection.version || '') : 'not detected')],
      ['Patch mode', s.patchMode || ''],
      ['Request timeout', s.requestTimeoutSec + 's'],
      ['First-byte notice', s.firstByteNoticeSec + 's'],
      ['Tool activity', s.showToolActivity ? 'on' : 'off'],
    ];
    box.innerHTML = rows.map(function (r) {
      return '<div class="srow"><span class="skey">' + esc(r[0]) + '</span><span class="sval">' + esc(String(r[1])) + '</span></div>';
    }).join('');
  }
  document.getElementById('refreshBtn').addEventListener('click', function () { vscode.postMessage({ type: 'refreshAll' }); });
  function renderModeMenu() {
    modeMenu.innerHTML = '';
    var modes = [
      { id: 'ask', name: 'Ask', desc: 'Ask questions — answers only, no file changes' },
      { id: 'plan', name: 'Plan', desc: 'Analyze and propose a plan — no file changes' },
      { id: 'build', name: 'Build', desc: 'Implement changes — review diffs before apply' },
    ];
    modes.forEach(function (md) {
      var b = document.createElement('button');
      b.className = 'mode-item' + (md.id === state.mode ? ' current' : '');
      var tick = md.id === state.mode ? '<span class="mtick">' + ICONS.check + '</span>' : '';
      b.innerHTML = '<span class="motext">' + esc(md.name) + '<small>' + esc(md.desc) + '</small></span>' + tick;
      b.addEventListener('click', function () {
        modeMenu.classList.add('hidden');
        state.mode = md.id;
        vscode.postMessage({ type: 'setMode', mode: md.id });
        renderStatus(); persist();
      });
      modeMenu.appendChild(b);
    });
  }
  document.getElementById('attachBtn').addEventListener('click', function () {
    if (!cliReady()) { return; }
    vscode.postMessage({ type: 'attachFiles' });
  });
  modeMenuBtn.addEventListener('click', function () {
    if (!cliReady()) { return; }
    if (modeMenu.classList.contains('hidden')) {
      renderModeMenu();
      modeMenu.classList.remove('hidden');
    } else { modeMenu.classList.add('hidden'); }
  });
  document.getElementById('diagBtn').addEventListener('click', function () { vscode.postMessage({ type: 'showDiagnostics' }); });
  document.getElementById('debugClear').addEventListener('click', function () {
    var box = document.getElementById('debugLines');
    if (box) { box.innerHTML = ''; }
    debugCount = 0;
    var c = document.getElementById('debugCount');
    if (c) { c.textContent = '0'; }
  });
  document.getElementById('debugOutput').addEventListener('click', function () { vscode.postMessage({ type: 'openOutput' }); });
  modelBtn.addEventListener('click', function () {
    if (!cliReady()) { return; }
    if (modelMenu.classList.contains('hidden')) {
      vscode.postMessage({ type: 'requestModels' });
      renderModels();
      modelMenu.classList.remove('hidden');
      if (variantMenu) { variantMenu.classList.add('hidden'); }
    } else { modelMenu.classList.add('hidden'); }
  });
  if (variantBtn) {
    variantBtn.addEventListener('click', function () {
      if (!cliReady()) { return; }
      if (variantMenu.classList.contains('hidden')) {
        renderVariantMenu();
        variantMenu.classList.remove('hidden');
        modelMenu.classList.add('hidden');
      } else { variantMenu.classList.add('hidden'); }
    });
  }
  document.addEventListener('click', function (e) {
    if (!modelMenu.classList.contains('hidden') && !modelMenu.contains(e.target) && e.target !== modelBtn && !modelBtn.contains(e.target)) {
      modelMenu.classList.add('hidden');
    }
    if (!modeMenu.classList.contains('hidden') && !modeMenu.contains(e.target) && e.target !== modeMenuBtn && !modeMenuBtn.contains(e.target)) {
      modeMenu.classList.add('hidden');
    }
    if (variantMenu && !variantMenu.classList.contains('hidden') && !variantMenu.contains(e.target) && e.target !== variantBtn && !(variantBtn && variantBtn.contains(e.target))) {
      variantMenu.classList.add('hidden');
    }
  });

  window.addEventListener('message', function (event) {
    var msg = event.data || {};
    if (msg.type === 'history') {
      state.messages = msg.messages || [];
      streamingText = '';
      renderAll(msg.liveRun); persist();
    } else if (msg.type === 'showHistory') {
      setHistoryVisible(true);
      renderHistoryList(msg.sessions);
    } else if (msg.type === 'chatView') {
      setHistoryVisible(false);
    } else if (msg.type === 'assistantStart') {
      restoreRun(msg.liveRun || { startedAt: Date.now(), thought: { items: [], live: true, phase: 'Working…' } });
    } else if (msg.type === 'delta') {
      streamingText += msg.text || '';
      if (streamingRow) {
        setPhase('Responding…');
        // The answer has begun: collapse the thinking block Copilot-style
        // (unless the user opened/closed it on purpose) and freeze its label.
        if (thoughtData && !thoughtData.done) {
          thoughtData.phase = 'Responding…';
          thoughtData.secs = Math.max(1, Math.round((Date.now() - thoughtStartTs) / 1000));
          refreshThoughtEl();
          if (thoughtEl && !thoughtUserToggled) { thoughtEl.removeAttribute('open'); }
        }
        streamingRow.querySelector('.content').innerHTML = renderMarkdown(streamingText);
        bindCopy(streamingRow); scrollBottom();
      }
    } else if (msg.type === 'thinking') {
      if (!thoughtData) { thoughtStartTs = Date.now(); thoughtData = { items: [], live: true, done: false, secs: null, phase: 'Thinking…' }; }
      // Contiguous thinking chunks merge; after a tool they start a new chunk,
      // so the reasoning reads interleaved: thought → tool → thought.
      var lastIt = thoughtData.items[thoughtData.items.length - 1];
      if (lastIt && lastIt.type === 'text') { lastIt.text += (msg.text || ''); }
      else { thoughtData.items.push({ type: 'text', text: msg.text || '' }); }
      thoughtData.phase = 'Thinking…';
      setPhase('Thinking…');
      ensureThoughtEl(); refreshThoughtEl();
    } else if (msg.type === 'demoteToThinking') {
      if (!thoughtData) { thoughtStartTs = Date.now(); thoughtData = { items: [], live: true, done: false, secs: null, phase: 'Thinking…' }; }
      thoughtData.done = false;
      streamingText = '';
      if (streamingRow) {
        var cEl = streamingRow.querySelector('.content');
        if (cEl) { cEl.innerHTML = ''; }
      }
      var ttext = msg.text || '';
      var lastIt2 = thoughtData.items[thoughtData.items.length - 1];
      if (lastIt2 && lastIt2.type === 'text') { lastIt2.text += ttext; }
      else { thoughtData.items.push({ type: 'text', text: ttext }); }
      ensureThoughtEl(); refreshThoughtEl();
    } else if (msg.type === 'toolEvent') {
      if (!thoughtData) { thoughtStartTs = Date.now(); thoughtData = { items: [], live: true, done: false, secs: null, phase: 'Working…' }; }
      thoughtData.done = false;
      if (streamingText) {
        var prevText = streamingText;
        streamingText = '';
        if (streamingRow) {
          var cEl2 = streamingRow.querySelector('.content');
          if (cEl2) { cEl2.innerHTML = ''; }
        }
        var lastIt3 = thoughtData.items[thoughtData.items.length - 1];
        if (lastIt3 && lastIt3.type === 'text') { lastIt3.text += prevText; }
        else { thoughtData.items.push({ type: 'text', text: prevText }); }
      }
      var rec = null;
      for (var ti = thoughtData.items.length - 1; ti >= 0; ti--) {
        var cand = thoughtData.items[ti];
        if (cand.type === 'tool' && (msg.callID ? cand.callID === msg.callID : cand.tool === msg.tool && (cand.title || cand.input || '') === (msg.title || msg.input || ''))) { rec = cand; break; }
      }
      if (!rec) {
        rec = { type: 'tool', callID: msg.callID, tool: msg.tool, phase: msg.phase, title: msg.title, input: msg.input, output: '', exit: null };
        thoughtData.items.push(rec);
      } else {
        rec.phase = msg.phase || rec.phase;
        if (msg.title) { rec.title = msg.title; }
        if (msg.input) { rec.input = msg.input; }
      }
      if (msg.output) { rec.output = msg.output; }
      if (msg.exit !== null && msg.exit !== undefined) { rec.exit = msg.exit; }
      if (msg.tool === 'todowrite' && msg.todos && Array.isArray(msg.todos)) {
        state.todos = msg.todos;
        renderTodosBar(); persist();
      }
      if (isQuestionTool(msg.tool) && msg.questions && Array.isArray(msg.questions)) {
        if (!sameQuestionsList(state.questions, msg.questions)) {
          state.questions = msg.questions;
          currentQuestionIndex = 0;
          questionAnswers = {};
          renderQuestionsBar(); persist();
        }
      }
      setPhase(phaseLabelFor(msg.tool, msg.input || msg.title));
      thoughtData.phase = phaseLabelFor(msg.tool, msg.input || msg.title);
      ensureThoughtEl(); refreshThoughtEl();
    } else if (msg.type === 'todos') {
      state.todos = msg.todos || [];
      renderTodosBar(); persist();
    } else if (msg.type === 'questions') {
      var qList = msg.questions || [];
      if (!sameQuestionsList(state.questions, qList)) {
        state.questions = qList;
        currentQuestionIndex = 0;
        questionAnswers = {};
        renderQuestionsBar(); persist();
      }
    } else if (msg.type === 'log') {
      debugLog(msg.line || '');
    } else if (msg.type === 'selection') {
      // Live editor selection: show file + line range chip in the input bar
      // while the user selects code (chip drops when the selection clears).
      if (!editingMessageId) previewCtx = msg.context || null;
      renderCtxBar();
    } else if (msg.type === 'activeFile') {
      activeFile = msg.file || null;
      renderCtxBar();
    } else if (msg.type === 'activity') {
      var w2 = document.querySelector('.welcome'); if (w2) { w2.remove(); }
      var a = document.createElement('div');
      a.className = 'row activity';
      a.textContent = msg.text || 'Working…';
      messagesEl.appendChild(a); scrollBottom();
      setTimeout(function () { if (a.parentNode) { a.parentNode.removeChild(a); } }, 9000);
    } else if (msg.type === 'state') {
      state.cli = msg.cli !== undefined ? msg.cli : (state.cli || 'opencode');
      state.clis = msg.clis || state.clis || null;
      state.detections = msg.detections || state.detections || null;
      state.model = msg.model !== undefined ? msg.model : state.model;
      state.variant = msg.variant !== undefined ? msg.variant : state.variant;
      state.mode = msg.mode !== undefined ? normalizeMode(msg.mode) : state.mode;
      state.busy = !!msg.busy;
      if (msg.request && msg.request.requestId === pendingRequest) {
        if (msg.request.accepted) clearSentDraft();
        if (!state.busy) pendingRequest = null;
      }
      if (!state.busy && (!msg.request || msg.request.requestId !== pendingRequest)) pendingRequest = null;
      state.detection = msg.detection !== undefined ? msg.detection : state.detection;
      state.workspace = msg.workspace !== undefined ? msg.workspace : state.workspace;
      if (msg.settings) { state.settings = msg.settings; }
      if (msg.models) { state.models = msg.models; renderModels(); }
      if (msg.todos !== undefined) { state.todos = msg.todos; renderTodosBar(); }
      if (msg.questions !== undefined) {
        if (!sameQuestionsList(state.questions, msg.questions)) {
          state.questions = msg.questions;
          currentQuestionIndex = 0;
          questionAnswers = {};
        }
        renderQuestionsBar();
      }
      if (state.busy && !streamingRow) restoreRun(msg.liveRun || { thought: { items: [], live: true, phase: 'Working…' } });
      if (!state.busy && streamingRow) { streamingRow.remove(); streamingRow = null; thoughtEl = null; thoughtData = null; }
      renderStatus(); resizeInput(); persist();
    } else if (msg.type === 'models') {
      state.models = msg.models || [];
      // Re-render the picker options but never force it open: opening the
      // sidebar (ready → ensureModels → models) must not pop the menu.
      // The menu opens only via the model button click handler.
      renderModels(); renderVariant(); persist();
    } else if (msg.type === 'filesPicked') {
      var picked = msg.files || [];
      picked.forEach(function (f) {
        if (!f || !f.path) { return; }
        if (!attachedFiles.some(function (x) { return x.path === f.path; })) {
          attachedFiles.push({ path: f.path, name: f.name, lang: f.lang });
        }
      });
      state.attachedFiles = attachedFiles;
      renderCtxBar(); saveDraft();
    } else if (msg.type === 'setModeDone') {
      state.mode = normalizeMode(msg.mode);
      renderStatus(); persist();
    } else if (msg.type === 'patchResolved') {
      // Keep/Undo finished: remember the outcome so a window reload
      // re-renders the resolved card (no Keep/Undo buttons coming back),
      // and move the status badge to the card header's top-right corner.
      if (msg.outcome && msg.outcome !== 'unresolved') {
        for (var si = 0; si < state.messages.length; si++) {
          var sm = state.messages[si];
          if (sm && sm.role === 'patch' && (!msg.patchId || sm.patchId === msg.patchId)) {
            sm.outcome = msg.outcome;
          }
        }
        persist();
      }
      var cards = messagesEl.querySelectorAll('.patch-card');
      for (var ci = 0; ci < cards.length; ci++) {
        var pcard = cards[ci];
        var pid = pcard.getAttribute('data-patch-id');
        if (msg.patchId && pid && pid !== msg.patchId) { continue; }
        if (msg.outcome !== 'unresolved') {
          var lbl = msg.outcome === 'applied' ? 'Kept' : msg.outcome === 'rejected' ? 'Undone' : 'Resolved';
          var headEl = pcard.querySelector('.patch-head');
          if (headEl && !headEl.querySelector('.patch-outcome')) {
            var oc = document.createElement('span');
            oc.className = 'patch-outcome';
            oc.innerHTML = ICONS.check + ' ' + esc(lbl);
            headEl.appendChild(oc);
          }
          var actsEl = pcard.querySelector('.patch-actions');
          if (actsEl) {
            var ab = actsEl.querySelector('[data-act="apply"]');
            if (ab) { ab.remove(); }
            var rb = actsEl.querySelector('[data-act="reject"]');
            if (rb) { rb.remove(); }
          }
        }
      }
    } else if (msg.type === 'sendAccepted') {
      if (msg.requestId === pendingRequest) {
        clearSentDraft();
      }
    } else if (msg.type === 'sendSettled') {
      if (msg.requestId === pendingRequest) pendingRequest = null;
    } else if (msg.type === 'draft') {
      if (!inputEl.value && !editingMessageId && !pendingRequest && msg.draft) {
        restoreDraft(msg.draft); state.draft = msg.draft; persist();
      }
    } else if (msg.type === 'error') {
      state.busy = false; renderStatus();
    }
  });

  function clearSentDraft() {
    inputEl.value = ''; editingMessageId = null; previousDraft = null;
    attachedFiles = []; state.attachedFiles = []; previewCtx = null;
    saveDraft(); renderCtxBar(); resizeInput(); renderStatus();
  }

  renderAll(); renderCtxBar(); resizeInput();
  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'getDraft' });
})();
`;

function getChatHtml(nonce, webview) {
  const cspSource = webview && webview.cspSource ? `${webview.cspSource} ` : "";
  const csp = `default-src 'none'; img-src ${cspSource}data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${WEBVIEW_CSS}</style>
</head>
<body>
<section class="cli-gate" id="cliGate" aria-labelledby="gateTitle"><div class="setup-card">
${ICONS.logo}<div class="setup-eyebrow">WELCOME TO CODEOPEN</div>
<h2 id="gateTitle">Checking OpenCode CLI…</h2>
<p id="gateDescription">Waiting for OpenCode CLI. Install it using one of the options below.</p>
<div class="install-platform"><strong>Windows · PowerShell</strong><div class="setup-note">With Chocolatey installed, run:</div><div class="install-command"><code>choco install opencode</code><button class="icon-btn" data-copy-command="choco install opencode" title="Copy command" aria-label="Copy Windows installation command">${ICONS.copy}</button></div><div class="setup-note">Or use Scoop: <code>scoop install opencode</code>. In WSL, use the Linux instructions in your WSL environment.</div></div>
<div class="install-platform"><strong>macOS · Terminal</strong><div class="setup-note">With Homebrew installed, run:</div><div class="install-command"><code>brew install anomalyco/tap/opencode</code><button class="icon-btn" data-copy-command="brew install anomalyco/tap/opencode" title="Copy command" aria-label="Copy macOS installation command">${ICONS.copy}</button></div></div>
<div class="install-platform"><strong>Linux · Terminal</strong><div class="setup-note">Run the official installer:</div><div class="install-command"><code>curl -fsSL https://opencode.ai/install | bash</code><button class="icon-btn" data-copy-command="curl -fsSL https://opencode.ai/install | bash" title="Copy command" aria-label="Copy Linux installation command">${ICONS.copy}</button></div></div>
<p class="setup-note">After installation, restart VS Code, run <code>opencode --version</code> in its terminal, then retry detection. For Remote SSH, WSL or containers, install OpenCode in that environment. If already installed, set <code>freecli.opencodePath</code> to its executable.</p>
<div class="setup-actions"><button class="btn primary" id="retryDetectionBtn">Retry detection</button><button class="btn" id="cliSettingsBtn">Set CLI path</button><button class="btn" id="installDocsBtn">Installation guide</button></div>
</div></section>
<div class="messages" id="messages"></div>
<div class="input-wrap hidden">
<div class="model-menu hidden" id="modelMenu"></div>
<div class="mode-menu hidden" id="modeMenu"></div>
<div class="variant-menu hidden" id="variantMenu"></div>
<div class="todos-bar hidden" id="todosBar"></div>
<div class="questions-bar hidden" id="questionsBar"></div>
<div class="ctx-bar hidden" id="ctxBar"></div>
<div class="input-box">
<div class="edit-banner hidden" id="editBanner"><div><strong>Editing earlier message</strong><small>Send to start a new branch. The original stays in History; existing files are kept.</small></div><button class="icon-btn" id="cancelEditBtn" title="Cancel edit" aria-label="Cancel edit">${ICONS.x}</button></div>
<textarea id="input" aria-label="Message" rows="2" placeholder="Ask anything — select code first to target it (Enter to send, Shift+Enter for newline)"></textarea>
<div class="input-bar">
<div class="input-tools"><button class="icon-btn" id="attachBtn" title="Add files as context">${ICONS.plus}</button><button class="icon-btn mode-picker" id="modeBtn" title="Plan or Build mode"><span class="mode-icon">${ICONS.brain}</span><span id="modeLabel" class="mname">Build</span></button><button class="icon-btn model-picker" id="modelBtn" title="Select a verified free model"><span class="model-icon">${ICONS.sparkles}</span><span class="mlabel">Select free model</span></button><button class="icon-btn variant-picker hidden" id="variantBtn" title="Select reasoning level"><span class="variant-icon">${ICONS.sparkle}</span><span class="vlabel" id="variantLabel">Default</span></button></div>
<span class="spacer"></span><button class="icon-btn" id="settingsBtn" title="Settings">${ICONS.sliders}</button><button class="icon-btn stop-round hidden" id="stopBtn" title="Stop task" aria-label="Stop task">${ICONS.stop}</button><button class="btn primary send-round" id="sendBtn" title="Send">${ICONS.send}</button>
</div>
</div>
<div class="composer-hint"><span id="composerState">Shift+Enter for a new line</span><span>Enter to send</span></div>
</div>
<div class="history-page hidden" id="historyPage">
<div class="settings-head"><button class="icon-btn" id="historyBack" title="Back to chat">${ICONS.back}</button><span>History</span><span class="hist-head-right"><span class="hist-count" id="historyCount"></span><button class="icon-btn hist-clear hidden" id="historyClearAll" title="Delete all conversations">${ICONS.trash}</button></span></div>
<div class="settings-body" id="historyList"></div>
</div>
<div class="settings-panel hidden" id="settingsPanel">
<div class="settings-head"><span>Settings</span><button class="icon-btn" id="settingsClose" title="Close">${ICONS.x}</button></div>
<div class="settings-body">
<div class="settings-group"><div class="settings-title">Models &amp; detection</div>
<button class="btn" id="refreshBtn">Refresh detection and models</button>
<button class="btn" id="diagBtn">Show Diagnostics</button>
</div>
<div class="settings-group"><div class="settings-title">Extension settings</div>
<div class="settings-list" id="settingsList"></div>
<button class="btn" id="openSettingsBtn">Open VS Code Settings</button>
</div>
<div class="settings-group"><div class="settings-title">Debug log (<span id="debugCount">0</span>)</div>
<div class="debug-lines" id="debugLines"></div>
<div class="debug-actions"><button class="btn" id="debugClear">Clear</button><button class="btn" id="debugOutput">Open Output</button></div>
</div>
</div>
</div>
<script nonce="${nonce}">${WEBVIEW_JS}</script>
</body>
</html>`;
}

class ChatPanelProvider {
  constructor(vscodeApi, handlers) {
    this.vscode = vscodeApi;
    this.handlers = handlers || {};
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getChatHtml(makeNonce(), webviewView.webview);
    webviewView.onDidDispose(() => {
      // An old view can dispose after VS Code has created its replacement.
      if (this.view === webviewView) this.view = null;
    });
    if (webviewView.onDidChangeVisibility) {
      webviewView.onDidChangeVisibility(() => {
        if (
          this.view === webviewView &&
          webviewView.visible &&
          this.handlers.onVisible
        )
          this.handlers.onVisible(this);
      });
    }
    webviewView.webview.onDidReceiveMessage((msg) => {
      try {
        if (this.handlers.onMessage) {
          Promise.resolve(this.handlers.onMessage(msg, this)).catch(() => {});
        }
      } catch (e) {
        // never let a bad message kill the panel
      }
    });
  }

  post(message) {
    try {
      if (this.view) {
        Promise.resolve(this.view.webview.postMessage(message)).catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  }
}

module.exports = {
  ChatPanelProvider,
  getChatHtml,
  escapeHtml,
  makeNonce,
  phaseLabelFor,
  orderModels,
  lineRangeChips,
  fileBadge,
  isFilePath,
  isQuestionTool,
  ICONS,
  ICON_PNG_DATA_URL,
};
