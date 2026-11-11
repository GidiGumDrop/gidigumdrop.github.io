"use strict";

const SHORT = {
  "GPT-5.6 Sol": "Sol", "GPT-5.6 Luna": "Luna", "Claude Opus 5.5": "Opus", "Claude Haiku 5.5": "Haiku",
  "Gemini 3.8 Flash": "Gemini Flash", "GLM-5.3 (high)": "GLM-5.3", "DeepSeek V4.1 Flash": "DeepSeek",
  "Muse Glimmer 30B": "Muse 30B", "Gemma 4 26B A4B": "Gemma 26B", "Qwen 3.8 27B": "Qwen 27B",
  "Nemotron 3.5 Lightning": "Nemotron", "Granite 4.2 3B": "Granite 3B", "Granite 4.2 8B": "Granite 8B",
};
const DATASET_SHORT = { "ASPBench": "ASP", "GridPuzzles": "Grid", "ZebraLogic": "Zebra", "Sudoku-Bench": "Sudoku", "LPCP": "LPCP" };
const OUTCOMES = [["solved", "Solved"], ["wrong", "Wrong answer"], ["error", "Program or harness error"], ["timeout", "Timed out"]];
const SVGNS = "http://www.w3.org/2000/svg";

const short = m => SHORT[m] || m;
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const money = v => v == null ? "local GPU" : "$" + (v >= 0.1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let DATA = null;
const harnessName = h => DATA.harnesses[h].name;

/* ---------- SVG helpers ---------- */
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function text(parent, x, y, s, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = s;
  return t;
}
function svgFor(container, w, h) {
  container.innerHTML = "";
  return el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, preserveAspectRatio: "xMinYMin meet" }, container);
}
function marker(parent, x, y, harness, r = 5) {
  return harness === "agent"
    ? el("circle", { cx: x, cy: y, r, style: "fill:var(--agent);stroke:var(--surface);stroke-width:2" }, parent)
    : el("circle", { cx: x, cy: y, r: r - 0.5, style: "fill:var(--surface);stroke:var(--one-call);stroke-width:2.25" }, parent);
}

/* ---------- Tooltip ---------- */
const tip = document.getElementById("tip");
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14, r = tip.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
function hideTip() { tip.hidden = true; }
function hover(node, html) {
  node.addEventListener("pointermove", e => showTip(e, html));
  node.addEventListener("pointerdown", e => showTip(e, html));
  node.addEventListener("pointerleave", hideTip);
}
document.addEventListener("scroll", hideTip, { passive: true });

const entryTip = e => `<b>${esc(e.model)}</b><span class="muted">${harnessName(e.harness)}</span><br>` +
  `${pct(e.solve_rate)} solved <span class="muted">(95%: ${pct(e.ci[0], 0)}–${pct(e.ci[1], 0)})</span><br>` +
  `${money(e.cost_per_problem)}${e.cost_per_problem == null ? "" : " per problem"} · ${e.minutes_per_problem.toFixed(1)} min`;

/* ---------- Header facts ---------- */
function renderFacts() {
  const n = DATA.entries.length;
  const models = new Set(DATA.entries.map(e => e.model)).size;
  const problems = Object.values(DATA.datasets).reduce((a, b) => a + b, 0);
  const runs = DATA.entries.reduce((a, e) => a + e.runs * e.problems, 0);
  const facts = [[problems, "problems"], [Object.keys(DATA.datasets).length, "datasets"], [models, "models"],
    [Object.keys(DATA.harnesses).length, "harnesses"], [n, "entries"], [runs.toLocaleString("en-US"), "problem runs"]];
  document.getElementById("facts").innerHTML = facts.map(([v, l]) => `<li><b>${v}</b>${l}</li>`).join("");
  for (const td of document.querySelectorAll("[data-ds]")) td.textContent = DATA.datasets[td.dataset.ds];
  document.getElementById("harnesses").innerHTML = Object.values(DATA.harnesses)
    .map(h => `<dt>${esc(h.name)}</dt><dd>${esc(h.description)}. Output cap ${(h.output_cap / 1024)}k tokens per call.</dd>`).join("");
  document.getElementById("updated").textContent = `Updated ${DATA.generated}`;
}

