/**
 * Soluciones Académicas Lombana
 * Parser: PDF · DOCX · HTML (formato Lombana) · ZIP (HTML + imagen/)
 */
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

async function parseFile(filePath, ext) {
  ext = ext.toLowerCase();
  if (ext === '.zip')  return parseZip(filePath);
  if (ext === '.docx') return parseDocx(fs.readFileSync(filePath));
  if (ext === '.pdf')  return parsePdf(fs.readFileSync(filePath));
  if (ext === '.html' || ext === '.htm') {
    return parseLombanaHtml(fs.readFileSync(filePath, 'utf-8'), {});
  }
  throw new Error('Formato no soportado. Usa ZIP, PDF, DOCX o HTML.');
}

// ─── ZIP (HTML + imagen/ folder) ───
async function parseZip(zipPath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const imageMap = {};
  // Upload all images from the zip
  for (const entry of entries) {
    const name = entry.entryName;
    if (!entry.isDirectory && /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name) && name.toLowerCase().includes('imagen')) {
      const ext2 = path.extname(name).toLowerCase();
      const fname = uuidv4() + ext2;
      fs.writeFileSync(path.join(UPLOADS_DIR, fname), entry.getData());
      const url = '/uploads/' + fname;
      imageMap[name] = url;                    // imagen/foo.png -> url
      imageMap[path.basename(name)] = url;     // foo.png -> url
    }
  }
  // Find HTML
  const htmlEntry = entries.find(e => !e.isDirectory && /\.html?$/i.test(e.entryName) && !e.entryName.includes('/'))
                 || entries.find(e => !e.isDirectory && /\.html?$/i.test(e.entryName));
  if (!htmlEntry) throw new Error('No se encontró archivo HTML dentro del ZIP.');
  return parseLombanaHtml(htmlEntry.getData().toString('utf-8'), imageMap);
}

