(function() {
  function sanitizeFileName(name) {
    let value = (name || "chart").trim().replace(/[\\/:*?"<>|]+/g, "_");
    value = value.replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
    return value || "chart";
  }

  function computedCssText(el) {
    let styles = window.getComputedStyle(el);
    let cssText = [];
    for (let i = 0; i < styles.length; i++) {
      let prop = styles[i];
      cssText.push(`${prop}:${styles.getPropertyValue(prop)};`);
    }
    return cssText.join("");
  }

  function inlineComputedStyles(source, clone) {
    clone.setAttribute("style", computedCssText(source));
    let sourceChildren = source.children;
    let cloneChildren = clone.children;
    for (let i = 0; i < sourceChildren.length; i++)
      inlineComputedStyles(sourceChildren[i], cloneChildren[i]);
  }

  function prepareCloneForExport(clone) {
    for (let el of clone.querySelectorAll("[data-export-ignore]"))
      el.style.cssText += ";visibility:hidden !important;opacity:0 !important;";

    for (let el of clone.querySelectorAll(".u-select, .u-cursor-x, .u-cursor-y, .u-cursor-pt"))
      el.remove();

    for (let canvas of clone.querySelectorAll("canvas"))
      canvas.remove();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      let img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("failed to generate png"));
      }, "image/png");
    });
  }

  function downloadBlob(blob, fileName) {
    let downloadUrl = URL.createObjectURL(blob);

    try {
      let link = document.createElement("a");
      link.href = downloadUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(downloadUrl);
    }
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" && Number.isNaN(value)) return "";

    let text = String(value);
    if (/[",\n]/.test(text))
      return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function buildCsvText(csvData) {
    let columns = [{label: csvData.xLabel || "x", values: csvData.xData || []}].concat(csvData.series || []);
    let rowCount = columns.reduce((maxRows, column) => Math.max(maxRows, column.values.length), 0);
    let lines = [columns.map(column => csvEscape(column.label)).join(",")];

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++)
      lines.push(columns.map(column => csvEscape(column.values[rowIdx])).join(","));

    return lines.join("\n") + "\n";
  }

  function exportChartAsCsv(fileName, csvData) {
    let csvText = buildCsvText(csvData);
    let blob = new Blob([csvText], {type: "text/csv;charset=utf-8"});
    downloadBlob(blob, `${sanitizeFileName(fileName)}.csv`);
  }

  async function exportElementAsPng(source, plot, fileName) {
    let clone = source.cloneNode(true);
    inlineComputedStyles(source, clone);
    prepareCloneForExport(clone);

    let pxRatio = window.devicePixelRatio || 1;
    let rect = source.getBoundingClientRect();
    let width = Math.ceil(rect.width * pxRatio);
    let height = Math.ceil(rect.height * pxRatio);
    let svgText = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${Math.ceil(rect.width)} ${Math.ceil(rect.height)}">
  <foreignObject width="100%" height="100%">
    <body xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${Math.ceil(rect.width)}px;height:${Math.ceil(rect.height)}px;">${clone.outerHTML}</body>
  </foreignObject>
</svg>`;

    let canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    let ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    let svgBlob = new Blob([svgText], {type: "image/svg+xml;charset=utf-8"});
    let svgUrl = URL.createObjectURL(svgBlob);

    try {
      let img = await loadImage(svgUrl);
      ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }

    for (let sourceCanvas of plot.root.querySelectorAll("canvas")) {
      let canvasRect = sourceCanvas.getBoundingClientRect();
      ctx.drawImage(sourceCanvas, (canvasRect.left - rect.left) * pxRatio, (canvasRect.top - rect.top) * pxRatio);
    }

    let pngBlob = await canvasToBlob(canvas);
    downloadBlob(pngBlob, `${sanitizeFileName(fileName)}.png`);
  }

  function createDownloadButton(label) {
    let button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = "padding:3px 8px;background:#fff;border:1px solid #e1e5ea;border-radius:4px;color:#2a3f5f;cursor:pointer;font-size:12px";
    return button;
  }

  window.attachUPlotDownloadButton = function(box, plot, fileName, csvData) {
    if (!box || !plot || box.querySelector(".chart-download-control")) return;

    let controls = document.createElement("div");
    controls.className = "chart-download-control";
    controls.dataset.exportIgnore = "true";
    controls.style.cssText = "display:flex;justify-content:flex-end;gap:4px;margin:0 0 4px";

    let pngButton = createDownloadButton("png");

    pngButton.addEventListener("click", async () => {
      let originalText = pngButton.textContent;
      pngButton.disabled = true;
      try {
        let exportPromise = exportElementAsPng(box, plot, fileName);
        pngButton.textContent = "rendering...";
        await exportPromise;
      } catch (err) {
        console.error(err);
        alert("failed to download chart png");
      } finally {
        pngButton.disabled = false;
        pngButton.textContent = originalText;
      }
    });

    controls.appendChild(pngButton);

    if (csvData) {
      let csvButton = createDownloadButton("csv");
      csvButton.addEventListener("click", () => {
        try {
          exportChartAsCsv(fileName, csvData);
        } catch (err) {
          console.error(err);
          alert("failed to download chart csv");
        }
      });
      controls.appendChild(csvButton);
    }

    let plotContainer = plot.root && plot.root.parentElement;
    if (plotContainer && plotContainer.parentElement === box)
      box.insertBefore(controls, plotContainer);
    else
      box.appendChild(controls);
  };
})();