# 🎓 Soluciones Académicas Lombana — Guía de Despliegue
## Plataforma de Preparación para Pruebas del Estado

---

## 📁 Estructura del Proyecto

```
lombana-platform/
├── server.js              ← Servidor principal (Node.js + Express)
├── setup.js               ← Script de configuración inicial
├── database.sql           ← Esquema de la base de datos
├── package.json           ← Dependencias
├── .env.example           ← Plantilla de variables de entorno
├── utils/
│   └── parser.js          ← Parseo de PDF, DOCX, HTML
└── public/
    ├── index.html         ← Portal de estudiantes
    ├── admin/
    │   └── index.html     ← Panel administrador
    ├── assets/
    │   └── logolombana.png ← Logo (copiar aquí)
    └── uploads/           ← Imágenes subidas (auto-creada)
```

---

## 🚀 OPCIÓN RECOMENDADA: Railway (Más fácil + $5/mes, 500+ usuarios)

### Por qué Railway:
- ✅ PostgreSQL incluido (gratis hasta cierto límite)
- ✅ Despliegue con un clic desde GitHub
- ✅ SSL automático (HTTPS)
- ✅ Dominio `.railway.app` gratis, o conectas tu `.com`
- ✅ Soporta 500+ usuarios simultáneos
- ✅ $5/mes Hobby plan (suficiente para 500 usuarios)

### Pasos:

#### 1. Prepara el código en GitHub
```bash
# En tu computador, entra a la carpeta del proyecto
cd lombana-platform

# Instala Git si no lo tienes: https://git-scm.com
git init
git add .
git commit -m "Plataforma Lombana v1.0"

# Crea cuenta en https://github.com y crea repositorio "lombana-platform"
# Luego conecta:
git remote add origin https://github.com/TU_USUARIO/lombana-platform.git
git push -u origin main
```

#### 2. Despliega en Railway
1. Ve a **https://railway.app** → Sign Up con GitHub
2. Clic **"New Project"** → **"Deploy from GitHub repo"**
3. Selecciona `lombana-platform`
4. Railway detecta automáticamente que es Node.js

#### 3. Agrega PostgreSQL
1. En el dashboard de Railway, clic **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway crea la BD y te da la variable `DATABASE_URL` automáticamente

#### 4. Configura Variables de Entorno
En Railway → tu servicio → pestaña **"Variables"**, agrega:
```
NODE_ENV=production
JWT_SECRET=CambiaEsteValorPorUnaClaveSegura2026!
FRONTEND_URL=https://tu-app.railway.app
```
(La variable `DATABASE_URL` Railway la agrega sola al conectar la BD)

#### 5. Ejecuta el Setup
En Railway → tu servicio → pestaña **"Deploy"** → **"Settings"** → **"Start Command"**:
```
node setup.js && node server.js
```
(Solo la primera vez. Luego cambia a solo: `node server.js`)

#### 6. Configura el Dominio Personalizado (.com)
1. En Railway → tu servicio → **"Settings"** → **"Custom Domain"**
2. Ingresa tu dominio: `solucioneslombana.com`
3. Railway te da los registros DNS a configurar

---

## 🌐 DOMINIO .COM — Dónde Comprarlo

### Opción A: Namecheap (Recomendado, ~$10-15/año)
1. Ve a **https://namecheap.com**
2. Busca el nombre que quieras: `solucioneslombana.com`, `lombanaacademico.com`, etc.
3. Compra ($10-15/año con tarjeta)
4. En Namecheap → tu dominio → **Advanced DNS**
5. Agrega los registros que Railway te indica (CNAME o A record)

### Opción B: PorkBun (más económico, ~$8/año)
- **https://porkbun.com** — misma lógica

### Opciones de nombre de dominio sugeridas:
- `solucionesacademicaslombana.com`
- `lombardocentes.com`
- `prepaconcursodocente.com`

---

## 💰 Costos Estimados para 500 Usuarios

| Servicio | Precio | Descripción |
|----------|--------|-------------|
| Railway Hobby | $5/mes (~$20.000 COP) | Servidor + PostgreSQL |
| Dominio .com | $10-15/año (~$50.000 COP/año) | Namecheap |
| **TOTAL** | **~$8/mes** | **~$32.000 COP/mes** |

---

## 🔧 ALTERNATIVA GRATUITA (Limitada)

Si quieres empezar gratis:
- **Servidor:** Render.com (gratis, pero apaga el servidor si está inactivo 15 min)
- **BD:** Supabase.com (PostgreSQL gratis hasta 500MB)
- **Dominio:** freenom.com (.tk gratis, poco profesional)

---

## ⚙️ Instalación Local (para probar en tu PC)

### Requisitos
- Node.js 18+ (descargar en https://nodejs.org)
- PostgreSQL 14+ (descargar en https://postgresql.org)

### Pasos

```bash
# 1. Entra a la carpeta
cd lombana-platform

# 2. Copia el logo al lugar correcto
cp logolombana.png public/assets/logolombana.png

# 3. Instala dependencias
npm install

# 4. Crea la base de datos en PostgreSQL
# Abre psql o pgAdmin y ejecuta:
# CREATE DATABASE lombana_db;

# 5. Copia el archivo de variables de entorno
cp .env.example .env

# 6. Edita el archivo .env con tus datos:
# DATABASE_URL=postgresql://postgres:tu_contraseña@localhost:5432/lombana_db
# JWT_SECRET=CambiaEstoAhora2026!

# 7. Ejecuta el setup (crea tablas + usuario admin)
node setup.js
# Te pedirá: usuario admin, nombre, correo, contraseña

# 8. Inicia el servidor
npm start

# 9. Abre en tu navegador:
# http://localhost:3000        ← Portal estudiantes
# http://localhost:3000/admin  ← Panel administrador
```

---

## 📋 Primeros Pasos Después de Instalar

1. **Accede al admin:** `/admin` con tus credenciales
2. **Carga el Simulacro 1:** Admin → Simulacros → + Nuevo Simulacro → Sube el PDF
3. **Revisa y ajusta** el simulacro en el editor visual
4. **Guarda** y activa el simulacro
5. **Registra una cuenta** de prueba en el portal de estudiantes
6. **Prueba** el simulacro completo
7. **Agrega videos** de tutorías desde YouTube

---

## 🔑 Credenciales por Defecto

| Usuario | Doc/Usuario | Contraseña |
|---------|-------------|------------|
| Administrador | `admin` | (la que configures en setup.js) |

**⚠ Cambia la contraseña inmediatamente en Configuración**

---

## 📞 Soporte Técnico

Si tienes problemas con el despliegue:
1. Revisa los logs en Railway (pestaña "Logs")
2. Verifica que `DATABASE_URL` esté correctamente configurada
3. Asegúrate de que el logo esté en `public/assets/logolombana.png`

---

## 🔒 Seguridad en Producción

Antes de salir a producción, asegúrate de:
- [ ] Cambiar `JWT_SECRET` por una cadena aleatoria larga
- [ ] Cambiar la contraseña del admin
- [ ] Configurar HTTPS (Railway lo hace automáticamente)
- [ ] Hacer respaldos periódicos de la BD (Railway permite exports)
