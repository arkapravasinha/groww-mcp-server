# Groww MCP Server

A comprehensive Model Context Protocol (MCP) server for the Groww Trading API. This server provides tools to interact with Groww's trading platform, enabling you to place orders, manage your portfolio, access live market data, and more.
[![smithery badge](https://smithery.ai/badge/@arkapravasinha/groww-mcp-server)](https://smithery.ai/server/@arkapravasinha/groww-mcp-server)
## Features

This MCP server provides access to all major Groww API endpoints:

### 🔧 Instruments & Search
- **`download_instruments_csv`** - Download/refresh complete tradeable instruments data
- **`search_instruments`** - Search for instruments by name, trading symbol, groww symbol, or criteria
- **`get_instrument_details`** - Get detailed information about a specific instrument

### 📋 Orders Management
- **`place_order`** - Place new orders (stocks, F&O)
- **`modify_order`** - Modify existing pending/open orders
- **`cancel_order`** - Cancel pending/open orders
- **`get_order_status`** - Get order status by Groww order ID
- **`get_order_status_by_reference`** - Get order status by user reference ID
- **`get_order_list`** - Get list of all orders for the day
- **`get_order_details`** - Get detailed order information
- **`get_order_trades`** - Get all trades/executions for an order

### 💼 Portfolio Management
- **`get_holdings`** - Get current stock holdings in DEMAT account
- **`get_positions`** - Get all trading positions
- **`get_position_by_symbol`** - Get position for specific trading symbol

### 💰 Margin Management
- **`get_user_margin`** - Get available margin details
- **`calculate_margin_requirement`** - Calculate required margin for orders

### 📊 Live Market Data
- **`get_live_quote`** - Get complete live market data for instruments
- **`get_ltp`** - Get Last Traded Price for multiple instruments (up to 50)
- **`get_ohlc`** - Get OHLC data for multiple instruments (up to 50)

### 📈 Historical Data
- **`get_historical_data`** - Get historical candle data for instruments

### 📊 Technical Analysis
- **`calculate_moving_averages`** - Calculate SMA and EMA for trend analysis
- **`calculate_rsi`** - Calculate Relative Strength Index for momentum analysis  
- **`calculate_bollinger_bands`** - Calculate Bollinger Bands for volatility analysis
- **`calculate_support_resistance`** - Identify key support and resistance levels
- **`calculate_volatility_metrics`** - Calculate various volatility metrics for risk assessment
- **`calculate_macd`** - Calculate MACD for trend and momentum analysis
- **`calculate_stochastic`** - Calculate Stochastic Oscillator for momentum analysis
- **`calculate_williams_r`** - Calculate Williams %R for momentum analysis
- **`calculate_adx`** - Calculate ADX for trend strength analysis
- **`calculate_fibonacci_levels`** - Calculate Fibonacci retracement and extension levels
- **`analyze_candlestick_patterns`** - Identify common candlestick patterns

## Prerequisites

1. **Groww Account**: You need a Groww account with F&O trading enabled
2. **API Subscription**: Active Trading API subscription (₹499 + taxes per month)
3. **API Key**: Generate your API access token from Groww account settings

### Generating API Key

1. Log in to your Groww account
2. Click on the profile section at the top-right
3. Click on the settings icon
4. Navigate to 'Trading APIs'
5. Create and manage your API tokens

## Configuration

The server requires the following configuration:

```json
{
  "apiKey": "your_groww_api_key_here",
  "debug": false
}
```

## API Enums and Constants

### Exchanges
- `NSE` - National Stock Exchange
- `BSE` - Bombay Stock Exchange

### Segments
- `CASH` - Regular equity market
- `FNO` - Futures and Options

### Order Types
- `MARKET` - Execute immediately at best available price
- `LIMIT` - Execute at specified price or better
- `SL` - Stop Loss order
- `SL_M` - Stop Loss Market order

### Transaction Types
- `BUY` - Long position
- `SELL` - Short position

### Product Types
- `CNC` - Cash and Carry (delivery-based)
- `MIS` - Margin Intraday Square-off
- `NRML` - Regular margin trading

### Validity
- `DAY` - Valid until market close

## Usage Examples

### Search for Instruments
```javascript
// Search for instruments containing "reliance"
search_instruments({
  query: "reliance",
  exchange: "NSE",
  segment: "CASH",
  limit: 5
})

// Search for NIFTY options
search_instruments({
  query: "nifty",
  segment: "FNO",
  instrument_type: "CE",
  limit: 10
})

// Get details for a specific symbol
get_instrument_details({
  trading_symbol: "RELIANCE",
  exchange: "NSE"
})
```

### Place a Market Order
```javascript
// Buy 10 shares of RELIANCE at market price
place_order({
  trading_symbol: "RELIANCE",
  quantity: 10,
  exchange: "NSE",
  segment: "CASH",
  product: "CNC",
  order_type: "MARKET",
  transaction_type: "BUY"
})
```

### Place a Limit Order
```javascript
// Buy 100 shares of WIPRO at ₹250 per share
place_order({
  trading_symbol: "WIPRO",
  quantity: 100,
  exchange: "NSE",
  segment: "CASH",
  product: "CNC",
  order_type: "LIMIT",
  transaction_type: "BUY",
  price: 250
})
```

### Place a Stop Loss Order
```javascript
// Stop loss order for RELIANCE
place_order({
  trading_symbol: "RELIANCE",
  quantity: 10,
  exchange: "NSE",
  segment: "CASH",
  product: "CNC",
  order_type: "SL",
  transaction_type: "SELL",
  price: 2450,
  trigger_price: 2400
})
```

### Get Live Market Data
```javascript
// Get live quote for NIFTY
get_live_quote({
  trading_symbol: "NIFTY",
  exchange: "NSE",
  segment: "CASH"
})

// Get LTP for multiple symbols
get_ltp({
  segment: "CASH",
  exchange_symbols: ["NSE_RELIANCE", "NSE_TCS", "NSE_INFY"]
})
```

### Get Historical Data
```javascript
// Get 5-minute candles for RELIANCE
get_historical_data({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-01 15:30:00",
  interval_in_minutes: 5
})
```

### Technical Analysis Examples
```javascript
// Calculate moving averages
calculate_moving_averages({
  trading_symbol: "RELIANCE",
  exchange: "NSE", 
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  periods: [5, 10, 20, 50]
})

// Calculate RSI
calculate_rsi({
  trading_symbol: "NIFTY",
  exchange: "NSE",
  segment: "CASH", 
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  period: 14
})

// Calculate Bollinger Bands
calculate_bollinger_bands({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00", 
  end_time: "2024-01-31 15:30:00",
  period: 20,
  std_dev: 2
})

// Find support and resistance levels
calculate_support_resistance({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH", 
  start_time: "2023-12-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  interval_in_minutes: 60,
  min_touches: 2
})

// Calculate volatility metrics
calculate_volatility_metrics({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2023-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00", 
  interval_in_minutes: 1440 // Daily candles
})

// Calculate MACD
calculate_macd({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  fast_period: 12,
  slow_period: 26,
  signal_period: 9
})

// Calculate Stochastic Oscillator
calculate_stochastic({
  trading_symbol: "NIFTY",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  k_period: 14,
  d_period: 3
})

// Calculate Williams %R
calculate_williams_r({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  period: 14
})

// Calculate ADX for trend strength
calculate_adx({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  period: 14
})

// Calculate Fibonacci levels
calculate_fibonacci_levels({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2023-12-01 09:15:00",
  end_time: "2024-01-31 15:30:00",
  trend_direction: "AUTO"
})

// Analyze candlestick patterns
analyze_candlestick_patterns({
  trading_symbol: "RELIANCE",
  exchange: "NSE",
  segment: "CASH",
  start_time: "2024-01-25 09:15:00",
  end_time: "2024-01-31 15:30:00",
  lookback_candles: 5
})
```

### Calculate Margin Requirements
```javascript
// Calculate margin for basket orders
calculate_margin_requirement({
  segment: "CASH",
  orders: [
    {
      trading_symbol: "RELIANCE",
      transaction_type: "BUY",
      quantity: 10,
      order_type: "LIMIT",
      product: "CNC",
      exchange: "NSE",
      price: 2500
    },
    {
      trading_symbol: "TCS",
      transaction_type: "BUY",
      quantity: 5,
      order_type: "MARKET",
      product: "CNC",
      exchange: "NSE"
    }
  ]
})
```

## Rate Limits

The Groww API has rate limits applied at the category level:

| Category | Requests | Per Second | Per Minute | Per Day |
|----------|----------|------------|------------|---------|
| Orders | Create, Modify, Cancel | 15 | 250 | 3000 |
| Live Data | Quote, LTP, OHLC | 10 | 300 | 5000 |
| Non-Trading | Status, List, Holdings, Margin | 10 | 250 | 3000 |

## Error Handling

The server handles various types of errors:

1. **API Authentication Errors**: Invalid API key
2. **Rate Limit Errors**: Exceeded API rate limits
3. **Validation Errors**: Invalid parameters
4. **Trading Errors**: Market closed, insufficient margin, etc.

All errors are returned with descriptive messages to help identify and resolve issues.

## Support and Documentation

- [Groww API Documentation](https://groww.in/trade-api/docs/curl)
- [Rate Limits](https://groww.in/trade-api/docs/curl#rate-limits)
- [Error Codes](https://groww.in/trade-api/docs/curl#error-codes)

## Disclaimer

⚠️ **Trading Risk Warning**: 
- Trading in financial markets involves substantial risk of loss
- Past performance does not guarantee future results
- Only trade with money you can afford to lose
- This tool is for educational and development purposes
- Always verify orders and trades manually
- The developers are not responsible for any trading losses

## License

This project is licensed under the MIT License.