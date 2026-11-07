export {};

const { Pool } = require("pg");

// En la base PostgreSQL local de AtukHosting normalmente no se usa SSL.
// Actívalo solo si el proveedor lo exige para esta conexión.
const useSSL = String(process.env.DB_SSL || "").toLowerCase() === "true";
const sslConfig = useSSL ? { rejectUnauthorized: false } : undefined;
const poolConfig = {
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 300000,
  connectionTimeoutMillis: 10000,
};

let pool: any;

if (process.env.DATABASE_URL) {
  // Muchos hostings entregan un único "connection string". Si está presente,
  // se usa ese directamente (más simple que cargar las 5 variables sueltas).
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig,
    ...poolConfig,
  });
} else {
  const requiredEnvVars = ["DB_USER", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT"];
  const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missingEnvVars.length > 0) {
    throw new Error(
      `Faltan variables de entorno de base de datos: ${missingEnvVars.join(", ")}`
    );
  }

  pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    ssl: sslConfig,
    ...poolConfig,
  });
}

module.exports = pool;
