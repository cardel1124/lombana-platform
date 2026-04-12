/**
 * Setup script — crea el usuario admin y verifica la BD
 * Ejecutar: node setup.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function run() {
  console.log('\n🎓 === Setup Plataforma Lombana ===\n');

  // 1. Run schema
  console.log('📦 Creando tablas en la base de datos...');
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf-8');
    const client = await pool.connect();
    await client.query(sql);
    client.release();
    console.log('✅ Tablas creadas correctamente.\n');
  } catch (err) {
    console.error('❌ Error al crear tablas:', err.message);
    process.exit(1);
  }

  // 2. Create admin
  console.log('👤 Configurando usuario administrador...\n');
  const adminDoc  = (await ask('   Documento admin [admin]: ')) || 'admin';
  const adminName = (await ask('   Nombre completo [Administrador]: ')) || 'Administrador';
  const adminEmail= (await ask('   Correo admin: ')) || 'admin@solucionesacademicas.com';
  const adminPass = (await ask('   Contraseña admin (mín. 8 chars): ')) || 'lombana2026';

  if (adminPass.length < 6) { console.log('❌ Contraseña muy corta.'); process.exit(1); }

  try {
    const hash = await bcrypt.hash(adminPass, 12);
    const client = await pool.connect();
    await client.query(`
      INSERT INTO users (doc_num, name, email, phone, password_hash, role, course)
      VALUES ($1,$2,$3,'3000000000',$4,'admin','all')
      ON CONFLICT (doc_num) DO UPDATE SET password_hash=$4, name=$2, email=$3
    `, [adminDoc, adminName, adminEmail, hash]);
    client.release();
    console.log('\n✅ Admin creado/actualizado:');
    console.log(`   Usuario: ${adminDoc}`);
    console.log(`   Contraseña: ${adminPass}`);
    console.log(`   URL admin: /admin\n`);
  } catch (err) {
    console.error('❌ Error al crear admin:', err.message);
  }

  // 3. Create uploads dir
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('📁 Carpeta uploads creada.');
  }

  console.log('\n🚀 Setup completado. Ejecuta: npm start\n');
  rl.close();
  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
