"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainCss = fs.readFileSync(path.join(root, "assets/css/main.css"), "utf8");
const libraryCss = fs.readFileSync(path.join(root, "assets/css/library.css"), "utf8");

// PDF.js uses `svg.highlight` for the yellow annotation geometry. A bare
// `.highlight` rule from the site's syntax highlighter paints those SVG boxes
// with the dark code background and gives them a border/overflow clipping.
assert.doesNotMatch(
  mainCss,
  /(?:^|\})\s*\.highlight\s*\{/m,
  "Syntax-highlight styles must be scoped so they cannot paint PDF.js highlight SVGs"
);

// PDF.js sets a scale-aware 100px font on the annotation layer. The site's
// global `button { font: inherit }` otherwise makes the delete icon's inline
// box much taller than its 28px toolbar button and visually separates them.
assert.match(
  libraryCss,
  /\.library-pdf-viewer\s+\.annotationEditorLayer\s+\.editToolbar\s+button\s*\{[^}]*font:\s*menu\s*;[^}]*line-height:\s*normal\s*;/s,
  "PDF.js annotation toolbar buttons must restore a normal control font and line box"
);

console.log("PASS: Library PDF highlights and editor controls are isolated from site-wide CSS");
