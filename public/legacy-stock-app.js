(() => {
const API = window.location.origin.startsWith("http") ? window.location.origin + "/api" : "http://localhost:5050/api";
let watchlist = [];
let priceData = [];
let currentPeriod = "1d";
let horizonBands = 3;
let horizonSize  = 26;
let currentScaleMode = "fib-ratios";
let currentDomainMode = "global";
let priceLoadSeq = 0;

// ── Diverging two-color schema (no hue encoding per stock) ──
const posColor = "#18c96a";
const negColor = "#e84040";

// ── API helpers ──
async function apiFetch(path, opts) {
  if (window.__stocksQueryFetch) {
    return window.__stocksQueryFetch(path, opts);
  }
  const r = await fetch(API + path, opts);
  return r.json();
}

async function loadWatchlist() {
  watchlist = await apiFetch("/watchlist");
}

async function loadPrices() {
  const seq = ++priceLoadSeq;
  const symbols = Object.values(watchlist).flat();
  if (!symbols.length) { 
    priceData = []; 
    renderChart(); 
    renderStats();
    return; 
  }

  const benchmarkTicker = getActiveBenchmark();
  let fetchSymbols = [...symbols];
  if (benchmarkTicker !== "none" && !fetchSymbols.includes(benchmarkTicker)) {
    fetchSymbols.push(benchmarkTicker);
  }

  const pricePath = "/prices?symbols=" + fetchSymbols.map(s => encodeURIComponent(s)).join(",") + "&period=" + currentPeriod;
  const cached = window.__stocksGetCachedApi ? window.__stocksGetCachedApi(pricePath) : null;
  const hasCachedPrices = cached && Array.isArray(cached.data);

  if (hasCachedPrices) {
    priceData = cached.data;
    renderChart();
    renderStats();
  }

  document.getElementById("loading").style.display = hasCachedPrices ? "none" : "flex";
  const ridgeline = document.getElementById("ridgeline");
  if (ridgeline && !hasCachedPrices) ridgeline.style.display = "none";

  if (hasCachedPrices && !cached.stale) {
    return;
  }

  try {
    const nextPriceData = await apiFetch(pricePath, { force: Boolean(hasCachedPrices && cached.stale) });
    if (seq !== priceLoadSeq) return;
    priceData = nextPriceData;
    renderChart();
    renderStats();
  } catch (error) {
    if (!hasCachedPrices) {
      priceData = [];
      renderChart();
      renderStats();
      console.error(error);
    }
  } finally {
    if (seq === priceLoadSeq) {
      document.getElementById("loading").style.display = "none";
      if (ridgeline) ridgeline.style.display = "";
    }
  }
}

// ── Delete stock event delegation ──
document.getElementById("chart-area").addEventListener("click", async e => {
  const btn = e.target.closest(".row-del-btn");
  if (!btn) return;
  const sym = btn.dataset.sym;
  watchlist = await apiFetch("/watchlist/" + sym, { method: "DELETE" });
  await loadPrices();
});

// ── Helpers: get active element value (desktop takes priority if visible) ──
function getActiveBenchmark() {
  const d = document.getElementById("benchmark-select-desktop");
  const m = document.getElementById("benchmark-select");
  if (d && d.offsetParent !== null) return d.value;
  return m ? m.value : "none";
}

// ── Add ticker — works from both sidebar (desktop) and mobile form ──
function bindAddForm(formId, inputId, sectorId, errId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const inp = document.getElementById(inputId);
    const secSelect = document.getElementById(sectorId);
    const errEl = document.getElementById(errId);
    const sym = inp.value.trim().toUpperCase();
    const sector = secSelect.value;
    if (errEl) errEl.style.display = "none";
    if (!sym) return;
    inp.value = "";
    const result = await apiFetch("/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym, sector: sector })
    });
    if (result.error) {
      const msg = result.error === "symbol required" ? "请输入股票代码" : result.error;
      if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
      return;
    }
    watchlist = result;
    await loadPrices();
  });
}
bindAddForm("add-form", "add-input", "add-sector", "error-msg");
bindAddForm("add-form-mobile", "add-input-mobile", "add-sector-mobile", "error-msg-mobile");

// ── Benchmark selector (both mobile and desktop) ──
["benchmark-select","benchmark-select-desktop"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => loadPrices());
});

// ── Scale selector ──
["scale-mode-select","scale-mode-select-d"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", function() {
    currentScaleMode = this.value;
    // sync both
    ["scale-mode-select","scale-mode-select-d"].forEach(sid => {
      const s = document.getElementById(sid);
      if (s && s !== this) s.value = this.value;
    });
    renderChart();
  });
});

// ── Domain Range selector ──
["domain-mode-select","domain-mode-select-d"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", function() {
    currentDomainMode = this.value;
    ["domain-mode-select","domain-mode-select-d"].forEach(sid => {
      const s = document.getElementById(sid);
      if (s && s !== this) s.value = this.value;
    });
    renderChart();
  });
});

// ── Bands slider ──
["bands-slider","bands-slider-d"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", function() {
    horizonBands = +this.value;
    ["bands-label","bands-label-d"].forEach(lid => {
      const l = document.getElementById(lid); if (l) l.textContent = horizonBands;
    });
    ["bands-slider","bands-slider-d"].forEach(sid => {
      const s = document.getElementById(sid); if (s && s !== this) s.value = horizonBands;
    });
    renderChart();
  });
});

