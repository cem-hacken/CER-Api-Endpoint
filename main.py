#!/usr/bin/env python3
"""
Main entry point for Google Cloud Run
"""

import os
from app import app

if __name__ == '__main__':
    # Cloud Run provides the PORT environment variable
    port = int(os.environ.get('PORT', 8080))
    # Bind to all interfaces for Cloud Run
    app.run(host='0.0.0.0', port=port, debug=False) 