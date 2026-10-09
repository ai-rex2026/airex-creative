#!/bin/sh
# MEO運用を「分析」から「店舗」基準へ移す機械的な変換（リポジトリ直下で実行）
set -e
mkdir -p app/stores
git mv 'app/analysis/[id]/meo' 'app/stores/[id]'
sed -i 's/analysis_id/store_id/g' lib/meo-ops/daily.ts lib/meo-ops/ai-search.ts lib/meo-ops/workspace.ts lib/gbp/sync.ts app/api/cron/meo-ai-search/route.ts app/meo-actions.ts
FILES=$(grep -rl analysisId lib/meo-ops lib/gbp/sync.ts app/meo-actions.ts components/meo 'app/stores/[id]' | grep -v MeoEntryCard)
sed -i 's/analysisId/storeId/g' $FILES
sed -i 's/from("analyses")/from("stores")/g' lib/meo-ops/daily.ts lib/meo-ops/workspace.ts app/meo-actions.ts lib/gbp/oauth.ts app/api/cron/meo-ai-search/route.ts
