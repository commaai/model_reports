function seriesColor(i) {
  let h = (i * 137.508) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

const metricGeneralFormat = d3.format(".6~g");
const metricScientificFormat = d3.format(".3~e");
const LEGEND_RUN_LABEL_MAX_LENGTH = 64;
const LEGEND_LABEL_MAX_LENGTH = 96;

function formatMetricValue(v) {
  if (v == null || !isFinite(v)) return "";
  let absV = Math.abs(v);
  return absV !== 0 && (absV < 1e-3 || absV >= 1e5) ? metricScientificFormat(v) : metricGeneralFormat(v);
}

function truncateLabel(label, maxLength) {
  return label.length > maxLength ? label.substring(0, maxLength - 3) + "..." : label;
}

function setStatus(msg) {
  let el = document.getElementById("experiment-status");
  if (!el) {
    el = document.createElement("span");
    el.id = "experiment-status";
    el.style.cssText = "font-size:12px;color:#7f8fa6;margin-left:auto";
    document.getElementById("header").appendChild(el);
  }
  el.textContent = msg;
}

async function showExperiment(runIds) {
  document.getElementById("table-view").style.display = "none";
  document.getElementById("compare-bar").style.display = "none";
  document.getElementById("experiment-view").style.display = "block";
  document.getElementById("nav-back").style.display = "inline";
  let indexStatus = document.getElementById("index-status");
  if (indexStatus) indexStatus.style.display = "none";
  let metaPanel = document.getElementById("meta-panel");
  let tabBar = document.getElementById("tab-bar");
  let tabContent = document.getElementById("tab-content");
  tabContent.innerHTML = "";
  tabBar.innerHTML = "";
  let t0 = performance.now();
  let allMeta = await Promise.all(runIds.map(async id => {
    let resp = await fetch(`/api/runs/${id}`);
    return {id, meta: await resp.json()};
  }));
  setStatus(`fetched meta (${runIds.length}, in ${(performance.now() - t0).toFixed(0)}ms)`);
  let displayNames = {};
  for (let {id, meta} of allMeta) displayNames[id] = meta.display_name || "";
  metaPanel.innerHTML = "";
  for (let {id, meta} of allMeta) {
    let box = document.createElement("div");
    if (allMeta.length > 1) box.style.cssText = "margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #e1e5ea";
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <input class="rename" data-run-id="${id}" value="${(meta.display_name || "").replace(/"/g, '&quot;')}" />
        <span class="rename-hint" style="display:none;font-size:12px;color:#7f8fa6">press enter to rename</span>
      </div>
      <div class="meta-row" style="margin-top:4px">
        <div><span>id:</span> <a href="/${id}">${id}</a></div>
        <div><span>trainer:</span> ${meta.trainer || "?"}</div>
        <div><span>status:</span> ${meta.status || "?"}</div>
        <div><span>branch:</span> ${meta.branch || "?"}</div>
        <div><span>dirty:</span> ${meta.dirty === 1 ? "true" : "false"}</div>
        <div><span>commit:</span> ${meta.commit_hash || "?"}</div>
        <div><span>job:</span> ${meta.slurm_job_id || "?"}</div>
        <div><span>job name:</span> ${meta.slurm_job_name || "?"}</div>
        <div><span>host:</span> ${meta.hostname || "?"}</div>
        <div><span>created:</span> ${meta.created_at ? new Date(parseFloat(meta.created_at) * 1000).toLocaleString() : "?"}</div>
      </div>
      ${meta.command ? `<div class="meta-row" style="margin-top:4px"><div><span>cmd:</span> <code>${meta.command}</code></div></div>` : ""}`;
    metaPanel.appendChild(box);
    let input = box.querySelector("input.rename");
    let hint = box.querySelector(".rename-hint");
    let saved = input.value;
    function updateHint() {
      hint.style.display = input.value.trim() !== saved ? "inline" : "none";
    }
    input.addEventListener("input", updateHint);
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      let name = input.value.trim();
      if (name === saved) return;
      await fetch(`/api/runs/${id}`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({display_name: name})});
      saved = name;
      updateHint();
      input.blur();
      let toast = document.createElement("span");
      toast.textContent = "renamed";
      toast.style.cssText = "font-size:12px;color:#22863a;margin-left:8px;transition:opacity 0.3s";
      input.parentElement.appendChild(toast);
      setTimeout(() => { toast.style.opacity = "0"; }, 600);
      setTimeout(() => { toast.remove(); }, 800);
    });
  }
  let allHparams = {};
  let hparamResults = await Promise.all(runIds.map(async id => {
    let resp = await fetch(`/api/runs/${id}/hparams`);
    return {id, hparams: await resp.json()};
  }));
  for (let {id, hparams} of hparamResults) allHparams[id] = hparams;
  let hasHparams = hparamResults.some(({hparams}) => Object.keys(hparams).length > 0);
  let tabs = [{id: "metrics", label: "metrics"}];
  if (hasHparams) tabs.push({id: "hparams", label: "hparams"});
  tabs.push({id: "git", label: "git"});
  let allReports = {};
  let reportResults = await Promise.all(runIds.map(async id => {
    let resp = await fetch(`/api/runs/${id}/reports`);
    return {id, reports: (await resp.json()).reports};
  }));
  let reportNames = new Set();
  for (let {reports} of reportResults)
    for (let name of Object.keys(reports)) reportNames.add(name);
  for (let {id, reports} of reportResults) allReports[id] = reports;
  for (let name of [...reportNames].sort())
    tabs.push({id: `report:${name}`, label: name});
  for (let tab of tabs) {
    let btn = document.createElement("a");
    btn.textContent = tab.label;
    btn.className = "tab";
    btn.onclick = () => activateTab(tab.id, runIds, allReports, allHparams, tabs, displayNames);
    tabBar.appendChild(btn);
  }
  activateTab("metrics", runIds, allReports, allHparams, tabs, displayNames);
}

async function activateTab(tabId, runIds, reportData, hparamData, tabs, displayNames) {
  let tabBar = document.getElementById("tab-bar");
  let tabContent = document.getElementById("tab-content");
  tabContent.innerHTML = "";
  let tabLabel = tabId.startsWith("report:") ? tabId.replace("report:", "") : tabId;
  for (let btn of tabBar.querySelectorAll(".tab"))
    btn.classList.toggle("active", btn.textContent === tabLabel);
  let t0 = performance.now();
  if (tabId === "metrics") {
    await renderMetrics(runIds, tabContent, displayNames);
    setStatus(`fetched metrics (${runIds.length}, in ${(performance.now() - t0).toFixed(0)}ms)`);
  } else if (tabId === "hparams") {
    renderHparams(runIds, hparamData, tabContent, displayNames);
    setStatus(`fetched hparams (${runIds.length}, in ${(performance.now() - t0).toFixed(0)}ms)`);
  } else if (tabId === "git") {
    await renderGitInfo(runIds, tabContent);
    setStatus(`fetched git (${runIds.length}, in ${(performance.now() - t0).toFixed(0)}ms)`);
  } else {
    let name = tabId.replace("report:", "");
    if (runIds.length > 4) {
      tabContent.innerHTML = '<p style="color:#7f8fa6;margin:2rem">not displaying tests for more than 4 runs selected</p>';
    } else {
      let runs = runIds.filter(id => reportData[id] && reportData[id][name]);
      await renderReports(runs, name, reportData, tabContent, displayNames);
      setStatus(`fetched report ${name} (${runs.length}, in ${(performance.now() - t0).toFixed(0)}ms)`);
    }
  }
}

function shortLabel(id, displayNames) {
  let name = displayNames && displayNames[id] ? displayNames[id] : id.substring(0, 8);
  return truncateLabel(name, LEGEND_RUN_LABEL_MAX_LENGTH);
}

function formatLabel(runIds, id, key, chartTitle, displayNames) {
  let suffix = key.slice(chartTitle.length).replace(/\/$/, "");  // certain keys have trailing slash
  let label = runIds.length > 1 ? shortLabel(id, displayNames) + suffix : key;
  return truncateLabel(label, LEGEND_LABEL_MAX_LENGTH);
}

const DEFAULT_LAYOUT = [
  {"pattern": "([^/]+)/([^/]+)/.*", "group_by": "$1/$2", "supergroup_by": "$1"},
  {"pattern": "([^/]+)/.*",          "group_by": "$1",    "supergroup_by": "/"},
];

function substituteMatch(template, m) {
  let s = template;
  for (let i = 1; i < m.length; i++) s = s.replace("$" + i, m[i]);
  return s;
}

function applyLayout(rules, metricKeys) {
  let superGroups = {};
  for (let key of metricKeys) {
    let superTitle = "/", title = key;
    for (let rule of rules) {
      let m = key.match(new RegExp("^" + rule.pattern + "$"));
      if (m) {
        title = substituteMatch(rule.group_by, m);
        superTitle = rule.supergroup_by
          ? substituteMatch(rule.supergroup_by, m)
          : (title.indexOf("/") >= 0 ? title.substring(0, title.indexOf("/")) : "/");
        break;
      }
    }
    if (!superGroups[superTitle]) superGroups[superTitle] = {};
    if (!superGroups[superTitle][title]) superGroups[superTitle][title] = [];
    superGroups[superTitle][title].push(key);
  }
  return superGroups;
}

async function renderMetrics(runIds, container, displayNames) {
  let [allMetrics, layoutRules] = await Promise.all([
    Promise.all(runIds.map(async id => {
      let resp = await fetch(`/api/runs/${id}/metrics`);
      let data = await resp.json();
      return {id, metrics: data.metrics};
    })),
    fetch(`/api/runs/${runIds[0]}/layout`).then(r => r.json()),
  ]);
  let metricKeys = new Set();
  for (let {metrics} of allMetrics)
    for (let row of metrics)
      for (let k of Object.keys(row))
        if (k !== "step") metricKeys.add(k);
  let rules = Array.isArray(layoutRules) && layoutRules.length > 0 ? layoutRules : DEFAULT_LAYOUT;
  let loc = (a, b) => a.localeCompare(b, undefined, {sensitivity: "base"});
  let superGroups = applyLayout(rules, [...metricKeys].sort(loc));
  let searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "search charts...";
  searchInput.style.cssText = "margin-bottom:12px;padding:4px 8px;font-size:13px;border:1px solid #c8d4e3;border-radius:4px;width:100%;";
  container.appendChild(searchInput);
  let chartsDiv = document.createElement("div");
  chartsDiv.id = "charts";
  container.appendChild(chartsDiv);
  searchInput.addEventListener("input", () => {
    let q = searchInput.value.toLowerCase();
    for (let section of chartsDiv.querySelectorAll(".super-group")) {
      let anyVisible = false;
      for (let box of section.querySelectorAll(".chart-box")) {
        let visible = box.querySelector("h3").textContent.toLowerCase().includes(q);
        box.style.display = visible ? "" : "none";
        if (visible) anyVisible = true;
      }
      section.style.display = anyVisible ? "" : "none";
    }
  });
  let pinSort = (pin, last) => (a, b) => {
    let aPin = a === pin || a.endsWith("/" + pin);
    let bPin = b === pin || b.endsWith("/" + pin);
    if (aPin !== bPin) return aPin === last ? 1 : -1;
    return loc(a, b);
  };
  for (let superTitle of Object.keys(superGroups).sort(pinSort("/", true))) {
    let chartTitles = Object.keys(superGroups[superTitle]).sort(pinSort("loss", false));
    let section = document.createElement("div");
    section.className = "super-group";
    let header = document.createElement("div");
    header.className = "super-group-header";
    header.innerHTML = `<span class="super-group-toggle">▼</span>${superTitle}`;
    section.appendChild(header);
    let body = document.createElement("div");
    body.className = "super-group-body";
    section.appendChild(body);
    header.addEventListener("click", () => {
      let collapsed = body.style.display === "none";
      body.style.display = collapsed ? "" : "none";
      header.querySelector(".super-group-toggle").textContent = collapsed ? "▼" : "▶";
    });
    chartsDiv.appendChild(section);
    for (let chartTitle of chartTitles) {
      let keys = superGroups[superTitle][chartTitle];
      let box = document.createElement("div");
      box.className = "chart-box";
      let title = document.createElement("h3");
      title.textContent = chartTitle;
      box.appendChild(title);
      let plotEl = document.createElement("div");
      box.appendChild(plotEl);
      body.appendChild(box);
      let series = [{label: "step"}];
      let stepSet = new Set();
      let seriesData = [];
      let colorIdx = 0;
      for (let i = 0; i < allMetrics.length; i++) {
        let {id, metrics} = allMetrics[i];
        for (let key of keys) {
          let stepToVal = new Map();
          for (let row of metrics) {
            if (row[key] !== undefined) {
              stepToVal.set(row.step, row[key]);
              stepSet.add(row.step);
            }
          }
          if (stepToVal.size === 0) continue;
          let label = formatLabel(runIds, id, key, chartTitle, displayNames);
          series.push({label, stroke: seriesColor(colorIdx), width: 1.5, spanGaps: true, value: (self, val) => formatMetricValue(val)});
          seriesData.push(stepToVal);
          colorIdx++;
        }
      }
      if (stepSet.size === 0) continue;
      let xData = [...stepSet].sort((a, b) => a - b);
      let yDatas = seriesData.map(stepToVal => xData.map(s => stepToVal.get(s) ?? null));
      let allVals = yDatas.flatMap(d => d.filter(v => v != null && isFinite(v)));
      allVals.sort((a, b) => a - b);
      let yRange = null;
      if (allVals.length > 4) {
        let lo = allVals[Math.floor(allVals.length * 0.05)];
        let hi = allVals[Math.ceil(allVals.length * 0.95) - 1];
        let pad = (hi - lo) * 0.05 || 1e-6;
        yRange = [lo - pad, hi + pad];
      }
      let chartW = Math.min(570, window.innerWidth - 80);
      let opts = {
        width: chartW, height: 280,
        scales: {
          x: {time: false},
          y: yRange ? {range: () => yRange} : {},
        },
        axes: [
          {stroke: "#7f8fa6", grid: {stroke: "#e1e5ea"}},
          {stroke: "#7f8fa6", grid: {stroke: "#e1e5ea"}, values: (self, splits) => splits.map(formatMetricValue)},
        ],
        series: series,
        cursor: {drag: {x: true, y: true, uni: 25}},
      };
      let plot = new uPlot(opts, [xData, ...yDatas], plotEl);
      attachUPlotDownloadButton(box, plot, `${superTitle}/${chartTitle}`, {
        xLabel: "step",
        xData: xData,
        series: series.slice(1).map((entry, idx) => ({label: entry.label, values: yDatas[idx]})),
      });
      plotEl.addEventListener("dblclick", () => {
        let fullMin = allVals[0], fullMax = allVals[allVals.length - 1];
        let fullPad = (fullMax - fullMin) * 0.05 || 1e-6;
        plot.setScale("x", {min: xData[0], max: xData[xData.length - 1]});
        plot.setScale("y", {min: fullMin - fullPad, max: fullMax + fullPad});
      });
    }
  }
}

function flattenObj(obj, prefix) {
  let out = {};
  for (let [k, v] of Object.entries(obj)) {
    let key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenObj(v, key));
    else out[key] = v;
  }
  return out;
}

function renderHparams(runIds, hparamData, container, displayNames) {
  let allFlat = runIds.map(id => flattenObj(hparamData[id] || {}, ""));
  let allKeys = new Set();
  for (let flat of allFlat) for (let k of Object.keys(flat)) allKeys.add(k);
  let keys = [...allKeys].sort();
  let table = document.createElement("table");
  table.className = "hparam-table";
  let thead = `<tr><th>parameter</th>${runIds.map((id, i) => {
    if (runIds.length === 1) return `<th>value</th>`;
    let name = displayNames && displayNames[id] ? displayNames[id] : "";
    return `<th>${id}${name ? `<br>${name}` : ""}</th>`;
  }).join("")}</tr>`;
  let tbody = keys.map(k => {
    let vals = allFlat.map(f => f[k]);
    let differ = runIds.length > 1 && new Set(vals.map(v => JSON.stringify(v))).size > 1;
    return `<tr${differ ? ' class="hparam-diff"' : ""}><td>${k}</td>${vals.map(v =>
      `<td>${v === undefined ? "" : String(v)}</td>`).join("")}</tr>`;
  }).join("");
  table.innerHTML = thead + tbody;
  let searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "search hparams keys...";
  searchInput.style.cssText = "margin-bottom:12px;padding:4px 8px;font-size:13px;border:1px solid #c8d4e3;border-radius:4px;width:100%;";
  container.appendChild(searchInput);
  container.appendChild(table);
  searchInput.addEventListener("input", () => {
    let q = searchInput.value.toLowerCase();
    for (let row of table.querySelectorAll("tr:not(:first-child)")) {
      let key = row.querySelector("td").textContent.toLowerCase();
      row.style.display = key.includes(q) ? "" : "none";
    }
  });
}

async function renderGitInfo(runIds, container) {
  let grid = document.createElement("div");
  grid.className = "git-grid";
  grid.style.gridTemplateColumns = `repeat(${Math.min(runIds.length, 4)}, 1fr)`;
  container.appendChild(grid);
  await Promise.all(runIds.map(async id => {
    let [metaResp, diffResp] = await Promise.all([
      fetch(`/api/runs/${id}`),
      fetch(`/api/runs/${id}/diff`),
    ]);
    let meta = await metaResp.json();
    let diff = await diffResp.text();
    let col = document.createElement("div");
    col.className = "git-col";
    if (runIds.length > 1) {
      let header = document.createElement("div");
      header.className = "report-col-header";
      header.innerHTML = `${id}${meta.display_name ? `<br>${meta.display_name}` : ""}`;
      col.appendChild(header);
    }
    let info = document.createElement("div");
    info.className = "git-info";
    info.innerHTML = `<div><span>branch:</span> ${meta.branch || "?"}${meta.dirty === 1 ? " (dirty)" : ""}</div>` +
      `<div><span>commit:</span> ${meta.commit_hash || "?"}</div>`;
    col.appendChild(info);
    let pre = document.createElement("pre");
    pre.className = "diff-view";
    if (diff.trim()) {
      for (let line of diff.split("\n")) {
        let span = document.createElement("span");
        span.textContent = line;
        if (line.startsWith("+") && !line.startsWith("+++")) span.className = "diff-add";
        else if (line.startsWith("-") && !line.startsWith("---")) span.className = "diff-del";
        else if (line.startsWith("@@")) span.className = "diff-hunk";
        else if (line.startsWith("diff ")) span.className = "diff-header";
        pre.appendChild(span);
        pre.appendChild(document.createTextNode("\n"));
      }
    } else {
      pre.textContent = "clean (no diff)";
      pre.style.color = "#7f8fa6";
    }
    col.appendChild(pre);
    grid.appendChild(col);
  }));
}

async function renderReports(runIds, name, allReports, container, displayNames) {
  let grid = document.createElement("div");
  grid.className = "report-grid";
  grid.style.gridTemplateColumns = `repeat(${Math.min(runIds.length, 4)}, 1fr)`;
  container.appendChild(grid);
  let iframes = [];
  for (let runId of runIds) {
    let steps = allReports[runId][name];
    let col = document.createElement("div");
    col.className = "report-col";
    let header = document.createElement("div");
    header.className = "report-col-header";
    let dn = displayNames && displayNames[runId] ? displayNames[runId] : "";
    header.innerHTML = `${runId}${dn ? `<br>${dn}` : ""}`;
    col.appendChild(header);
    let controls = document.createElement("div");
    controls.className = "report-controls";
    let listId = `ticks-${runId}-${name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    let opts = steps.map((s, i) => `<option value="${i}" label="${i === 0 || i === steps.length - 1 ? s : ""}"></option>`).join("");
    controls.innerHTML = `<input type="range" min="0" max="${steps.length - 1}" value="${steps.length - 1}" list="${listId}">` +
      `<datalist id="${listId}">${opts}</datalist>` +
      `<span>step ${steps[steps.length - 1]}</span>`;
    let slider = controls.querySelector("input");
    let label = controls.querySelector("span");
    col.appendChild(controls);
    let iframe = document.createElement("iframe");
    iframe.className = "report-iframe";
    iframe.height = window.innerHeight;
    col.appendChild(iframe);
    grid.appendChild(col);
    iframes.push({runId, steps, iframe, slider, label});
  }
  async function loadAll(getStep) {
    await Promise.all(iframes.map(async ({runId, steps, iframe}) => {
      let step = getStep(steps);
      iframe.src = window.REPORTERV2_REPORT_PATHS[runId][name][step];
    }));
  }
  await loadAll(steps => steps[steps.length - 1]);
  for (let {runId, steps, iframe, slider, label} of iframes) {
    slider.addEventListener("input", () => {
      let step = steps[parseInt(slider.value)];
      label.textContent = `step ${step}`;
      iframe.src = window.REPORTERV2_REPORT_PATHS[runId][name][step];
    });
  }
}
