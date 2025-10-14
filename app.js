require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de rate limiting
const requestTimes = [];
const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 35;

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: [
    'https://files.jumpseller.com',
    'https://*.jumpseller.com',
    /.*\.jumpseller\.com$/,
    'https://envio.chetomi.cl'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware de rate limiting
const rateLimitMiddleware = (req, res, next) => {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  while (requestTimes.length > 0 && requestTimes[0] < oneMinuteAgo) {
    requestTimes.shift();
  }
  
  if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
    console.log('⚠️ Rate limit alcanzado para Chetomi');
    return res.status(429).json({
      error: 'Muchas solicitudes, intenta en unos minutos',
      store: 'Chetomi',
      retry_after: 60
    });
  }
  
  requestTimes.push(now);
  next();
};

// Logging personalizado para Chetomi
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.headers['user-agent'] || 'Unknown';
  console.log(`[CHETOMI] ${timestamp} - ${req.method} ${req.path} - Requests: ${requestTimes.length}/min`);
  next();
});

// Configuración de tarifas Chetomi (puedes modificar estos precios)
const CHETOMI_SHIPPING_RATES = {
  'STANDARD': {
    name: 'Envío Estándar Chetomi',
    description: 'Entrega en 2-3 días hábiles en Santiago',
    ranges: [
      { max: 10, price: 3000, zone: 'Zona cercana (hasta 10km)' },
      { max: 15, price: 4500, zone: 'Zona intermedia (10-15km)' },
      { max: 20, price: 6500, zone: 'Zona lejana (15-20km)' },
      { max: Infinity, price: 8000, zone: 'Zona extendida (+20km)' }
    ]
  },
  'EXPRESS': {
    name: 'Envío Express Chetomi',
    description: 'Entrega en 24-48 horas en Santiago',
    ranges: [
      { max: 10, price: 4500, zone: 'Express cercano (hasta 10km)' },
      { max: 15, price: 6000, zone: 'Express intermedio (10-15km)' },
      { max: 20, price: 8000, zone: 'Express lejano (15-20km)' },
      { max: Infinity, price: 10000, zone: 'Express extendido (+20km)' }
    ]
  }
};

// Precios especiales por localidad (puedes agregar más comunas)
const CHETOMI_COMUNA_PRICES = {
  'providencia': { standard: 2500, express: 3500 }, // Descuento por estar cerca
  'las condes': { standard: 3500, express: 4500 },
  'vitacura': { standard: 4000, express: 5500 },
  'santiago': { standard: 3000, express: 4000 },
  'ñuñoa': { standard: 3500, express: 4500 },
  'la reina': { standard: 5000, express: 6500 },
  'maipú': { standard: 7000, express: 8500 },
  'puente alto': { standard: 8000, express: 9500 }
};

// Cache con TTL para geocodificación
const geocodeCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

function cleanCache() {
  const now = Date.now();
  for (const [key, value] of geocodeCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      geocodeCache.delete(key);
    }
  }
}

async function geocodeAddress(address) {
  cleanCache();
  
  const cacheKey = address.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`[CHETOMI] 📍 Cache hit: ${address}`);
    return cached.coords;
  }

  try {
    console.log(`[CHETOMI] 🔍 Geocodificando desde Providencia: ${address}`);
    
    const response = await axios.get(
      'https://api.openrouteservice.org/geocode/search',
      {
        params: {
          api_key: process.env.ORS_API_KEY,
          text: address,
          'boundary.country': 'CL',
          'boundary.region': 'Región Metropolitana',
          size: 1,
          layers: 'address,street'
        },
        timeout: 8000,
        headers: {
          'User-Agent': 'Chetomi-Shipping-Calculator/1.0'
        }
      }
    );

    if (!response.data.features || response.data.features.length === 0) {
      throw new Error('Dirección no encontrada en Santiago');
    }

    const coords = response.data.features[0].geometry.coordinates;
    const result = { lat: coords[1], lon: coords[0] };
    
    geocodeCache.set(cacheKey, {
      coords: result,
      timestamp: Date.now()
    });
    
    console.log(`[CHETOMI] ✅ Coordenadas: ${coords[1]}, ${coords[0]}`);
    return result;

  } catch (error) {
    console.error('[CHETOMI] ❌ Error geocodificando:', error.response?.data || error.message);
    throw new Error(`Error al encontrar dirección: ${error.message}`);
  }
}

