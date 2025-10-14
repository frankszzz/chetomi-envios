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
      available_hours: { start: '08:00', end: '15:00' },
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
    'https://admin.chetomi.cl'  // ← NUEVA LÍNEA
  ],
  methods: ['GET', 'POST', 'PUT'],  // ← Agregar PUT
  allowedHeaders: ['Content-Type', 'Authorization']
}));


// Rate limiting
const requestTimes = [];
const rateLimitMiddleware = (req, res, next) => {
  const now = Date.now();
  requestTimes.push(now);
  
  // Limpiar requests antiguos
  while (requestTimes[0] < now - 60000) {
    requestTimes.shift();
  }
  
  if (requestTimes.length > 35) {
    return res.status(429).json({ error: 'Rate limit excedido' });
  }
  
  next();
};

// Funciones de cálculo
function calculatePrice(distanceKm, serviceCode) {
  const service = SHIPPING_CONFIG.services[serviceCode];
  if (!service) return 0;
  
  for (const range of service.ranges) {
    if (distanceKm >= range.min && distanceKm < range.max) {
      return range.price;
    }
  }
  
  // Si no encuentra rango, usar el último
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

// Geocodificación y cálculo de distancia (mantener funciones anteriores)
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
    return 5; // Fallback
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

    // Generar tarifas para servicios activos
    Object.keys(SHIPPING_CONFIG.services).forEach(serviceCode => {
      const service = SHIPPING_CONFIG.services[serviceCode];
      
      if (!service.enabled) return;
      
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

// PANEL DE ADMINISTRACIÓN CON GESTIÓN DE PRECIOS
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - Chetomi Envíos</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f8f9fa; }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .tabs { display: flex; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .tab { flex: 1; padding: 15px 20px; cursor: pointer; border: none; background: white; font-size: 14px; font-weight: 500; }
        .tab.active { background: #007bff; color: white; }
        .tab-content { display: none; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .tab-content.active { display: block; }
        .service-card { border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .service-card.enabled { border-left: 4px solid #28a745; }
        .service-card.disabled { border-left: 4px solid #dc3545; opacity: 0.7; }
        .pricing-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .pricing-table th, .pricing-table td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
        .pricing-table th { background: #f8f9fa; font-weight: 600; }
        .pricing-table input { width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; }
        .form-group { margin: 15px 0; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 500; color: #495057; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 6px; font-size: 14px;
        }
        .btn { padding: 10px 20px; margin: 5px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; }
        .btn-primary { background: #007bff; color: white; }
        .btn-success { background: #28a745; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        .status { padding: 15px; margin: 15px 0; border-radius: 6px; font-weight: 500; }
        .status.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .status.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .range-row { display: grid; grid-template-columns: 1fr 1fr 1fr 60px; gap: 10px; align-items: center; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; }
        .range-controls { text-align: center; }
        .add-range-btn { background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin: 10px 0; }
        .service-status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .service-status.active { background: #d4edda; color: #155724; }
        .service-status.inactive { background: #f8d7da; color: #721c24; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛍️ Panel de Administración - Chetomi Envíos</h1>
            <p>Gestiona precios por kilómetros, horarios y configuración de entregas</p>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="showTab('pricing')">💰 Precios por Kilómetros</button>
            <button class="tab" onclick="showTab('services')">⚙️ Servicios</button>
            <button class="tab" onclick="showTab('schedule')">📅 Horarios</button>
            <button class="tab" onclick="showTab('settings')">🔧 Configuración</button>
        </div>

        <div id="pricing" class="tab-content active">
            <h2>🎯 Configuración de Precios por Rangos de Kilómetros</h2>
            <p>Define los rangos de distancia y precios para cada tipo de envío.</p>
            <div id="pricing-services"></div>
        </div>

        <div id="services" class="tab-content">
            <h2>⚙️ Configuración de Servicios</h2>
            <div id="services-list"></div>
        </div>

        <div id="schedule" class="tab-content">
            <h2>📅 Horarios y Calendario</h2>
            <div class="form-group">
                <h3>Días de la Semana Bloqueados</h3>
                <div id="weekdays-config"></div>
            </div>
        </div>

        <div id="settings" class="tab-content">
            <h2>🔧 Configuración General</h2>
            <div id="general-settings"></div>
        </div>

        <div id="status"></div>
    </div>

    <script>
        let config = {};

        function showTab(tabName) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById(tabName).classList.add('active');
            
            if (tabName === 'pricing') loadPricing();
            if (tabName === 'services') loadServices();
            if (tabName === 'schedule') loadSchedule();
            if (tabName === 'settings') loadSettings();
        }

        async function loadConfig() {
            try {
                const response = await fetch('/admin/config');
                config = await response.json();
            } catch (error) {
                showStatus('Error cargando configuración: ' + error.message, 'error');
            }
        }

        async function loadPricing() {
            await loadConfig();
            const container = document.getElementById('pricing-services');
            container.innerHTML = '';

            Object.keys(config.services).forEach(serviceCode => {
                const service = config.services[serviceCode];
                const serviceDiv = document.createElement('div');
                serviceDiv.className = 'service-card ' + (service.enabled ? 'enabled' : 'disabled');
                
                serviceDiv.innerHTML = \`
                    <h3>\${service.name} 
                        <span class="service-status \${service.enabled ? 'active' : 'inactive'}">
                            \${service.enabled ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                    </h3>
                    
                    <div id="ranges-\${serviceCode}">
                        <h4>Rangos de Precios por Kilómetros:</h4>
                        <div class="range-row" style="font-weight: bold; background: #007bff; color: white;">
                            <div>Desde (km)</div>
                            <div>Hasta (km)</div>
                            <div>Precio (CLP)</div>
                            <div>Acciones</div>
                        </div>
                        \${service.ranges.map((range, index) => \`
                            <div class="range-row">
                                <input type="number" value="\${range.min}" min="0" step="0.1" 
                                       onchange="updateRange('\${serviceCode}', \${index}, 'min', this.value)">
                                <input type="number" value="\${range.max === Infinity ? '999' : range.max}" min="0" step="0.1"
                                       onchange="updateRange('\${serviceCode}', \${index}, 'max', this.value === '999' ? Infinity : parseFloat(this.value))">
                                <input type="number" value="\${range.price}" min="0" step="100"
                                       onchange="updateRange('\${serviceCode}', \${index}, 'price', parseInt(this.value))">
                                <div class="range-controls">
                                    <button class="btn btn-danger" onclick="removeRange('\${serviceCode}', \${index})" 
                                            style="padding: 5px 10px; font-size: 12px;">🗑️</button>
                                </div>
                            </div>
                        \`).join('')}
                    </div>
                    
                    <button class="add-range-btn" onclick="addRange('\${serviceCode}')">➕ Agregar Rango</button>
                    <button class="btn btn-success" onclick="savePricing('\${serviceCode}')">💾 Guardar Precios</button>
                \`;
                
                container.appendChild(serviceDiv);
            });
        }

        async function updateRange(serviceCode, rangeIndex, field, value) {
            if (!config.services[serviceCode]) return;
            
            config.services[serviceCode].ranges[rangeIndex][field] = value;
            
            // Actualizar label automáticamente
            const range = config.services[serviceCode].ranges[rangeIndex];
            const maxLabel = range.max === Infinity ? '+' : \`-\${range.max}\`;
            range.label = \`\${range.min}\${maxLabel} km\`;
        }

        async function addRange(serviceCode) {
            if (!config.services[serviceCode]) return;
            
            const ranges = config.services[serviceCode].ranges;
            const lastRange = ranges[ranges.length - 1];
            const newMin = lastRange.max === Infinity ? lastRange.min + 5 : lastRange.max;
            
            ranges.splice(-1, 0, {
                min: newMin,
                max: newMin + 2,
                price: lastRange.price + 500,
                label: \`\${newMin}-\${newMin + 2} km\`
            });
            
            loadPricing();
        }

        async function removeRange(serviceCode, rangeIndex) {
            if (!config.services[serviceCode]) return;
            if (config.services[serviceCode].ranges.length <= 1) {
                showStatus('Debe haber al menos un rango de precios', 'error');
                return;
            }
            
            config.services[serviceCode].ranges.splice(rangeIndex, 1);
            loadPricing();
        }

        async function savePricing(serviceCode) {
            try {
                await fetch('/admin/update-ranges', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        serviceCode, 
                        ranges: config.services[serviceCode].ranges 
                    })
                });
                showStatus(\`Precios de \${config.services[serviceCode].name} guardados correctamente\`, 'success');
            } catch (error) {
                showStatus('Error guardando precios: ' + error.message, 'error');
            }
        }

        function loadServices() {
            // Implementar carga de servicios básica
            document.getElementById('services-list').innerHTML = '<p>Configuración básica de servicios...</p>';
        }

        function loadSchedule() {
            document.getElementById('weekdays-config').innerHTML = '<p>Configuración de horarios...</p>';
        }

        function loadSettings() {
            document.getElementById('general-settings').innerHTML = '<p>Configuración general...</p>';
        }

        function showStatus(message, type) {
            const status = document.getElementById('status');
            status.innerHTML = \`<div class="status \${type}">\${message}</div>\`;
            setTimeout(() => status.innerHTML = '', 5000);
        }

        // Cargar configuración inicial
        loadPricing();
    </script>
</body>
</html>
  `);
});

// ENDPOINTS DEL ADMIN
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

// Inicialización
loadConfig().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CHETOMI SHIPPING CALCULATOR CON GESTIÓN DE PRECIOS`);
    console.log(`🏪 Tienda: ${SHIPPING_CONFIG.store_info.name}`);
    console.log(`🌐 Puerto: ${PORT}`);
    console.log(`🔧 Panel Admin: https://envio.chetomi.cl/admin`);
    console.log(`💰 Rangos configurados por servicio:`);
    Object.keys(SHIPPING_CONFIG.services).forEach(serviceCode => {
      const service = SHIPPING_CONFIG.services[serviceCode];
      console.log(`   ${service.name}: ${service.ranges.length} rangos`);
    });
    console.log(`====================================`);
  });
});
