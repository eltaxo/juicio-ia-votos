// El juicio a la IA — servidor único, sin dependencias.
// VERSIÓN PÚBLICA: solo la página del móvil (/votar) y la API de votación. La mesa y la pantalla van en local.
//   node server.js            → http://localhost:3000
//   PORT=8080 ADMIN_KEY=xxx node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'juicio';
const PUB = path.join(__dirname, 'public');
const DATA = process.env.DATA_FILE || path.join(__dirname, 'datos-votacion.json');
const VIVO_MS = 8000; // un móvil cuenta como conectado si ha preguntado en los últimos 8 s

// ---------- estado de la votación ----------
let db = { jurado: {}, polls: {}, activa: null, seq: 0 };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, 'utf8'))); } catch (e) {}
const visto = {}; // id → último contacto (no se persiste)
let guardarT = null;
function guardar() {
  clearTimeout(guardarT);
  guardarT = setTimeout(() => fs.writeFile(DATA, JSON.stringify(db), () => {}), 400);
}
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function cuenta(p) {
  const c = new Array(p.def.opciones.length).fill(0);
  if (p.anon) p.cuenta.forEach((n, i) => (c[i] = n));
  else Object.values(p.votos).forEach(sel => sel.forEach(i => c[i]++));
  return c;
}
function resumen() {
  const ahora = Date.now();
  const polls = {};
  for (const [id, p] of Object.entries(db.polls)) {
    polls[id] = { cuenta: cuenta(p), total: p.anon ? p.quien.length : Object.keys(p.votos).length, abierta: p.abierta };
  }
  return {
    inscritos: Object.keys(db.jurado).length,
    conectados: Object.keys(visto).filter(id => ahora - visto[id] < VIVO_MS && db.jurado[id]).length,
    activa: db.activa, polls,
  };
}
function ganadores() {
  const aciertos = {};
  for (const p of Object.values(db.polls)) {
    if (p.anon || p.abierta || p.def.tipo !== 'unica' || p.def.sorteo === false) continue;
    const c = cuenta(p);
    let ok = p.def.correcta;
    if (ok == null) ok = c.indexOf(Math.max(...c)); // sin respuesta correcta: gana la opción más votada
    for (const [id, sel] of Object.entries(p.votos)) if (sel[0] === ok) aciertos[id] = (aciertos[id] || 0) + 1;
  }
  return Object.entries(aciertos).filter(([id]) => db.jurado[id])
    .map(([id, n]) => ({ nombre: db.jurado[id].nombre, aciertos: n })).sort((a, b) => b.aciertos - a.aciertos);
}

