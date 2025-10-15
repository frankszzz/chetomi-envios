require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración inicial con tus rangos exactos
let SHIPPING_CONFIG = {
  services: {
    'TODAY': {
      name: 'Envío Hoy',
      description: 'Entrega el mismo día',
      instructions: 'Tu pedido será entregado hoy en el horario acordado. Confirmaremos por WhatsApp.',
      enabled: true,
      available_hours: { start: '08:00', end: '18:00' },
      available_days: [1, 2, 3, 4, 5],
      show_calendar: false,
      block_same_day: false,
      ranges: [
        { min: 0, max: 2, price: 2500, label: '0-2 km' },
        { min: 2, max: 4, price: 3000, label: '2-4 km' },
        { min: 4, max: 6, price: 3500, label: '4-6 km' },
        { min: 6, max: 8, price: 4000, label: '6-8 km' },
        { min: 8, max: 10, price: 4500, label: '8-10 km' },
        { min: 10, max: Infinity, price: 5500, label: '+10 km' }
      ]
    },
    'SCHEDULED': {
      name: 'Envío Programado',
      description: 'Programa tu entrega',
      instructions: 'Selecciona la fecha de entrega que prefieras. Entregas de lunes a viernes.',
      enabled: true,
      available_hours: { start: '08:00', end: '20:00' },
      available_days: [1, 2, 3, 4, 5],
      show_calendar: true,
      block_same_day: true,
      ranges: [
        { min: 0, max: 2, price: 2000, label: '0-2 km' },
        { min: 2, max: 4, price: 2500, label: '2-4 km' },
        { min: 4, max: 6, price: 3000, label: '4-6 km' },
        { min: 6, max: 8, price: 3500, label: '6-8 km' },
        { min: 8, max: 10, price: 4000, label: '8-10 km' },
        { min: 10, max: Infinity, price: 4500, label: '+10 km' }
      ]
    }
  },
  blocked_dates: [],
  blocked_weekdays: [0, 6],
  special_closed_dates: [],
  store_info: {
    name: 'Chetomi',
    origin: 'Amapolas 3959, Providencia, Santiago, Chile',
    contact: 'franksmaza@gmail.com'
  }
};

// Función para cargar y guardar configuración
async function loadConfig() {
  try {
    const data = await fs.readFile('./shipping_config.json', 'utf8');
    SHIPPING_CONFIG = { ...SHIPPING_CONFIG, ...JSON.parse(data) };
    console.log('[CHETOMI] ✅ Configuración cargada desde archivo');
  } catch (error) {
    console.log('[CHETOMI] ℹ️ Usando configuración por defecto');
    await saveConfig();
  }
}

async function saveConfig() {
  try {
    await fs.writeFile('./shipping_config.json', JSON.stringify(SHIPPING_CONFIG, null, 2));
    console.log('[CHETOMI] ✅ Configuración guardada');
  } catch (error) {
    console.error('[CHETOMI] ❌ Error guardando configuración:', error);
  }
}

// Middleware básico
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: [
    'https://files.jumpseller.com',
    'https://*.jumpseller.com',
    /.*\.jumpseller\.com$/,
    'https://envio.chetomi.cl',
    'https://admin.chetomi.cl'
  ],
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const requestTimes = [];
const rateLimitMiddleware = (req, res, next) => {
  const now = Date.now();
  requestTimes.push(now);
  
  while (requestTimes[0] < now - 60000) {
    requestTimes.shift();
  }
  
  if (requestTimes.length > 35) {
    return res.status(429).json({ error: 'Rate limit excedido' });
  }
  
  next();
};

// FUNCIÓN DE DISPONIBILIDAD CON HORARIOS (NUEVA)
function isServiceAvailable(serviceCode) {
  const service = SHIPPING_CONFIG.services[serviceCode];
  if (!service || !service.enabled) return false;

  const now = new Date();
  const chileTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Santiago"}));
  
  const currentHour = chileTime.getHours();
  const currentMinute = chileTime.getMinutes();
  const currentDay = chileTime.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
  const currentTime = currentHour * 100 + currentMinute; // Formato HHMM
  
  // Verificar día de la semana
  if (!service.available_days.includes(currentDay)) {
    console.log(`[CHETOMI] ${service.name} no disponible: día ${currentDay} no permitido`);
    return false;
  }
  
  // Convertir horarios a formato HHMM
  const [startHour, startMin] = service.available_hours.start.split(':').map(Number);
  const [endHour, endMin] = service.available_hours.end.split(':').map(Number);
  const startTime = startHour * 100 + startMin;
  const endTime = endHour * 100 + endMin;
  
  // Verificar horario
  if (currentTime < startTime || currentTime >= endTime) {
    console.log(`[CHETOMI] ${service.name} fuera de horario: ${currentHour}:${currentMinute.toString().padStart(2,'0')} (permitido: ${service.available_hours.start}-${service.available_hours.end})`);
    return false;
  }
  
  console.log(`[CHETOMI] ${service.name} DISPONIBLE: ${currentHour}:${currentMinute.toString().padStart(2,'0')}`);
  return true;
}

