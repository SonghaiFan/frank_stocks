"""
Stock Narrative Tracking App — Backend
Run: python app.py
"""
import json
import os
from datetime import datetime, timezone, timedelta, time as dtime
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf

# US Eastern time offset (no DST handling — close enough for market hours check)
ET = timezone(timedelta(hours=-4))   # EDT (summer); use -5 for EST

def is_market_open():
    """Return True if US equity market is currently open (approx, ET)."""
    now_et = datetime.now(ET)
    if now_et.weekday() >= 5:
        return False
    t = now_et.time()
    return dtime(9, 30) <= t < dtime(16, 0)

# ── Price cache ────────────────────────────────────────────────────────────────
# Cache file: { "date": "YYYY-MM-DD", "data": { "<sym>|<period>": [...] } }
# Evicted automatically when calendar date changes.
# 1D (1m interval) and 5D (1h interval) are NOT cached — they need fresh data.
# ──────────────────────────────────────────────────────────────────────────────
CACHE_FILE = Path(__file__).parent / "price_cache.json"
_cache_date: str = ""        # the calendar date for which the cache is valid
_cache_data: dict = {}       # { "SYM|period": [bars...] }

CACHEABLE_PERIODS = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}

def _today_str() -> str:
    return datetime.now(ET).strftime("%Y-%m-%d")

def _load_cache():
    global _cache_date, _cache_data
    today = _today_str()
    if CACHE_FILE.exists():
        try:
            obj = json.loads(CACHE_FILE.read_text())
            if obj.get("date") == today:
                _cache_date = today
                _cache_data = obj.get("data", {})
                return
        except Exception:
            pass
    # Stale or missing — start fresh
    _cache_date = today
    _cache_data = {}
    _write_cache()

def _write_cache():
    CACHE_FILE.write_text(json.dumps({"date": _cache_date, "data": _cache_data}))

def cache_get(sym: str, period: str):
    if _cache_date != _today_str():
        _load_cache()
    return _cache_data.get(f"{sym}|{period}")

def cache_set(sym: str, period: str, bars: list):
    global _cache_date
    today = _today_str()
    if _cache_date != today:
        _load_cache()
    _cache_data[f"{sym}|{period}"] = bars
    _write_cache()

# Initialise cache on startup
_load_cache()

app = Flask(__name__, static_folder=".")
CORS(app)

WATCHLIST_FILE = Path(__file__).parent / "watchlist.json"

