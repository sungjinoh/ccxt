'use strict';

//  ---------------------------------------------------------------------------

const bybitRest = require ('../bybit.js');
const { AuthenticationError, ExchangeError, BadRequest } = require ('../base/errors');
const { ArrayCache, ArrayCacheBySymbolById, ArrayCacheByTimestamp } = require ('./base/Cache');

//  ---------------------------------------------------------------------------

module.exports = class bybit extends bybitRest {
    describe () {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchBalance': true,
                'watchMyTrades': true,
                'watchOHLCV': true,
                'watchOrderBook': true,
                'watchOrders': true,
                'watchTicker': true,
                'watchTickers': false, // for now
                'watchTrades': true,
                'watchPosition': undefined,
            },
            'urls': {
                'api': {
                    'ws': {
                        'public': {
                            'spot': 'wss://stream.{hostname}/v5/public/spot',
                            'inverse': 'wss://stream.{hostname}/v5/public/inverse',
                            'option': 'wss://stream.{hostname}/v5/public/option',
                            'linear': 'wss://stream.{hostname}/v5/public/linear',
                        },
                        'private': {
                            'spot': {
                                'unified': 'wss://stream.{hostname}/v5/private',
                                'nonUnified': 'wss://stream.{hostname}/spot/private/v3',
                            },
                            'contract': 'wss://stream.{hostname}/v5/private',
                            'usdc': 'wss://stream.{hostname}/trade/option/usdc/private/v1',
                        },
                    },
                },
                'test': {
                    'ws': {
                        'public': {
                            'spot': 'wss://stream-testnet.{hostname}/v5/public/spot',
                            'inverse': 'wss://stream-testnet.{hostname}/v5/public/inverse',
                            'linear': 'wss://stream-testnet.{hostname}/v5/public/linear',
                            'option': 'wss://stream-testnet.{hostname}/v5/public/option',
                        },
                        'private': {
                            'spot': {
                                'unified': 'wss://stream-testnet.{hostname}/v5/private',
                                'nonUnified': 'wss://stream-testnet.{hostname}/spot/private/v3',
                            },
                            'contract': 'wss://stream-testnet.{hostname}/v5/private',
                            'usdc': 'wss://stream-testnet.{hostname}/trade/option/usdc/private/v1',
                        },
                    },
                },
            },
            'options': {
                'watchTicker': {
                    'name': 'tickers', // 'tickers' for 24hr statistical ticker or 'tickers_lt' for leverage token ticker
                },
                'spot': {
                    'timeframes': {
                        '1m': '1m',
                        '3m': '3m',
                        '5m': '5m',
                        '15m': '15m',
                        '30m': '30m',
                        '1h': '1h',
                        '2h': '2h',
                        '4h': '4h',
                        '6h': '6h',
                        '12h': '12h',
                        '1d': '1d',
                        '1w': '1w',
                        '1M': '1M',
                    },
                },
                'contract': {
                    'timeframes': {
                        '1m': '1',
                        '3m': '3',
                        '5m': '5',
                        '15m': '15',
                        '30m': '30',
                        '1h': '60',
                        '2h': '120',
                        '4h': '240',
                        '6h': '360',
                        '12h': '720',
                        '1d': 'D',
                        '1w': 'W',
                        '1M': 'M',
                    },
                },
            },
            'streaming': {
                'ping': this.ping,
                'keepAlive': 20000,
            },
            'exceptions': {
                'ws': {
                    'exact': {
                    },
                },
            },
        });
    }

    requestId () {
        const requestId = this.sum (this.safeInteger (this.options, 'requestId', 0), 1);
        this.options['requestId'] = requestId;
        return requestId;
    }

    getUrlByMarketType (symbol = undefined, isPrivate = false, isUnifiedMargin = false, method = undefined, params = {}) {
        const accessibility = isPrivate ? 'private' : 'public';
        let isUsdcSettled = undefined;
        let isSpot = undefined;
        let type = undefined;
        let market = undefined;
        let url = this.urls['api']['ws'];
        if (symbol !== undefined) {
            market = this.market (symbol);
            isUsdcSettled = market['settle'] === 'USDC';
            type = market['type'];
        } else {
            [ type, params ] = this.handleMarketTypeAndParams (method, undefined, params);
            let defaultSettle = this.safeString (this.options, 'defaultSettle');
            defaultSettle = this.safeString2 (params, 'settle', 'defaultSettle', defaultSettle);
            isUsdcSettled = (defaultSettle === 'USDC');
        }
        isSpot = (type === 'spot');
        if (isPrivate) {
            if (isSpot) {
                const margin = isUnifiedMargin ? 'unified' : 'nonUnified';
                url = url[accessibility]['spot'][margin];
            } else {
                url = (isUsdcSettled) ? url[accessibility]['usdc'] : url[accessibility]['contract'];
            }
        } else {
            if (isSpot) {
                url = url[accessibility]['spot'];
            } else if (type === 'swap') {
                let subType = undefined;
                [ subType, params ] = this.handleSubTypeAndParams (method, market, params, 'linear');
                url = url[accessibility][subType];
            } else {
                // option
                url = url[accessibility]['option'];
            }
        }
        url = this.implodeHostname (url);
        return url;
    }

    cleanParams (params) {
        params = this.omit (params, [ 'type', 'subType', 'settle', 'defaultSettle', 'unifiedMargin' ]);
        return params;
    }

    async watchTicker (symbol, params = {}) {
        /**
         * @method
         * @name bybit#watchTicker
         * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/ticker
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/etp-ticker
         * @param {string} symbol unified symbol of the market to fetch the ticker for
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/en/latest/manual.html#ticker-structure}
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        const messageHash = 'ticker:' + market['symbol'];
        const url = this.getUrlByMarketType (symbol, false, false, params);
        params = this.cleanParams (params);
        const options = this.safeValue (this.options, 'watchTicker', {});
        let topic = this.safeString (options, 'name', 'tickers');
        if (!market['spot'] && topic !== 'tickers') {
            throw new BadRequest (this.id + ' watchTicker() only supports name tickers for contract markets');
        }
        topic += '.' + market['id'];
        const topics = [ topic ];
        return await this.watchTopics (url, messageHash, topics, params);
    }

    handleTicker (client, message) {
        //
        // linear
        //     {
        //         "topic": "tickers.BTCUSDT",
        //         "type": "snapshot",
        //         "data": {
        //             "symbol": "BTCUSDT",
        //             "tickDirection": "PlusTick",
        //             "price24hPcnt": "0.017103",
        //             "lastPrice": "17216.00",
        //             "prevPrice24h": "16926.50",
        //             "highPrice24h": "17281.50",
        //             "lowPrice24h": "16915.00",
        //             "prevPrice1h": "17238.00",
        //             "markPrice": "17217.33",
        //             "indexPrice": "17227.36",
        //             "openInterest": "68744.761",
        //             "openInterestValue": "1183601235.91",
        //             "turnover24h": "1570383121.943499",
        //             "volume24h": "91705.276",
        //             "nextFundingTime": "1673280000000",
        //             "fundingRate": "-0.000212",
        //             "bid1Price": "17215.50",
        //             "bid1Size": "84.489",
        //             "ask1Price": "17216.00",
        //             "ask1Size": "83.020"
        //         },
        //         "cs": 24987956059,
        //         "ts": 1673272861686
        //     }
        //
        // option
        //     {
        //         "id": "tickers.BTC-6JAN23-17500-C-2480334983-1672917511074",
        //         "topic": "tickers.BTC-6JAN23-17500-C",
        //         "ts": 1672917511074,
        //         "data": {
        //             "symbol": "BTC-6JAN23-17500-C",
        //             "bidPrice": "0",
        //             "bidSize": "0",
        //             "bidIv": "0",
        //             "askPrice": "10",
        //             "askSize": "5.1",
        //             "askIv": "0.514",
        //             "lastPrice": "10",
        //             "highPrice24h": "25",
        //             "lowPrice24h": "5",
        //             "markPrice": "7.86976724",
        //             "indexPrice": "16823.73",
        //             "markPriceIv": "0.4896",
        //             "underlyingPrice": "16815.1",
        //             "openInterest": "49.85",
        //             "turnover24h": "446802.8473",
        //             "volume24h": "26.55",
        //             "totalVolume": "86",
        //             "totalTurnover": "1437431",
        //             "delta": "0.047831",
        //             "gamma": "0.00021453",
        //             "vega": "0.81351067",
        //             "theta": "-19.9115368",
        //             "predictedDeliveryPrice": "0",
        //             "change24h": "-0.33333334"
        //         },
        //         "type": "snapshot"
        //     }
        //
        // spot
        //     {
        //         "topic": "tickers.BTCUSDT",
        //         "ts": 1673853746003,
        //         "type": "snapshot",
        //         "cs": 2588407389,
        //         "data": {
        //             "symbol": "BTCUSDT",
        //             "lastPrice": "21109.77",
        //             "highPrice24h": "21426.99",
        //             "lowPrice24h": "20575",
        //             "prevPrice24h": "20704.93",
        //             "volume24h": "6780.866843",
        //             "turnover24h": "141946527.22907118",
        //             "price24hPcnt": "0.0196",
        //             "usdIndexPrice": "21120.2400136"
        //         }
        //     }
        //
        // lt ticker
        //     {
        //         "topic": "tickers_lt.EOS3LUSDT",
        //         "ts": 1672325446847,
        //         "type": "snapshot",
        //         "data": {
        //             "symbol": "EOS3LUSDT",
        //             "lastPrice": "0.41477848043290448",
        //             "highPrice24h": "0.435285472510871305",
        //             "lowPrice24h": "0.394601507960931382",
        //             "prevPrice24h": "0.431502290172376349",
        //             "price24hPcnt": "-0.0388"
        //         }
        //     }
        //
        const topic = this.safeString (message, 'topic', '');
        const updateType = this.safeString (message, 'type', '');
        const data = this.safeValue (message, 'data', {});
        const isSpot = this.safeString (data, 's') !== undefined;
        let symbol = undefined;
        let parsed = undefined;
        if ((updateType === 'snapshot') || isSpot) {
            parsed = this.parseTicker (data);
            symbol = parsed['symbol'];
        } else if (updateType === 'delta') {
            const topicParts = topic.split ('.');
            const topicLength = topicParts.length;
            const marketId = this.safeString (topicParts, topicLength - 1);
            const market = this.market (marketId);
            symbol = market['symbol'];
            // update the info in place
            const ticker = this.safeValue (this.tickers, symbol, {});
            const rawTicker = this.safeValue (ticker, 'info', {});
            const merged = this.extend (rawTicker, data);
            parsed = this.parseTicker (merged);
        }
        const timestamp = this.safeInteger (message, 'ts');
        parsed['timestamp'] = timestamp;
        parsed['datetime'] = this.iso8601 (timestamp);
        this.tickers[symbol] = parsed;
        const messageHash = 'ticker:' + symbol;
        client.resolve (this.tickers[symbol], messageHash);
    }

    async watchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name bybit#watchOHLCV
         * @description watches historical candlestick data containing the open, high, low, and close price, and the volume of a market
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/kline
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/etp-kline
         * @param {string} symbol unified symbol of the market to fetch OHLCV data for
         * @param {string} timeframe the length of time each candle represents
         * @param {int|undefined} since timestamp in ms of the earliest candle to fetch
         * @param {int|undefined} limit the maximum amount of candles to fetch
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {[[int]]} A list of candles ordered as timestamp, open, high, low, close, volume
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.getUrlByMarketType (symbol, false, false, params);
        params = this.cleanParams (params);
        let ohlcv = undefined;
        const timeframeId = this.safeString (this.timeframes, timeframe, timeframe);
        const topics = [ 'kline.' + timeframeId + '.' + market['id'] ];
        const messageHash = 'kline' + ':' + timeframeId + ':' + symbol;
        ohlcv = await this.watchTopics (url, messageHash, topics, params);
        if (this.newUpdates) {
            limit = ohlcv.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (ohlcv, since, limit, 0, true);
    }

    handleOHLCV (client, message) {
        //
        //     {
        //         "topic": "kline.5.BTCUSDT",
        //         "data": [
        //             {
        //                 "start": 1672324800000,
        //                 "end": 1672325099999,
        //                 "interval": "5",
        //                 "open": "16649.5",
        //                 "close": "16677",
        //                 "high": "16677",
        //                 "low": "16608",
        //                 "volume": "2.081",
        //                 "turnover": "34666.4005",
        //                 "confirm": false,
        //                 "timestamp": 1672324988882
        //             }
        //         ],
        //         "ts": 1672324988882,
        //         "type": "snapshot"
        //     }
        //
        const data = this.safeValue (message, 'data', {});
        const topic = this.safeString (message, 'topic');
        const topicParts = topic.split ('.');
        const topicLength = topicParts.length;
        const timeframeId = this.safeString (topicParts, 1);
        const marketId = this.safeString (topicParts, topicLength - 1);
        const isSpot = client.url.indexOf ('spot') > -1;
        const marketType = isSpot ? 'spot' : 'contract';
        const market = this.safeMarket (marketId, undefined, undefined, marketType);
        const symbol = market['symbol'];
        const ohlcvsByTimeframe = this.safeValue (this.ohlcvs, symbol);
        if (ohlcvsByTimeframe === undefined) {
            this.ohlcvs[symbol] = {};
        }
        let stored = this.safeValue (ohlcvsByTimeframe, timeframeId);
        if (stored === undefined) {
            const limit = this.safeInteger (this.options, 'OHLCVLimit', 1000);
            stored = new ArrayCacheByTimestamp (limit);
            this.ohlcvs[symbol][timeframeId] = stored;
        }
        for (let i = 0; i < data.length; i++) {
            const parsed = this.parseWsOHLCV (data[i]);
            stored.append (parsed);
        }
        const messageHash = 'kline' + ':' + timeframeId + ':' + symbol;
        client.resolve (stored, messageHash);
    }

    parseWsOHLCV (ohlcv) {
        //
        //     {
        //         "start": 1670363160000,
        //         "end": 1670363219999,
        //         "interval": "1",
        //         "open": "16987.5",
        //         "close": "16987.5",
        //         "high": "16988",
        //         "low": "16987.5",
        //         "volume": "23.511",
        //         "turnover": "399396.344",
        //         "confirm": false,
        //         "timestamp": 1670363219614
        //     }
        //
        return [
            this.safeInteger (ohlcv, 'timestamp'),
            this.safeNumber (ohlcv, 'open'),
            this.safeNumber (ohlcv, 'high'),
            this.safeNumber (ohlcv, 'low'),
            this.safeNumber (ohlcv, 'close'),
            this.safeNumber2 (ohlcv, 'volume', 'turnover'),
        ];
    }

    async watchOrderBook (symbol, limit = undefined, params = {}) {
        /**
         * @method
         * @name bybit#watchOrderBook
         * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
         * @param {string} symbol unified symbol of the market to fetch the order book for
         * @param {int|undefined} limit the maximum amount of order book entries to return.
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {object} A dictionary of [order book structures]{@link https://docs.ccxt.com/en/latest/manual.html#order-book-structure} indexed by market symbols
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.getUrlByMarketType (symbol, false, false, params);
        params = this.cleanParams (params);
        const messageHash = 'orderbook' + ':' + symbol;
        if (limit === undefined) {
            if (market['spot']) {
                limit = 50;
            } else {
                limit = 500;
            }
        } else {
            if (!market['spot']) {
                // bybit only support limit 1, 50, 200, 500 for contract
                if ((limit !== 1) && (limit !== 50) && (limit !== 200) && (limit !== 500)) {
                    throw new BadRequest (this.id + ' watchOrderBook() can only use limit 1, 50, 200 and 500.');
                }
            }
        }
        const topics = [ 'orderbook.' + limit.toString () + '.' + market['id'] ];
        const orderbook = await this.watchTopics (url, messageHash, topics, params);
        return orderbook.limit ();
    }

    handleOrderBook (client, message) {
        //
        //     {
        //         "topic": "orderbook.50.BTCUSDT",
        //         "type": "snapshot",
        //         "ts": 1672304484978,
        //         "data": {
        //             "s": "BTCUSDT",
        //             "b": [
        //                 ...,
        //                 [
        //                     "16493.50",
        //                     "0.006"
        //                 ],
        //                 [
        //                     "16493.00",
        //                     "0.100"
        //                 ]
        //             ],
        //             "a": [
        //                 [
        //                     "16611.00",
        //                     "0.029"
        //                 ],
        //                 [
        //                     "16612.00",
        //                     "0.213"
        //                 ],
        //             ],
        //             "u": 18521288,
        //             "seq": 7961638724
        //         }
        //     }
        //
        const isSpot = client.url.indexOf ('spot') >= 0;
        const type = this.safeString (message, 'type');
        const isSnapshot = (type === 'snapshot');
        const data = this.safeValue (message, 'data', {});
        const marketId = this.safeString (data, 's');
        const marketType = isSpot ? 'spot' : 'contract';
        const market = this.safeMarket (marketId, undefined, undefined, marketType);
        const symbol = market['symbol'];
        const timestamp = this.safeInteger (message, 'ts');
        let orderbook = this.safeValue (this.orderbooks, symbol);
        if (orderbook === undefined) {
            orderbook = this.orderBook ();
        }
        if (isSnapshot) {
            const snapshot = this.parseOrderBook (data, symbol, timestamp, 'b', 'a');
            orderbook.reset (snapshot);
        } else {
            const asks = this.safeValue (data, 'a', []);
            const bids = this.safeValue (data, 'b', []);
            this.handleDeltas (orderbook['asks'], asks);
            this.handleDeltas (orderbook['bids'], bids);
            orderbook['timestamp'] = timestamp;
            orderbook['datetime'] = this.iso8601 (timestamp);
        }
        const messageHash = 'orderbook' + ':' + symbol;
        this.orderbooks[symbol] = orderbook;
        client.resolve (orderbook, messageHash);
    }

    handleDelta (bookside, delta) {
        const bidAsk = this.parseBidAsk (delta, 0, 1);
        bookside.storeArray (bidAsk);
    }

    handleDeltas (bookside, deltas) {
        for (let i = 0; i < deltas.length; i++) {
            this.handleDelta (bookside, deltas[i]);
        }
    }

    async watchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name bybit#watchTrades
         * @description watches information on multiple trades made in a market
         * @see https://bybit-exchange.github.io/docs/v5/websocket/public/trade
         * @param {string} symbol unified market symbol of the market orders were made in
         * @param {int|undefined} since the earliest time in ms to fetch orders for
         * @param {int|undefined} limit the maximum number of  orde structures to retrieve
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {[object]} a list of [order structures]{@link https://docs.ccxt.com/en/latest/manual.html#order-structure
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.getUrlByMarketType (symbol, false, false, params);
        params = this.cleanParams (params);
        const messageHash = 'trade:' + symbol;
        const topic = 'publicTrade.' + market['id'];
        const trades = await this.watchTopics (url, messageHash, [ topic ], params);
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleTrades (client, message) {
        //
        //     {
        //         "topic": "publicTrade.BTCUSDT",
        //         "type": "snapshot",
        //         "ts": 1672304486868,
        //         "data": [
        //             {
        //                 "T": 1672304486865,
        //                 "s": "BTCUSDT",
        //                 "S": "Buy",
        //                 "v": "0.001",
        //                 "p": "16578.50",
        //                 "L": "PlusTick",
        //                 "i": "20f43950-d8dd-5b31-9112-a178eb6023af",
        //                 "BT": false
        //             }
        //         ]
        //     }
        //
        const data = this.safeValue (message, 'data', {});
        const topic = this.safeString (message, 'topic');
        const trades = data;
        const parts = topic.split ('.');
        const isSpot = client.url.indexOf ('spot') >= 0;
        const marketType = (isSpot) ? 'spot' : 'contract';
        const marketId = this.safeString (parts, 1);
        const market = this.safeMarket (marketId, undefined, undefined, marketType);
        const symbol = market['symbol'];
        let stored = this.safeValue (this.trades, symbol);
        if (stored === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            stored = new ArrayCache (limit);
            this.trades[symbol] = stored;
        }
        for (let j = 0; j < trades.length; j++) {
            const parsed = this.parseWsTrade (trades[j], market);
            stored.append (parsed);
        }
        const messageHash = 'trade' + ':' + symbol;
        client.resolve (stored, messageHash);
    }

    parseWsTrade (trade, market = undefined) {
        //
        // public
        //    {
        //         "T": 1672304486865,
        //         "s": "BTCUSDT",
        //         "S": "Buy",
        //         "v": "0.001",
        //         "p": "16578.50",
        //         "L": "PlusTick",
        //         "i": "20f43950-d8dd-5b31-9112-a178eb6023af",
        //         "BT": false
        //     }
        //
        // spot private
        //     {
        //         "e": "ticketInfo",
        //         "E": "1662348310386",
        //         "s": "BTCUSDT",
        //         "q": "0.001007",
        //         "t": "1662348310373",
        //         "p": "19842.02",
        //         "T": "2100000000002220938",
        //         "o": "1238261807653647872",
        //         "c": "spotx008",
        //         "O": "1238225004531834368",
        //         "a": "533287",
        //         "A": "642908",
        //         "m": false,
        //         "S": "BUY"
        //     }
        //
        const id = this.safeStringN (trade, [ 'i', 'T', 'v' ]);
        const isContract = ('BT' in trade);
        let marketType = isContract ? 'contract' : 'spot';
        if (market !== undefined) {
            marketType = market['type'];
        }
        const marketId = this.safeString (trade, 's');
        market = this.safeMarket (marketId, market, undefined, marketType);
        const symbol = market['symbol'];
        const timestamp = this.safeInteger2 (trade, 't', 'T');
        let side = this.safeStringLower (trade, 'S');
        let takerOrMaker = undefined;
        const m = this.safeValue (trade, 'm');
        if (side === undefined) {
            side = m ? 'buy' : 'sell';
        } else {
            // spot private
            takerOrMaker = m;
        }
        const price = this.safeString (trade, 'p');
        const amount = this.safeString2 (trade, 'q', 'v');
        const orderId = this.safeString (trade, 'o');
        return this.safeTrade ({
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'order': orderId,
            'type': undefined,
            'side': side,
            'takerOrMaker': takerOrMaker,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'fee': undefined,
        }, market);
    }

    getPrivateType (url) {
        if (url.indexOf ('spot') >= 0) {
            return 'spot';
        } else if (url.indexOf ('v5/private') >= 0) {
            return 'unified';
        } else {
            return 'usdc';
        }
    }

    async watchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name bybit#watchMyTrades
         * @description watches information on multiple trades made by the user
         * @see https://bybit-exchange.github.io/docs/v5/websocket/private/execution
         * @param {string} symbol unified market symbol of the market orders were made in
         * @param {int|undefined} since the earliest time in ms to fetch orders for
         * @param {int|undefined} limit the maximum number of  orde structures to retrieve
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @param {boolean} params.unifiedMargin use unified margin account
         * @returns {[object]} a list of [order structures]{@link https://docs.ccxt.com/en/latest/manual.html#order-structure
         */
        const method = 'watchMyTrades';
        let messageHash = 'myTrades';
        await this.loadMarkets ();
        if (symbol !== undefined) {
            symbol = this.symbol (symbol);
            messageHash += ':' + symbol;
        }
        const unified = await this.isUnifiedEnabled ();
        const isUnifiedMargin = this.safeValue (unified, 0, false);
        const url = this.getUrlByMarketType (symbol, true, isUnifiedMargin, method, params);
        await this.authenticate (url);
        const topicByMarket = {
            'spot': 'ticketInfo',
            'unified': 'execution',
            'usdc': 'user.openapi.perp.trade',
        };
        const topic = this.safeValue (topicByMarket, this.getPrivateType (url));
        const trades = await this.watchTopics (url, messageHash, [ topic ], params);
        if (this.newUpdates) {
            limit = trades.getLimit (symbol, limit);
        }
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleMyTrades (client, message) {
        //
        // spot
        //    {
        //        "type": "snapshot",
        //        "topic": "ticketInfo",
        //        "ts": "1662348310388",
        //        "data": [
        //            {
        //                "e": "ticketInfo",
        //                "E": "1662348310386",
        //                "s": "BTCUSDT",
        //                "q": "0.001007",
        //                "t": "1662348310373",
        //                "p": "19842.02",
        //                "T": "2100000000002220938",
        //                "o": "1238261807653647872",
        //                "c": "spotx008",
        //                "O": "1238225004531834368",
        //                "a": "533287",
        //                "A": "642908",
        //                "m": false,
        //                "S": "BUY"
        //            }
        //        ]
        //    }
        // unified
        //     {
        //         "id": "592324803b2785-26fa-4214-9963-bdd4727f07be",
        //         "topic": "execution",
        //         "creationTime": 1672364174455,
        //         "data": [
        //             {
        //                 "category": "linear",
        //                 "symbol": "XRPUSDT",
        //                 "execFee": "0.005061",
        //                 "execId": "7e2ae69c-4edf-5800-a352-893d52b446aa",
        //                 "execPrice": "0.3374",
        //                 "execQty": "25",
        //                 "execType": "Trade",
        //                 "execValue": "8.435",
        //                 "isMaker": false,
        //                 "feeRate": "0.0006",
        //                 "tradeIv": "",
        //                 "markIv": "",
        //                 "blockTradeId": "",
        //                 "markPrice": "0.3391",
        //                 "indexPrice": "",
        //                 "underlyingPrice": "",
        //                 "leavesQty": "0",
        //                 "orderId": "f6e324ff-99c2-4e89-9739-3086e47f9381",
        //                 "orderLinkId": "",
        //                 "orderPrice": "0.3207",
        //                 "orderQty": "25",
        //                 "orderType": "Market",
        //                 "stopOrderType": "UNKNOWN",
        //                 "side": "Sell",
        //                 "execTime": "1672364174443",
        //                 "isLeverage": "0"
        //             }
        //         ]
        //     }
        //
        const topic = this.safeString (message, 'topic');
        const spot = topic === 'ticketInfo';
        let data = this.safeValue (message, 'data', []);
        if (!Array.isArray (data)) {
            data = this.safeValue (data, 'result', []);
        }
        if (this.myTrades === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            this.myTrades = new ArrayCacheBySymbolById (limit);
        }
        const trades = this.myTrades;
        const symbols = {};
        const method = spot ? 'parseWsTrade' : 'parseTrade';
        for (let i = 0; i < data.length; i++) {
            const rawTrade = data[i];
            const parsed = this[method] (rawTrade);
            const symbol = parsed['symbol'];
            symbols[symbol] = true;
            trades.append (parsed);
        }
        const keys = Object.keys (symbols);
        for (let i = 0; i < keys.length; i++) {
            const messageHash = 'myTrades:' + keys[i];
            client.resolve (trades, messageHash);
        }
        // non-symbol specific
        const messageHash = 'myTrades';
        client.resolve (trades, messageHash);
    }

    async watchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        /**
         * @method
         * @name bybit#watchOrders
         * @description watches information on multiple orders made by the user
         * @see https://bybit-exchange.github.io/docs/v5/websocket/private/order
         * @param {string|undefined} symbol unified market symbol of the market orders were made in
         * @param {int|undefined} since the earliest time in ms to fetch orders for
         * @param {int|undefined} limit the maximum number of  orde structures to retrieve
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {[object]} a list of [order structures]{@link https://docs.ccxt.com/en/latest/manual.html#order-structure
         */
        await this.loadMarkets ();
        const method = 'watchOrders';
        let messageHash = 'orders';
        if (symbol !== undefined) {
            symbol = this.symbol (symbol);
            messageHash += ':' + symbol;
        }
        const unified = await this.isUnifiedEnabled ();
        const isUnifiedMargin = this.safeValue (unified, 0, false);
        const url = this.getUrlByMarketType (symbol, true, isUnifiedMargin, method, params);
        await this.authenticate (url);
        const topicsByMarket = {
            'spot': [ 'order', 'stopOrder' ],
            'unified': [ 'order' ],
            'usdc': [ 'user.openapi.perp.order' ],
        };
        const topics = this.safeValue (topicsByMarket, this.getPrivateType (url));
        const orders = await this.watchTopics (url, messageHash, topics, params);
        if (this.newUpdates) {
            limit = orders.getLimit (symbol, limit);
        }
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    handleOrder (client, message, subscription = undefined) {
        //
        //     spot
        //     {
        //         "type": "snapshot",
        //         "topic": "order",
        //         "ts": "1662348310441",
        //         "data": [
        //             {
        //                 "e": "order",
        //                 "E": "1662348310441",
        //                 "s": "BTCUSDT",
        //                 "c": "spotx008",
        //                 "S": "BUY",
        //                 "o": "MARKET_OF_QUOTE",
        //                 "f": "GTC",
        //                 "q": "20",
        //                 "p": "0",
        //                 "X": "CANCELED",
        //                 "i": "1238261807653647872",
        //                 "M": "1238225004531834368",
        //                 "l": "0.001007",
        //                 "z": "0.001007",
        //                 "L": "19842.02",
        //                 "n": "0",
        //                 "N": "BTC",
        //                 "u": true,
        //                 "w": true,
        //                 "m": false,
        //                 "O": "1662348310368",
        //                 "Z": "19.98091414",
        //                 "A": "0",
        //                 "C": false,
        //                 "v": "0",
        //                 "d": "NO_LIQ",
        //                 "t": "2100000000002220938"
        //             }
        //         ]
        //     }
        // unified
        //     {
        //         "id": "5923240c6880ab-c59f-420b-9adb-3639adc9dd90",
        //         "topic": "order",
        //         "creationTime": 1672364262474,
        //         "data": [
        //             {
        //                 "symbol": "ETH-30DEC22-1400-C",
        //                 "orderId": "5cf98598-39a7-459e-97bf-76ca765ee020",
        //                 "side": "Sell",
        //                 "orderType": "Market",
        //                 "cancelType": "UNKNOWN",
        //                 "price": "72.5",
        //                 "qty": "1",
        //                 "orderIv": "",
        //                 "timeInForce": "IOC",
        //                 "orderStatus": "Filled",
        //                 "orderLinkId": "",
        //                 "lastPriceOnCreated": "",
        //                 "reduceOnly": false,
        //                 "leavesQty": "",
        //                 "leavesValue": "",
        //                 "cumExecQty": "1",
        //                 "cumExecValue": "75",
        //                 "avgPrice": "75",
        //                 "blockTradeId": "",
        //                 "positionIdx": 0,
        //                 "cumExecFee": "0.358635",
        //                 "createdTime": "1672364262444",
        //                 "updatedTime": "1672364262457",
        //                 "rejectReason": "EC_NoError",
        //                 "stopOrderType": "",
        //                 "triggerPrice": "",
        //                 "takeProfit": "",
        //                 "stopLoss": "",
        //                 "tpTriggerBy": "",
        //                 "slTriggerBy": "",
        //                 "triggerDirection": 0,
        //                 "triggerBy": "",
        //                 "closeOnTrigger": false,
        //                 "category": "option"
        //             }
        //         ]
        //     }
        //
        const type = this.safeString (message, 'type', '');
        if (this.orders === undefined) {
            const limit = this.safeInteger (this.options, 'ordersLimit', 1000);
            this.orders = new ArrayCacheBySymbolById (limit);
        }
        const orders = this.orders;
        let rawOrders = [];
        let parser = undefined;
        if (type === 'snapshot') {
            rawOrders = this.safeValue (message, 'data', []);
            parser = 'parseWsSpotOrder';
        } else {
            parser = 'parseContractOrder';
            rawOrders = this.safeValue (message, 'data', []);
            rawOrders = this.safeValue (rawOrders, 'result', rawOrders);
        }
        const symbols = {};
        for (let i = 0; i < rawOrders.length; i++) {
            const parsed = this[parser] (rawOrders[i]);
            const symbol = parsed['symbol'];
            symbols[symbol] = true;
            orders.append (parsed);
        }
        const symbolsArray = Object.keys (symbols);
        for (let i = 0; i < symbolsArray.length; i++) {
            const messageHash = 'orders:' + symbolsArray[i];
            client.resolve (orders, messageHash);
        }
        const messageHash = 'orders';
        client.resolve (orders, messageHash);
    }

    parseWsSpotOrder (order, market = undefined) {
        //
        //    {
        //        e: 'executionReport',
        //        E: '1653297251061', // timestamp
        //        s: 'LTCUSDT', // symbol
        //        c: '1653297250740', // user id
        //        S: 'SELL', // side
        //        o: 'MARKET_OF_BASE', // order type
        //        f: 'GTC', // time in force
        //        q: '0.16233', // quantity
        //        p: '0', // price
        //        X: 'NEW', // status
        //        i: '1162336018974750208', // order id
        //        M: '0',
        //        l: '0', // last filled
        //        z: '0', // total filled
        //        L: '0', // last traded price
        //        n: '0', // trading fee
        //        N: '', // fee asset
        //        u: true,
        //        w: true,
        //        m: false, // is limit_maker
        //        O: '1653297251042', // order creation
        //        Z: '0', // total filled
        //        A: '0', // account id
        //        C: false, // is close
        //        v: '0', // leverage
        //        d: 'NO_LIQ'
        //    }
        //
        const id = this.safeString (order, 'i');
        const marketId = this.safeString (order, 's');
        const symbol = this.safeSymbol (marketId, market, undefined, 'spot');
        const timestamp = this.safeInteger (order, 'O');
        let price = this.safeString (order, 'p');
        if (price === '0') {
            price = undefined; // market orders
        }
        const filled = this.safeString (order, 'z');
        const status = this.parseOrderStatus (this.safeString (order, 'X'));
        const side = this.safeStringLower (order, 'S');
        const lastTradeTimestamp = this.safeString (order, 'E');
        const timeInForce = this.safeString (order, 'f');
        let amount = undefined;
        const cost = this.safeString (order, 'Z');
        const q = this.safeString (order, 'q');
        let type = this.safeStringLower (order, 'o');
        if (type.indexOf ('quote') >= 0) {
            amount = filled;
        } else {
            amount = q;
        }
        if (type.indexOf ('market') >= 0) {
            type = 'market';
        }
        let fee = undefined;
        const feeCost = this.safeString (order, 'n');
        if (feeCost !== undefined && feeCost !== '0') {
            const feeCurrencyId = this.safeString (order, 'N');
            const feeCurrencyCode = this.safeCurrencyCode (feeCurrencyId);
            fee = {
                'cost': feeCost,
                'currency': feeCurrencyCode,
            };
        }
        return this.safeOrder ({
            'info': order,
            'id': id,
            'clientOrderId': this.safeString (order, 'c'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'symbol': symbol,
            'type': type,
            'timeInForce': timeInForce,
            'postOnly': undefined,
            'side': side,
            'price': price,
            'stopPrice': undefined,
            'triggerPrice': undefined,
            'amount': amount,
            'cost': cost,
            'average': undefined,
            'filled': filled,
            'remaining': undefined,
            'status': status,
            'fee': fee,
        }, market);
    }

    async watchBalance (params = {}) {
        /**
         * @method
         * @name bybit#watchBalance
         * @description query for balance and get the amount of funds available for trading or funds locked in orders
         * @see https://bybit-exchange.github.io/docs/v5/websocket/private/wallet
         * @param {object} params extra parameters specific to the bybit api endpoint
         * @returns {object} a [balance structure]{@link https://docs.ccxt.com/en/latest/manual.html?#balance-structure}
         */
        const method = 'watchBalance';
        const messageHash = 'balances';
        const url = this.getUrlByMarketType (undefined, true, true, method, params);
        await this.authenticate (url);
        const topicByMarket = {
            'spot': 'outboundAccountInfo',
            'unified': 'wallet',
        };
        const topics = [ this.safeValue (topicByMarket, this.getPrivateType (url)) ];
        return await this.watchTopics (url, messageHash, topics, params);
    }

    handleBalance (client, message) {
        //
        // spot
        //    {
        //        "type": "snapshot",
        //        "topic": "outboundAccountInfo",
        //        "ts": "1662107217641",
        //        "data": [
        //            {
        //                "e": "outboundAccountInfo",
        //                "E": "1662107217640",
        //                "T": true,
        //                "W": true,
        //                "D": true,
        //                "B": [
        //                    {
        //                        "a": "USDT",
        //                        "f": "176.81254174",
        //                        "l": "201.575"
        //                    }
        //                ]
        //            }
        //        ]
        //    }
        // unified
        //     {
        //         "id": "5923242c464be9-25ca-483d-a743-c60101fc656f",
        //         "topic": "wallet",
        //         "creationTime": 1672364262482,
        //         "data": [
        //             {
        //                 "accountIMRate": "0.016",
        //                 "accountMMRate": "0.003",
        //                 "totalEquity": "12837.78330098",
        //                 "totalWalletBalance": "12840.4045924",
        //                 "totalMarginBalance": "12837.78330188",
        //                 "totalAvailableBalance": "12632.05767702",
        //                 "totalPerpUPL": "-2.62129051",
        //                 "totalInitialMargin": "205.72562486",
        //                 "totalMaintenanceMargin": "39.42876721",
        //                 "coin": [
        //                     {
        //                         "coin": "USDC",
        //                         "equity": "200.62572554",
        //                         "usdValue": "200.62572554",
        //                         "walletBalance": "201.34882644",
        //                         "availableToWithdraw": "0",
        //                         "availableToBorrow": "1500000",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "0",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "202.99874213",
        //                         "totalPositionMM": "39.14289747",
        //                         "unrealisedPnl": "74.2768991",
        //                         "cumRealisedPnl": "-209.1544627",
        //                         "bonus": "0"
        //                     },
        //                     {
        //                         "coin": "BTC",
        //                         "equity": "0.06488393",
        //                         "usdValue": "1023.08402268",
        //                         "walletBalance": "0.06488393",
        //                         "availableToWithdraw": "0.06488393",
        //                         "availableToBorrow": "2.5",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "0",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "0",
        //                         "totalPositionMM": "0",
        //                         "unrealisedPnl": "0",
        //                         "cumRealisedPnl": "0",
        //                         "bonus": "0"
        //                     },
        //                     {
        //                         "coin": "ETH",
        //                         "equity": "0",
        //                         "usdValue": "0",
        //                         "walletBalance": "0",
        //                         "availableToWithdraw": "0",
        //                         "availableToBorrow": "26",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "0",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "0",
        //                         "totalPositionMM": "0",
        //                         "unrealisedPnl": "0",
        //                         "cumRealisedPnl": "0",
        //                         "bonus": "0"
        //                     },
        //                     {
        //                         "coin": "USDT",
        //                         "equity": "11726.64664904",
        //                         "usdValue": "11613.58597018",
        //                         "walletBalance": "11728.54414904",
        //                         "availableToWithdraw": "11723.92075829",
        //                         "availableToBorrow": "2500000",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "0",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "2.72589075",
        //                         "totalPositionMM": "0.28576575",
        //                         "unrealisedPnl": "-1.8975",
        //                         "cumRealisedPnl": "0.64782276",
        //                         "bonus": "0"
        //                     },
        //                     {
        //                         "coin": "EOS3L",
        //                         "equity": "215.0570412",
        //                         "usdValue": "0",
        //                         "walletBalance": "215.0570412",
        //                         "availableToWithdraw": "215.0570412",
        //                         "availableToBorrow": "0",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "0",
        //                         "totalPositionMM": "0",
        //                         "unrealisedPnl": "0",
        //                         "cumRealisedPnl": "0",
        //                         "bonus": "0"
        //                     },
        //                     {
        //                         "coin": "BIT",
        //                         "equity": "1.82",
        //                         "usdValue": "0.48758257",
        //                         "walletBalance": "1.82",
        //                         "availableToWithdraw": "1.82",
        //                         "availableToBorrow": "0",
        //                         "borrowAmount": "0",
        //                         "accruedInterest": "",
        //                         "totalOrderIM": "0",
        //                         "totalPositionIM": "0",
        //                         "totalPositionMM": "0",
        //                         "unrealisedPnl": "0",
        //                         "cumRealisedPnl": "0",
        //                         "bonus": "0"
        //                     }
        //                 ],
        //                 "accountType": "UNIFIED"
        //             }
        //         ]
        //     }
        //
        if (this.balance === undefined) {
            this.balance = {};
        }
        let messageHash = 'balance';
        const topic = this.safeValue (message, 'topic');
        let info = undefined;
        let rawBalances = [];
        if (topic === 'outboundAccountInfo') {
            const data = this.safeValue (message, 'data', []);
            for (let i = 0; i < data.length; i++) {
                const B = this.safeValue (data[i], 'B', []);
                rawBalances = this.arrayConcat (rawBalances, B);
            }
            info = rawBalances;
        }
        if (topic === 'wallet') {
            const data = this.safeValue (message, 'data', {});
            for (let i = 0; i < data.length; i++) {
                const result = this.safeValue (data, 0, {});
                rawBalances = rawBalances.concat (this.safeValue (result, 'coin', []));
            }
            info = data;
        }
        for (let i = 0; i < rawBalances.length; i++) {
            this.parseWsBalance (rawBalances[i]);
        }
        this.balance['info'] = info;
        const timestamp = this.safeInteger (message, 'ts');
        this.balance['timestamp'] = timestamp;
        this.balance['datetime'] = this.iso8601 (timestamp);
        this.balance = this.safeBalance (this.balance);
        messageHash = 'balances';
        client.resolve (this.balance, messageHash);
    }

    parseWsBalance (balance) {
        //
        // spot
        //    {
        //        "a": "USDT",
        //        "f": "176.81254174",
        //        "l": "201.575"
        //    }
        // unified
        //     {
        //         "coin": "BTC",
        //         "equity": "0.06488393",
        //         "usdValue": "1023.08402268",
        //         "walletBalance": "0.06488393",
        //         "availableToWithdraw": "0.06488393",
        //         "availableToBorrow": "2.5",
        //         "borrowAmount": "0",
        //         "accruedInterest": "0",
        //         "totalOrderIM": "0",
        //         "totalPositionIM": "0",
        //         "totalPositionMM": "0",
        //         "unrealisedPnl": "0",
        //         "cumRealisedPnl": "0",
        //         "bonus": "0"
        //     }
        //
        const account = this.account ();
        const currencyId = this.safeString2 (balance, 'a', 'coin');
        const code = this.safeCurrencyCode (currencyId);
        account['free'] = this.safeString2 (balance, 'availableToWithdraw', 'f');
        account['used'] = this.safeString (balance, 'l');
        account['total'] = this.safeString (balance, 'walletBalance');
        this.balance[code] = account;
    }

    async watchTopics (url, messageHash, topics = [], params = {}) {
        const request = {
            'op': 'subscribe',
            'req_id': this.requestId (),
            'args': topics,
        };
        const message = this.extend (request, params);
        return await this.watch (url, messageHash, message, messageHash);
    }

    authenticate (url, params = {}) {
        this.checkRequiredCredentials ();
        const messageHash = 'authenticated';
        const client = this.client (url);
        let future = this.safeValue (client.subscriptions, messageHash);
        if (future === undefined) {
            let expires = this.milliseconds () + 10000;
            expires = expires.toString ();
            const path = 'GET/realtime';
            const auth = path + expires;
            const signature = this.hmac (this.encode (auth), this.encode (this.secret), 'sha256', 'hex');
            const request = {
                'op': 'auth',
                'args': [
                    this.apiKey, expires, signature,
                ],
            };
            const message = this.extend (request, params);
            future = this.watch (url, messageHash, message);
            client.subscriptions[messageHash] = future;
        }
        return future;
    }

    handleErrorMessage (client, message) {
        //
        //   {
        //       success: false,
        //       ret_msg: 'error:invalid op',
        //       conn_id: '5e079fdd-9c7f-404d-9dbf-969d650838b5',
        //       request: { op: '', args: null }
        //   }
        //
        // auth error
        //
        //   {
        //       success: false,
        //       ret_msg: 'error:USVC1111',
        //       conn_id: 'e73770fb-a0dc-45bd-8028-140e20958090',
        //       request: {
        //         op: 'auth',
        //         args: [
        //           '9rFT6uR4uz9Imkw4Wx',
        //           '1653405853543',
        //           '542e71bd85597b4db0290f0ce2d13ed1fd4bb5df3188716c1e9cc69a879f7889'
        //         ]
        //   }
        //
        //   { code: '-10009', desc: 'Invalid period!' }
        //
        const code = this.safeString2 (message, 'code', 'ret_code');
        try {
            if (code !== undefined) {
                const feedback = this.id + ' ' + this.json (message);
                this.throwExactlyMatchedException (this.exceptions['exact'], code, feedback);
            }
            const success = this.safeValue (message, 'success');
            if (success !== undefined && !success) {
                const ret_msg = this.safeString (message, 'ret_msg');
                const request = this.safeValue (message, 'request', {});
                const op = this.safeString (request, 'op');
                if (op === 'auth') {
                    throw new AuthenticationError ('Authentication failed: ' + ret_msg);
                } else {
                    throw new ExchangeError (this.id + ' ' + ret_msg);
                }
            }
            return false;
        } catch (error) {
            if (error instanceof AuthenticationError) {
                const messageHash = 'authenticated';
                client.reject (error, messageHash);
                if (messageHash in client.subscriptions) {
                    delete client.subscriptions[messageHash];
                }
            } else {
                client.reject (error);
            }
            return true;
        }
    }

    handleMessage (client, message) {
        if (this.handleErrorMessage (client, message)) {
            return;
        }
        // contract pong
        const ret_msg = this.safeString (message, 'ret_msg');
        if (ret_msg === 'pong') {
            this.handlePong (client, message);
            return;
        }
        // spot pong
        const pong = this.safeInteger (message, 'pong');
        if (pong !== undefined) {
            this.handlePong (client, message);
            return;
        }
        // pong
        const op = this.safeString (message, 'op');
        if (op === 'pong') {
            this.handlePong (client, message);
            return;
        }
        const event = this.safeString (message, 'event');
        if (event === 'sub') {
            this.handleSubscriptionStatus (client, message);
            return;
        }
        const topic = this.safeString (message, 'topic', '');
        const methods = {
            'orderbook': this.handleOrderBook,
            'kline': this.handleOHLCV,
            'order': this.handleOrder,
            'stopOrder': this.handleOrder,
            'ticker': this.handleTicker,
            'trade': this.handleTrades,
            'publicTrade': this.handleTrades,
            'depth': this.handleOrderBook,
            'wallet': this.handleBalance,
            'outboundAccountInfo': this.handleBalance,
            'execution': this.handleMyTrades,
            'ticketInfo': this.handleMyTrades,
            'user.openapi.perp.trade': this.handleMyTrades,
        };
        const exacMethod = this.safeValue (methods, topic);
        if (exacMethod !== undefined) {
            exacMethod.call (this, client, message);
            return;
        }
        const keys = Object.keys (methods);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (topic.indexOf (keys[i]) >= 0) {
                const method = methods[key];
                method.call (this, client, message);
                return;
            }
        }
        // unified auth acknowledgement
        const type = this.safeString (message, 'type');
        if ((op === 'auth') || (type === 'AUTH_RESP')) {
            this.handleAuthenticate (client, message);
        }
    }

    ping (client) {
        return {
            'req_id': this.requestId (),
            'op': 'ping',
        };
    }

    handlePong (client, message) {
        //
        //   {
        //       success: true,
        //       ret_msg: 'pong',
        //       conn_id: 'db3158a0-8960-44b9-a9de-ac350ee13158',
        //       request: { op: 'ping', args: null }
        //   }
        //
        //   { pong: 1653296711335 }
        //
        client.lastPong = this.safeInteger (message, 'pong');
        return message;
    }

    handleAuthenticate (client, message) {
        //
        //    {
        //        success: true,
        //        ret_msg: '',
        //        op: 'auth',
        //        conn_id: 'ce3dpomvha7dha97tvp0-2xh'
        //    }
        //
        const success = this.safeValue (message, 'success');
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

    handleSubscriptionStatus (client, message) {
        //
        //    {
        //        topic: 'kline',
        //        event: 'sub',
        //        params: {
        //          symbol: 'LTCUSDT',
        //          binary: 'false',
        //          klineType: '1m',
        //          symbolName: 'LTCUSDT'
        //        },
        //        code: '0',
        //        msg: 'Success'
        //    }
        //
        return message;
    }
};
