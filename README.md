# CER Exchange Data API - Complete Deployment Guide

This guide provides step-by-step instructions for deploying the CER Exchange Data API system from scratch, including VPN setup, database connectivity, and Google Cloud integration.

## Prerequisites

- Google Cloud Platform account with billing enabled
- AWS RDS database access credentials
- WireGuard VPN configuration (provided separately)
- Python 3.8+ installed locally
- Google Cloud SDK installed

### Required Credentials

Before starting, ensure you have the following credentials:

- **API Key**: Authentication key for your API (`[YOUR_API_KEY]`)
- **Database Credentials**:
  - Hostname: `[YOUR_DB_HOSTNAME]` (AWS RDS endpoint)
  - Port: `5432` (standard PostgreSQL port)
  - Database name: `[YOUR_DB_NAME]`
  - Username: `[YOUR_DB_USERNAME]` (read-only user recommended)
  - Password: `[YOUR_DB_PASSWORD]`
- **WireGuard VPN Configuration**:
  - Private key: `[YOUR_WG_PRIVATE_KEY]`
  - Address: `[YOUR_WG_ADDRESS]` (e.g., `172.16.2.16/32`)
  - DNS: `[YOUR_WG_DNS]` (e.g., `10.20.0.2`)
  - Public key: `[YOUR_WG_PUBLIC_KEY]`
  - Allowed IPs: `[YOUR_ALLOWED_IPS]` (e.g., `172.16.2.0/24, 10.20.0.0/16`)
  - Endpoint: `[YOUR_WG_ENDPOINT]` (e.g., `vpn.example.com:51821`)
- **Google Cloud Project ID**: `[YOUR_PROJECT_ID]`

## Phase 1: Environment Setup

### 1.1 Local Development Setup

```bash
# Clone repository
git clone <repository-url>
cd ImprovementReport

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create local environment file (use your actual credentials)
ecat > .env << EOF
API_KEY=[YOUR_API_KEY]
DB_HOST=[VM_EXTERNAL_IP]
DB_PORT=5433
DB_NAME=[DB_NAME]
DB_USER=[DB_USERNAME]
DB_PASSWORD=[DB_PASSWORD]
EOF
```

### 1.2 Google Cloud Project Setup

```bash
# Set project (replace with your project ID)
gcloud config set project [YOUR_PROJECT_ID]

# Enable required APIs
gcloud services enable compute.googleapis.com
gcloud services enable appengine.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

## Phase 2: VPN Infrastructure Setup

### 2.1 Create Google Cloud VM

```bash
# Create VM instance
gcloud compute instances create cer-database-proxy \
    --zone=us-central1-a \
    --machine-type=e2-micro \
    --subnet=default \
    --network-tier=PREMIUM \
    --image-family=ubuntu-2004-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=10GB \
    --boot-disk-type=pd-standard \
    --tags=database-proxy

# Create firewall rule for database proxy
gcloud compute firewall-rules create allow-database-proxy \
    --allow tcp:5433 \
    --source-ranges 0.0.0.0/0 \
    --target-tags database-proxy \
    --description "Allow access to database proxy on port 5433"
```

### 2.2 Install WireGuard on VM

```bash
# Connect to VM and install WireGuard
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo apt update && 
sudo apt install -y wireguard resolvconf
"
```

### 2.3 Configure WireGuard VPN

```bash
# Create WireGuard configuration
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
echo '[Interface]' | sudo tee /etc/wireguard/wg0.conf
echo 'PrivateKey = MBwdBfPGmG0zMtOHu+tNVtfxJyQV82WqJ2WI/Vga+XI=' | sudo tee -a /etc/wireguard/wg0.conf
echo 'Address = 172.16.2.16/32' | sudo tee -a /etc/wireguard/wg0.conf
echo 'DNS = 10.20.0.2' | sudo tee -a /etc/wireguard/wg0.conf
echo 'MTU = 1280' | sudo tee -a /etc/wireguard/wg0.conf
echo '' | sudo tee -a /etc/wireguard/wg0.conf
echo '[Peer]' | sudo tee -a /etc/wireguard/wg0.conf
echo 'PublicKey = nwLc8TQAlghY7/3zGc6qAkNSsAq0uCKvSAVUn4draGg=' | sudo tee -a /etc/wireguard/wg0.conf
echo 'AllowedIPs = 172.16.2.0/24, 10.20.0.0/16' | sudo tee -a /etc/wireguard/wg0.conf
echo 'Endpoint = 34.248.191.172:51821' | sudo tee -a /etc/wireguard/wg0.conf
echo 'PersistentKeepalive = 20' | sudo tee -a /etc/wireguard/wg0.conf
"
```

### 2.4 Start WireGuard Service

```bash
# Set permissions and start WireGuard
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0
"
```

### 2.5 Verify VPN Connection

```bash
# Check WireGuard status
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo wg show
"

