const features = [
  ["temperature", "Temperature", "deg C"],
  ["dewpoint", "Dew point", "deg C"],
  ["pressure", "Pressure", "hPa"],
  ["wind_u", "Wind U", "m/s"],
  ["wind_v", "Wind V", "m/s"],
  ["cloud_cover", "Cloud cover", "%"],
  ["humidity", "Humidity", "%"],
];

const cities = JSON.parse(document.getElementById("cities-data")?.textContent || "[]");
const cityOverview = JSON.parse(document.getElementById("overview-data")?.textContent || "{}");

const inputsContainer = document.getElementById("inputs");
const citySelect = document.getElementById("city");
const loadingText = document.getElementById("loading");
const formError = document.getElementById("formError");

let chart;
let fullGraph = null;
let currentRange = 300;
let visibleSeries = {
  actual: true,
  predicted: true,
};

function titleCase(value) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function populateCities() {
  if (!citySelect) return;

  cities.forEach((city) => {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = titleCase(city);
    citySelect.appendChild(option);
  });
}

function buildInputs() {
  if (!inputsContainer) return;

  features.forEach(([id, label, unit]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "input-group";

    const fieldLabel = document.createElement("label");
    fieldLabel.htmlFor = id;
    fieldLabel.textContent = `${label} (${unit})`;

    const input = document.createElement("input");
    input.id = id;
    input.type = "number";
    input.step = "any";
    input.placeholder = `Enter ${label.toLowerCase()}`;

    wrapper.appendChild(fieldLabel);
    wrapper.appendChild(input);
    inputsContainer.appendChild(wrapper);
  });
}

function fill(values) {
  features.forEach(([field], index) => {
    document.getElementById(field).value = values[index];
  });
}

function sample1() {
  fill([35.5, 18.2, 1018.6, 0.3, -0.4, 6, 28]);
}

function sample2() {
  fill([31.8, 28.7, 999.4, -7.6, 5.8, 88, 91]);
}

function sample3() {
  fill([22.1, 21.9, 987.8, -14.2, 11.6, 100, 100]);
}

function randomFill() {
  const mode = Math.random();

  if (mode < 0.34) {
    fill([
      (34 + Math.random() * 4).toFixed(2),
      (16 + Math.random() * 4).toFixed(2),
      (1015 + Math.random() * 5).toFixed(2),
      (-1 + Math.random() * 2).toFixed(2),
      (-1 + Math.random() * 2).toFixed(2),
      (2 + Math.random() * 12).toFixed(2),
      (20 + Math.random() * 18).toFixed(2),
    ]);
    return;
  }

  if (mode < 0.67) {
    fill([
      (29 + Math.random() * 5).toFixed(2),
      (25 + Math.random() * 4).toFixed(2),
      (996 + Math.random() * 5).toFixed(2),
      (-8 + Math.random() * 6).toFixed(2),
      (3 + Math.random() * 6).toFixed(2),
      (75 + Math.random() * 18).toFixed(2),
      (82 + Math.random() * 14).toFixed(2),
    ]);
    return;
  }

  fill([
    (20 + Math.random() * 4).toFixed(2),
    (20 + Math.random() * 3).toFixed(2),
    (984 + Math.random() * 6).toFixed(2),
    (-16 + Math.random() * 7).toFixed(2),
    (8 + Math.random() * 8).toFixed(2),
    (96 + Math.random() * 4).toFixed(2),
    (96 + Math.random() * 4).toFixed(2),
  ]);
}

function renderMetrics(metrics) {
  const metricsContainer = document.getElementById("metrics");
  if (!metricsContainer) return;

  metricsContainer.innerHTML = "";

  [
    ["MAE", `${metrics.MAE.toFixed(4)} mm`],
    ["RMSE", `${metrics.RMSE.toFixed(4)} mm`],
    ["R2", metrics.R2.toFixed(4)],
    ["MedAE", `${metrics.MedAE.toFixed(4)} mm`],
    ["MSE", metrics.MSE.toFixed(4)],
  ].forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "metric-card";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    metricsContainer.appendChild(card);
  });
}

function renderOverviewCards(selectedCity) {
  const overviewContainer = document.getElementById("overviewCards");
  if (!overviewContainer) return;

  overviewContainer.innerHTML = "";

  cities.forEach((city) => {
    const info = cityOverview[city];
    const isActive = city === selectedCity;
    const card = document.createElement("article");
    card.className = "overview-card";
    card.style.borderColor = isActive ? "rgba(21, 59, 92, 0.28)" : "";
    card.style.background = isActive ? "rgba(21, 59, 92, 0.06)" : "";
    card.innerHTML = `
      <h4>${titleCase(city)}</h4>
      <p>Temperature: ${info.temperature} deg C</p>
      <p>R2 score: ${info.r2}</p>
      <p>Records: ${info.records}</p>
    `;
    overviewContainer.appendChild(card);
  });
}

