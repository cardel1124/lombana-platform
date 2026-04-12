/**
 * Soluciones Académicas Lombana
 * Módulo de parseo de simulacros desde PDF, DOCX y HTML
 */

const fs   = require('fs');
const path = require('path');

// ─── MAIN ENTRY ────────────────────────────────────
async function parseFile(filePath, ext) {
  const buffer = fs.readFileSync(filePath);
  ext = ext.toLowerCase();
  if (ext === '.docx')                return parseDocx(buffer);
  if (ext === '.doc')                 throw new Error('Formato .doc no soportado directamente. Convierte a .docx en Word y vuelve a subir.');
  if (ext === '.pdf')                 return parsePdf(buffer);
  if (ext === '.html' || ext === '.htm') return parseHtmlContent(buffer.toString('utf-8'));
  throw new Error('Formato no soportado. Usa PDF, DOCX o HTML.');
}

// ─── DOCX ───────────────────────────────────────────
async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const savedImages = [];
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const imageHandler = mammoth.images.imgElement(async function(image) {
    try {
      const imgData = await image.read('base64');
      const ext2 = (image.contentType || 'image/png').split('/')[1].replace('jpeg','jpg');
      const fname = `img_${Date.now()}_${savedImages.length}.${ext2}`;
      fs.writeFileSync(path.join(uploadDir, fname), Buffer.from(imgData, 'base64'));
      const url = `/uploads/${fname}`;
      savedImages.push(url);
      return { src: url };
    } catch { return {}; }
  });

  const [htmlR, textR] = await Promise.all([
    mammoth.convertToHtml({ buffer }, { convertImage: imageHandler }),
    mammoth.extractRawText({ buffer })
  ]);

  const structured = parseTextToStructure(textR.value, htmlR.value);
  structured.images = savedImages;
  return structured;
}

// ─── PDF ────────────────────────────────────────────
async function parsePdf(buffer) {
  const pdfParse = require('pdf-parse');
  let data;
  try { data = await pdfParse(buffer); }
  catch (e) { throw new Error('No se pudo leer el PDF. Asegúrate de que no esté protegido con contraseña.'); }
  const structured = parseTextToStructure(data.text, null);
  structured.images = [];
  structured._note = 'Las imágenes del PDF deben subirse manualmente en el editor.';
  return structured;
}

// ─── HTML ────────────────────────────────────────────
async function parseHtmlContent(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  $('script, style, head').remove();
  const text = $('body').text() || $.text();
  const structured = parseTextToStructure(text, html);
  structured.images = [];
  return structured;
}

// ─── CORE TEXT PARSER ───────────────────────────────
function parseTextToStructure(rawText, html) {
  // Normalize text
  const text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);

  const situations = [];
  let curSit     = null;
  let curQ       = null;
  let ctxBuffer  = [];
  let inContext   = false;
  let globalQNum = 0;

  // Patterns
  const P_SITUATION = /CONTESTE\s+LAS\s+PREGUNTAS?|SITUACI[OÓ]N\s+\d+|DE\s+ACUERDO\s+(A\s+)?LA\s+SIGUIENTE/i;
  const P_QNUM      = /^(\d{1,3})[.)]\s+(.+)/;
  const P_OPT       = /^([A-Da-d])[.)]\s+(.+)/;

  const saveQ = () => {
    if (curQ && curSit) {
      // Ensure at least 2 options
      if (curQ.options.length < 2) {
        ['A','B','C'].forEach(k => {
          if (!curQ.options.find(o => o.key === k)) {
            curQ.options.push({ key: k, text: `Opción ${k}`, image_url: null });
          }
        });
      }
      curSit.questions.push(curQ);
      curQ = null;
    }
  };

  const saveSit = () => {
    if (curSit) {
      saveQ();
      if (ctxBuffer.length && !curSit.context) {
        curSit.context = ctxBuffer.join('\n').trim();
        ctxBuffer = [];
      }
      if (curSit.questions.length > 0 || curSit.context) {
        situations.push(curSit);
      }
      curSit = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── New situation block ──
    if (P_SITUATION.test(line)) {
      saveSit();
      // Build label with range if available
      const rangeMatch = line.match(/(\d+)\s+[AaÁ]\s+(\d+)/);
      const label = rangeMatch
        ? `Situación (Preguntas ${rangeMatch[1]} a ${rangeMatch[2]})`
        : `Situación ${situations.length + 1}`;
      curSit   = { label, context: '', questions: [] };
      ctxBuffer = [];
      inContext  = true;
      continue;
    }

    // ── Question ──
    const qm = line.match(P_QNUM);
    if (qm && !P_OPT.test(line)) {
      const num = parseInt(qm[1]);
      if (num >= 1 && num <= 999) {
        inContext = false;
        // Flush context if we haven't yet
        if (curSit && ctxBuffer.length && !curSit.context) {
          curSit.context = ctxBuffer.join('\n').trim();
          ctxBuffer = [];
        }
        // Create default situation if none exists
        if (!curSit) {
          curSit = { label: `Situación ${situations.length + 1}`, context: '', questions: [] };
        }
        saveQ();
        globalQNum = num;
        curQ = {
          num,
          text: qm[2].trim(),
          image_url: null,
          correct_answer: 'A',
          options: []
        };
        continue;
      }
    }

    // ── Option ──
    const om = line.match(P_OPT);
    if (om && curQ) {
      const key = om[1].toUpperCase();
      if (!curQ.options.find(o => o.key === key)) {
        curQ.options.push({ key, text: om[2].trim(), image_url: null });
      }
      continue;
    }

    // ── Continuation ──
    if (inContext && curSit) {
      ctxBuffer.push(line);
    } else if (curQ) {
      if (curQ.options.length === 0) {
        curQ.text += ' ' + line; // multi-line question
      } else {
        // append to last option
        const last = curQ.options[curQ.options.length - 1];
        if (last) last.text += ' ' + line;
      }
    } else if (ctxBuffer.length || (curSit && !curSit.context)) {
      ctxBuffer.push(line);
    }
  }

  // Flush remaining
  saveSit();

  // Fallback: if nothing parsed, try simple approach
  if (!situations.length || situations.every(s => s.questions.length === 0)) {
    return fallbackParse(lines);
  }

  // Renumber questions sequentially
  let qCount = 0;
  situations.forEach(sit => {
    sit.questions.forEach(q => { q.num = ++qCount; });
  });

  return {
    situations,
    totalQuestions: situations.reduce((a, s) => a + s.questions.length, 0),
    totalSituations: situations.length,
    images: []
  };
}

// ─── FALLBACK PARSER ────────────────────────────────
function fallbackParse(lines) {
  const sit = { label: 'Preguntas', context: '', questions: [] };
  let curQ = null;

  for (const line of lines) {
    const qm = line.match(/^(\d{1,3})[.)]\s+(.+)/);
    const om = line.match(/^([A-Da-d])[.)]\s+(.+)/);
    if (qm && !om) {
      if (curQ) sit.questions.push(curQ);
      curQ = { num: parseInt(qm[1]), text: qm[2], correct_answer: 'A', options: [], image_url: null };
    } else if (om && curQ) {
      curQ.options.push({ key: om[1].toUpperCase(), text: om[2], image_url: null });
    }
  }
  if (curQ) sit.questions.push(curQ);

  return {
    situations: sit.questions.length ? [sit] : [],
    totalQuestions: sit.questions.length,
    totalSituations: 1,
    images: []
  };
}

module.exports = { parseFile, parseHtmlContent };
