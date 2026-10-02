// Browser client: enqueue jobs and poll their status.
// All user/server text is rendered with textContent (never innerHTML) to avoid XSS.
const $ = (id) => document.getElementById(id);
const form = $('job-form');
const msg = $('form-msg');
const jobsList = $('jobs');

// The key lives only in this tab (sessionStorage), never in localStorage or in the code.
try { $('api-key').value = sessionStorage.getItem('apiKey') ?? ''; } catch { /* storage blocked */ }

function syntheticSeries(n = 60) {
  // Decreasing trend + noise, similar to a drying signal in central Chile (illustrative only).
  return Array.from({ length: n }, (_, i) => Math.max(0, Math.round(420 - 1.8 * i + (Math.random() - 0.5) * 220)));
}

$('fill-example').addEventListener('click', () => {
  $('series-values').value = syntheticSeries().join(', ');
});

function readPayload() {
  const values = $('series-values').value.split(/[\s,;]+/).filter(Boolean).map(Number);
  const unit = $('series-unit').value.trim();
  return {
    type: 'series-stats',
    series: { name: $('series-name').value.trim(), ...(unit && { unit }), values },
  };
}

async function api(path, options = {}) {
  const apiKey = $('api-key').value;
  try { sessionStorage.setItem('apiKey', apiKey); } catch { /* storage blocked */ }
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function enqueue(payload = readPayload(), out = msg) {
  const { res, body } = await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
  if (res.status !== 202) {
    const detail = body.details?.map((d) => `${d.path}: ${d.message}`).join('; ');
    out.textContent = `Error ${res.status}: ${body.error ?? 'desconocido'}${detail ? ` (${detail})` : ''}`;
    return;
  }
  out.textContent = `Trabajo encolado: ${body.jobId}`;
  trackJob(body.jobId);
}

form.addEventListener('submit', (e) => { e.preventDefault(); enqueue(); });

const EXAMPLE_POLYGON = {
  type: 'Polygon',
  coordinates: [[[-70.6, -33.5], [-70.3, -33.5], [-70.3, -33.3], [-70.6, -33.3], [-70.6, -33.5]]],
};
$('geo-example').addEventListener('click', () => {
  $('geo-geometry').value = JSON.stringify(EXAMPLE_POLYGON, null, 2);
});
$('geo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  let geometry;
  try {
    geometry = JSON.parse($('geo-geometry').value);
  } catch {
    $('geo-msg').textContent = 'El polígono no es JSON válido';
    return;
  }
  enqueue({ type: 'zonal-stats', dataset: $('geo-dataset').value, geometry }, $('geo-msg'));
});
$('burst').addEventListener('click', async () => {
  for (let i = 0; i < 10; i++) await enqueue();
});

function fmt(x) {
  return typeof x === 'number' ? x.toFixed(3) : String(x);
}

function trackJob(jobId) {
  const li = document.createElement('li');
  const title = document.createElement('code');
  title.textContent = jobId.slice(0, 8);
  const state = document.createElement('span');
  state.className = 'state';
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 0;
  const result = document.createElement('pre');
  li.append(title, state, bar, result);
  jobsList.prepend(li);

  const timer = setInterval(async () => {
    const { res, body } = await api(`/api/jobs/${jobId}`);
    if (!res.ok) {
      state.textContent = `error ${res.status}`;
      clearInterval(timer);
      return;
    }
    state.textContent = body.state;
    state.dataset.state = body.state;
    bar.value = typeof body.progress === 'number' ? body.progress : 0;
    if (body.state === 'completed' && body.type === 'zonal-stats') {
      const r = body.result;
      result.textContent = [
        `área=${fmt(r.geometry.area_km2)} km²  perímetro=${fmt(r.geometry.perimeter_km)} km  centroide=${r.geometry.centroid.join(', ')}`,
        `píxeles válidos=${r.pixels_valid} (sin dato=${r.pixels_nodata})  [${r.dataset}, ${r.crs}]`,
        `mín=${fmt(r.stats.min)}  media=${fmt(r.stats.mean)}  máx=${fmt(r.stats.max)}  sd=${fmt(r.stats.std)} ${r.units ?? ''}`,
        `p10=${fmt(r.stats.p10)}  p50=${fmt(r.stats.p50)}  p90=${fmt(r.stats.p90)}`,
      ].join('\n');
      clearInterval(timer);
    } else if (body.state === 'completed') {
      const s = body.result.stats;
      result.textContent = [
        `n=${s.n}  media=${fmt(s.mean)}  sd=${fmt(s.sd)}  mín=${fmt(s.min)}  máx=${fmt(s.max)}`,
        `pendiente OLS=${fmt(s.olsSlope)}  Sen=${fmt(s.senSlope)} ${body.result.series.unit ?? ''}/paso`,
        `Mann-Kendall Z=${fmt(s.mannKendall.z)}  p=${fmt(s.mannKendall.pValue)}  → ${s.trend}`,
      ].join('\n');
      clearInterval(timer);
    } else if (body.state === 'failed') {
      result.textContent = body.error;
      clearInterval(timer);
    }
  }, 1000);
}
