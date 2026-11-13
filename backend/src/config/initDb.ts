export {};

const pool = require("./db");
const { ensureGaleriaVideoColumns } = require("./galeriaSchema");

const initDatabase = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogo_roles (
      rol VARCHAR(50) PRIMARY KEY
    );
  `);

  await pool.query(`
    INSERT INTO catalogo_roles (rol)
    VALUES ('admin'), ('cliente'), ('vehiculo'), ('operativo')
    ON CONFLICT (rol) DO NOTHING;
  `);

  // Nota: la limpieza de roles se realiza después de crear las tablas dependientes.

  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogo_roles_alias (
      alias VARCHAR(50) PRIMARY KEY,
      rol VARCHAR(50) NOT NULL REFERENCES catalogo_roles(rol)
    );
  `);

  await pool.query(`
    INSERT INTO catalogo_roles_alias (alias, rol)
    VALUES
      ('admin', 'admin'),
      ('administrador', 'admin'),
      ('operativo', 'operativo'),
      ('gerente_operativo', 'operativo'),
      ('operador', 'operativo'),
      ('cliente', 'cliente'),
      ('hotel', 'cliente'),
      ('vehiculo', 'vehiculo'),
      ('conductor', 'vehiculo')
    ON CONFLICT (alias) DO UPDATE SET rol = EXCLUDED.rol;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalogo_estados_reserva (
      estado VARCHAR(50) PRIMARY KEY
    );
  `);

  await pool.query(`
    INSERT INTO catalogo_estados_reserva (estado)
    VALUES ('pendiente'), ('reprogramacion_pendiente'), ('pendiente_pago'), ('confirmada'), ('en_curso'), ('finalizada'), ('cancelada')
    ON CONFLICT (estado) DO NOTHING;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
     id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol VARCHAR(50) NOT NULL,
      edad INT,
      capacidad_pasajeros INT,
      hotel_id INT,
      activo BOOLEAN DEFAULT true,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS edad INT,
    ADD COLUMN IF NOT EXISTS capacidad_pasajeros INT,
    ADD COLUMN IF NOT EXISTS telefono VARCHAR(50),
    ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(600);
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS cedula VARCHAR(20),
    ADD COLUMN IF NOT EXISTS tipo_identificacion VARCHAR(20) NOT NULL DEFAULT 'cedula',
    ADD COLUMN IF NOT EXISTS cedula_url VARCHAR(600),
    ADD COLUMN IF NOT EXISTS selfie_cedula_url VARCHAR(600),
    ADD COLUMN IF NOT EXISTS estado_verificacion VARCHAR(20) DEFAULT 'no_verificado',
    ADD COLUMN IF NOT EXISTS fecha_verificacion TIMESTAMP,
    ADD COLUMN IF NOT EXISTS verificado_por INT,
    ADD COLUMN IF NOT EXISTS notas_verificacion TEXT,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS email_verification_token_hash VARCHAR(128),
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS pending_email VARCHAR(100),
    ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id UUID PRIMARY KEY,
      user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user_activity_idx
      ON auth_sessions (user_id, last_activity_at DESC);
    DELETE FROM auth_sessions
    WHERE last_activity_at < NOW() - INTERVAL '30 days'
       OR revoked_at < NOW() - INTERVAL '30 days';
  `);
  await pool.query(`
    UPDATE usuarios
    SET tipo_identificacion = 'ruc'
    WHERE cedula ~ '^[0-9]{13}$' AND tipo_identificacion = 'cedula';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_email_change_audit (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      admin_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
      accion VARCHAR(20) NOT NULL,
      email_anterior VARCHAR(100) NOT NULL,
      email_nuevo VARCHAR(100) NOT NULL,
      motivo TEXT NOT NULL,
      identidad_confirmada BOOLEAN NOT NULL DEFAULT false,
      verificacion_enviada BOOLEAN NOT NULL DEFAULT false,
      aviso_correo_anterior_enviado BOOLEAN NOT NULL DEFAULT false,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS admin_email_change_audit_user_idx
      ON admin_email_change_audit (user_id, creado_en DESC);
  `);

  await pool.query(`
    UPDATE usuarios u
    SET rol = a.rol
    FROM catalogo_roles_alias a
    WHERE LOWER(u.rol) = a.alias;
  `);

  await pool.query(`
    UPDATE usuarios
    SET rol = 'vehiculo'
    WHERE LOWER(rol) = 'conductor';
  `);

  await pool.query(`
    UPDATE usuarios
    SET rol = 'cliente'
    WHERE LOWER(rol) NOT IN (SELECT alias FROM catalogo_roles_alias);
  `);

  await pool.query(`
    ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS usuarios_rol_check;
  `);

  await pool.query(`
    ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS usuarios_rol_fkey;
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_rol_fkey
    FOREIGN KEY (rol) REFERENCES catalogo_roles(rol);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tours (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(200) NOT NULL,
      descripcion TEXT,
      precio DECIMAL(10, 2) NOT NULL,
      duracion VARCHAR(50),
      capacidad INT,
      ubicacion VARCHAR(200),
      imagen_url VARCHAR(500),
      activo BOOLEAN DEFAULT true,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservas (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
      tour_id INT REFERENCES tours(id) ON DELETE CASCADE,
      conductor_id INT REFERENCES usuarios(id),
      fecha_reserva DATE NOT NULL,
      num_personas INT NOT NULL,
      total DECIMAL(10, 2) NOT NULL,
      estado VARCHAR(50) DEFAULT 'pendiente',
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehiculos (
      id SERIAL PRIMARY KEY,
      placa VARCHAR(20) UNIQUE NOT NULL,
      usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
      tipo VARCHAR(50) DEFAULT 'van',
      modelo VARCHAR(120) NOT NULL,
      capacidad INT NOT NULL,
      color VARCHAR(60),
      imagen_url VARCHAR(600),
      descripcion TEXT,
      dias_servicio INT[] DEFAULT ARRAY[0,1,2,3,4,5,6],
      estado VARCHAR(50) DEFAULT 'disponible',
      activo BOOLEAN DEFAULT true,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE tours
      ADD COLUMN IF NOT EXISTS origen VARCHAR(300),
      ADD COLUMN IF NOT EXISTS destino VARCHAR(300),
      ADD COLUMN IF NOT EXISTS fecha_servicio DATE,
      ADD COLUMN IF NOT EXISTS hora_salida VARCHAR(10),
      ADD COLUMN IF NOT EXISTS cupos_totales INT,
      ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(80) DEFAULT 'viaje',
      ADD COLUMN IF NOT EXISTS imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS vehiculo_id INT REFERENCES vehiculos(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tours_publicados_idx
    ON tours (activo, fecha_servicio, origen, destino);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tour_imagenes (
      id SERIAL PRIMARY KEY,
      tour_id INT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
      imagen_url TEXT NOT NULL,
      orden INT NOT NULL DEFAULT 0,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tour_imagenes_tour_idx
    ON tour_imagenes (tour_id, orden, creado_en);
  `);

  await pool.query(`
    ALTER TABLE vehiculos
    DROP CONSTRAINT IF EXISTS vehiculos_estado_check;
  `);

  await pool.query(`
    ALTER TABLE vehiculos
    ADD CONSTRAINT vehiculos_estado_check
    CHECK (estado IN ('disponible', 'en_servicio', 'mantenimiento', 'inactivo'));
  `);

  await pool.query(`
    ALTER TABLE vehiculos
    ADD COLUMN IF NOT EXISTS placa VARCHAR(20),
    ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'van',
    ADD COLUMN IF NOT EXISTS modelo VARCHAR(120),
    ADD COLUMN IF NOT EXISTS capacidad INT,
    ADD COLUMN IF NOT EXISTS color VARCHAR(60),
    ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(600),
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS dias_servicio INT[] DEFAULT ARRAY[0,1,2,3,4,5,6],
    ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'disponible',
    ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS orden INTEGER,
    ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await pool.query(`
    UPDATE vehiculos
    SET tipo = 'van'
    WHERE tipo IS NULL;
  `);

  await pool.query(`
    UPDATE vehiculos
    SET dias_servicio = ARRAY[0,1,2,3,4,5,6]
    WHERE dias_servicio IS NULL
      OR array_length(dias_servicio, 1) IS NULL;
  `);

  await pool.query(`
    WITH orden_inicial AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY id DESC) AS nuevo_orden
      FROM vehiculos
      WHERE orden IS NULL
    )
    UPDATE vehiculos v
    SET orden = orden_inicial.nuevo_orden
    FROM orden_inicial
    WHERE v.id = orden_inicial.id;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehiculo_disponibilidad (
      id SERIAL PRIMARY KEY,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      disponible BOOLEAN NOT NULL,
      nota VARCHAR(255),
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (vehiculo_id, fecha)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS vehiculo_disponibilidad_vehiculo_fecha_idx
    ON vehiculo_disponibilidad (vehiculo_id, fecha);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disponibilidad_externa (
      id SERIAL PRIMARY KEY,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      conductor_usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      hora_inicio TIME,
      hora_fin TIME,
      motivo VARCHAR(40) NOT NULL DEFAULT 'viaje_externo',
      cliente_empresa VARCHAR(160),
      origen VARCHAR(300),
      destino VARCHAR(300),
      notas VARCHAR(1000),
      estado VARCHAR(20) NOT NULL DEFAULT 'activo',
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (fecha_fin >= fecha_inicio),
      CHECK (hora_inicio IS NULL OR hora_fin IS NULL OR hora_fin > hora_inicio),
      CHECK (motivo IN ('viaje_externo', 'ocupado', 'fuera_de_servicio')),
      CHECK (estado IN ('activo', 'cancelado'))
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS disponibilidad_externa_vehiculo_fecha_idx
    ON disponibilidad_externa (vehiculo_id, fecha_inicio, fecha_fin)
    WHERE estado = 'activo';
  `);

  await pool.query(`
    ALTER TABLE vehiculos
    DROP CONSTRAINT IF EXISTS vehiculos_placa_key;
  `);

  await pool.query(`
    DROP INDEX IF EXISTS vehiculos_placa_unique_idx;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS vehiculos_placa_active_unique_idx
    ON vehiculos (placa)
    WHERE placa IS NOT NULL AND activo = true;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    WITH migration_applied AS (
      INSERT INTO app_data_migrations (name)
      VALUES ('deactivate_seed_maintenance_vehicles')
      ON CONFLICT (name) DO NOTHING
      RETURNING name
    )
    UPDATE vehiculos
    SET activo = false
    WHERE placa IN ('ABC-1234', 'DEF-5678', 'GHI-9012')
      AND EXISTS (SELECT 1 FROM migration_applied);
  `);

  await pool.query(`
    UPDATE vehiculos v
    SET usuario_id = u.id
    FROM usuarios u
    WHERE v.usuario_id IS NULL
      AND u.rol = 'vehiculo'
      AND v.modelo = ('Modelo del conductor ' || u.nombre);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conductores (
      id SERIAL PRIMARY KEY,
      usuario_id INT UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
      licencia VARCHAR(120),
      telefono VARCHAR(50),
      estado VARCHAR(50) DEFAULT 'disponible',
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE conductores
    DROP CONSTRAINT IF EXISTS conductores_estado_check;
  `);

  await pool.query(`
    ALTER TABLE conductores
    ADD CONSTRAINT conductores_estado_check
    CHECK (estado IN ('disponible', 'en_servicio', 'mantenimiento', 'inactivo'));
  `);

  await pool.query(`
    INSERT INTO conductores (usuario_id, licencia, estado)
    SELECT u.id, 'LIC-' || u.id::text, 'disponible'
    FROM usuarios u
    LEFT JOIN conductores c ON c.usuario_id = u.id
    WHERE u.rol = 'vehiculo'
      AND c.id IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresas_asociadas (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(160) NOT NULL,
      identificacion VARCHAR(30),
      contacto VARCHAR(120),
      telefono VARCHAR(40),
      email VARCHAR(160),
      activa BOOLEAN NOT NULL DEFAULT true,
      notas TEXT,
      creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS empresas_asociadas_nombre_unique
      ON empresas_asociadas (LOWER(nombre));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehiculos_asociados (
      id SERIAL PRIMARY KEY,
      empresa_id INT NOT NULL REFERENCES empresas_asociadas(id) ON DELETE RESTRICT,
      placa VARCHAR(30) NOT NULL,
      modelo VARCHAR(120) NOT NULL,
      capacidad INT NOT NULL CHECK (capacidad > 0),
      conductor VARCHAR(120),
      conductor_telefono VARCHAR(40),
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (empresa_id, placa)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operaciones (
      id SERIAL PRIMARY KEY,
      reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
      requerimiento_id INT,
      grupo_numero INT,
      unidad_numero INT,
      tipo_servicio VARCHAR(80) NOT NULL DEFAULT 'viaje',
      tipo_vehiculo_solicitado VARCHAR(100),
      fecha_programada DATE NOT NULL,
      fecha_fin_programada DATE,
      hora_inicio TIME,
      hora_fin TIME,
      origen VARCHAR(300) NOT NULL,
      destino VARCHAR(300) NOT NULL,
      pasajeros INT NOT NULL DEFAULT 1 CHECK (pasajeros > 0),
      vehiculo_id INT REFERENCES vehiculos(id) ON DELETE SET NULL,
      conductor_id INT REFERENCES conductores(id) ON DELETE SET NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'programada',
      kilometros_estimados NUMERIC(10, 2),
      kilometros_reales NUMERIC(10, 2),
      hora_inicio_real TIMESTAMP,
      hora_fin_real TIMESTAMP,
      subcontratacion_estado VARCHAR(20) NOT NULL DEFAULT 'no_requerida',
      subcontratista_empresa VARCHAR(160),
      subcontratista_contacto VARCHAR(120),
      subcontratista_telefono VARCHAR(40),
      subcontratista_vehiculo VARCHAR(120),
      subcontratista_placa VARCHAR(30),
      subcontratista_conductor VARCHAR(120),
      subcontratista_conductor_telefono VARCHAR(40),
      subcontratacion_costo NUMERIC(10, 2),
      empresa_asociada_id INT REFERENCES empresas_asociadas(id) ON DELETE SET NULL,
      vehiculo_asociado_id INT REFERENCES vehiculos_asociados(id) ON DELETE SET NULL,
      observaciones TEXT,
      creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT operaciones_horas_validas CHECK (hora_fin IS NULL OR hora_inicio IS NULL OR hora_fin > hora_inicio),
      CONSTRAINT operaciones_estado_valido CHECK (estado IN ('programada', 'asignada', 'en_curso', 'completada', 'cancelada', 'incidencia')),
      CONSTRAINT operaciones_subcontratacion_estado_check CHECK (subcontratacion_estado IN ('no_requerida', 'pendiente', 'confirmada')),
      CONSTRAINT operaciones_subcontratacion_costo_check CHECK (subcontratacion_costo IS NULL OR subcontratacion_costo >= 0)
    );
  `);

  await pool.query(`
    ALTER TABLE operaciones
    ADD COLUMN IF NOT EXISTS subcontratacion_estado VARCHAR(20) NOT NULL DEFAULT 'no_requerida',
    ADD COLUMN IF NOT EXISTS subcontratista_empresa VARCHAR(160),
    ADD COLUMN IF NOT EXISTS subcontratista_contacto VARCHAR(120),
    ADD COLUMN IF NOT EXISTS subcontratista_telefono VARCHAR(40),
    ADD COLUMN IF NOT EXISTS subcontratista_vehiculo VARCHAR(120),
    ADD COLUMN IF NOT EXISTS subcontratista_placa VARCHAR(30),
    ADD COLUMN IF NOT EXISTS subcontratista_conductor VARCHAR(120),
    ADD COLUMN IF NOT EXISTS subcontratista_conductor_telefono VARCHAR(40),
    ADD COLUMN IF NOT EXISTS subcontratacion_costo NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS empresa_asociada_id INT REFERENCES empresas_asociadas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS vehiculo_asociado_id INT REFERENCES vehiculos_asociados(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS requerimiento_id INT,
    ADD COLUMN IF NOT EXISTS grupo_numero INT,
    ADD COLUMN IF NOT EXISTS unidad_numero INT,
    ADD COLUMN IF NOT EXISTS tipo_vehiculo_solicitado VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fecha_fin_programada DATE;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operaciones_subcontratacion_estado_check') THEN
        ALTER TABLE operaciones
        ADD CONSTRAINT operaciones_subcontratacion_estado_check
        CHECK (subcontratacion_estado IN ('no_requerida', 'pendiente', 'confirmada'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operaciones_subcontratacion_costo_check') THEN
        ALTER TABLE operaciones
        ADD CONSTRAINT operaciones_subcontratacion_costo_check
        CHECK (subcontratacion_costo IS NULL OR subcontratacion_costo >= 0);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS operaciones_fecha_estado_idx
    ON operaciones (fecha_programada, estado);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS operaciones_vehiculo_fecha_idx
    ON operaciones (vehiculo_id, fecha_programada, hora_inicio, hora_fin);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS operaciones_conductor_fecha_idx
    ON operaciones (conductor_id, fecha_programada, hora_inicio, hora_fin);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS operaciones_vehiculo_asociado_fecha_idx
    ON operaciones (vehiculo_asociado_id, fecha_programada, fecha_fin_programada)
    WHERE vehiculo_asociado_id IS NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operacion_historial (
      id SERIAL PRIMARY KEY,
      operacion_id INT NOT NULL REFERENCES operaciones(id) ON DELETE CASCADE,
      usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
      accion VARCHAR(50) NOT NULL,
      estado_anterior VARCHAR(30),
      estado_nuevo VARCHAR(30),
      detalle JSONB,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reserva_historial (
      id SERIAL PRIMARY KEY,
      reserva_id INT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
      usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
      accion VARCHAR(50) NOT NULL,
      estado_anterior VARCHAR(30),
      estado_nuevo VARCHAR(30),
      detalle JSONB,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS reserva_historial_reserva_idx
      ON reserva_historial (reserva_id, creado_en DESC);
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS estado_operativo VARCHAR(30);

    UPDATE reservas
    SET estado_operativo = 'en_curso',
        estado = 'confirmada'
    WHERE estado = 'en_curso'
      AND estado_operativo IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_cambio_destino (
      id SERIAL PRIMARY KEY,
      reserva_id INT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
      usuario_id INT NOT NULL REFERENCES usuarios(id),
      estado VARCHAR(30) NOT NULL DEFAULT 'pendiente_admin',
      origen_anterior TEXT,
      destino_anterior TEXT,
      origen_solicitado TEXT NOT NULL,
      destino_solicitado TEXT NOT NULL,
      total_anterior NUMERIC(10, 2) NOT NULL,
      total_propuesto NUMERIC(10, 2),
      nota_admin TEXT,
      respondido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      aceptado_en TIMESTAMP,
      aplicado_en TIMESTAMP,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS solicitudes_cambio_destino_reserva_idx
      ON solicitudes_cambio_destino (reserva_id, creado_en DESC);
    CREATE INDEX IF NOT EXISTS solicitudes_cambio_destino_estado_idx
      ON solicitudes_cambio_destino (estado, creado_en ASC);
    CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_cambio_destino_abierta_unique
      ON solicitudes_cambio_destino (reserva_id)
      WHERE estado IN ('pendiente_admin', 'propuesta_cliente', 'pago_pendiente', 'devolucion_pendiente');
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS operacion_historial_operacion_idx
    ON operacion_historial (operacion_id, creado_en DESC);
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS tour_id INT REFERENCES tours(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS fecha_reserva DATE,
    ADD COLUMN IF NOT EXISTS fecha_fin DATE,
    ADD COLUMN IF NOT EXISTS num_personas INT,
    ADD COLUMN IF NOT EXISTS total DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'pendiente',
    ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS fecha_salida TIMESTAMP,
    ADD COLUMN IF NOT EXISTS fecha_llegada TIMESTAMP,
    ADD COLUMN IF NOT EXISTS fecha_servicio TIMESTAMP,
    ADD COLUMN IF NOT EXISTS notas TEXT,
    ADD COLUMN IF NOT EXISTS vehiculo_id INT REFERENCES vehiculos(id),
    ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(60),
    ADD COLUMN IF NOT EXISTS conductor_id INT REFERENCES usuarios(id),
    ADD COLUMN IF NOT EXISTS origen VARCHAR(300),
    ADD COLUMN IF NOT EXISTS destino VARCHAR(300),
    ADD COLUMN IF NOT EXISTS hora_salida VARCHAR(10);
  `);

  await pool.query(`
    UPDATE reservas
    SET fecha_reserva = COALESCE(fecha_reserva, CURRENT_DATE),
        fecha_servicio = COALESCE(fecha_servicio, fecha_reserva::timestamp),
        num_personas = COALESCE(num_personas, 1),
        total = COALESCE(total, 0),
        estado = COALESCE(estado, 'pendiente'),
        fecha_creacion = COALESCE(fecha_creacion, CURRENT_TIMESTAMP);
  `);

  await pool.query(`
    ALTER TABLE reservas
    ALTER COLUMN fecha_reserva SET NOT NULL,
    ALTER COLUMN num_personas SET NOT NULL,
    ALTER COLUMN total SET NOT NULL;
  `);

  await pool.query(`
    UPDATE reservas
    SET estado = CASE
      WHEN LOWER(estado) IN ('pendiente', 'pending') THEN 'pendiente'
      WHEN LOWER(estado) IN ('reprogramacion_pendiente', 'reprogramacion pendiente', 'reprogramacion') THEN 'reprogramacion_pendiente'
      WHEN LOWER(estado) IN ('confirmada', 'confirmado') THEN 'confirmada'
      WHEN LOWER(estado) IN ('en_curso', 'encurso', 'en curso') THEN 'en_curso'
      WHEN LOWER(estado) IN ('finalizada', 'completada', 'completado', 'terminada', 'terminado') THEN 'finalizada'
      WHEN LOWER(estado) IN ('cancelada', 'cancelado') THEN 'cancelada'
      ELSE 'pendiente'
    END;
  `);

  await pool.query(`
    ALTER TABLE reservas
    DROP CONSTRAINT IF EXISTS reservas_estado_check;
  `);

  await pool.query(`
    ALTER TABLE reservas
    DROP CONSTRAINT IF EXISTS reservas_estado_fkey;
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD CONSTRAINT reservas_estado_fkey
    FOREIGN KEY (estado) REFERENCES catalogo_estados_reserva(estado);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS reservas_fecha_reserva_idx
    ON reservas (fecha_reserva);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS reservas_vehiculo_fecha_idx
    ON reservas (vehiculo_id, fecha_reserva);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS reservas_conductor_fecha_idx
    ON reservas (conductor_id, fecha_reserva);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      email VARCHAR(100) NOT NULL,
      pin_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS password_resets_email_created_idx
    ON password_resets (email, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS password_resets_usuario_created_idx
    ON password_resets (usuario_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes_comunicacion (
      id SERIAL PRIMARY KEY,
      sender_user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      recipient_user_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
      mensaje TEXT NOT NULL,
      leido BOOLEAN DEFAULT false,
      leido_en TIMESTAMP,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE mensajes_comunicacion
    ADD COLUMN IF NOT EXISTS leido BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS leido_en TIMESTAMP,
    ADD COLUMN IF NOT EXISTS link_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS link_id INT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS mensajes_comunicacion_sender_idx
    ON mensajes_comunicacion (sender_user_id, creado_en DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS mensajes_comunicacion_recipient_idx
    ON mensajes_comunicacion (recipient_user_id, creado_en DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS mensajes_comunicacion_pair_idx
    ON mensajes_comunicacion (sender_user_id, recipient_user_id, creado_en DESC);
  `);

  // ============ MÓDULO DE MANTENIMIENTO VEHICULAR ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mantenimiento_vehiculos (
      id SERIAL PRIMARY KEY,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      tipo VARCHAR(50) NOT NULL,
      descripcion TEXT,
      fecha_programada DATE NOT NULL,
      fecha_realizada DATE,
      costo DECIMAL(10, 2),
      estado VARCHAR(50) DEFAULT 'programado',
      tecnico VARCHAR(100),
      observaciones TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS mantenimiento_vehiculos_vehiculo_idx
    ON mantenimiento_vehiculos (vehiculo_id, fecha_programada DESC);
  `);

  // ============ EXPANDIR TABLA CONDUCTORES CON MÉTRICAS ============
  await pool.query(`
    ALTER TABLE conductores
    ADD COLUMN IF NOT EXISTS fecha_licencia_vencimiento DATE,
    ADD COLUMN IF NOT EXISTS fecha_certificado_seguridad DATE,
    ADD COLUMN IF NOT EXISTS rating_promedio DECIMAL(3, 2) DEFAULT 5.0,
    ADD COLUMN IF NOT EXISTS viajes_completados INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS viajes_cancelados INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS horas_conduccion INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estado_documentos VARCHAR(50) DEFAULT 'completos';
  `);

  // ============ MÓDULO DE ANÁLISIS DE RUTAS ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rutas_analisis (
      id SERIAL PRIMARY KEY,
      origen VARCHAR(200) NOT NULL,
      destino VARCHAR(200) NOT NULL,
      demanda_promedio_diaria DECIMAL(5, 2) DEFAULT 0,
      duracion_promedio_minutos INT,
      costo_combustible_estimado DECIMAL(10, 2),
      ingresos_promedio DECIMAL(10, 2),
      tasa_ocupacion INT DEFAULT 0,
      viajes_totales INT DEFAULT 0,
      estado VARCHAR(50) DEFAULT 'activa',
      ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(origen, destino)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS rutas_analisis_ocupacion_idx
    ON rutas_analisis (tasa_ocupacion DESC);
  `);

  // ============ CAMPOS ADICIONALES PARA USUARIOS ============
  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS apellido VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cedula VARCHAR(20),
    ADD COLUMN IF NOT EXISTS usuario VARCHAR(50);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_cedula_unique_idx
    ON usuarios (cedula)
    WHERE cedula IS NOT NULL AND cedula <> '';
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_unique_idx
    ON usuarios (usuario)
    WHERE usuario IS NOT NULL AND usuario <> '';
  `);

  // ============ CAMPOS ADICIONALES PARA VEHÍCULOS ============
  await pool.query(`
    ALTER TABLE vehiculos
    ADD COLUMN IF NOT EXISTS marca VARCHAR(100),
    ADD COLUMN IF NOT EXISTS anio INT,
    ADD COLUMN IF NOT EXISTS kilometraje INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fecha_matricula DATE,
    ADD COLUMN IF NOT EXISTS fecha_proximo_mantenimiento DATE,
    ADD COLUMN IF NOT EXISTS proximo_km_mantenimiento INT;
  `);

  // El kilometraje de cada servicio queda registrado en el propio historial
  // (no solo en el vehículo), para saber a cuántos km se hizo cada mantenimiento.
  // conductor_usuario_id identifica con certeza quién lo registró (no solo el
  // nombre en "tecnico"), para poder mostrar "Tú" vs. un conductor anterior.
  await pool.query(`
    ALTER TABLE mantenimiento_vehiculos
    ADD COLUMN IF NOT EXISTS kilometraje INT,
    ADD COLUMN IF NOT EXISTS conductor_usuario_id INT REFERENCES usuarios(id);
  `);

  // ============ MÓDULO DE PAGOS DE RESERVA (transferencia / link de pago) ============
  // El cliente paga el total por transferencia o por un link que
  // envía el admin, y sube una imagen de comprobante. El admin revisa y aprueba
  // o rechaza; solo al aprobarse un pago se recalcula reservas.estado_pago.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pagos_reserva (
      id SERIAL PRIMARY KEY,
      reserva_id INT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
      usuario_id INT NOT NULL REFERENCES usuarios(id),
      monto DECIMAL(10, 2) NOT NULL,
      metodo VARCHAR(30) NOT NULL DEFAULT 'transferencia',
      comprobante_url TEXT,
      proveedor_id VARCHAR(120),
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      notas_admin TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revisado_en TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS pagos_reserva_reserva_idx ON pagos_reserva (reserva_id);
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS monto_pagado DECIMAL(10, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) DEFAULT 'pendiente',
      ADD COLUMN IF NOT EXISTS link_pago VARCHAR(500),
      ADD COLUMN IF NOT EXISTS recogida_lat DECIMAL(10, 7),
      ADD COLUMN IF NOT EXISTS recogida_lng DECIMAL(10, 7),
      ADD COLUMN IF NOT EXISTS referencia_recogida VARCHAR(500);
  `);

  await pool.query(`
    ALTER TABLE pagos_reserva
    ADD COLUMN IF NOT EXISTS proveedor_id VARCHAR(120);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pagos_reserva
        WHERE proveedor_id IS NOT NULL
        GROUP BY metodo, proveedor_id
        HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS pagos_reserva_proveedor_unique
          ON pagos_reserva (metodo, proveedor_id)
          WHERE proveedor_id IS NOT NULL;
      ELSE
        RAISE NOTICE 'Se omitió el índice único de pagos: hay transacciones de proveedor duplicadas que requieren conciliación.';
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reembolsos_reserva (
      id SERIAL PRIMARY KEY,
      pago_id INT NOT NULL REFERENCES pagos_reserva(id) ON DELETE RESTRICT,
      reserva_id INT NOT NULL REFERENCES reservas(id) ON DELETE RESTRICT,
      monto NUMERIC(10, 2) NOT NULL CHECK (monto > 0),
      motivo TEXT NOT NULL,
      referencia_externa VARCHAR(120) NOT NULL,
      procesado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reembolsos_reserva_referencia_unique
      ON reembolsos_reserva (LOWER(referencia_externa));
    CREATE INDEX IF NOT EXISTS reembolsos_reserva_reserva_idx
      ON reembolsos_reserva (reserva_id, creado_en DESC);
  `);

  await pool.query(`
    ALTER TABLE reembolsos_reserva
    ADD COLUMN IF NOT EXISTS solicitud_cambio_destino_id INT
      REFERENCES solicitudes_cambio_destino(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facturas (
      id SERIAL PRIMARY KEY,
      reserva_id INT NOT NULL UNIQUE REFERENCES reservas(id) ON DELETE CASCADE,
      usuario_id INT NOT NULL REFERENCES usuarios(id),
      secuencial VARCHAR(9) NOT NULL,
      clave_acceso VARCHAR(49) NOT NULL UNIQUE,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      xml_autorizado TEXT,
      pdf_url TEXT,
      total DECIMAL(10, 2) NOT NULL,
      autorizado_en TIMESTAMP,
      mensaje_sri TEXT,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============ CAMPOS ADICIONALES PARA CONDUCTORES ============
  await pool.query(`
    ALTER TABLE conductores
    ADD COLUMN IF NOT EXISTS tipo_licencia VARCHAR(20),
    ADD COLUMN IF NOT EXISTS cedula VARCHAR(20),
    ADD COLUMN IF NOT EXISTS apellido VARCHAR(100),
    ADD COLUMN IF NOT EXISTS correo VARCHAR(100);
  `);

  // ============ TABLA DE ASIGNACIÓN DE VEHÍCULOS ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asignacion_vehiculos (
      id SERIAL PRIMARY KEY,
      conductor_id INT NOT NULL REFERENCES conductores(id) ON DELETE CASCADE,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
      fecha_fin DATE,
      estado VARCHAR(50) DEFAULT 'activa',
      observaciones TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS asignacion_vehiculos_conductor_idx
    ON asignacion_vehiculos (conductor_id, estado);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS asignacion_vehiculos_vehiculo_idx
    ON asignacion_vehiculos (vehiculo_id, estado);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS asignacion_vehiculos_una_activa_por_vehiculo_idx
    ON asignacion_vehiculos (vehiculo_id)
    WHERE estado = 'activa';
  `);

  // ============ TABLA RUTAS CONDUCTOR REPORTES (si no existe) ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rutas_conductor_reportes (
      id SERIAL PRIMARY KEY,
      conductor_usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
      conductor_id INT REFERENCES conductores(id) ON DELETE CASCADE,
      vehiculo_id INT REFERENCES vehiculos(id) ON DELETE SET NULL,
      fecha_viaje DATE NOT NULL DEFAULT CURRENT_DATE,
      origen_provincia VARCHAR(120),
      origen_canton VARCHAR(120),
      origen_parroquia VARCHAR(120),
      origen_detalle VARCHAR(200),
      destino_provincia VARCHAR(120),
      destino_canton VARCHAR(120),
      destino_parroquia VARCHAR(120),
      destino_detalle VARCHAR(200),
      duracion_valor DECIMAL(6, 2),
      duracion_unidad VARCHAR(20) DEFAULT 'horas',
      duracion_minutos_equivalentes INT,
      costo_combustible DECIMAL(10, 2) DEFAULT 0,
      valor_cobrado DECIMAL(10, 2) DEFAULT 0,
      calificacion_cliente DECIMAL(3, 2),
      cliente_nombre VARCHAR(200),
      cliente_telefono VARCHAR(50),
      cliente_email VARCHAR(200),
      observaciones TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ============ TABLA DE COTIZACIONES ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cotizaciones (
      id SERIAL PRIMARY KEY,
      usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      origen VARCHAR(300) NOT NULL,
      destino VARCHAR(300) NOT NULL,
      fecha_servicio DATE NOT NULL,
      num_personas INT NOT NULL DEFAULT 1,
      tipo_vehiculo VARCHAR(60),
      notas TEXT,
      estado VARCHAR(50) DEFAULT 'pendiente',
      precio_estimado DECIMAL(10,2),
      precio_final DECIMAL(10,2),
      reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
      respuesta_admin TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cotizaciones_usuario_idx
    ON cotizaciones (usuario_id, estado);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cotizaciones_estado_idx
    ON cotizaciones (estado, creado_en DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requerimientos_personalizados (
      id SERIAL PRIMARY KEY,
      usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      organizacion VARCHAR(200),
      cantidad_vehiculos INT NOT NULL DEFAULT 1,
      tipo_vehiculo VARCHAR(100),
      pasajeros_por_vehiculo INT,
      service_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
      fecha_servicio DATE,
      fecha_fin DATE,
      hora_salida VARCHAR(10),
      origen VARCHAR(300),
      destino VARCHAR(300),
      detalles TEXT NOT NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'en_revision', 'respondido', 'propuesta_enviada', 'pago_pendiente', 'pagado', 'cerrado', 'rechazado')),
      precio_final DECIMAL(10,2),
      respuesta_admin TEXT,
      respondido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      estado_despacho VARCHAR(20) NOT NULL DEFAULT 'no_aplica',
      error_despacho TEXT,
      aceptado_en TIMESTAMP,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS requerimientos_personalizados_usuario_idx
      ON requerimientos_personalizados (usuario_id, creado_en DESC);
    CREATE INDEX IF NOT EXISTS requerimientos_personalizados_estado_idx
      ON requerimientos_personalizados (estado, creado_en DESC);
  `);
  await pool.query(`
    ALTER TABLE requerimientos_personalizados
    ADD COLUMN IF NOT EXISTS service_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS precio_final DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS reserva_id INT REFERENCES reservas(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS estado_despacho VARCHAR(20) NOT NULL DEFAULT 'no_aplica',
    ADD COLUMN IF NOT EXISTS error_despacho TEXT,
    ADD COLUMN IF NOT EXISTS aceptado_en TIMESTAMP;
    UPDATE requerimientos_personalizados
    SET service_groups = jsonb_build_array(jsonb_build_object(
      'cantidad_vehiculos', cantidad_vehiculos,
      'tipo_vehiculo', tipo_vehiculo,
      'pasajeros_por_vehiculo', pasajeros_por_vehiculo,
      'fecha_servicio', fecha_servicio,
      'fecha_fin', fecha_fin,
      'hora_salida', hora_salida,
      'origen', origen,
      'destino', destino,
      'paradas', NULL,
      'detalles', NULL,
      'simultaneo', false
    ))
    WHERE service_groups = '[]'::jsonb;
    ALTER TABLE requerimientos_personalizados
    DROP CONSTRAINT IF EXISTS requerimientos_personalizados_estado_check;
    ALTER TABLE requerimientos_personalizados
    ADD CONSTRAINT requerimientos_personalizados_estado_check
      CHECK (estado IN ('pendiente', 'en_revision', 'respondido', 'propuesta_enviada', 'pago_pendiente', 'pagado', 'cerrado', 'rechazado'));
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operaciones_requerimiento_id_fkey') THEN
        ALTER TABLE operaciones
        ADD CONSTRAINT operaciones_requerimiento_id_fkey
          FOREIGN KEY (requerimiento_id) REFERENCES requerimientos_personalizados(id) ON DELETE CASCADE;
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS operaciones_requerimiento_unidad_idx
      ON operaciones (requerimiento_id, grupo_numero, unidad_numero)
      WHERE requerimiento_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS requerimientos_personalizados_reserva_idx
      ON requerimientos_personalizados (reserva_id)
      WHERE reserva_id IS NOT NULL;
  `);

  // Campos extra de cotizaciones (vehículo elegido, valor y duración del servicio)
  await pool.query(`
    ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS vehiculo_id INT REFERENCES vehiculos(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS valor_ofrecido DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS duracion_valor DECIMAL(6,2),
    ADD COLUMN IF NOT EXISTS duracion_unidad VARCHAR(20) DEFAULT 'horas';
  `);

  // Negociación de precio (contraofertas) + coordenadas para el mapa
  await pool.query(`
    ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS precio_propuesto DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS turno VARCHAR(20) DEFAULT 'admin',
    ADD COLUMN IF NOT EXISTS origen_lat DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS origen_lng DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS destino_lat DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS destino_lng DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS hora_salida VARCHAR(10),
    ADD COLUMN IF NOT EXISTS fecha_fin DATE;
  `);

  await pool.query(`
    ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS fecha_regreso DATE,
    ADD COLUMN IF NOT EXISTS hora_regreso VARCHAR(10);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracion_tarifas (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      tarifa_diaria DECIMAL(10,2) NOT NULL DEFAULT 80,
      precio_km DECIMAL(10,2) NOT NULL DEFAULT 0.80,
      tarifa_viaje DECIMAL(10,2) NOT NULL DEFAULT 15,
      recargo_peajes DECIMAL(10,2) NOT NULL DEFAULT 0,
      minimo_km DECIMAL(10,2) NOT NULL DEFAULT 0,
      tarifa_van DECIMAL(10,2) NOT NULL DEFAULT 80,
      tarifa_bus DECIMAL(10,2) NOT NULL DEFAULT 120,
      tarifa_suv DECIMAL(10,2) NOT NULL DEFAULT 110,
      tarifa_minibus DECIMAL(10,2) NOT NULL DEFAULT 95,
      tarifa_sedan DECIMAL(10,2) NOT NULL DEFAULT 70,
      traslado_van DECIMAL(10,2) NOT NULL DEFAULT 35,
      traslado_bus DECIMAL(10,2) NOT NULL DEFAULT 55,
      traslado_suv DECIMAL(10,2) NOT NULL DEFAULT 50,
      traslado_minibus DECIMAL(10,2) NOT NULL DEFAULT 42,
      traslado_sedan DECIMAL(10,2) NOT NULL DEFAULT 30,
      hora_van DECIMAL(10,2) NOT NULL DEFAULT 15,
      hora_bus DECIMAL(10,2) NOT NULL DEFAULT 25,
      hora_suv DECIMAL(10,2) NOT NULL DEFAULT 22,
      hora_minibus DECIMAL(10,2) NOT NULL DEFAULT 19,
      hora_sedan DECIMAL(10,2) NOT NULL DEFAULT 14,
      medio_dia_van DECIMAL(10,2) NOT NULL DEFAULT 55,
      medio_dia_bus DECIMAL(10,2) NOT NULL DEFAULT 85,
      medio_dia_suv DECIMAL(10,2) NOT NULL DEFAULT 78,
      medio_dia_minibus DECIMAL(10,2) NOT NULL DEFAULT 68,
      medio_dia_sedan DECIMAL(10,2) NOT NULL DEFAULT 50,
      oferta_activa BOOLEAN NOT NULL DEFAULT false,
      oferta_dia VARCHAR(30) DEFAULT 'lunes',
      descuento_oferta_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
      oferta_descripcion TEXT,
      actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE configuracion_tarifas
      ADD COLUMN IF NOT EXISTS tarifa_van DECIMAL(10,2) NOT NULL DEFAULT 80,
      ADD COLUMN IF NOT EXISTS tarifa_bus DECIMAL(10,2) NOT NULL DEFAULT 120,
      ADD COLUMN IF NOT EXISTS tarifa_suv DECIMAL(10,2) NOT NULL DEFAULT 110,
      ADD COLUMN IF NOT EXISTS tarifa_minibus DECIMAL(10,2) NOT NULL DEFAULT 95,
      ADD COLUMN IF NOT EXISTS tarifa_sedan DECIMAL(10,2) NOT NULL DEFAULT 70,
      ADD COLUMN IF NOT EXISTS traslado_van DECIMAL(10,2) NOT NULL DEFAULT 35,
      ADD COLUMN IF NOT EXISTS traslado_bus DECIMAL(10,2) NOT NULL DEFAULT 55,
      ADD COLUMN IF NOT EXISTS traslado_suv DECIMAL(10,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS traslado_minibus DECIMAL(10,2) NOT NULL DEFAULT 42,
      ADD COLUMN IF NOT EXISTS traslado_sedan DECIMAL(10,2) NOT NULL DEFAULT 30,
      ADD COLUMN IF NOT EXISTS hora_van DECIMAL(10,2) NOT NULL DEFAULT 15,
      ADD COLUMN IF NOT EXISTS hora_bus DECIMAL(10,2) NOT NULL DEFAULT 25,
      ADD COLUMN IF NOT EXISTS hora_suv DECIMAL(10,2) NOT NULL DEFAULT 22,
      ADD COLUMN IF NOT EXISTS hora_minibus DECIMAL(10,2) NOT NULL DEFAULT 19,
      ADD COLUMN IF NOT EXISTS hora_sedan DECIMAL(10,2) NOT NULL DEFAULT 14,
      ADD COLUMN IF NOT EXISTS medio_dia_van DECIMAL(10,2) NOT NULL DEFAULT 55,
      ADD COLUMN IF NOT EXISTS medio_dia_bus DECIMAL(10,2) NOT NULL DEFAULT 85,
      ADD COLUMN IF NOT EXISTS medio_dia_suv DECIMAL(10,2) NOT NULL DEFAULT 78,
      ADD COLUMN IF NOT EXISTS medio_dia_minibus DECIMAL(10,2) NOT NULL DEFAULT 68,
      ADD COLUMN IF NOT EXISTS medio_dia_sedan DECIMAL(10,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS oferta_activa BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS oferta_dia VARCHAR(30) DEFAULT 'lunes',
      ADD COLUMN IF NOT EXISTS descuento_oferta_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS oferta_descripcion TEXT;
  `);

  await pool.query(`
    INSERT INTO configuracion_tarifas (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;
  `);

  await pool.query(`
    UPDATE configuracion_tarifas
    SET tarifa_van = COALESCE(tarifa_van, tarifa_diaria),
        tarifa_bus = COALESCE(tarifa_bus, tarifa_diaria + 40),
        tarifa_suv = COALESCE(tarifa_suv, tarifa_diaria + 30),
        tarifa_minibus = COALESCE(tarifa_minibus, tarifa_diaria + 15),
        tarifa_sedan = COALESCE(tarifa_sedan, tarifa_diaria - 10),
        oferta_activa = COALESCE(oferta_activa, false),
        oferta_dia = COALESCE(oferta_dia, 'lunes'),
        descuento_oferta_pct = COALESCE(descuento_oferta_pct, 0),
        oferta_descripcion = COALESCE(oferta_descripcion, '')
    WHERE id = 1;
  `);
  await pool.query(`
    ALTER TABLE cotizaciones
      ADD COLUMN IF NOT EXISTS num_viajes INT DEFAULT 1,
      ADD COLUMN IF NOT EXISTS distancia_km DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS precio_desglose JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cotizacion_negociacion (
      id SERIAL PRIMARY KEY,
      cotizacion_id INT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
      actor VARCHAR(20) NOT NULL,
      precio DECIMAL(10,2),
      mensaje TEXT,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cotizacion_negociacion_idx
    ON cotizacion_negociacion (cotizacion_id, creado_en);
  `);

  // ============ UBICACIÓN DE VEHÍCULOS EN TIEMPO REAL ============
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehiculo_ubicacion (
      id SERIAL PRIMARY KEY,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      conductor_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
      lat DECIMAL(10, 7) NOT NULL,
      lng DECIMAL(10, 7) NOT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS vehiculo_ubicacion_vehiculo_idx
    ON vehiculo_ubicacion (vehiculo_id, creado_en DESC);
  `);

  // ============ CALIFICACIÓN DEL CLIENTE A LA RESERVA ============
  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS calificacion INT,
    ADD COLUMN IF NOT EXISTS comentario_calificacion TEXT,
    ADD COLUMN IF NOT EXISTS calificado_en TIMESTAMP;
  `);

  // recogido = el conductor ya recogió al cliente. Divide el viaje en curso en
  // dos fases: ir al origen (recoger) y luego ir al destino (llevar).
  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS recogido BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS recogido_en TIMESTAMP;
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS fecha_regreso DATE,
    ADD COLUMN IF NOT EXISTS hora_regreso VARCHAR(10);
  `);

  await pool.query(`
    ALTER TABLE reservas
    ADD COLUMN IF NOT EXISTS ida_finalizada BOOLEAN NOT NULL DEFAULT false;
  `);

  // Número de proforma: se asigna la primera vez que el admin genera la
  // proforma de una cotización y continúa la numeración física de la empresa.
  await pool.query(`
    ALTER TABLE cotizaciones
    ADD COLUMN IF NOT EXISTS proforma_numero INT;
  `);

  // ============ GALERÍA DE VIAJES (fotos que el admin publica en la landing) ==
  await pool.query(`
    CREATE TABLE IF NOT EXISTS galeria_viajes (
      id SERIAL PRIMARY KEY,
      imagen_url TEXT NOT NULL,
      tipo VARCHAR(10) NOT NULL DEFAULT 'imagen' CHECK (tipo IN ('imagen', 'video')),
      categoria VARCHAR(12) NOT NULL DEFAULT 'viajes',
      video_offset_x INT NOT NULL DEFAULT 0,
      video_offset_y INT NOT NULL DEFAULT 0,
      video_zoom INT NOT NULL DEFAULT 100,
      video_format VARCHAR(12) NOT NULL DEFAULT 'horizontal',
      video_aspect_ratio NUMERIC(6,4) NOT NULL DEFAULT 1.7778,
      video_poster_url TEXT,
      titulo VARCHAR(120),
      descripcion TEXT,
      credito VARCHAR(160),
      fuente_url TEXT,
      licencia VARCHAR(80),
      licencia_url TEXT,
      orden INT DEFAULT 0,
      activo BOOLEAN DEFAULT TRUE,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE galeria_viajes
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'imagen',
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NOT NULL DEFAULT 'viajes',
    ADD COLUMN IF NOT EXISTS credito VARCHAR(160),
    ADD COLUMN IF NOT EXISTS fuente_url TEXT,
    ADD COLUMN IF NOT EXISTS licencia VARCHAR(80),
    ADD COLUMN IF NOT EXISTS licencia_url TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS homepage_showcase_images (
      slot VARCHAR(20) PRIMARY KEY CHECK (slot IN ('primary', 'secondary')),
      image_url TEXT NOT NULL,
      position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      zoom NUMERIC(5,2) NOT NULL DEFAULT 100,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE homepage_showcase_images
      ADD COLUMN IF NOT EXISTS position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS zoom NUMERIC(5,2) NOT NULL DEFAULT 100;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS homepage_city_showcase (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      primary_image_url TEXT NOT NULL,
      secondary_image_url TEXT NOT NULL,
      primary_alt VARCHAR(300) NOT NULL,
      secondary_alt VARCHAR(300) NOT NULL,
      primary_position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      primary_position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      primary_zoom NUMERIC(5,2) NOT NULL DEFAULT 100,
      secondary_position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      secondary_position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      secondary_zoom NUMERIC(5,2) NOT NULL DEFAULT 100,
      eyebrow VARCHAR(180) NOT NULL,
      title VARCHAR(300) NOT NULL,
      description TEXT NOT NULL,
      label VARCHAR(180) NOT NULL,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE homepage_city_showcase
      ADD COLUMN IF NOT EXISTS primary_position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS primary_position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS primary_zoom NUMERIC(5,2) NOT NULL DEFAULT 100,
      ADD COLUMN IF NOT EXISTS secondary_position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS secondary_position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
      ADD COLUMN IF NOT EXISTS secondary_zoom NUMERIC(5,2) NOT NULL DEFAULT 100;
  `);

  await pool.query(`
    INSERT INTO homepage_showcase_images (slot, image_url)
    SELECT
      CASE WHEN ranked.position = 1 THEN 'primary' ELSE 'secondary' END,
      ranked.imagen_url
    FROM (
      SELECT
        imagen_url,
        ROW_NUMBER() OVER (ORDER BY capacidad DESC NULLS LAST, orden ASC NULLS LAST, id DESC) AS position
      FROM vehiculos
      WHERE activo = true AND imagen_url IS NOT NULL AND BTRIM(imagen_url) <> ''
    ) ranked
    WHERE ranked.position <= 2
    ON CONFLICT (slot) DO NOTHING;
  `);

  await ensureGaleriaVideoColumns();

  await pool.query(`
    ALTER TABLE galeria_viajes
    DROP CONSTRAINT IF EXISTS galeria_viajes_categoria_check;
  `);

  await pool.query(`
    ALTER TABLE galeria_viajes
    ADD CONSTRAINT galeria_viajes_categoria_check
    CHECK (categoria IN ('viajes', 'destinos'));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS galeria_viajes_orden_idx
    ON galeria_viajes (activo, orden, creado_en DESC);
  `);

  await pool.query(`
    WITH migration_applied AS (
      INSERT INTO app_data_migrations (name)
      VALUES ('seed_initial_public_destinations')
      ON CONFLICT (name) DO NOTHING
      RETURNING name
    )
    INSERT INTO galeria_viajes (
      imagen_url, tipo, categoria, titulo, descripcion, credito, fuente_url, licencia, licencia_url, orden, activo
    )
    SELECT seed.imagen_url, 'imagen', 'destinos', seed.titulo, seed.descripcion,
           seed.credito, seed.fuente_url, seed.licencia, seed.licencia_url, seed.orden, TRUE
    FROM (VALUES
      ('/destinos/puerto-lopez.jpg', 'Puerto López', 'Costa manabita y entorno del Parque Nacional Machalilla.', 'Annom', 'https://commons.wikimedia.org/wiki/File:Panorama_puerto_lopez_beach.jpg', 'Dominio público', NULL, 1),
      ('/destinos/montecristi.jpg', 'Montecristi', 'Ciudad Alfaro, historia y tradición artesanal manabita.', 'Jerrye & Roy Klotz, MD', 'https://commons.wikimedia.org/wiki/File:MONTECRISTI,_CENTRAL_PLAZA,_ECUADOR.jpg', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', 2),
      ('/destinos/bahia-de-caraquez.jpg', 'Bahía de Caráquez', 'Malecón y paisajes del estuario del río Chone.', 'Jmorenov007', 'https://commons.wikimedia.org/wiki/File:Malec%C3%B3n_de_Bah%C3%ADa_de_Car%C3%A1quez.jpg', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', 3),
      ('/destinos/guayaquil.jpg', 'Guayaquil', 'Recorrido urbano junto al río Guayas y el Malecón.', 'JorgeAlejanDroo', 'https://commons.wikimedia.org/wiki/File:Aerial_Guayaquil.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 4),
      ('/destinos/quito.jpg', 'Quito', 'Centro histórico, arquitectura y paisajes de la capital.', 'szeke', 'https://commons.wikimedia.org/wiki/File:Quito_At_Night_-_49384831736.jpg', 'CC BY-SA 2.0', 'https://creativecommons.org/licenses/by-sa/2.0/', 5),
      ('/destinos/banos-de-agua-santa.jpg', 'Baños de Agua Santa', 'Cascadas y paisajes andinos, como el Pailón del Diablo.', 'Pedro M. Martínez Corada', 'https://commons.wikimedia.org/wiki/File:Pailon-diablo.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 6),
      ('/destinos/mindo.jpg', 'Mindo', 'Bosque nublado y naturaleza del Chocó Andino.', 'Arabsalam', 'https://commons.wikimedia.org/wiki/File:Mindo_Terra_Bambu_Hotel_Ecuador_1085.jpg', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 7),
      ('/destinos/cuenca.jpg', 'Cuenca', 'Centro histórico y vista panorámica desde Turi.', 'Marc Figueras (Oersted)', 'https://commons.wikimedia.org/wiki/File:Cuenca_%28Ecuador%29_from_Turi.jpg', 'Dominio público', NULL, 8)
    ) AS seed(imagen_url, titulo, descripcion, credito, fuente_url, licencia, licencia_url, orden)
    WHERE EXISTS (SELECT 1 FROM migration_applied);
  `);

  // ============ MATRICULACIÓN VEHICULAR (calendario ANT por último dígito) ====
  // El mes de matriculación de cada vehículo se saca del último dígito de la
  // placa según este calendario, que el admin puede editar (cambia por año/cantón).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matricula_calendario (
      digito INT PRIMARY KEY CHECK (digito BETWEEN 0 AND 9),
      mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12)
    );
  `);

  // Calendario oficial Ecuador 2026 (dígito → mes). ON CONFLICT DO NOTHING para
  // no pisar los ajustes que el admin haga desde el panel.
  await pool.query(`
    INSERT INTO matricula_calendario (digito, mes)
    VALUES (1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(0,11)
    ON CONFLICT (digito) DO NOTHING;
  `);

  // Evita avisos duplicados: un aviso por vehículo y año de matriculación.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matricula_avisos (
      id SERIAL PRIMARY KEY,
      vehiculo_id INT NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      anio INT NOT NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (vehiculo_id, anio)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS decisiones_sistema (
      id SERIAL PRIMARY KEY,
      tipo_decision VARCHAR(80) NOT NULL,
      entidad_id INT,
      recomendacion JSONB NOT NULL,
      factores JSONB NOT NULL DEFAULT '{}'::jsonb,
      resultado VARCHAR(40),
      confirmado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
      creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS decisiones_sistema_tipo_fecha_idx
    ON decisiones_sistema (tipo_decision, creado_en DESC);
  `);

  console.log(" Esquema de base de datos verificado e inicializado");
};

module.exports = {
  initDatabase,
};