// ── Size slider ──
["size-slider","size-slider-d"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", function() {
    horizonSize = +this.value;
    ["size-label","size-label-d"].forEach(lid => {
      const l = document.getElementById(lid); if (l) l.textContent = horizonSize;
    });
    ["size-slider","size-slider-d"].forEach(sid => {
      const s = document.getElementById(sid); if (s && s !== this) s.value = horizonSize;
    });
    renderChart();
  });
});

// ── Period buttons ──
document.querySelectorAll(".period-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".period-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    loadPrices();
  });
});

// Brown–Blue diverging scheme (4 bands each side, light→dark)
const HORIZON_SCHEME = {
  pos: ["#c6dbef","#6baed6","#2171b5","#084594"],  // blues
  neg: ["#fcbba1","#fb6a4a","#cb181d","#67000d"],  // reds
};


// ── Market status badge — updates both mobile + desktop badges ──
async function updateMarketStatus() {
  try {
    const status = await apiFetch("/market_status");
    const text = status.open ? "LIVE " + status.time_et + " ET" : "CLOSED";
    // Update all badge instances (desktop sidebar + mobile header)
    document.querySelectorAll("#market-status-badge, #market-status-badge-mobile").forEach(badge => {
      if (status.open) badge.classList.add("market-live");
      else badge.classList.remove("market-live");
    });
    document.querySelectorAll(".market-badge-label").forEach(el => {
      el.textContent = text;
    });
    return status.open;
  } catch { return false; }
}

// ── Settings & Info drawer toggles (mobile) ──
const settingsToggle = document.getElementById("settings-toggle-btn");
const settingsDrawer = document.getElementById("settings-drawer");
const infoToggle = document.getElementById("info-toggle-btn");
const infoDrawer = document.getElementById("info-drawer");
if (settingsToggle) {
  settingsToggle.addEventListener("click", () => {
    if(infoToggle) infoToggle.classList.remove("active");
    if(infoDrawer) infoDrawer.classList.remove("expanded");
    settingsToggle.classList.toggle("active");
    if(settingsDrawer) settingsDrawer.classList.toggle("expanded");
  });
}
if (infoToggle) {
  infoToggle.addEventListener("click", () => {
    if(settingsToggle) settingsToggle.classList.remove("active");
    if(settingsDrawer) settingsDrawer.classList.remove("expanded");
    infoToggle.classList.toggle("active");
    if(infoDrawer) infoDrawer.classList.toggle("expanded");
  });
}
// Mobile header duplicates
["settings-toggle-btn-mobile","info-toggle-btn-mobile"].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener("click", () => {
      if (id.includes("settings") && settingsToggle) settingsToggle.click();
      else if (id.includes("info") && infoToggle) infoToggle.click();
    });
  }
});

function getThresholds(scaleMode, bands, maxVal) {
  if (scaleMode === "fib-ratios") {
    let ratios = [0];
    if (bands === 1) {
      ratios = [0, 1];
    } else if (bands === 2) {
      ratios = [0, 0.618, 1];
    } else if (bands === 3) {
      ratios = [0, 0.382, 0.618, 1];
    } else if (bands === 4) {
      ratios = [0, 0.236, 0.382, 0.618, 1];
    } else {
      ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
      while (ratios.length < bands + 1) {
        ratios.splice(ratios.length - 1, 0, (ratios[ratios.length - 2] + 1) / 2);
      }
    }
    return ratios.slice(0, bands + 1).map(r => r * maxVal);
  } else if (scaleMode === "fib-steps") {
    const fib = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377];
    const steps = fib.slice(0, bands + 1);
    const maxStep = steps[steps.length - 1];
    return steps.map(s => (s / maxStep) * maxVal);
  } else {
    return d3.range(bands + 1).map(b => (b / bands) * maxVal);
  }
}