/* ---------- Leaderboard table ---------- */
const state = { filter: "all", sort: "rank", dir: 1, open: new Set() };
const SORT_DEFAULT_DIR = { rank: 1, model: 1, harness: 1, solve_rate: -1, pass_all: -1, cost_per_problem: 1, minutes_per_problem: 1 };

function sortedEntries() {
  const k = state.sort, d = state.dir;
  return DATA.entries.filter(e => state.filter === "all" || e.harness === state.filter).slice().sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === "cost_per_problem") { x = x ?? Infinity; y = y ?? Infinity; }
    if (typeof x === "string") return d * x.localeCompare(y) || b.solve_rate - a.solve_rate;
    return d * (x - y) || b.solve_rate - a.solve_rate;
  });
}

function detailsHTML(e) {
  const ds = Object.entries(e.datasets).map(([d, v]) => `<dt>${esc(d)}</dt><dd>${pct(v)}</dd>`).join("");
  const n = e.runs * e.problems;
  const oc = OUTCOMES.map(([k, l]) => `<dt>${l}</dt><dd>${e.outcomes[k]} <span class="local">(${pct(e.outcomes[k] / n, 0)})</span></dd>`).join("");
  return `<div class="det">
    <div><h4>Solve rate by dataset</h4><dl class="kv">${ds}</dl></div>
    <div><h4>Runs</h4><dl class="kv">
      <dt>Per run</dt><dd>${e.run_rates.map(v => pct(v)).join(" · ")}</dd>
      <dt>Solved in any run</dt><dd>${pct(e.pass_any)}</dd>
      <dt>Solved every run</dt><dd>${pct(e.pass_all)}</dd>
    </dl><h4 style="margin-top:10px">How the ${n} problem runs ended</h4><dl class="kv">${oc}</dl></div>
  </div>`;
}

function renderTable() {
  const tbody = document.querySelector("#lb tbody");
  const rows = sortedEntries().map(e => {
    const open = state.open.has(e.id);
    const tags = e.open_weights ? `<span class="tag hide-sm">open weights</span>` : "";
    const main = `<tr class="row" tabindex="0" data-id="${e.id}" aria-expanded="${open}">
      <td class="num rank">${e.rank}</td>
      <td><i class="dot ${e.harness} show-sm" title="${harnessName(e.harness)}"></i><span class="model">${esc(e.model)}</span>${tags}</td>
      <td class="hide-sm"><span class="harness"><i class="dot ${e.harness}"></i>${harnessName(e.harness)}</span></td>
      <td><div class="rate"><b>${pct(e.solve_rate)}</b><span class="bar" title="95% interval ${pct(e.ci[0])}–${pct(e.ci[1])}">
        <span class="fill" style="width:${e.solve_rate * 100}%;background:var(--${e.harness})"></span>
        <span class="ci" style="left:${e.ci[0] * 100}%;width:${(e.ci[1] - e.ci[0]) * 100}%"></span></span></div></td>
      <td class="num">${pct(e.pass_all, 0)}</td>
      <td class="num${e.cost_per_problem == null ? " local" : ""}">${money(e.cost_per_problem)}</td>
      <td class="num hide-sm">${e.minutes_per_problem.toFixed(1)} min</td>
    </tr>`;
    return main + (open ? `<tr class="details"><td colspan="7">${detailsHTML(e)}</td></tr>` : "");
  });
  tbody.innerHTML = rows.join("");
  for (const th of document.querySelectorAll("#lb th[data-sort]")) {
    th.setAttribute("aria-sort", th.dataset.sort === state.sort ? (state.dir > 0 ? "ascending" : "descending") : "none");
  }
}

function setupTable() {
  for (const th of document.querySelectorAll("#lb th[data-sort]")) {
    th.tabIndex = 0;
    const go = () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = SORT_DEFAULT_DIR[k]; }
      renderTable();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  const tbody = document.querySelector("#lb tbody");
  const toggle = tr => {
    const id = tr.dataset.id;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    renderTable();
    tbody.querySelector(`tr[data-id="${id}"]`)?.focus();
  };
  tbody.addEventListener("click", e => { const tr = e.target.closest("tr.row"); if (tr) toggle(tr); });
  tbody.addEventListener("keydown", e => {
    const tr = e.target.closest("tr.row");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(tr); }
  });
  for (const chip of document.querySelectorAll(".chip")) {
    chip.addEventListener("click", () => {
      state.filter = chip.dataset.filter;
      for (const c of document.querySelectorAll(".chip")) c.setAttribute("aria-pressed", c === chip);
      renderTable();
    });
  }
}

