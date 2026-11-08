export {};

const pool = require("./db");

const hasReservasColumn = async (columnName) => {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reservas'
       AND column_name = $1
     LIMIT 1`,
    [columnName]
  );

  return result.rowCount > 0;
};

const syncReservaEstadosAutomaticos = async () => {
  const [hasConductorId, hasVehiculoId] = await Promise.all([
    hasReservasColumn("conductor_id"),
    hasReservasColumn("vehiculo_id"),
  ]);

  const assignmentChecks = [];
  if (hasConductorId) assignmentChecks.push("conductor_id IS NOT NULL");
  if (hasVehiculoId) assignmentChecks.push("vehiculo_id IS NOT NULL");

  if (assignmentChecks.length > 0) {
    await pool.query(
      `UPDATE reservas
       SET estado = 'confirmada'
       WHERE estado = 'pendiente'
         AND estado_pago = 'pagado'
         AND (${assignmentChecks.join(" OR ")})`
    );
  }
};

module.exports = {
  syncReservaEstadosAutomaticos,
};
