require('dotenv').config();
const express   = require('express');
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { parseFile, parseHtmlContent } = require('./utils/parser');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lombana-secret-change-in-production-2026';

// ═══════════════════════════════════════════════════
// DATABASE
// ═══════════════════════════════════════════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => console.error('DB error:', err));

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// ═══════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const apiLimiter  = rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'Demasiadas solicitudes, intenta más tarde.' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 15,  message: { error: 'Demasiados intentos, espera 15 minutos.' } });
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// File storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ═══════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
}

function adminOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
    next();
  });
}

// ═══════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { doc_num, name, email, phone, password, course, school_id } = req.body;
    const required = [doc_num, name, email, phone, password, course];
    if (required.some(f => !f || !String(f).trim())) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const exists = await query('SELECT id FROM users WHERE doc_num=$1 OR email=$2', [doc_num.trim(), email.trim().toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: 'El número de documento o correo ya está registrado' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (doc_num, name, email, phone, password_hash, course, school_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id, doc_num, name, email, phone, course, role, active, created_at`,
      [doc_num.trim(), name.trim(), email.trim().toLowerCase(), phone.trim(), hash, course, school_id || null]
    );
    // New users are PENDING until admin activates them
    res.status(201).json({ pending: true, message: 'Registro exitoso. Tu cuenta está pendiente de activación por el administrador. Recibirás acceso pronto.' });
  } catch (err) {
    console.error('register:', err);
    res.status(500).json({ error: 'Error al registrar. Intenta de nuevo.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { doc_num, password } = req.body;
    if (!doc_num || !password) return res.status(400).json({ error: 'Ingresa documento y contraseña' });
    const result = await query('SELECT * FROM users WHERE doc_num=$1', [doc_num.trim()]);
    if (!result.rows.length) return res.status(400).json({ error: 'Credenciales inválidas' });
    const user = result.rows[0];
    if (!user.active) return res.status(403).json({ error: 'PENDIENTE', message: 'Tu cuenta está pendiente de activación. El administrador la habilitará pronto.' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(400).json({ error: 'Credenciales inválidas' });
    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const { password_hash, ...safe } = user;
    const token = jwt.sign({ id: user.id, role: user.role, course: user.course }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: safe });
  } catch (err) {
    console.error('login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT u.id, u.doc_num, u.name, u.email, u.phone, u.course, u.role, u.active,
              u.school_id, s.name as school_name, u.created_at, u.last_login
       FROM users u LEFT JOIN schools s ON u.school_id=s.id WHERE u.id=$1`,
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════
app.get('/api/users', adminOnly, async (req, res) => {
  try {
    const { course, school_id, search, page = 1, limit = 100 } = req.query;
    let q = `SELECT u.id, u.doc_num, u.name, u.email, u.phone, u.course, u.role,
             u.active, u.created_at, u.last_login, s.name as school_name,
             COUNT(DISTINCT r.id) as attempts,
             ROUND(AVG(r.score),1) as avg_score
             FROM users u
             LEFT JOIN schools s ON u.school_id=s.id
             LEFT JOIN results r ON r.user_id=u.id
             WHERE u.role='student'`;
    const p = []; let i = 1;
    if (course)    { q += ` AND u.course=$${i++}`;      p.push(course); }
    if (school_id) { q += ` AND u.school_id=$${i++}`;   p.push(school_id); }
    if (search)    { q += ` AND (LOWER(u.name) LIKE $${i} OR u.doc_num LIKE $${i++})`; p.push(`%${search.toLowerCase()}%`); }
    q += ` GROUP BY u.id, s.name ORDER BY u.created_at DESC LIMIT $${i++} OFFSET $${i}`;
    p.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const result = await query(q, p);
    const countResult = await query(`SELECT COUNT(*) FROM users WHERE role='student'${course ? ` AND course='${course}'` : ''}`);
    res.json({ users: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener usuarios' }); }
});

app.put('/api/users/:id', adminOnly, async (req, res) => {
  try {
    const { active, course, school_id, name, email, phone } = req.body;
    await query(`UPDATE users SET active=$1, course=$2, school_id=$3, name=$4, email=$5, phone=$6 WHERE id=$7`,
      [active, course, school_id||null, name, email, phone, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar' }); }
});

app.put('/api/users/:id/password', adminOnly, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
    const hash = await bcrypt.hash(password, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/users/:id', adminOnly, async (req, res) => {
  try {
    await query("DELETE FROM users WHERE id=$1 AND role!='admin'", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// Export CSV
app.get('/api/users/export', adminOnly, async (req, res) => {
  try {
    const r = await query(`SELECT u.doc_num, u.name, u.email, u.phone, u.course,
      CASE WHEN u.active THEN 'Activo' ELSE 'Bloqueado' END as estado, s.name as institucion,
      COUNT(DISTINCT res.id) as simulacros, ROUND(AVG(res.score),1) as promedio, u.created_at
      FROM users u LEFT JOIN schools s ON u.school_id=s.id
      LEFT JOIN results res ON res.user_id=u.id
      WHERE u.role='student' GROUP BY u.id, s.name ORDER BY u.name`);
    let csv = 'Documento,Nombre,Correo,Celular,Curso,Estado,Institución,Simulacros,Promedio,Registro\n';
    r.rows.forEach(u => {
      csv += `${u.doc_num},"${u.name}",${u.email},${u.phone||''},${u.course},${u.estado},"${u.institucion||''}",${u.simulacros||0},${u.promedio||0},${new Date(u.created_at).toLocaleDateString('es-CO')}\n`;
    });
    res.setHeader('Content-Type','text/csv;charset=utf-8');
    res.setHeader('Content-Disposition','attachment;filename=estudiantes-lombana.csv');
    res.send('\uFEFF' + csv);
  } catch (err) { res.status(500).json({ error: 'Error al exportar' }); }
});

// ═══════════════════════════════════════════════════
// SCHOOLS
// ═══════════════════════════════════════════════════
app.post('/api/schools/register', async (req, res) => {
  try {
    const { name, nit, city, department, address, phone, email, contact_name, contact_phone, num_students, level, sector, grade_levels } = req.body;
    if (!name || !city || !email || !contact_name || !contact_phone) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    const exists = await query('SELECT id FROM schools WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: 'Ya existe un registro con ese correo institucional' });
    const r = await query(
      `INSERT INTO schools (name, nit, city, department, address, phone, email, contact_name, contact_phone, num_students, level, sector, grade_levels)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, nit||null, city, department||null, address||null, phone||null, email.toLowerCase(), contact_name, contact_phone, num_students||0, level||null, sector||null, grade_levels||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al registrar institución' }); }
});

app.get('/api/schools', adminOnly, async (req, res) => {
  try {
    const r = await query(`SELECT s.*, COUNT(DISTINCT u.id) as enrolled
      FROM schools s LEFT JOIN users u ON u.school_id=s.id
      GROUP BY s.id ORDER BY s.created_at DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/schools/public', async (req, res) => {
  try {
    const r = await query('SELECT id, name, city, department FROM schools WHERE active=true ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/schools/:id', adminOnly, async (req, res) => {
  try {
    const { active, name, city, department, contact_name, contact_phone } = req.body;
    await query('UPDATE schools SET active=$1, name=$2, city=$3, department=$4, contact_name=$5, contact_phone=$6 WHERE id=$7',
      [active, name, city, department, contact_name, contact_phone, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/schools/:id', adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM schools WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ═══════════════════════════════════════════════════
// SIMULACROS
// ═══════════════════════════════════════════════════
app.get('/api/simulacros', auth, async (req, res) => {
  try {
    const { course } = req.query;
    const isAdmin = req.user.role === 'admin';
    let q = `SELECT s.*, COUNT(DISTINCT r.id) as attempts, ROUND(AVG(r.score),1) as avg_score,
             COUNT(DISTINCT sit.id) as num_situations,
             COUNT(DISTINCT q.id) as num_questions
             FROM simulacros s
             LEFT JOIN results r ON r.simulacro_id=s.id
             LEFT JOIN situations sit ON sit.simulacro_id=s.id
             LEFT JOIN questions q ON q.simulacro_id=s.id
             WHERE 1=1`;
    const p = []; let i = 1;
    if (!isAdmin) {
      q += ` AND s.active=true AND (s.course=$${i++} OR s.course='all')`;
      p.push(req.user.course);
      q += ` AND s.id NOT IN (SELECT content_id FROM user_blocks WHERE user_id=$${i++} AND content_type='simulacro')`;
      p.push(req.user.id);
    }
    if (course && isAdmin) { q += ` AND s.course=$${i++}`; p.push(course); }
    q += ' GROUP BY s.id ORDER BY s.created_at DESC';
    const r = await query(q, p);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.get('/api/simulacros/:id', auth, async (req, res) => {
  try {
    const simR = await query('SELECT * FROM simulacros WHERE id=$1', [req.params.id]);
    if (!simR.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const sim = simR.rows[0];
    if (!sim.active && req.user.role !== 'admin') return res.status(403).json({ error: 'Simulacro no disponible' });

    const sits = await query('SELECT * FROM situations WHERE simulacro_id=$1 ORDER BY order_num', [sim.id]);
    for (const sit of sits.rows) {
      const qs = await query('SELECT * FROM questions WHERE situation_id=$1 ORDER BY order_num', [sit.id]);
      for (const q of qs.rows) {
        const opts = await query('SELECT id, key, text, image_url FROM options WHERE question_id=$1 ORDER BY key', [q.id]);
        q.options = opts.rows;
        if (req.user.role !== 'admin') delete q.correct_answer; // hide answer
      }
      sit.questions = qs.rows;
    }
    res.json({ ...sim, situations: sits.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al cargar simulacro' }); }
});

app.post('/api/simulacros', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, description, course, time_limit, school_id, situations } = req.body;
    if (!title || !course) return res.status(400).json({ error: 'Título y curso son obligatorios' });

    const simR = await client.query(
      `INSERT INTO simulacros (title, description, course, time_limit, school_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, description||null, course, parseInt(time_limit)||6000, school_id||null, req.user.id]
    );
    const simId = simR.rows[0].id;
    let totalQ = 0;

    for (let si = 0; si < (situations||[]).length; si++) {
      const sit = situations[si];
      const sitR = await client.query(
        'INSERT INTO situations (simulacro_id, order_num, context, label) VALUES ($1,$2,$3,$4) RETURNING id',
        [simId, si+1, sit.context||'', sit.label||`Situación ${si+1}`]
      );
      const sitId = sitR.rows[0].id;
      for (let qi = 0; qi < (sit.questions||[]).length; qi++) {
        const q = sit.questions[qi];
        const qR = await client.query(
          'INSERT INTO questions (situation_id, simulacro_id, order_num, text, correct_answer, image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [sitId, simId, qi+1, q.text||'', (q.correct_answer||'A').toUpperCase(), q.image_url||null]
        );
        totalQ++;
        for (const opt of (q.options||[])) {
          await client.query('INSERT INTO options (question_id, key, text, image_url) VALUES ($1,$2,$3,$4)',
            [qR.rows[0].id, opt.key.toUpperCase(), opt.text||'', opt.image_url||null]);
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...simR.rows[0], num_questions: totalQ });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('create sim:', err);
    res.status(500).json({ error: 'Error al crear simulacro: ' + err.message });
  } finally { client.release(); }
});

app.put('/api/simulacros/:id', adminOnly, async (req, res) => {
  try {
    const { title, description, course, time_limit, active, school_id } = req.body;
    await query(`UPDATE simulacros SET title=$1, description=$2, course=$3, time_limit=$4, active=$5, school_id=$6, updated_at=NOW() WHERE id=$7`,
      [title, description, course, time_limit, active, school_id||null, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar' }); }
});

app.delete('/api/simulacros/:id', adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM simulacros WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});

// ─── REBUILD: update header + replace all situations/questions/options ───
app.put('/api/simulacros/:id/rebuild', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { title, description, course, time_limit, situations } = req.body;
    if (!title || !course) return res.status(400).json({ error: 'Título y curso son obligatorios' });

    // Update header
    await client.query(
      'UPDATE simulacros SET title=$1, description=$2, course=$3, time_limit=$4, updated_at=NOW() WHERE id=$5',
      [title, description || null, course, parseInt(time_limit) || 6000, req.params.id]
    );

    // Delete all existing content (cascade deletes questions, options, answers in results are kept)
    await client.query('DELETE FROM situations WHERE simulacro_id=$1', [req.params.id]);

    // Recreate
    let totalQ = 0;
    for (let si = 0; si < (situations || []).length; si++) {
      const sit = situations[si];
      const sitR = await client.query(
        'INSERT INTO situations (simulacro_id, order_num, context, label, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [req.params.id, si + 1, sit.context || '', sit.label || `Situación ${si + 1}`, sit.image_url || null]
      );
      const sitId = sitR.rows[0].id;
      for (let qi = 0; qi < (sit.questions || []).length; qi++) {
        const q = sit.questions[qi];
        const qR = await client.query(
          'INSERT INTO questions (situation_id, simulacro_id, order_num, text, correct_answer, image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [sitId, req.params.id, qi + 1, q.text || '', (q.correct_answer || 'A').toUpperCase(), q.image_url || null]
        );
        totalQ++;
        for (const opt of (q.options || [])) {
          await client.query(
            'INSERT INTO options (question_id, key, text, image_url) VALUES ($1,$2,$3,$4)',
            [qR.rows[0].id, opt.key.toUpperCase(), opt.text || '', opt.image_url || null]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, totalQuestions: totalQ });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('rebuild:', err);
    res.status(500).json({ error: 'Error al actualizar: ' + err.message });
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════
// UPLOAD & PARSE
// ═══════════════════════════════════════════════════
app.post('/api/upload/simulacro', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowed = ['.pdf', '.docx', '.doc', '.html', '.htm', '.zip'];
    if (!allowed.includes(ext)) return res.status(400).json({ error: 'Formato no soportado. Usa PDF, DOCX, HTML o ZIP.' });
    const parsed = await parseFile(req.file.path, ext);
    res.json(parsed);
  } catch (err) {
    console.error('parse:', err);
    res.status(500).json({ error: 'Error al procesar el archivo: ' + err.message });
  }
});

app.post('/api/upload/html-parse', adminOnly, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'No se recibió HTML' });
    const parsed = await parseHtmlContent(html);
    res.json(parsed);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload/image', adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  res.json({ url: '/uploads/' + req.file.filename, name: req.file.filename });
});

// ═══════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════
app.post('/api/results', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { simulacro_id, answers, time_used } = req.body;
    // answers = { questionId: 'A'|'B'|'C'|'D' }

    const qsResult = await client.query(
      `SELECT q.id, q.correct_answer, q.order_num FROM questions q
       JOIN situations s ON q.situation_id=s.id
       WHERE s.simulacro_id=$1 ORDER BY s.order_num, q.order_num`,
      [simulacro_id]
    );
    const questions = qsResult.rows;
    const total = questions.length;
    let correct = 0, wrong = 0, skipped = 0;

    const rRow = await client.query(
      'INSERT INTO results (user_id, simulacro_id, total, time_used) VALUES ($1,$2,$3,$4) RETURNING id',
      [req.user.id, simulacro_id, total, time_used||0]
    );
    const resultId = rRow.rows[0].id;

    for (const q of questions) {
      const sel = answers[q.id] || null;
      const ok = sel === q.correct_answer;
      if (!sel) skipped++; else if (ok) correct++; else wrong++;
      await client.query('INSERT INTO answers (result_id, question_id, selected, is_correct) VALUES ($1,$2,$3,$4)',
        [resultId, q.id, sel, ok]);
    }

    const score = total > 0 ? parseFloat((correct / total * 100).toFixed(2)) : 0;
    await client.query('UPDATE results SET score=$1, correct=$2, wrong=$3, skipped=$4 WHERE id=$5',
      [score, correct, wrong, skipped, resultId]);

    await client.query('COMMIT');
    res.json({ id: resultId, score, correct, wrong, skipped, total });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('result:', err);
    res.status(500).json({ error: 'Error al guardar resultado' });
  } finally { client.release(); }
});

app.get('/api/results/my', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT r.*, sim.title as simulacro_title, sim.course
       FROM results r JOIN simulacros sim ON r.simulacro_id=sim.id
       WHERE r.user_id=$1 ORDER BY r.completed_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/results/:id/detail', auth, async (req, res) => {
  try {
    const rRes = await query(
      `SELECT r.*, sim.title, sim.course FROM results r
       JOIN simulacros sim ON r.simulacro_id=sim.id
       WHERE r.id=$1 AND (r.user_id=$2 OR $3)`,
      [req.params.id, req.user.id, req.user.role === 'admin']
    );
    if (!rRes.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const ans = await query(
      `SELECT a.*, q.text, q.correct_answer, q.order_num, q.image_url,
              sit.label as situation_label, sit.order_num as sit_order
       FROM answers a
       JOIN questions q ON a.question_id=q.id
       JOIN situations sit ON q.situation_id=sit.id
       WHERE a.result_id=$1 ORDER BY sit.order_num, q.order_num`,
      [req.params.id]
    );
    for (const a of ans.rows) {
      const opts = await query('SELECT * FROM options WHERE question_id=$1 ORDER BY key', [a.question_id]);
      a.options = opts.rows;
    }
    res.json({ ...rRes.rows[0], answers: ans.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════
app.get('/api/stats/overview', adminOnly, async (req, res) => {
  try {
    const [userStats, schoolStats, simStats, resultStats, byGroup, recentActivity, scoreDistrib] = await Promise.all([
      query(`SELECT COUNT(*) as total,
               COUNT(*) FILTER(WHERE course='concurso-docente') as docentes,
               COUNT(*) FILTER(WHERE course='ascenso') as ascenso,
               COUNT(*) FILTER(WHERE course='preicfes') as icfes,
               COUNT(*) FILTER(WHERE course='colegio') as colegios,
               COUNT(*) FILTER(WHERE active=true) as activos
             FROM users WHERE role='student'`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE active=true) as activos FROM schools`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE active=true) as activos FROM simulacros`),
      query(`SELECT COUNT(*) as total, ROUND(AVG(score),1) as avg, MAX(score) as max, MIN(score) as min FROM results`),
      query(`SELECT u.course, COUNT(DISTINCT r.id) as attempts, ROUND(AVG(r.score),1) as avg
             FROM results r JOIN users u ON r.user_id=u.id GROUP BY u.course`),
      query(`SELECT r.completed_at, r.score, u.name, u.course, sim.title
             FROM results r JOIN users u ON r.user_id=u.id JOIN simulacros sim ON r.simulacro_id=sim.id
             ORDER BY r.completed_at DESC LIMIT 10`),
      query(`SELECT COUNT(*) FILTER(WHERE score>=85) as superior,
               COUNT(*) FILTER(WHERE score>=70 AND score<85) as alto,
               COUNT(*) FILTER(WHERE score>=50 AND score<70) as basico,
               COUNT(*) FILTER(WHERE score<50) as bajo FROM results`)
    ]);
    res.json({
      users: userStats.rows[0],
      schools: schoolStats.rows[0],
      simulacros: simStats.rows[0],
      results: resultStats.rows[0],
      byGroup: byGroup.rows,
      recentActivity: recentActivity.rows,
      distribution: scoreDistrib.rows[0]
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error en estadísticas' }); }
});

app.get('/api/stats/group/:group', adminOnly, async (req, res) => {
  try {
    const g = req.params.group;
    const [users, results, top, progress, distrib, weekly] = await Promise.all([
      query(`SELECT COUNT(*) as total FROM users WHERE course=$1 AND role='student'`, [g]),
      query(`SELECT COUNT(*) as total, ROUND(AVG(score),1) as avg, MAX(score) as max, MIN(score) as min
             FROM results r JOIN users u ON r.user_id=u.id WHERE u.course=$1`, [g]),
      query(`SELECT u.name, u.doc_num, COUNT(r.id) as attempts, ROUND(AVG(r.score),1) as avg, MAX(r.score) as best
             FROM results r JOIN users u ON r.user_id=u.id
             WHERE u.course=$1 GROUP BY u.id ORDER BY avg DESC LIMIT 15`, [g]),
      query(`SELECT DATE_TRUNC('week', r.completed_at) as week, ROUND(AVG(r.score),1) as avg, COUNT(*) as count
             FROM results r JOIN users u ON r.user_id=u.id
             WHERE u.course=$1 GROUP BY week ORDER BY week DESC LIMIT 12`, [g]),
      query(`SELECT COUNT(*) FILTER(WHERE r.score>=85) as superior,
               COUNT(*) FILTER(WHERE r.score>=70 AND r.score<85) as alto,
               COUNT(*) FILTER(WHERE r.score>=50 AND r.score<70) as basico,
               COUNT(*) FILTER(WHERE r.score<50) as bajo
             FROM results r JOIN users u ON r.user_id=u.id WHERE u.course=$1`, [g]),
      query(`SELECT TO_CHAR(created_at,'YYYY-MM') as month, COUNT(*) as registros
             FROM users WHERE course=$1 AND role='student'
             GROUP BY month ORDER BY month DESC LIMIT 6`, [g])
    ]);
    res.json({ group: g, users: users.rows[0], results: results.rows[0], top: top.rows, progress: progress.rows, distribution: distrib.rows[0], weekly: weekly.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.get('/api/stats/student/:id', adminOnly, async (req, res) => {
  try {
    const user = await query(`SELECT u.id, u.doc_num, u.name, u.email, u.phone, u.course,
      u.active, u.created_at, u.last_login, s.name as school_name
      FROM users u LEFT JOIN schools s ON u.school_id=s.id WHERE u.id=$1`, [req.params.id]);
    if (!user.rows.length) return res.status(404).json({ error: 'No encontrado' });

    const results = await query(`SELECT r.*, sim.title FROM results r JOIN simulacros sim ON r.simulacro_id=sim.id WHERE r.user_id=$1 ORDER BY r.completed_at DESC`, [req.params.id]);

    const weaknesses = await query(`
      SELECT sit.label, sit.id as sit_id,
        COUNT(a.id) as total,
        COUNT(a.id) FILTER(WHERE a.is_correct=true) as correct,
        ROUND(COUNT(a.id) FILTER(WHERE a.is_correct=true)*100.0/NULLIF(COUNT(a.id),0),1) as pct
      FROM answers a
      JOIN questions q ON a.question_id=q.id
      JOIN situations sit ON q.situation_id=sit.id
      JOIN results r ON a.result_id=r.id
      WHERE r.user_id=$1
      GROUP BY sit.id, sit.label ORDER BY pct ASC`, [req.params.id]);

    res.json({ user: user.rows[0], results: results.rows, weaknesses: weaknesses.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════════
// VIDEOS
// ═══════════════════════════════════════════════════
app.get('/api/videos', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let q = 'SELECT * FROM videos WHERE active=true';
    const p = [];
    if (!isAdmin) {
      q += " AND (course=$1 OR course='all') AND active=true";
      p.push(req.user.course);
      q += ` AND id NOT IN (SELECT content_id FROM user_blocks WHERE user_id=$2 AND content_type='video')`;
      p.push(req.user.id);
    }
    q += ' ORDER BY created_at DESC';
    const r = await query(q, p);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/videos', adminOnly, async (req, res) => {
  try {
    const { title, url, course, description, school_id } = req.body;
    if (!title || !url) return res.status(400).json({ error: 'Título y URL son obligatorios' });
    const r = await query(`INSERT INTO videos (title,url,course,description,school_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, url, course||'all', description||null, school_id||null]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/videos/:id', adminOnly, async (req, res) => {
  try {
    const { title, url, course, description, active } = req.body;
    await query('UPDATE videos SET title=$1,url=$2,course=$3,description=$4,active=$5 WHERE id=$6',
      [title, url, course, description, active, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/videos/:id', adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM videos WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════════
// ADMIN CONFIG
// ═══════════════════════════════════════════════════
app.put('/api/admin/password', adminOnly, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const u = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!await bcrypt.compare(current_password, u.rows[0].password_hash))
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});


// ═══════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════

// Student/public: GET available documents for their course
app.get('/api/documents', auth, async (req, res) => {
  try {
    const { course } = req.query;
    const isAdmin = req.user.role === 'admin';
    let q = `SELECT * FROM documents WHERE 1=1`;
    const p = []; let i = 1;
    if (!isAdmin) {
      q += ` AND active=true AND (course=$${i++} OR course='all')`;
      p.push(req.user.course);
      q += ` AND id NOT IN (SELECT content_id FROM user_blocks WHERE user_id=$${i++} AND content_type='documento')`;
      p.push(req.user.id);
    }
    if (course && isAdmin) { q += ` AND course=$${i++}`; p.push(course); }
    q += ' ORDER BY created_at DESC';
    const r = await query(q, p);
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// Upload document file + metadata
app.post('/api/documents/upload', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const allowed = ['.pdf','.doc','.docx','.pptx','.ppt'];
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Formato no permitido. Usa PDF, DOC, DOCX o PPTX.' });
    }
    const { title, description, course, category } = req.body;
    if (!title) return res.status(400).json({ error: 'El título es obligatorio' });
    const fileUrl = '/uploads/' + req.file.filename;
    const r = await query(
      `INSERT INTO documents (title, description, course, category, filename, file_url, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [title, description||null, course||'all', category||'guia',
       req.file.originalname, fileUrl, req.file.size]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al subir documento: ' + err.message }); }
});

// Update document metadata (title, desc, course, category, active)
app.put('/api/documents/:id', adminOnly, async (req, res) => {
  try {
    const { title, description, course, category, active } = req.body;
    await query(
      `UPDATE documents SET title=$1, description=$2, course=$3, category=$4,
       active=COALESCE($5,active), updated_at=NOW() WHERE id=$6`,
      [title, description||null, course, category||'guia',
       active !== undefined ? active : null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al actualizar' }); }
});

// Delete document (also removes file)
app.delete('/api/documents/:id', adminOnly, async (req, res) => {
  try {
    const r = await query('SELECT file_url FROM documents WHERE id=$1', [req.params.id]);
    if (r.rows.length) {
      const filePath = path.join(__dirname, 'public', r.rows[0].file_url);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
    await query('DELETE FROM documents WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error al eliminar' }); }
});


// ═══════════════════════════════════════════════════
// USER CONTENT BLOCKS
// ═══════════════════════════════════════════════════

// Get all blocks for a user
app.get('/api/users/:id/blocks', adminOnly, async (req, res) => {
  try {
    const r = await query('SELECT * FROM user_blocks WHERE user_id=$1', [req.params.id]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// Set blocks for a user (replaces all)
app.put('/api/users/:id/blocks', adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_blocks WHERE user_id=$1', [req.params.id]);
    const { blocks } = req.body; // [{ content_type, content_id }]
    for (const b of (blocks || [])) {
      await client.query(
        'INSERT INTO user_blocks (user_id, content_type, content_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.params.id, b.content_type, b.content_id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al guardar bloqueos' });
  } finally { client.release(); }
});

// Toggle single block
app.post('/api/users/:id/blocks/toggle', adminOnly, async (req, res) => {
  try {
    const { content_type, content_id } = req.body;
    const exists = await query(
      'SELECT id FROM user_blocks WHERE user_id=$1 AND content_type=$2 AND content_id=$3',
      [req.params.id, content_type, content_id]
    );
    if (exists.rows.length) {
      await query('DELETE FROM user_blocks WHERE user_id=$1 AND content_type=$2 AND content_id=$3',
        [req.params.id, content_type, content_id]);
      res.json({ blocked: false });
    } else {
      await query('INSERT INTO user_blocks (user_id, content_type, content_id) VALUES ($1,$2,$3)',
        [req.params.id, content_type, content_id]);
      res.json({ blocked: true });
    }
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.0.0', timestamp: new Date() }));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`\n🎓 ===================================`);
  console.log(`   Soluciones Académicas Lombana`);
  console.log(`   Puerto: ${PORT}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===================================\n`);
});

module.exports = app;
