import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    AIRPORT_CODE = os.getenv('AIRPORT_CODE', 'LSZH')
    UPDATE_INTERVAL = int(os.getenv('UPDATE_INTERVAL', 20))
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', 'admin')
    ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'change-me')
    ADMIN_MAX_LOGIN_ATTEMPTS = int(os.getenv('ADMIN_MAX_LOGIN_ATTEMPTS', 5))
    ADMIN_LOGIN_WINDOW_SECONDS = int(os.getenv('ADMIN_LOGIN_WINDOW_SECONDS', 300))
    ADMIN_LOCKOUT_SECONDS = int(os.getenv('ADMIN_LOCKOUT_SECONDS', 900))
    BUY_ME_A_COFFEE_URL = os.getenv('BUY_ME_A_COFFEE_URL', 'https://buymeacoffee.com/tazmattar').strip()
    TRACKING_EXCLUDE_IPS = {
        ip.strip() for ip in os.getenv(
            'TRACKING_EXCLUDE_IPS',
            '10.29.29.130,127.0.0.1,::1'
        ).split(',') if ip.strip()
    }
