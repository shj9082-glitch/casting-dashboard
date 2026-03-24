
const META = {"source_file": "auto casting.xlsx", "min_date": "2026-02-28", "max_date": "2026-03-21", "units": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], "items": ["저속구간속도", "고속구간속도", "주조(증압)압력", "비스켓두께", "설비가동 CT", "제품생산 CT", "형체력", "유압온도", "냉각수 온도"]};
let manifest = {};
let itemDataCache = {};
let currentOutliers = [];

function $(id) { return document.getElementById(id); }

function fmtNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 3, minimumFractionDigits: 3 });
}

function getSelectedShifts() {
  return Array.from(document.querySelectorAll('#shiftChecks input:checked')).map(el => el.value);
}

function getSelectedUnits() {
  return Array.from(document.querySelectorAll('#unitChecks input:checked')).map(el => Number(el.value));
}

function buildUnitChecks() {
  const wrap = $('unitChecks');
  wrap.innerHTML = '';
  META.units.forEach(u => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${u}" checked> 주조기 ${u}`;
    wrap.appendChild(label);
  });
}

function fillSummaryCards(summary) {
  $('summaryCards').innerHTML = `
    <div class="card"><div class="card-title">선택 데이터 수</div><div class="card-value">${Number(summary.count||0).toLocaleString('ko-KR')}</div></div>
    <div class="card"><div class="card-title">평균</div><div class="card-value">${fmtNum(summary.avg)}</div></div>
    <div class="card"><div class="card-title">최소</div><div class="card-value">${fmtNum(summary.min)}</div></div>
    <div class="card"><div class="card-title">최대</div><div class="card-value">${fmtNum(summary.max)}</div></div>
  `;
}

function aggregateRows(rows, aggUnit) {
  const grouped = new Map();

  for (const r of rows) {
    let key = '';
    let label = '';

    if (aggUnit === '교대별') {
      key = `${r.date}|${r.shift}|${r.unit}`;
      label = `${r.date} ${r.shift}`;
    } else if (aggUnit === '일별') {
      key = `${r.date}|${r.unit}`;
      label = r.date;
    } else {
      const ym = String(r.date).slice(0, 7);
      key = `${ym}|${r.unit}`;
      label = ym;
    }

    if (!grouped.has(key)) grouped.set(key, { label, unit: r.unit, raws: [] });
    grouped.get(key).raws.push(r);
  }

  const result = [];
  for (const [, g] of grouped) {
    const vals = g.raws.map(x => Number(x.avg)).filter(v => !Number.isNaN(v));
    if (!vals.length) continue;

    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const lowMin = Math.min(...g.raws.map(x => Number(x.avg) - Number(x.low)));
    const highMax = Math.max(...g.raws.map(x => Number(x.avg) + Number(x.high)));

    result.push({
      label: g.label,
      unit: g.unit,
      avg,
      low: avg - lowMin,
      high: highMax - avg,
      rawCount: g.raws.reduce((a, b) => a + (b.count || 0), 0),
      minVal: lowMin,
      maxVal: highMax,
      sortKey: aggUnit === '월별'
        ? `${g.label}-01`
        : g.label.replace(' 주간', 'T08:00:00').replace(' 야간', 'T20:00:00')
    });
  }

  result.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.unit - b.unit);
  return result;
}

function computeSummary(rows) {
  const vals = rows.map(r => Number(r.avg)).filter(v => !Number.isNaN(v));
  if (!vals.length) return { count: 0, avg: null, min: null, max: null };

  return {
    count: rows.reduce((a, b) => a + (b.count || b.rawCount || 0), 0),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    min: Math.min(...rows.map(r => Number(r.minVal ?? (Number(r.avg) - Number(r.low))))),
    max: Math.max(...rows.map(r => Number(r.maxVal ?? (Number(r.avg) + Number(r.high)))))
  };
}

function refreshOutlierTable(rows, lowerEnabled, lowerValue, upperEnabled, upperValue) {
  const tbody = $('outlierTable').querySelector('tbody');
  tbody.innerHTML = '';
  currentOutliers = [];

  rows.forEach(r => {
    const val = Number(r.avg);
    const lowerHit = lowerEnabled && val < lowerValue;
    const upperHit = upperEnabled && val > upperValue;

    if (lowerHit || upperHit) {
      currentOutliers.push({
        발생시각: r.date,
        구간: `${r.date} ${r.shift}`,
        주조기: `주조기 ${r.unit}`,
        값: val
      });
    }
  });

  if (!currentOutliers.length) {
    $('outlierSummary').textContent = '설정한 이상치 기준에 해당하는 데이터가 없습니다.';
    return;
  }

  $('outlierSummary').innerHTML = `<span class="alert">이상치 ${currentOutliers.length.toLocaleString('ko-KR')}건 발견</span>`;

  currentOutliers.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.발생시각}</td><td>${r.구간}</td><td>${r.주조기}</td><td>${fmtNum(r.값)}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadManifest() {
  manifest = await fetch('manifest.json').then(r => r.json());
  const itemSelect = $('itemSelect');
  itemSelect.innerHTML = '';

  Object.keys(manifest).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    itemSelect.appendChild(opt);
  });
}

