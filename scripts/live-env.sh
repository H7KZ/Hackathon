# Source before starting the API for a live or offline-replay run: pins every LLM step to one model,
# so per-step overrides elsewhere cannot change the cache keys (docs/runs/2026-11-28-live-e2e-3.md).
#   . scripts/live-env.sh            # model = anthropic:claude-sonnet-5-5
#   LIVE_MODEL=anthropic:claude-haiku-5-5 . scripts/live-env.sh
M="${LIVE_MODEL:-anthropic:claude-sonnet-5-5}"
export LLM_MODEL="$M"
for s in 01_COMPANY 02_MODEL 03_INFLUENCES 03A_CAUSAL_MAP 03B_PROCESSES 04A_OVERLAY 04B_EXPECTATIONS \
  04_STORY 05_SCENARIO WHAT_IF DETECTIVE_STEP DETECTIVE_REPORT; do
  export "LLM_MODEL_$s=$M"
done
