export {};

const getWebBaseUrl = () => String(process.env.WEB_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character] || character));

type BrandedEmailOptions = {
  preheader: string;
  title: string;
  bodyHtml: string;
  actionLabel?: string;
  actionUrl?: string;
  notice: string;
};

const renderBrandedEmail = ({
  preheader,
  title,
  bodyHtml,
  actionLabel,
  actionUrl,
  notice,
}: BrandedEmailOptions) => {
  const webUrl = getWebBaseUrl();
  const action = actionLabel && actionUrl
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px auto">
        <tr>
          <td align="center" bgcolor="#E31E24" style="border-radius:8px">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none">
              ${escapeHtml(actionLabel)}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f9">
      <tr>
        <td align="center" style="padding:32px 12px">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
            <tr>
              <td height="5" bgcolor="#E31E24" style="height:5px;font-size:0;line-height:0">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 24px 20px">
                <a href="${escapeHtml(webUrl)}" style="display:inline-block;text-decoration:none">
                  <img src="${escapeHtml(`${webUrl}/logo.png`)}" alt="Turesma S.A. - Transporte turístico" width="250" style="display:block;width:250px;max-width:100%;height:auto;border:0">
                </a>
                <p style="margin:12px 0 0;color:#64748b;font-size:11px;font-weight:bold;letter-spacing:1.2px">TURESMA S.A. | TRANSPORTE TURÍSTICO Y EJECUTIVO</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 36px 36px">
                <p style="margin:0 0 10px;color:#E31E24;font-size:11px;font-weight:bold;letter-spacing:1.2px">SEGURIDAD DE TU CUENTA</p>
                <h1 style="margin:0 0 20px;color:#111827;font-size:25px;line-height:1.3">${escapeHtml(title)}</h1>
                <div style="color:#475569;font-size:15px;line-height:1.7">${bodyHtml}</div>
                ${action}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px">
                  <tr>
                    <td style="padding:14px 16px;border:1px solid #fee2e2;border-radius:8px;background-color:#fff7f7;color:#7f1d1d;font-size:13px;line-height:1.6">
                      ${escapeHtml(notice)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 24px;background-color:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6">
                Este es un mensaje automático de Turesma S.A. Por favor, no respondas a este correo.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

module.exports = {
  getWebBaseUrl,
  escapeHtml,
  renderBrandedEmail,
};
