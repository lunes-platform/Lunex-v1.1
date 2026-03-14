import { io, Socket } from 'socket.io-client';
import EventEmitter from 'eventemitter3';
import {
    PairCreatedEvent,
    LiquidityAddedEvent,
    SwapExecutedEvent,
    ProposalCreatedEvent,
    VoteCastEvent,
    PriceUpdateEvent,
} from './types';

export type WebSocketEvent =
    | 'connect'
    | 'disconnect'
    | 'error'
    | 'pair:created'
    | 'liquidity:added'
    | 'liquidity:removed'
    | 'swap:executed'
    | 'proposal:created'
    | 'proposal:executed'
    | 'vote:cast'
    | 'price:update'
    | 'tier:upgraded';

export class WebSocketClient extends EventEmitter {
    private socket: Socket | null = null;
    private wsURL: string;
    private authToken: string | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;

    constructor(wsURL: string) {
        super();
        this.wsURL = wsURL;
    }

    /**
     * Connect to WebSocket server
     * @param token - Optional authentication token
     */
    connect(token?: string): void {
        if (token) {
            this.authToken = token;
        }

        this.socket = io(this.wsURL, {
            auth: {
                token: this.authToken ? `Bearer ${this.authToken}` : '',
            },
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: this.maxReconnectAttempts,
        });

        this.setupEventHandlers();
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.socket?.connected || false;
    }

    /**
     * Subscribe to a specific pair's updates
     * @param pairAddress - Pair contract address
     */
    subscribeToPair(pairAddress: string): void {
        this.socket?.emit('subscribe:pair', { pairAddress });
    }

    /**
     * Unsubscribe from a pair's updates
     * @param pairAddress - Pair contract address
     */
    unsubscribeFromPair(pairAddress: string): void {
        this.socket?.emit('unsubscribe:pair', { pairAddress });
    }

    /**
     * Subscribe to proposal updates
     */
    subscribeToProposals(): void {
        this.socket?.emit('subscribe:proposals');
    }

    /**
     * Unsubscribe from proposal updates
     */
    unsubscribeFromProposals(): void {
        this.socket?.emit('unsubscribe:proposals');
    }

    private setupEventHandlers(): void {
        if (!this.socket) return;

        // Connection events
        this.socket.on('connect', () => {
            this.reconnectAttempts = 0;
            this.emit('connect');
        });

        this.socket.on('disconnect', (reason) => {
            this.emit('disconnect', reason);
        });

        this.socket.on('connect_error', (error) => {
            this.reconnectAttempts++;
            this.emit('error', error);

            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error('Max reconnection attempts reached');
                this.disconnect();
            }
        });

        // Pair events
        this.socket.on('pair:created', (data: PairCreatedEvent) => {
            this.emit('pair:created', data);
        });

        this.socket.on('liquidity:added', (data: LiquidityAddedEvent) => {
            this.emit('liquidity:added', data);
        });

        this.socket.on('liquidity:removed', (data: any) => {
            this.emit('liquidity:removed', data);
        });

        this.socket.on('swap:executed', (data: SwapExecutedEvent) => {
            this.emit('swap:executed', data);
        });

        // Governance events
        this.socket.on('proposal:created', (data: ProposalCreatedEvent) => {
            this.emit('proposal:created', data);
        });

        this.socket.on('proposal:executed', (data: any) => {
            this.emit('proposal:executed', data);
        });

        this.socket.on('vote:cast', (data: VoteCastEvent) => {
            this.emit('vote:cast', data);
        });

        // Price events
        this.socket.on('price:update', (data: PriceUpdateEvent) => {
            this.emit('price:update', data);
        });

        // Trading events
        this.socket.on('tier:upgraded', (data: any) => {
            this.emit('tier:upgraded', data);
        });
    }
}
