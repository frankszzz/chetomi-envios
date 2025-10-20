from functools import wraps
from flask import session, redirect, url_for, request
from datetime import datetime, time

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('main.login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function

def validar_horario_envio(service):
    """Valida si el envío está habilitado según el horario y tipo de servicio."""
    ahora = datetime.now().time()
    if service == 'HOY':
        return time(0, 1) <= ahora <= time(18, 0)
    elif service == 'SCHEDULED':
        return True
    return False

def calcular_tarifa_por_km(km):
    """Retorna el precio según el rango de km dado."""

    if 0 <= km <= 3:
        return 3500
    elif 3 < km <= 4:
        return 4500
    elif 4 < km <= 5:
        return 5000
    elif 5 < km <= 6:
        return 5500
    elif 6 < km <= 7:
        return 6500
    else:
        return None  # Fuera de rango para envío
