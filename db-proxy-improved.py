#!/usr/bin/env python3
"""
Improved Database Proxy Service
Runs on VPN server to provide database access to Cloud Run
"""

import socket
import threading
import time
import logging
import select
import os

# Load environment variables from .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not available in production, environment variables set by platform
    pass

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration from environment variables
PROXY_HOST = os.environ.get('PROXY_HOST', '0.0.0.0')
PROXY_PORT = int(os.environ.get('PROXY_PORT', 5433))
TARGET_HOST = os.environ.get('PROXY_TARGET_HOST')
TARGET_PORT = int(os.environ.get('PROXY_TARGET_PORT', 5432))
BUFFER_SIZE = 4096

# Validate required environment variables
if not TARGET_HOST:
    raise ValueError("PROXY_TARGET_HOST environment variable is required")

logger.info(f"✅ Proxy configuration loaded from environment variables")
logger.info(f"Proxy: {PROXY_HOST}:{PROXY_PORT} -> {TARGET_HOST}:{TARGET_PORT}")

def handle_client(client_socket, client_address):
    """Handle a client connection with improved error handling"""
    logger.info(f"New connection from {client_address}")
    target_socket = None
    
    try:
        # Set socket timeouts
        client_socket.settimeout(30)
        
        # Connect to the target database
        target_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target_socket.settimeout(30)
        target_socket.connect((TARGET_HOST, TARGET_PORT))
        logger.info(f"Connected to target database {TARGET_HOST}:{TARGET_PORT}")
        
        # Use select for non-blocking I/O
        sockets = [client_socket, target_socket]
        
        while True:
            # Wait for data on either socket
            ready_sockets, _, error_sockets = select.select(sockets, [], sockets, 1.0)
            
            if error_sockets:
                logger.error(f"Socket error detected for {client_address}")
                break
                
            for sock in ready_sockets:
                try:
                    data = sock.recv(BUFFER_SIZE)
                    if not data:
                        logger.info(f"Connection closed by {'client' if sock == client_socket else 'target'}")
                        return
                    
                    # Forward data to the other socket
                    if sock == client_socket:
                        target_socket.send(data)
                        logger.debug(f"Forwarded {len(data)} bytes client->target")
                    else:
                        client_socket.send(data)
                        logger.debug(f"Forwarded {len(data)} bytes target->client")
                        
                except socket.timeout:
                    continue
                except Exception as e:
                    logger.error(f"Error forwarding data: {e}")
                    return
                    
    except Exception as e:
        logger.error(f"Error handling client {client_address}: {e}")
    finally:
        # Clean up connections
        try:
            if target_socket:
                target_socket.close()
        except:
            pass
        try:
            client_socket.close()
        except:
            pass
        logger.info(f"Connection from {client_address} closed")

def test_database_connection():
    """Test if we can connect to the database"""
    try:
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.settimeout(5)
        test_socket.connect((TARGET_HOST, TARGET_PORT))
        test_socket.close()
        logger.info(f"✅ Database {TARGET_HOST}:{TARGET_PORT} is reachable")
        return True
    except Exception as e:
        logger.error(f"❌ Cannot reach database {TARGET_HOST}:{TARGET_PORT}: {e}")
        return False

def main():
    """Main proxy server"""
    logger.info(f"Starting improved database proxy server on {PROXY_HOST}:{PROXY_PORT}")
    logger.info(f"Forwarding to {TARGET_HOST}:{TARGET_PORT}")
    
    # Test database connection first
    if not test_database_connection():
        logger.error("Cannot reach target database. Exiting.")
        return
    
    # Create server socket
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        server_socket.bind((PROXY_HOST, PROXY_PORT))
        server_socket.listen(10)
        logger.info("Proxy server listening for connections...")
        
        while True:
            try:
                client_socket, client_address = server_socket.accept()
                
                # Handle each client in a separate thread
                client_thread = threading.Thread(
                    target=handle_client, 
                    args=(client_socket, client_address)
                )
                client_thread.daemon = True
                client_thread.start()
                
            except Exception as e:
                logger.error(f"Error accepting connection: {e}")
                time.sleep(1)
                
    except KeyboardInterrupt:
        logger.info("Shutting down proxy server...")
    except Exception as e:
        logger.error(f"Server error: {e}")
    finally:
        server_socket.close()

if __name__ == "__main__":
    main() 