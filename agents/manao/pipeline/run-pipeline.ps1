# run-pipeline.ps1 — AI News Pipeline
# รันโดย Windows Task Scheduler ทุก 6 ชั่วโมง (00:00, 06:00, 12:00, 18:00)

$projectDir = "C:\Users\lenovo3\agent\shopee-affiliate\agents\manao\pipeline"
$logFile    = Join-Path $projectDir "pipeline.log"
$nodeCMD    = Get-Command node -ErrorAction SilentlyContinue
$node       = if ($nodeCMD) { $nodeCMD.Source } else { "C:\Program Files\nodejs\node.exe" }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    $line | Out-File $logFile -Append -Encoding utf8
}

Set-Location $projectDir

Log "=== เริ่ม Pipeline ==="

# ── Step 1: ดึงข่าว (scrape.js) ───────────────────────────────────────────────
Log "[1/4] กำลังดึงข่าวจาก Reuters..."
$r1 = & $node scrape.js 2>&1
$r1 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) {
    Log "[ERROR] scrape.js ล้มเหลว (exit $LASTEXITCODE)"
    exit 1
}

# ── Step 2: กรองข่าว (filter-agent.js) ────────────────────────────────────────
Log "[2/4] กำลังกรองและให้คะแนนข่าว..."
$r2 = & $node (Join-Path "agents" "filter-agent.js") 2>&1
$r2 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) {
    Log "[ERROR] filter-agent.js ล้มเหลว (exit $LASTEXITCODE)"
    exit 1
}

# ── Step 3: เขียน master.md (editor-agent.js) ─────────────────────────────────
Log "[3/4] กำลังเขียน content ภาษาไทย..."
$r3 = & $node (Join-Path "agents" "editor-agent.js") 2>&1
$r3 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) {
    Log "[ERROR] editor-agent.js ล้มเหลว (exit $LASTEXITCODE)"
    exit 1
}

# ── Step 4: สร้าง content ต่อ platform + ส่ง Telegram รอ approve ──────────────
Log "[4/4] กำลังสร้าง content FB/IG/X + ส่งขอ approve ใน Telegram..."
$r4 = & $node (Join-Path "agents" "formatter-agent.js") 2>&1
$r4 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) {
    Log "[ERROR] formatter-agent.js ล้มเหลว (exit $LASTEXITCODE)"
    exit 1
}

# ── Step 5: สรุปผลส่ง Telegram ────────────────────────────────────────────────
Log "[5/5] กำลังส่งสรุปผลไปยัง Telegram..."
$r5 = & $node summary.js 2>&1
$r5 | ForEach-Object { Log "  $_" }
if ($LASTEXITCODE -ne 0) {
    Log "[WARN] summary.js ล้มเหลว (exit $LASTEXITCODE) — pipeline ยังสำเร็จ"
}

Log "=== Pipeline เสร็จแล้ว — รอ approve ใน Telegram ===`n"
exit 0
