from flask import Blueprint, request, jsonify, render_template, redirect, url_for, session
from app import db
from app.models import User, Tarifa
from app.utils import login_required, validar_horario_envio, calcular_tarifa_por_km
from app.services import calcular_distancia

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    return redirect(url_for('main.login'))

@main_bp.route('/login', methods=['GET', 'POST'])
def login():
    # lógica de login usando session
    # ...
    return render_template('login.html')

@main_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('main.login'))

@main_bp.route('/admin')
@login_required
def admin_dashboard():
    # Mostrar dashboard admin con usuarios y tarifas
    # ...
    return render_template('admin.html')

@main_bp.route('/calculate-shipping')
def calculate_shipping():
    service = request.args.get('service', '')
    destino = request.args.get('destination', '')  # Por ejemplo: dirección o coordenadas
    # Lógica para devolver tarifa según km y horario
    # ...
    return jsonify({'precio': 3500, 'status': 'ok'})

@main_bp.route('/services')
def services():
    service = request.args.get('service', '')
    # Retornar lista de servicios activos según horario
    # ...
    return jsonify([{'service': service, 'name': 'Envío Programado'}])
