#!/usr/bin/env python3
"""
Exchange Data API Endpoint
Provides read-only access to exchange scores data for Google Sheets integration
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
import psycopg2.extras
from datetime import datetime
import os
import logging
from functools import wraps

# Load environment variables from .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not available in production, environment variables set by platform
    pass

# Google Cloud Secret Manager for production
try:
    from google.cloud import secretmanager
    SECRET_MANAGER_AVAILABLE = True
except ImportError:
    SECRET_MANAGER_AVAILABLE = False

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for Google Apps Script

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_secret(secret_name, project_id=None):
    """
    Retrieve a secret from Google Cloud Secret Manager
    Falls back to environment variables for local development
    """
    # First try environment variable (for local development)
    env_value = os.environ.get(secret_name.upper().replace('-', '_'))
    if env_value:
        logger.info(f"✅ Using environment variable for {secret_name}")
        return env_value
    
    # Try Google Cloud Secret Manager (for production)
    if SECRET_MANAGER_AVAILABLE:
        try:
            if not project_id:
                project_id = os.environ.get('GOOGLE_CLOUD_PROJECT')
            
            if project_id:
                client = secretmanager.SecretManagerServiceClient()
                name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
                response = client.access_secret_version(request={"name": name})
                secret_value = response.payload.data.decode("UTF-8")
                logger.info(f"✅ Retrieved {secret_name} from Secret Manager")
                return secret_value
        except Exception as e:
            logger.warning(f"Failed to retrieve {secret_name} from Secret Manager: {e}")
    
    # If all else fails, raise an error
    raise ValueError(f"Could not retrieve secret: {secret_name}")

# Secure configuration using Secret Manager
try:
    API_KEY = get_secret('api-key')
    DB_HOST = get_secret('db-host') 
    DB_PORT = int(get_secret('db-port'))
    DB_NAME = get_secret('db-name')
    DB_USER = get_secret('db-user')
    DB_PASSWORD = get_secret('db-password')
    
    logger.info("✅ All credentials loaded successfully")
    
except Exception as e:
    logger.error(f"❌ Failed to load credentials: {e}")
    raise

# Database configuration with read-only user via VPN proxy
DB_CONFIG = {
    'host': DB_HOST,
    'port': DB_PORT,
    'database': DB_NAME,
    'user': DB_USER,
    'password': DB_PASSWORD,
    'connect_timeout': 10,
}

# SQL Query
EXCHANGE_SCORES_QUERY = """
SELECT
    e.id            AS exchange_id,
    e.name          AS exchange_name,
    es.*            
FROM
    exchange AS e
INNER JOIN
    exchange_score AS es
        ON e.id = es.exchange_id
ORDER BY
    exchange_name;
"""

# SQL Query for Exchange Certificates
EXCHANGE_CERTIFICATES_QUERY = """
SELECT
    e.name          AS exchange_name,
    e.id            AS exchange_id,
    c.*             -- all columns from certificate
FROM
    exchange AS e
INNER JOIN
    exchange_certificate AS ec
    ON e.id = ec.exchange_id
INNER JOIN
    certificate AS c
    ON ec.certificate_id = c.id
WHERE
    c.name <> 'BUG_BOUNTY'
ORDER BY
    c.active_until ASC;
"""

def require_api_key(f):
    """Decorator to require API key for endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # API key check
        api_key = request.headers.get('X-API-Key')
        if api_key != API_KEY:
            logger.warning(f"Unauthorized access attempt from {request.remote_addr}")
            return jsonify({
                'success': False,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'error': {
                    'code': 'UNAUTHORIZED',
                    'message': 'Invalid or missing API key. Please provide X-API-Key header.'
                }
            }), 401
        return f(*args, **kwargs)
    return decorated_function

def get_db_connection():
    """Create and return a database connection"""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except psycopg2.Error as e:
        logger.error(f"Database connection failed: {e}")
        raise

@app.route('/', methods=['GET'])
def home():
    """Home endpoint with API information"""
    return jsonify({
        'service': 'Exchange Data API',
        'version': '1.0',
        'endpoints': {
            'exchange_scores': '/api/v1/exchange-scores',
            'exchange_certificates': '/api/v1/exchange-certificates',
            'health': '/health'
        },
        'documentation': 'Use X-API-Key header for authentication',
        'security': 'Credentials managed via Google Cloud Secret Manager'
    })

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        conn = get_db_connection()
        conn.close()
        db_status = 'connected'
    except:
        db_status = 'disconnected'
    
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'database': db_status,
        'api_version': '1.0',
        'secret_manager': SECRET_MANAGER_AVAILABLE
    })

@app.route('/api/v1/exchange-scores', methods=['GET'])
@require_api_key
def get_exchange_scores():
    """
    Fetch exchange scores from PostgreSQL database
    Returns JSON with exchange and score data
    """
    conn = None
    try:
        logger.info(f"API request from {request.remote_addr}")
        
        # Try to connect to database
        conn = get_db_connection()
        
        # Execute query with RealDictCursor for JSON-friendly output
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute(EXCHANGE_SCORES_QUERY)
            rows = cursor.fetchall()
        
        # Convert any datetime objects to ISO format strings
        for row in rows:
            for key, value in row.items():
                if isinstance(value, datetime):
                    row[key] = value.isoformat()
                elif value is None:
                    row[key] = ""  # Convert None to empty string for Google Sheets
        
        logger.info(f"Successfully retrieved {len(rows)} rows from database")
        
        return jsonify({
            'success': True,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'row_count': len(rows),
            'data': rows
        })
        
    except psycopg2.Error as e:
        logger.error(f"Database error: {e}")
        
        return jsonify({
            'success': False,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': {
                'code': 'DATABASE_ERROR',
                'message': f'Database error: {str(e)}'
            }
        }), 500
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({
            'success': False,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': 'An unexpected error occurred'
            }
        }), 500
        
    finally:
        if conn:
            conn.close()

@app.route('/api/v1/exchange-certificates', methods=['GET'])
@require_api_key
def get_exchange_certificates():
    """
    Fetch exchange certificates from PostgreSQL database
    Returns JSON with exchange and certificate data
    """
    conn = None
    try:
        logger.info(f"API request from {request.remote_addr}")
        
        # Try to connect to database
        conn = get_db_connection()
        
        # Execute query with RealDictCursor for JSON-friendly output
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
            cursor.execute(EXCHANGE_CERTIFICATES_QUERY)
            rows = cursor.fetchall()
        
        # Convert any datetime objects to ISO format strings
        for row in rows:
            for key, value in row.items():
                if isinstance(value, datetime):
                    row[key] = value.isoformat()
                elif value is None:
                    row[key] = ""  # Convert None to empty string for Google Sheets
        
        logger.info(f"Successfully retrieved {len(rows)} rows from database")
        
        return jsonify({
            'success': True,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'row_count': len(rows),
            'data': rows
        })
        
    except psycopg2.Error as e:
        logger.error(f"Database error: {e}")
        
        return jsonify({
            'success': False,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': {
                'code': 'DATABASE_ERROR',
                'message': f'Database error: {str(e)}'
            }
        }), 500
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({
            'success': False,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': 'An unexpected error occurred'
            }
        }), 500
        
    finally:
        if conn:
            conn.close()

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        'success': False,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'error': {
            'code': 'NOT_FOUND',
            'message': 'Endpoint not found'
        }
    }), 404

if __name__ == '__main__':
    # For local development
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=True)