function updateSnapshot(city) {
  const info = cityOverview[city];
  if (!info) return;

  document.getElementById("cityLabel").innerText = `Area: ${titleCase(city)}`;
  renderMetrics({
    MAE: info.mae,
    RMSE: info.rmse,
    R2: info.r2,
    MedAE: info.medae,
    MSE: info.mse,
  });
  renderOverviewCards(city);
}

function getChartGraph() {
  if (!fullGraph) return null;

  const actual = fullGraph.actual.slice(0, currentRange);
  const predicted = fullGraph.predicted.slice(0, currentRange);
  return { actual, predicted };
}

function drawChart() {
  const graph = getChartGraph();
  if (!graph) return;

  const ctx = document.getElementById("chart");
  const actualSeries = graph.actual.map((y, x) => ({ x, y }));
  const predictedSeries = graph.predicted.map((y, x) => ({ x, y }));
  const yMax = Math.max(...graph.actual, ...graph.predicted);
  const yAxisMax = Math.max(5.3, Math.ceil(yMax * 10) / 10);

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        visibleSeries.actual
          ? {
          label: "Actual rainfall",
          data: actualSeries,
          borderColor: "#153b5c",
          backgroundColor: "rgba(21, 59, 92, 0.08)",
          borderWidth: 2.6,
          tension: 0.22,
          pointRadius: 0,
          fill: false,
        }
          : null,
        visibleSeries.predicted
          ? {
          label: "Predicted rainfall",
          data: predictedSeries,
          borderColor: "#5f85a5",
          borderWidth: 2.6,
          borderDash: [8, 5],
          tension: 0.22,
          pointRadius: 0,
          fill: false,
        }
          : null,
      ].filter(Boolean),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: graph.actual.length - 1,
          ticks: {
            stepSize: 50,
            color: "#607287",
          },
          grid: {
            color: "rgba(96, 114, 135, 0.12)",
          },
          title: {
            display: true,
            text: "Time steps",
            color: "#607287",
          },
        },
        y: {
          min: 0,
          max: yAxisMax,
          ticks: {
            stepSize: 1,
            color: "#607287",
          },
          grid: {
            color: "rgba(96, 114, 135, 0.12)",
          },
          title: {
            display: true,
            text: "Rainfall (mm)",
            color: "#607287",
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: "#162638",
            usePointStyle: true,
          },
        },
        title: {
          display: true,
          text: "Historical rainfall model comparison",
          color: "#162638",
          font: {
            size: 18,
            weight: "600",
          },
        },
      },
    },
  });
}

function setupChartControls() {
  document.querySelectorAll(".chart-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.series;
      visibleSeries[key] = !visibleSeries[key];
      button.classList.toggle("active", visibleSeries[key]);

      if (!visibleSeries.actual && !visibleSeries.predicted) {
        visibleSeries[key] = true;
        button.classList.add("active");
      }

      drawChart();
    });
  });

  document.querySelectorAll(".chart-range").forEach((button) => {
    button.addEventListener("click", () => {
      currentRange = Number(button.dataset.range);
      document.querySelectorAll(".chart-range").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      drawChart();
    });
  });
}

async function predict() {
  const city = citySelect.value;

  try {
    formError.style.display = "none";

    const values = features.map(([field]) => {
      const value = parseFloat(document.getElementById(field).value);
      if (Number.isNaN(value)) {
        throw new Error("Please complete all weather input fields before running the forecast.");
      }
      return value;
    });

    loadingText.style.display = "block";

    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, features: values }),
    });

    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Your session expired. Please sign in again."
          : "Prediction request failed."
      );
    }

    const data = await response.json();

    document.getElementById("result").innerText = `${data.rainfall} mm`;
    document.getElementById("time").innerText = `Generated on ${new Date().toLocaleString()}`;

    renderMetrics(data.metrics);
    updateSnapshot(city);
    fullGraph = data.graph;
    drawChart();

    document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    formError.innerText = error.message;
    formError.style.display = "block";
  } finally {
    loadingText.style.display = "none";
  }
}

function initializeDashboard() {
  if (!cities.length) return;

  populateCities();
  buildInputs();
  updateSnapshot(cities[0]);
  setupChartControls();

  citySelect.addEventListener("change", (event) => {
    updateSnapshot(event.target.value);
  });
}

initializeDashboard();