# Test database connectivity
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
python3 -c 'import socket; s = socket.socket(); s.settimeout(5); s.connect((\"haas-prod-cer.cdby5g3hvhmj.eu-west-1.rds.amazonaws.com\", 5432)); print(\"✅ Database accessible\"); s.close()'
"
```

## Phase 3: Database Proxy Setup

### 3.1 Upload Database Proxy Script

```bash
# Copy database proxy script to VM
gcloud compute scp db-proxy-improved.py cer-database-proxy:~/ --zone=us-central1-a
```

### 3.2 Create Systemd Service

```bash
# Create systemd service for database proxy
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo tee /etc/systemd/system/db-proxy.service > /dev/null <<EOF
[Unit]
Description=Database Proxy Service
After=network.target wg-quick@wg0.service
Requires=wg-quick@wg0.service

[Service]
Type=simple
User=root
WorkingDirectory=/home/cezugo
ExecStart=/usr/bin/python3 /home/cezugo/db-proxy-improved.py
Restart=always
RestartSec=10
Environment=PROXY_HOST=0.0.0.0
Environment=PROXY_PORT=5433
Environment=PROXY_TARGET_HOST=[YOUR_DB_HOSTNAME]
Environment=PROXY_TARGET_PORT=5432

[Install]
WantedBy=multi-user.target
EOF
"
```

### 3.3 Start Database Proxy Service

```bash
# Enable and start database proxy
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo systemctl enable db-proxy
sudo systemctl start db-proxy
sudo systemctl status db-proxy
"
```

### 3.4 Get VM External IP

```bash
# Get VM external IP for configuration
VM_IP=$(gcloud compute instances describe cer-database-proxy --zone=us-central1-a --format="get(networkInterfaces[0].accessConfigs[0].natIP)")
echo "VM External IP: $VM_IP"
```

## Phase 4: Google Cloud Secret Manager Setup

### 4.1 Create Secrets

```bash
# Create all required secrets (use your actual credentials)
echo -n "[YOUR_API_KEY]" | gcloud secrets create api-key --data-file=-
echo -n "$VM_IP" | gcloud secrets create db-host --data-file=-
echo -n "5433" | gcloud secrets create db-port --data-file=-
echo -n "[YOUR_DB_NAME]" | gcloud secrets create db-name --data-file=-
echo -n "[YOUR_DB_USER]" | gcloud secrets create db-user --data-file=-
echo -n "[YOUR_DB_PASSWORD]" | gcloud secrets create db-password --data-file=-
```

### 4.2 Grant App Engine Access to Secrets

```bash
# Get project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant App Engine service account access to secrets
for secret in api-key db-host db-port db-name db-user db-password; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 4.3 Verify Secret Access

```bash
# Test secret access
gcloud secrets versions access latest --secret=api-key
gcloud secrets versions access latest --secret=db-host
```

## Phase 5: API Deployment

### 5.1 Test Local API (Optional)

```bash
# Test locally before deployment
python app.py

# In another terminal, test endpoints
curl http://localhost:8000/health
curl -H "X-API-Key: [YOUR_API_KEY]" http://localhost:8000/api/v1/exchange-scores
```

### 5.2 Deploy to App Engine

```bash
# Deploy to Google App Engine
gcloud app deploy --quiet

# Get deployment URL
APP_URL=$(gcloud app describe --format="value(defaultHostname)")
echo "API deployed to: https://$APP_URL"
```

## Phase 6: Verification & Testing

### 6.1 Test API Endpoints

