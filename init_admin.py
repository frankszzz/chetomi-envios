from app import create_app, db
from app.models import User

app = create_app()

with app.app_context():
    email = "franksmazagmail.com"
    password = "chetomi123"

    user = User.query.filter_by(email=email).first()
    if user:
        print(f"Usuario {email} ya existe.")
    else:
        print(f"Creando usuario admin {email}...")
        nuevo_admin = User(email=email, admin=True)
        nuevo_admin.set_password(password)
        db.session.add(nuevo_admin)
        db.session.commit()
        print("Usuario admin creado con éxito.")
