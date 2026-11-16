import http from 'node:http';
import { URL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['\"]|['\"]$/g, '');
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const port = Number(process.env.PORT || 3017);
const useBaidu = true;
const baiduAk = process.env.BMAP_WEBAPI_AK || '';
const browserAk = process.env.VITE_BMAP_JSAPI_AK || '';
const allowedOrigin = process.env.ALLOWED_ORIGIN || `http://127.0.0.1:${process.env.VITE_PORT || 5173}`;
const maxBodyBytes = 16 * 1024;

const json = (res, status, body, origin) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  let bodyBytes = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    bodyBytes += chunk.length;
    if (bodyBytes > maxBodyBytes) {
      tooLarge = true;
      body = '';
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (tooLarge) {
      const error = new Error('请求内容过大');
      error.code = 'ETOOLARGE';
      reject(error);
      return;
    }
    try { resolve(JSON.parse(body || '{}')); } catch (cause) {
      const error = new Error('请求 JSON 格式无效', { cause });
      error.code = 'EBADJSON';
      reject(error);
    }
  });
  req.on('error', reject);
});

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求内容必须是 JSON 对象';
  if (!body.point || !Number.isFinite(body.point.lng) || !Number.isFinite(body.point.lat)) return 'point.lng / point.lat 必须是数字';
  if (Math.abs(body.point.lng) > 180 || Math.abs(body.point.lat) > 90) return '起点坐标超出范围';
  if (!['time', 'distance'].includes(body.mode)) return 'mode 必须是 time 或 distance';
  if (!['car_fastest', 'bike_fastest', 'foot_fastest'].includes(body.profile)) return '暂只支持最快驾车、骑行、步行';
  if (!Number.isFinite(body.limit) || body.limit <= 0) return 'limit 必须是正数';
  const allowedLimits = body.mode === 'time' ? [10, 20, 30, 45] : [1000, 3000, 5000, 10000];
  if (!allowedLimits.includes(body.limit)) return 'limit 不在支持的选项范围内';
  return null;
}

function parsePath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('多边形坐标为空');
  const values = path.split(',').map(v => v.trim() === '' ? NaN : Number(v));
  if (values.length % 2 || values.some(v => !Number.isFinite(v))) throw new Error('无法识别多边形坐标格式');
  const points = [];
  for (let i = 0; i < values.length; i += 2) {
    if (Math.abs(values[i]) > 180 || Math.abs(values[i + 1]) > 90) throw new Error('返回坐标超出范围');
    points.push({ lng: values[i], lat: values[i + 1] });
  }
  return points;
}

async function requestBaidu(body) {
  if (!baiduAk) throw new Error('BMAP_WEBAPI_AK 未配置');
  const endpoint = body.mode === 'time'
    ? 'https://api.map.baidu.com/logistics_truck/v1/isochrone'
    : 'https://api.map.baidu.com/logistics_truck/v1/isodistance';
  const params = new URLSearchParams({
    profile: body.profile,
    point: `${body.point.lng},${body.point.lat}`,
    inputCrs: 'bd09ll',
    outputCrs: 'bd09ll',
    ak: baiduAk,
  });
  params.set(body.mode === 'time' ? 'timeLimit' : 'distanceLimit', String(body.mode === 'time' ? body.limit * 60 : body.limit));
  const response = await fetch(`${endpoint}?${params}`, { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || ![0, 200].includes(data.status)) throw new Error(`百度接口错误：${data.status} ${data.message || ''}`);
  const points = parsePath(data.result?.path);
  if (points.length < 3) throw new Error('百度接口未返回有效多边形');
  return { mock: false, points };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin) return json(res, 403, { message: '来源不被允许' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { browserAk }, origin);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, useBaidu }, origin);
  if (req.method !== 'POST' || url.pathname !== '/api/reachability') return json(res, 404, { message: 'Not found' }, origin);
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json(res, 415, { message: 'Content-Type 必须是 application/json' }, origin);
  }
  try {
    const body = await readBody(req);
    const error = validate(body);
    if (error) return json(res, 400, { message: error }, origin);
    const result = await requestBaidu(body);
    return json(res, 200, result, origin);
  } catch (error) {
    if (error?.code === 'ETOOLARGE') return json(res, 413, { message: error.message }, origin);
    if (error?.code === 'EBADJSON') return json(res, 400, { message: error.message }, origin);
    return json(res, 502, { message: error instanceof Error ? error.message : '服务端错误' }, origin);
  }
});

server.listen(port, '127.0.0.1', () => console.log(`API server listening on http://127.0.0.1:${port}`));
