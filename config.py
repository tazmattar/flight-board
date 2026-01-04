import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    AIRPORT_CODE = os.getenv('AIRPORT_CODE', 'LSZH')
    UPDATE_INTERVAL = int(os.getenv('UPDATE_INTERVAL', 60))
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