/* ---------- Chart 1: accuracy against cost ---------- */
function frontier(entries) {
  const pts = entries.filter(e => e.cost_per_problem != null).sort((a, b) => a.cost_per_problem - b.cost_per_problem);
  const out = [];
  for (const e of pts) if (!out.length || e.solve_rate > out[out.length - 1].solve_rate) out.push(e);
  return out;
}

function renderScatter() {
  const box = document.getElementById("c-scatter");
  const W = box.clientWidth, narrow = W < 560;
  const H = Math.round(Math.min(440, Math.max(320, W * 0.48)));
  const m = { l: 40, r: 14, t: 12, b: 44 };
  const band = narrow ? 44 : 64, gap = 18;
  const x0 = m.l + band + gap, x1 = W - m.r, y0 = H - m.b, y1 = m.t;
  const lo = Math.log10(0.002), hi = Math.log10(0.4);
  const X = v => x0 + (Math.log10(v) - lo) / (hi - lo) * (x1 - x0);
  const Y = v => y0 - v * (y0 - y1);
  const svg = svgFor(box, W, H);

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    el("line", { x1: m.l, x2: x1, y1: Y(t), y2: Y(t), class: t === 0 ? "baseline" : "gridline" }, svg);
    text(svg, m.l - 6, Y(t) + 4, pct(t, 0), { "text-anchor": "end", class: "axis-label" });
  }
  const ticks = narrow ? [0.002, 0.01, 0.05, 0.2] : [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2];
  for (const t of ticks) {
    el("line", { x1: X(t), x2: X(t), y1: y0, y2: y0 + 4, class: "baseline" }, svg);
    text(svg, X(t), y0 + 17, "$" + (t >= 0.1 ? t.toFixed(1) : t >= 0.01 ? t.toFixed(2) : t.toFixed(3)), { "text-anchor": "middle", class: "axis-label" });
  }
  text(svg, (x0 + x1) / 2, H - 6, "API cost per problem (log scale)", { "text-anchor": "middle", class: "axis-label" });
  // Local GPU band: no API cost, so these sit in their own column left of the cost axis.
  const bx = m.l + band / 2;
  el("rect", { x: m.l + 4, y: y1, width: band - 8, height: y0 - y1, rx: 6, style: "fill:var(--page)" }, svg);
  text(svg, bx, y0 + 17, "local", { "text-anchor": "middle", class: "axis-label" });
  text(svg, bx, H - 6, "GPU", { "text-anchor": "middle", class: "axis-label" });

  const entries = DATA.entries;
  const pos = e => e.cost_per_problem == null ? [bx, Y(e.solve_rate)] : [X(e.cost_per_problem), Y(e.solve_rate)];

  const f = frontier(entries);
  let d = "";
  f.forEach((e, i) => {
    const [x, y] = pos(e);
    if (i === 0) d += `M${x},${y}`;
    else { d += `H${x}V${y}`; }
  });
  el("path", { d, style: "fill:none;stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 4" }, svg);

  // Label placement: frontier first, then by solve rate; try 8 spots, skip if all collide.
  // The points and the frontier's segments are obstacles, so labels never sit on the dashed line.
  const obstacles = entries.map(e => { const [x, y] = pos(e); return { x: x - 7, y: y - 7, w: 14, h: 14 }; });
  for (let i = 1; i < f.length; i++) {
    const [ax, ay] = pos(f[i - 1]), [bx2, by] = pos(f[i]);
    obstacles.push({ x: ax, y: ay - 2, w: bx2 - ax, h: 4 }, { x: bx2 - 2, y: by, w: 4, h: ay - by });
  }
  const fits = r => r.x >= m.l && r.x + r.w <= W - 2 && r.y >= 0 && r.y + r.h <= y0 &&
    !obstacles.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  const order = [...f, ...entries.filter(e => !f.includes(e)).sort((a, b) => b.solve_rate - a.solve_rate)];
  const labels = el("g", {}, svg);
  for (const e of order) {
    const [x, y] = pos(e);
    const s = short(e.model), w = s.length * 6.1 + 2, h = 13;
    const local = e.cost_per_problem == null;
    const spots0 = local
      ? [[x + 9, y - h / 2, "start"], [x - 9 - w, y - h / 2, "start"]]
      : [[x + 8, y - h / 2, "start"], [x - 8 - w, y - h / 2, "start"], [x - w / 2, y - 8 - h, "start"],
        [x - w / 2, y + 8, "start"], [x + 6, y - 6 - h, "start"], [x + 6, y + 6, "start"],
        [x - 6 - w, y - 6 - h, "start"], [x - 6 - w, y + 6, "start"]];
    const spots = f.includes(e) && !local ? [spots0[1], spots0[2], spots0[6], spots0[3], spots0[7], ...spots0] : spots0;
    for (const [lx, ly] of spots) {
      const r = { x: lx, y: ly, w, h };
      if (local ? !obstacles.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) && r.y >= 0 : fits(r)) {
        obstacles.push(r);
        text(labels, lx, ly + 10, s);
        break;
      }
    }
  }
  const dots = el("g", {}, svg);
  for (const e of entries) { const [x, y] = pos(e); marker(dots, x, y, e.harness); }
  for (const e of entries) {
    const [x, y] = pos(e);
    hover(el("circle", { cx: x, cy: y, r: 11, class: "hit" }, svg), entryTip(e));
  }
}

