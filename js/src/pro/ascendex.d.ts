import ascendexRest from '../ascendex.js';
export default class ascendex extends ascendexRest {
    describe(): any;
    watchPublic(messageHash: any, params?: {}): Promise<any>;
    watchPrivate(channel: any, messageHash: any, params?: {}): Promise<any>;
    watchOHLCV(symbol: any, timeframe?: string, since?: any, limit?: any, params?: {}): Promise<any>;
    handleOHLCV(client: any, message: any): any;
    watchTrades(symbol: any, since?: any, limit?: any, params?: {}): Promise<any>;
    handleTrades(client: any, message: any): void;
    watchOrderBook(symbol: any, limit?: any, params?: {}): Promise<any>;
    watchOrderBookSnapshot(symbol: any, limit?: any, params?: {}): Promise<any>;
    handleOrderBookSnapshot(client: any, message: any): void;
    handleOrderBook(client: any, message: any): void;
    handleDelta(bookside: any, delta: any): void;
    handleDeltas(bookside: any, deltas: any): void;
    handleOrderBookMessage(client: any, message: any, orderbook: any): any;
    watchBalance(params?: {}): Promise<any>;
    handleBalance(client: any, message: any): void;
    watchOrders(symbol?: string, since?: any, limit?: any, params?: {}): Promise<any>;
    handleOrder(client: any, message: any): void;
    parseWsOrder(order: any, market?: any): any;
    handleErrorMessage(client: any, message: any): boolean;
    handleAuthenticate(client: any, message: any): void;
    handleMessage(client: any, message: any): any;
    handleSubscriptionStatus(client: any, message: any): any;
    handleOrderBookSubscription(client: any, message: any): void;
    pong(client: any, message: any): Promise<void>;
    handlePing(client: any, message: any): Promise<void>;
    authenticate(url: any, params?: {}): any;
}
