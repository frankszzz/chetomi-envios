import requests
from flask import current_app

def calcular_distancia(origen, destino):
    """
    Usa OpenRouteService para calcular distancia en km entre dos puntos.
    origen y destino deben ser dicts con llaves 'lat' y 'lng' o strings con coordenadas.
    """
    api_key = current_app.config.get('OPENROUTESERVICE_API_KEY')
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    headers = {
        'Authorization': api_key,
        'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8'
    }

    if isinstance(origen, dict) and isinstance(destino, dict):
        coords = [[origen['lng'], origen['lat']], [destino['lng'], destino['lat']]]
    else:
        raise ValueError("Origen y destino deben ser dicts con lat y lng")

    body = {"coordinates": coords}
    try:
        response = requests.post(url, json=body, headers=headers)
        response.raise_for_status()
        data = response.json()
        distancia_m = data['features'][0]['properties']['segments'][0]['distance']
        distancia_km = distancia_m / 1000.0
        return round(distancia_km, 2)
    except Exception as e:
        current_app.logger.error(f"Error al calcular distancia: {e}")
        return None
