const DATA_URL = "data/latest.csv";
const PREVIEW_ROW_COUNT = 8;

const state = {
  rows: [],
  headers: [],
  numericColumns: [],
  xAxis: null,
  selectedSeries: null,
};

const elements = {
  fileName: document.querySelector("#file-name"),
  statusText: document.querySelector("#status-text"),
  seriesSelect: document.querySelector("#series-select"),
  xAxisLabel: document.querySelector("#x-axis-label"),
  lastTimestamp: document.querySelector("#last-timestamp"),
  statLatest: document.querySelector("#stat-latest"),
  statAverage: document.querySelector("#stat-average"),
  statMinimum: document.querySelector("#stat-minimum"),
  statMaximum: document.querySelector("#stat-maximum"),
  statRows: document.querySelector("#stat-rows"),
  chartTitle: document.querySelector("#chart-title"),
  chart: document.querySelector("#chart"),
  tableHead: document.querySelector("#data-table thead"),
  tableBody: document.querySelector("#data-table tbody"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function toObjects(rows) {
  const [headers, ...dataRows] = rows;
  return {
    headers,
    rows: dataRows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
    ),
  };
}

function isNumericColumn(rows, header) {
  const values = rows
    .map((row) => row[header])
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  return values.length > 0 && values.length >= Math.max(3, Math.floor(rows.length * 0.5));
}

function detectColumns(headers, rows) {
  const numericColumns = headers.filter((header) => isNumericColumn(rows, header));
  const xAxis = headers[0] ?? null;
  return { numericColumns, xAxis };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function getSeriesValues(rows, header) {
  return rows
    .map((row) => ({
      x: row[state.xAxis],
      y: Number.parseFloat(row[header]),
    }))
    .filter((point) => Number.isFinite(point.y));
}

function updateStats() {
  const points = getSeriesValues(state.rows, state.selectedSeries);
  const values = points.map((point) => point.y);
  const latest = values[values.length - 1];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const lastRow = state.rows[state.rows.length - 1];

  elements.statLatest.textContent = formatNumber(latest);
  elements.statAverage.textContent = formatNumber(average);
  elements.statMinimum.textContent = formatNumber(minimum);
  elements.statMaximum.textContent = formatNumber(maximum);
  elements.statRows.textContent = String(state.rows.length);
  elements.lastTimestamp.textContent = lastRow?.[state.xAxis] || "Unavailable";
  elements.chartTitle.textContent = `${state.selectedSeries} over ${state.xAxis}`;
}

function drawChart() {
  const points = getSeriesValues(state.rows, state.selectedSeries);
  const canvas = elements.chart;
  const context = canvas.getContext("2d");
  const { width, height } = canvas;

  context.clearRect(0, 0, width, height);

  if (points.length === 0) {
    context.fillStyle = "#5b6a5f";
    context.font = "28px Georgia";
    context.fillText("No numeric data available for this series.", 40, 80);
    return;
  }

  const padding = { top: 40, right: 32, bottom: 70, left: 72 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.y);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  context.strokeStyle = "rgba(31, 42, 31, 0.12)";
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + (plotHeight / 4) * step;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  context.strokeStyle = "#2f7d4b";
  context.lineWidth = 4;
  context.beginPath();

  points.forEach((point, index) => {
    const x = padding.left + (index / Math.max(points.length - 1, 1)) * plotWidth;
    const y = padding.top + ((maxValue - point.y) / range) * plotHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  context.fillStyle = "#1f2a1f";
  context.font = "20px Georgia";
  context.textAlign = "right";
  context.fillText(formatNumber(maxValue), padding.left - 12, padding.top + 8);
  context.fillText(formatNumber(minValue), padding.left - 12, padding.top + plotHeight);

  context.textAlign = "left";
  context.fillText(points[0]?.x ?? "", padding.left, height - 24);
  context.textAlign = "right";
  context.fillText(points[points.length - 1]?.x ?? "", width - padding.right, height - 24);
}

function renderTable() {
  elements.tableHead.innerHTML = "";
  elements.tableBody.innerHTML = "";

  const headRow = document.createElement("tr");
  state.headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headRow.appendChild(th);
  });
  elements.tableHead.appendChild(headRow);

  const previewRows = state.rows.slice(-PREVIEW_ROW_COUNT).reverse();
  previewRows.forEach((row) => {
    const tr = document.createElement("tr");
    state.headers.forEach((header) => {
      const td = document.createElement("td");
      td.textContent = row[header];
      tr.appendChild(td);
    });
    elements.tableBody.appendChild(tr);
  });
}

function renderSeriesOptions() {
  elements.seriesSelect.innerHTML = "";
  state.numericColumns.forEach((header) => {
    const option = document.createElement("option");
    option.value = header;
    option.textContent = header;
    elements.seriesSelect.appendChild(option);
  });
  elements.seriesSelect.value = state.selectedSeries;
}

function render() {
  if (!state.selectedSeries) {
    elements.statusText.textContent = "No numeric sensor columns were found.";
    return;
  }

  elements.xAxisLabel.textContent = state.xAxis;
  elements.statusText.textContent = "Data loaded";
  renderSeriesOptions();
  updateStats();
  drawChart();
  renderTable();
}

async function loadData() {
  elements.fileName.textContent = DATA_URL;

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const parsedRows = parseCsv(text);
    const { headers, rows } = toObjects(parsedRows);
    const { numericColumns, xAxis } = detectColumns(headers, rows);

    state.headers = headers;
    state.rows = rows;
    state.numericColumns = numericColumns;
    state.xAxis = xAxis;
    state.selectedSeries = numericColumns[0] ?? null;

    render();
  } catch (error) {
    elements.statusText.textContent = `Failed to load CSV: ${error.message}`;
  }
}

elements.seriesSelect.addEventListener("change", (event) => {
  state.selectedSeries = event.target.value;
  updateStats();
  drawChart();
});

loadData();
