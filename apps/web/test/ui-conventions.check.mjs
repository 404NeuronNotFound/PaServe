import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const failures = [];
const controlClasses = new Set();
const styles = [];
function visitDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { visitDirectory(file); continue; }
    if (file.endsWith(".css")) { styles.push(file); continue; }
    if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
    const source = readFileSync(file, "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(tree);
        if (["button", "input", "textarea"].includes(tag)) {
          const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
          failures.push(`${file}:${line + 1}: use the shared control instead of <${tag}>`);
        }
        if (["Button", "Input", "Textarea", "PendingButton"].includes(tag)) {
          const className = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "className");
          for (const token of className?.initializer?.getText(tree).match(/[a-z][a-z0-9-]+/g) ?? []) controlClasses.add(token);
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || attribute.name.text !== "style") continue;
            const value = attribute.initializer?.getText(tree) ?? "";
            if (/\b(?:color|background|borderRadius|fontSize|fontWeight)\s*:/.test(value))
              failures.push(`${file}: control painting belongs in the shared variant, not an inline style`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
}
visitDirectory("src/pages");
visitDirectory("src/features");
for (const file of styles) {
  for (const [, selector, body] of readFileSync(file, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Interaction/state styling and domain branding stay explicit. Base visual
    // variants must come from the shared library; layout dimensions are allowed.
    if (/@|aria-|data-|:has|:checked|:disabled|\.is-/.test(selector)) continue;
    const controls = selector.split(",").every((part) => {
      const last = part.trim().split(/\s+|>/).at(-1)?.replace(/:[\w-]+(?:\([^)]*\))?/g, "") ?? "";
      return /^(button|input|textarea)(\[.*\])?$/.test(last) || (last.startsWith(".") && controlClasses.has(last.slice(1)));
    });
    if (controls && /(?:^|;)\s*(?:background(?:-color)?|color|border-color|border-radius|font-size|font-weight|line-height):/.test(body))
      failures.push(`${file}: move base control painting into the shared variant: ${selector.trim()}`);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("Shared control conventions passed for all feature and page modules.");
