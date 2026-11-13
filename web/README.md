# Portal web de Turesma

Frontend Next.js de la plataforma, con portales separados para clientes,
conductores y administración.

## Desarrollo local

Requiere Node.js 22 o superior. Desde esta carpeta:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Abre `http://localhost:3000`. Configura `NEXT_PUBLIC_API_URL` con la URL de la
API; en desarrollo puede usarse `http://localhost:4000`.

## Validación

```powershell
npm run lint
npm run build
```

El lint puede mostrar advertencias preexistentes de hooks de React. Los errores
de lint y de compilación deben corregirse antes de integrar cambios.

## Despliegue

El frontend se despliega en Vercel. Configura las variables de producción en el
panel de Vercel, no en archivos versionados:

- `NEXT_PUBLIC_API_URL`: URL pública del proxy de API del frontend, normalmente
  `https://turesma.com/api-proxy`.
- `API_PROXY_TARGET`: origen público de la API, normalmente
  `https://api.turesma.com`.
- `API_URL`: origen público de la API para llamadas desde el servidor, por
  ejemplo `https://api.turesma.com`.

Después de cambiar variables, vuelve a desplegar y prueba acceso, historial,
pagos y archivos desde los portales correspondientes. No publiques tokens,
contraseñas ni datos de `.env.local`.