// Funciones de cálculo
function calculatePrice(distanceKm, serviceCode) {
  const service = SHIPPING_CONFIG.services[serviceCode];
  if (!service) return 0;
  
  for (const range of service.ranges) {
    if (distanceKm >= range.min && distanceKm < range.max) {
      return range.price;
    }
  }
  
  return service.ranges[service.ranges.length - 1].price;
}

function getRangeLabel(distanceKm, serviceCode) {
  const service = SHIPPING_CONFIG.services[serviceCode];
  if (!service) return 'N/A';
  
  for (const range of service.ranges) {
    if (distanceKm >= range.min && distanceKm < range.max) {
      return range.label;
    }
  }
  
  return service.ranges[service.ranges.length - 1].label;
}

// Geocodificación y cálculo de distancia
const geocodeCache = new Map();

async function geocodeAddress(address) {
  const cacheKey = address.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < 86400000)) {
    return cached.coords;
  }

  try {
    const response = await axios.get('https://api.openrouteservice.org/geocode/search', {
      params: {
        api_key: process.env.ORS_API_KEY,
        text: address,
        'boundary.country': 'CL',
        size: 1
      },
      timeout: 8000
    });

    if (!response.data.features || response.data.features.length === 0) {
      throw new Error('Dirección no encontrada');
    }

    const coords = response.data.features[0].geometry.coordinates;
    const result = { lat: coords[1], lon: coords[0] };
    
    geocodeCache.set(cacheKey, { coords: result, timestamp: Date.now() });
    return result;

  } catch (error) {
    throw new Error(`Error geocodificando: ${error.message}`);
  }
}

async function calculateDistance(destinationAddress, destinationCommune) {
  try {
    const fullDestination = `${destinationAddress}, ${destinationCommune}, Santiago, Chile`;
    const destCoords = await geocodeAddress(fullDestination);
    
    const routeResponse = await axios.post('https://api.openrouteservice.org/v2/directions/driving-car', {
      coordinates: [
        [parseFloat(process.env.ORIGIN_LON), parseFloat(process.env.ORIGIN_LAT)],
        [destCoords.lon, destCoords.lat]
      ],
      format: 'json'
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.ORS_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const distanceKm = routeResponse.data.routes[0].segments[0].distance / 1000;
    return Math.round(distanceKm * 100) / 100;

  } catch (error) {
    console.error('[CHETOMI] Error calculando distancia:', error.message);
    return 5;
  }
}

// ENDPOINTS PRINCIPALES
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    store: SHIPPING_CONFIG.store_info.name,
    timestamp: new Date().toISOString(),
    services_enabled: Object.keys(SHIPPING_CONFIG.services).filter(
      key => SHIPPING_CONFIG.services[key].enabled
    ).length
  });
});

app.get('/services', (req, res) => {
  const availableServices = Object.keys(SHIPPING_CONFIG.services)
    .filter(key => SHIPPING_CONFIG.services[key].enabled)
    .map(key => ({
      service_name: SHIPPING_CONFIG.services[key].name,
      service_code: key,
      description: SHIPPING_CONFIG.services[key].description
    }));

  res.json({
    store: SHIPPING_CONFIG.store_info.name,
    services: availableServices,
    origin: SHIPPING_CONFIG.store_info.origin
  });
});

