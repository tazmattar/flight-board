import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    AIRPORT_CODE = os.getenv('AIRPORT_CODE', 'LSZH')
    UPDATE_INTERVAL = int(os.getenv('UPDATE_INTERVAL', 60))
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'change-me')
    ADMIN_MAX_LOGIN_ATTEMPTS = int(os.getenv('ADMIN_MAX_LOGIN_ATTEMPTS', 5))
    ADMIN_LOGIN_WINDOW_SECONDS = int(os.getenv('ADMIN_LOGIN_WINDOW_SECONDS', 300))
    ADMIN_LOCKOUT_SECONDS = int(os.getenv('ADMIN_LOCKOUT_SECONDS', 900))
