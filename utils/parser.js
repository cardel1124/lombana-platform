/**
 * Soluciones Académicas Lombana — Parser v7 (Ultimate)
 * Integración nativa con variables SIT_RANGES, SIT y QS.
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

  function resolveImg(src) {
    if (!src) return null;
    if (src.startsWith('http') || src.startsWith('/uploads')) return src;
    const esc = decodeURIComponent(src);
    return imageMap[esc] || imageMap[path.basename(esc)] || imageMap[src] || null;
  }

  let processed = html;
  for (const [local, url] of Object.entries(imageMap || {})) {
    const esc = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    processed = processed.replace(new RegExp(`(src=["'])(?:[^"']*?(?:imagen[/\\\\])?${esc})`, 'gi'), '$1' + url);
  }

  const $ = cheerio.load(processed, { decodeEntities: false });
  const scriptText = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Simulacro Lombana';
  let timeLimit = 6000;

  const tm = scriptText.match(/TOTAL_SECONDS\s*=\s*([\d\s*+]+)/);
  if (tm) { try { timeLimit = Function('"use strict"; return (' + tm[1].replace(/[^0-9\s*+]/g, '') + ')')(); } catch {} }

  // =================================================================
  // MAGIA LOMBANA: Extracción exacta de las variables de tus archivos
  // =================================================================
  let extractedSituations = null;
  try {
    const qsMatch = scriptText.match(/const\s+QS\s*=\s*(\[\s*\{[\s\S]*?\}\s*\]);?/);
    if (qsMatch) {
      const arrQS = Function('"use strict"; return (' + qsMatch[1] + ')')();

      let arrRanges = [];
      let objTitles = {};
      let objSit = {};

      const sitRangesMatch = scriptText.match(/const\s+SIT_RANGES\s*=\s*(\[[^\]]+\]);?/);
      const sitTitlesMatch = scriptText.match(/const\s+SIT_TITLES\s*=\s*(\{[\s\S]*?\});?/);
      const sitMatch = scriptText.match(/const\s+SIT\s*=\s*(\{[\s\S]*?\});?/);

      if (sitRangesMatch) arrRanges = Function('"use strict"; return (' + sitRangesMatch[1] + ')')();
      if (sitTitlesMatch) objTitles = Function('"use strict"; return (' + sitTitlesMatch[1] + ')')();
      if (sitMatch) objSit = Function('"use strict"; return (' + sitMatch[1] + ')')();

      const sitsMap = {};
      const sits = [];

      function getSitKey(n) {
        for (let r of arrRanges) {
          let parts = r.split('-');
          let a = parseInt(parts[0]), b = parseInt(parts[1] || parts[0]);
          if (n >= a && n <= b) return r;
        }
        return null;
      }

      function extractTI(htmlStr) {
        const $$ = cheerio.load(String(htmlStr||''), null, false);
        let imgUrl = null;
        $$('img').each((_, img) => {
          const src = $$(img).attr('src');
          if (src && !src.includes('logolombana')) {
            const resolved = resolveImg(src);
            if (resolved) imgUrl = resolved; else imgUrl = src;
          }
        });
        $$('img').remove();
        return { text: $$.text().replace(/\s{2,}/g, ' ').trim(), imgUrl };
      }

      arrQS.forEach(item => {
        const sKey = getSitKey(item.n) || 'default';
        if (!sitsMap[sKey]) {
          const sitData = extractTI(objSit[sKey] || '');
          const newSit = {
            label: objTitles[sKey] || (sKey === 'default' ? 'Preguntas' : `Preguntas ${sKey}`),
            context: sitData.text,
            image_url: sitData.imgUrl,
            questions: []
          };
          sitsMap[sKey] = newSit;
          sits.push(newSit);
        }

        const qData = extractTI(item.q);
        const options = (item.opts || []).map((oText, i) => {
          const oData = extractTI(oText);
          return {
            key: String.fromCharCode(65 + i),
            text: oData.text,
            image_url: oData.imgUrl
          };
        });
        
        if (!options.length) ['A','B','C','D'].forEach(k => options.push({key: k, text: `Opción ${k}`, image_url: null}));

        sitsMap[sKey].questions.push({
          num: item.n || 0,
          text: qData.text,
          image_url: qData.imgUrl || item.qImg || null,
          correct_answer: item.ans !== undefined ? String.fromCharCode(65 + parseInt(item.ans)) : 'A',
          options
        });
      });

      extractedSituations = sits;
    }
  } catch(e) { console.error("Error extrayendo el formato exacto de Lombana:", e); }

  if (extractedSituations && extractedSituations.length > 0) {
    let c = 0;
    extractedSituations.forEach(s => s.questions.forEach(q => { q.num = ++c; }));
    return { title, timeLimit, situations: extractedSituations, totalQuestions: c, totalSituations: extractedSituations.length, images: Object.values(imageMap) };
  }

  // Fallback si no es un HTML con código de Lombana
  const fallback = parseTextLines($('body').html());
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
function parseTextLines(rawHtml) {
  let text = String(rawHtml || '');
  
  if (text.includes('<')) {
      text = text.replace(/<br\s*\/?>/gi, '\n')
                 .replace(/<\/(div|p|h[1-6]|li|tr)>/gi, '\n')
                 .replace(/<\/td>/gi, '\t')
                 .replace(/<[^>]+>/g, '') 
                 .replace(/&nbsp;/g, ' ');
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const situations = [];
  let curSit = null, curQ = null, ctxBuf = [], inCtx = false;
  let pendingOptionKey = null;
  let pendingQuestionNum = null;

  const pushQ = () => {
    if (!curQ || !curSit) return;
    if (curQ.options.length < 2) ['A','B','C','D'].filter(k => !curQ.options.find(o => o.key === k)).forEach(k => curQ.options.push({ key: k, text: `Opción ${k}` }));
    curSit.questions.push(curQ);
    curQ = null;
  };
  
  const pushSit = () => {
    if (!curSit) return;
    pushQ();
    if (ctxBuf.length && !curSit.context) { 
        let cStr = ctxBuf.join('\n').trim();
        if (!/^(?:\d+-\d+|\d+|p[áa]gina.*)$/i.test(cStr)) curSit.context = cStr;
        ctxBuf = []; 
    }
    if (curSit.questions.length || curSit.context) situations.push(curSit);
    curSit = null;
  };

  for (const line of lines) {
    if (/^(?:CONTESTE\s+LAS\s+PREGUNTAS?|SITUACI[OÓ]N\s*\d+|DE\s+ACUERDO\s+(?:A\s+)?LA\s+SIGUIENTE)/i.test(line)) {
      pushSit();
      const rm = line.match(/(\d+)\s+[AaÁ]\s+(\d+)/);
      curSit = { label: rm ? `Preguntas ${rm[1]} a ${rm[2]}` : `Situación ${situations.length + 1}`, context: '', questions: [] };
      ctxBuf = []; inCtx = true; pendingOptionKey = null; pendingQuestionNum = null; continue;
    }

    const sq = line.match(/^(\d{1,3})[.)\-]?$/);
    if (sq && !inCtx) { pendingQuestionNum = parseInt(sq[1]); continue; }

    const qm = line.match(/^(\d{1,3})[.)\-]\s+(.+)/);
    if ((qm || pendingQuestionNum) && !/^([A-Da-d])[.)\-]\s+(.+)/.test(line) && !/^([A-Da-d])[.)\-]?$/.test(line)) {
      inCtx = false;
      if (curSit && ctxBuf.length && !curSit.context) { 
          let cStr = ctxBuf.join('\n').trim();
          if (!/^(?:\d+-\d+|\d+|p[áa]gina.*)$/i.test(cStr)) curSit.context = cStr;
          ctxBuf = []; 
      }
      if (!curSit) curSit = { label: `Situación ${situations.length + 1}`, context: '', questions: [] };
      pushQ();
      curQ = { num: qm ? parseInt(qm[1]) : pendingQuestionNum, text: qm ? qm[2].trim() : line, correct_answer: 'A', options: [] };
      pendingQuestionNum = null; pendingOptionKey = null; continue;
    }

    const so = line.match(/^([A-Da-d])[.)\-]?$/);
    if (so && curQ) { pendingOptionKey = so[1].toUpperCase(); continue; }

    const om = line.match(/^([A-Da-d])[.)\-]\s+(.+)/);
    if ((om || pendingOptionKey) && curQ) { 
        let optKey = om ? om[1].toUpperCase() : pendingOptionKey;
        let optText = om ? om[2].trim() : line;
        if (optText.includes('*')) { curQ.correct_answer = optKey; optText = optText.replace(/\*/g, '').trim(); }
        curQ.options.push({ key: optKey, text: optText }); 
        pendingOptionKey = null; continue; 
    }

    const ansMatch = line.match(/^(?:Respuesta|Clave|Correcta)[^\w]*([A-Da-d])/i);
    if (ansMatch && curQ) { curQ.correct_answer = ansMatch[1].toUpperCase(); continue; }

    if (inCtx && curSit)  ctxBuf.push(line);
    else if (curQ) { if (!curQ.options.length) curQ.text += ' ' + line; else curQ.options[curQ.options.length-1].text += ' ' + line; }
    else ctxBuf.push(line);
  }
  pushSit();

  const bottomText = text.slice(-2500); 
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
