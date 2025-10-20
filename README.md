
# Envío Chetomi

Sistema Flask + PostgreSQL para calcular tarifas de envíos integrados con JumpSeller, panel de administración y cálculo de distancias usando OpenRouteService.

## Instalación (Desarrollo y Producción vía Docker)

1. Copia `.env.example` como `.env` y ajusta los valores.
2. Ejecuta:
docker-compose up --build

text
3. Accede a la app en `http://localhost:5000` por defecto.
4. El primer usuario admin (`franksmazagmail.com / chetomi123`) se crea automáticamente al levantar por primera vez.

## Estructura

- `app/` código fuente Flask
- `migrations/` para gestión de la base (flask db)
- `tests/` pruebas básicas
- `Dockerfile`, `docker-compose.yml` despliegue rápido y portable

## Notas

- Panel admin y endpoints `/calculate-shipping` y `/services` para JumpSeller.
- Lógica de cálculo vía OpenRouteService API.
