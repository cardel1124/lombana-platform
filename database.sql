-- ════════════════════════════════════════════════════════════
--  SOLUCIONES ACADÉMICAS LOMBANA — Base de Datos PostgreSQL
-- ════════════════════════════════════════════════════════════

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── INSTITUTIONS (Colegios / Escuelas) ─────────────────────
CREATE TABLE IF NOT EXISTS schools (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(300) NOT NULL,
  nit              VARCHAR(25),
  city             VARCHAR(120) NOT NULL,
  department       VARCHAR(120),
  address          VARCHAR(300),
  phone            VARCHAR(25),
  email            VARCHAR(200) UNIQUE NOT NULL,
  contact_name     VARCHAR(200) NOT NULL,
  contact_phone    VARCHAR(25)  NOT NULL,
  num_students     INT          DEFAULT 0,
  level            VARCHAR(80),            -- Primaria / Secundaria / Media / Todos
  sector           VARCHAR(30),            -- Oficial / Privado
  grade_levels     VARCHAR(200),           -- Grados que aplican
  notes            TEXT,
  active           BOOLEAN      DEFAULT true,
  created_at       TIMESTAMP    DEFAULT NOW(),
  updated_at       TIMESTAMP    DEFAULT NOW()
);

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_num          VARCHAR(25)  UNIQUE NOT NULL,
  name             VARCHAR(200) NOT NULL,
  email            VARCHAR(200) UNIQUE NOT NULL,
  phone            VARCHAR(25),
  password_hash    VARCHAR(255) NOT NULL,
  role             VARCHAR(20)  DEFAULT 'student'
                   CHECK (role IN ('student','admin','school_admin')),
  course           VARCHAR(50)
                   CHECK (course IN ('concurso-docente','ascenso','preicfes','colegio','all')),
  school_id        UUID         REFERENCES schools(id) ON DELETE SET NULL,
  active           BOOLEAN      DEFAULT true,
  created_at       TIMESTAMP    DEFAULT NOW(),
  last_login       TIMESTAMP
);

-- ─── SIMULACROS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS simulacros (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(300) NOT NULL,
  description      TEXT,
  course           VARCHAR(50)  NOT NULL DEFAULT 'all',
  time_limit       INT          NOT NULL DEFAULT 6000, -- segundos
  active           BOOLEAN      DEFAULT true,
  school_id        UUID         REFERENCES schools(id) ON DELETE SET NULL,
  created_by       UUID         REFERENCES users(id)   ON DELETE SET NULL,
  created_at       TIMESTAMP    DEFAULT NOW(),
  updated_at       TIMESTAMP    DEFAULT NOW()
);

-- ─── SITUATIONS (Contextos de preguntas) ────────────────────
CREATE TABLE IF NOT EXISTS situations (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  simulacro_id     UUID         NOT NULL REFERENCES simulacros(id) ON DELETE CASCADE,
  order_num        INT          NOT NULL,
  context          TEXT,
  label            VARCHAR(300),
  created_at       TIMESTAMP    DEFAULT NOW()
);

-- ─── QUESTIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id     UUID         REFERENCES situations(id) ON DELETE CASCADE,
  simulacro_id     UUID         NOT NULL REFERENCES simulacros(id) ON DELETE CASCADE,
  order_num        INT          NOT NULL,
  text             TEXT         NOT NULL,
  image_url        VARCHAR(600),
  correct_answer   CHAR(1)      NOT NULL DEFAULT 'A',
  created_at       TIMESTAMP    DEFAULT NOW()
);

-- ─── OPTIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS options (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID         NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  key              CHAR(1)      NOT NULL,  -- A, B, C, D
  text             TEXT         NOT NULL,
  image_url        VARCHAR(600)
);

-- ─── RESULTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS results (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  simulacro_id     UUID          NOT NULL REFERENCES simulacros(id) ON DELETE CASCADE,
  score            DECIMAL(5,2)  DEFAULT 0,
  correct          INT           DEFAULT 0,
  wrong            INT           DEFAULT 0,
  skipped          INT           DEFAULT 0,
  total            INT           DEFAULT 0,
  time_used        INT           DEFAULT 0, -- segundos
  completed_at     TIMESTAMP     DEFAULT NOW()
);

-- ─── ANSWERS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answers (
  id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id        UUID     NOT NULL REFERENCES results(id)   ON DELETE CASCADE,
  question_id      UUID     NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected         CHAR(1),
  is_correct       BOOLEAN  DEFAULT false
);

-- ─── VIDEOS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title            VARCHAR(300) NOT NULL,
  url              VARCHAR(600) NOT NULL,
  course           VARCHAR(50)  DEFAULT 'all',
  description      TEXT,
  thumbnail_url    VARCHAR(600),
  school_id        UUID         REFERENCES schools(id) ON DELETE SET NULL,
  active           BOOLEAN      DEFAULT true,
  created_at       TIMESTAMP    DEFAULT NOW()
);

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_doc       ON users(doc_num);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_course    ON users(course);
CREATE INDEX IF NOT EXISTS idx_users_school    ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_results_user    ON results(user_id);
CREATE INDEX IF NOT EXISTS idx_results_sim     ON results(simulacro_id);
CREATE INDEX IF NOT EXISTS idx_results_date    ON results(completed_at);
CREATE INDEX IF NOT EXISTS idx_answers_result  ON answers(result_id);
CREATE INDEX IF NOT EXISTS idx_questions_sim   ON questions(simulacro_id);
CREATE INDEX IF NOT EXISTS idx_situations_sim  ON situations(simulacro_id);

-- ─── DEFAULT ADMIN ──────────────────────────────────────────
-- Contraseña: lombana2026  (¡CAMBIA INMEDIATAMENTE en producción!)
-- Hash generado con bcrypt 12 rounds
INSERT INTO users (doc_num, name, email, phone, password_hash, role, course)
VALUES (
  'admin',
  'Administrador',
  'admin@solucionesacademicas.com',
  '3000000000',
  '$2a$12$K8qRmT5Hj.pN3XwZkD4a7O0vY6uB9cF1eG2hI3jL5mN7pQ8rS0tU',
  'admin',
  'all'
) ON CONFLICT (doc_num) DO NOTHING;

-- NOTA: El hash anterior es un placeholder. Ejecuta setup.js para crear el admin real.
