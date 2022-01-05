'use strict';

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');
const time = require ('./base/functions/time');

module.exports = class wazirx extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'wazirx',
            'name': 'WazirX',
            'countries': ['IN'],
            'version': 'v2',
            'has': {
                'CORS': true,
                'fetchMarkets': true,
                'fetchCurrencies': false,
                'fetchTickers': true,
                'fetchTicker': true,
                'fetchOHLCV': false,
                'fetchOrderBook': true,
                'fetchTrades': false,
                'fetchTime': true,
                'fetchStatus': true,
            },
            'urls': {
                'logo': 'https://i0.wp.com/blog.wazirx.com/wp-content/uploads/2020/06/banner.png',
                'api': {
                    'spot': {
                        'v1': 'https://api.wazirx.com/sapi/v1',
                    },
                },
                'www': 'https://wazirx.com',
                'doc': 'https://github.com/WazirX/wazirx-api',
            },
            'api': {
                'spot': {
                    'v1': {
                        'public': {
                            'get': [
                                'ping',
                                'systemStatus',
                                'exchangeInfo',
                                'tickers/24hr',
                                'ticker/24hr',
                                'depth',
                                'trades',
                                'time',
                                'historicalTrades',
                            ],
                        },
                    },
                },
            },
            'exceptions': {
                'exact': {
                    '403': 'ab',
                },
            },
            'options': {
                'cachedMarketData': {},
            },
        });
    }

    async fetchMarkets (params = {}) {
        // check filters
        const response = await this.spotV1PublicGetExchangeInfo (params);
        //
        // {
        //     "timezone":"UTC",
        //     "serverTime":1641336850932,
        //     "symbols":[
        //     {
        //         "symbol":"btcinr",
        //         "status":"trading",
        //         "baseAsset":"btc",
        //         "quoteAsset":"inr",
        //         "baseAssetPrecision":5,
        //         "quoteAssetPrecision":0,
        //         "orderTypes":[
        //             "limit",
        //             "stop_limit"
        //         ],
        //         "isSpotTradingAllowed":true,
        //         "filters":[
        //             {
        //                 "filterType":"PRICE_FILTER",
        //                 "minPrice":"1",
        //                 "tickSize":"1"
        //             }
        //         ]
        //     },
        //
        const markets = this.safeValue (response, 'symbols', []);
        const result = [];
        for (let i = 0; i < markets.length; i++) {
            const entry = markets[i];
            const id = this.safeString (entry, 'symbol');
            const baseId = this.safeString (entry, 'baseAsset');
            const quoteId = this.safeString (entry, 'quoteAsset');
            const base = this.safeCurrencyCode (baseId);
            const quote = this.safeCurrencyCode (quoteId);
            const symbol = base + '/' + quote;
            const filters = this.safeValue (entry, 'filters');
            let minPrice = undefined;
            let maxPrice = undefined;
            let minAmount = undefined;
            let maxAmount = undefined;
            let minCost = undefined;
            for (let j = 0; j < filters.length; j++) {
                const filter = filters[j];
                const filterType = this.safeString (filter, 'filterType');
                if (filterType === 'PRICE_FILTER') {
                    minPrice = this.safeNumber (filter, 'minPrice');
                    maxPrice = this.safeNumber (filter, 'maxPrice');
                    minAmount = this.safeNumber (filter, 'minAmount');
                    maxAmount = this.safeNumber (filter, 'maxAmount');
                    minCost = this.safeNumber (filter, 'minExchangeValue');
                }
            }
            const status = this.safeString (entry, 'status');
            const active = status === 'trading';
            const limits = {
                'price': {
                    'min': minPrice,
                    'max': maxPrice,
                },
                'amount': {
                    'min': minAmount,
                    'max': maxAmount,
                },
                'cost': {
                    'min': minCost,
                    'max': undefined,
                },
            };
            const precision = {
                'price': this.safeInteger (entry, 'quoteAssetPrecision'),
                'amount': this.safeInteger (entry, 'baseAssetPrecision'),
            };
            result.push ({
                'info': entry,
                'symbol': symbol,
                'id': id,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'limits': limits,
                'precision': precision,
                'type': 'spot',
                'spot': true,
                'active': active,
            });
        }
        return result;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets (); // missing markets
        const market = this.market (symbol);
        const request = {
            'symbol': market['id'],
        };
        if (limit !== undefined) {
            request['limit'] = limit; // [1, 5, 10, 20, 50, 100, 500, 1000]
        }
        const response = await this.spotV1PublicGetDepth (this.extend (request, params));
        //
        //     {
        //          "timestamp":1559561187,
        //          "asks":[
        //                     ["8540.0","1.5"],
        //                     ["8541.0","0.0042"]
        //                 ],
        //          "bids":[
        //                     ["8530.0","0.8814"],
        //                     ["8524.0","1.4"]
        //                 ]
        //      }
        //
        const timestamp = this.safeTimestamp (response, 'timestamp');
        return this.parseOrderBook (response, symbol, timestamp);
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market': market['id'],
        };
        const response = await this.v1PublicGetTicker (this.extend (request, params));
        //
        // {
        //     "symbol":"wrxinr",
        //     "baseAsset":"wrx",
        //     "quoteAsset":"inr",
        //     "openPrice":"94.77",
        //     "lowPrice":"92.7",
        //     "highPrice":"95.17",
        //     "lastPrice":"94.03",
        //     "volume":"1118700.0",
        //     "bidPrice":"94.02",
        //     "askPrice":"94.03",
        //     "at":1641382455000
        // }
        //
        const ticker = this.safeValue (response, undefined, {});
        return this.parseTicker (ticker, market);
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        const response = await this.spotV1PublicGetTickers24hr ();
        //
        // [
        //     {
        //        "symbol":"btcinr",
        //        "baseAsset":"btc",
        //        "quoteAsset":"inr",
        //        "openPrice":"3698486",
        //        "lowPrice":"3641155.0",
        //        "highPrice":"3767999.0",
        //        "lastPrice":"3713212.0",
        //        "volume":"254.11582",
        //        "bidPrice":"3715021.0",
        //        "askPrice":"3715022.0",
        //     }
        //     ...
        // ]
        //
        const tickers = this.safeValue (response, undefined, []);
        const result = {};
        for (let i = 0; i < tickers.length; i++) {
            const ticker = tickers[i];
            const marketId = this.safeString (ticker, 'symbol');
            const market = this.safeMarket (marketId, undefined);
            const symbol = market['symbol'];
            result[symbol] = this.parseTicker (ticker, market);
        }
        return result;
    }

    async fetchStatus (params = {}) {
        const response = await this.spotV1PublicGetSystemStatus (params);
        //
        //  { "status":"normal","message":"System is running normally." }
        //
        let status = this.safeString (response, 'status');
        status = (status === 'normal') ? 'ok' : 'maintenance';
        this.status = this.extend (this.status, {
            'status': status,
            'updated': this.milliseconds (),
        });
        return this.status;
    }

    async fetchTime (params = {}) {
        const response = await this.spotV1PublicGetTime (params);
        //
        //     {
        //         "serverTime":1635467280514
        //     }
        //
        return this.safeInteger (response, 'serverTime');
    }

    parseTicker (ticker, market = undefined) {
        //
        //     {
        //        "symbol":"btcinr",
        //        "baseAsset":"btc",
        //        "quoteAsset":"inr",
        //        "openPrice":"3698486",
        //        "lowPrice":"3641155.0",
        //        "highPrice":"3767999.0",
        //        "lastPrice":"3713212.0",
        //        "volume":"254.11582", // base volume
        //        "bidPrice":"3715021.0",
        //        "askPrice":"3715022.0",
        //        "at":1641382455000 // only on fetchTicker
        //     }
        //
        const marketId = this.safeString (ticker, 'symbol');
        market = this.safeMarket (marketId, market);
        const symbol = market['symbol'];
        const last = this.safeNumber (ticker, 'lastPrice');
        const open = this.safeNumber (ticker, 'openPrice');
        const high = this.safeNumber (ticker, 'highPrice');
        const low = this.safeNumber (ticker, 'lowPrice');
        const baseVolume = this.safeNumber (ticker, 'volume');
        const bid = this.safeNumber (ticker, 'bid');
        const ask = this.safeNumber (ticker, 'ask');
        const timestamp = this.safeString (ticker, 'at');
        return this.safeTicker ({
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': high,
            'low': low,
            'bid': bid,
            'bidVolume': undefined,
            'ask': ask,
            'askVolume': undefined,
            'vwap': undefined,
            'open': open,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': baseVolume,
            'quoteVolume': undefined,
            'info': ticker,
        }, market);
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        const marketType = this.safeValue (api, 0);
        const version = this.safeValue (api, 1);
        let url = this.urls['api'][marketType][version] + '/' + path;
        if (Object.keys (params).length) {
            url += '?' + this.urlencode (params);
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (statusCode, statusText, url, method, responseHeaders, responseBody, response, requestHeaders, requestBody) {
        if (statusCode !== 200) {
            const feedback = this.id + ' ' + responseBody;
            throw new ExchangeError (feedback);
        }
    }
};
