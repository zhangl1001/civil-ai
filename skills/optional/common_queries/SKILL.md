---
name: common-queries
description: Direct API references for common data queries (weather, stock prices, IP, etc.) — faster and more reliable than web_search
tools: []
auto_load: false
---

# Common Data Queries

Use these direct APIs. Call each API **ONCE** only — do NOT retry with different parameters.

## Weather
```bash
curl -s "https://wttr.in/CITY?format=j1" | python3 -c "import sys,json; d=json.load(sys.stdin); c=d['current_condition'][0]; print(f\"天气:{c['weatherDesc'][0]['value']} 温度:{c['temp_C']}C 湿度:{c['humidity']}% 风:{c['windspeedKmph']}km/h\"); [print(f\"{x['date']} 高{x['maxtempC']}C 低{x['mintempC']}C\") for x in d['weather'][:3]]"
```
Always use `format=j1` for clean JSON. Do NOT use plain curl — default output has ANSI escape codes.

## Stock Prices (Sina Finance API)
```bash
curl -s -H "Referer: https://finance.sina.com.cn" "https://hq.sinajs.cn/list=sh000001" | iconv -f GBK -t UTF-8
```
- Code pattern: `sh`/`sz` + 6-digit code. Shanghai stocks start with `6`, Shenzhen with `0` or `3`
- US stocks: prefix with `gb_$`, e.g. `gb_$aapl`, `gb_$tsla`
- Multiple: comma-separated, e.g. `sh000001,sz399001`

## IP / Network
```bash
curl -s ifconfig.me
curl -s "ipinfo.io/json"
```

## Rules
- Weather/Stock/IP: use these direct APIs, call ONCE
- Articles/Docs/News: use web_search + fetch_page
