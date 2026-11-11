export {};

const pool = require("../config/db");

const DEFAULTS = {
  primary_image_url: "/manta-city.jpg",
  secondary_image_url: "/manta-flag.png",
  primary_alt: "Vista de la costa y la ciudad de Manta, Ecuador",
  secondary_alt: "Bandera y escudo de Manta frente a la costa de la ciudad",
  primary_position_x: 50,
  primary_position_y: 50,
  primary_zoom: 100,
  secondary_position_x: 50,
  secondary_position_y: 50,
  secondary_zoom: 100,
  eyebrow: "Desde Manta para el Ecuador",
  title: "Una empresa que conecta personas, destinos y experiencias en todo el Ecuador.",
  description: "En TURESMA S.A. redefinimos el transporte turístico con un compromiso inquebrantable con la seguridad y la elegancia. Nuestra operación nace en Manta y acompaña cada recorrido con servicio, comodidad y confianza.",
  label: "Servicio turístico, ejecutivo y empresarial",
};

const getCityShowcase = async () => {
  const result = await pool.query("SELECT * FROM homepage_city_showcase WHERE id = 1");
  return { ...DEFAULTS, ...(result.rows[0] || {}) };
};

const getPublicHomeCityShowcase = async (_req: any, res: any) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.json(await getCityShowcase());
  } catch (error) {
    console.error("Error cargando presentación de Manta:", error);
    return res.status(500).json({ error: "No se pudo cargar la presentación de Manta" });
  }
};

const getAdminHomeCityShowcase = async (_req: any, res: any) => {
  try {
    return res.json(await getCityShowcase());
  } catch (error) {
    console.error("Error cargando presentación de Manta para administración:", error);
    return res.status(500).json({ error: "No se pudo cargar la presentación de Manta" });
  }
};

const updateHomeCityShowcase = async (req: any, res: any) => {
  const values = Object.fromEntries(
    Object.keys(DEFAULTS).map((key) => [key, typeof req.body?.[key] === "string" ? req.body[key].trim() : ""])
  );
  const cropValues = Object.fromEntries(
    ["primary", "secondary"].flatMap((slot) => [
      [`${slot}_position_x`, Number(req.body?.[`${slot}_position_x`])],
      [`${slot}_position_y`, Number(req.body?.[`${slot}_position_y`])],
      [`${slot}_zoom`, Number(req.body?.[`${slot}_zoom`])],
    ])
  );
  const requiredFields = ["primary_image_url", "secondary_image_url", "primary_alt", "secondary_alt", "eyebrow", "title", "description", "label"];

  if (requiredFields.some((field) => !values[field])) {
    return res.status(400).json({ error: "Completa todos los campos de la presentación de Manta" });
  }
  if (Object.values(values).some((value) => value.length > 2000)) {
    return res.status(400).json({ error: "Uno de los campos supera el límite permitido" });
  }
  if (
    ["primary_position_x", "primary_position_y", "secondary_position_x", "secondary_position_y"]
      .some((key) => !Number.isFinite(cropValues[key]) || cropValues[key] < 0 || cropValues[key] > 100)
    || ["primary_zoom", "secondary_zoom"]
      .some((key) => !Number.isFinite(cropValues[key]) || cropValues[key] < 100 || cropValues[key] > 200)
  ) {
    return res.status(400).json({ error: "El encuadre de las imágenes no es válido" });
  }

  try {
    for (const field of ["primary_image_url", "secondary_image_url"]) {
      const parsedUrl = new URL(values[field], "https://turesma.com");
      const isLocalPath = parsedUrl.origin === "https://turesma.com" && values[field].startsWith("/");
      if (parsedUrl.protocol !== "https:" && !isLocalPath) {
        return res.status(400).json({ error: "Las imágenes deben usar HTTPS o una ruta local" });
      }
    }

    const result = await pool.query(
      `INSERT INTO homepage_city_showcase
        (id, primary_image_url, secondary_image_url, primary_alt, secondary_alt,
         primary_position_x, primary_position_y, primary_zoom,
         secondary_position_x, secondary_position_y, secondary_zoom,
         eyebrow, title, description, label, actualizado_en)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         primary_image_url = EXCLUDED.primary_image_url,
         secondary_image_url = EXCLUDED.secondary_image_url,
         primary_alt = EXCLUDED.primary_alt,
         secondary_alt = EXCLUDED.secondary_alt,
         primary_position_x = EXCLUDED.primary_position_x,
         primary_position_y = EXCLUDED.primary_position_y,
         primary_zoom = EXCLUDED.primary_zoom,
         secondary_position_x = EXCLUDED.secondary_position_x,
         secondary_position_y = EXCLUDED.secondary_position_y,
         secondary_zoom = EXCLUDED.secondary_zoom,
         eyebrow = EXCLUDED.eyebrow,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         label = EXCLUDED.label,
         actualizado_en = CURRENT_TIMESTAMP
       RETURNING *`,
      [values.primary_image_url, values.secondary_image_url, values.primary_alt, values.secondary_alt,
        cropValues.primary_position_x, cropValues.primary_position_y, cropValues.primary_zoom,
        cropValues.secondary_position_x, cropValues.secondary_position_y, cropValues.secondary_zoom,
        values.eyebrow, values.title, values.description, values.label]
    );
    return res.json({ ...DEFAULTS, ...result.rows[0] });
  } catch (error) {
    console.error("Error guardando presentación de Manta:", error);
    return res.status(500).json({ error: "No se pudo guardar la presentación de Manta" });
  }
};

module.exports = {
  getPublicHomeCityShowcase,
  getAdminHomeCityShowcase,
  updateHomeCityShowcase,
};