// ---------- utilidades HTTP ----------
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-admin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS));
  res.end(JSON.stringify(obj));
}
function cuerpo(req) {
  return new Promise(ok => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { ok({}); } });
  });
}
const EXT = { videos: /\.(mp4|webm|mov|m4v)$/i, audio: /\.(mp3|wav|ogg|m4a)$/i, img: /\.(png|jpe?g|webp|gif|svg)$/i };
function listar(dir) {
  try { return fs.readdirSync(path.join(PUB, 'assets', dir)).filter(f => EXT[dir].test(f)).sort(); } catch (e) { return []; }
}
function estatico(req, res, ruta) {
  if (ruta === '/') ruta = '/votar.html';
  if (!path.extname(ruta)) ruta += '.html';
  const f = path.normalize(path.join(PUB, decodeURIComponent(ruta)));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No encontrado'); }
    const tipo = TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const pesado = /^(video|audio)\//.test(tipo);
    const cab = { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': pesado ? 'public, max-age=3600' : 'no-cache' };
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) { // los vídeos necesitan peticiones parciales
      let ini = r[1] ? parseInt(r[1], 10) : 0, fin = r[2] ? parseInt(r[2], 10) : st.size - 1;
      if (!r[1] && r[2]) { ini = st.size - parseInt(r[2], 10); fin = st.size - 1; }
      if (ini > fin || ini >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      fin = Math.min(fin, st.size - 1);
      res.writeHead(206, Object.assign(cab, { 'Content-Range': `bytes ${ini}-${fin}/${st.size}`, 'Content-Length': fin - ini + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(f, { start: ini, end: fin }).pipe(res);
    }
    res.writeHead(200, Object.assign(cab, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
}

// ---------- rutas ----------
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ruta = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (!ruta.startsWith('/api/')) return estatico(req, res, ruta);

  // --- público ---
  if (ruta === '/api/assets') return json(res, 200, { videos: listar('videos'), audio: listar('audio'), img: listar('img') });
  if (ruta === '/api/info') {
    const ips = [];
    for (const l of Object.values(os.networkInterfaces())) for (const i of l) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    return json(res, 200, { ips, puerto: PORT });
  }
  if (ruta === '/api/join' && req.method === 'POST') {
    const b = await cuerpo(req);
    const nombre = String(b.nombre || '').trim().slice(0, 40);
    if (!nombre) return json(res, 400, { error: 'Falta el nombre' });
    const id = b.id && db.jurado[b.id] ? b.id : uid();
    db.jurado[id] = { nombre };
    visto[id] = Date.now();
    guardar();
    return json(res, 200, { id, nombre });
  }
  if (ruta === '/api/poll') {
    const id = u.searchParams.get('id');
    if (!id || !db.jurado[id]) return json(res, 200, { fuera: true });
    visto[id] = Date.now();
    const p = db.activa && db.polls[db.activa];
    if (!p || !p.abierta) return json(res, 200, { poll: null });
    const mio = p.anon ? (p.quien.includes(id) ? [] : null) : (p.votos[id] || null);
    const d = p.def;
    return json(res, 200, { poll: { id: d.id, tipo: d.tipo, pregunta: d.pregunta, opciones: d.opciones, boton: d.boton, ronda: p.ronda }, mio });
  }
  if (ruta === '/api/vote' && req.method === 'POST') {
    const b = await cuerpo(req);
    const p = db.polls[b.poll];
    if (!db.jurado[b.id]) return json(res, 403, { error: 'No inscrito' });
    if (!p || !p.abierta || db.activa !== b.poll) return json(res, 409, { error: 'La votación está cerrada' });
    const n = p.def.opciones.length;
    let sel = [...new Set((Array.isArray(b.sel) ? b.sel : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n))];
    if (p.def.tipo !== 'multi') sel = sel.slice(0, 1);
    if (p.def.tipo !== 'multi' && !sel.length) return json(res, 400, { error: 'Voto vacío' });
    if (p.anon) { // anónima: solo totales, un envío por persona
      if (p.quien.includes(b.id)) return json(res, 409, { error: 'Ya has votado' });
      p.quien.push(b.id);
      sel.forEach(i => p.cuenta[i]++);
    } else p.votos[b.id] = sel;
    visto[b.id] = Date.now();
    guardar();
    return json(res, 200, { ok: true });
  }

  // --- mesa de control ---
  if (ruta.startsWith('/api/admin/')) {
    if ((req.headers['x-admin'] || u.searchParams.get('k')) !== ADMIN_KEY) return json(res, 401, { error: 'Clave incorrecta' });
    const b = req.method === 'POST' ? await cuerpo(req) : {};
    const acc = ruta.slice(11);
    if (acc === 'state') return json(res, 200, resumen());
    if (acc === 'ganadores') return json(res, 200, { ganadores: ganadores() });
    if (acc === 'jurado') return json(res, 200, { jurado: Object.values(db.jurado).map(j => j.nombre) });
    if (acc === 'open') { // abre (o reabre) una votación; reinicia sus votos salvo que se pida conservarlos
      const d = b.def;
      if (!d || !d.id || !Array.isArray(d.opciones)) return json(res, 400, { error: 'Definición inválida' });
      const previa = db.polls[d.id];
      if (!previa || !b.conservar) {
        db.polls[d.id] = { def: d, abierta: true, anon: !!d.anon, votos: {}, cuenta: new Array(d.opciones.length).fill(0), quien: [], ronda: uid() };
      } else { previa.def = d; previa.abierta = true; }
      Object.values(db.polls).forEach(p => { if (p.def.id !== d.id) p.abierta = false; });
      db.activa = d.id; guardar();
      return json(res, 200, resumen());
    }
    if (acc === 'close') {
      if (db.polls[b.id]) { db.polls[b.id].abierta = false; if (b.correcta !== undefined) db.polls[b.id].def.correcta = b.correcta; }
      if (db.activa === b.id) db.activa = null;
      guardar();
      return json(res, 200, resumen());
    }
    if (acc === 'reset') { // para ensayos: borra votos (y jurado si todo=true)
      db.polls = {}; db.activa = null;
      if (b.todo) { db.jurado = {}; for (const k in visto) delete visto[k]; }
      guardar();
      return json(res, 200, resumen());
    }
  }
  json(res, 404, { error: 'Ruta desconocida' });
}).listen(PORT, () => {
  console.log(`\n  El juicio a la IA — listo`);
  console.log(`  Solo votación (móvil): http://localhost:${PORT}/votar\n`);
});
