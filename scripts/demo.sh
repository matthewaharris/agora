#!/usr/bin/env bash
# =============================================================================
# OACP Demo Runner
#
# Runs the full PRD Section 7 demo:
# 1. Builds the SDK
# 2. Installs agent dependencies
# 3. Starts research-agent in background
# 4. Runs extraction-agent (discovers, delegates, receives result)
#
# Prerequisites:
#   - Node.js >= 20
#   - SUPABASE_URL and SUPABASE_ANON_KEY set (or in .env files)
#   - Supabase project with migrations applied
#
# Usage:
#   ./scripts/demo.sh
#   # Or with env vars:
#   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... ./scripts/demo.sh
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

RESEARCH_PID=""

cleanup() {
  if [ -n "$RESEARCH_PID" ]; then
    echo -e "\n${YELLOW}Stopping research-agent (PID: ${RESEARCH_PID})...${NC}"
    kill "$RESEARCH_PID" 2>/dev/null || true
    wait "$RESEARCH_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

# =============================================================================
# Prerequisites Check
# =============================================================================
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  OACP Demo — Open Agent Communication Protocol${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}\n"

echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js not found. Install Node.js >= 20${NC}"
  exit 1
fi
echo -e "  ✅ Node.js $(node -v)"

if ! command -v npx &> /dev/null; then
  echo -e "${RED}❌ npx not found${NC}"
  exit 1
fi
echo -e "  ✅ npx available"

# Check for Supabase credentials
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  # Try to load from agent .env files
  if [ -f "agents/research-agent/.env" ]; then
    echo -e "  📄 Loading credentials from agents/research-agent/.env"
    export $(grep -v '^#' agents/research-agent/.env | xargs)
  fi
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo -e "${RED}❌ SUPABASE_URL and SUPABASE_ANON_KEY must be set${NC}"
  echo -e "   Set them as environment variables or in agents/research-agent/.env"
  exit 1
fi
echo -e "  ✅ Supabase credentials found"
echo -e "     URL: ${SUPABASE_URL}"

# =============================================================================
# Install Agent Dependencies
# =============================================================================
echo -e "\n${BLUE}Installing agent dependencies...${NC}"
cd agents/research-agent && npm install --silent 2>&1 | tail -1 && cd ../..
cd agents/extraction-agent && npm install --silent 2>&1 | tail -1 && cd ../..
echo -e "  ✅ Dependencies installed"

# =============================================================================
# Copy .env to agents if not present
# =============================================================================
for agent_dir in agents/research-agent agents/extraction-agent; do
  if [ ! -f "${agent_dir}/.env" ]; then
    echo "SUPABASE_URL=${SUPABASE_URL}" > "${agent_dir}/.env"
    echo "SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}" >> "${agent_dir}/.env"
    echo -e "  📝 Created ${agent_dir}/.env"
  fi
done

# =============================================================================
# Start Research Agent (background)
# =============================================================================
echo -e "\n${BLUE}Starting research-agent...${NC}"
cd agents/research-agent
npx tsx index.ts &
RESEARCH_PID=$!
cd ../..
echo -e "  🔬 Research agent started (PID: ${RESEARCH_PID})"

# Wait for registration
echo -e "  ⏳ Waiting for registration..."
sleep 4

# =============================================================================
# Run Extraction Agent (foreground)
# =============================================================================
echo -e "\n${BLUE}Starting extraction-agent...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}\n"

cd agents/extraction-agent
npx tsx index.ts
EXIT_CODE=$?
cd ../..

# =============================================================================
# Summary
# =============================================================================
echo -e "\n${CYAN}═══════════════════════════════════════════════${NC}"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "${GREEN}  ✅ Demo completed successfully!${NC}"
  echo -e ""
  echo -e "  To see the dashboard: npm run dashboard"
  echo -e "  Then open http://localhost:3000"
else
  echo -e "${RED}  ❌ Demo failed (exit code: ${EXIT_CODE})${NC}"
fi
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"

exit $EXIT_CODE
