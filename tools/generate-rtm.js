/**
 * Generates the Requirements Traceability Matrix: docs/VIMTV_API_RTM.xlsx
 *
 *   npm run rtm
 *
 * Reads the endpoint registry (src/endpoints.ts - needs Node >= 22.18 for TS type stripping),
 * the live Playwright test inventory (`playwright test --list`), and the latest execution
 * report (reports/results.json, written by every `npm test*` run) if present.
 * Every count in the workbook is a formula over 'RTM Detail', cached with its computed value.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const OUT = path.join(ROOT, 'docs', 'VIMTV_API_RTM.xlsx');
fs.mkdirSync(REPORTS, { recursive: true });

// ---------------- inputs ----------------
const { EP } = require('../src/endpoints.ts');
const endpoints = Object.values(EP);

const listFile = path.join(REPORTS, 'test-list.json');
execSync('npx playwright test --list --reporter=json', {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: listFile },
});
const testList = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const runFile = path.join(REPORTS, 'results.json');
const lastRun = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null;
const envCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'environments', 'prod.json'), 'utf8'));

const EP_BY_ID = Object.fromEntries(endpoints.map((e) => [e.id, e]));
const API_ID = Object.fromEntries(endpoints.map((e, i) => [e.id, `API-${String(i + 1).padStart(2, '0')}`]));
const CROSS = 'X-CUT'; // infrastructure checks not tied to one API
const PERF_SAMPLES = 5;

const sla = (ep) => envCfg.sla.overrides[ep.id] ?? ep.slaMs ?? envCfg.sla.defaultMs;
const safe = (ep) => !ep.stateChanging && !ep.sensitive;
const needsNoSession = (ep) => ep.noSession || ep.apiHeaders === false;

// ---------------- requirement categories ----------------
const CATS = {
  FR: { label: 'Functional (+ve)', prio: 'P1' },
  VAL: { label: 'Validation & auth (-ve)', prio: 'P1' },
  EDG: { label: 'Edge cases', prio: 'P2' },
  HTTP: { label: 'HTTP status codes (2XX/3XX/4XX/5XX)', prio: 'P2' },
  SEC: { label: 'Security', prio: 'P1' },
  PERF: { label: 'Response time', prio: 'P2' },
};
const CAT_ORDER = Object.keys(CATS);

const endpointLabel = (ep) => {
  const q = Object.keys(ep.query ?? {}).map((k) => `${k}=`).join('&');
  return `{{${ep.base}}}${ep.path}${q ? `?${q}` : ''}`;
};

function requirementText(ep, cat) {
  const session = !needsNoSession(ep);
  switch (cat) {
    case 'FR':
      return `${ep.method} ${ep.path} returns HTTP 2XX with a valid success body (status=success, no error object, endpoint-specific fields) for valid input, within the ${sla(ep)} ms SLA.`;
    case 'VAL':
      return 'Invalid, missing or unsupported input is refused with HTTP 4XX or a failure envelope (status=false + error); never HTTP 5XX.' +
        (session ? ' Requests with a missing, empty or unknown session-id are refused.' : '');
    case 'EDG':
      return 'Boundary and unusual values (empty, whitespace, very long, Unicode, special characters, overflow, wrong types, malformed JSON) are handled gracefully: no HTTP 5XX and no internal error details.';
    case 'HTTP':
      return 'Correct HTTP status class: 2XX on success; 3XX only to same-site HTTPS; 4XX for unknown routes, wrong methods, malformed or oversized requests and missing auth; never 5XX for handled input.';
    case 'SEC':
      return 'Basic security controls: HTTPS and security headers, CORS restricted to trusted origins, session enforced, injection-safe (SQL/NoSQL/XSS/command/template/CRLF/path traversal), no sensitive data or internals exposed.';
    default:
      return `p95 response time over ${PERF_SAMPLES} sequential samples is <= ${sla(ep)} ms; average <= SLA; no 5XX.`;
  }
}

const EXPECTED = {
  FR: 'HTTP 2XX; JSON body; status=success with no error object; response time <= SLA',
  VAL: 'Refused: HTTP 4XX or HTTP 2XX with status=false + error; never 5XX; no stack trace / DB error',
  EDG: 'Handled gracefully: no HTTP 5XX; no internal details; valid JSON when 2XX',
  HTTP: 'Status code in the class named by the test; never 5XX for handled input',
  SEC: 'Security control enforced (see test case); no leaks of secrets or internals',
  PERF: 'p95 and average response time <= SLA across all samples; no 5XX',
};
// Status code | Response body | Response time | Security
const VERIFIES = {
  FR: ['Y', 'Y', 'Y', 'Y'], VAL: ['Y', 'Y', '', 'Y'], EDG: ['Y', 'Y', '', 'Y'],
  HTTP: ['Y', 'Y', '', ''], SEC: ['Y', 'Y', '', 'Y'], PERF: ['Y', '', 'Y', ''],
};

function category(tags) {
  for (const [tag, cat] of [['security', 'SEC'], ['perf', 'PERF'], ['status', 'HTTP'], ['positive', 'FR'], ['negative', 'VAL'], ['edge', 'EDG']]) {
    if (tags.includes(tag)) return cat;
  }
  return 'FR';
}

// ---------------- map each test to the API(s) it exercises ----------------
const BY_NAME_LEN = [...endpoints].sort((a, b) => b.name.length - a.name.length);
const BLOCK_END = /^\s*(test(\.describe)?\(|positiveCase\(|standardNegativeCases\(|queryEdgeCases\(|bodyEdgeCases\()/;
const fileCache = {};

function bodyRefs(specFile, line) {
  const p = path.join(ROOT, 'tests', specFile);
  if (!fs.existsSync(p)) return [];
  const lines = (fileCache[specFile] ??= fs.readFileSync(p, 'utf8').split(/\r?\n/));
  const block = [lines[line - 1]];
  for (const ln of lines.slice(line)) {
    if (BLOCK_END.test(ln)) break;
    block.push(ln);
  }
  return [...new Set([...block.join('\n').matchAll(/\bEP\.([A-Z_]+)/g)].map((m) => m[1]))].filter((id) => EP_BY_ID[id]);
}

function matchTitle(text) {
  const found = [];
  for (const e of BY_NAME_LEN) {
    if (text.includes(e.name)) {
      found.push(e.id);
      text = text.split(e.name).join(' ');
    }
  }
  for (const e of endpoints) if (new RegExp(`\\b${e.id}\\b`).test(text) && !found.includes(e.id)) found.push(e.id);
  return found;
}

function byRule(title) {
  const all = (pred) => endpoints.filter(pred).map((e) => e.id);
  if (/Every protected endpoint|Tampered session/.test(title)) return all((e) => e.requiresAuth);
  if (/no endpoint returns 5XX|All configured base URLs|Sensitive values are not passed/.test(title)) return all(() => true);
  const base = /\b(apiBaseUrl|searchBaseUrl|webBaseUrl|packageBaseUrl)\b/.exec(title)?.[1];
  if (base === 'packageBaseUrl') return ['PACKAGE_CATALOGUE'];
  if (base) return all((e) => e.base === base);
  if (/web root|Web origin/.test(title)) return all((e) => e.base === 'webBaseUrl');
  if (/Next\.js data route/.test(title)) return all((e) => e.contract === 'next');
  return [CROSS];
}

function mapTest(t) {
  const scope = (ids) => (ids.length === 1 && ids[0] !== CROSS ? 'Endpoint-specific' : 'Shared');
  let ids = matchTitle(t.title);
  if (!ids.length && t.src === t.spec) ids = bodyRefs(t.spec, t.line);
  if (!ids.length) ids = matchTitle(t.describe).slice(0, 1);
  if (!ids.length) ids = byRule(t.title);
  return { ids, scope: scope(ids) };
}

// ---------------- last execution ----------------
const RESULTS = {};
(function walk(suites = []) {
  for (const s of suites) {
    walk(s.suites);
    for (const sp of s.specs ?? []) {
      const t = sp.tests[0];
      const res = t.results.at(-1) ?? {};
      const skip = [...(t.annotations ?? []), ...(res.annotations ?? [])].find((a) => a.type === 'skip');
      if (t.status === 'skipped') RESULTS[sp.id] = ['Skipped', skip?.description ?? ''];
      else if (t.status === 'expected' || t.status === 'flaky') RESULTS[sp.id] = ['Pass', ''];
      else RESULTS[sp.id] = ['Fail', (res.error?.message ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].slice(0, 250)];
    }
  }
})(lastRun?.suites);
const RUN_DATE = lastRun?.stats?.startTime?.slice(0, 10) ?? '';
const RUN_GREP = lastRun?.config?.grep ? JSON.stringify(lastRun.config.grep) : '';

// ---------------- collect tests & RTM rows ----------------
const tests = [];
(function collect(suites, topFile, trail) {
  for (const s of suites ?? []) {
    const file = topFile ?? s.file;
    const nextTrail = topFile ? [...trail, s.title] : [];
    collect(s.suites, file, nextTrail);
    for (const sp of s.specs ?? []) {
      tests.push({ id: sp.id, title: sp.title, tags: sp.tags ?? [], spec: file, src: sp.file.replace(/^(\.\.\/)+/, ''), line: sp.line, describe: nextTrail.join(' › ') });
    }
  }
})(testList.suites, null, []);
tests.sort((a, b) => a.spec.localeCompare(b.spec) || (a.src !== a.spec) - (b.src !== b.spec) || a.line - b.line || a.describe.localeCompare(b.describe) || a.title.localeCompare(b.title));
tests.forEach((t, i) => (t.tc = `TC-${String(i + 1).padStart(4, '0')}`));

const rows = [];
for (const t of tests) {
  const cat = category(t.tags);
  const { ids, scope } = mapTest(t);
  const [result, note] = RESULTS[t.id] ?? ['Not Executed', ''];
  for (const eid of ids) rows.push({ eid, api: API_ID[eid] ?? CROSS, cat, scope, t, result, note, req: `REQ-${API_ID[eid] ?? CROSS}-${cat}` });
}

function preconditions(ep, cat) {
  if (!ep) return ['Configured base URLs (FAULT_INJECTION_URL for the injected-fault test)', 'None'];
  const vars = new Set([...JSON.stringify([ep.path, ep.query, ep.body]).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((v) => v !== 'timestamp'));
  const sess = needsNoSession(ep) ? 'No session needed' : ep.requiresAuth ? 'Signed-in SESSION_ID' : 'Anonymous session (AUTO_TOKEN)';
  const data = sess + (vars.size && ['FR', 'PERF', 'HTTP'].includes(cat) ? `; data: ${[...vars].sort().join(', ')}` : '');
  const gate = ['FR', 'PERF', 'HTTP'].includes(cat)
    ? [ep.stateChanging && 'ALLOW_STATE_CHANGING', ep.sensitive && 'ALLOW_SENSITIVE'].filter(Boolean).join(' + ')
    : '';
  return [data, gate || 'None'];
}

// ---------------- workbook helpers ----------------
const FONT = 'Arial';
const argb = (hex) => ({ argb: `FF${hex}` });
const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: argb(hex) });
const cfFill = (hex) => ({ fill: { type: 'pattern', pattern: 'solid', bgColor: argb(hex) } });
const THIN = { style: 'thin', color: argb('BFBFBF') };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const WRAP = { wrapText: true, vertical: 'top' };
const CENTER = { wrapText: true, vertical: 'top', horizontal: 'center' };
const C = { navy: '1F3864', green: 'E2EFDA', red: 'F8CBAD', amber: 'FFF2CC', grey: 'EDEDED' };

const wb = new ExcelJS.Workbook();
wb.creator = 'vimtv-api-tests';
wb.calcProperties.fullCalcOnLoad = true;

function sheet(name, cols, frozenCols = 2) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: frozenCols, ySplit: 1, zoomScale: 90 }] });
  ws.columns = cols.map(([, width]) => ({ width }));
  const hdr = ws.getRow(1);
  cols.forEach(([h], i) => {
    const c = hdr.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: argb('FFFFFF') };
    c.fill = fill(C.navy);
    c.alignment = CENTER;
    c.border = BORDER;
  });
  hdr.height = 32;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

function styleRange(ws, fromRow, toRow, ncols, centerCols = []) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= ncols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: FONT, size: 10, ...(cell.font?.bold ? { bold: true } : {}) };
      cell.border = BORDER;
      cell.alignment = centerCols.includes(c) ? CENTER : WRAP;
    }
  }
}

const equalsRule = (ref, text, hex, priority) => ({ ref, rules: [{ type: 'cellIs', operator: 'equal', formulae: [text], style: cfFill(hex), priority }] });
const f = (formula, result) => ({ formula, result });
const count = (pred) => rows.filter(pred).length;

// ---------------- sheets, created in display order ----------------
const sumCols = [
  ['API ID', 9], ['API Name', 26], ['Group', 11], ['Method', 8], ['Endpoint', 44], ['Source (Collection / PDF)', 30],
  ['Auth', 18], ['Safety Gate (+ve)', 22],
  ['Functional (+ve)', 10], ['Validation (-ve)', 10], ['Edge', 9], ['HTTP Codes', 9], ['Security', 9], ['Response Time', 9],
  ['Total TCs', 9], ['Passed', 8], ['Failed', 8], ['Skipped', 8], ['Not Executed', 10],
  ['Req. Covered', 10], ['Req. Applicable', 10], ['Coverage %', 10],
];
const reqCols = [
  ['Req ID', 16], ['API ID', 9], ['API Name', 24], ['Category', 22], ['Requirement', 70], ['Priority', 8],
  ['Linked Test Cases', 10], ['Passed', 8], ['Failed', 8], ['Skipped', 8], ['Not Executed', 10],
  ['Coverage Status', 14], ['Execution Status', 18], ['Linked TC IDs', 60],
];
const detCols = [
  ['Req ID', 16], ['API ID', 9], ['API Name', 24], ['Method', 8], ['Endpoint', 42], ['Category', 20],
  ['TC ID', 10], ['Test Case', 58], ['Tags', 16], ['Scope', 14], ['Expected Result', 44],
  ['Verifies Status Code', 10], ['Verifies Response Body', 10], ['Verifies Response Time', 10], ['Verifies Security', 10],
  ['Preconditions / Test Data', 34], ['Safety Gate', 20], ['Priority', 8], ['Automated In', 36],
  ['Last Result', 12], ['Last Run Notes', 44],
];
const rm = wb.addWorksheet('Read Me', { views: [{ zoomScale: 90 }] });
const summ = sheet('API Summary', sumCols);
const reqWs = sheet('Requirements', reqCols);
const det = sheet('RTM Detail', detCols);

// ---------------- RTM Detail ----------------
rows.forEach((row, i) => {
  const ep = EP_BY_ID[row.eid];
  const [data, gate] = preconditions(ep, row.cat);
  const t = row.t;
  const loc = t.src === t.spec ? `tests/${t.spec}:${t.line}` : `tests/${t.spec} → src/${path.basename(t.src)}:${t.line}`;
  det.getRow(i + 2).values = [
    row.req, row.api, ep?.name ?? 'Cross-cutting / infrastructure', ep?.method ?? '-', ep ? endpointLabel(ep) : '-', CATS[row.cat].label,
    t.tc, t.title.replace(/\s*@\w+/g, '').trim(), t.tags.map((x) => `@${x}`).join(' '), row.scope, EXPECTED[row.cat],
    ...VERIFIES[row.cat], data, gate, CATS[row.cat].prio, loc, row.result, row.note,
  ];
});
const DET_LAST = rows.length + 1;
styleRange(det, 2, DET_LAST, detCols.length, [2, 4, 7, 12, 13, 14, 15, 18, 20]);
const resRef = `T2:T${DET_LAST}`;
det.addConditionalFormatting(equalsRule(resRef, '"Pass"', C.green, 1));
det.addConditionalFormatting(equalsRule(resRef, '"Fail"', C.red, 2));
det.addConditionalFormatting(equalsRule(resRef, '"Skipped"', C.amber, 3));
det.addConditionalFormatting(equalsRule(resRef, '"Not Executed"', C.grey, 4));

const DR = (col) => `'RTM Detail'!$${col}$2:$${col}$${DET_LAST}`;

// ---------------- Requirements ----------------
const reqTargets = [
  ...endpoints.flatMap((ep) => CAT_ORDER.map((cat) => [ep, cat])),
  [null, 'HTTP'],
];
reqTargets.forEach(([ep, cat], i) => {
  const r = i + 2;
  const api = ep ? API_ID[ep.id] : CROSS;
  const req = `REQ-${api}-${cat}`;
  const na = !!ep && cat === 'PERF' && !safe(ep);
  const text = na
    ? 'Not applicable: state-changing / sensitive API is excluded from repeated sampling (response time is still checked on every call in the functional tests).'
    : ep ? requirementText(ep, cat)
      : 'Infrastructure: a forced 5XX (FAULT_INJECTION_URL) returns a clean 5XX with no internal details.';
  const linked = rows.filter((x) => x.req === req);
  const n = linked.length;
  const by = (s) => linked.filter((x) => x.result === s).length;
  const [pass, fail, skip, notRun] = ['Pass', 'Fail', 'Skipped', 'Not Executed'].map(by);
  const coverage = na ? 'N/A' : n > 0 ? 'Covered' : 'Not Covered';
  const execution = n === 0 ? '-' : fail > 0 ? 'Failing' : pass === n ? 'Passed' : pass > 0 ? 'Partially Executed' : 'Not Yet Passed';
  reqWs.getRow(r).values = [
    req, api, ep?.name ?? 'Cross-cutting / infrastructure', CATS[cat].label, text, na ? 'N/A' : CATS[cat].prio,
    f(`COUNTIF(${DR('A')},A${r})`, n),
    f(`COUNTIFS(${DR('A')},A${r},${DR('T')},"Pass")`, pass),
    f(`COUNTIFS(${DR('A')},A${r},${DR('T')},"Fail")`, fail),
    f(`COUNTIFS(${DR('A')},A${r},${DR('T')},"Skipped")`, skip),
    f(`COUNTIFS(${DR('A')},A${r},${DR('T')},"Not Executed")`, notRun),
    f(`IF(F${r}="N/A","N/A",IF(G${r}>0,"Covered","Not Covered"))`, coverage),
    f(`IF(G${r}=0,"-",IF(I${r}>0,"Failing",IF(H${r}=G${r},"Passed",IF(H${r}>0,"Partially Executed","Not Yet Passed"))))`, execution),
    [...new Set(linked.map((x) => x.t.tc))].join(', '),
  ];
});
const REQ_LAST = reqTargets.length + 1;
styleRange(reqWs, 2, REQ_LAST, reqCols.length, [2, 6, 7, 8, 9, 10, 11, 12, 13]);
reqWs.addConditionalFormatting(equalsRule(`L2:L${REQ_LAST}`, '"Covered"', C.green, 1));
reqWs.addConditionalFormatting(equalsRule(`L2:L${REQ_LAST}`, '"Not Covered"', C.red, 2));
reqWs.addConditionalFormatting(equalsRule(`M2:M${REQ_LAST}`, '"Passed"', C.green, 3));
reqWs.addConditionalFormatting(equalsRule(`M2:M${REQ_LAST}`, '"Failing"', C.red, 4));
reqWs.addConditionalFormatting(equalsRule(`M2:M${REQ_LAST}`, '"Partially Executed"', C.amber, 5));

// ---------------- API Summary ----------------
const totals = Array(23).fill(0);
endpoints.forEach((ep, i) => {
  const r = i + 2;
  const api = API_ID[ep.id];
  const auth = needsNoSession(ep) ? 'No session' : ep.requiresAuth ? 'Signed-in user' : 'Anonymous session';
  const gate = [ep.stateChanging && 'ALLOW_STATE_CHANGING', ep.sensitive && 'ALLOW_SENSITIVE'].filter(Boolean).join(' + ') || 'None';
  const catCells = CAT_ORDER.map((cat) => {
    if (cat === 'PERF' && !safe(ep)) return 'N/A';
    return f(`COUNTIFS(${DR('B')},$A${r},${DR('F')},"${CATS[cat].label}")`, count((x) => x.api === api && x.cat === cat));
  });
  const total = count((x) => x.api === api);
  const status = ['Pass', 'Fail', 'Skipped', 'Not Executed'].map((s) =>
    f(`COUNTIFS(${DR('B')},$A${r},${DR('T')},"${s}")`, count((x) => x.api === api && x.result === s)));
  const covered = catCells.filter((c) => typeof c === 'object' && c.result > 0).length;
  const applicable = 6 - catCells.filter((c) => c === 'N/A').length;
  summ.getRow(r).values = [
    api, ep.name, ep.group, ep.method, endpointLabel(ep), ep.source, auth, gate,
    ...catCells, f(`COUNTIF(${DR('B')},$A${r})`, total), ...status,
    f(`COUNTIF(I${r}:N${r},">0")`, covered), f(`6-COUNTIF(I${r}:N${r},"N/A")`, applicable),
    f(`IF(U${r}=0,0,T${r}/U${r})`, applicable ? covered / applicable : 0),
  ];
  // Totals come from the source values (exceljs drops cached results of 0 when read back).
  [...catCells, { result: total }, ...status, { result: covered }, { result: applicable }].forEach((c, k) => {
    totals[9 + k] += typeof c === 'object' ? c.result : 0;
  });
});
const SUM_LAST = endpoints.length + 1;
const TOT = SUM_LAST + 1;
const totRow = summ.getRow(TOT);
totRow.getCell(1).value = 'TOTAL';
totRow.getCell(2).value = 'API–test links (see note below)';
for (let c = 9; c <= 21; c++) {
  const L = summ.getColumn(c).letter;
  totRow.getCell(c).value = f(`SUM(${L}2:${L}${SUM_LAST})`, totals[c]);
}
totRow.getCell(22).value = f(`IF(U${TOT}=0,0,T${TOT}/U${TOT})`, totals[21] ? totals[20] / totals[21] : 0);
styleRange(summ, 2, TOT, sumCols.length, [1, 4, ...Array.from({ length: 14 }, (_, k) => k + 9)]);
for (let c = 1; c <= sumCols.length; c++) {
  totRow.getCell(c).font = { name: FONT, size: 10, bold: true };
  totRow.getCell(c).fill = fill(C.grey);
}
for (let r = 2; r <= TOT; r++) summ.getCell(r, 22).numFmt = '0%';
summ.addConditionalFormatting({ ref: `V2:V${SUM_LAST}`, rules: [
  { type: 'cellIs', operator: 'equal', formulae: ['1'], style: cfFill(C.green), priority: 1 },
  { type: 'cellIs', operator: 'lessThan', formulae: ['1'], style: cfFill(C.amber), priority: 2 },
] });
summ.addConditionalFormatting({ ref: `I2:N${SUM_LAST}`, rules: [{ type: 'cellIs', operator: 'equal', formulae: ['0'], style: cfFill(C.red), priority: 3 }] });
summ.addConditionalFormatting({ ref: `Q2:Q${SUM_LAST}`, rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: cfFill(C.red), priority: 4 }] });
const note = summ.getCell(TOT + 2, 1);
note.value = "Counts are live formulas over 'RTM Detail'. Shared tests (e.g. security sweeps) count under every API they exercise, so TOTAL sums API–test links, not distinct test cases. 'N/A' = response-time sampling is not run on state-changing or sensitive APIs.";
note.font = { name: FONT, size: 9, italic: true };

// ---------------- Read Me ----------------
rm.columns = [{ width: 30 }, { width: 112 }];
const reqCovered = reqTargets.filter(([ep, cat]) => !(ep && cat === 'PERF' && !safe(ep))).filter(([ep, cat]) =>
  rows.some((x) => x.req === `REQ-${ep ? API_ID[ep.id] : CROSS}-${cat}`)).length;
const reqNotCovered = reqTargets.filter(([ep, cat]) => !(ep && cat === 'PERF' && !safe(ep))).length - reqCovered;
const info = [
  ['VIMTV API – Requirements Traceability Matrix', null, 'title'],
  ['Source collection', 'VIMTV Web API Collection – Updated from HAR + YVS APIs v1.2 (45 requests; 44 unique APIs – Active Packages appears twice)'],
  ['Automation', 'Playwright API tests in vimtv-api-tests/ (TypeScript); requirement categories derived from test tags'],
  ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ['Last execution', RUN_DATE ? `${RUN_DATE}${RUN_GREP ? ` – filter ${RUN_GREP}` : ''} – prod, default safety flags (state-changing / sensitive calls off)` : 'No execution report found (reports/results.json)'],
  ['APIs', f(`COUNTA('API Summary'!A2:A${SUM_LAST})`, endpoints.length)],
  ['Requirements', f(`COUNTA(Requirements!A2:A${REQ_LAST})`, reqTargets.length)],
  ['Requirements covered', f(`COUNTIF(Requirements!L2:L${REQ_LAST},"Covered")`, reqCovered)],
  ['Requirements not covered', f(`COUNTIF(Requirements!L2:L${REQ_LAST},"Not Covered")`, reqNotCovered)],
  ['Distinct test cases', tests.length],
  ['API–test links (RTM rows)', f(`COUNTA('RTM Detail'!A2:A${DET_LAST})`, rows.length)],
  [],
  ['Sheets', null, 'section'],
  ['API Summary', 'One row per API: endpoint, auth, safety gate, test count per requirement category, execution status, coverage %.'],
  ['Requirements', 'One row per API × category (Req ID = REQ-API-nn-CAT): requirement text, linked test cases, coverage and execution status.'],
  ['RTM Detail', 'One row per API × test case: expected result, what it verifies (status code / body / response time / security), preconditions, safety gate, automation location and last result. Filter by API ID or Req ID.'],
  [],
  ['Requirement categories', null, 'section'],
  ['FR – Functional (+ve)', 'Valid request returns 2XX with a valid success body within SLA.'],
  ['VAL – Validation & auth (-ve)', 'Invalid input or missing/bad session refused with 4XX or a failure envelope; never 5XX.'],
  ['EDG – Edge cases', 'Boundary and unusual values handled gracefully.'],
  ['HTTP – Status codes', 'Explicit 2XX / 3XX / 4XX / 5XX verification.'],
  ['SEC – Security', 'Headers, HTTPS, CORS, session enforcement, injection, data exposure, open redirect, rate limiting.'],
  ['PERF – Response time', 'Repeated sampling; p95 and average within SLA.'],
  ['X-CUT', 'Cross-cutting checks not tied to one API (e.g. injected 5XX fault).'],
  [],
  ['Last Result values', 'Pass · Fail · Skipped (missing test data or safety gate – reason in Last Run Notes) · Not Executed (not in the last run)'],
  ['Scope values', 'Endpoint-specific = test targets one API · Shared = one test exercises several APIs and is counted under each'],
  ['Regenerate', 'npm run rtm   (re-reads the endpoint registry, the test inventory and reports/results.json from the latest test run)'],
];
info.forEach(([k, v, kind], i) => {
  const row = rm.getRow(i + 1);
  row.getCell(1).value = k ?? null;
  row.getCell(2).value = v ?? null;
  row.getCell(1).font = kind === 'title' ? { name: FONT, size: 14, bold: true, color: argb(C.navy) }
    : kind === 'section' ? { name: FONT, size: 11, bold: true, color: argb(C.navy) } : { name: FONT, size: 10, bold: true };
  row.getCell(2).font = { name: FONT, size: 10 };
  row.getCell(1).alignment = { vertical: 'top' };
  row.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
wb.xlsx.writeFile(OUT).then(() => {
  console.log(JSON.stringify({
    out: path.relative(ROOT, OUT), tests: tests.length, rtmRows: rows.length, requirements: reqTargets.length,
    covered: reqCovered, notCovered: reqNotCovered, crossCutRows: rows.filter((x) => x.api === CROSS).length,
    lastRun: { date: RUN_DATE, pass: count((x) => x.result === 'Pass'), fail: count((x) => x.result === 'Fail'), skipped: count((x) => x.result === 'Skipped') },
  }, null, 1));
});
