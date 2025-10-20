import os

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'defaultsecret')
    SQLALCHEMY_DATABASE_URI = (
        f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
        f"@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT', 5432)}/{os.getenv('POSTGRES_DB')}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    OPENROUTESERVICE_API_KEY = os.getenv('OPENROUTESERVICE_API_KEY', '')