async function getItemData(item) {
  if (itemDataCache[item]) return itemDataCache[item];
  const file = manifest[item];
  const data = await fetch('data/' + file).then(r => r.json());
  itemDataCache[item] = data;
  return data;
}

function csvDownload() {
  if (!currentOutliers.length) return;
  const rows = [['발생시각', '구간', '주조기', '값']]
    .concat(currentOutliers.map(r => [r.발생시각, r.구간, r.주조기, r.값]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '이상치_목록.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function draw() {
  const item = $('itemSelect').value;
  const aggUnit = $('aggSelect').value;
  const shifts = getSelectedShifts();
  const units = getSelectedUnits();
  const start = $('startDate').value;
  const end = $('endDate').value;
  const runningOnly = $('runningOnly').checked;

  const useLower = $('useLower').checked;
  const useUpper = $('useUpper').checked;
  const lowerValue = Number($('lowerLimit').value);
  const upperValue = Number($('upperLimit').value);

  const useManualY = $('useYManual').checked;
  const yMin = Number($('yMin').value);
  const yMax = Number($('yMax').value);

  let rows = await getItemData(item);
  rows = rows.filter(r => (!runningOnly || r.running !== false));
  rows = rows.filter(r => (!start || r.date >= start) && (!end || r.date <= end));
  rows = rows.filter(r => shifts.includes(r.shift));
  rows = rows.filter(r => units.includes(Number(r.unit)));

  const aggregated = aggregateRows(rows, aggUnit);
  const summary = computeSummary(aggregated);
  fillSummaryCards(summary);

  $('chartTitle').textContent = `${item} 트렌드 (${aggUnit})`;
  $('chartSubtitle').textContent = `기준일 ${start || META.min_date} ~ ${end || META.max_date} / 선택 주조기 ${units.length}대`;

  const traces = [];
  const labels = [...new Set(aggregated.map(r => r.label))];

  for (const u of units) {
    const arr = aggregated.filter(r => Number(r.unit) === Number(u));
    if (!arr.length) continue;

    traces.push({
      x: arr.map(r => r.label),
      y: arr.map(r => r.avg),
      error_y: {
        type: 'data',
        symmetric: false,
        array: arr.map(r => r.high),
        arrayminus: arr.map(r => r.low),
        visible: true
      },
      mode: 'lines+markers',
      name: `주조기 ${u}`,
      hovertemplate: '주조기: %{fullData.name}<br>구간: %{x}<br>평균: %{y:.3f}<extra></extra>'
    });
  }

  const layout = {
    margin: { l: 70, r: 30, t: 20, b: 140 },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    xaxis: {
      tickangle: -90,
      showgrid: true,
      gridcolor: '#e5ebf5',
      categoryorder: 'array',
      categoryarray: labels
    },
    yaxis: {
      showgrid: true,
      gridcolor: '#e5ebf5',
      zeroline: false
    },
    legend: { orientation: 'v' }
  };

  if (useManualY && !Number.isNaN(yMin) && !Number.isNaN(yMax) && yMax > yMin) {
    layout.yaxis.range = [yMin, yMax];
  } else if (aggregated.length) {
    const ys = aggregated.map(r => Number(r.avg));
    const ymin = Math.min(...ys);
    const ymax = Math.max(...ys);
    const margin = ymax !== ymin ? (ymax - ymin) * 0.1 : Math.max(Math.abs(ymax) * 0.1, 1);
    layout.yaxis.range = [ymin - margin, ymax + margin];
  }

  Plotly.newPlot('chart', traces, layout, {
    responsive: true,
    displaylogo: false
  });

  refreshOutlierTable(rows, useLower, lowerValue, useUpper, upperValue);
}

async function init() {
  $('fileInfo').textContent = `원본 파일: ${META.source_file} / 데이터 범위: ${META.min_date} ~ ${META.max_date}`;
  await loadManifest();
  buildUnitChecks();

  $('startDate').value = META.min_date;
  $('endDate').value = META.max_date;

  $('selectAllUnits').onclick = () => {
    document.querySelectorAll('#unitChecks input').forEach(el => el.checked = true);
  };
  $('clearAllUnits').onclick = () => {
    document.querySelectorAll('#unitChecks input').forEach(el => el.checked = false);
  };

  $('applyBtn').onclick = draw;
  $('downloadCsvBtn').onclick = csvDownload;

  draw();
}

init();
