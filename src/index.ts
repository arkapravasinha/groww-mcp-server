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
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage += `\nAPI Error: ${errorData.error.message || 'Unknown error'} (Code: ${errorData.error.code || 'N/A'})`;
        } else if (errorData.message) {
          errorMessage += `\nError: ${errorData.message}`;
        } else {
          errorMessage += `\nResponse: ${JSON.stringify(errorData)}`;
        }
      } catch (parseError) {
        const responseText = await response.text();
        if (responseText) {
          errorMessage += `\nResponse: ${responseText}`;
        }
      }
      
      throw new Error(errorMessage);
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
    "Place a new order in the market (stocks, F&O, etc.) - Official Groww API: POST /v1/order/create",
    {
      trading_symbol: z.string().min(1).describe("Trading Symbol of the instrument as defined by the exchange (required)"),
      quantity: z.number().int().positive().describe("Quantity of the instrument to order (required)"),
      exchange: z.enum(["NSE", "BSE"]).describe("Stock exchange (required)"),
      segment: z.enum(["CASH", "FNO"]).describe("Segment of the instrument such as CASH, FNO etc. (required)"),
      product: z.enum(["CNC", "MIS", "NRML"]).describe("Product type (required) - CNC, MIS, NRML"),
      order_type: z.enum(["MARKET", "LIMIT", "SL", "SL_M"]).describe("Order type (required) - MARKET, LIMIT, SL, SL_M"),
      transaction_type: z.enum(["BUY", "SELL"]).describe("Transaction type of the trade (required) - BUY or SELL"),
      validity: z.enum(["DAY"]).default("DAY").describe("Validity of the order (required) - currently only DAY is supported"),
      price: z.number().positive().optional().describe("Price of the instrument in rupees for Limit order (decimal) - required for LIMIT and SL orders"),
      trigger_price: z.number().positive().optional().describe("Trigger price in rupees for the order (decimal) - required for SL and SL_M orders"),
      order_reference_id: z.string().min(8).max(20).regex(/^[a-zA-Z0-9-]+$/).optional().describe("User provided 8 to 20 length alphanumeric string with at most two hyphens (-)"),
    },
    async ({ trading_symbol, quantity, exchange, segment, product, order_type, transaction_type, validity, price, trigger_price, order_reference_id }) => {
      try {
        // Validate all required parameters are present
        if (!trading_symbol || !quantity || !exchange || !segment || !product || !order_type || !transaction_type || !validity) {
          return {
            content: [{ type: "text", text: "❌ Error: Missing required parameters. All of trading_symbol, quantity, exchange, segment, product, order_type, transaction_type, and validity are required." }],
          };
        }

        // Generate reference ID if not provided
        if (!order_reference_id || order_reference_id.trim() === '') {
          const timestamp = Date.now().toString();
          const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
          order_reference_id = `ORD-${timestamp.slice(-8)}-${randomSuffix}`;
        }

        // Validate order_reference_id format (at most two hyphens)
        const hyphenCount = (order_reference_id.match(/-/g) || []).length;
        if (hyphenCount > 2) {
          return {
            content: [{ type: "text", text: "❌ Error: order_reference_id can have at most two hyphens (-)" }],
          };
        }

        // Validate length (8-20 characters)
        if (order_reference_id.length < 8 || order_reference_id.length > 20) {
          return {
            content: [{ type: "text", text: "❌ Error: order_reference_id must be between 8-20 characters" }],
          };
        }

        // Validate price requirements based on order type
        if ((order_type === "LIMIT" || order_type === "SL") && (price === undefined || price === null)) {
          return {
            content: [{ type: "text", text: `❌ Error: Price is required for ${order_type} orders` }],
          };
        }

        if ((order_type === "SL" || order_type === "SL_M") && (trigger_price === undefined || trigger_price === null)) {
          return {
            content: [{ type: "text", text: `❌ Error: Trigger price is required for ${order_type} orders` }],
          };
        }

        // Build request body exactly as per official API documentation example
        // Order matches the example: trading_symbol, quantity, price, trigger_price, validity, exchange, segment, product, order_type, transaction_type, order_reference_id
        const body: Record<string, any> = {
          trading_symbol: trading_symbol,
          quantity: quantity,
        };

        // Add price and trigger_price in the order shown in API docs (after quantity, before validity)
        if (price !== undefined && price !== null) {
          body.price = price;
        }
        
        if (trigger_price !== undefined && trigger_price !== null) {
          body.trigger_price = trigger_price;
        }

        // Continue with required fields in API docs order
        body.validity = validity;
        body.exchange = exchange;
        body.segment = segment;
        body.product = product;
        body.order_type = order_type;
        body.transaction_type = transaction_type;
        
        // Add order_reference_id (now always present - either provided or auto-generated)
        body.order_reference_id = order_reference_id;

        // Debug logging
        if (config.debug) {
          console.log("Place Order Request Body:", JSON.stringify(body, null, 2));
          console.log("Request URL: https://api.groww.in/v1/order/create");
          console.log("Request Headers:", JSON.stringify(getHeaders(), null, 2));
        }

        const data = await makeRequest("https://api.groww.in/v1/order/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        // Check if reference ID was auto-generated
        const wasGenerated = order_reference_id.startsWith('ORD-');
        
        return {
          content: [
            {
              type: "text",
              text: `✅ Order placed successfully!\n\n📋 Order Response:\n• Order ID: ${data.groww_order_id}\n• Order Status: ${data.order_status}\n• Reference ID: ${data.order_reference_id || order_reference_id}${wasGenerated ? ' (auto-generated)' : ''}\n• Remark: ${data.remark}\n\n📊 Order Summary:\n• Symbol: ${trading_symbol} (${exchange})\n• Transaction: ${transaction_type} ${quantity} units\n• Price: ${price ? `₹${price}` : 'MARKET PRICE'}\n• Product: ${product} | Segment: ${segment}\n• Validity: ${validity}${trigger_price ? `\n• Trigger Price: ₹${trigger_price}` : ''}`
            }
          ],
        };
      } catch (error) {
        // Enhanced error logging
        if (config.debug) {
          console.error("Place Order Error:", error);
        }
        
        return {
          content: [{ type: "text", text: `❌ Error placing order: ${error}\n\nPlease verify:\n• All required parameters are provided\n• Trading symbol exists and is correct\n• Price/trigger_price are provided for LIMIT/SL orders\n• API key is valid and has trading permissions` }],
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

  // Helper function to validate historical data constraints
  const validateHistoricalDataRequest = (interval_in_minutes: number, start_time: string, end_time: string) => {
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const now = new Date();
    
    // Calculate duration in days
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
    
    // Calculate how many months ago the start date is
    const monthsAgo = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    
    // Define constraints based on interval
    const constraints: Record<number, { maxDuration: number, maxHistoryMonths: number | null }> = {
      1: { maxDuration: 3, maxHistoryMonths: 3 },
      5: { maxDuration: 15, maxHistoryMonths: 3 },
      10: { maxDuration: 30, maxHistoryMonths: 3 },
      60: { maxDuration: 150, maxHistoryMonths: 3 },
      240: { maxDuration: 365, maxHistoryMonths: 3 },
      1440: { maxDuration: 1080, maxHistoryMonths: null }, // No limit
      10080: { maxDuration: Infinity, maxHistoryMonths: null } // No limit
    };
    
    const constraint = constraints[interval_in_minutes];
    if (!constraint) {
      return { valid: false, error: `Unsupported interval: ${interval_in_minutes} minutes. Supported: 1, 5, 10, 60, 240, 1440, 10080` };
    }
    
    // Check duration limit
    if (durationDays > constraint.maxDuration) {
      return { 
        valid: false, 
        error: `Duration too long for ${interval_in_minutes}min interval. Max: ${constraint.maxDuration} days, Requested: ${durationDays} days` 
      };
    }
    
    // Check historical data availability (except for daily and weekly)
    if (constraint.maxHistoryMonths && monthsAgo > constraint.maxHistoryMonths) {
      return { 
        valid: false, 
        error: `Data too old for ${interval_in_minutes}min interval. Max: ${constraint.maxHistoryMonths} months ago, Requested: ${monthsAgo.toFixed(1)} months ago` 
      };
    }
    
    return { valid: true };
  };

  server.tool(
    "get_current_date",
    "Get current date and time information for reference in historical data requests",
    {},
    async () => {
      try {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
        const istTime = new Date(now.getTime() + istOffset);
        
        const formatDate = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const seconds = String(date.getSeconds()).padStart(2, '0');
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };

        // Calculate useful date ranges for different intervals
        const today = new Date(istTime);
        today.setHours(0, 0, 0, 0);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        const lastMonth = new Date(today);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        
        const last3Months = new Date(today);
        last3Months.setMonth(last3Months.getMonth() - 3);
        
        const lastYear = new Date(today);
        lastYear.setFullYear(lastYear.getFullYear() - 1);

        return {
          content: [
            {
              type: "text",
              text: `Current Date & Time Information:\n\nCurrent IST Time: ${formatDate(istTime)}\nCurrent UTC Time: ${formatDate(now)}\n\n📅 USEFUL DATE RANGES FOR HISTORICAL DATA:\n\nFor 1-min data (max 3 days):\n• Yesterday: ${formatDate(yesterday)} to ${formatDate(today)}\n• Last 2 days: ${formatDate(new Date(today.getTime() - 2*24*60*60*1000))} to ${formatDate(today)}\n\nFor 5-min data (max 15 days):\n• Last week: ${formatDate(lastWeek)} to ${formatDate(today)}\n• Last 15 days: ${formatDate(new Date(today.getTime() - 15*24*60*60*1000))} to ${formatDate(today)}\n\nFor hourly data (max 150 days):\n• Last month: ${formatDate(lastMonth)} to ${formatDate(today)}\n• Last 3 months: ${formatDate(last3Months)} to ${formatDate(today)}\n\nFor daily data (max 3 years):\n• Last year: ${formatDate(lastYear)} to ${formatDate(today)}\n• Max range: ${formatDate(new Date(today.getTime() - 1080*24*60*60*1000))} to ${formatDate(today)}\n\n⚠️ DATA AVAILABILITY LIMITS:\n• 1min, 5min, 10min, 1hour, 4hour: Last 3 months only\n• Daily, Weekly: Full history available\n\nMarket Hours: 9:15 AM - 3:30 PM IST (Mon-Fri)`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting current date: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "get_historical_data",
    "Get historical candle data for an instrument. CONSTRAINTS: 1min(3days,3mo), 5min(15days,3mo), 10min(30days,3mo), 1hr(150days,3mo), 4hr(365days,3mo), daily(1080days,unlimited), weekly(unlimited,unlimited)",
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
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes!, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.\n\nGroww API Limits:\n• 1min: Max 3 days per request, Last 3 months available\n• 5min: Max 15 days per request, Last 3 months available\n• 10min: Max 30 days per request, Last 3 months available\n• 1hour: Max 150 days per request, Last 3 months available\n• 4hour: Max 365 days per request, Last 3 months available\n• Daily: Max 1080 days per request, Full history available\n• Weekly: No limit, Full history available` }],
          };
        }

        // Build URL according to official API docs parameter order
        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        if (interval_in_minutes) {
          params.append('interval_in_minutes', interval_in_minutes.toString());
        }

        const url = `https://api.groww.in/v1/historical/candle/range?${params.toString()}`;
        
        if (config.debug) {
          console.log(`Historical Data Request URL: ${url}`);
        }

        const data = await makeRequest(url);

        if (config.debug) {
          console.log(`Historical Data Response:`, JSON.stringify(data, null, 2));
        }

        const candlesSummary = data.candles.slice(0, 10).map((candle: any[]) => {
          const [timestamp, open, high, low, close, volume] = candle;
          const date = new Date(timestamp * 1000).toLocaleString();
          return `${date}: O:₹${open} H:₹${high} L:₹${low} C:₹${close} V:${volume}`;
        }).join('\n');

        const totalCandles = data.candles.length;
        const showingText = totalCandles > 10 ? `\n\n... showing first 10 of ${totalCandles} candles` : '';

        // Calculate data coverage
        const startDate = new Date(data.candles[0][0] * 1000).toLocaleDateString();
        const endDate = new Date(data.candles[data.candles.length - 1][0] * 1000).toLocaleDateString();

        return {
          content: [
            {
              type: "text",
              text: `Historical Data for ${trading_symbol}:\nInterval: ${data.interval_in_minutes} minutes\nData Coverage: ${startDate} to ${endDate}\nTotal Candles: ${totalCandles}\n\n${candlesSummary}${showingText}\n\n✅ Request within API limits for ${interval_in_minutes}-minute interval`
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

  // ==================== TECHNICAL ANALYSIS ====================

  server.tool(
    "calculate_moving_averages",
    "Calculate Simple Moving Average (SMA) and Exponential Moving Average (EMA) for historical data",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      periods: z.array(z.number().int().positive()).default([5, 10, 20, 50]).describe("Periods for moving averages (e.g., [5, 10, 20, 50])"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, periods }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        // Get historical data first
        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length === 0) {
          return {
            content: [{ type: "text", text: "No historical data available for the specified period." }],
          };
        }

        const closes = data.candles.map((candle: any[]) => candle[4]); // close prices
        const timestamps = data.candles.map((candle: any[]) => candle[0]);
        
        // Calculate SMA and EMA for each period
        const results = periods.map(period => {
          if (period > closes.length) {
            return `${period}-period: Not enough data (need ${period}, have ${closes.length})`;
          }

          // Simple Moving Average
          const smaValues = [];
                     for (let i = period - 1; i < closes.length; i++) {
             const sum = closes.slice(i - period + 1, i + 1).reduce((a: number, b: number) => a + b, 0);
             smaValues.push(sum / period);
           }

          // Exponential Moving Average
          const multiplier = 2 / (period + 1);
          const emaValues = [];
          emaValues[0] = closes[period - 1]; // Start with SMA
          for (let i = 1; i < closes.length - period + 1; i++) {
            emaValues[i] = (closes[period - 1 + i] * multiplier) + (emaValues[i - 1] * (1 - multiplier));
          }

          const latestSMA = smaValues[smaValues.length - 1];
          const latestEMA = emaValues[emaValues.length - 1];
          const currentPrice = closes[closes.length - 1];

          return `${period}-period: SMA=₹${latestSMA.toFixed(2)}, EMA=₹${latestEMA.toFixed(2)} | Current: ₹${currentPrice}`;
        });

        const currentPrice = closes[closes.length - 1];
        const latestTime = new Date(timestamps[timestamps.length - 1] * 1000).toLocaleString();

        return {
          content: [
            {
              type: "text",
              text: `Moving Averages for ${trading_symbol}:\nCurrent Price: ₹${currentPrice} (${latestTime})\nData Points: ${closes.length} candles\n\n${results.join('\n')}\n\nInterpretation:\n- SMA: Simple average of closing prices\n- EMA: Exponential average giving more weight to recent prices\n- Price above MA = Bullish trend\n- Price below MA = Bearish trend`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating moving averages: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_rsi",
    "Calculate Relative Strength Index (RSI) for technical analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      period: z.number().int().default(14).describe("RSI period (default: 14)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, period }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < period + 1) {
          return {
            content: [{ type: "text", text: `Not enough data for RSI calculation. Need at least ${period + 1} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const closes = data.candles.map((candle: any[]) => candle[4]);
        
        // Calculate price changes
        const changes = [];
        for (let i = 1; i < closes.length; i++) {
          changes.push(closes[i] - closes[i - 1]);
        }

        // Calculate gains and losses
        const gains = changes.map(change => change > 0 ? change : 0);
        const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

        // Calculate initial averages
        let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

        const rsiValues = [];

        // Calculate RSI values
        for (let i = period; i < changes.length; i++) {
          if (avgLoss === 0) {
            rsiValues.push(100);
          } else {
            const rs = avgGain / avgLoss;
            const rsi = 100 - (100 / (1 + rs));
            rsiValues.push(rsi);
          }

          // Update averages for next iteration (Wilder's smoothing)
          avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
          avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
        }

        const latestRSI = rsiValues[rsiValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        
        // RSI interpretation
        let interpretation = "";
        let signal = "";

        if (latestRSI >= 70) {
          interpretation = "🔴 OVERBOUGHT - Consider selling/taking profits";
          signal = "Consider selling or booking profits";
        } else if (latestRSI <= 30) {
          interpretation = "🟢 OVERSOLD - Consider buying/accumulating";
          signal = "Consider buying or accumulating";
        } else if (latestRSI >= 50) {
          interpretation = "🟡 BULLISH MOMENTUM - Above midline";
          signal = "Upward momentum continues";
        } else {
          interpretation = "🟡 BEARISH MOMENTUM - Below midline";
          signal = "Downward momentum continues";
        }

        return {
          content: [
            {
              type: "text",
              text: `RSI Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice}\nRSI (${period}-period): ${latestRSI.toFixed(2)}\n\n${interpretation}\nSignal: ${signal}\n\nRSI Scale:\n• 0-30: Oversold (potential buy signal)\n• 30-70: Normal range\n• 70-100: Overbought (potential sell signal)\n\nNote: RSI is a momentum oscillator measuring speed and magnitude of price changes.`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating RSI: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_bollinger_bands",
    "Calculate Bollinger Bands for volatility analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      period: z.number().int().default(20).describe("Moving average period (default: 20)"),
      std_dev: z.number().default(2).describe("Standard deviation multiplier (default: 2)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, period, std_dev }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < period) {
          return {
            content: [{ type: "text", text: `Not enough data for Bollinger Bands. Need at least ${period} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const closes = data.candles.map((candle: any[]) => candle[4]);
        
        // Calculate the last set of Bollinger Bands
        const recentCloses = closes.slice(-period);
        const sma = recentCloses.reduce((a: number, b: number) => a + b, 0) / period;
        
        // Calculate standard deviation
        const variance = recentCloses.reduce((acc: number, price: number) => acc + Math.pow(price - sma, 2), 0) / period;
        const standardDeviation = Math.sqrt(variance);
        
        const upperBand = sma + (std_dev * standardDeviation);
        const lowerBand = sma - (std_dev * standardDeviation);
        
        const currentPrice = closes[closes.length - 1];
        
        // Band position percentage
        const bandPosition = ((currentPrice - lowerBand) / (upperBand - lowerBand)) * 100;
        
        // Interpretation
        let interpretation = "";
        let signal = "";
        
        if (currentPrice >= upperBand) {
          interpretation = "🔴 PRICE AT/ABOVE UPPER BAND - Potentially overbought";
          signal = "Consider selling or booking profits";
        } else if (currentPrice <= lowerBand) {
          interpretation = "🟢 PRICE AT/BELOW LOWER BAND - Potentially oversold";
          signal = "Consider buying or accumulating";
        } else if (bandPosition > 80) {
          interpretation = "🟡 PRICE NEAR UPPER BAND - Approaching resistance";
          signal = "Monitor for reversal signals";
        } else if (bandPosition < 20) {
          interpretation = "🟡 PRICE NEAR LOWER BAND - Approaching support";
          signal = "Monitor for bounce signals";
        } else {
          interpretation = "⚪ PRICE IN MIDDLE BAND RANGE - Normal volatility";
          signal = "Neutral - follow the trend";
        }

        const bandwidth = ((upperBand - lowerBand) / sma) * 100;

        return {
          content: [
            {
              type: "text",
              text: `Bollinger Bands Analysis for ${trading_symbol}:\n\nCurrent Price: ₹${currentPrice.toFixed(2)}\nMiddle Band (SMA-${period}): ₹${sma.toFixed(2)}\nUpper Band (+${std_dev}σ): ₹${upperBand.toFixed(2)}\nLower Band (-${std_dev}σ): ₹${lowerBand.toFixed(2)}\n\nBand Position: ${bandPosition.toFixed(1)}%\nBandwidth: ${bandwidth.toFixed(2)}%\n\n${interpretation}\nSignal: ${signal}\n\nBollinger Bands Guide:\n• Price touching upper band = potential sell signal\n• Price touching lower band = potential buy signal\n• Band squeeze (narrow bands) = low volatility, breakout expected\n• Band expansion = high volatility period`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating Bollinger Bands: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_support_resistance",
    "Identify support and resistance levels from historical price data",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(60).describe("Candle interval in minutes (use longer intervals for better levels)"),
      min_touches: z.number().int().default(2).describe("Minimum times a level should be touched (default: 2)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, min_touches }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < 10) {
          return {
            content: [{ type: "text", text: "Not enough historical data to identify support/resistance levels." }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          timestamp: candle[0],
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));

        // Find pivot highs and lows
        const pivotHighs = [];
        const pivotLows = [];
        
        for (let i = 2; i < candles.length - 2; i++) {
          const current = candles[i];
          
          // Pivot High: high is higher than 2 candles on each side
          if (current.high > candles[i-1].high && current.high > candles[i-2].high &&
              current.high > candles[i+1].high && current.high > candles[i+2].high) {
            pivotHighs.push({ price: current.high, timestamp: current.timestamp });
          }
          
          // Pivot Low: low is lower than 2 candles on each side
          if (current.low < candles[i-1].low && current.low < candles[i-2].low &&
              current.low < candles[i+1].low && current.low < candles[i+2].low) {
            pivotLows.push({ price: current.low, timestamp: current.timestamp });
          }
        }

        // Group similar price levels (within 1% range)
        const groupLevels = (pivots: any[], tolerance = 0.01) => {
          const groups: any[] = [];
          
          pivots.forEach(pivot => {
            let addedToGroup = false;
            for (let group of groups) {
              const avgPrice = group.reduce((sum: number, p: any) => sum + p.price, 0) / group.length;
              if (Math.abs(pivot.price - avgPrice) / avgPrice <= tolerance) {
                group.push(pivot);
                addedToGroup = true;
                break;
              }
            }
            if (!addedToGroup) {
              groups.push([pivot]);
            }
          });
          
          return groups.filter(group => group.length >= min_touches).map(group => ({
            price: group.reduce((sum: number, p: any) => sum + p.price, 0) / group.length,
            touches: group.length,
            lastTouch: Math.max(...group.map((p: any) => p.timestamp))
          }));
        };

        const resistanceLevels = groupLevels(pivotHighs);
        const supportLevels = groupLevels(pivotLows);

        // Sort by strength (number of touches)
        resistanceLevels.sort((a, b) => b.touches - a.touches);
        supportLevels.sort((a, b) => b.touches - a.touches);

        const currentPrice = candles[candles.length - 1].close;
        
        // Find nearest levels
        const nearestResistance = resistanceLevels.find(level => level.price > currentPrice);
        const nearestSupport = supportLevels.find(level => level.price < currentPrice);

        let summary = `Support & Resistance Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\n\n`;

        if (nearestResistance) {
          const distance = ((nearestResistance.price - currentPrice) / currentPrice * 100);
          summary += `🔴 NEAREST RESISTANCE: ₹${nearestResistance.price.toFixed(2)} (${distance.toFixed(1)}% above)\n   Strength: ${nearestResistance.touches} touches\n   Last touched: ${new Date(nearestResistance.lastTouch * 1000).toLocaleDateString()}\n\n`;
        }

        if (nearestSupport) {
          const distance = ((currentPrice - nearestSupport.price) / currentPrice * 100);
          summary += `🟢 NEAREST SUPPORT: ₹${nearestSupport.price.toFixed(2)} (${distance.toFixed(1)}% below)\n   Strength: ${nearestSupport.touches} touches\n   Last touched: ${new Date(nearestSupport.lastTouch * 1000).toLocaleDateString()}\n\n`;
        }

        if (resistanceLevels.length > 1) {
          summary += `Other Resistance Levels:\n${resistanceLevels.slice(0, 3).map(level => 
            `• ₹${level.price.toFixed(2)} (${level.touches} touches)`
          ).join('\n')}\n\n`;
        }

        if (supportLevels.length > 1) {
          summary += `Other Support Levels:\n${supportLevels.slice(0, 3).map(level => 
            `• ₹${level.price.toFixed(2)} (${level.touches} touches)`
          ).join('\n')}\n\n`;
        }

        summary += `Analysis Notes:\n• Support: Price level where buying interest emerges\n• Resistance: Price level where selling pressure increases\n• More touches = stronger level\n• Breakout above resistance or below support can signal strong moves`;

        return {
          content: [
            {
              type: "text",
              text: summary
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating support/resistance: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_volatility_metrics",
    "Calculate various volatility metrics for risk assessment",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(1440).describe("Candle interval in minutes (default: 1440 for daily)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < 2) {
          return {
            content: [{ type: "text", text: "Not enough data for volatility calculation." }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));

        // Calculate daily returns
        const returns = [];
        for (let i = 1; i < candles.length; i++) {
          const dailyReturn = (candles[i].close - candles[i-1].close) / candles[i-1].close;
          returns.push(dailyReturn);
        }

        // Historical Volatility (annualized)
        const meanReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / (returns.length - 1);
        const dailyVolatility = Math.sqrt(variance);
        const annualizedVolatility = dailyVolatility * Math.sqrt(252) * 100; // 252 trading days

        // Average True Range (ATR)
        let atrSum = 0;
        for (let i = 1; i < candles.length; i++) {
          const tr1 = candles[i].high - candles[i].low;
          const tr2 = Math.abs(candles[i].high - candles[i-1].close);
          const tr3 = Math.abs(candles[i].low - candles[i-1].close);
          const trueRange = Math.max(tr1, tr2, tr3);
          atrSum += trueRange;
        }
        const atr = atrSum / (candles.length - 1);
        
        // Price range statistics
        const currentPrice = candles[candles.length - 1].close;
        const atrPercentage = (atr / currentPrice) * 100;
        
        // VIX-like calculation (simplified)
        const highLowRanges = candles.map((candle: any) => (candle.high - candle.low) / candle.close);
        const avgHighLowRange = highLowRanges.reduce((sum: number, range: number) => sum + range, 0) / highLowRanges.length * 100;

        // Risk assessment
        let riskLevel = "";
        if (annualizedVolatility < 15) {
          riskLevel = "🟢 LOW VOLATILITY - Conservative investment";
        } else if (annualizedVolatility < 25) {
          riskLevel = "🟡 MODERATE VOLATILITY - Balanced risk";
        } else if (annualizedVolatility < 40) {
          riskLevel = "🟠 HIGH VOLATILITY - Aggressive investment";
        } else {
          riskLevel = "🔴 VERY HIGH VOLATILITY - Speculative";
        }

        // Sharpe ratio (simplified - assuming 6% risk-free rate)
        const riskFreeRate = 0.06;
        const excessReturn = (meanReturn * 252) - riskFreeRate;
        const sharpeRatio = excessReturn / (dailyVolatility * Math.sqrt(252));

        return {
          content: [
            {
              type: "text",
              text: `Volatility Analysis for ${trading_symbol}:\n\nCurrent Price: ₹${currentPrice.toFixed(2)}\nData Period: ${data.start_time} to ${data.end_time}\nCandles Analyzed: ${candles.length}\n\n📊 VOLATILITY METRICS:\n• Annualized Volatility: ${annualizedVolatility.toFixed(2)}%\n• Average True Range: ₹${atr.toFixed(2)} (${atrPercentage.toFixed(2)}% of price)\n• Daily High-Low Range: ${avgHighLowRange.toFixed(2)}%\n• Sharpe Ratio: ${sharpeRatio.toFixed(2)}\n\n${riskLevel}\n\n💡 INTERPRETATION:\n• Volatility shows price movement intensity\n• Higher volatility = higher risk & potential returns\n• ATR useful for setting stop-losses\n• Sharpe ratio measures risk-adjusted returns (>1 is good)\n\nRisk Management:\n• Position size should be inverse to volatility\n• Use wider stops for high volatility stocks\n• Consider volatility when timing entries/exits`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating volatility metrics: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_macd",
    "Calculate MACD (Moving Average Convergence Divergence) for trend and momentum analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      fast_period: z.number().int().default(12).describe("Fast EMA period (default: 12)"),
      slow_period: z.number().int().default(26).describe("Slow EMA period (default: 26)"),
      signal_period: z.number().int().default(9).describe("Signal line EMA period (default: 9)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, fast_period, slow_period, signal_period }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < slow_period + signal_period) {
          return {
            content: [{ type: "text", text: `Not enough data for MACD calculation. Need at least ${slow_period + signal_period} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const closes = data.candles.map((candle: any[]) => candle[4]);
        
        // Calculate EMAs
        const calculateEMA = (prices: number[], period: number) => {
          const multiplier = 2 / (period + 1);
          const ema = [prices[0]];
          for (let i = 1; i < prices.length; i++) {
            ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
          }
          return ema;
        };

        const fastEMA = calculateEMA(closes, fast_period);
        const slowEMA = calculateEMA(closes, slow_period);
        
        // Calculate MACD line
        const macdLine = [];
        for (let i = 0; i < closes.length; i++) {
          macdLine.push(fastEMA[i] - slowEMA[i]);
        }
        
        // Calculate Signal line (EMA of MACD)
        const signalLine = calculateEMA(macdLine, signal_period);
        
        // Calculate Histogram
        const histogram = [];
        for (let i = 0; i < macdLine.length; i++) {
          histogram.push(macdLine[i] - signalLine[i]);
        }

        const currentMACD = macdLine[macdLine.length - 1];
        const currentSignal = signalLine[signalLine.length - 1];
        const currentHistogram = histogram[histogram.length - 1];
        const prevHistogram = histogram[histogram.length - 2];

        // MACD interpretation
        let interpretation = "";
        let signal = "";

        if (currentMACD > currentSignal) {
          if (prevHistogram < 0 && currentHistogram > 0) {
            interpretation = "🟢 BULLISH CROSSOVER - MACD crossed above signal line";
            signal = "Strong BUY signal - Consider entering long positions";
          } else {
            interpretation = "�� BULLISH MOMENTUM - MACD above signal line";
            signal = "Upward momentum continues";
          }
        } else {
          if (prevHistogram > 0 && currentHistogram < 0) {
            interpretation = "🔴 BEARISH CROSSOVER - MACD crossed below signal line";
            signal = "Strong SELL signal - Consider exiting/shorting";
          } else {
            interpretation = "🟡 BEARISH MOMENTUM - MACD below signal line";
            signal = "Downward momentum continues";
          }
        }

        const currentPrice = closes[closes.length - 1];

        return {
          content: [
            {
              type: "text",
              text: `MACD Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\n\nMACD Line: ${currentMACD.toFixed(4)}\nSignal Line: ${currentSignal.toFixed(4)}\nHistogram: ${currentHistogram.toFixed(4)}\n\n${interpretation}\nSignal: ${signal}\n\nMACD Guide:\n• MACD above Signal = Bullish momentum\n• MACD below Signal = Bearish momentum\n• Histogram above zero = Strengthening trend\n• Histogram below zero = Weakening trend\n• Crossovers provide entry/exit signals`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating MACD: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_stochastic",
    "Calculate Stochastic Oscillator for momentum analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      k_period: z.number().int().default(14).describe("%K period (default: 14)"),
      d_period: z.number().int().default(3).describe("%D period (default: 3)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, k_period, d_period }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < k_period + d_period) {
          return {
            content: [{ type: "text", text: `Not enough data for Stochastic calculation. Need at least ${k_period + d_period} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          high: candle[2],
          low: candle[3],
          close: candle[4]
        }));

        // Calculate %K values
        const kValues = [];
        for (let i = k_period - 1; i < candles.length; i++) {
          const period_highs = candles.slice(i - k_period + 1, i + 1).map((c: any) => c.high);
          const period_lows = candles.slice(i - k_period + 1, i + 1).map((c: any) => c.low);
          
          const highest_high = Math.max(...period_highs);
          const lowest_low = Math.min(...period_lows);
          const current_close = candles[i].close;
          
          const k_value = ((current_close - lowest_low) / (highest_high - lowest_low)) * 100;
          kValues.push(k_value);
        }

        // Calculate %D values (SMA of %K)
        const dValues = [];
        for (let i = d_period - 1; i < kValues.length; i++) {
          const sum = kValues.slice(i - d_period + 1, i + 1).reduce((a: number, b: number) => a + b, 0);
          dValues.push(sum / d_period);
        }

        const currentK = kValues[kValues.length - 1];
        const currentD = dValues[dValues.length - 1];
        const prevK = kValues[kValues.length - 2];
        const prevD = dValues[dValues.length - 2];

        // Stochastic interpretation
        let interpretation = "";
        let signal = "";

        if (currentK >= 80 && currentD >= 80) {
          interpretation = "🔴 OVERBOUGHT ZONE - Both %K and %D above 80";
          signal = "Consider selling/taking profits";
        } else if (currentK <= 20 && currentD <= 20) {
          interpretation = "🟢 OVERSOLD ZONE - Both %K and %D below 20";
          signal = "Consider buying/accumulating";
        } else if (prevK <= prevD && currentK > currentD) {
          interpretation = "🟢 BULLISH CROSSOVER - %K crossed above %D";
          signal = "Buy signal generated";
        } else if (prevK >= prevD && currentK < currentD) {
          interpretation = "🔴 BEARISH CROSSOVER - %K crossed below %D";
          signal = "Sell signal generated";
        } else if (currentK > currentD) {
          interpretation = "🟡 BULLISH MOMENTUM - %K above %D";
          signal = "Upward momentum";
        } else {
          interpretation = "🟡 BEARISH MOMENTUM - %K below %D";
          signal = "Downward momentum";
        }

        const currentPrice = candles[candles.length - 1].close;

        return {
          content: [
            {
              type: "text",
              text: `Stochastic Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\n\n%K: ${currentK.toFixed(2)}\n%D: ${currentD.toFixed(2)}\n\n${interpretation}\nSignal: ${signal}\n\nStochastic Guide:\n• 0-20: Oversold (potential buy zone)\n• 20-80: Normal range\n• 80-100: Overbought (potential sell zone)\n• %K crossing above %D = Buy signal\n• %K crossing below %D = Sell signal`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating Stochastic: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_williams_r",
    "Calculate Williams %R for momentum analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      period: z.number().int().default(14).describe("Williams %R period (default: 14)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, period }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < period) {
          return {
            content: [{ type: "text", text: `Not enough data for Williams %R calculation. Need at least ${period} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          high: candle[2],
          low: candle[3],
          close: candle[4]
        }));

        // Calculate Williams %R
        const williamsR = [];
        for (let i = period - 1; i < candles.length; i++) {
          const period_highs = candles.slice(i - period + 1, i + 1).map((c: any) => c.high);
          const period_lows = candles.slice(i - period + 1, i + 1).map((c: any) => c.low);
          
          const highest_high = Math.max(...period_highs);
          const lowest_low = Math.min(...period_lows);
          const current_close = candles[i].close;
          
          const wr_value = ((highest_high - current_close) / (highest_high - lowest_low)) * -100;
          williamsR.push(wr_value);
        }

        const currentWR = williamsR[williamsR.length - 1];
        const prevWR = williamsR[williamsR.length - 2];

        // Williams %R interpretation
        let interpretation = "";
        let signal = "";

        if (currentWR >= -20) {
          interpretation = "🔴 OVERBOUGHT - Williams %R above -20";
          signal = "Consider selling/taking profits";
        } else if (currentWR <= -80) {
          interpretation = "🟢 OVERSOLD - Williams %R below -80";
          signal = "Consider buying/accumulating";
        } else if (prevWR <= -80 && currentWR > -80) {
          interpretation = "🟢 OVERSOLD RECOVERY - Moving out of oversold territory";
          signal = "Potential buy signal";
        } else if (prevWR >= -20 && currentWR < -20) {
          interpretation = "🔴 OVERBOUGHT DECLINE - Moving out of overbought territory";
          signal = "Potential sell signal";
        } else if (currentWR > -50) {
          interpretation = "🟡 BULLISH BIAS - Williams %R in upper range";
          signal = "Upward momentum";
        } else {
          interpretation = "🟡 BEARISH BIAS - Williams %R in lower range";
          signal = "Downward momentum";
        }

        const currentPrice = candles[candles.length - 1].close;

        return {
          content: [
            {
              type: "text",
              text: `Williams %R Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\n\nWilliams %R: ${currentWR.toFixed(2)}\n\n${interpretation}\nSignal: ${signal}\n\nWilliams %R Guide:\n• 0 to -20: Overbought (potential sell zone)\n• -20 to -80: Normal range\n• -80 to -100: Oversold (potential buy zone)\n• Move above -80 from oversold = Buy signal\n• Move below -20 from overbought = Sell signal`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating Williams %R: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_adx",
    "Calculate ADX (Average Directional Index) for trend strength analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(5).describe("Candle interval in minutes"),
      period: z.number().int().default(14).describe("ADX period (default: 14)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, period }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < period * 2) {
          return {
            content: [{ type: "text", text: `Not enough data for ADX calculation. Need at least ${period * 2} candles, have ${data.candles?.length || 0}.` }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          high: candle[2],
          low: candle[3],
          close: candle[4]
        }));

        // Calculate True Range, +DM, -DM
        const trueRanges = [];
        const plusDMs = [];
        const minusDMs = [];

        for (let i = 1; i < candles.length; i++) {
          const current = candles[i];
          const previous = candles[i - 1];
          
          // True Range
          const tr1 = current.high - current.low;
          const tr2 = Math.abs(current.high - previous.close);
          const tr3 = Math.abs(current.low - previous.close);
          const tr = Math.max(tr1, tr2, tr3);
          trueRanges.push(tr);
          
          // Directional Movement
          const plusDM = current.high - previous.high > previous.low - current.low 
            ? Math.max(current.high - previous.high, 0) : 0;
          const minusDM = previous.low - current.low > current.high - previous.high 
            ? Math.max(previous.low - current.low, 0) : 0;
          
          plusDMs.push(plusDM);
          minusDMs.push(minusDM);
        }

        // Calculate smoothed averages
        const smoothedTR = [];
        const smoothedPlusDM = [];
        const smoothedMinusDM = [];

        // Initial sums
        let trSum = trueRanges.slice(0, period).reduce((a: number, b: number) => a + b, 0);
        let plusDMSum = plusDMs.slice(0, period).reduce((a: number, b: number) => a + b, 0);
        let minusDMSum = minusDMs.slice(0, period).reduce((a: number, b: number) => a + b, 0);

        smoothedTR.push(trSum);
        smoothedPlusDM.push(plusDMSum);
        smoothedMinusDM.push(minusDMSum);

        // Wilder's smoothing
        for (let i = period; i < trueRanges.length; i++) {
          trSum = trSum - (trSum / period) + trueRanges[i];
          plusDMSum = plusDMSum - (plusDMSum / period) + plusDMs[i];
          minusDMSum = minusDMSum - (minusDMSum / period) + minusDMs[i];
          
          smoothedTR.push(trSum);
          smoothedPlusDM.push(plusDMSum);
          smoothedMinusDM.push(minusDMSum);
        }

        // Calculate DI+ and DI-
        const plusDI = [];
        const minusDI = [];
        
        for (let i = 0; i < smoothedTR.length; i++) {
          plusDI.push((smoothedPlusDM[i] / smoothedTR[i]) * 100);
          minusDI.push((smoothedMinusDM[i] / smoothedTR[i]) * 100);
        }

        // Calculate DX and ADX
        const dx = [];
        for (let i = 0; i < plusDI.length; i++) {
          const diSum = plusDI[i] + minusDI[i];
          const diDiff = Math.abs(plusDI[i] - minusDI[i]);
          dx.push(diSum !== 0 ? (diDiff / diSum) * 100 : 0);
        }

        // Calculate ADX (smoothed DX)
        const adx = [];
        if (dx.length >= period) {
          let adxSum = dx.slice(0, period).reduce((a: number, b: number) => a + b, 0) / period;
          adx.push(adxSum);
          
          for (let i = period; i < dx.length; i++) {
            adxSum = ((adxSum * (period - 1)) + dx[i]) / period;
            adx.push(adxSum);
          }
        }

        const currentADX = adx[adx.length - 1];
        const currentPlusDI = plusDI[plusDI.length - 1];
        const currentMinusDI = minusDI[minusDI.length - 1];

        // ADX interpretation
        let trendStrength = "";
        let trendDirection = "";
        let signal = "";

        if (currentADX >= 50) {
          trendStrength = "🔥 VERY STRONG TREND";
        } else if (currentADX >= 25) {
          trendStrength = "🟠 STRONG TREND";
        } else if (currentADX >= 20) {
          trendStrength = "🟡 MODERATE TREND";
        } else {
          trendStrength = "⚪ WEAK TREND/SIDEWAYS";
        }

        if (currentPlusDI > currentMinusDI) {
          trendDirection = "🟢 BULLISH DIRECTION (+DI > -DI)";
          signal = currentADX >= 25 ? "Strong uptrend - Hold long positions" : "Weak upward movement";
        } else {
          trendDirection = "🔴 BEARISH DIRECTION (-DI > +DI)";
          signal = currentADX >= 25 ? "Strong downtrend - Avoid longs/consider shorts" : "Weak downward movement";
        }

        const currentPrice = candles[candles.length - 1].close;

        return {
          content: [
            {
              type: "text",
              text: `ADX Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\n\nADX: ${currentADX.toFixed(2)}\n+DI: ${currentPlusDI.toFixed(2)}\n-DI: ${currentMinusDI.toFixed(2)}\n\nTrend Strength: ${trendStrength}\nDirection: ${trendDirection}\nSignal: ${signal}\n\nADX Guide:\n• ADX > 25: Strong trend (tradeable)\n• ADX < 20: Weak trend/sideways (avoid trend strategies)\n• +DI > -DI: Bullish trend\n• -DI > +DI: Bearish trend\n• Rising ADX: Strengthening trend\n• Falling ADX: Weakening trend`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating ADX: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "calculate_fibonacci_levels",
    "Calculate Fibonacci retracement and extension levels for support/resistance analysis",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(60).describe("Candle interval in minutes"),
      trend_direction: z.enum(["UP", "DOWN", "AUTO"]).default("AUTO").describe("Trend direction for Fibonacci calculation"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, trend_direction }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < 10) {
          return {
            content: [{ type: "text", text: "Not enough historical data for Fibonacci calculation." }],
          };
        }

        const candles = data.candles.map((candle: any[]) => ({
          high: candle[2],
          low: candle[3],
          close: candle[4]
        }));

        // Find the highest high and lowest low in the period
        const highs = candles.map((c: any) => c.high);
        const lows = candles.map((c: any) => c.low);
        const maxHigh = Math.max(...highs);
        const minLow = Math.min(...lows);
        
        // Auto-detect trend direction if not specified
        let direction = trend_direction;
        if (direction === "AUTO") {
          const firstQuarter = candles.slice(0, Math.floor(candles.length / 4));
          const lastQuarter = candles.slice(-Math.floor(candles.length / 4));
          
          const avgEarlyPrice = firstQuarter.reduce((sum: number, c: any) => sum + c.close, 0) / firstQuarter.length;
          const avgLatePrice = lastQuarter.reduce((sum: number, c: any) => sum + c.close, 0) / lastQuarter.length;
          
          direction = avgLatePrice > avgEarlyPrice ? "UP" : "DOWN";
        }

        // Fibonacci ratios
        const fibRatios = {
          retracement: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0],
          extension: [1.272, 1.414, 1.618, 2.0, 2.618]
        };

        let high, low;
        if (direction === "UP") {
          low = minLow;
          high = maxHigh;
        } else {
          high = maxHigh;
          low = minLow;
        }

        const range = high - low;
        const currentPrice = candles[candles.length - 1].close;

        // Calculate Fibonacci levels
        const retracementLevels = fibRatios.retracement.map(ratio => {
          const level = direction === "UP" ? high - (range * ratio) : low + (range * ratio);
          const distance = Math.abs(currentPrice - level);
          const distancePercent = (distance / currentPrice) * 100;
          
          return {
            ratio: ratio,
            price: level,
            distance: distancePercent,
            label: `${(ratio * 100).toFixed(1)}%`
          };
        });

        const extensionLevels = fibRatios.extension.map(ratio => {
          const level = direction === "UP" ? high + (range * (ratio - 1)) : low - (range * (ratio - 1));
          const distance = Math.abs(currentPrice - level);
          const distancePercent = (distance / currentPrice) * 100;
          
          return {
            ratio: ratio,
            price: level,
            distance: distancePercent,
            label: `${(ratio * 100).toFixed(1)}%`
          };
        });

        // Find nearest levels
        const allLevels = [...retracementLevels, ...extensionLevels];
        allLevels.sort((a, b) => a.distance - b.distance);
        const nearestLevel = allLevels[0];

        // Determine if price is at a significant Fibonacci level
        let atFibLevel = "";
        const tolerance = 1; // 1% tolerance
        const significantLevel = allLevels.find(level => level.distance <= tolerance);
        
        if (significantLevel) {
          atFibLevel = `🎯 PRICE NEAR FIBONACCI LEVEL: ${significantLevel.label} (₹${significantLevel.price.toFixed(2)})`;
        }

        const retracementSummary = retracementLevels.map(level => 
          `${level.label}: ₹${level.price.toFixed(2)} (${level.distance.toFixed(1)}% away)`
        ).join('\n');

        const extensionSummary = extensionLevels.map(level => 
          `${level.label}: ₹${level.price.toFixed(2)} (${level.distance.toFixed(1)}% away)`
        ).join('\n');

        return {
          content: [
            {
              type: "text",
              text: `Fibonacci Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\nTrend Direction: ${direction}\nPrice Range: ₹${low.toFixed(2)} - ₹${high.toFixed(2)}\n\n${atFibLevel}\n\n📉 RETRACEMENT LEVELS:\n${retracementSummary}\n\n📈 EXTENSION LEVELS:\n${extensionSummary}\n\nNearest Level: ${nearestLevel.label} at ₹${nearestLevel.price.toFixed(2)}\n\nFibonacci Guide:\n• 38.2% & 61.8%: Strong support/resistance\n• 50%: Psychological level\n• 78.6%: Deep retracement (trend may reverse)\n• Extensions: Profit targets in trending markets\n• Price bounces off Fibonacci levels frequently`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error calculating Fibonacci levels: ${error}` }],
        };
      }
    }
  );

  server.tool(
    "analyze_candlestick_patterns",
    "Identify common candlestick patterns for reversal and continuation signals",
    {
      trading_symbol: z.string().describe("Trading symbol"),
      exchange: z.enum(["NSE", "BSE"]).describe("Exchange"),
      segment: z.enum(["CASH", "FNO"]).describe("Market segment"),
      start_time: z.string().describe("Start time in 'YYYY-MM-DD HH:mm:ss' format"),
      end_time: z.string().describe("End time in 'YYYY-MM-DD HH:mm:ss' format"),
      interval_in_minutes: z.number().int().default(60).describe("Candle interval in minutes"),
      lookback_candles: z.number().int().default(5).describe("Number of recent candles to analyze (default: 5)"),
    },
    async ({ trading_symbol, exchange, segment, start_time, end_time, interval_in_minutes, lookback_candles }) => {
      try {
        // Validate request constraints
        const validation = validateHistoricalDataRequest(interval_in_minutes, start_time, end_time);
        if (!validation.valid) {
          return {
            content: [{ type: "text", text: `❌ CONSTRAINT VIOLATION: ${validation.error}\n\nUse 'get_current_date' tool to see valid date ranges for each interval.` }],
          };
        }

        const params = new URLSearchParams();
        params.append('exchange', exchange);
        params.append('segment', segment);
        params.append('trading_symbol', trading_symbol);
        params.append('start_time', start_time);
        params.append('end_time', end_time);
        params.append('interval_in_minutes', interval_in_minutes.toString());

        const data = await makeRequest(`https://api.groww.in/v1/historical/candle/range?${params.toString()}`);
        
        if (!data.candles || data.candles.length < lookback_candles + 2) {
          return {
            content: [{ type: "text", text: "Not enough data for candlestick pattern analysis." }],
          };
        }

        const candles = data.candles.slice(-lookback_candles - 2).map((candle: any[]) => ({
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
          volume: candle[5]
        }));

        const patterns = [];

        // Helper functions
        const isBullish = (candle: any) => candle.close > candle.open;
        const isBearish = (candle: any) => candle.close < candle.open;
        const bodySize = (candle: any) => Math.abs(candle.close - candle.open);
        const upperShadow = (candle: any) => candle.high - Math.max(candle.open, candle.close);
        const lowerShadow = (candle: any) => Math.min(candle.open, candle.close) - candle.low;
        const totalRange = (candle: any) => candle.high - candle.low;
        const isLongBody = (candle: any) => bodySize(candle) > totalRange(candle) * 0.6;
        const isSmallBody = (candle: any) => bodySize(candle) < totalRange(candle) * 0.3;

        // Check patterns for each candle position
        for (let i = 1; i < candles.length - 1; i++) {
          const prev = candles[i - 1];
          const current = candles[i];
          const next = i < candles.length - 1 ? candles[i + 1] : null;

          // Single candle patterns
          
          // Hammer/Hanging Man
          if (lowerShadow(current) > bodySize(current) * 2 && upperShadow(current) < bodySize(current) * 0.5) {
            const isHammer = isBearish(prev) && isBullish(current);
            const isHangingMan = isBullish(prev) && (isBullish(current) || isBearish(current));
            
            if (isHammer) {
              patterns.push({
                name: "🔨 HAMMER",
                type: "BULLISH REVERSAL",
                strength: "MODERATE",
                position: i,
                description: "Potential reversal from downtrend"
              });
            } else if (isHangingMan) {
              patterns.push({
                name: "🪝 HANGING MAN",
                type: "BEARISH REVERSAL",
                strength: "MODERATE", 
                position: i,
                description: "Potential reversal from uptrend"
              });
            }
          }

          // Doji
          if (bodySize(current) < totalRange(current) * 0.1) {
            patterns.push({
              name: "✖️ DOJI",
              type: "REVERSAL/INDECISION",
              strength: "WEAK",
              position: i,
              description: "Market indecision, potential reversal"
            });
          }

          // Shooting Star
          if (upperShadow(current) > bodySize(current) * 2 && lowerShadow(current) < bodySize(current) * 0.5 && isBullish(prev)) {
            patterns.push({
              name: "🌟 SHOOTING STAR",
              type: "BEARISH REVERSAL",
              strength: "MODERATE",
              position: i,
              description: "Rejection at higher levels"
            });
          }

          // Two candle patterns
          if (i < candles.length - 1) {
            // Bullish Engulfing
            if (isBearish(current) && isBullish(next) && 
                next.open < current.close && next.close > current.open &&
                bodySize(next) > bodySize(current)) {
              patterns.push({
                name: "🟢 BULLISH ENGULFING",
                type: "BULLISH REVERSAL",
                strength: "STRONG",
                position: i + 1,
                description: "Strong bullish reversal signal"
              });
            }

            // Bearish Engulfing
            if (isBullish(current) && isBearish(next) && 
                next.open > current.close && next.close < current.open &&
                bodySize(next) > bodySize(current)) {
              patterns.push({
                name: "🔴 BEARISH ENGULFING",
                type: "BEARISH REVERSAL",
                strength: "STRONG",
                position: i + 1,
                description: "Strong bearish reversal signal"
              });
            }
          }

          // Long body candles
          if (isLongBody(current)) {
            if (isBullish(current)) {
              patterns.push({
                name: "📈 LONG BULLISH CANDLE",
                type: "BULLISH CONTINUATION",
                strength: "MODERATE",
                position: i,
                description: "Strong buying pressure"
              });
            } else {
              patterns.push({
                name: "📉 LONG BEARISH CANDLE", 
                type: "BEARISH CONTINUATION",
                strength: "MODERATE",
                position: i,
                description: "Strong selling pressure"
              });
            }
          }
        }

        const currentPrice = candles[candles.length - 1].close;
        const patternCount = patterns.length;

        let summary = "";
        if (patternCount === 0) {
          summary = "No significant candlestick patterns detected in recent candles.";
        } else {
          const recentPatterns = patterns.slice(-3); // Show last 3 patterns
          summary = recentPatterns.map(pattern => 
            `${pattern.name} (${pattern.type})\n   Strength: ${pattern.strength}\n   Signal: ${pattern.description}`
          ).join('\n\n');
        }

        return {
          content: [
            {
              type: "text",
              text: `Candlestick Pattern Analysis for ${trading_symbol}:\nCurrent Price: ₹${currentPrice.toFixed(2)}\nCandles Analyzed: ${lookback_candles}\nPatterns Found: ${patternCount}\n\n${summary}\n\nPattern Guide:\n• Reversal patterns: Suggest trend change\n• Continuation patterns: Suggest trend persistence\n• Single candle patterns: Weaker signals\n• Multi-candle patterns: Stronger signals\n• Confirm with volume and other indicators`
            }
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error analyzing candlestick patterns: ${error}` }],
        };
      }
    }
  );

  return server.server;
}