app.post('/calculate-shipping', rateLimitMiddleware, async (req, res) => {
  try {
    const { request } = req.body;
    const reference_id = request?.request_reference || `CHETOMI_${Date.now()}`;
    
    if (!request?.to) {
      return res.status(400).json({ error: 'Datos de destino requeridos', reference_id });
    }

    const { to } = request;
    const destinationAddress = `${to.address || ''} ${to.street_number || ''}`.trim();
    const destinationCommune = to.municipality_name || to.city || '';

    if (!destinationAddress || !destinationCommune) {
      return res.status(400).json({
        error: 'Dirección y comuna requeridas',
        reference_id
      });
    }

    const distanceKm = await calculateDistance(destinationAddress, destinationCommune);
    const rates = [];

    // APLICAR FILTRO DE HORARIOS (NUEVO)
    Object.keys(SHIPPING_CONFIG.services).forEach(serviceCode => {
      const service = SHIPPING_CONFIG.services[serviceCode];
      
      if (!service.enabled) return;
      
      // VERIFICAR SI EL SERVICIO ESTÁ DISPONIBLE AHORA
      if (!isServiceAvailable(serviceCode)) {
        console.log(`[CHETOMI] ${service.name} no incluido: fuera de horario o día`);
        return;
      }
      
      const price = calculatePrice(distanceKm, serviceCode);
      const rangeLabel = getRangeLabel(distanceKm, serviceCode);
      
      rates.push({
        rate_id: `CHETOMI_${serviceCode}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        rate_description: `${rangeLabel} - ${destinationCommune} (${distanceKm}km)`,
        service_name: service.name,
        service_code: serviceCode,
        total_price: price.toString(),
        delivery_time: service.description,
        instructions: service.instructions
      });
    });

    res.json({
      reference_id,
      store: SHIPPING_CONFIG.store_info.name,
      rates
    });

  } catch (error) {
    console.error('[CHETOMI] Error:', error.message);
    res.status(500).json({
      error: 'Error calculando envío',
      reference_id: req.body.request?.request_reference || Date.now().toString(),
      rates: []
    });
  }
});

// ENDPOINTS PARA ADMIN PANEL
app.get('/admin/config', (req, res) => {
  res.json(SHIPPING_CONFIG);
});

app.post('/admin/update-ranges', async (req, res) => {
  const { serviceCode, ranges } = req.body;
  
  if (SHIPPING_CONFIG.services[serviceCode]) {
    SHIPPING_CONFIG.services[serviceCode].ranges = ranges;
    await saveConfig();
    res.json({ success: true, message: 'Rangos actualizados correctamente' });
  } else {
    res.status(400).json({ error: 'Servicio no encontrado' });
  }
});

// NUEVOS ENDPOINTS PARA HORARIOS
app.post('/admin/update-service-hours', async (req, res) => {
  const { serviceCode, startTime, endTime, availableDays } = req.body;
  
  if (SHIPPING_CONFIG.services[serviceCode]) {
    SHIPPING_CONFIG.services[serviceCode].available_hours = {
      start: startTime,
      end: endTime
    };
    
    if (availableDays) {
      SHIPPING_CONFIG.services[serviceCode].available_days = availableDays;
    }
    
    await saveConfig();
    res.json({ 
      success: true, 
      message: `Horarios de ${SHIPPING_CONFIG.services[serviceCode].name} actualizados`,
      current_chile_time: new Date().toLocaleString("en-US", {timeZone: "America/Santiago"})
    });
  } else {
    res.status(400).json({ error: 'Servicio no encontrado' });
  }
});

app.post('/admin/toggle-service', async (req, res) => {
  const { serviceCode } = req.body;
  
  if (SHIPPING_CONFIG.services[serviceCode]) {
    SHIPPING_CONFIG.services[serviceCode].enabled = !SHIPPING_CONFIG.services[serviceCode].enabled;
    await saveConfig();
    res.json({ 
      success: true, 
      enabled: SHIPPING_CONFIG.services[serviceCode].enabled,
      message: `${SHIPPING_CONFIG.services[serviceCode].name} ${SHIPPING_CONFIG.services[serviceCode].enabled ? 'activado' : 'desactivado'}`
    });
  } else {
    res.status(400).json({ error: 'Servicio no encontrado' });
  }
});

app.get('/admin/service-status', (req, res) => {
  const chileTime = new Date().toLocaleString("en-US", {timeZone: "America/Santiago"});
  const now = new Date(chileTime);
  
  const status = {};
  Object.keys(SHIPPING_CONFIG.services).forEach(serviceCode => {
    const service = SHIPPING_CONFIG.services[serviceCode];
    status[serviceCode] = {
      name: service.name,
      enabled: service.enabled,
      available_now: isServiceAvailable(serviceCode),
      current_time: now.toLocaleTimeString('es-CL', { hour12: false }),
      schedule: `${service.available_hours.start} - ${service.available_hours.end}`,
      days: service.available_days
    };
  });
  
  res.json({
    chile_time: chileTime,
    services: status
  });
});

// Inicialización
loadConfig().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CHETOMI SHIPPING CALCULATOR CON HORARIOS`);
    console.log(`🏪 Tienda: ${SHIPPING_CONFIG.store_info.name}`);
    console.log(`🌐 Puerto: ${PORT}`);
    console.log(`🔧 Panel Admin: https://envio.chetomi.cl/admin`);
    console.log(`⏰ Zona horaria: America/Santiago`);
    console.log(`📋 Servicios configurados:`);
    Object.keys(SHIPPING_CONFIG.services).forEach(serviceCode => {
      const service = SHIPPING_CONFIG.services[serviceCode];
      console.log(`   ${service.name}: ${service.available_hours.start}-${service.available_hours.end} (${service.enabled ? 'ON' : 'OFF'})`);
    });
    console.log(`====================================`);
  });
});