/* ---------- Chart 2: harness lift ---------- */
function renderLift() {
  const box = document.getElementById("c-lift");
  const W = box.clientWidth;
  const pairs = [];
  for (const a of DATA.entries.filter(e => e.harness === "agent")) {
    const b = DATA.entries.find(e => e.harness === "one-call" && e.model === a.model);
    if (b) pairs.push({ model: a.model, agent: a, one: b, gain: a.solve_rate - b.solve_rate });
  }
  pairs.sort((p, q) => q.gain - p.gain);
  const row = 46, m = { t: 8, b: 30 };
  const labelW = W < 420 ? 64 : 112, annW = 76;
  const x0 = labelW, x1 = W - annW - 8;
  const H = m.t + pairs.length * row + m.b;
  const X = v => x0 + v * (x1 - x0);
  const svg = svgFor(box, W, H);
  const yb = H - m.b;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    el("line", { x1: X(t), x2: X(t), y1: m.t, y2: yb, class: t === 0 ? "baseline" : "gridline" }, svg);
    text(svg, X(t), yb + 16, pct(t, 0), { "text-anchor": "middle", class: "axis-label" });
  }
  pairs.forEach((p, i) => {
    const y = m.t + i * row + row / 2;
    text(svg, 0, y + 4, W < 420 ? short(p.model) : p.model, { style: "fill:var(--ink)" });
    el("line", { x1: X(p.one.solve_rate), x2: X(p.agent.solve_rate), y1: y, y2: y, style: "stroke:var(--axis);stroke-width:3;stroke-linecap:round" }, svg);
    marker(svg, X(p.one.solve_rate), y, "one-call", 6);
    marker(svg, X(p.agent.solve_rate), y, "agent", 6);
    const mult = p.agent.cost_per_problem / p.one.cost_per_problem;
    text(svg, W - annW, y - 1, `+${Math.round(p.gain * 100)} pts`, { style: "fill:var(--ink);font-weight:600;font-size:12px" });
    text(svg, W - annW, y + 13, `${mult.toFixed(1)}× cost`, { class: "axis-label" });
    const html = `<b>${esc(p.model)}</b>One call ${pct(p.one.solve_rate)} → Agent ${pct(p.agent.solve_rate)}<br>` +
      `<span class="muted">Cost per problem ${money(p.one.cost_per_problem)} → ${money(p.agent.cost_per_problem)}</span>`;
    hover(el("rect", { x: 0, y: y - row / 2, width: W, height: row, class: "hit" }, svg), html);
  });
}

/* ---------- Row labels shared by heatmap and outcome bars ---------- */
function rowLabel(svg, e, y, narrow) {
  marker(svg, 5, y, e.harness, 4.5);
  text(svg, 16, y + 4, narrow ? short(e.model) : e.model, { style: "fill:var(--ink)" });
}

