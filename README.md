# 🎓 Soluciones Académicas Lombana — Plataforma de Preparación
**Dr. Mauro Lombana Gómez** · Especialistas en Pruebas del Estado

---

## 📦 Estructura del Proyecto

```
lombana-platform/
├── server.js              # Servidor Node.js + Express (API REST)
├── setup.js               # Script de configuración inicial
├── database.sql           # Esquema completo PostgreSQL
├── package.json           # Dependencias
├── .env.example           # Variables de entorno (plantilla)
├── utils/
│   └── parser.js          # Parser PDF/DOCX/HTML
└── public/
    ├── index.html         # Portal del estudiante (SPA)
    ├── admin/
    │   └── index.html     # Panel de administración
    ├── assets/
    │   └── logolombana.png  # Logo (colócalo aquí)
    └── uploads/           # Imágenes subidas (se crea automático)
```

---

## 🚀 OPCIÓN 1 — Railway (RECOMENDADO · Gratis hasta 5$/mes · 500 usuarios ✅)

### Paso 1: Crea una cuenta
1. Ve a **[railway.app](https://railway.app)** y regístrate con GitHub.

### Paso 2: Crea el proyecto
```
New Project → Deploy from GitHub repo → Selecciona tu repositorio
```

### Paso 3: Agrega PostgreSQL
```
Dashboard → + New → Database → Add PostgreSQL
```
Railway crea la BD y la conecta automáticamente. Copia la variable `DATABASE_URL`.

### Paso 4: Variables de entorno en Railway
Ve a tu servicio → **Variables** → agrega:
```
NODE_ENV=production
JWT_SECRET=TuClaveSecretaMuyLargaYSegura2026!
FRONTEND_URL=https://tuapp.railway.app
DATABASE_URL=(la que Railway te da automáticamente)
```

### Paso 5: Dominio personalizado
```
Railway → Settings → Domains → Custom Domain → tudominio.com
```

### Paso 6: Deploy
```bash
git add . && git commit -m "Deploy inicial" && git push
```
Railway hace deploy automático. Listo en 2-3 minutos.

---

## 🌐 OPCIÓN 2 — Render (Gratis · Puede ser lento al arrancar)

### Paso 1: render.com
1. Regístrate en **[render.com](https://render.com)**
2. New → **Web Service** → conecta tu repo de GitHub

### Paso 2: Configuración
```
Build Command:  npm install
Start Command:  npm start
Environment:    Node
```

### Paso 3: PostgreSQL en Render
```
New → PostgreSQL → Copia la "Internal Database URL"
```

### Paso 4: Variables
```
NODE_ENV=production
DATABASE_URL=(la de tu PostgreSQL en Render)
JWT_SECRET=ClaveSecretaSegura2026!
PORT=10000
```

---

## 🌍 OPCIÓN 3 — VPS con Dominio .com (MEJOR RENDIMIENTO · ~$10/mes · 500+ usuarios)

### Hostinger, DigitalOcean, Vultr o Linode

### Paso 1: Registra tu dominio .com
- **[namecheap.com](https://namecheap.com)** ~$10/año
- **[porkbun.com](https://porkbun.com)** ~$8/año (más barato)
- **[hostinger.com](https://hostinger.com)** — ofrecen hosting + dominio juntos

### Paso 2: Servidor VPS (recomendado para 500 usuarios)
**Hostinger VPS KVM1** — $4.99/mes (Ubuntu 22.04, 1GB RAM)
**DigitalOcean Droplet** — $6/mes (1GB RAM, 25GB SSD)

```bash
# Conéctate por SSH
ssh root@TU_IP_SERVIDOR

# Instala Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Instala PostgreSQL
apt install -y postgresql postgresql-contrib

# Instala PM2 (proceso persistente)
npm install -g pm2

# Instala Nginx (proxy inverso)
apt install -y nginx certbot python3-certbot-nginx
```

### Paso 3: Configura PostgreSQL
```bash
sudo -u postgres psql
CREATE DATABASE lombana_db;
CREATE USER lombana_user WITH ENCRYPTED PASSWORD 'TuContraseñaSegura';
GRANT ALL PRIVILEGES ON DATABASE lombana_db TO lombana_user;
\q
```

### Paso 4: Sube el proyecto
```bash
# En tu máquina local:
scp -r lombana-platform/ root@TU_IP:/var/www/lombana/

# En el servidor:
cd /var/www/lombana
cp .env.example .env
nano .env  # Edita las variables
```

### Paso 5: `.env` en el servidor
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://lombana_user:TuContraseñaSegura@localhost:5432/lombana_db
JWT_SECRET=ClaveSecretaMuyLargaYAleatoria2026!$ecure
FRONTEND_URL=https://tudominio.com
```

### Paso 6: Setup inicial
```bash
npm install
node setup.js   # Crea tablas y usuario admin
```

### Paso 7: Inicia con PM2
```bash
pm2 start server.js --name lombana
pm2 startup && pm2 save
```

### Paso 8: Nginx + SSL gratuito
```bash
nano /etc/nginx/sites-available/lombana
```
```nginx
server {
    server_name tudominio.com www.tudominio.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 30M;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/lombana /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# SSL gratuito con Let's Encrypt
certbot --nginx -d tudominio.com -d www.tudominio.com
```

---

## ⚙ SETUP INICIAL (cualquier opción)

```bash
# 1. Instala dependencias
npm install

# 2. Crea el archivo .env
cp .env.example .env
# Edita .env con tus credenciales reales

# 3. Ejecuta el setup (crea tablas + admin)
node setup.js

# 4. Coloca el logo
cp ruta/logolombana.png public/assets/logolombana.png

# 5. Inicia el servidor
npm start
```

---

## 👤 Credenciales por defecto

| Campo | Valor |
|-------|-------|
| Usuario admin | `admin` (o el que configuraste) |
| Contraseña | La que ingresaste en `node setup.js` |
| URL admin | `tudominio.com/admin/` |

> ⚠ **Cambia la contraseña inmediatamente** desde el panel → Configuración.

---

## 📊 Capacidad estimada (500 usuarios)

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| RAM | 512MB | 1-2 GB |
| CPU | 1 vCore | 2 vCores |
| Almacenamiento | 5 GB | 20 GB |
| BD PostgreSQL | Gratis (Railway/Render) | PostgreSQL propio |

---

## 🔑 Módulos del sistema

### Portal Estudiante (`/`)
- Registro con nombre, documento, correo, celular, contraseña, curso
- Inscripción de colegios
- Panel personalizado por grupo
- Simulacros con cronómetro, calificación escala MEN (0-100)
- Revisión completa de respuestas
- Historial y análisis de rendimiento

### Panel Admin (`/admin/`)
- Dashboard con estadísticas en tiempo real
- Gestión de usuarios (editar, bloquear, resetear contraseña, exportar CSV)
- Gestión de instituciones educativas
- **Cargador de simulacros** (PDF, DOCX, HTML + editor visual)
- Editor de preguntas con imágenes, opciones, respuesta correcta
- Gestión de videos de tutoría
- Rendimiento por estudiante
- Estadísticas por grupo (Docente, Ascenso, ICFES, Colegios)
- Configuración del sistema

---

## 🐛 Soporte
Para soporte técnico del desarrollo de la plataforma, guarda este README junto con el proyecto.