// ── Stats Row Calculations ──
function renderStats() {
  const benchmarkTicker = getActiveBenchmark();
  const bsel = document.getElementById("benchmark-select-desktop") || document.getElementById("benchmark-select");
  const benchmarkName = bsel ? bsel.options[bsel.selectedIndex]?.text || "Benchmark" : "Benchmark";

  // Helper: update a stat card by id
  function fillCard(id, valText, metaText, pillCls, pillText) {
    const card = document.getElementById(id);
    if (!card) return;
    card.querySelector(".stat-val").textContent = valText;
    card.querySelector(".stat-meta").textContent = metaText;
    const pill = card.querySelector(".trend-pill");
    if (pill) {
      if (pillText) { pill.style.display = "block"; pill.className = `trend-pill ${pillCls}`; pill.textContent = pillText; }
      else pill.style.display = "none";
    }
  }
  
  // 1. Benchmark Return
  if (benchmarkTicker === "none") {
    fillCard("stat-benchmark",   "—", "No benchmark selected", "", null);
    fillCard("stat-benchmark-d", "—", "No benchmark", "", null);
  } else {
    const benchEntry = priceData.find(d => d.symbol === benchmarkTicker);
    if (benchEntry && benchEntry.prices && benchEntry.prices.length >= 2) {
      const first = benchEntry.prices[0].close;
      const last  = benchEntry.prices[benchEntry.prices.length - 1].close;
      const pct   = ((last - first) / first * 100).toFixed(2);
      const cls   = pct >= 0 ? "pos" : "neg";
      const pill  = (pct >= 0 ? "▲" : "▼");
      fillCard("stat-benchmark",   `${pct >= 0 ? "+" : ""}${pct}%`, benchmarkName, cls, pill);
      fillCard("stat-benchmark-d", `${pct >= 0 ? "+" : ""}${pct}%`, benchmarkName, cls, pill);
    }
  }

  // 2. Watchlist statistics
  const wlSymbols = Object.values(watchlist).flat();
  const activeEntries = priceData.filter(d => wlSymbols.includes(d.symbol) && d.prices && d.prices.length >= 2);

  if (activeEntries.length === 0) {
    fillCard("stat-gainer",    "—", "No watchlist data",  "", null);
    fillCard("stat-lagger",    "—", "No watchlist data",  "", null);
    fillCard("stat-narrative", "—", "Watchlist average",  "", null);
    fillCard("stat-gainer-d",    "—", "", "", null);
    fillCard("stat-lagger-d",    "—", "", "", null);
    fillCard("stat-narrative-d", "—", "", "", null);
    return;
  }

  const bPct = (() => {
    if (benchmarkTicker === "none") return 0;
    const be = priceData.find(d => d.symbol === benchmarkTicker);
    if (!be || !be.prices || be.prices.length < 2) return 0;
    return (be.prices[be.prices.length-1].close - be.prices[0].close) / be.prices[0].close * 100;
  })();

  const returns = activeEntries.map(entry => {
    const first = entry.prices[0].close;
    const last  = entry.prices[entry.prices.length - 1].close;
    return { symbol: entry.symbol, pct: ((last - first) / first * 100) - bPct };
  });
  returns.sort((a, b) => b.pct - a.pct);

  const top   = returns[0];
  const worst = returns[returns.length - 1];
  const avg   = returns.reduce((s, r) => s + r.pct, 0) / returns.length;
  const prefix = benchmarkTicker !== "none" ? "excess " : "";

  fillCard("stat-gainer",    top.symbol,   `${prefix}return ${top.pct >= 0 ? "+" : ""}${top.pct.toFixed(1)}%`,   "pos", `+${top.pct.toFixed(1)}%`);
  fillCard("stat-lagger",    worst.symbol, `${prefix}return ${worst.pct >= 0 ? "+" : ""}${worst.pct.toFixed(1)}%`, "neg", `${worst.pct.toFixed(1)}%`);
  fillCard("stat-narrative", `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`, benchmarkTicker !== "none" ? "Avg. excess return" : "Avg. watchlist return", avg >= 0 ? "pos" : "neg", avg >= 0 ? "▲" : "▼");

  fillCard("stat-gainer-d",    top.symbol,   `+${top.pct.toFixed(1)}%`,   "pos", `+${top.pct.toFixed(1)}%`);
  fillCard("stat-lagger-d",    worst.symbol, `${worst.pct.toFixed(1)}%`,  "neg", `${worst.pct.toFixed(1)}%`);
  fillCard("stat-narrative-d", `${avg >= 0 ? "+" : ""}${avg.toFixed(2)}%`, avg >= 0 ? "Avg ▲" : "Avg ▼", avg >= 0 ? "pos" : "neg", avg >= 0 ? "▲" : "▼");
}

