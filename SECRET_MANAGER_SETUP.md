# 🔐 Google Cloud Secret Manager Setup Guide

## 🎯 **Why Secret Manager is Perfect for Your Use Case**

✅ **Enterprise-grade security** - Encrypted at rest and in transit  
✅ **No credentials in source code** - Ever!  
✅ **Automatic fallback** - Uses .env for local development  
✅ **Version management** - Track secret changes  
✅ **Access control** - Fine-grained permissions  
✅ **Audit logging** - Know who accessed what when  
✅ **Easy rotation** - Update secrets without code changes  

---

## 🚀 **Step-by-Step Setup**

### **Step 1: Enable Secret Manager API**

```bash
# Enable the Secret Manager API
gcloud services enable secretmanager.googleapis.com
```

### **Step 2: Create Your Secrets**

```bash
# Create API key secret (use your actual credentials)
echo -n "[YOUR_API_KEY]" | \
  gcloud secrets create api-key --data-file=-

# Create database secrets (use your actual credentials)
echo -n "[VM_EXTERNAL_IP]" | gcloud secrets create db-host --data-file=-
echo -n "5433" | gcloud secrets create db-port --data-file=-
echo -n "[YOUR_DB_NAME]" | gcloud secrets create db-name --data-file=-
echo -n "[YOUR_DB_USERNAME]" | gcloud secrets create db-user --data-file=-
echo -n "[YOUR_DB_PASSWORD]" | gcloud secrets create db-password --data-file=-
```

### **Step 3: Verify Secrets Were Created**

```bash
# List all secrets
gcloud secrets list

# View a specific secret (metadata only)
gcloud secrets describe api-key
```

### **Step 4: Grant App Engine Access to Secrets**

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")

# Grant App Engine service account access to secrets
gcloud secrets add-iam-policy-binding api-key \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-host \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-port \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-name \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-user \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### **Step 5: Deploy Your Application**

```bash
# Simple deployment - no environment variables needed!
gcloud app deploy
```

---

## 🧪 **Testing**

### **Local Development**
Your `.env` file will still work for local testing:
```bash
python app.py
```

### **Production Testing**
```bash
# Test the deployed API
curl -H "X-API-Key: [YOUR_API_KEY]" \
  https://your-project-id.appspot.com/api/v1/exchange-scores

# Check health endpoint to verify Secret Manager integration
curl https://your-project-id.appspot.com/health
```

---

## 🔄 **Secret Rotation (Easy!)**

### **Rotate API Key:**
```bash
# Generate new API key
NEW_API_KEY=$(openssl rand -base64 32)

# Update the secret
echo -n "$NEW_API_KEY" | gcloud secrets versions add api-key --data-file=-

# Your app will automatically use the new key on next restart
gcloud app deploy
```

### **Rotate Database Password:**
```bash
# Update database password
echo -n "new-database-password" | gcloud secrets versions add db-password --data-file=-

# Redeploy to use new password
gcloud app deploy
```

---

## 🛡️ **Security Benefits**

### **What You Get:**
- ✅ **Zero secrets in source code**
- ✅ **Automatic encryption** (AES-256)
- ✅ **Access logging** - see who accessed what
- ✅ **Version history** - track all changes
- ✅ **Fine-grained permissions** - control who can access what
- ✅ **Regional replication** - high availability
- ✅ **Integration with IAM** - use existing Google Cloud permissions

### **Compliance:**
- ✅ **SOC 2 Type II** compliant
- ✅ **ISO 27001** certified
- ✅ **FIPS 140-2** Level 3 validated
- ✅ **GDPR** compliant

---

## 📊 **Monitoring & Alerting**

### **Set Up Alerts:**
```bash
# Create alert for secret access
gcloud alpha monitoring policies create --policy-from-file=secret-access-alert.yaml
```

### **View Access Logs:**
```bash
# See who accessed your secrets
gcloud logging read "resource.type=gce_instance AND protoPayload.serviceName=secretmanager.googleapis.com"
```

---

## 🚨 **Emergency Procedures**

### **If API Key is Compromised:**
```bash
# Immediately disable the current version
gcloud secrets versions disable 1 --secret=api-key

# Create new version
echo -n "new-secure-api-key" | gcloud secrets versions add api-key --data-file=-

# Redeploy
gcloud app deploy
```

### **If Database Credentials are Compromised:**
```bash
# Rotate all database secrets
echo -n "new-db-password" | gcloud secrets versions add db-password --data-file=-
echo -n "new-db-user" | gcloud secrets versions add db-user --data-file=-

# Redeploy
gcloud app deploy
```

---

## 💰 **Cost**

Secret Manager pricing is very reasonable:
- **$0.06 per 10,000 secret versions per month**
- **$0.03 per 10,000 access operations**

For your use case: **~$1-2 per month** total

---

## ✅ **Complete Setup Commands**

Run these commands in order:

```bash
# 1. Enable API
gcloud services enable secretmanager.googleapis.com

# 2. Create secrets
echo -n "[YOUR_API_KEY]" | gcloud secrets create api-key --data-file=-
echo -n "[VM_EXTERNAL_IP]" | gcloud secrets create db-host --data-file=-
echo -n "5433" | gcloud secrets create db-port --data-file=-
echo -n "[YOUR_DB_NAME]" | gcloud secrets create db-name --data-file=-
echo -n "[YOUR_DB_USERNAME]" | gcloud secrets create db-user --data-file=-
echo -n "[YOUR_DB_PASSWORD]" | gcloud secrets create db-password --data-file=-

# 3. Grant permissions
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
for secret in api-key db-host db-port db-name db-user db-password; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${PROJECT_NUMBER}@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# 4. Deploy
gcloud app deploy

# 5. Test
curl https://$(gcloud app describe --format="value(defaultHostname)")/health
```

---

## 🎉 **You're Done!**

Your application now uses **enterprise-grade secret management** with:
- ✅ No secrets in source code
- ✅ Automatic encryption
- ✅ Access logging
- ✅ Easy rotation
- ✅ High availability

**This is the gold standard for credential management in cloud applications!** 🏆 