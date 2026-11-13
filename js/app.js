(() => {
  "use strict";

  const MAX_COMPARE = 3;
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const state = {
    catalog: null,
    catalogSource: "",
    stateCode: "",
    level: "",
    areas: new Set(),
    selected: new Set(),
    demographics: {},
    charts: [],
  };

  const els = {};

  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return [...root.querySelectorAll(sel)];
  }
  function formatPct(n) {
    const sign = n > 0 ? "+" : "";
    return `${sign}${Number(n).toFixed(1)}%`;
  }

  function aggregateLabor(program) {
    const occs = (program.laborIds || [])
      .map((id) => window.UAGC_LABOR?.occupations?.[id])
      .filter(Boolean);
    if (!occs.length) return null;
    return {
      medianWage: Math.round(occs.reduce((s, o) => s + o.medianWage, 0) / occs.length),
      growthPct: occs.reduce((s, o) => s + o.growthPct, 0) / occs.length,
      wageLow: Math.min(...occs.map((o) => o.wageP10)),
      wageHigh: Math.max(...occs.map((o) => o.wageP90)),
      titles: occs.map((o) => o.title),
    };
  }

  /** Resolve catalog URLs against the page directory (works on GitHub Pages subpaths). */
  function resolveAppUrl(pathOrUrl) {
    if (!pathOrUrl) return pathOrUrl;
    if (/^(https?:|data:)/i.test(pathOrUrl)) return pathOrUrl;
    // Absolute site paths (Drupal files, etc.) — leave alone
    if (pathOrUrl.startsWith("/") && !pathOrUrl.startsWith("//")) return pathOrUrl;
    try {
      return new URL(pathOrUrl, document.baseURI).href;
    } catch {
      return pathOrUrl;
    }
  }

  async function loadCatalog() {
    const configured =
      window.UAGC_CATALOG_URL ||
      document.documentElement.getAttribute("data-catalog-url") ||
      "data/programs.json";
    const catalogUrl = resolveAppUrl(configured);

    try {
      const res = await fetch(catalogUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.programs?.length) throw new Error("Catalog missing programs");
      state.catalog = json;
      state.catalogSource = catalogUrl;
      return;
    } catch (err) {
      console.warn("Catalog fetch failed, using bundled fallback:", err);
      if (window.UAGC_CATALOG_FALLBACK?.programs?.length) {
        state.catalog = window.UAGC_CATALOG_FALLBACK;
        state.catalogSource = "fallback:js/data/catalog-fallback.js";
        return;
      }
      throw new Error("Unable to load degree catalog (fetch failed and no fallback).");
    }
  }

  function filteredPrograms() {
    return state.catalog.programs.filter((p) => {
      if (state.level && p.level !== state.level) return false;
      if (state.areas.size === 0) return false;
      return p.areas.some((a) => state.areas.has(a));
    });
  }

  function updateProgress() {
    const steps = {
      location: Boolean(state.stateCode),
      level: Boolean(state.level),
      interests: state.areas.size > 0,
      compare: state.selected.size > 0,
    };
    const order = ["location", "level", "interests", "compare"];
    const focus = order.find((k) => !steps[k]) || "compare";
    $all("[data-step]").forEach((li) => {
      const key = li.dataset.step;
      li.classList.toggle("done", Boolean(steps[key]));
      li.classList.toggle("active", key === focus && Boolean(steps[key] || key === focus));
    });
  }

  function renderCatalogMeta() {
    if (!els.catalogMeta) return;
    const when = state.catalog.generatedAt
      ? new Date(state.catalog.generatedAt).toLocaleString()
      : "unknown";
    els.catalogMeta.textContent = `${state.catalog.programs.length} programs · catalog ${when} · source: ${state.catalogSource}`;
  }

  function renderStates() {
    els.stateSelect.innerHTML =
      `<option value="">Select your state</option>` +
      window.UAGC_STATES.map((s) => `<option value="${s.code}">${s.name}</option>`).join("");
  }

  function renderLevels() {
    els.levelRow.innerHTML = state.catalog.levels
      .map(
        (l) =>
          `<button type="button" class="chip" data-level="${l.id}" aria-pressed="false">${l.name}</button>`
      )
      .join("");
  }

  function renderAreas() {
    els.areaGrid.innerHTML = state.catalog.areas
      .map(
        (a) => `
      <label class="area-option">
        <input type="checkbox" value="${a.id}" data-area />
        <span>${a.name}</span>
      </label>`
      )
      .join("");
  }

  function renderPrograms() {
    const programs = filteredPrograms();
    const count = state.selected.size;
    els.compareCount.innerHTML = `<span class="num">${count}</span> of ${MAX_COMPARE} selected`;

    if (!state.level || state.areas.size === 0) {
      els.programList.innerHTML = `<div class="empty-state">Choose a degree level and at least one area of interest to see matching UAGC programs.</div>`;
      return;
    }
    if (!programs.length) {
      els.programList.innerHTML = `<div class="empty-state">No programs match this combination. Try another area or degree level.</div>`;
      return;
    }

    els.programList.innerHTML = programs
      .map((p) => {
        const checked = state.selected.has(p.id);
        const disabled = !checked && count >= MAX_COMPARE;
        return `
        <label class="program-item ${checked ? "selected" : ""} ${disabled ? "disabled" : ""}">
          <input type="checkbox" value="${p.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <div>
            <h3>${p.name}</h3>
            <p>${p.summary || ""}</p>
            ${p.note ? `<p><em>${p.note}</em></p>` : ""}
          </div>
          <div class="program-meta">${p.credits != null ? `${p.credits} credits` : "UAGC"}</div>
        </label>`;
      })
      .join("");
  }

  function syncLevelUI() {
    $all("[data-level]", els.levelRow).forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.level === state.level));
    });
  }

  function pruneSelection() {
    const valid = new Set(filteredPrograms().map((p) => p.id));
    [...state.selected].forEach((id) => {
      if (!valid.has(id)) state.selected.delete(id);
    });
  }

  function destroyCharts() {
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
  }

  function canCompare() {
    return Boolean(state.stateCode) && Boolean(state.level) && state.areas.size > 0 && state.selected.size > 0;
  }

  function compareBlockedReason() {
    if (!state.stateCode) return "Select your state to continue.";
    if (!state.level) return "Choose a degree level.";
    if (state.areas.size === 0) return "Select at least one area of interest.";
    if (state.selected.size === 0) return "Select up to 3 programs to compare.";
    return "";
  }

  function updateCompareButton() {
    const ok = canCompare();
    els.compareBtn.disabled = !ok;
    if (els.compareHint) {
      els.compareHint.textContent = ok ? "Ready to compare." : compareBlockedReason();
      els.compareHint.hidden = false;
    }
  }

  function shortenName(name) {
    return name
      .replace(/^Bachelor of Arts in /i, "BA ")
      .replace(/^Bachelor of Science in /i, "BS ")
      .replace(/^Master of Arts in /i, "MA ")
      .replace(/^Master of Science in /i, "MS ")
      .replace(/^Master of /i, "M ")
      .replace(/^Associate of Arts in /i, "AA ")
      .replace(/^Doctor of Professional Studies in /i, "DPS ");
  }

  function chartOptions(tickFormat) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label(ctx) { return tickFormat(ctx.parsed.y); } } },
      },
      scales: {
        x: { ticks: { color: "#0C234B", font: { family: "Montserrat", size: 11 } }, grid: { display: false } },
        y: {
          ticks: { color: "#5a6a78", font: { family: "Montserrat", size: 11 }, callback: (v) => tickFormat(v) },
          grid: { color: "rgba(12,35,75,0.08)" },
        },
      },
      animation: { duration: 700, easing: "easeOutQuart" },
    };
  }

  function renderResults() {
    const selectedPrograms = state.catalog.programs.filter((p) => state.selected.has(p.id));
    if (!selectedPrograms.length) {
      els.results.classList.remove("visible");
      destroyCharts();
      return;
    }

    els.results.classList.add("visible");
    const stateName = window.UAGC_STATES.find((s) => s.code === state.stateCode)?.name || "your state";
    const levelName = state.catalog.levels.find((l) => l.id === state.level)?.name || "";

    els.resultsIntro.innerHTML = `
      <h2>Your comparison</h2>
      <p class="hint">Showing ${selectedPrograms.length} ${levelName.toLowerCase()} program${selectedPrograms.length > 1 ? "s" : ""} for learners in ${stateName}. Salary and outlook figures reflect related national occupations (BLS / O*NET-style public data)—not UAGC placement guarantees.</p>
    `;

    els.resultsGrid.innerHTML = selectedPrograms
      .map((p, i) => {
        const labor = aggregateLabor(p);
        return `
        <article class="degree-card" style="animation-delay:${i * 0.08}s">
          <span class="level-tag">${levelName}</span>
          <h3>${p.name}</h3>
          <p class="summary">${p.summary || ""}</p>
          <ul class="careers">${(p.careers || []).map((c) => `<li>${c}</li>`).join("")}</ul>
          <div class="stats-row">
            <div class="stat"><span class="k">Related median wage</span><span class="v">${labor ? currency.format(labor.medianWage) : "—"}</span></div>
            <div class="stat"><span class="k">Projected growth</span><span class="v">${labor ? formatPct(labor.growthPct) : "—"}</span></div>
          </div>
          <p class="hint" style="margin:0;font-size:0.8rem">Wage range (10th–90th): ${
            labor ? `${currency.format(labor.wageLow)} – ${currency.format(labor.wageHigh)}` : "—"
          }</p>
          <a class="btn btn-primary" href="${p.url}" target="_blank" rel="noopener noreferrer">Learn more</a>
        </article>`;
      })
      .join("");

    renderInsights(selectedPrograms);
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderInsights(programs) {
    const laborMeta = window.UAGC_LABOR.meta;
    destroyCharts();
    const labels = programs.map((p) => shortenName(p.name));
    const wages = programs.map((p) => aggregateLabor(p)?.medianWage || 0);
    const growth = programs.map((p) => aggregateLabor(p)?.growthPct || 0);
    const palette = ["#AB0520", "#0C234B", "#007DBA"];

    requestAnimationFrame(() => {
      const wageCtx = $("#wageChart");
      const growthCtx = $("#growthChart");
      if (!wageCtx || !growthCtx) return;
      if (typeof Chart === "undefined") {
        console.warn("Chart.js not loaded; skipping charts (cards/table still available).");
        return;
      }
      state.charts.push(
        new Chart(wageCtx, {
          type: "bar",
          data: { labels, datasets: [{ label: `Median wage (${laborMeta.wageYear})`, data: wages, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderRadius: 8, maxBarThickness: 48 }] },
          options: chartOptions((v) => currency.format(v)),
        })
      );
      state.charts.push(
        new Chart(growthCtx, {
          type: "bar",
          data: { labels, datasets: [{ label: `Employment growth ${laborMeta.projectionWindow}`, data: growth, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderRadius: 8, maxBarThickness: 48 }] },
          options: chartOptions((v) => `${v.toFixed(1)}%`),
        })
      );
    });

    els.compareTableBody.innerHTML = programs
      .map((p) => {
        const labor = aggregateLabor(p);
        return `<tr>
          <td><strong>${p.name}</strong><br/><span style="color:var(--muted)">${p.college || ""}</span></td>
          <td>${labor ? labor.titles.join("; ") : "—"}</td>
          <td>${labor ? currency.format(labor.medianWage) : "—"}</td>
          <td>${labor ? `${currency.format(labor.wageLow)} – ${currency.format(labor.wageHigh)}` : "—"}</td>
          <td>${labor ? formatPct(labor.growthPct) : "—"}</td>
          <td>${p.credits ?? "—"}</td>
        </tr>`;
      })
      .join("");

    els.sources.innerHTML = `
      <p><strong>Data notes.</strong> ${laborMeta.disclaimer}</p>
      <p>Sources (${laborMeta.wageYear} wages; ${laborMeta.projectionWindow} projections):</p>
      <ul>${laborMeta.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.label}</a></li>`).join("")}</ul>
    `;
  }

  function collectDemographics() {
    state.demographics = {
      ethnicity: els.ethnicity.value || "",
      ageRange: els.ageRange.value || "",
      military: els.military.value || "",
      firstGen: els.firstGen.value || "",
      employment: els.employment.value || "",
    };
    try {
      sessionStorage.setItem("uagc-dct-demographics", JSON.stringify(state.demographics));
    } catch { /* ignore */ }
  }

  function bindEvents() {
    els.stateSelect.addEventListener("change", () => {
      state.stateCode = els.stateSelect.value;
      const meta = window.UAGC_STATES.find((s) => s.code === state.stateCode);
      if (meta?.note) {
        els.stateNote.textContent = meta.note;
        els.stateNote.classList.add("visible");
      } else {
        els.stateNote.classList.remove("visible");
        els.stateNote.textContent = "";
      }
      updateProgress();
      updateCompareButton();
    });

    els.levelRow.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-level]");
      if (!btn) return;
      state.level = btn.dataset.level;
      syncLevelUI();
      pruneSelection();
      renderPrograms();
      updateProgress();
      updateCompareButton();
    });

    els.areaGrid.addEventListener("change", (e) => {
      const input = e.target.closest("[data-area]");
      if (!input) return;
      if (input.checked) state.areas.add(input.value);
      else state.areas.delete(input.value);
      pruneSelection();
      renderPrograms();
      updateProgress();
      updateCompareButton();
    });

    els.programList.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"]');
      if (!input) return;
      if (input.checked) {
        if (state.selected.size >= MAX_COMPARE) {
          input.checked = false;
          return;
        }
        state.selected.add(input.value);
      } else {
        state.selected.delete(input.value);
      }
      renderPrograms();
      updateProgress();
      updateCompareButton();
    });

    els.compareBtn.addEventListener("click", () => {
      collectDemographics();
      renderResults();
    });

    els.resetBtn.addEventListener("click", () => {
      state.stateCode = "";
      state.level = "";
      state.areas.clear();
      state.selected.clear();
      els.stateSelect.value = "";
      els.stateNote.classList.remove("visible");
      $all("[data-area]", els.areaGrid).forEach((i) => (i.checked = false));
      ["ethnicity", "ageRange", "military", "firstGen", "employment"].forEach((k) => {
        els[k].value = "";
      });
      syncLevelUI();
      renderPrograms();
      els.results.classList.remove("visible");
      destroyCharts();
      updateProgress();
      updateCompareButton();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    els.reloadCatalogBtn?.addEventListener("click", async () => {
      els.reloadCatalogBtn.disabled = true;
      try {
        await loadCatalog();
        // Drop selections that no longer exist in the refreshed catalog.
        const allIds = new Set(state.catalog.programs.map((p) => p.id));
        [...state.selected].forEach((id) => {
          if (!allIds.has(id)) state.selected.delete(id);
        });
        const areaIds = new Set(state.catalog.areas.map((a) => a.id));
        [...state.areas].forEach((id) => {
          if (!areaIds.has(id)) state.areas.delete(id);
        });
        if (state.level && !state.catalog.levels.some((l) => l.id === state.level)) {
          state.level = "";
        }
        renderLevels();
        renderAreas();
        syncLevelUI();
        $all("[data-area]", els.areaGrid).forEach((input) => {
          input.checked = state.areas.has(input.value);
        });
        pruneSelection();
        renderPrograms();
        renderCatalogMeta();
        updateProgress();
        updateCompareButton();
        els.results.classList.remove("visible");
        destroyCharts();
      } catch (err) {
        alert(err.message);
      } finally {
        els.reloadCatalogBtn.disabled = false;
      }
    });
  }

  function cacheEls() {
    els.stateSelect = $("#stateSelect");
    els.stateNote = $("#stateNote");
    els.levelRow = $("#levelRow");
    els.areaGrid = $("#areaGrid");
    els.programList = $("#programList");
    els.compareCount = $("#compareCount");
    els.compareBtn = $("#compareBtn");
    els.resetBtn = $("#resetBtn");
    els.results = $("#results");
    els.resultsIntro = $("#resultsIntro");
    els.resultsGrid = $("#resultsGrid");
    els.compareTableBody = $("#compareTableBody");
    els.sources = $("#sources");
    els.ethnicity = $("#ethnicity");
    els.ageRange = $("#ageRange");
    els.military = $("#military");
    els.firstGen = $("#firstGen");
    els.employment = $("#employment");
    els.catalogMeta = $("#catalogMeta");
    els.reloadCatalogBtn = $("#reloadCatalogBtn");
    els.bootError = $("#bootError");
    els.compareHint = $("#compareHint");
  }

  async function init() {
    cacheEls();
    try {
      await loadCatalog();
    } catch (err) {
      if (els.bootError) {
        els.bootError.hidden = false;
        els.bootError.textContent = err.message;
      }
      return;
    }
    renderCatalogMeta();
    renderStates();
    renderLevels();
    renderAreas();
    renderPrograms();
    bindEvents();
    updateProgress();
    updateCompareButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
