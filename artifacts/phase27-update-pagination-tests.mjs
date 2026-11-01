import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
import { readFile, writeFile } from 'node:fs/promises';
for (const path of ['apps/web/src/pages/owner/OrderSearch.test.tsx', 'apps/web/src/pages/owner/OrderFilters.test.tsx']) {
  let source = await readFile(path, 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toHaveBeenLastCalledWith' && node.arguments.length === 5) {
      const next = node.arguments[1].getText(tree) === '"next"';
      edits.push({at: node.arguments[4].end, end: node.arguments[4].end, text: next ? ', { page: 2, snapshot: "2026-10-17T00:00:00.000Z" }' : ', { page: 1 }'});
      if (next) edits.push({at: node.arguments[1].getStart(tree), end: node.arguments[1].end, text: 'null'});
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const edit of edits.sort((a,b) => b.at-a.at)) source=source.slice(0,edit.at)+edit.text+source.slice(edit.end);
  source=source.replace('requests[view].mockResolvedValue({ orders: [], nextCursor: "next" });', `requests[view].mockImplementation(async (_shop, _cursor, _signal, _term, _filters, paging) => ({
        orders: [], nextCursor: null,
        pagination: { page: paging?.page ?? 1, pageSize: 12, pageCount: 2, total: 13,
          snapshot: "2026-10-17T00:00:00.000Z", hasNew: false },
      }));`);
  // The regression now asserts the numbered page rather than an obsolete cursor.
  source=source.replaceAll('call[1] === "next"', 'call[5]?.page === 2');
  await writeFile(path, source);
}