// ── Sparkline Drawer ──
// Canvas style size is fixed in HTML (162×32). We set the backing-store size
// once to match device pixels — never rescale on repeated calls.
const SPARK_W = 162, SPARK_H = 32;
function drawSparkline(canvas, prices, color) {
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(SPARK_W * dpr);
  const bh = Math.round(SPARK_H * dpr);

  // Only resize the backing store if needed (avoids the accumulation bug)
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width  = bw;
    canvas.height = bh;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset + apply scale
  ctx.clearRect(0, 0, SPARK_W, SPARK_H);

  if (!prices || prices.length < 2) return;

  const closes = prices.map(p => p.raw ?? p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pad = 3;

  const px = (i) => (i / (prices.length - 1)) * SPARK_W;
  const py = (v)  => SPARK_H - pad - ((v - min) / range) * (SPARK_H - pad * 2);

  // Gradient fill
  ctx.beginPath();
  prices.forEach((p, i) => {
    const x = px(i), y = py(closes[i]);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(px(prices.length - 1), SPARK_H);
  ctx.lineTo(0, SPARK_H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, SPARK_H);
  grad.addColorStop(0, d3.color(color).copy({ opacity: 0.18 }).toString());
  grad.addColorStop(1, d3.color(color).copy({ opacity: 0 }).toString());
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap  = "round";
  prices.forEach((p, i) => {
    const x = px(i), y = py(closes[i]);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── D3 Horizon Chart ──
const tooltip = document.getElementById("tooltip");

function renderChart() {
  const isDesktop = window.innerWidth >= 1024;
  const container = document.getElementById("chart-area");

  if (isDesktop) {
    // Two-column layout: replace #ridgeline with a flex wrapper containing two SVGs
    container.innerHTML = `<div id="loading" style="display:none"></div><div id="chart-cols" style="display:flex;gap:1px;width:100%;"></div>`;
    renderChartInto("chart-cols", 0, 0.5);   // left half
    renderChartInto("chart-cols", 0.5, 1.0); // right half
    return;
  }

  // Mobile: single column, existing flow
  const svgEl = document.getElementById("ridgeline");
  svgEl.innerHTML = "";
  renderChartInto(null, 0, 1.0, svgEl);
}

function renderChartInto(containerId, fracStart, fracEnd, existingSvg) {
  const container = document.getElementById("chart-area");
  let svgEl;
  if (existingSvg) {
    svgEl = existingSvg;
  } else {
    svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.style.flex = "1";
    svgEl.style.minWidth = "0";
    svgEl.style.display = "block";
    document.getElementById(containerId).appendChild(svgEl);
  }

  const sectorOrder = [
    "AI Models", "AI Apps",
    "Chips Compute", "Chips Memory", "Chips Equipment",
    "DC Infra", "Cloud",
    "Nuclear", "Grid & Renewables", "Oil & Gas",
    "Autonomy", "Defense",
    "BioHealth", "Fintech", "Consumer"
  ];
  const sectorLabels = {
    "AI Models":        "AI Models",
    "AI Apps":          "AI Apps",
    "Chips Compute":    "Chips · Compute",
    "Chips Memory":     "Chips · Memory",
    "Chips Equipment":  "Chips · Equipment",
    "DC Infra":         "DC Infrastructure",
    "Cloud":            "Cloud & CDN",
    "Nuclear":          "Nuclear Power",
    "Grid & Renewables":"Grid & Renewables",
    "Oil & Gas":        "Oil & Gas",
    "Autonomy":         "Autonomy & Robotics",
    "Defense":          "Defense & Space",
    "BioHealth":        "Biotech & Health AI",
    "Fintech":          "Fintech & Payments",
    "Consumer":         "Consumer & Media"
  };

  const pctReturn = entry => {
    const p = entry.prices;
    return (p[p.length - 1].close - p[0].close) / p[0].close;
  };

  const allGroupedData = [];
  sectorOrder.forEach(sec => {
    const symbols = watchlist[sec] || [];
    const secPrices = [];
    symbols.forEach(sym => {
      const entry = priceData.find(d => d.symbol === sym && d.prices && d.prices.length > 1);
      if (entry) secPrices.push(entry);
    });
    if (secPrices.length > 0) {
      // Sort within sector: top performers first
      secPrices.sort((a, b) => pctReturn(b) - pctReturn(a));
      allGroupedData.push({ sector: sec, label: sectorLabels[sec], items: secPrices });
    }
  });

  if (allGroupedData.length === 0) return;

  // Slice sector groups by fraction for two-column layout
  const sliceStart = Math.round(fracStart * allGroupedData.length);
  const sliceEnd   = Math.round(fracEnd   * allGroupedData.length);
  const groupedData = allGroupedData.slice(sliceStart, sliceEnd);
  if (groupedData.length === 0) return;
  const bands = horizonBands;
  const size  = horizonSize;
  const padding = 0.5;
  const secHeaderHeight = 24;

  const marginTop    = 18;
  const marginRight  = 10;
  const marginBottom = 10;
  const marginLeft   = 170;
  const colCount = (fracEnd - fracStart < 1.0) ? 2 : 1;
  const width  = Math.max(300, Math.floor((container.clientWidth - (colCount > 1 ? 1 : 20)) / colCount));

  const renderItems = [];
  const sectorGroupsLayout = [];
  let currentY = marginTop + 6;

  groupedData.forEach(secGroup => {
    const startY = currentY;
    secGroup.items.forEach(entry => {
      renderItems.push({
        type: "row",
        symbol: entry.symbol,
        prices: entry.prices,
        sector: secGroup.sector, // sector tracking
        y: currentY,
        height: size
      });
      currentY += size;
    });
    const endY = currentY;
    sectorGroupsLayout.push({
      sector: secGroup.sector,
      label: secGroup.label,
      startY: startY,
      endY: endY
    });
  });

  const height = currentY + marginBottom;

  const benchmarkTicker = getActiveBenchmark();
  let benchmarkPricesMap = new Map();

  if (benchmarkTicker !== "none") {
    const benchEntry = priceData.find(d => d.symbol === benchmarkTicker && d.prices && d.prices.length > 1);
    if (benchEntry) {
      const benchBase = benchEntry.prices[0].close;
      benchEntry.prices.forEach(p => {
        benchmarkPricesMap.set(p.date, (p.close - benchBase) / benchBase * 100);
      });
    }
  }

  // Update subtitle based on benchmark
  const subEl = document.querySelector("#header .subtitle");
  if (subEl) {
    if (benchmarkTicker === "none") {
      subEl.textContent = "% RETURN OVERLAY · HORIZON CHART";
    } else {
      const _bs = getActiveBenchmark ? document.getElementById("benchmark-select-d") || document.getElementById("benchmark-select") : null;
      const benchName = (_bs && _bs.options[_bs.selectedIndex]) ? _bs.options[_bs.selectedIndex].text.toUpperCase() : benchmarkTicker.toUpperCase();
      subEl.textContent = `EXCESS RETURN VS ${benchName} · HORIZON CHART`;
    }
  }

  const flat = [];
  groupedData.forEach(g => {
    g.items.forEach(d => {
      const base = d.prices[0].close;
      d.prices.forEach(p => {
        let val = (p.close - base) / base * 100;
        if (benchmarkTicker !== "none") {
          val -= (benchmarkPricesMap.get(p.date) || 0);
        }
        flat.push({
          name:  d.symbol,
          date:  new Date(p.date),
          value: val,
          raw:   p.close,
        });
      });
    });
  });

  const pointsMap = new Map();
  groupedData.forEach(g => {
    g.items.forEach(d => {
      const base = d.prices[0].close;
      const pts = d.prices.map(p => {
        let val = (p.close - base) / base * 100;
        if (benchmarkTicker !== "none") {
          val -= (benchmarkPricesMap.get(p.date) || 0);
        }
        return {
          name:  d.symbol,
          date:  new Date(p.date),
          value: val,
          raw:   p.close,
        };
      }).sort((a,b) => a.date - b.date);
      pointsMap.set(d.symbol, pts);
    });
  });

  const compressIntradayAxis = currentPeriod === "1d" || currentPeriod === "5d";
  const sortedTimestamps = Array.from(new Set(flat.map(d => +d.date))).sort((a, b) => a - b);
  const timestampIndex = new Map(sortedTimestamps.map((ts, idx) => [ts, idx]));
  const xTime = d3.scaleUtc()
    .domain(d3.extent(flat, d => d.date))
    .range([marginLeft, width - marginRight]);
  const xIndex = d3.scaleLinear()
    .domain([0, Math.max(1, sortedTimestamps.length - 1)])
    .range([marginLeft, width - marginRight]);
  const xForDate = date => compressIntradayAxis ? xIndex(timestampIndex.get(+date) ?? 0) : xTime(date);
  const nearestPointForX = (mx, pts) => {
    if (!compressIntradayAxis) {
      const hoverDate = xTime.invert(mx);
      let best = pts[0], bestDist = Infinity;
      pts.forEach(v => {
        const dist = Math.abs(v.date - hoverDate);
        if (dist < bestDist) { bestDist = dist; best = v; }
      });
      return best;
    }

    const targetIndex = Math.round(xIndex.invert(mx));
    let best = pts[0], bestDist = Infinity;
    pts.forEach(v => {
      const idx = timestampIndex.get(+v.date) ?? 0;
      const dist = Math.abs(idx - targetIndex);
      if (dist < bestDist) { bestDist = dist; best = v; }
    });
    return best;
  };

  const globalMax = d3.max(flat, d => Math.abs(d.value)) || 1;
  const thresholds = getThresholds(currentScaleMode, bands, globalMax);

  // Diverging Legend Ticks mapping
  const legendDiv = document.getElementById("diverging-legend");
  if (legendDiv) {
    legendDiv.innerHTML = "";

    const totalSegments = 2 * bands;
    const wSvg = 600;
    const hSvg = 45;
    const margin = { left: 45, right: 45 };
    const barWidth = wSvg - margin.left - margin.right;
    const segWidth = barWidth / totalSegments;

    const svg = d3.create("svg")
      .attr("width", "100%")
      .attr("height", hSvg)
      .attr("viewBox", `0 0 ${wSvg} ${hSvg}`)
      .style("overflow", "visible");

    for (let i = 0; i < totalSegments; i++) {
      let colorStyle;
      if (i < bands) {
        const b = bands - 1 - i;
        const opacity = 0.15 + 0.85 * ((b + 1) / bands);
        colorStyle = d3.color(negColor).copy({ opacity: opacity });
      } else {
        const b = i - bands;
        const opacity = 0.15 + 0.85 * ((b + 1) / bands);
        colorStyle = d3.color(posColor).copy({ opacity: opacity });
      }

      svg.append("rect")
        .attr("x", margin.left + i * segWidth)
        .attr("y", 6)
        .attr("width", segWidth)
        .attr("height", 12)
        .attr("fill", colorStyle);
      
      if (i > 0) {
        svg.append("line")
          .attr("x1", margin.left + i * segWidth)
          .attr("x2", margin.left + i * segWidth)
          .attr("y1", 6)
          .attr("y2", 18)
          .attr("stroke", "var(--background)")
          .attr("stroke-width", 1.5);
      }
    }

    svg.append("rect")
      .attr("x", margin.left)
      .attr("y", 6)
      .attr("width", barWidth)
      .attr("height", 12)
      .attr("fill", "none")
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1);

    for (let k = 0; k <= totalSegments; k++) {
      const xTick = margin.left + k * segWidth;
      let val;
      if (k < bands) {
        val = -thresholds[bands - k];
      } else if (k === bands) {
        val = 0;
      } else {
        val = thresholds[k - bands];
      }

      svg.append("line")
        .attr("x1", xTick)
        .attr("x2", xTick)
        .attr("y1", 18)
        .attr("y2", 23)
        .attr("stroke", "var(--border)")
        .attr("stroke-width", 1);

      let showLabel = false;
      if (bands <= 4) {
        showLabel = true;
      } else if (bands <= 7) {
        showLabel = (k % 2 === 0);
      } else {
        const mid = Math.round(bands / 2);
        showLabel = (k === 0 || k === 2 * bands || k === bands || k === mid || k === bands + mid);
      }

      if (showLabel) {
        let labelText = "";
        if (val === 0) {
          labelText = "0%";
        } else {
          if (currentDomainMode === "local") {
            const ratio = Math.abs(val) / globalMax;
            labelText = (val > 0 ? "+" : "-") + (ratio * 100).toFixed(0) + "% M";
          } else {
            labelText = (val > 0 ? "+" : "") + val.toFixed(1) + "%";
          }
        }

        svg.append("text")
          .attr("x", xTick)
          .attr("y", 35)
          .attr("text-anchor", "middle")
          .attr("fill", "var(--muted-foreground)")
          .style("font-size", "10px")
          .style("font-family", "'JetBrains Mono', monospace")
          .text(labelText);
      }
    }

    legendDiv.appendChild(svg.node());
  }

  const uid = `hz-${Math.random().toString(16).slice(2)}`;

  svgEl.setAttribute("width", width);
  svgEl.setAttribute("height", height);
  svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgEl.style.maxWidth = "100%";
  svgEl.style.height   = "auto";

  const s = d3.select(svgEl);

  // Global hairline guide
  const hairline = s.append("line")
    .attr("id", "hairline")
    .attr("y1", marginTop)
    .attr("y2", height - marginBottom)
    .attr("stroke", "rgba(255, 61, 0, 0.45)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "3 3")
    .style("pointer-events", "none")
    .style("display", "none");

  const getBandAreaPath = (vals, bandIdx, sign, rowThresholds) => {
    const t0 = rowThresholds[bandIdx];
    const t1 = rowThresholds[bandIdx + 1];
    const bandHeight = t1 - t0;
    if (bandHeight <= 0) return "";

    const areaGen = d3.area()
      .defined(d => !isNaN(d.value))
      .x(d => xForDate(d.date))
      .curve(d3.curveBasis);

    if (sign > 0) {
      areaGen
        .y0(size)
        .y1(d => {
          const val = Math.max(0, d.value);
          const clamped = Math.min(t1, Math.max(t0, val)) - t0;
          const h = (clamped / bandHeight) * (size - padding);
          return size - h;
        });
    } else {
      areaGen
        .y0(0)
        .y1(d => {
          const val = Math.max(0, -d.value);
          const clamped = Math.min(t1, Math.max(t0, val)) - t0;
          const h = (clamped / bandHeight) * (size - padding);
          return h;
        });
    }
    return areaGen(vals);
  };

  const rowsData = renderItems.filter(d => d.type === "row");

  // Draw sector grouping brackets and labels on the left
  const groupG = s.append("g")
    .selectAll("g")
    .data(sectorGroupsLayout)
    .join("g")
      .attr("class", d => `bracket-group sector-${d.sector}`);

  // Draw vertical line for the bracket
  groupG.append("line")
    .attr("x1", 15)
    .attr("x2", 15)
    .attr("y1", d => d.startY + 2)
    .attr("y2", d => d.endY - 2)
    .attr("stroke", "var(--border)")
    .attr("stroke-width", 1.5);

  // Draw top hook of bracket
  groupG.append("line")
    .attr("x1", 15)
    .attr("x2", 20)
    .attr("y1", d => d.startY + 2)
    .attr("y2", d => d.startY + 2)
    .attr("stroke", "var(--border)")
    .attr("stroke-width", 1.5);

  // Draw bottom hook of bracket
  groupG.append("line")
    .attr("x1", 15)
    .attr("x2", 20)
    .attr("y1", d => d.endY - 2)
    .attr("y2", d => d.endY - 2)
    .attr("stroke", "var(--border)")
    .attr("stroke-width", 1.5);

  const iconMap = {
    "AI Models":        "brain",
    "AI Apps":          "sparkles",
    "Chips Compute":    "cpu",
    "Chips Memory":     "database",
    "Chips Equipment":  "settings-2",
    "DC Infra":         "server",
    "Cloud":            "cloud",
    "Nuclear":          "atom",
    "Grid & Renewables":"zap",
    "Oil & Gas":        "flame",
    "Autonomy":         "bot",
    "Defense":          "shield",
    "BioHealth":        "heart-pulse",
    "Fintech":          "landmark",
    "Consumer":         "tv"
  };

  // Draw label using foreignObject to support Lucide icons!
  groupG.append("foreignObject")
    .attr("x", 24)
    .attr("y", d => (d.startY + d.endY) / 2 - 8)
    .attr("width", 16)
    .attr("height", 16)
    .html(d => `
      <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
        <i data-lucide="${iconMap[d.sector]}" style="width: 13px; height: 13px; stroke-width: 2.2px; color: var(--muted-foreground);" title="${d.label}"></i>
      </div>
    `);

  // Sector hover overlay rect and event handlers to highlight entire sector
  groupG.append("rect")
    .attr("x", 0)
    .attr("y", d => d.startY)
    .attr("width", 45)
    .attr("height", d => d.endY - d.startY)
    .attr("fill", "transparent")
    .style("cursor", "pointer");

  // Click-based highlight state for this SVG instance
  let _selectedKey = null; // "sector:XYZ" | "row:SYM" | null

  function clearHighlight() {
    _selectedKey = null;
    s.selectAll(".row-group, .bracket-group").style("opacity", "1");
  }

  groupG
    .style("cursor", "pointer")
    .on("click", function(event, d) {
      event.stopPropagation();
      const key = `sector:${d.sector}`;
      if (_selectedKey === key) { clearHighlight(); return; }
      _selectedKey = key;
      s.selectAll(".row-group").style("opacity", r => r.sector === d.sector ? "1" : "0.45");
      s.selectAll(".bracket-group").style("opacity", b => b.sector === d.sector ? "1" : "0.45");
    });

  // Click on SVG background clears selection
  s.on("click", function(event) {
    if (event.target === this) clearHighlight();
  });

  const rowG = s.append("g")
    .selectAll("g")
    .data(rowsData)
    .join("g")
      .attr("transform", d => `translate(0,${d.y})`)
      .attr("class", "row-group");

  rowG
    .style("cursor", "pointer")
    .on("click", function(event, d) {
      event.stopPropagation();
      const key = `row:${d.symbol}`;
      if (_selectedKey === key) { clearHighlight(); return; }
      _selectedKey = key;
      s.selectAll(".row-group").style("opacity", r => r.symbol === d.symbol ? "1" : "0.45");
      s.selectAll(".bracket-group").style("opacity", b => b.sector === d.sector ? "1" : "0.45");
    });

  rowG.each(function(rowData, rowIdx) {
    const rowSelection = d3.select(this);

    const defs = rowSelection.append("defs");
    defs.append("clipPath")
        .attr("id", `${uid}-clip-${rowIdx}`)
      .append("rect")
        .attr("x", marginLeft)
        .attr("y", padding)
        .attr("width", width - marginLeft - marginRight)
        .attr("height", size - padding);
  });

  rowG.each(function(rowData, rowIdx) {
    const rowSelection = d3.select(this);
    const pts = pointsMap.get(rowData.symbol) || [];

    // Local vs Global domain y-bounds logic
    let rowThresholds;
    if (currentDomainMode === "local") {
      const localMax = d3.max(pts, d => Math.abs(d.value)) || 1;
      rowThresholds = getThresholds(currentScaleMode, bands, localMax);
    } else {
      rowThresholds = thresholds;
    }

    rowSelection.selectAll(".pos-band")
      .data(d3.range(bands).map(b => ({ band: b, vals: pts })))
      .join("path")
        .attr("class", "pos-band")
        .attr("d", d => getBandAreaPath(d.vals, d.band, 1, rowThresholds))
        .attr("fill", d => {
          const t = (d.band + 1) / bands;
          return d3.color(posColor).copy({ opacity: 0.15 + 0.85 * t });
        })
        .attr("clip-path", `url(#${uid}-clip-${rowIdx})`);

    rowSelection.selectAll(".neg-band")
      .data(d3.range(bands).map(b => ({ band: b, vals: pts })))
      .join("path")
        .attr("class", "neg-band")
        .attr("d", d => getBandAreaPath(d.vals, d.band, -1, rowThresholds))
        .attr("fill", d => {
          const t = (d.band + 1) / bands;
          return d3.color(negColor).copy({ opacity: 0.15 + 0.85 * t });
        })
        .attr("clip-path", `url(#${uid}-clip-${rowIdx})`);

    const first = pts[0].raw;
    const last = pts[pts.length - 1].raw;
    const pctVal = ((last - first) / first * 100);
    let displayPct = pctVal;
    if (benchmarkTicker !== "none") {
      const benchEntry = priceData.find(d => d.symbol === benchmarkTicker);
      if (benchEntry && benchEntry.prices && benchEntry.prices.length >= 2) {
        const bFirst = benchEntry.prices[0].close;
        const bLast = benchEntry.prices[benchEntry.prices.length - 1].close;
        const bPct = ((bLast - bFirst) / bFirst * 100);
        displayPct -= bPct;
      }
    }
    const colorCls = displayPct >= 0 ? "pos" : "neg";
    const pctSign = displayPct >= 0 ? "+" : "";

    rowSelection.append("foreignObject")
      .attr("x", 46)
      .attr("y", Math.max(0, (size - 16) / 2))
      .attr("width", 116)
      .attr("height", 16)
      .html(`
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;height:100%;box-sizing:border-box;overflow:hidden;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#e8e8e8;letter-spacing:0.04em;white-space:nowrap;">${rowData.symbol}</span>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${colorCls === 'pos' ? posColor : negColor};white-space:nowrap;">${pctSign}${displayPct.toFixed(1)}%</span>
            <button class="row-del-btn" data-sym="${rowData.symbol}" title="Remove" style="background:none;border:none;color:#555;cursor:pointer;padding:1px;display:inline-flex;align-items:center;justify-content:center;">
              <i data-lucide="x" style="width:10px;height:10px;stroke-width:2.5;"></i>
            </button>
          </div>
        </div>
      `);

    rowSelection.append("line")
      .attr("x1", marginLeft).attr("x2", width - marginRight)
      .attr("y1", size - 0.5).attr("y2", size - 0.5)
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1);

    rowSelection.append("rect")
      .attr("x", marginLeft)
      .attr("y", 0)
      .attr("width", width - marginLeft - marginRight)
      .attr("height", size)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("mousemove", function(event) {
        const [rawMx] = d3.pointer(event, svgEl);
        const mx = Math.max(marginLeft, Math.min(width - marginRight, rawMx));
        
        // Update hairline guide
        hairline.style("display", null)
          .attr("x1", mx)
          .attr("x2", mx);

        const best = nearestPointForX(mx, pts);
        const color = best.value >= 0 ? posColor : negColor;
        
        tooltip.style.opacity = "1";
        tooltip.style.left = (event.clientX + 14) + "px";
        tooltip.style.top  = (event.clientY - 60) + "px"; // adjusted tooltip top offset to fit taller content
        
        // Sector labels mapping
        const sectorNames = {
          "AI Models":        "AI Models",
          "AI Apps":          "AI Apps",
          "Chips Compute":    "Chips · Compute",
          "Chips Memory":     "Chips · Memory",
          "Chips Equipment":  "Chips · Equipment",
          "DC Infra":         "DC Infra",
          "Cloud":            "Cloud & CDN",
          "Nuclear":          "Nuclear",
          "Grid & Renewables":"Grid & Renewables",
          "Oil & Gas":        "Oil & Gas",
          "Autonomy":         "Autonomy",
          "Defense":          "Defense",
          "BioHealth":        "BioHealth",
          "Fintech":          "Fintech",
          "Consumer":         "Consumer"
        };
        
        tooltip.querySelector(".tt-sym").textContent  = rowData.symbol;
        tooltip.querySelector(".tt-sym").style.color  = color;
        tooltip.querySelector(".tt-sector").textContent = sectorNames[rowData.sector] || rowData.sector;
        tooltip.querySelector(".tt-date").textContent = best.date.toISOString().slice(0,10);
        
        // Populate start, end prices
        const startPrice = pts[0].raw;
        const endPrice = pts[pts.length - 1].raw;
        tooltip.querySelector(".tt-start-price").textContent = "$" + startPrice.toFixed(2);
        tooltip.querySelector(".tt-end-price").textContent = "$" + endPrice.toFixed(2);

        // Populate current price and return
        tooltip.querySelector(".tt-price").textContent = "$" + best.raw.toFixed(2);
        tooltip.querySelector(".tt-price").style.color = color;
        
        const prefix = benchmarkTicker !== "none" ? "XS " : "";
        tooltip.querySelector(".tt-return").textContent = prefix + (best.value >= 0 ? "+" : "") + best.value.toFixed(2) + "%";
        tooltip.querySelector(".tt-return").style.color = color;

        // Draw sparkline inside tooltip dynamically
        const canvas = document.getElementById("tooltip-sparkline");
        if (canvas) {
          const firstPrice = pts[0].raw;
          const lastPrice = pts[pts.length - 1].raw;
          const overallReturn = lastPrice - firstPrice;
          const sparkColor = overallReturn >= 0 ? posColor : negColor;
          drawSparkline(canvas, pts, sparkColor);
        }
      })
      .on("mouseleave", () => { 
        tooltip.style.opacity = "0"; 
        hairline.style("display", "none");
      });
  });

  const axis = s.append("g")
    .attr("transform", `translate(0,${marginTop})`)
    .attr("class", "x-axis-shared");

  if (compressIntradayAxis) {
    const formatTime = date => new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: true,
    }).format(date).replace(/\s/g, "");
    const formatDay = date => new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(date);
    const tickIndexes = [];
    let lastLabel = "";

    sortedTimestamps.forEach((ts, idx) => {
      const date = new Date(ts);
      const label = currentPeriod === "5d" ? formatDay(date) : formatTime(date);
      if (idx === 0 || label !== lastLabel) {
        tickIndexes.push(idx);
        lastLabel = label;
      }
    });

    axis
      .call(
        d3.axisTop(xIndex)
          .tickValues(tickIndexes)
          .tickFormat(idx => {
            const date = new Date(sortedTimestamps[Math.round(idx)] || sortedTimestamps[0]);
            return currentPeriod === "5d" ? formatDay(date) : formatTime(date);
          })
          .tickSizeOuter(0)
      )
      .call(ax => ax.select(".domain").remove());
  } else {
    let tickInterval, tickFormat;
    if (currentPeriod === "1mo") {
      tickInterval = d3.timeDay.every(3);
      tickFormat   = d3.timeFormat("%b %d");
    } else if (currentPeriod === "3mo") {
      tickInterval = d3.timeWeek.every(1);
      tickFormat   = d3.timeFormat("%b %d");
    } else if (currentPeriod === "6mo") {
      tickInterval = d3.timeMonth.every(1);
      tickFormat   = d3.timeFormat("%b '%y");
    } else {
      tickInterval = d3.timeMonth.every(3);
      tickFormat   = d3.timeFormat("%b '%y");
    }

    axis
      .call(
        d3.axisTop(xTime)
          .ticks(tickInterval)
          .tickFormat(tickFormat)
          .tickSizeOuter(0)
      )
      .call(ax => ax.selectAll(".tick")
        .filter(d => xTime(d) < marginLeft || xTime(d) >= width - marginRight)
        .remove()
      )
      .call(ax => ax.select(".domain").remove());
  }

  // Initialize/re-initialize Lucide Icons (e.g. for the foreignObject icons)
  lucide.createIcons();
}

// ── Desktop layout activation ──
function applyDesktopLayout() {
  const isDesktop = window.innerWidth >= 1024;
  const sidebar = document.getElementById("sidebar");
  const sidebarHeader = document.getElementById("sidebar-header");
  const rightPanel = document.getElementById("right-panel");

  if (isDesktop) {
    sidebar.style.display = "flex";
    sidebarHeader.style.display = "flex";
    // right-panel needs block flow (not contents) on desktop
    rightPanel.style.display = "flex";
    rightPanel.style.flexDirection = "column";
    rightPanel.style.flex = "1";
    rightPanel.style.minWidth = "0";
    rightPanel.style.height = "100vh";
    rightPanel.style.overflow = "hidden";
  } else {
    sidebar.style.display = "none";
    sidebarHeader.style.display = "none";
    rightPanel.style.display = "contents";
  }
}

window.addEventListener("resize", () => {
  applyDesktopLayout();
  renderChart();
});

// ── Init ──
(async () => {
  applyDesktopLayout();
  await loadWatchlist();
  await loadPrices();
  lucide.createIcons();
  updateMarketStatus();
})();
})();