async function calculateDistanceFromChetomi(destinationAddress, destinationCommune) {
  try {
    const fullDestination = `${destinationAddress}, ${destinationCommune}, Santiago, Chile`;
    console.log(`[CHETOMI] 📏 Calculando desde Amapolas 3959, Providencia a: ${fullDestination}`);

    const destCoords = await geocodeAddress(fullDestination);
    
    const routeResponse = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car',
      {
        coordinates: [
          [parseFloat(process.env.ORIGIN_LON), parseFloat(process.env.ORIGIN_LAT)], // Providencia
          [destCoords.lon, destCoords.lat]
        ],
        format: 'json',
        units: 'km'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.ORS_API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Chetomi-Shipping-Calculator/1.0'
        },
        timeout: 10000
      }
    );

    if (!routeResponse.data.routes || routeResponse.data.routes.length === 0) {
      throw new Error('No se pudo calcular ruta desde Chetomi');
    }

    const distanceKm = routeResponse.data.routes[0].segments[0].distance / 1000;
    const roundedDistance = Math.round(distanceKm * 100) / 100;
    
    console.log(`[CHETOMI] ✅ Distancia desde Providencia: ${roundedDistance} km`);
    return roundedDistance;

  } catch (error) {
    console.error('[CHETOMI] ❌ Error calculando distancia:', error.response?.data || error.message);
    
    // Fallback con estimaciones específicas para Chetomi
    const chetomiFallbacks = {
      'providencia': 2, 'las condes': 8, 'vitacura': 12,
      'santiago': 6, 'ñuñoa': 7, 'la reina': 15,
      'maipú': 22, 'puente alto': 28, 'la florida': 20,
      'san miguel': 12, 'la cisterna': 15, 'macul': 9,
      'peñalolén': 18, 'huechuraba': 18, 'quilicura': 22,
      'independencia': 10, 'recoleta': 12, 'conchalí': 15
    };
    
    const commune = destinationCommune.toLowerCase();
    for (const [key, distance] of Object.entries(chetomiFallbacks)) {
      if (commune.includes(key)) {
        console.log(`[CHETOMI] 🔄 Distancia estimada para ${commune}: ${distance} km`);
        return distance;
      }
    }
    
    console.log('[CHETOMI] 🔄 Distancia por defecto: 12 km');
    return 12; // Distancia promedio para Santiago desde Providencia
  }
}

function calculateChetomiShippingPrice(distanceKm, destinationCommune, serviceCode = 'STANDARD') {
  const service = CHETOMI_SHIPPING_RATES[serviceCode];
  if (!service) return { price: 0, zone: 'Servicio no disponible' };

  // Verificar si hay precio especial por comuna
  const communeKey = destinationCommune.toLowerCase();
  const specialPricing = CHETOMI_COMUNA_PRICES[communeKey];
  
  if (specialPricing) {
    const price = serviceCode === 'EXPRESS' ? specialPricing.express : specialPricing.standard;
    console.log(`[CHETOMI] 💰 Precio especial para ${destinationCommune}: $${price}`);
    return {
      price: price,
      zone: `Tarifa especial ${destinationCommune}`,
      special: true
    };
  }

  // Usar tarifas por distancia
  for (const range of service.ranges) {
    if (distanceKm <= range.max) {
      return { 
        price: range.price, 
        zone: range.zone,
        special: false
      };
    }
  }
  
  const lastRange = service.ranges[service.ranges.length - 1];
  return { 
    price: lastRange.price, 
    zone: lastRange.zone,
    special: false
  };
}

// ENDPOINTS

app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const uptimeFormatted = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
  
  res.json({ 
    status: 'OK',
    store: 'Chetomi',
    location: 'Amapolas 3959, Providencia, Santiago',
    contact: process.env.STORE_EMAIL,
    uptime: uptimeFormatted,
    timestamp: new Date().toISOString(),
    service: 'Chetomi Shipping Calculator',
    requests_last_minute: requestTimes.length,
    cache_size: geocodeCache.size,
    api_status: 'OpenRouteService Connected'
  });
});

app.get('/services', (req, res) => {
  const services = Object.keys(CHETOMI_SHIPPING_RATES).map(code => ({
    service_name: CHETOMI_SHIPPING_RATES[code].name,
    service_code: code,
    description: CHETOMI_SHIPPING_RATES[code].description
  }));

  res.json({ 
    store: 'Chetomi',
    services,
    origin: process.env.ORIGIN_ADDRESS,
    special_zones: Object.keys(CHETOMI_COMUNA_PRICES)
  });
});