DEFAULT_WATCHLIST = {
    # ── AI Frontier Models & Platforms ──────────────────────────────────────
    # The labs and hyperscalers driving model development and inference at scale
    "AI Models": ["MSFT", "GOOGL", "META", "AMZN", "ORCL", "IBM"],

    # ── AI Applications & Software ──────────────────────────────────────────
    # Pure-play AI software monetising the model layer
    "AI Apps": ["PLTR", "CRM", "NOW", "SNOW", "MDB", "DDOG", "AI", "PATH", "BBAI"],

    # ── Semiconductors: Compute ─────────────────────────────────────────────
    # GPUs, CPUs, and accelerators powering training & inference
    "Chips Compute": ["NVDA", "AMD", "INTC", "QCOM", "ARM"],

    # ── Semiconductors: Memory & Storage ────────────────────────────────────
    # HBM and NAND demand driven by AI model weights
    "Chips Memory": ["MU", "WDC", "STX"],

    # ── Semiconductors: Equipment & EDA ─────────────────────────────────────
    # The picks-and-shovels of chip manufacturing
    "Chips Equipment": ["ASML", "LRCX", "AMAT", "KLAC", "CDNS", "SNPS", "TER"],

    # ── Data Center Infrastructure ──────────────────────────────────────────
    # Networking, servers, cooling, and custom silicon for hyperscale
    "DC Infra": ["AVGO", "ANET", "VRT", "SMCI", "DELL", "HPE", "NTAP", "CSCO"],

    # ── Cloud & Hyperscale CDN ───────────────────────────────────────────────
    # Edge delivery, cloud networking, and pure cloud plays beyond the big three
    "Cloud": ["NET", "FSLY", "AKAM", "ESTC", "GTLB", "ZS", "OKTA"],

    # ── Power Generation: Nuclear ────────────────────────────────────────────
    # Nuclear as 24/7 carbon-free AI power; SMR long-term
    "Nuclear": ["CEG", "VST", "NRG", "CCJ", "LEU", "SMR", "NNE"],

    # ── Power Generation: Renewables & Grid ─────────────────────────────────
    # Wind, solar, and grid modernisation benefiting from data center load
    "Grid & Renewables": ["GEV", "ETN", "NEE", "AES", "BE", "ENPH", "FSLR", "PCG"],

    # ── Energy: Oil & Gas ───────────────────────────────────────────────────
    # Traditional energy; relevant as power demand narrative broadens
    "Oil & Gas": ["XOM", "CVX", "COP", "OXY", "SLB"],

    # ── Autonomy & Robotics ──────────────────────────────────────────────────
    # Self-driving, humanoid robots, industrial automation
    "Autonomy": ["TSLA", "GOOGL", "MBLY", "AUR", "RCAT", "ACHR", "JOBY"],

    # ── Defense & Aerospace ──────────────────────────────────────────────────
    # Record defence budgets; AI-enabled weapons and C2 systems
    "Defense": ["LMT", "RTX", "NOC", "GD", "BA", "KTOS", "RKLB", "ASTS"],

    # ── Biotech & Health AI ──────────────────────────────────────────────────
    # AI-accelerated drug discovery and diagnostics
    "BioHealth": ["ISRG", "NVAX", "RXRX", "SDGR", "ILMN", "TMO", "DXCM"],

    # ── Fintech & Payments ───────────────────────────────────────────────────
    # Payments rails and AI-native financial services
    "Fintech": ["V", "MA", "PYPL", "XYZ", "AFRM", "COIN", "HOOD"],

    # ── Consumer & Media ────────────────────────────────────────────────────
    # Ad-tech and streaming benefiting from AI personalisation
    "Consumer": ["NFLX", "SPOT", "TTWO", "RBLX", "APP", "TTD"],
}


def load_watchlist():
    if WATCHLIST_FILE.exists():
        try:
            data = json.loads(WATCHLIST_FILE.read_text())
            if isinstance(data, dict):
                # Verify it has the current sector keys; if stale, reset to new defaults.
                if any(k in data for k in DEFAULT_WATCHLIST):
                    return data
        except Exception:
            pass
    # Initialize and save the new default watchlist
    wl = {k: v[:] for k, v in DEFAULT_WATCHLIST.items()}
    save_watchlist(wl)
    return wl


def save_watchlist(wl):
    WATCHLIST_FILE.write_text(json.dumps(wl))


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/api/watchlist", methods=["GET"])
def get_watchlist():
    return jsonify(load_watchlist())


@app.route("/api/watchlist", methods=["POST"])
def add_to_watchlist():
    data = request.get_json()
    symbol = data.get("symbol", "").strip().upper()
    sector = data.get("sector", "TechGrowth").strip()
    if not symbol:
        return jsonify({"error": "symbol required"}), 400
    wl = load_watchlist()
    if sector not in wl:
        wl[sector] = []
    
    # Check if symbol exists in any sector to prevent duplicates
    found = False
    for s_name, symbols in wl.items():
        if symbol in symbols:
            found = True
            break
            
    if not found:
        wl[sector].append(symbol)
        save_watchlist(wl)
    return jsonify(wl)


@app.route("/api/watchlist/<symbol>", methods=["DELETE"])
def remove_from_watchlist(symbol):
    wl = load_watchlist()
    symbol_upper = symbol.upper()
    for sector, symbols in wl.items():
        if symbol_upper in symbols:
            symbols.remove(symbol_upper)
            break
    save_watchlist(wl)
    return jsonify(wl)