// ─── LOMBANA HTML FORMAT ───
async function parseLombanaHtml(html, imageMap) {
  const cheerio = require('cheerio');
  // Replace image paths
  let processedHtml = html;
  for (const [local, url] of Object.entries(imageMap)) {
    const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    processedHtml = processedHtml.replace(new RegExp(`src=["']([^"']*?)${escaped}["']`, 'gi'), `src="${url}"`);
    processedHtml = processedHtml.replace(new RegExp(`src=["']imagen/${escaped}["']`, 'gi'), `src="${url}"`);
  }

  const $ = cheerio.load(processedHtml, { decodeEntities: false });

  // Extract ANSWER_KEY
  const answerKey = {};
  const scripts = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const km = scripts.match(/ANSWER_KEY\s*=\s*\{([^}]+)\}/s);
  if (km) {
    for (const [, n, a] of km[1].matchAll(/(\d+)\s*:\s*['"]([A-Da-d])['"]/g))
      answerKey[parseInt(n)] = a.toUpperCase();
  }

  // Extract time
  let timeLimit = 6000;
  const tm = scripts.match(/TOTAL_SECONDS\s*=\s*([\d\s*]+)/);
  if (tm) { try { timeLimit = eval(tm[1].trim()); } catch {} }

  // Extract title
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'Simulacro';

  const situations = [];
  let curSit = null;
  let globalQ = 0;

  function resolveImg(src) {
    if (!src) return null;
    if (src.startsWith('http') || src.startsWith('/uploads')) return src;
    return imageMap[src] || imageMap[path.basename(src)] || null;
  }

  // Walk all elements in document order
  const allElements = $('body').find('div, img').toArray();

  for (const el of allElements) {
    const $el = $(el);
    const classes = ($el.attr('class') || '').split(/\s+/);

    // SITUATION BLOCK
    if (classes.includes('situation-block') || classes.includes('context-block')) {
      if (curSit && curSit.questions.length > 0) situations.push(curSit);

      // Pull out context image (standalone img inside situation)
      let ctxImg = null;
      $el.find('img').each((_, img) => {
        const src = resolveImg($(img).attr('src'));
        if (src) ctxImg = ctxImg || src;
      });
      $el.find('img').remove();

      const contextText = $el.text().replace(/\s{2,}/g, ' ').trim();
      const label = $el.find('h3, h4').first().text().trim() || `Situación ${situations.length + 1}`;

      curSit = { label, context: contextText, image_url: ctxImg, questions: [] };
      continue;
    }

    // STANDALONE IMAGE (between situations — usually a chart/graph)
    if (el.tagName === 'img') {
      const src = resolveImg($el.attr('src'));
      if (src && curSit && !curSit.image_url) curSit.image_url = src;
      continue;
    }

    // QUESTION CARD
    if (classes.includes('question-card') || /^qc-\d+$/.test($el.attr('id') || '')) {
      if (!curSit) curSit = { label: 'Preguntas', context: '', image_url: null, questions: [] };
      globalQ++;

      const qTextEl = $el.find('.question-text, .q-text').first();
      const qText = qTextEl.text().replace(/\s{2,}/g, ' ').trim();

      // Question image (not logo)
      let qImg = null;
      $el.find('img').each((_, img) => {
        const src = resolveImg($(img).attr('src'));
        if (src && !src.includes('lombana')) qImg = qImg || src;
      });

      const options = [];
      $el.find('label.option-label, label[class*="option"]').each((_, optEl) => {
        const $opt = $(optEl);
        const input = $opt.find('input[type=radio]');
        const key = (input.attr('value') || '').toUpperCase();
        if (!key) return;
        const optImg = (() => { const s = $opt.find('img').first().attr('src'); return s ? resolveImg(s) : null; })();
        $opt.find('.option-dot, .opt-dot, input').remove();
        const text = $opt.text().replace(/\s{2,}/g, ' ').trim();
        options.push({ key, text, image_url: optImg });
      });

      // Fallback option extraction by id pattern opt-N-X
      if (!options.length) {
        for (const k of ['A','B','C','D']) {
          const $o = $(`#opt-${globalQ}-${k}`);
          if ($o.length) {
            $o.find('.option-dot, input').remove();
            options.push({ key: k, text: $o.text().replace(/\s{2,}/g, ' ').trim(), image_url: null });
          }
        }
      }

      curSit.questions.push({
        num: globalQ,
        text: qText,
        image_url: qImg,
        correct_answer: answerKey[globalQ] || (options[0]?.key) || 'A',
        options
      });
    }
  }

  if (curSit && curSit.questions.length > 0) situations.push(curSit);

  if (!situations.length) return fallbackTextParse($('body').text(), answerKey, timeLimit, title);

  let c = 0;
  situations.forEach(s => s.questions.forEach(q => { q.num = ++c; }));

  return { title, timeLimit, situations, totalQuestions: c, totalSituations: situations.length, images: Object.values(imageMap) };
}

// ─── DOCX ───
async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const imgs = [];
  const ih = mammoth.images.imgElement(async function(image) {
    try {
      const d = await image.read('base64');
      const e = (image.contentType||'image/png').split('/')[1].replace('jpeg','jpg');
      const f = uuidv4()+'.'+e;
      fs.writeFileSync(path.join(UPLOADS_DIR,f), Buffer.from(d,'base64'));
      const u='/uploads/'+f; imgs.push(u); return {src:u};
    } catch { return {}; }
  });
  const [h, t] = await Promise.all([
    mammoth.convertToHtml({buffer},{convertImage:ih}),
    mammoth.extractRawText({buffer})
  ]);
  const r = parseTextToStructure(t.value, h.value);
  r.images = imgs; return r;
}

// ─── PDF ───
async function parsePdf(buffer) {
  const pp = require('pdf-parse');
  let data;
  try { data = await pp(buffer); } catch { throw new Error('No se pudo leer el PDF. Verifica que no esté protegido.'); }
  const r = parseTextToStructure(data.text, null);
  r.images = []; r._note = 'Las imágenes del PDF deben subirse manualmente en el editor.';
  return r;
}

// ─── TEXT → STRUCTURE ───
function parseTextToStructure(raw, html) {
  const lines = raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
    .map(l=>l.trim()).filter(l=>l.length>1);
  const situations=[]; let curSit=null, curQ=null, ctxBuf=[], inCtx=false;
  const PS=/CONTESTE\s+LAS\s+PREGUNTAS?|SITUACI[OÓ]N\s+\d+|DE\s+ACUERDO\s+(A\s+)?LA\s+SIGUIENTE/i;
  const PQ=/^(\d{1,3})[.)]\s+(.+)/;
  const PO=/^([A-Da-d])[.)]\s+(.+)/;
  const saveQ=()=>{ if(curQ&&curSit){if(curQ.options.length<2)['A','B','C'].forEach(k=>{if(!curQ.options.find(o=>o.key===k))curQ.options.push({key:k,text:'Opción '+k,image_url:null})});curSit.questions.push(curQ);curQ=null;}};
  const saveSit=()=>{ if(curSit){saveQ();if(ctxBuf.length&&!curSit.context){curSit.context=ctxBuf.join('\n').trim();ctxBuf=[];}if(curSit.questions.length||curSit.context)situations.push(curSit);curSit=null;}};
  for(const line of lines){
    if(PS.test(line)){saveSit();const rm=line.match(/(\d+)\s+[AaÁ]\s+(\d+)/);curSit={label:rm?`Preguntas ${rm[1]} a ${rm[2]}`:`Situación ${situations.length+1}`,context:'',image_url:null,questions:[]};ctxBuf=[];inCtx=true;continue;}
    const qm=line.match(PQ);
    if(qm&&!PO.test(line)&&parseInt(qm[1])>=1&&parseInt(qm[1])<=999){inCtx=false;if(curSit&&ctxBuf.length&&!curSit.context){curSit.context=ctxBuf.join('\n').trim();ctxBuf=[];}if(!curSit)curSit={label:`Situación ${situations.length+1}`,context:'',image_url:null,questions:[]};saveQ();curQ={num:parseInt(qm[1]),text:qm[2].trim(),image_url:null,correct_answer:'A',options:[]};continue;}
    const om=line.match(PO);if(om&&curQ){curQ.options.push({key:om[1].toUpperCase(),text:om[2].trim(),image_url:null});continue;}
    if(inCtx&&curSit)ctxBuf.push(line);
    else if(curQ){if(!curQ.options.length)curQ.text+=' '+line;else{const l=curQ.options[curQ.options.length-1];if(l)l.text+=' '+line;}}
    else ctxBuf.push(line);
  }
  saveSit();
  if(!situations.length||situations.every(s=>!s.questions.length))return fallbackTextParse(lines,{},6000,'Simulacro');
  let c=0; situations.forEach(s=>s.questions.forEach(q=>{q.num=++c;}));
  return {situations,totalQuestions:c,totalSituations:situations.length,images:[]};
}

function fallbackTextParse(lines, answerKey, timeLimit, title) {
  if(typeof lines === 'string') lines = lines.split('\n').map(l=>l.trim()).filter(l=>l.length>1);
  const sit={label:'Preguntas',context:'',image_url:null,questions:[]};let curQ=null;
  for(const line of lines){
    const qm=line.match(/^(\d{1,3})[.)]\s+(.+)/);
    const om=line.match(/^([A-Da-d])[.)]\s+(.+)/);
    if(qm&&!om){if(curQ)sit.questions.push(curQ);curQ={num:parseInt(qm[1]),text:qm[2],correct_answer:answerKey[parseInt(qm[1])]||'A',options:[],image_url:null};}
    else if(om&&curQ)curQ.options.push({key:om[1].toUpperCase(),text:om[2],image_url:null});
  }
  if(curQ)sit.questions.push(curQ);
  return {title,timeLimit,situations:sit.questions.length?[sit]:[],totalQuestions:sit.questions.length,totalSituations:1,images:[]};
}

async function parseHtmlContent(html) { return parseLombanaHtml(html, {}); }

module.exports = { parseFile, parseHtmlContent };
