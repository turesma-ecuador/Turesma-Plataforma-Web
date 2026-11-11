-- Crear base de datos Turesma
-- Ejecutar en pgAdmin o psql

CREATE DATABASE turesma_db;

-- Conectarse a la base de datos y crear tablas de ejemplo

-- Tabla de usuarios
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    rol VARCHAR(50) NOT NULL,
    hotel_id INT,
    activo BOOLEAN DEFAULT true,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de tours
CREATE TABLE tours (
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

-- Tabla de reservas
CREATE TABLE reservas (
    id SERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
    tour_id INT REFERENCES tours(id) ON DELETE CASCADE,
    fecha_reserva DATE NOT NULL,
    num_personas INT NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    estado VARCHAR(50) DEFAULT 'pendiente',
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Imágenes independientes del bloque promocional de la página de inicio
CREATE TABLE IF NOT EXISTS homepage_showcase_images (
    slot VARCHAR(20) PRIMARY KEY CHECK (slot IN ('primary', 'secondary')),
    image_url TEXT NOT NULL,
    position_x NUMERIC(5,2) NOT NULL DEFAULT 50,
    position_y NUMERIC(5,2) NOT NULL DEFAULT 50,
    zoom NUMERIC(5,2) NOT NULL DEFAULT 100,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

-- Usuarios: crear por API para evitar credenciales hardcodeadas
-- Ejemplo POST http://localhost:4000/api/usuarios
-- {
--   "nombre": "Nombre Usuario",
--   "email": "usuario@turesma.com",
--   "password": "tu_password",
--   "rol": "admin|cliente|conductor"
-- }

INSERT INTO tours (titulo, descripcion, precio, duracion, capacidad, ubicacion) VALUES
('Tour Ciudad Colonial', 'Recorrido por el centro histórico', 50.00, '3 horas', 20, 'Santo Domingo'),
('Tour Aventura Montaña', 'Senderismo y rappel', 80.00, '5 horas', 15, 'Jarabacoa'),
('Tour Playas del Este', 'Día completo en las mejores playas', 65.00, '8 horas', 30, 'Punta Cana');
