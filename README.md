# Turesma

Aplicacion de turismo con backend en Node.js/Express y frontend en Next.js.

## Estructura

- `backend/`: API, PostgreSQL, autenticacion y archivos subidos.
- `web/`: interfaz Next.js.

## Desarrollo local

Requisitos: Node.js 20 o superior y PostgreSQL si se ejecuta la API localmente.

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

En otra terminal:

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

La API queda en `http://localhost:4000` y el frontend en `http://localhost:3000`.

Configura las variables de `backend/.env` con datos locales o del proveedor de PostgreSQL. Para el frontend, `web/.env.local` debe contener la URL de la API.

## Almacenamiento de archivos

El backend guarda las imágenes y videos en el disco del servidor y los sirve
desde la API. Configura `API_PUBLIC_URL` con el origen HTTPS de la API y
`UPLOADS_DIR` con una carpeta persistente fuera del checkout del repositorio
(por ejemplo, `/home3/ojtaagta/turesma-storage` en cPanel). La carpeta contiene
archivos que no deben incluirse en Git. El archivo
`backend/.env.atukhosting.example` documenta los valores iniciales esperados
para la cuenta actual; contiene placeholders, nunca contraseñas utilizables.

Los documentos de identidad se guardan en carpetas no públicas y se entregan
solo con autenticación. El almacenamiento empieza vacío y los archivos nuevos
se guardan directamente en el servidor.

### Despliegue en cPanel / AtukHosting

El archivo `.cpanel.yml` de la raíz instala las dependencias, compila la API
y solicita el reinicio de Passenger. Está configurado para la ruta de la
cuenta de AtukHosting actual y Node.js 22.

1. En **Setup Node.js App**, conserva Node.js 22, la raíz de la aplicación
   `repositories/Turesma-Plataforma-Web/backend` y el startup `dist/server.js`.
2. Crea en cPanel las variables de `backend/.env.atukhosting.example` para la
   app. Sustituye los placeholders por secretos reales directamente en cPanel;
   no subas el archivo de ejemplo ni pegues secretos en mensajes. Confirma la
   ruta absoluta de `UPLOADS_DIR`, que debe estar fuera del repositorio y ser
   escribible por la aplicación.
3. En **Setup Node.js App**, pulsa **Run NPM Install** para instalar las
   dependencias en el entorno virtual de CloudLinux. No ejecutes `npm ci` en
   la raíz de la aplicación: puede reemplazar el enlace `node_modules` que
   CloudLinux requiere. Después, en **Git Version Control**, pulsa
   **Update from Remote** y confirma que cPanel muestre el commit que incluye
   `.cpanel.yml`. Luego pulsa **Deploy HEAD Commit**. El archivo compila `dist/`
   y solicita el reinicio de Passenger; si el despliegue falla, revisa el log
   de cPanel antes de continuar.

   Como alternativa manual, en Terminal ejecuta el comando de activación que
   muestra cPanel y luego:

   ```bash
   cd ~/repositories/Turesma-Plataforma-Web/backend
   node -v
   npx --yes npm@10 ci
   npm run build
   ```

   Comprueba que `node -v` muestre `v22`. Usa `npx --yes npm@10 ci` en lugar
   del botón de instalación de cPanel si la Terminal muestra npm 6; el lockfile
   requiere npm 7 o posterior. Confirma que la aplicación puede escribir en
   `UPLOADS_DIR`. Al iniciar con almacenamiento vacío, carga los medios desde
   la aplicación para guardarlos en el servidor.

Después de configurar la API en cPanel, configura en Vercel las variables
`NEXT_PUBLIC_API_URL=https://turesma.com/api-proxy`, `API_PROXY_TARGET=https://api.turesma.com`
y `API_URL=https://api.turesma.com`, y vuelve a desplegar el frontend. `API_URL`
y `API_PROXY_TARGET` deben apuntar al origen de la API, no a la ruta `/api-proxy`
del frontend.

El frontend envía las llamadas de API mediante `/api-proxy`. El proxy acepta
respuestas JSON y conserva las descargas de archivos; si el hosting responde
con una página HTML o contenido inválido para una ruta de API, devuelve un
error JSON explícito (`502`). Esto evita que el navegador intente interpretar
una página de bloqueo como datos. No elimina el bloqueo del hosting: el
proveedor debe permitir las solicitudes legítimas a la API.

## Inteligencia operativa

El panel administrativo incluye analítica descriptiva y recomendaciones basadas en
datos reales de reservas, flota y mantenimiento. Las rutas protegidas disponibles
son:

- `GET /api/admin/inteligencia/dashboard`
- `GET /api/admin/inteligencia/analitica`
- `GET /api/admin/inteligencia/asignacion-recomendada?fecha=YYYY-MM-DD&pasajeros=N&hora_inicio=HH:MM&hora_fin=HH:MM&operacion_id=N`
- `PATCH /api/admin/inteligencia/asignacion-recomendada/:id/decision`
- `GET /api/admin/operaciones/reservas-pendientes`
- `POST /api/admin/operaciones/reservas/:id/despachar`
- `PATCH /api/admin/operaciones/:id/reabrir`
- `PATCH /api/admin/operaciones/:id/asignar`
- `GET /api/admin/inteligencia/desempeno`
- `GET /api/admin/control-operativo`
- `GET /api/admin/inteligencia/anomalias`

El centro de control operativo consolida las operaciones del día, asignaciones
pendientes, disponibilidad de flota, mantenimiento, pagos y un semáforo general.
La detección de anomalías analiza cancelaciones, pagos antiguos, utilización de
vehículos y rutas con baja demanda.

El despacho muestra reservas confirmadas que aún necesitan vehículo o conductor.
En las reservas originadas por una cotización, Administración aprueba el precio
sin asignar unidades. La categoría solicitada se conserva como preferencia; una
vez confirmado el pago total, la reserva aparece en la cola de Despacho para que
el equipo asigne el vehículo y el conductor.

Para grupos grandes o servicios que requieren coordinar varias unidades, el
cliente puede enviar un requerimiento personalizado desde Cotizar. El formulario
recopila organización y una descripción general, además de uno o más grupos de
servicio. Cada grupo reúne vehículos que comparten tipo, ruta y horario, e
incluye cantidad, pasajeros por unidad, fechas, paradas, indicaciones y si las
unidades deben operar simultáneamente. Se puede copiar la ruta y el horario de
un grupo anterior para agilizar grupos similares. El envío no confirma
disponibilidad ni crea una reserva. Administración revisa estos
requerimientos en una bandeja separada de Cotizaciones, actualiza su estado y
puede responder al cliente desde allí. El cliente consulta la respuesta en la
misma sección de su solicitud.

Al preparar una reserva se crea una operación vinculada, evitando registrar el
mismo servicio dos veces. En la asignación, el administrador puede pedir una
recomendación calculada para la fecha, horario y número de pasajeros. La
recomendación considera capacidad, disponibilidad, mantenimiento, calificación
del conductor y carga operativa; puede aceptarse o reemplazarse por una de las
alternativas, indicando el motivo. La asignación final siempre requiere
confirmación y el backend valida capacidad, mantenimiento, licencia y conflictos
de horario. La decisión y la asignación se registran juntas para mantener su
trazabilidad. Si se cancela un despacho, una reserva que siga confirmada vuelve
a la cola y permite reabrir la operación existente, conservando su historial.

Los comprobantes de pago ya no se sirven como archivos estáticos públicos. Se
entregan mediante URLs temporales o rutas autorizadas, mientras que las imágenes
públicas se limitan a las carpetas de galería, perfiles, vehículos y viajes.

## Exportación de reservas

El módulo administrativo de reservas permite descargar un Excel con formato de
marca TURESMA, encabezados, filtros y filas alternadas. La exportación respeta
los filtros actuales de estado y búsqueda de la pantalla. También está disponible
mediante `GET /api/admin/reportes/exportar-csv?tipo=reservas&formato=xlsx`.

## Recibos de pago

Cada pago aprobado genera un recibo PDF descargable desde el historial de pagos
del cliente y desde el panel administrativo de pagos. El recibo incluye el pago,
la reserva, el método y el total acumulado, y solo está disponible cuando el pago
ha sido aprobado. Las rutas requieren autenticación y verifican la propiedad de
la reserva para el acceso del cliente:

- `GET /api/usuarios/mis-reservas/:id/pagos/:pagoId/recibo`
- `GET /api/admin/pagos/:id/recibo`

El recibo funciona como constancia de pago aprobado y no reemplaza una factura
tributaria ni el comprobante emitido por la entidad financiera.

## Proformas

El cliente puede descargar desde su historial una proforma PDF de cada reserva
con precio definido. Incluye la ruta, fechas, categoría solicitada y total; el
documento es informativo y no reemplaza una factura ni un comprobante de pago.
La descarga verifica que la reserva pertenezca al usuario autenticado:

- `GET /api/usuarios/mis-reservas/:id/proforma`

## Comprobaciones

```powershell
cd backend
npm run build

cd ..\web
npm run lint
npm run build
```

No subas `.env`, `.env.local`, contraseñas, tokens ni contenido de los directorios de archivos. Configura las variables de producción en el panel del proveedor correspondiente (cPanel para la API y Vercel para el frontend).
