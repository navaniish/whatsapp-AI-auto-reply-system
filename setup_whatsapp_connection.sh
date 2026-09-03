#!/bin/bash

EVOLUTION_URL="http://localhost:8080"
API_KEY="my_super_secret_evolution_key_123"
INSTANCE_NAME="personal_whatsapp"

echo "========================================================================"
echo "📱 CONNECTING PERSONAL WHATSAPP TO AI AGENT SYSTEM"
echo "========================================================================"
echo ""

# 1. Start Docker Containers
echo "1. Starting Docker Containers (Evolution API + Postgres + Redis)..."
docker-compose up -d

echo "Waiting 5 seconds for services to initialize..."
sleep 5

# 2. Create Instance
echo ""
echo "2. Creating WhatsApp Instance: $INSTANCE_NAME..."
curl -s -X POST "$EVOLUTION_URL/instance/create" \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"instanceName\": \"$INSTANCE_NAME\",
    \"qrcode\": true,
    \"integration\": \"WHATSAPP-BAILEYS\"
  }"

echo ""
echo "------------------------------------------------------------------------"
echo "📲 SCAN QR CODE TO LINK YOUR WHATSAPP:"
echo "1. Open WhatsApp on your phone"
echo "2. Go to Settings / Menu -> Linked Devices -> Link a Device"
echo "3. Open this URL in your browser to view the QR Code:"
echo "   👉 $EVOLUTION_URL/instance/connect/$INSTANCE_NAME"
echo "------------------------------------------------------------------------"
echo ""

# 3. Configure Webhook
echo "3. Configuring Webhook Destination to http://localhost:3000/v1/meta/webhooks/whatsapp..."
curl -s -X POST "$EVOLUTION_URL/webhook/set/$INSTANCE_NAME" \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "http://host.docker.internal:3000/v1/meta/webhooks/whatsapp",
      "byEvents": false,
      "base64": false,
      "events": [
        "MESSAGES_UPSERT"
      ]
    }
  }'

echo ""
echo "========================================================================"
echo "✅ WHATSAPP SETUP COMPLETE!"
echo "Now run 'npm run dev' to start the AI Agent Server!"
echo "========================================================================"