/* ---------- Chart 3: accuracy by dataset ---------- */
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function renderHeat() {
  const box = document.getElementById("c-heat");
  const W = box.clientWidth, narrow = W < 480;
  const ds = Object.keys(DATA.datasets);
  const labelW = narrow ? 92 : 170, row = 24, gap = 2, top = 22;
  const cw = (W - labelW) / ds.length;
  const H = top + DATA.entries.length * row;
  const svg = svgFor(box, W, H);
  const loC = css("--heat-lo"), hiC = css("--heat-hi");
  ds.forEach((d, j) => text(svg, labelW + j * cw + cw / 2, 13, cw < 74 ? DATASET_SHORT[d] : d, { "text-anchor": "middle", class: "axis-label" }));
  DATA.entries.forEach((e, i) => {
    const y = top + i * row;
    rowLabel(svg, e, y + row / 2 - 1, narrow);
    ds.forEach((d, j) => {
      const v = e.datasets[d], fill = mix(loC, hiC, v);
      const x = labelW + j * cw;
      const cell = el("rect", { x: x + gap / 2, y: y + gap / 2, width: cw - gap, height: row - gap, rx: 3, fill }, svg);
      text(svg, x + cw / 2, y + row / 2 + 3.5, Math.round(v * 100), {
        "text-anchor": "middle", style: `fill:${lum(fill) > 0.32 ? "#0b0b0b" : "#ffffff"};font-size:11px`,
      });
      hover(cell, `<b>${esc(e.model)}</b><span class="muted">${harnessName(e.harness)} · ${esc(d)} (${DATA.datasets[d]} problems)</span><br>${pct(v)} solved`);
    });
  });
  // Cell values sit on top of the cells; let the pointer pass through them to the cell's tooltip.
  for (const t of svg.querySelectorAll("text")) t.style.pointerEvents = "none";
}

/* ---------- Chart 4: how runs end ---------- */
function renderOutcomes() {
  const box = document.getElementById("c-outcomes");
  const W = box.clientWidth, narrow = W < 560;
  const labelW = narrow ? 92 : 170, row = 24, gap = 2, top = 4;
  const x0 = labelW, x1 = W - 4;
  const H = top + DATA.entries.length * row + 22;
  const svg = svgFor(box, W, H);
  const yb = top + DATA.entries.length * row;
  for (const t of [0, 0.5, 1]) text(svg, x0 + t * (x1 - x0), yb + 15, pct(t, 0), { "text-anchor": t === 0 ? "start" : t === 1 ? "end" : "middle", class: "axis-label" });
  const isDark = css("--surface").toLowerCase() !== "#fcfcfb";
  DATA.entries.forEach((e, i) => {
    const y = top + i * row;
    rowLabel(svg, e, y + row / 2 - 1, narrow);
    const n = e.runs * e.problems;
    let x = x0;
    for (const [k, l] of OUTCOMES) {
      const c = e.outcomes[k];
      if (!c) continue;
      const w = c / n * (x1 - x0);
      const seg = el("rect", { x: x + 1, y: y + 3, width: Math.max(0, w - 2), height: row - 6, rx: 3, style: `fill:var(--o-${k})` }, svg);
      if (w >= 34) {
        const ink = k === "timeout" && !isDark ? "#0b0b0b" : "#ffffff";
        text(svg, x + w / 2, y + row / 2 + 3.5, pct(c / n, 0), { "text-anchor": "middle", style: `fill:${ink};font-size:10.5px;pointer-events:none` });
      }
      hover(seg, `<b>${esc(e.model)}</b><span class="muted">${harnessName(e.harness)}</span><br>${l}: ${c} of ${n} (${pct(c / n)})`);
      x += w;
    }
  });
}

/* ---------- Boot ---------- */
function renderCharts() {
  renderScatter();
  renderLift();
  renderHeat();
  renderOutcomes();
}

fetch("data/leaderboard.json")
  .then(r => r.json())
  .then(d => {
    DATA = d;
    renderFacts();
    setupTable();
    renderTable();
    renderCharts();
    let t;
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      clearTimeout(t);
      t = setTimeout(renderCharts, 120);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCharts);
  })
  .catch(err => {
    document.querySelector("#lb tbody").innerHTML = `<tr><td colspan="7">Could not load the results (${esc(err.message)}).</td></tr>`;
  });