```bash
# Test health endpoint
curl -H "X-API-Key: [YOUR_API_KEY]" "https://$APP_URL/health"

# Expected response: {"database":"connected","status":"healthy"}

# Test exchange data endpoint
curl -H "X-API-Key: [YOUR_API_KEY]" "https://$APP_URL/api/v1/exchange-scores" | head -20

# Expected: JSON data with 230+ exchange records
```

### 6.2 Verify Infrastructure Status

```bash
# Check WireGuard VPN status
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo wg show"

# Check database proxy service
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo systemctl status db-proxy"

# Check VM connectivity to database
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
python3 -c 'import socket; s = socket.socket(); s.settimeout(5); s.connect((\"[YOUR_DB_HOSTNAME]\", 5432)); print(\"✅ Database accessible\"); s.close()'
"
```

## Phase 7: Google Sheets Integration

### 7.1 API Configuration for Sheets

Your API is now ready for Google Sheets integration with these details:

- **API URL**: `https://[YOUR_PROJECT_ID].uc.r.appspot.com/api/v1/exchange-scores`
- **API Key**: `[YOUR_API_KEY]`
- **Authentication**: Add header `X-API-Key: [YOUR_API_KEY]`

### 7.2 Google Apps Script Example

```javascript
function refreshExchangeData() {
  const apiUrl = 'https://[YOUR_PROJECT_ID].uc.r.appspot.com/api/v1/exchange-scores';
  const apiKey = '[YOUR_API_KEY]';
  
  const response = UrlFetchApp.fetch(apiUrl, {
    headers: {
      'X-API-Key': apiKey
    }
  });
  
  const data = JSON.parse(response.getContentText());
  
  if (data.success && data.data) {
    // Clear existing data and populate with fresh data
    const sheet = SpreadsheetApp.getActiveSheet();
    sheet.clear();
    
    // Add headers and data processing logic here
    console.log(`Successfully retrieved ${data.row_count} exchange records`);
  }
}
```

## Phase 8: Maintenance & Monitoring

### 8.1 Log Monitoring

```bash
# View App Engine logs
gcloud app logs tail -s default

# View VM system logs
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo journalctl -u db-proxy -f"

# View WireGuard logs
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo journalctl -u wg-quick@wg0 -f"
```

### 8.2 Credential Rotation

```bash
# Update API key (when needed)
NEW_API_KEY="your-new-api-key"
echo -n "$NEW_API_KEY" | gcloud secrets versions add api-key --data-file=-

# Update database password (when needed)
NEW_DB_PASSWORD="your-new-password"
echo -n "$NEW_DB_PASSWORD" | gcloud secrets versions add db-password --data-file=-

# Redeploy after credential changes
gcloud app deploy --quiet
```

### 8.3 Service Management

```bash
# Restart database proxy if needed
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo systemctl restart db-proxy"

# Restart WireGuard if needed
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo systemctl restart wg-quick@wg0"

# Check service status
gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
sudo systemctl status wg-quick@wg0
sudo systemctl status db-proxy
"
```

## Troubleshooting

### Common Issues and Solutions

1. **Database Connection Failed**
   ```bash
   # Check WireGuard connection
   gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="sudo wg show"
   
   # Restart services if needed
   gcloud compute ssh cer-database-proxy --zone=us-central1-a --command="
   sudo systemctl restart wg-quick@wg0
   sudo systemctl restart db-proxy
   "
   ```

2. **API Authentication Errors**
   ```bash
   # Verify API key in Secret Manager
   gcloud secrets versions access latest --secret=api-key
   
   # Test API key directly
   curl -H "X-API-Key: $(gcloud secrets versions access latest --secret=api-key)" "https://$APP_URL/health"
   ```

3. **VM Connection Issues**
   ```bash
   # Check VM status
   gcloud compute instances describe cer-database-proxy --zone=us-central1-a
   
   # Check firewall rules
   gcloud compute firewall-rules describe allow-database-proxy
   ```

## Success Indicators

Your deployment is successful when:

-  WireGuard shows active handshake: `latest handshake: X seconds ago`
-  Database proxy service is `active (running)`
-  Health endpoint returns: `{"database":"connected","status":"healthy"}`
-  Exchange endpoint returns 230+ records with `"success":true`
-  Google Sheets can successfully fetch data

---
