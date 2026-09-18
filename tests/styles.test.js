import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("the chat icon reserves the same width as a Font Awesome fixed-width icon", () => {
  assert.match(css, /\.e-ball-context-icon\s*{\s*width:\s*1\.25em;/);
  assert.match(css, /\.e-ball-reroll-indicator\s*{\s*width:\s*1em;/);
});
