#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PORT=3030

# Prefer NEXT_PUBLIC_APP_URL from .env.local so the tunnel domain stays in sync
# with what the TwiML App / webhooks already point at. Falls back to the
# placeholder if the file is missing or the var is unset.
NGROK_DOMAIN="your-subdomain.ngrok.io"
if [ -f ".env.local" ]; then
    ENV_URL=$(grep -E '^NEXT_PUBLIC_APP_URL=' .env.local | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -n "$ENV_URL" ]; then
        NGROK_DOMAIN=$(echo "$ENV_URL" | sed -E 's|^https?://||; s|/.*$||')
    fi
fi

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Betwext Conversation AI Demo - Launcher      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"

    # Kill all child processes
    if [ ! -z "$NEXTJS_PID" ]; then
        echo -e "${YELLOW}Stopping Next.js server (PID: $NEXTJS_PID)...${NC}"
        kill $NEXTJS_PID 2>/dev/null
    fi

    if [ ! -z "$NGROK_PID" ]; then
        echo -e "${YELLOW}Stopping ngrok tunnel (PID: $NGROK_PID)...${NC}"
        kill $NGROK_PID 2>/dev/null
    fi

    # Additional cleanup - kill any remaining processes on port
    lsof -ti:$PORT | xargs kill -9 2>/dev/null
    pkill -f "ngrok http" 2>/dev/null

    echo -e "${GREEN}Cleanup complete. Goodbye!${NC}"
    exit 0
}

# Set up trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ Error: ngrok is not installed${NC}"
    echo -e "${YELLOW}Install it from: https://ngrok.com/download${NC}"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js is not installed${NC}"
    exit 1
fi

# Kill any existing processes on the port
echo -e "${YELLOW}🧹 Cleaning up existing processes...${NC}"
lsof -ti:$PORT | xargs kill -9 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
sleep 1

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo -e "${RED}❌ Error: .env.local file not found${NC}"
    echo -e "${YELLOW}Please create .env.local with your Twilio credentials${NC}"
    exit 1
fi

# Step 1: Start Next.js dev server
echo -e "${BLUE}📦 Step 1: Starting Next.js dev server on port $PORT...${NC}"
npm run dev > /tmp/nextjs.log 2>&1 &
NEXTJS_PID=$!
echo -e "${GREEN}✅ Next.js server started (PID: $NEXTJS_PID)${NC}"

# Wait for Next.js to be ready
echo -e "${YELLOW}⏳ Waiting for Next.js to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:$PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Next.js is ready!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Check if Next.js started successfully
if ! curl -s http://localhost:$PORT > /dev/null 2>&1; then
    echo -e "${RED}❌ Failed to start Next.js server${NC}"
    echo -e "${YELLOW}Check logs: tail -f /tmp/nextjs.log${NC}"
    exit 1
fi

# Step 2: Start ngrok tunnel
echo -e "${BLUE}📡 Step 2: Starting ngrok tunnel with domain $NGROK_DOMAIN...${NC}"
ngrok http $PORT --domain=$NGROK_DOMAIN --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
echo -e "${GREEN}✅ ngrok tunnel started (PID: $NGROK_PID)${NC}"

# Wait for ngrok to be ready
echo -e "${YELLOW}⏳ Waiting for ngrok tunnel to establish...${NC}"
sleep 3

# Verify ngrok is running
if ! curl -s http://localhost:4040/api/tunnels > /dev/null 2>&1; then
    echo -e "${RED}❌ Failed to start ngrok tunnel${NC}"
    echo -e "${YELLOW}Check logs: tail -f /tmp/ngrok.log${NC}"
    exit 1
fi

# Get ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}❌ Could not retrieve ngrok URL${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ngrok tunnel established!${NC}"
echo ""

# Display information
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            🚀 ALL SERVICES RUNNING             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📱 Local Development:${NC}"
echo -e "   http://localhost:$PORT"
echo ""
echo -e "${BLUE}🌐 Public URL (Twilio):${NC}"
echo -e "   $NGROK_URL"
echo ""
echo -e "${BLUE}🔧 ngrok Dashboard:${NC}"
echo -e "   http://localhost:4040"
echo ""
echo -e "${BLUE}📊 Service Status:${NC}"
echo -e "   Next.js PID: ${GREEN}$NEXTJS_PID${NC}"
echo -e "   ngrok PID:   ${GREEN}$NGROK_PID${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}⚙️  Twilio Configuration Required:${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}Set your Messaging Service Inbound Request URL to:${NC}"
echo -e "${GREEN}$NGROK_URL/api/rcs-inbound${NC}"
echo ""
echo -e "${BLUE}Console URL:${NC}"
echo -e "https://console.twilio.com/us1/develop/sms/services"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}💡 Tips:${NC}"
echo -e "   • Open http://localhost:$PORT in your browser"
echo -e "   • View ngrok traffic at http://localhost:4040"
echo -e "   • Press Ctrl+C to stop all services"
echo ""
echo -e "${BLUE}📝 Logs:${NC}"
echo -e "   Next.js: tail -f /tmp/nextjs.log"
echo -e "   ngrok:   tail -f /tmp/ngrok.log"
echo ""
echo -e "${GREEN}✨ Ready — voice agent takes the call, this app handles Airtable + RCS.${NC}"
echo ""

# Keep script running and show live logs
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📋 Live Logs (Ctrl+C to stop):${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Tail both logs
tail -f /tmp/nextjs.log /tmp/ngrok.log