@app.route("/api/prices")
def get_prices():
    symbols_param = request.args.get("symbols", "")
    symbols = [s.strip().upper() for s in symbols_param.split(",") if s.strip()]
    if not symbols:
        return jsonify([])

    period = request.args.get("period", "3mo").strip().lower()
    valid_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
    if period not in valid_periods:
        period = "3mo"

    # Interval selection by period
    if period == "1d":
        interval = "1m"
    elif period == "5d":
        interval = "1h"
    else:
        interval = "1d"

    cacheable = interval == "1d"   # only cache daily-bar data

    result = []
    for sym in symbols:
        try:
            # Check disk cache for daily-bar requests
            if cacheable:
                cached = cache_get(sym, period)
                if cached is not None:
                    result.append({"symbol": sym, "prices": cached, "interval": interval})
                    continue

            ticker = yf.Ticker(sym)
            hist = ticker.history(period=period, interval=interval)
            if hist.empty:
                continue
            if interval in ("1m", "1h"):
                # For 1D view, keep only bars from today's calendar date (ET)
                if period == "1d":
                    today_et = datetime.now(ET).date()
                    hist = hist[hist.index.tz_convert(ET).date == today_et]
                # Intraday — include epoch ms timestamp for canvas chart
                closes = [
                    {
                        "date":  idx.isoformat(),
                        "close": round(float(row["Close"]), 4),
                        "ts":    int(idx.timestamp() * 1000),
                    }
                    for idx, row in hist.iterrows()
                ]
            else:
                closes = [
                    {"date": str(idx.date()), "close": round(float(row["Close"]), 4)}
                    for idx, row in hist.iterrows()
                ]

            if cacheable:
                cache_set(sym, period, closes)

            result.append({"symbol": sym, "prices": closes, "interval": interval})
        except Exception as e:
            result.append({"symbol": sym, "error": str(e)})

    return jsonify(result)


@app.route("/api/market_status")
def market_status():
    """Return whether the US equity market is currently open."""
    open_ = is_market_open()
    now_et = datetime.now(ET)
    return jsonify({
        "open": open_,
        "time_et": now_et.strftime("%H:%M:%S"),
        "weekday": now_et.strftime("%A"),
    })


@app.route("/api/quote")
def get_quote():
    """
    Fast latest-price endpoint used by the real-time polling loop.
    Returns for each symbol: last price, previous close, change, pct_change,
    and timestamp of the latest bar.
    Uses 1-minute bars (period=1d, interval=1m) — last bar is the latest tick.
    """
    symbols_param = request.args.get("symbols", "")
    symbols = [s.strip().upper() for s in symbols_param.split(",") if s.strip()]
    if not symbols:
        return jsonify([])

    result = []
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            hist = ticker.history(period="1d", interval="1m")
            if hist.empty:
                result.append({"symbol": sym, "error": "no data"})
                continue
            last_row = hist.iloc[-1]
            first_row = hist.iloc[0]
            last_price = round(float(last_row["Close"]), 4)
            open_price = round(float(first_row["Open"]), 4)
            change = round(last_price - open_price, 4)
            pct_change = round((last_price - open_price) / open_price * 100, 4) if open_price else 0
            last_ts = hist.index[-1]
            result.append({
                "symbol": sym,
                "price":      last_price,
                "open":       open_price,
                "change":     change,
                "pct_change": pct_change,
                "ts":         int(last_ts.timestamp() * 1000),
                "time_et":    last_ts.strftime("%H:%M"),
                # Full 1-min bar for appending to intraday series
                "bar": {
                    "date":  last_ts.isoformat(),
                    "close": last_price,
                    "ts":    int(last_ts.timestamp() * 1000),
                }
            })
        except Exception as e:
            result.append({"symbol": sym, "error": str(e)})

    return jsonify(result)


if __name__ == "__main__":
    import sys
    import socket

    port = 5050
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    else:
        # Auto-detect free port starting from 5050
        start_port = 5050
        while True:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(('127.0.0.1', start_port))
                    port = start_port
                    break
                except OSError:
                    start_port += 1

    print(f"Starting Stock Narrative app at http://localhost:{port}")
    app.run(port=port, debug=True)

