/**
 * Soluciones Académicas Lombana — Parser v5 (Blindado)
 * Soporta: HTML dinámico (QS Array seguro), Word, PDF, Hoja de Respuestas.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── ENTRY POINT ───────────────────────────────────
async function parseFile(filePath, ext) {
  ext = (ext || '').toLowerCase();
  const buf = fs.readFileSync(filePath);

  if (ext === '.zip')  return parseZip(filePath);
  if (ext === '.docx') return parseDocx(buf);
  if (ext === '.pdf')  return parsePdf(buf);
  if (ext === '.html' || ext === '.htm')
    return parseLombanaHtml(buf.toString('utf-8'), {});
  throw new Error('Formato no soportado. Usa ZIP, HTML, PDF o DOCX.');
}

// ─── ZIP ──────────────────────────────────────────
async function parseZip(zipPath) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch(e) { throw new Error('El módulo adm-zip no está instalado.'); }

  const zip      = new AdmZip(zipPath);
  const entries  = zip.getEntries();
  const imageMap = {};

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name  = entry.entryName;
    const lower = name.toLowerCase();
    if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)) continue;
    const inImageFolder = lower.includes('imagen/') || lower.includes('imagen\\');
    if (!inImageFolder && lower.includes('/') && !lower.startsWith('imagen')) continue;

    const ext2  = path.extname(name).toLowerCase();
    const fname = uuidv4() + ext2;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), entry.getData());
    const url = '/uploads/' + fname;
    imageMap[name] = url;
    imageMap[path.basename(name)] = url;
  }

  const htmlEntry = entries.find(e => !e.isDirectory && /\.html?$/i.test(e.entryName));
  if (!htmlEntry) throw new Error('No se encontró ningún archivo HTML dentro del ZIP.');

  return parseLombanaHtml(htmlEntry.getData().toString('utf-8'), imageMap);
}

// ─── LOMBANA HTML PARSER ───────────────────────────
async function parseLombanaHtml(html, imageMap) {
  let cheerio;
  try { cheerio = require('cheerio'); }
  catch(e) { throw new Error('Módulo cheerio no disponible.'); }

  let processed = html;
  for (const [local, url] of Object.entries(imageMap || {})) {
    const esc = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    processed = processed.replace(new RegExp(`(src=["'])(?:[^"']*?(?:imagen[/\\\\])?${esc})`, 'gi'), '$1' + url);
  }

  const $ = cheerio.load(processed, { decodeEntities: false });
  const scriptText = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Simulacro';
  let timeLimit = 6000;

  const tm = scriptText.match(/TOTAL_SECONDS\s*=\s*([\d\s*+]+)/);
  if (tm) { try { timeLimit = Function('"use strict"; return (' + tm[1].replace(/[^0-9\s*+]/g, '') + ')')(); } catch {} }

  const answerKey = {};
  
  // EXTRACCIÓN SEGURA DE RESPUESTAS DEL HTML (Sin usar eval para evitar crasheos)
  // Busca el formato clásico: ANSWER_KEY = { 1: "A" }
  const km = scriptText.match(/ANSWER_KEY\s*=\s*\{([^}]+)\}/s);
  if (km) {
    for (const [, n, a] of km[1].matchAll(/(\d+)\s*:\s*['"]([A-Da-d])['"]/g)) answerKey[parseInt(n)] = a.toUpperCase();
  }
  
  // Busca en tu formato QS interactivo: n: 1, ans: 0 (0=A, 1=B, 2=C...)
  for (const [, n, a] of scriptText.matchAll(/n\s*:\s*(\d+)[^}]*?ans\s*:\s*(\d+)/g)) {
    answerKey[parseInt(n)] = String.fromCharCode(65 + parseInt(a));
  }
  for (const [, a, n] of scriptText.matchAll(/ans\s*:\s*(\d+)[^}]*?n\s*:\s*(\d+)/g)) {
    answerKey[parseInt(n)] = String.fromCharCode(65 + parseInt(a));
  }

  // Procesamos el texto visual del HTML
  const fallback = parseTextLines($('body').text());
  
  // Asignamos las respuestas encontradas en los scripts a las preguntas
  Object.keys(answerKey).forEach(n => {
    const q = fallback.situations.flatMap(s => s.questions).find(q => q.num === parseInt(n));
    if (q) q.correct_answer = answerKey[n];
  });
  
  fallback.title = title;
  fallback.timeLimit = timeLimit;
  fallback.images = Object.values(imageMap);
  return fallback;
}

// ─── DOCX ──────────────────────────────────────────
async function parseDocx(buffer) {
  let mammoth;
  try { mammoth = require('mammoth'); }
  catch(e) { throw new Error('Módulo mammoth no disponible.'); }

  const imgs = [];
  const ih = mammoth.images.imgElement(async (image) => {
    try {
      const d = await image.read('base64');
      const e = (image.contentType || 'image/png').split('/')[1].replace('jpeg','jpg');
      const f = uuidv4() + '.' + e;
      fs.writeFileSync(path.join(UPLOADS_DIR, f), Buffer.from(d, 'base64'));
      const u = '/uploads/' + f;
      imgs.push(u);
      return { src: u };
    } catch { return {}; }
  });

  const [h, t] = await Promise.all([
    mammoth.convertToHtml({ buffer }, { convertImage: ih }),
    mammoth.extractRawText({ buffer })
  ]);

  const r = parseTextLines(t.value, h.value);
  r.images = imgs;
  return r;
}

// ─── PDF ───────────────────────────────────────────
async function parsePdf(buffer) {
  let pdfParse;
  try { pdfParse = require('pdf-parse'); }
  catch(e) { throw new Error('Módulo pdf-parse no disponible.'); }

  let data;
  try { data = await pdfParse(buffer); }
  catch(e) { throw new Error('No se pudo leer el PDF.'); }

  const r = parseTextLines(data.text, null);
  r.images = [];
  r._note = 'Las imágenes del PDF deben subirse manualmente en el editor.';
  return r;
}

// ─── TEXT LINES → STRUCTURE (Súper Inteligente) ────
function parseTextLines(raw, html) {
  let rawText = String(raw || '');
  
  if (rawText.includes('<html') || rawText.includes('<div') || rawText.includes('<p>')) {
      rawText = rawText.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  }

  const lines = rawText.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').map(l => l.trim()).filter(l => l.length > 1);
  const situations = [];
  let curSit = null, curQ = null, ctxBuf = [], inCtx = false;

  const P_SIT = /CONTESTE\s+LAS\s+PREGUNTAS?|SITUACI[OÓ]N\s*\d+|DE\s+ACUERDO\s+(A\s+)?LA\s+SIGUIENTE/i;
  const P_Q   = /^(\d{1,3})[.)\-]?\s+(.+)/;
  const P_O   = /^([A-Da-d])[.)\-]\s+(.+)/;

  const pushQ = () => {
    if (!curQ || !curSit) return;
    if (curQ.options.length < 2) ['A','B','C','D'].filter(k => !curQ.options.find(o => o.key === k)).forEach(k => curQ.options.push({ key: k, text: `Opción ${k}`, image_url: null }));
    curSit.questions.push(curQ);
    curQ = null;
  };
  
  const pushSit = () => {
    if (!curSit) return;
    pushQ();
    if (ctxBuf.length && !curSit.context) { 
        let cStr = ctxBuf.join('\n').trim();
        // Filtro antimanchas: Ignora líneas sueltas que sean solo números como "1-4" o "Página 2"
        if (!/^(?:\d+-\d+|\d+|p[áa]gina.*)$/i.test(cStr)) curSit.context = cStr;
        ctxBuf = []; 
    }
    if (curSit.questions.length || curSit.context) situations.push(curSit);
    curSit = null;
  };

  for (const line of lines) {
    if (P_SIT.test(line)) {
      pushSit();
      const rm = line.match(/(\d+)\s+[AaÁ]\s+(\d+)/);
      curSit = { label: rm ? `Preguntas ${rm[1]} a ${rm[2]}` : `Situación ${situations.length + 1}`, context: '', image_url: null, questions: [] };
      ctxBuf = []; inCtx = true; continue;
    }

    const qm = line.match(P_Q);
    if (qm && !P_O.test(line) && +qm[1] >= 1 && +qm[1] <= 999) {
      inCtx = false;
      if (curSit && ctxBuf.length && !curSit.context) { 
          let cStr = ctxBuf.join('\n').trim();
          if (!/^(?:\d+-\d+|\d+|p[áa]gina.*)$/i.test(cStr)) curSit.context = cStr;
          ctxBuf = []; 
      }
      if (!curSit) curSit = { label: `Situación ${situations.length + 1}`, context: '', image_url: null, questions: [] };
      pushQ();
      curQ = { num: +qm[1], text: qm[2].trim(), image_url: null, correct_answer: 'A', options: [] };
      continue;
    }

    const om = line.match(P_O);
    if (om && curQ) { 
        let optKey = om[1].toUpperCase();
        let optText = om[2].trim();
        // Detectar asterisco en la opción
        if (optText.includes('*')) { curQ.correct_answer = optKey; optText = optText.replace(/\*/g, '').trim(); }
        curQ.options.push({ key: optKey, text: optText, image_url: null }); 
        continue; 
    }

    const ansMatch = line.match(/^(?:Respuesta|Clave|Correcta)[^\w]*([A-Da-d])/i);
    if (ansMatch && curQ) { curQ.correct_answer = ansMatch[1].toUpperCase(); continue; }

    if (inCtx && curSit)  ctxBuf.push(line);
    else if (curQ) { if (!curQ.options.length) curQ.text += ' ' + line; else { const l = curQ.options[curQ.options.length-1]; if(l) l.text += ' '+line; } }
    else ctxBuf.push(line);
  }
  pushSit();

  if (!situations.length || situations.every(s => !s.questions.length)) {
    const sit = { label: 'Preguntas', context: '', image_url: null, questions: [] };
    let q = null;
    for (const line of lines) {
      const qm = line.match(/^(\d{1,3})[.)\-]?\s+(.+)/);
      const om = line.match(/^([A-Da-d])[.)\-]\s+(.+)/);
      if (qm && !om) { if(q) sit.questions.push(q); q = { num:+qm[1], text:qm[2], correct_answer:'A', options:[], image_url:null }; }
      else if (om && q) {
          let optKey = om[1].toUpperCase(); let optText = om[2].trim();
          if (optText.includes('*')) { q.correct_answer = optKey; optText = optText.replace(/\*/g, '').trim(); }
          q.options.push({ key:optKey, text:optText, image_url:null });
      } else {
          const ansMatch = line.match(/^(?:Respuesta|Clave|Correcta)[^\w]*([A-Da-d])/i);
          if (ansMatch && q) q.correct_answer = ansMatch[1].toUpperCase();
      }
    }
    if (q) sit.questions.push(q);
    if (sit.questions.length) situations.push(sit);
  }

  // MAGIA 3: Escáner de Hoja de Respuestas al final del documento
  const bottomText = rawText.slice(-2000); 
  const ansKeyMatch = bottomText.match(/(?:respuestas|claves|hoja de respuestas|solucionario)[\s\S]+/i);
  if (ansKeyMatch) {
     const keys = [...ansKeyMatch[0].matchAll(/(\d{1,3})[.\-]?\s*([A-D])/gi)];
     keys.forEach(k => {
        const qNum = parseInt(k[1]), ans = k[2].toUpperCase();
        situations.forEach(s => s.questions.forEach(q => { if (q.num === qNum) q.correct_answer = ans; }));
     });
  }

  let c = 0;
  situations.forEach(s => s.questions.forEach(q => { q.num = ++c; }));
  return { situations, totalQuestions: c, totalSituations: situations.length, images: [] };
}

async function parseHtmlContent(html) { return parseLombanaHtml(String(html || ''), {}); }
module.exports = { parseFile, parseHtmlContent };