app.post('/calculate-shipping', rateLimitMiddleware, async (req, res) => {
  const startTime = Date.now();
  let reference_id = `CHETOMI_${Date.now()}`;
  
  try {
    console.log('\n=== 🛍️ NUEVA SOLICITUD CHETOMI ===');
    console.log('📦 Request:', JSON.stringify(req.body, null, 2));

    const { request } = req.body;
    
    if (!request) {
      return res.status(400).json({
        error: 'Formato de solicitud inválido para Chetomi',
        store: 'Chetomi',
        reference_id
      });
    }

    reference_id = request.request_reference || reference_id;

    if (!request.to) {
      return res.status(400).json({
        error: 'Datos de destino requeridos',
        store: 'Chetomi',
        reference_id
      });
    }

    const { to } = request;
    const destinationAddress = `${to.address || ''} ${to.street_number || ''}`.trim();
    const destinationCommune = to.municipality_name || to.city || '';

    console.log(`[CHETOMI] 📍 Desde: Amapolas 3959, Providencia`);
    console.log(`[CHETOMI] 📍 Hacia: "${destinationAddress}", Comuna: "${destinationCommune}"`);

    if (!destinationAddress || !destinationCommune) {
      return res.status(400).json({
        error: 'Dirección y comuna de destino son requeridas para envío Chetomi',
        store: 'Chetomi',
        reference_id
      });
    }

    // Calcular distancia desde Chetomi en Providencia
    const distanceKm = await calculateDistanceFromChetomi(destinationAddress, destinationCommune);

    // Generar tarifas Chetomi
    const rates = Object.keys(CHETOMI_SHIPPING_RATES).map(serviceCode => {
      const calculation = calculateChetomiShippingPrice(distanceKm, destinationCommune, serviceCode);
      const specialLabel = calculation.special ? ' ⭐' : '';
      
      return {
        rate_id: `CHETOMI_${serviceCode}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        rate_description: `${calculation.zone} - ${destinationCommune} (${distanceKm}km)${specialLabel}`,
        service_name: CHETOMI_SHIPPING_RATES[serviceCode].name,
        service_code: serviceCode,
        total_price: calculation.price.toString(),
        delivery_time: serviceCode === 'EXPRESS' ? '24-48 horas' : '2-3 días hábiles',
        origin: 'Chetomi - Providencia'
      };
    });

    const response = {
      reference_id,
      store: 'Chetomi',
      origin: 'Amapolas 3959, Providencia, Santiago',
      rates
    };

    const processingTime = Date.now() - startTime;
    console.log(`[CHETOMI] ✅ Respuesta generada en ${processingTime}ms`);
    console.log('📋 Tarifas:', JSON.stringify(response, null, 2));
    console.log('=== FIN SOLICITUD CHETOMI ===\n');
    
    res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[CHETOMI] ❌ Error después de ${processingTime}ms:`, error.message);
    
    res.status(500).json({
      error: 'Error calculando envío desde Chetomi. Intenta nuevamente.',
      store: 'Chetomi',
      reference_id,
      rates: []
    });
  }
});

// Endpoint específico para test de Chetomi
app.post('/test-chetomi', rateLimitMiddleware, async (req, res) => {
  const { address, commune } = req.body;
  
  if (!address || !commune) {
    return res.status(400).json({ 
      error: 'Se requiere dirección y comuna para test Chetomi',
      store: 'Chetomi'
    });
  }

  try {
    const distance = await calculateDistanceFromChetomi(address, commune);
    const standardPrice = calculateChetomiShippingPrice(distance, commune, 'STANDARD');
    const expressPrice = calculateChetomiShippingPrice(distance, commune, 'EXPRESS');
    
    res.json({ 
      store: 'Chetomi',
      origin: 'Amapolas 3959, Providencia',
      destination: `${address}, ${commune}`,
      distance_km: distance,
      prices: {
        standard: standardPrice,
        express: expressPrice
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      store: 'Chetomi'
    });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('[CHETOMI] 💥 Error no manejado:', error);
  res.status(500).json({ 
    error: 'Error interno del servidor Chetomi',
    store: 'Chetomi',
    contact: process.env.STORE_EMAIL,
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint no encontrado en servidor Chetomi',
    store: 'Chetomi',
    available_endpoints: ['/health', '/services', '/calculate-shipping', '/test-chetomi']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CHETOMI SHIPPING CALCULATOR INICIADO`);
  console.log(`🏪 Tienda: ${process.env.STORE_NAME}`);
  console.log(`📍 Ubicación: ${process.env.ORIGIN_ADDRESS}`);
  console.log(`📧 Contacto: ${process.env.STORE_EMAIL}`);
  console.log(`🌐 Puerto: ${PORT}`);
  console.log(`⏱️ Rate limit: ${MAX_REQUESTS_PER_MINUTE} req/min`);
  console.log(`🔗 Health: https://envio.chetomi.cl/health`);
  console.log(`📦 Services: https://envio.chetomi.cl/services`);
  console.log(`🧪 Test: https://envio.chetomi.cl/test-chetomi`);
  console.log(`====================================`);
});
