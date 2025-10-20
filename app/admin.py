from flask import Blueprint, render_template

admin_bp = Blueprint('admin', __name__)

@admin_bp.route('/admin/panel')
def panel():
    return render_template('admin_panel.html')
