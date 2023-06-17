
//  ---------------------------------------------------------------------------

import hitbtc3Rest from '../hitbtc3.js';
import { ArrayCache, ArrayCacheBySymbolById, ArrayCacheByTimestamp } from '../base/ws/Cache.js';
import { Int } from '../base/types.js';
import Client from '../base/ws/Client.js';
import { Trade } from '../base/types';
import { sha256 } from '../static_dependencies/noble-hashes/sha256.js';
import { AuthenticationError } from '../base/errors.js';

//  ---------------------------------------------------------------------------

export default class hitbtc3 extends hitbtc3Rest {
    describe () {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchTicker': true,
                'watchTickers': true,
                'watchTrades': true,
                'watchOrderBook': true,
                'watchBalance': true,
                'watchOrders': true,
                'watchOHLCV': true,
                'watchMyTrades': false,
            },
            'urls': {
                'api': {
                    'ws': {
                        'public': 'wss://api.hitbtc.com/api/3/ws/public',
                        'private': 'wss://api.hitbtc.com/api/3/ws/trading',
                    },
                },
            },
            'options': {
                'tradesLimit': 1000,
                'watchTicker': {
                    'method': 'ticker/{speed}',  // 'ticker/{speed}' or 'ticker/price/{speed}'
                },
                'watchTickers': {
                    'method': 'ticker/{speed}',  // 'ticker/{speed}','ticker/price/{speed}', 'ticker/{speed}/batch', or 'ticker/{speed}/price/batch''
                },
                'watchOrderBook': {
                    'method': 'orderbook/full',  // 'orderbook/full', 'orderbook/{depth}/{speed}', 'orderbook/{depth}/{speed}/batch', 'orderbook/top/{speed}', or 'orderbook/top/{speed}/batch'
                },
            },
            'timeframes': {
                '1m': 'M1',
                '3m': 'M3',
                '5m': 'M5',
                '15m': 'M15',
                '30m': 'M30',
                '1h': 'H1',
                '4h': 'H4',
                '1d': 'D1',
                '1w': 'D7',
                '1M': '1M',
            },
            'streaming': {
                'keepAlive': 4000,
            },
        });
    }

    async authenticate () {
        /**
         * @ignore
         * @method
         * @description authenticates the user to access private web socket channels
         * @see https://api.hitbtc.com/#socket-authentication
         * @returns {object} response from exchange
         */
        this.checkRequiredCredentials ();
        const url = this.urls['api']['ws']['private'];
        const messageHash = 'authenticated';
        const client = this.client (url);
        let future = this.safeValue (client.subscriptions, messageHash);
        if (future === undefined) {
            const timestamp = this.milliseconds ();
            const signature = this.hmac (this.encode (this.numberToString (timestamp)), this.encode (this.secret), sha256, 'hex');
            const request = {
                'method': 'login',
                'params': {
                    'type': 'HS256',
                    'api_key': this.apiKey,
                    'timestamp': timestamp,
                    'signature': signature,
                },
            };
            future = await this.watch (url, messageHash, request);
            //
            //    {
            //        "data": {
            //            "success": true,
            //            "ts": 1645597033915
            //        },
            //        "channel": "auth"
            //    }
            //
            //    # Failure to return results
            //
            //    {
            //        "data": {
            //            "success": false,
            //            "message": "Authentication failed!",
            //            "ts": 1646276295075
            //        },
            //        "channel": "auth"
            //    }
            //
            client.subscriptions[messageHash] = future;
        }
        return future;
    }

    async subscribePublic (name: string, symbols: string[] = undefined, params = {}) {
        /**
         * @ignore
         * @method
         * @param {string} name websocket endpoint name
         * @param {[string]|undefined} symbols unified CCXT symbol(s)
         * @param {object} params extra parameters specific to the hitbtc3 api
         * @returns
         */
        await this.loadMarkets ();
        const url = this.urls['api']['ws']['public'];
        let messageHash = name;
        if (symbols !== undefined) {
            messageHash = messageHash + '::' + symbols.join (',');
        }
        const subscribe = {
            'method': 'subscribe',
            'id': this.nonce (),
            'ch': name,
        };
        const request = this.extend (subscribe, params);
        return await this.watch (url, messageHash, request, messageHash);
    }

    async subscribePrivate (name: string, symbol: string = undefined, params = {}) {
        /**
         * @ignore
         * @method
         * @param {string} name websocket endpoint name
         * @param {string|undefined} symbol unified CCXT symbol
         * @param {object} params extra parameters specific to the hitbtc3 api
         * @returns
         */
        await this.loadMarkets ();
        await this.authenticate ();
        const url = this.urls['api']['ws']['private'];
        const splitName = name.split ('_subscribe');
        let messageHash = this.safeString (splitName, 0);
        if (symbol !== undefined) {
            messageHash = messageHash + '::' + symbol;
        }
        const subscribe = {
            'method': name,
            'params': params,
            'id': this.nonce (),
        };
        return await this.watch (url, messageHash, subscribe, messageHash);
    }

    async watchOrderBook (symbol: string, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchOrderBook
         * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
         * @see https://api.hitbtc.com/#subscribe-to-full-order-book
         * @see https://api.hitbtc.com/#subscribe-to-partial-order-book
         * @see https://api.hitbtc.com/#subscribe-to-partial-order-book-in-batches
         * @see https://api.hitbtc.com/#subscribe-to-top-of-book
         * @see https://api.hitbtc.com/#subscribe-to-top-of-book-in-batches
         * @param {string} symbol unified symbol of the market to fetch the order book for
         * @param {int|undefined} limit the maximum amount of order book entries to return
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @param {string|undefined} params.method 'orderbook/full', 'orderbook/{depth}/{speed}', 'orderbook/{depth}/{speed}/batch', 'orderbook/top/{speed}', or 'orderbook/top/{speed}/batch'
         * @param {int|undefined} params.depth 5 (default), 10, or 20
         * @param {int|undefined} params.speed 100 (default), 500, or 1000
         * @returns {object} A dictionary of [order book structures]{@link https://docs.ccxt.com/#/?id=order-book-structure} indexed by market symbols
         */
        const options = this.safeValue (this.options, 'watchOrderBook');
        const defaultMethod = this.safeString (options, 'method', 'orderbook/full');
        let name = this.safeString2 (params, 'method', 'defaultMethod', defaultMethod);
        const depth = this.safeString (params, 'depth', '5');
        const speed = this.safeString (params, 'depth', '100');
        if (name === 'orderbook/{depth}/{speed}') {
            name = 'orderbook/D' + depth + '/' + speed + 'ms';
        } else if (name === 'orderbook/{depth}/{speed}/batch') {
            name = 'orderbook/D' + depth + '/' + speed + 'ms/batch';
        } else if (name === 'orderbook/top/{speed}') {
            name = 'orderbook/top/' + speed + 'ms';
        } else if (name === 'orderbook/top/{speed}/batch') {
            name = 'orderbook/top/' + speed + 'ms/batch';
        }
        const market = this.market (symbol);
        const request = {
            'params': {
                'symbols': [ market['id'] ],
            },
        };
        const orderbook = await this.subscribePublic (name, [ symbol ], this.deepExtend (request, params));
        return orderbook.limit ();
    }

    handleOrderBook (client: Client, message) {
        //
        //    {
        //        "ch": "orderbook/full",                 // Channel
        //        "snapshot": {
        //            "ETHBTC": {
        //                "t": 1626866578796,             // Timestamp in milliseconds
        //                "s": 27617207,                  // Sequence number
        //                "a": [                          // Asks
        //                    ["0.060506", "0"],
        //                    ["0.060549", "12.6431"],
        //                    ["0.060570", "0"],
        //                    ["0.060612", "0"]
        //                ],
        //                "b": [                          // Bids
        //                    ["0.060439", "4.4095"],
        //                    ["0.060414", "0"],
        //                    ["0.060407", "7.3349"],
        //                    ["0.060390", "0"]
        //                ]
        //            }
        //        }
        //    }
        //
        const data = this.safeValue2 (message, 'snapshot', 'update', {});
        const marketIds = Object.keys (data);
        const channel = this.safeString (message, 'ch');
        for (let i = 0; i < marketIds.length; i++) {
            const marketId = marketIds[i];
            const market = this.safeMarket (marketId);
            const symbol = market['symbol'];
            const item = data[marketId];
            const messageHash = channel + '::' + symbol;
            if (!(symbol in this.orderbooks)) {
                const subscription = this.safeValue (client.subscriptions, messageHash, {});
                const limit = this.safeInteger (subscription, 'limit');
                this.orderbooks[symbol] = this.orderBook ({}, limit);
            }
            const timestamp = this.safeInteger (item, 't');
            const nonce = this.safeInteger (item, 's');
            const orderbook = this.orderbooks[symbol];
            const asks = this.safeValue (item, 'a', []);
            const bids = this.safeValue (item, 'b', []);
            this.handleDeltas (orderbook['asks'], asks);
            this.handleDeltas (orderbook['bids'], bids);
            orderbook['timestamp'] = timestamp;
            orderbook['datetime'] = this.iso8601 (timestamp);
            orderbook['nonce'] = nonce;
            orderbook['symbol'] = symbol;
            this.orderbooks[symbol] = orderbook;
            client.resolve (orderbook, messageHash);
        }
    }

    handleDelta (bookside, delta) {
        const amount = this.safeNumber (delta, 0);
        const price = this.safeNumber (delta, 1);
        bookside.store (price, amount);
    }

    handleDeltas (bookside, deltas) {
        for (let i = 0; i < deltas.length; i++) {
            this.handleDelta (bookside, deltas[i]);
        }
    }

    async watchTicker (symbol: string, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchTicker
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
         * @see https://api.hitbtc.com/#subscribe-to-ticker
         * @see https://api.hitbtc.com/#subscribe-to-ticker-in-batches
         * @see https://api.hitbtc.com/#subscribe-to-mini-ticker
         * @see https://api.hitbtc.com/#subscribe-to-mini-ticker-in-batches
         * @param {string} symbol unified symbol of the market to fetch the ticker for
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @param {string} params.method 'ticker/{speed}' (default), or 'ticker/price/{speed}'
         * @param {string} params.speed '1s' (default), or '3s'
         * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/#/?id=ticker-structure}
         */
        const options = this.safeValue (this.options, 'watchTicker');
        const defaultMethod = this.safeString (options, 'method', 'ticker/{speed}');
        const method = this.safeString2 (params, 'method', 'defaultMethod', defaultMethod);
        const speed = this.safeString (params, 'speed', '1s');
        const name = this.implodeParams (method, { 'speed': speed });
        params = this.omit (params, [ 'method', 'speed' ]);
        const market = this.market (symbol);
        const request = {
            'params': {
                'symbols': [ market['id'] ],
            },
        };
        return await this.subscribePublic (name, [ symbol ], this.deepExtend (request, params));
    }

    async watchTickers (symbols = undefined, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchTicker
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
         * @param {string} symbol unified symbol of the market to fetch the ticker for
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @param {string} params.method 'ticker/{speed}' (default),'ticker/price/{speed}', 'ticker/{speed}/batch', or 'ticker/{speed}/price/batch''
         * @param {string} params.speed '1s' (default), or '3s'
         * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/en/latest/manual.html#ticker-structure}
         */
        await this.loadMarkets ();
        const options = this.safeValue (this.options, 'watchTicker');
        const defaultMethod = this.safeString (options, 'method', 'ticker/{speed}');
        const method = this.safeString2 (params, 'method', 'defaultMethod', defaultMethod);
        const speed = this.safeString (params, 'speed', '1s');
        const name = this.implodeParams (method, { 'speed': speed });
        params = this.omit (params, [ 'method', 'speed' ]);
        const marketIds = [];
        if (symbols === undefined) {
            marketIds.push ('*');
        } else {
            for (let i = 0; i < symbols.length; i++) {
                const marketId = this.marketId (symbols[i]);
                marketIds.push (marketId);
            }
        }
        const request = {
            'params': {
                'symbols': marketIds,
            },
        };
        const tickers = this.subscribePublic (name, symbols, this.deepExtend (request, params));
        if (this.newUpdates) {
            return tickers;
        }
        return this.filterByArray (this.tickers, 'symbol', symbols);
    }

    handleTicker (client: Client, message) {
        //
        //    {
        //        "ch": "ticker/1s",
        //        "data": {
        //            "ETHBTC": {
        //                "t": 1614815872000,             // Timestamp in milliseconds
        //                "a": "0.031175",                // Best ask
        //                "A": "0.03329",                 // Best ask quantity
        //                "b": "0.031148",                // Best bid
        //                "B": "0.10565",                 // Best bid quantity
        //                "c": "0.031210",                // Last price
        //                "o": "0.030781",                // Open price
        //                "h": "0.031788",                // High price
        //                "l": "0.030733",                // Low price
        //                "v": "62.587",                  // Base asset volume
        //                "q": "1.951420577",             // Quote asset volume
        //                "p": "0.000429",                // Price change
        //                "P": "1.39",                    // Price change percent
        //                "L": 1182694927                 // Last trade identifier
        //            }
        //        }
        //    }
        //
        //    {
        //        "ch": "ticker/price/1s",
        //        "data": {
        //            "BTCUSDT": {
        //                "t": 1614815872030,
        //                "o": "32636.79",
        //                "c": "32085.51",
        //                "h": "33379.92",
        //                "l": "30683.28",
        //                "v": "11.90667",
        //                "q": "384081.1955629"
        //            }
        //        }
        //    }
        //
        const data = this.safeValue (message, 'data', {});
        const marketIds = Object.keys (data);
        const channel = this.safeString (message, 'ch');
        const newTickers = [];
        for (let i = 0; i < marketIds.length; i++) {
            const marketId = marketIds[i];
            const market = this.safeMarket (marketId);
            const symbol = market['symbol'];
            const ticker = this.parseWsTicker (data[marketId], market);
            this.tickers[symbol] = ticker;
            newTickers.push (ticker);
            const messageHash = channel + '::' + symbol;
            client.resolve (this.tickers[symbol], messageHash);
        }
        const messageHashes = this.findMessageHashes (client, channel + '::');
        for (let i = 0; i < messageHashes.length; i++) {
            const messageHash = messageHashes[i];
            const parts = messageHash.split ('::');
            const symbolsString = parts[1];
            const symbols = symbolsString.split (',');
            const tickers = this.filterByArray (newTickers, 'symbol', symbols);
            const tickersSymbols = Object.keys (tickers);
            const numTickers = tickersSymbols.length;
            if (numTickers > 0) {
                client.resolve (tickers, messageHash);
            }
        }
        client.resolve (this.tickers, channel);
        return message;
    }

    parseWsTicker (ticker, market = undefined) {
        //
        //    {
        //        "t": 1614815872000,             // Timestamp in milliseconds
        //        "a": "0.031175",                // Best ask
        //        "A": "0.03329",                 // Best ask quantity
        //        "b": "0.031148",                // Best bid
        //        "B": "0.10565",                 // Best bid quantity
        //        "c": "0.031210",                // Last price
        //        "o": "0.030781",                // Open price
        //        "h": "0.031788",                // High price
        //        "l": "0.030733",                // Low price
        //        "v": "62.587",                  // Base asset volume
        //        "q": "1.951420577",             // Quote asset volume
        //        "p": "0.000429",                // Price change
        //        "P": "1.39",                    // Price change percent
        //        "L": 1182694927                 // Last trade identifier
        //    }
        //
        //    {
        //        "t": 1614815872030,
        //        "o": "32636.79",
        //        "c": "32085.51",
        //        "h": "33379.92",
        //        "l": "30683.28",
        //        "v": "11.90667",
        //        "q": "384081.1955629"
        //    }
        //
        const timestamp = this.safeInteger (ticker, 't');
        const symbol = this.safeSymbol (undefined, market);
        const last = this.safeString (ticker, 'c');
        return this.safeTicker ({
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeString (ticker, 'h'),
            'low': this.safeString (ticker, 'l'),
            'bid': this.safeString (ticker, 'b'),
            'bidVolume': this.safeString (ticker, 'B'),
            'ask': this.safeString (ticker, 'a'),
            'askVolume': this.safeString (ticker, 'A'),
            'vwap': undefined,
            'open': this.safeString (ticker, 'o'),
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': this.safeString (ticker, 'v'),
            'quoteVolume': this.safeString (ticker, 'q'),
            'info': ticker,
        }, market);
    }

    async watchTrades (symbol: string, since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchTrades
         * @description get the list of most recent trades for a particular symbol
         * @see https://api.hitbtc.com/#subscribe-to-trades
         * @param {string} symbol unified symbol of the market to fetch trades for
         * @param {int|undefined} since not used by hitbtc3 watchTrades
         * @param {int|undefined} limit 0-1000, Default value = 0 (no history returned)
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @returns {[object]} a list of [trade structures]{@link https://docs.ccxt.com/en/latest/manual.html?#public-trades}
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'params': {
                'symbols': [ market['id'] ],
            },
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const trades = await this.subscribePublic ('trades', [ symbol ], this.deepExtend (request, params));
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp');
    }

    handleTrades (client: Client, message) {
        //
        //    {
        //        "result": {
        //            "ch": "trades",                           // Channel
        //            "subscriptions": ["ETHBTC", "BTCUSDT"]
        //        },
        //        "id": 123
        //    }
        //
        // Notification snapshot
        //
        //    {
        //        "ch": "trades",                               // Channel
        //        "snapshot": {
        //            "BTCUSDT": [{
        //                "t": 1626861109494,                   // Timestamp in milliseconds
        //                "i": 1555634969,                      // Trade identifier
        //                "p": "30881.96",                      // Price
        //                "q": "12.66828",                      // Quantity
        //                "s": "buy"                            // Side
        //            }]
        //        }
        //    }
        //
        // Notification update
        //
        //    {
        //        "ch": "trades",
        //        "update": {
        //            "BTCUSDT": [{
        //                "t": 1626861123552,
        //                "i": 1555634969,
        //                "p": "30877.68",
        //                "q": "0.00006",
        //                "s": "sell"
        //            }]
        //        }
        //    }
        //
        const data = this.safeValue2 (message, 'snapshot', 'update', {});
        const marketIds = Object.keys (data);
        for (let i = 0; i < marketIds.length; i++) {
            const marketId = marketIds[i];
            const market = this.safeMarket (marketId);
            const tradesLimit = this.safeInteger (this.options, 'tradesLimit', 1000);
            const symbol = market['symbol'];
            let stored = this.safeValue (this.trades, symbol);
            if (stored === undefined) {
                stored = new ArrayCache (tradesLimit);
                this.trades[symbol] = stored;
            }
            const trades = this.parseWsTrades (data[marketId], market);
            for (let i = 0; i < trades.length; i++) {
                stored.append (trades[i]);
            }
            const messageHash = 'trades::' + symbol;
            client.resolve (stored, messageHash);
        }
        return message;
    }

    parseWsTrades (trades, market: object = undefined, since: Int = undefined, limit: Int = undefined, params = {}): Trade[] {
        trades = this.toArray (trades);
        let result = [];
        for (let i = 0; i < trades.length; i++) {
            const trade = this.extend (this.parseWsTrade (trades[i], market), params);
            result.push (trade);
        }
        result = this.sortBy2 (result, 'timestamp', 'id');
        const symbol = this.safeString (market, 'symbol');
        return this.filterBySymbolSinceLimit (result, symbol, since, limit) as Trade[];
    }

    parseWsTrade (trade, market = undefined) {
        //
        //    {
        //        "t": 1626861123552,       // Timestamp in milliseconds
        //        "i": 1555634969,          // Trade identifier
        //        "p": "30877.68",          // Price
        //        "q": "0.00006",           // Quantity
        //        "s": "sell"               // Side
        //    }
        //
        const timestamp = this.safeInteger (trade, 't');
        return this.safeTrade ({
            'info': trade,
            'id': this.safeString (trade, 'i'),
            'order': undefined,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': this.safeString (market, 'symbol'),
            'type': undefined,
            'side': this.safeString (trade, 'side'),
            'takerOrMaker': undefined,
            'price': this.safeString2 (trade, 'p', 'price'),
            'amount': this.safeString (trade, 'q'),
            'cost': undefined,
            'fee': undefined,
        }, market);
    }

    async watchOHLCV (symbol: string, timeframe = '1m', since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchOHLCV
         * @description watches historical candlestick data containing the open, high, low, and close price, and the volume of a market
         * @see https://api.hitbtc.com/#subscribe-to-candles
         * @param {string} symbol unified symbol of the market to fetch OHLCV data for
         * @param {string} timeframe the length of time each candle represents
         * @param {int|undefined} since not used by hitbtc3 watchOHLCV
         * @param {int|undefined} limit 0 – 1000, default value = 0 (no history returned)
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @returns {[[int]]} A list of candles ordered as timestamp, open, high, low, close, volume
         */
        const period = this.safeString (this.timeframes, timeframe, timeframe);
        const name = 'candles/' + period;
        const market = this.market (symbol);
        const request = {
            'params': {
                'symbols': [ market['id'] ],
            },
        };
        if (limit !== undefined) {
            request['params']['limit'] = limit;
        }
        const ohlcv = await this.subscribePublic (name, [ symbol ], this.deepExtend (request, params));
        if (this.newUpdates) {
            limit = ohlcv.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (ohlcv, since, limit, 0);
    }

    handleOHLCV (client: Client, message) {
        //
        //    {
        //        "ch": "candles/M1",                     // Channel
        //        "snapshot": {
        //            "BTCUSDT": [{
        //                "t": 1626860340000,             // Message timestamp
        //                "o": "30881.95",                // Open price
        //                "c": "30890.96",                // Last price
        //                "h": "30900.8",                 // High price
        //                "l": "30861.27",                // Low price
        //                "v": "1.27852",                 // Base asset volume
        //                "q": "39493.9021811"            // Quote asset volume
        //            }
        //            ...
        //            ]
        //        }
        //    }
        //
        //    {
        //        "ch": "candles/M1",
        //        "update": {
        //            "ETHBTC": [{
        //                "t": 1626860880000,
        //                "o": "0.060711",
        //                "c": "0.060749",
        //                "h": "0.060749",
        //                "l": "0.060711",
        //                "v": "12.2800",
        //                "q": "0.7455339675"
        //          }]
        //        }
        //    }
        //
        const data = this.safeValue2 (message, 'snapshot', 'update', {});
        const marketIds = Object.keys (data);
        const channel = this.safeString (message, 'ch');
        const splitChannel = channel.split ('/');
        const period = this.safeString (splitChannel, 1);
        const timeframe = this.findTimeframe (period);
        for (let i = 0; i < marketIds.length; i++) {
            const marketId = marketIds[i];
            const market = this.safeMarket (marketId);
            const symbol = market['symbol'];
            this.ohlcvs[symbol] = this.safeValue (this.ohlcvs, symbol, {});
            let stored = this.safeValue (this.ohlcvs[symbol], timeframe);
            if (stored === undefined) {
                const limit = this.safeInteger (this.options, 'OHLCVLimit', 1000);
                stored = new ArrayCacheByTimestamp (limit);
                this.ohlcvs[symbol][timeframe] = stored;
            }
            const ohlcvs = this.parseWsOHLCVs (data[marketId], market);
            for (let i = 0; i < ohlcvs.length; i++) {
                stored.append (ohlcvs[i]);
            }
            const messageHash = channel + '::' + symbol;
            client.resolve (stored, messageHash);
        }
        return message;
    }

    parseWsOHLCV (ohlcv, market = undefined) {
        //
        //    {
        //        "t": 1626860340000,             // Message timestamp
        //        "o": "30881.95",                // Open price
        //        "c": "30890.96",                // Last price
        //        "h": "30900.8",                 // High price
        //        "l": "30861.27",                // Low price
        //        "v": "1.27852",                 // Base asset volume
        //        "q": "39493.9021811"            // Quote asset volume
        //    }
        //
        return [
            this.safeInteger (ohlcv, 't'),
            this.safeNumber (ohlcv, 'o'),
            this.safeNumber (ohlcv, 'h'),
            this.safeNumber (ohlcv, 'l'),
            this.safeNumber (ohlcv, 'c'),
            this.safeNumber (ohlcv, 'v'),
        ];
    }

    async watchOrders (symbol: string = undefined, since: Int = undefined, limit: Int = undefined, params = {}) {
        /**
         * @method
         * @name hitbtc3#watchOrders
         * @description watches information on multiple orders made by the user
         * @see https://api.hitbtc.com/#subscribe-to-reports
         * @see https://api.hitbtc.com/#subscribe-to-reports-2
         * @see https://api.hitbtc.com/#subscribe-to-reports-3
         * @param {string|undefined} symbol unified CCXT market symbol
         * @param {int|undefined} since timestamp in ms of the earliest order to fetch
         * @param {int|undefined} limit the maximum amount of orders to fetch
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @returns {[object]} a list of [order structures]{@link https://docs.ccxt.com/en/latest/manual.html#order-structure}
         */
        await this.loadMarkets ();
        let marketType = undefined;
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
        }
        [ marketType, params ] = this.handleMarketTypeAndParams ('watchOrders', market, params);
        const name = this.getSupportedMapping (marketType, {
            'spot': 'spot_subscribe',
            'margin': 'margin_subscribe',
            'swap': 'futures_subscribe',
            'future': 'futures_subscribe',
        });
        const orders = await this.subscribePrivate (name, symbol, params);
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (orders, since, limit, 'timestamp');
    }

    handleOrder (client: Client, message) {
        //
        //    {
        //        "jsonrpc": "2.0",
        //        "method": "spot_order",                            // "margin_order", "future_order"
        //        "params": {
        //            "id": 584244931496,
        //            "client_order_id": "b5acd79c0a854b01b558665bcf379456",
        //            "symbol": "BTCUSDT",
        //            "side": "buy",
        //            "status": "new",
        //            "type": "limit",
        //            "time_in_force": "GTC",
        //            "quantity": "0.01000",
        //            "quantity_cumulative": "0",
        //            "price": "0.01",                              // only updates and snapshots
        //            "post_only": false,
        //            "reduce_only": false,                         // only margin and contract
        //            "display_quantity": "0",                      // only updates and snapshot
        //            "created_at": "2021-07-02T22:52:32.864Z",
        //            "updated_at": "2021-07-02T22:52:32.864Z",
        //            "trade_id": 1361977606,                       // only trades
        //            "trade_quantity": "0.00001",                  // only trades
        //            "trade_price": "49595.04",                    // only trades
        //            "trade_fee": "0.001239876000",                // only trades
        //            "trade_taker": true,                          // only trades, only spot
        //            "trade_position_id": 485308,                  // only trades, only margin
        //            "report_type": "new"                          // "trade", "status" (snapshot)
        //        }
        //    }
        //
        //    {
        //       "jsonrpc": "2.0",
        //       "method": "spot_orders",                            // "margin_orders", "future_orders"
        //       "params": [
        //            {
        //                "id": 584244931496,
        //                "client_order_id": "b5acd79c0a854b01b558665bcf379456",
        //                "symbol": "BTCUSDT",
        //                "side": "buy",
        //                "status": "new",
        //                "type": "limit",
        //                "time_in_force": "GTC",
        //                "quantity": "0.01000",
        //                "quantity_cumulative": "0",
        //                "price": "0.01",                              // only updates and snapshots
        //                "post_only": false,
        //                "reduce_only": false,                         // only margin and contract
        //                "display_quantity": "0",                      // only updates and snapshot
        //                "created_at": "2021-07-02T22:52:32.864Z",
        //                "updated_at": "2021-07-02T22:52:32.864Z",
        //                "trade_id": 1361977606,                       // only trades
        //                "trade_quantity": "0.00001",                  // only trades
        //                "trade_price": "49595.04",                    // only trades
        //                "trade_fee": "0.001239876000",                // only trades
        //                "trade_taker": true,                          // only trades, only spot
        //                "trade_position_id": 485308,                  // only trades, only margin
        //                "report_type": "new"                          // "trade", "status" (snapshot)
        //            }
        //        ]
        //    }
        //
        if (this.orders === undefined) {
            const limit = this.safeInteger (this.options, 'ordersLimit');
            this.orders = new ArrayCacheBySymbolById (limit);
        }
        const data = this.safeValue (message, 'params', []);
        if (this.isArray (data)) {
            for (let i = 0; i < data.length; i++) {
                const order = data[i];
                this.handleOrderHelper (client, message, order);
            }
        } else {
            this.handleOrderHelper (client, message, data);
        }
        return message;
    }

    handleOrderHelper (client: Client, message, order) {
        const orders = this.orders;
        const marketId = this.safeStringLower (order, 'instrument');
        const method = this.safeString (message, 'method');
        const splitMethod = method.split ('_order');
        const messageHash = this.safeString (splitMethod, 0);
        const symbol = this.safeSymbol (marketId);
        const parsed = this.parseOrder (order);
        orders.append (parsed);
        client.resolve (orders, messageHash);
        client.resolve (orders, messageHash + '::' + symbol);
    }

    parseWsOrderTrade (trade, market = undefined) {
        //
        //    {
        //        "id": 584244931496,
        //        "client_order_id": "b5acd79c0a854b01b558665bcf379456",
        //        "symbol": "BTCUSDT",
        //        "side": "buy",
        //        "status": "new",
        //        "type": "limit",
        //        "time_in_force": "GTC",
        //        "quantity": "0.01000",
        //        "quantity_cumulative": "0",
        //        "price": "0.01",                              // only updates and snapshots
        //        "post_only": false,
        //        "reduce_only": false,                         // only margin and contract
        //        "display_quantity": "0",                      // only updates and snapshot
        //        "created_at": "2021-07-02T22:52:32.864Z",
        //        "updated_at": "2021-07-02T22:52:32.864Z",
        //        "trade_id": 1361977606,                       // only trades
        //        "trade_quantity": "0.00001",                  // only trades
        //        "trade_price": "49595.04",                    // only trades
        //        "trade_fee": "0.001239876000",                // only trades
        //        "trade_taker": true,                          // only trades, only spot
        //        "trade_position_id": 485308,                  // only trades, only margin
        //        "report_type": "new"                          // "trade", "status" (snapshot)
        //    }
        //
        const timestamp = this.safeInteger (trade, 'created_at');
        const marketId = this.safeString (trade, 'symbol');
        return this.safeTrade ({
            'info': trade,
            'id': this.safeString (trade, 'trade_id'),
            'order': this.safeString (trade, 'id'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': this.safeMarket (marketId, market),
            'type': undefined,
            'side': this.safeString (trade, 'side'),
            'takerOrMaker': this.safeString (trade, 'trade_taker'),
            'price': this.safeString (trade, 'trade_price'),
            'amount': this.safeString (trade, 'trade_quantity'),
            'cost': undefined,
            'fee': {
                'cost': this.safeString (trade, 'trade_fee'),
                'currency': undefined,
                'rate': undefined,
            },
        }, market);
    }

    parseWsOrder (order, market = undefined) {
        //
        //    {
        //        "id": 584244931496,
        //        "client_order_id": "b5acd79c0a854b01b558665bcf379456",
        //        "symbol": "BTCUSDT",
        //        "side": "buy",
        //        "status": "new",
        //        "type": "limit",
        //        "time_in_force": "GTC",
        //        "quantity": "0.01000",
        //        "quantity_cumulative": "0",
        //        "price": "0.01",                              // only updates and snapshots
        //        "post_only": false,
        //        "reduce_only": false,                         // only margin and contract
        //        "display_quantity": "0",                      // only updates and snapshot
        //        "created_at": "2021-07-02T22:52:32.864Z",
        //        "updated_at": "2021-07-02T22:52:32.864Z",
        //        "trade_id": 1361977606,                       // only trades
        //        "trade_quantity": "0.00001",                  // only trades
        //        "trade_price": "49595.04",                    // only trades
        //        "trade_fee": "0.001239876000",                // only trades
        //        "trade_taker": true,                          // only trades, only spot
        //        "trade_position_id": 485308,                  // only trades, only margin
        //        "report_type": "new"                          // "trade", "status" (snapshot)
        //    }
        //
        const timestamp = this.safeString (order, 'created_at');
        const marketId = this.safeSymbol (order, 'symbol');
        market = this.safeMarket (marketId, market);
        const tradeId = this.safeString (order, 'trade_id');
        let trades = undefined;
        if (tradeId !== undefined) {
            const trade = this.parseWsOrderTrade (order, market);
            trades = [ trade ];
        }
        return this.safeOrder ({
            'info': order,
            'id': this.safeString (order, 'id'),
            'clientOrderId': this.safeString (order, 'client_order_id'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'symbol': market['symbol'],
            'price': this.safeString (order, 'price'),
            'amount': this.safeString (order, 'quantity'),
            'type': this.safeString (order, 'type'),
            'side': this.safeStringUpper (order, 'side'),
            'timeInForce': this.safeString (order, 'time_in_force'),
            'postOnly': this.safeString (order, 'post_only'),
            'reduceOnly': this.safeValue (order, 'reduce_only'),
            'filled': undefined,
            'remaining': undefined,
            'cost': undefined,
            'status': this.parseOrderStatus (this.safeString (order, 'status')),
            'average': undefined,
            'trades': trades,
            'fee': undefined,
        }, market);
    }

    async watchBalance (params = {}) {
        /**
         * @method
         * @name hitbtc3#watchBalance
         * @description watches balance updates, cannot subscribe to margin account balances
         * @see https://api.hitbtc.com/#subscribe-to-spot-balances
         * @see https://api.hitbtc.com/#subscribe-to-futures-balances
         * @param {object} params extra parameters specific to the hitbtc3 api endpoint
         * @param {string} params.type 'spot', 'swap', or 'future'
         *
         * EXCHANGE SPECIFIC PARAMETERS
         * @param {string} params.mode 'updates' or 'batches' (default), 'updates' = messages arrive after balance updates, 'batches' = messages arrive at equal intervals if there were any updates
         * @returns {[object]} a list of [balance structures]{@link https://docs.ccxt.com/#/?id=balance-structure}
         */
        await this.loadMarkets ();
        let type = undefined;
        [ type, params ] = this.handleMarketTypeAndParams ('watchBalance', undefined, params);
        const name = this.getSupportedMapping (type, {
            'spot': 'spot_balance_subscribe',
            'swap': 'futures_balance_subscribe',
            'future': 'futures_balance_subscribe',
        });
        const mode = this.safeString (params, 'mode', 'batches');
        params = this.omit (params, 'mode');
        const request = {
            'mode': mode,
        };
        return await this.subscribePrivate (name, undefined, this.extend (request, params));
    }

    handleBalance (client: Client, message) {
        //
        //    {
        //        "jsonrpc": "2.0",
        //        "method": "futures_balance",
        //        "params": [
        //            {
        //                "currency": "BCN",
        //                "available": "100.000000000000",
        //                "reserved": "0",
        //                "reserved_margin": "0"
        //            },
        //            ...
        //        ]
        //    }
        //
        const messageHash = this.safeString (message, 'method');
        const params = this.safeValue (message, 'params');
        const balance = this.parseBalance (params);
        this.balance = this.deepExtend (this.balance, balance);
        client.resolve (this.balance, messageHash);
    }

    handleNotification (client: Client, message) {
        //
        //     { jsonrpc: '2.0', result: true, id: null }
        //
        return message;
    }

    handleMessage (client: Client, message) {
        let channel = this.safeString2 (message, 'ch', 'method');
        if (channel !== undefined) {
            const splitChannel = channel.split ('/');
            channel = this.safeString (splitChannel, 0);
            const methods = {
                'candles': this.handleOHLCV,
                'ticker': this.handleTicker,
                'trades': this.handleTrades,
                'orderbook': this.handleOrderBook,
                'spot_order': this.handleOrder,
                'spot_orders': this.handleOrder,
                'margin_order': this.handleOrder,
                'margin_orders': this.handleOrder,
                'futures_order': this.handleOrder,
                'futures_orders': this.handleOrder,
                'spot_balance': this.handleBalance,
                'futures_balance': this.handleBalance,
            };
            const method = this.safeValue (methods, channel);
            if (method !== undefined) {
                method.call (this, client, message);
            }
        }
    }

    handleAuthenticate (client: Client, message) {
        //
        //    {
        //        success: true,
        //        ret_msg: '',
        //        op: 'auth',
        //        conn_id: 'ce3dpomvha7dha97tvp0-2xh'
        //    }
        //
        const data = this.safeValue (message, 'data');
        const success = this.safeValue (data, 'success');
        const messageHash = 'authenticated';
        if (success) {
            client.resolve (message, messageHash);
        } else {
            const error = new AuthenticationError (this.id + ' ' + this.json (message));
            client.reject (error, messageHash);
            if (messageHash in client.subscriptions) {
                delete client.subscriptions[messageHash];
            }
        }
        return message;
    }
}
