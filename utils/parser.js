/**
 * Soluciones Académicas Lombana — Parser v2
 * PDF · DOCX · HTML (formato Lombana) · ZIP (HTML + imagen/)
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
  catch(e) {
    throw new Error(
      'El módulo adm-zip no está instalado. Ejecuta: npm install adm-zip  ' +
      'y reinicia el servidor. (' + e.message + ')'
    );
  }

  const zip      = new AdmZip(zipPath);
  const entries  = zip.getEntries();
  const imageMap = {};

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name  = entry.entryName;          // e.g. "imagen/grafica.png"
    const lower = name.toLowerCase();
    if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)) continue;
    // Accept images from "imagen/" folder OR any images in root
    const inImageFolder = lower.includes('imagen/') || lower.includes('imagen\\');
    if (!inImageFolder && lower.includes('/') && !lower.startsWith('imagen')) continue;

    const ext2  = path.extname(name).toLowerCase();
    const fname = uuidv4() + ext2;
    fs.writeFileSync(path.join(UPLOADS_DIR, fname), entry.getData());
    const url              = '/uploads/' + fname;
    imageMap[name]                  = url;   // full path  → url
    imageMap[path.basename(name)]   = url;   // basename   → url
  }

  // Find HTML — prefer root-level file
  const htmlEntry =
    entries.find(e => !e.isDirectory && /\.html?$/i.test(e.entryName) && !e.entryName.includes('/')) ||
    entries.find(e => !e.isDirectory && /\.html?$/i.test(e.entryName));

  if (!htmlEntry) throw new Error('No se encontró ningún archivo HTML dentro del ZIP.');

  return parseLombanaHtml(htmlEntry.getData().toString('utf-8'), imageMap);
}

// ─── LOMBANA HTML PARSER ──────────────────────────
async function parseLombanaHtml(html, imageMap) {
  let cheerio;
  try { cheerio = require('cheerio'); }
  catch(e) { throw new Error('Módulo cheerio no disponible: ' + e.message); }

  // Rewrite local image src → uploaded URL
  let processed = html;
  for (const [local, url] of Object.entries(imageMap || {})) {
    const esc = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Handle both forward and back slashes
    processed = processed.replace(
      new RegExp(`(src=["'])(?:[^"']*?(?:imagen[/\\\\])?${esc})`, 'gi'),
      '$1' + url
    );
  }

  const $ = cheerio.load(processed, { decodeEntities: false });

  // ── Extract ANSWER_KEY from <script> ──
  const answerKey = {};
  const scriptText = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const km = scriptText.match(/ANSWER_KEY\s*=\s*\{([^}]+)\}/s);
  if (km) {
    for (const [, n, a] of km[1].matchAll(/(\d+)\s*:\s*['"]([A-Da-d])['"]/g))
      answerKey[parseInt(n)] = a.toUpperCase();
  }

  // ── Extract TOTAL_SECONDS ──
  let timeLimit = 6000;
  const tm = scriptText.match(/TOTAL_SECONDS\s*=\s*([\d\s*+]+)/);
  if (tm) {
    try {
      // Safe eval: only digits, spaces, * +
      const expr = tm[1].trim().replace(/[^0-9\s*+]/g, '');
      timeLimit = Function('"use strict"; return (' + expr + ')')();
    } catch {}
  }

  // ── Title ──
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Simulacro';

  // ── Helper: resolve image src ──
  function resolveImg(src) {
    if (!src) return null;
    if (src.startsWith('http') || src.startsWith('/uploads')) return src;
    return imageMap[src] || imageMap[path.basename(src)] || null;
  }

  // ── Walk all elements in order ──
  const situations = [];
  let curSit   = null;
  let globalQ  = 0;

  $('body *').each((_, el) => {
    const $el  = $(el);
    const tag  = el.tagName || '';
    const cls  = ($el.attr('class') || '').split(/\s+/);
    const id   = $el.attr('id') || '';

    // ── SITUATION BLOCK ──
    if (cls.includes('situation-block') || cls.includes('context-block')) {
      if (curSit && curSit.questions.length) situations.push(curSit);

      // Pull context image before removing img tags
      let ctxImg = null;
      $el.find('img').each((_, img) => {
        const s = resolveImg($(img).attr('src'));
        if (s && !s.includes('logolombana')) ctxImg = ctxImg || s;
      });
      $el.find('img').remove();

      const label = $el.find('h3,h4').first().text().trim() ||
                    `Situación ${situations.length + 1}`;
      const ctx   = $el.text().replace(/\s{2,}/g, ' ').trim();

      curSit = { label, context: ctx, image_url: ctxImg, questions: [] };
      return false; // stop descending into children
    }

    // ── STANDALONE IMAGE between situations ──
    if (tag === 'img' && !el.parent) {
      const s = resolveImg($el.attr('src'));
      if (s && curSit && !curSit.image_url && !s.includes('logolombana'))
        curSit.image_url = s;
      return;
    }

    // ── QUESTION CARD ──
    const isQCard = cls.includes('question-card') || /^qc-\d+$/.test(id);
    if (!isQCard) return;

    if (!curSit) curSit = { label: 'Preguntas', context: '', image_url: null, questions: [] };
    globalQ++;

    // Question text
    const qText = $el.find('.question-text,.q-text').first().text()
                     .replace(/\s{2,}/g, ' ').trim();

    // Question image (not logo)
    let qImg = null;
    $el.find('img').not('.option-img').each((_, img) => {
      const s = resolveImg($(img).attr('src'));
      if (s && !s.includes('logolombana')) qImg = qImg || s;
    });

    // Options — by label.option-label
    const options = [];
    $el.find('label.option-label, label[class*="option"]').each((_, optEl) => {
      const $opt  = $(optEl);
      const key   = ($opt.find('input[type=radio]').attr('value') || '').toUpperCase();
      if (!key) return;
      const optImg = resolveImg($opt.find('img').first().attr('src'));
      $opt.find('.option-dot,.opt-dot,input').remove();
      const text  = $opt.text().replace(/\s{2,}/g, ' ').trim();
      options.push({ key, text, image_url: optImg || null });
    });

    // Fallback: by id pattern opt-N-X
    if (!options.length) {
      for (const k of ['A','B','C','D','E']) {
        const $o = $(`#opt-${globalQ}-${k}`);
        if (!$o.length) continue;
        $o.find('.option-dot,input').remove();
        options.push({ key: k, text: $o.text().replace(/\s{2,}/g,' ').trim(), image_url: null });
      }
    }

    curSit.questions.push({
      num:            globalQ,
      text:           qText,
      image_url:      qImg,
      correct_answer: answerKey[globalQ] || (options[0]?.key) || 'A',
      options
    });
    return false; // don't recurse into children
  });

  if (curSit && curSit.questions.length) situations.push(curSit);

  // Fallback to text-based parser if nothing found
  if (!situations.length) {
    const fallback = parseTextLines($('body').text());
    Object.keys(answerKey).forEach((n, i) => {
      const q = fallback.situations.flatMap(s => s.questions).find(q => q.num === parseInt(n));
      if (q) q.correct_answer = answerKey[n];
    });
    fallback.title     = title;
    fallback.timeLimit = timeLimit;
    fallback.images    = Object.values(imageMap);
    return fallback;
  }

  // Renumber
  let c = 0;
  situations.forEach(s => s.questions.forEach(q => { q.num = ++c; }));

  return {
    title,
    timeLimit,
    situations,
    totalQuestions:  c,
    totalSituations: situations.length,
    images:          Object.values(imageMap)
  };
}

// ─── DOCX ──────────────────────────────────────────
async function parseDocx(buffer) {
  let mammoth;
  try { mammoth = require('mammoth'); }
  catch(e) { throw new Error('Módulo mammoth no disponible: ' + e.message); }

  const imgs = [];
  const ih   = mammoth.images.imgElement(async (image) => {
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
  catch(e) { throw new Error('Módulo pdf-parse no disponible: ' + e.message); }

  let data;
  try { data = await pdfParse(buffer); }
  catch(e) { throw new Error('No se pudo leer el PDF. Verifica que no esté protegido. (' + e.message + ')'); }

  const r = parseTextLines(data.text, null);
  r.images  = [];
  r._note   = 'Las imágenes del PDF deben subirse manualmente en el editor.';
  return r;
}

// ─── TEXT LINES → STRUCTURE ────────────────────────
function parseTextLines(raw, html) {
  const lines = String(raw || '')
    .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .split('\n').map(l => l.trim()).filter(l => l.length > 1);

  const situations = [];
  let curSit = null, curQ = null, ctxBuf = [], inCtx = false;

  const P_SIT = /CONTESTE\s+LAS\s+PREGUNTAS?|SITUACI[OÓ]N\s*\d+|DE\s+ACUERDO\s+(A\s+)?LA\s+SIGUIENTE/i;
  const P_Q   = /^(\d{1,3})[.)]\s+(.+)/;
  const P_O   = /^([A-Da-d])[.)]\s+(.+)/;

  const pushQ = () => {
    if (!curQ || !curSit) return;
    if (curQ.options.length < 2)
      ['A','B','C'].filter(k => !curQ.options.find(o => o.key === k))
                   .forEach(k => curQ.options.push({ key: k, text: `Opción ${k}`, image_url: null }));
    curSit.questions.push(curQ);
    curQ = null;
  };
  const pushSit = () => {
    if (!curSit) return;
    pushQ();
    if (ctxBuf.length && !curSit.context) { curSit.context = ctxBuf.join('\n').trim(); ctxBuf = []; }
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
      if (curSit && ctxBuf.length && !curSit.context) { curSit.context = ctxBuf.join('\n').trim(); ctxBuf = []; }
      if (!curSit) curSit = { label: `Situación ${situations.length + 1}`, context: '', image_url: null, questions: [] };
      pushQ();
      curQ = { num: +qm[1], text: qm[2].trim(), image_url: null, correct_answer: 'A', options: [] };
      continue;
    }
    const om = line.match(P_O);
    if (om && curQ) { curQ.options.push({ key: om[1].toUpperCase(), text: om[2].trim(), image_url: null }); continue; }
    if (inCtx && curSit)  ctxBuf.push(line);
    else if (curQ) { if (!curQ.options.length) curQ.text += ' ' + line; else { const l = curQ.options[curQ.options.length-1]; if(l) l.text += ' '+line; } }
    else ctxBuf.push(line);
  }
  pushSit();

  if (!situations.length || situations.every(s => !s.questions.length)) {
    // Ultra-fallback: just grab numbered questions
    const sit = { label: 'Preguntas', context: '', image_url: null, questions: [] };
    let q = null;
    for (const line of lines) {
      const qm = line.match(/^(\d{1,3})[.)]\s+(.+)/);
      const om = line.match(/^([A-Da-d])[.)]\s+(.+)/);
      if (qm && !om) { if(q) sit.questions.push(q); q = { num:+qm[1], text:qm[2], correct_answer:'A', options:[], image_url:null }; }
      else if (om && q) q.options.push({ key:om[1].toUpperCase(), text:om[2], image_url:null });
    }
    if (q) sit.questions.push(q);
    if (sit.questions.length) situations.push(sit);
  }

  let c = 0;
  situations.forEach(s => s.questions.forEach(q => { q.num = ++c; }));

  return { situations, totalQuestions: c, totalSituations: situations.length, images: [] };
}

// ─── HTML PASTE (route /api/upload/html-parse) ─────
async function parseHtmlContent(html) {
  return parseLombanaHtml(String(html || ''), {});
}

module.exports = { parseFile, parseHtmlContent };
