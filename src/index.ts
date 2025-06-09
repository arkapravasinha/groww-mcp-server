import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Configuration schema
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
  apiKey: z.string().describe("API key for the Groww API"),
});

export default function createStatelessServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const server = new McpServer({
    name: "groww-mcp-server",
    version: "1.0.0",
  });

  // Store instruments data in memory
  let instrumentsData: any[] = [];
  let instrumentsLoaded = false;

  // Function to download and parse instruments CSV
  const loadInstruments = async () => {
    try {
      if (config.debug) {
        console.log("Downloading instruments CSV...");
      }
      
      const response = await fetch("https://growwapi-assets.groww.in/instruments/instrument.csv");
      const csvData = await response.text();
      
      // Parse CSV (simple parsing, assumes CSV is well-formed)
      const lines = csvData.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim());
      
      instrumentsData = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const instrument: any = {};
        headers.forEach((header, index) => {
          instrument[header] = values[index] || '';
        });
        return instrument;
      });
      
      instrumentsLoaded = true;
      
      if (config.debug) {
        console.log(`Loaded ${instrumentsData.length} instruments successfully`);
      }
    } catch (error) {
      console.error("Failed to load instruments:", error);
      instrumentsLoaded = false;
    }
  };

  // Load instruments on server startup
  loadInstruments();

  // Common headers for all API requests
  const getHeaders = () => ({
    'Authorization': `Bearer ${config.apiKey}`,
    'Accept': 'application/json',
    'X-API-VERSION': '1.0',
  });

  // Helper function to make API requests
  const makeRequest = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.status === 'FAILURE') {
      throw new Error(`Groww API Error: ${data.error?.message || 'Unknown error'} (Code: ${data.error?.code || 'N/A'})`);
    }

    return data.payload || data;
  };

  // ==================== INSTRUMENTS ====================

  server.tool(
    "download_instruments_csv",
    "Download/refresh the complete instruments CSV file from Groww containing all tradeable instruments",
    {},
    async () => {
      try {
        await loadInstruments();
        
        if (!instrumentsLoaded) {
          return {
            content: [{ type: "text", text: "Failed to download instruments CSV. Please try again." }],
          };
        }

        const sampleInstruments = instrumentsData.slice(0, 5).map(inst => 
          `${inst.trading_symbol} (${inst.exchange}) - ${inst.name || 'N/A'} - ${inst.instrument_type} - ${inst.segment}`
        ).join('\n');
        
        return {
          content: [
            {
              type: "text",
              text: `Downloaded instruments CSV successfully!\n\nTotal instruments loaded: ${instrumentsData.length}\n\nSample instruments:\n${sampleInstruments}\n\nColumns available: exchange, exchange_token, trading_symbol, groww_symbol, name, instrument_type, segment, series, isin, underlying_symbol, underlying_exchange_token, expiry_date, strike_price, lot_size, tick_size, freeze_quantity, is_reserved, buy_allowed, sell_allowed\n\nUse 'search_instruments' tool to find specific instruments.`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error downloading instruments CSV: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "search_instruments",
    "Search for instruments by name, trading symbol, groww symbol, or other criteria from the loaded instruments data",
    {
      query: z.string().describe("Search query (name, trading symbol, groww symbol, etc.)"),
      exchange: z.enum(["NSE", "BSE", "ALL"]).default("ALL").describe("Filter by exchange"),
      segment: z.enum(["CASH", "FNO", "ALL"]).default("ALL").describe("Filter by segment"),
      instrument_type: z.enum(["EQ", "IDX", "FUT", "CE", "PE", "ALL"]).default("ALL").describe("Filter by instrument type"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of results to return"),
    },
    async ({ query, exchange, segment, instrument_type, limit }) => {
      try {
        if (!instrumentsLoaded) {
          return {
            content: [{ type: "text", text: "Instruments data not loaded. Please run 'download_instruments_csv' first." }],
          };
        }

        const queryLower = query.toLowerCase();
        
        let filtered = instrumentsData.filter(instrument => {
          // Text search in name, trading symbol, and groww symbol
          const nameMatch = (instrument.name || '').toLowerCase().includes(queryLower);
          const symbolMatch = (instrument.trading_symbol || '').toLowerCase().includes(queryLower);
          const growwSymbolMatch = (instrument.groww_symbol || '').toLowerCase().includes(queryLower);
          const textMatch = nameMatch || symbolMatch || growwSymbolMatch;
          
          // Exchange filter
          const exchangeMatch = exchange === "ALL" || instrument.exchange === exchange;
          
          // Segment filter
          const segmentMatch = segment === "ALL" || instrument.segment === segment;
          
          // Instrument type filter
          const typeMatch = instrument_type === "ALL" || instrument.instrument_type === instrument_type;
          
          return textMatch && exchangeMatch && segmentMatch && typeMatch;
        });

        // Sort by relevance (exact matches first, then partial matches)
        filtered.sort((a, b) => {
          const aSymbolExact = (a.trading_symbol || '').toLowerCase() === queryLower;
          const bSymbolExact = (b.trading_symbol || '').toLowerCase() === queryLower;
          const aGrowwSymbolExact = (a.groww_symbol || '').toLowerCase() === queryLower;
          const bGrowwSymbolExact = (b.groww_symbol || '').toLowerCase() === queryLower;
          const aNameExact = (a.name || '').toLowerCase() === queryLower;
          const bNameExact = (b.name || '').toLowerCase() === queryLower;
          
          // Priority: trading_symbol exact > groww_symbol exact > name exact > others
          if (aSymbolExact && !bSymbolExact) return -1;
          if (!aSymbolExact && bSymbolExact) return 1;
          if (aGrowwSymbolExact && !bGrowwSymbolExact) return -1;
          if (!aGrowwSymbolExact && bGrowwSymbolExact) return 1;
          if (aNameExact && !bNameExact) return -1;
          if (!aNameExact && bNameExact) return 1;
          
          return (a.trading_symbol || '').localeCompare(b.trading_symbol || '');
        });

        const results = filtered.slice(0, limit);
        
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No instruments found matching query: "${query}"\n\nTry:\n- Different keywords\n- Broader search terms\n- Check spelling\n- Use 'download_instruments_csv' to refresh data`
              }
            ],
          };
        }

        const resultSummary = results.map((inst, index) => {
          const expiry = inst.expiry_date && inst.expiry_date !== '' ? ` | Expiry: ${inst.expiry_date}` : '';
          const strike = inst.strike_price && inst.strike_price !== '' ? ` | Strike: ₹${inst.strike_price}` : '';
          const lotSize = inst.lot_size && inst.lot_size !== '' ? ` | Lot: ${inst.lot_size}` : '';
          const growwSymbol = inst.groww_symbol && inst.groww_symbol !== inst.trading_symbol ? `\n   Groww Symbol: ${inst.groww_symbol}` : '';
          
          return `${index + 1}. **${inst.trading_symbol}** (${inst.exchange})\n   Name: ${inst.name || 'N/A'}\n   Type: ${inst.instrument_type} | Segment: ${inst.segment}${expiry}${strike}${lotSize}${growwSymbol}\n   ISIN: ${inst.isin || 'N/A'}`;
        }).join('\n\n');

        const totalFound = filtered.length;
        const showingText = totalFound > limit ? `\nShowing ${limit} of ${totalFound} results. Use higher limit to see more.` : `\nFound ${totalFound} result(s).`;

        return {
          content: [
            {
              type: "text",
              text: `Search Results for "${query}":\n\n${resultSummary}${showingText}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error searching instruments: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_instrument_details",
    "Get detailed information about a specific instrument by trading symbol",
    {
      trading_symbol: z.string().describe("Trading symbol (e.g., 'RELIANCE', 'NIFTY')"),
      exchange: z.enum(["NSE", "BSE"]).optional().describe("Exchange (optional, will search both if not provided)"),
    },
    async ({ trading_symbol, exchange }) => {
      try {
        if (!instrumentsLoaded) {
          return {
            content: [{ type: "text", text: "Instruments data not loaded. Please run 'download_instruments_csv' first." }],
          };
        }

        const symbolUpper = trading_symbol.toUpperCase();
        
        let instrument = instrumentsData.find(inst => 
          inst.trading_symbol === symbolUpper && 
          (exchange ? inst.exchange === exchange : true)
        );

        if (!instrument) {
          // Try fuzzy search
          instrument = instrumentsData.find(inst => 
            inst.trading_symbol?.includes(symbolUpper) && 
            (exchange ? inst.exchange === exchange : true)
          );
        }

        if (!instrument) {
          return {
            content: [
              {
                type: "text",
                text: `Instrument "${trading_symbol}" not found${exchange ? ` on ${exchange}` : ''}.\n\nUse 'search_instruments' to find similar instruments.`
              }
            ],
          };
        }

        const details = [
          `**${instrument.trading_symbol}** (${instrument.exchange})`,
          `Name: ${instrument.name || 'N/A'}`,
          `Type: ${instrument.instrument_type} | Segment: ${instrument.segment}`,
          `Series: ${instrument.series || 'N/A'}`,
          `ISIN: ${instrument.isin || 'N/A'}`,
        ];

        if (instrument.groww_symbol && instrument.groww_symbol !== instrument.trading_symbol) {
          details.splice(2, 0, `Groww Symbol: ${instrument.groww_symbol}`);
        }

        if (instrument.underlying_symbol) {
          details.push(`Underlying: ${instrument.underlying_symbol}`);
        }
        
        if (instrument.expiry_date && instrument.expiry_date !== '') {
          details.push(`Expiry: ${instrument.expiry_date}`);
        }
        
        if (instrument.strike_price && instrument.strike_price !== '') {
          details.push(`Strike Price: ₹${instrument.strike_price}`);
        }
        
        if (instrument.lot_size && instrument.lot_size !== '') {
          details.push(`Lot Size: ${instrument.lot_size}`);
        }
        
        if (instrument.tick_size && instrument.tick_size !== '') {
          details.push(`Tick Size: ₹${instrument.tick_size}`);
        }

        details.push(`Trading Allowed: Buy=${instrument.buy_allowed === '1' ? 'Yes' : 'No'}, Sell=${instrument.sell_allowed === '1' ? 'Yes' : 'No'}`);

        return {
          content: [
            {
              type: "text",
              text: `Instrument Details:\n\n${details.join('\n')}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting instrument details: ${error}` }],
        };
      }
    }
  );

  // ==================== ORDERS ====================

  server.tool(
    "place_order",
    "Place a new order in the market (stocks, F&O, etc.)",
    {
      trading_symbol: z.string().describe("Trading symbol of the instrument (e.g., 'RELIANCE', 'WIPRO')"),
      quantity: z.number().int().positive().describe("Quantity to order"),
      exchange: z.enum(["NSE", "BSE"]).describe("Stock exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      product: z.enum(["CNC", "MIS", "NRML"]).describe("Product type"),
      order_type: z.enum(["MARKET", "LIMIT", "SL", "SL_M"]).describe("Order type"),
      transaction_type: z.enum(["BUY", "SELL"]).describe("Transaction type"),
      validity: z.enum(["DAY"]).default("DAY").describe("Order validity"),
      price: z.number().optional().describe("Price for limit orders (in rupees)"),
      trigger_price: z.number().optional().describe("Trigger price for stop loss orders (in rupees)"),
      order_reference_id: z.string().optional().describe("User-defined reference ID (8-20 alphanumeric characters)"),
    },
    async ({ trading_symbol, quantity, exchange, segment, product, order_type, transaction_type, validity, price, trigger_price, order_reference_id }) => {
      try {
        const body: any = {
          trading_symbol,
          quantity,
          exchange,
          segment,
          product,
          order_type,
          transaction_type,
          validity,
        };

        if (price !== undefined) body.price = price;
        if (trigger_price !== undefined) body.trigger_price = trigger_price;
        if (order_reference_id) body.order_reference_id = order_reference_id;

        const data = await makeRequest("https://api.groww.in/v1/order/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        return {
          content: [
            {
              type: "text",
              text: `Order placed successfully!\n\nOrder ID: ${data.groww_order_id}\nStatus: ${data.order_status}\nReference ID: ${data.order_reference_id || 'N/A'}\nRemark: ${data.remark}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error placing order: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "modify_order",
    "Modify an existing pending or open order",
    {
      groww_order_id: z.string().describe("Groww order ID to modify"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      quantity: z.number().int().positive().optional().describe("New quantity"),
      price: z.number().optional().describe("New price (in rupees)"),
      trigger_price: z.number().optional().describe("New trigger price (in rupees)"),
      order_type: z.enum(["MARKET", "LIMIT", "SL", "SL_M"]).optional().describe("New order type"),
    },
    async ({ groww_order_id, segment, quantity, price, trigger_price, order_type }) => {
      try {
        const body: any = {
          groww_order_id,
          segment,
        };

        if (quantity !== undefined) body.quantity = quantity;
        if (price !== undefined) body.price = price;
        if (trigger_price !== undefined) body.trigger_price = trigger_price;
        if (order_type) body.order_type = order_type;

        const data = await makeRequest("https://api.groww.in/v1/order/modify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        return {
          content: [
            {
              type: "text",
              text: `Order modified successfully!\n\nOrder ID: ${data.groww_order_id}\nNew Status: ${data.order_status}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error modifying order: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "cancel_order",
    "Cancel an existing pending or open order",
    {
      groww_order_id: z.string().describe("Groww order ID to cancel"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
    },
    async ({ groww_order_id, segment }) => {
      try {
        const data = await makeRequest("https://api.groww.in/v1/order/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groww_order_id, segment }),
        });

        return {
          content: [
            {
              type: "text",
              text: `Order cancelled successfully!\n\nOrder ID: ${data.groww_order_id}\nStatus: ${data.order_status}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error cancelling order: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_order_status",
    "Get the status of an order by Groww order ID",
    {
      groww_order_id: z.string().describe("Groww order ID"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
    },
    async ({ groww_order_id, segment }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/order/status/${groww_order_id}?segment=${segment}`);

        return {
          content: [
            {
              type: "text",
              text: `Order Status:\n\nOrder ID: ${data.groww_order_id}\nStatus: ${data.order_status}\nFilled Quantity: ${data.filled_quantity}\nReference ID: ${data.order_reference_id || 'N/A'}\nRemark: ${data.remark}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting order status: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_order_status_by_reference",
    "Get the status of an order by user reference ID",
    {
      order_reference_id: z.string().describe("User-provided order reference ID"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
    },
    async ({ order_reference_id, segment }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/order/status/reference/${order_reference_id}?segment=${segment}`);

        return {
          content: [
            {
              type: "text",
              text: `Order Status:\n\nOrder ID: ${data.groww_order_id}\nStatus: ${data.order_status}\nFilled Quantity: ${data.filled_quantity}\nReference ID: ${data.order_reference_id}\nRemark: ${data.remark}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting order status: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_order_list",
    "Get list of all orders for the day",
    {
      segment: z.enum(["CASH", "FNO"]).optional().describe("Market segment filter"),
      page: z.number().int().min(0).default(0).describe("Page number"),
      page_size: z.number().int().min(1).max(50).default(25).describe("Number of orders per page"),
    },
    async ({ segment, page, page_size }) => {
      try {
        let url = `https://api.groww.in/v1/order/list?page=${page}&page_size=${page_size}`;
        if (segment) url += `&segment=${segment}`;

        const data = await makeRequest(url);

        const orderSummary = data.order_list.map((order: any) => 
          `Order: ${order.trading_symbol} | ${order.transaction_type} ${order.quantity} @ ${order.price || 'MARKET'} | Status: ${order.order_status} | ID: ${order.groww_order_id}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Order List (Page ${page + 1}):\n\n${orderSummary || 'No orders found'}\n\nTotal orders returned: ${data.order_list.length}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting order list: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_order_details",
    "Get detailed information about a specific order",
    {
      groww_order_id: z.string().describe("Groww order ID"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
    },
    async ({ groww_order_id, segment }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/order/detail/${groww_order_id}?segment=${segment}`);

        return {
          content: [
            {
              type: "text",
              text: `Order Details:\n\nOrder ID: ${data.groww_order_id}\nSymbol: ${data.trading_symbol}\nStatus: ${data.order_status}\nType: ${data.order_type}\nTransaction: ${data.transaction_type}\nQuantity: ${data.quantity}\nPrice: ₹${data.price || 'MARKET'}\nTrigger Price: ₹${data.trigger_price || 'N/A'}\nFilled: ${data.filled_quantity}\nRemaining: ${data.remaining_quantity}\nAvg Fill Price: ₹${data.average_fill_price || 'N/A'}\nExchange: ${data.exchange}\nSegment: ${data.segment}\nProduct: ${data.product}\nValidity: ${data.validity}\nCreated: ${data.created_at}\nReference ID: ${data.order_reference_id || 'N/A'}\nRemark: ${data.remark}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting order details: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_order_trades",
    "Get all trades/executions for a specific order",
    {
      groww_order_id: z.string().describe("Groww order ID"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      page: z.number().int().min(0).default(0).describe("Page number"),
      page_size: z.number().int().min(1).max(50).default(50).describe("Number of trades per page"),
    },
    async ({ groww_order_id, segment, page, page_size }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/order/trades/${groww_order_id}?segment=${segment}&page=${page}&page_size=${page_size}`);

        const tradesSummary = data.trade_list.map((trade: any) => 
          `Trade: ${trade.trading_symbol} | ${trade.transaction_type} ${trade.quantity} @ ₹${trade.price} | Status: ${trade.trade_status} | Trade ID: ${trade.groww_trade_id} | Time: ${trade.trade_date_time}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Trades for Order ${groww_order_id}:\n\n${tradesSummary || 'No trades found'}\n\nTotal trades: ${data.trade_list.length}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting order trades: ${error}` }],
        };
      }
    }
  );

  // ==================== PORTFOLIO ====================

  server.tool(
    "get_holdings",
    "Get current stock holdings in DEMAT account",
    {},
    async () => {
      try {
        const data = await makeRequest("https://api.groww.in/v1/holdings/user");

        const holdingsSummary = data.holdings.map((holding: any) => 
          `${holding.trading_symbol} (${holding.isin}) | Qty: ${holding.quantity} | Avg Price: ₹${holding.average_price} | Free: ${holding.demat_free_quantity} | Pledged: ${holding.pledge_quantity}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Holdings Summary:\n\n${holdingsSummary || 'No holdings found'}\n\nTotal holdings: ${data.holdings.length}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting holdings: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_positions",
    "Get all trading positions for the user",
    {
      segment: z.enum(["CASH", "FNO"]).optional().describe("Market segment filter"),
    },
    async ({ segment }) => {
      try {
        let url = "https://api.groww.in/v1/positions/user";
        if (segment) url += `?segment=${segment}`;

        const data = await makeRequest(url);

        const positionsSummary = data.positions.map((position: any) => 
          `${position.trading_symbol} | Net Qty: ${position.quantity} | Net Price: ₹${position.net_price} | Credit: ${position.credit_quantity}@₹${position.credit_price} | Debit: ${position.debit_quantity}@₹${position.debit_price} | Exchange: ${position.exchange} | Product: ${position.product}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Positions Summary:\n\n${positionsSummary || 'No positions found'}\n\nTotal positions: ${data.positions.length}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting positions: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_position_by_symbol",
    "Get position for a specific trading symbol",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      segment: z.enum(["CASH", "FNO"]).optional().describe("Market segment"),
    },
    async ({ trading_symbol, segment }) => {
      try {
        let url = `https://api.groww.in/v1/positions/trading-symbol?trading_symbol=${trading_symbol}`;
        if (segment) url += `&segment=${segment}`;

        const data = await makeRequest(url);

        const positionsSummary = data.positions.map((position: any) => 
          `${position.trading_symbol} | Net Qty: ${position.quantity} | Net Price: ₹${position.net_price} | Credit: ${position.credit_quantity}@₹${position.credit_price} | Debit: ${position.debit_quantity}@₹${position.debit_price} | Exchange: ${position.exchange} | Product: ${position.product} | CF Qty: ${position.net_carry_forward_quantity}@₹${position.net_carry_forward_price}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Position for ${trading_symbol}:\n\n${positionsSummary || 'No position found'}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting position: ${error}` }],
        };
      }
    }
  );

  // ==================== MARGIN ====================

  server.tool(
    "get_user_margin",
    "Get available margin details for the user",
    {},
    async () => {
      try {
        const data = await makeRequest("https://api.groww.in/v1/margins/detail/user");

        return {
          content: [
            {
              type: "text",
              text: `Margin Details:\n\nClear Cash: ₹${data.clear_cash}\nNet Margin Used: ₹${data.net_margin_used}\nBrokerage & Charges: ₹${data.brokerage_and_charges}\nCollateral Used: ₹${data.collateral_used}\nCollateral Available: ₹${data.collateral_available}\nAdhoc Margin: ₹${data.adhoc_margin}\n\nF&O Margins:\n- Net Used: ₹${data.fno_margin_details?.net_fno_margin_used || 0}\n- Span Used: ₹${data.fno_margin_details?.span_margin_used || 0}\n- Exposure Used: ₹${data.fno_margin_details?.exposure_margin_used || 0}\n- Future Balance: ₹${data.fno_margin_details?.future_balance_available || 0}\n- Option Buy Balance: ₹${data.fno_margin_details?.option_buy_balance_available || 0}\n- Option Sell Balance: ₹${data.fno_margin_details?.option_sell_balance_available || 0}\n\nEquity Margins:\n- Net Used: ₹${data.equity_margin_details?.net_equity_margin_used || 0}\n- CNC Used: ₹${data.equity_margin_details?.cnc_margin_used || 0}\n- MIS Used: ₹${data.equity_margin_details?.mis_margin_used || 0}\n- CNC Balance: ₹${data.equity_margin_details?.cnc_balance_available || 0}\n- MIS Balance: ₹${data.equity_margin_details?.mis_balance_available || 0}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting margin details: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_margin_requirement",
    "Calculate required margin for orders (single or basket)",
    {
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      orders: z.array(z.object({
        trading_symbol: z.string().describe("Trading symbol"),
        transaction_type: z.enum(["BUY", "SELL"]).describe("Transaction type"),
        quantity: z.number().int().positive().describe("Quantity"),
        order_type: z.enum(["MARKET", "LIMIT", "SL", "SL_M"]).describe("Order type"),
        product: z.enum(["CNC", "MIS", "NRML"]).describe("Product type"),
        exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
        price: z.number().optional().describe("Price for limit orders"),
      })).describe("Array of order objects to calculate margin for"),
    },
    async ({ segment, orders }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/margins/detail/orders?segment=${segment}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orders),
        });

        return {
          content: [
            {
              type: "text",
              text: `Margin Requirement:\n\nTotal Requirement: ₹${data.total_requirement}\nExposure Required: ₹${data.exposure_required || 0}\nSpan Required: ₹${data.span_required || 0}\nOption Buy Premium: ₹${data.option_buy_premium || 0}\nBrokerage & Charges: ₹${data.brokerage_and_charges || 0}\nCNC Margin Required: ₹${data.cash_cnc_margin_required || 0}\nMIS Margin Required: ₹${data.cash_mis_margin_required || 0}\nPhysical Delivery Margin: ₹${data.physical_delivery_margin_requirement || 0}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating margin: ${error}` }],
        };
      }
    }
  );

  // ==================== LIVE DATA ====================

  server.tool(
    "get_live_quote",
    "Get complete live market data for an instrument",
    {
      trading_symbol: z.string().describe("Trading symbol (e.g., 'RELIANCE', 'NIFTY')"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
    },
    async ({ trading_symbol, exchange, segment }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/live-data/quote?trading_symbol=${trading_symbol}&exchange=${exchange}&segment=${segment}`);

        return {
          content: [
            {
              type: "text",
              text: `Live Quote for ${trading_symbol}:\n\nLast Price: ₹${data.last_price}\nDay Change: ₹${data.day_change} (${data.day_change_perc}%)\nOHLC: O:₹${data.ohlc?.open} H:₹${data.ohlc?.high} L:₹${data.ohlc?.low} C:₹${data.ohlc?.close}\nVolume: ${data.volume}\nBid: ₹${data.bid_price} (${data.bid_quantity})\nOffer: ₹${data.offer_price} (${data.offer_quantity})\nCircuit Limits: ₹${data.lower_circuit_limit} - ₹${data.upper_circuit_limit}\n52W Range: ₹${data.week_52_low} - ₹${data.week_52_high}\nAvg Price: ₹${data.average_price}\nMarket Cap: ₹${data.market_cap}\nTotal Buy Qty: ${data.total_buy_quantity}\nTotal Sell Qty: ${data.total_sell_quantity}\nLast Trade: ${data.last_trade_quantity} @ ${new Date(data.last_trade_time).toLocaleString()}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting live quote: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_ltp",
    "Get Last Traded Price for multiple instruments (up to 50)",
    {
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      exchange_symbols: z.array(z.string()).max(50).describe("Array of exchange_symbol pairs like ['NSE_RELIANCE', 'BSE_SENSEX']"),
    },
    async ({ segment, exchange_symbols }) => {
      try {
        const symbolsParam = exchange_symbols.join(',');
        const url = `https://api.groww.in/v1/live-data/ltp?segment=${segment}&exchange_symbols=${symbolsParam}`;
        
        if (config.debug) {
          console.log(`LTP Request URL: ${url}`);
        }
        
        const data = await makeRequest(url);

        if (config.debug) {
          console.log(`LTP Response:`, data);
        }

        const ltpSummary = Object.entries(data).map(([symbol, price]) => 
          `${symbol}: ₹${price}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Last Traded Prices:\n\n${ltpSummary}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting LTP: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_ohlc",
    "Get OHLC data for multiple instruments (up to 50)",
    {
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      exchange_symbols: z.array(z.string()).max(50).describe("Array of exchange_symbol pairs like ['NSE_RELIANCE', 'BSE_SENSEX']"),
    },
    async ({ segment, exchange_symbols }) => {
      try {
        const symbolsParam = exchange_symbols.join(',');
        const data = await makeRequest(`https://api.groww.in/v1/live-data/ohlc?segment=${segment}&exchange_symbols=${symbolsParam}`);

        const ohlcSummary = Object.entries(data).map(([symbol, ohlcData]: [string, any]) => 
          `${symbol}: O:₹${ohlcData.open} H:₹${ohlcData.high} L:₹${ohlcData.low} C:₹${ohlcData.close}`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `OHLC Data:\n\n${ohlcSummary}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting OHLC: ${error}` }],
        };
      }
    }
  );

  // ==================== HISTORICAL DATA ====================

  server.tool(
    "get_historical_data",
    "Get historical candle data for an instrument",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format or epoch milliseconds"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format or epoch milliseconds"),
      interval_in_minutes: z.number().int().optional().default(5).describe("Candle interval in minutes (1, 5, 10, 60, 240, 1440, 10080)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes }) => {
      try {
        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?trading_symbol=${trading_symbol}&exchange=${exchange}&segment=${segment}&start_time=${encodeURIComponent(start_time)}&end_time=${encodeURIComponent(end_time)}&interval_in_minutes=${interval_in_minutes}`);

        const candlesSummary = data.candles.slice(0, 10).map((candle: any[]) => {
          const [timestamp, open, high, low, close, volume] = candle;
          const date = new Date(timestamp * 1000).toLocaleString();
          return `${date}: O:₹${open} H:₹${high} L:₹${low} C:₹${close} V:${volume}`;
        }).join('\n');

        const totalCandles = data.candles.length;
        const showingText = totalCandles > 10 ? `\n\n... showing first 10 of ${totalCandles} candles` : '';

        return {
          content: [
            {
              type: "text",
              text: `Historical Data for ${trading_symbol}:\nPeriod: ${data.start_time} to ${data.end_time}\nInterval: ${data.interval_in_minutes} minutes\n\n${candlesSummary}${showingText}`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting historical data: ${error}` }],
        };
      }
    }
  );

  return server.server;
}
