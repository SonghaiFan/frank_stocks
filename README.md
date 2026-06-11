# Speleothems Stock Charts

A horizon-bands overlay chart for your stock watchlist, resembling geological cave formations (speleothems with upward green stalagmites and downward red stalactites). Powered by yfinance + Flask + D3.

## Setup

```bash
cd stock_narrative
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5050** in your browser.

## Features

- Add/remove tickers from a persistent watchlist
- Ridgeline plot showing normalized % returns (D3 v7)
- Switch between 1M / 3M / 6M / 1Y views
- Hover tooltip showing price and % change
