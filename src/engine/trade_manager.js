/**
 * @file src/engine/trade_manager.js
 * @description Modul untuk mengelola state trading: posisi, order, balance, dan eksekusi aturan.
 */

const { differenceInMinutes, formatToWIB } = require('../utils/time_helper');
const config = require('../../config/default.json');
const logger = require('../utils/logger');

class TradeManager {
  /**
   * @param {object} options - Opsi konfigurasi untuk manajer trade.
   * @param {number} options.initialBalance - Saldo awal.
   * @param {number} options.lotSize - Ukuran lot per trade.
   * @param {number} options.spreadPoints - Spread dalam points.
   * @param {object} options.sock - Instance bot Baileys untuk mengirim notifikasi.
   * @param {string} options.jid - ID chat pengguna.
   * @param {number} options.notificationMode - Level notifikasi yang dipilih.
   */
  constructor(options) {
    // Pengaturan dari config
    this.balance = options.initialBalance;
    this.lotSize = options.lotSize;
    this.spreadPips = (options.spreadPoints || 2) / 10;
    
    // Pengaturan untuk Notifikasi
    this.sock = options.sock;
    this.jid = options.jid;
    this.notificationMode = options.notificationMode || 0;

    // State trading
    this.activePosition = null;
    this.pendingOrders = [];
    this.closedTrades = [];
    this.tradeIdCounter = 1;

    // Aturan dari config
    this.orderExpiryMinutes = config.trade_rules.order_expiry_minutes;
    this.tradeTimeLimitMinutes = config.trade_rules.trade_time_limit_minutes;
  }

  /**
   * Fungsi internal untuk mengirim notifikasi jika mode mengizinkan.
   * @param {string} message - Pesan yang akan dikirim.
   * @param {number} requiredLevel - Level minimum yang diperlukan untuk mengirim notifikasi ini.
   */
  async _sendNotification(message, requiredLevel) {
    if (this.notificationMode >= requiredLevel) {
      try {
        await this.sock.sendMessage(this.jid, { text: message });
      } catch (error) {
        logger.error('[Trade Manager] Gagal mengirim notifikasi.', error);
      }
    }
  }

  /**
   * Menambahkan order baru ke antrian berdasarkan sinyal dari AI.
   */
  addPendingOrder(signal, signalTime, analysisSnapshotRange) {
    const newOrder = { ...signal, orderId: this.tradeIdCounter++, signalTime, analysisSnapshotRange };
    this.pendingOrders.push(newOrder);
    
    const message = `🔔 *ORDER DIBUAT* (#${newOrder.orderId})\n\n- Tipe: ${signal.signal}\n- Harga: ${signal.entry_price}`;
    this._sendNotification(message, 2); // Level 2: Detail
    
    logger.info(`[Trade Manager] Order baru ditambahkan: ${signal.signal} @ ${signal.entry_price}`);
  }

  /**
   * Fungsi utama yang dipanggil di setiap candle untuk memperbarui state trading.
   */
  update(currentCandle) {
    if (this.activePosition) {
      this._checkActivePosition(currentCandle);
    }
    if (!this.activePosition && this.pendingOrders.length > 0) {
      this._checkPendingOrders(currentCandle);
    }
  }

  /**
   * Memeriksa dan mengelola posisi yang sedang aktif.
   */
  _checkActivePosition(currentCandle) {
    const position = this.activePosition;
    const candleTime = new Date(currentCandle.time);

    if (differenceInMinutes(position.entryTime, candleTime) >= this.tradeTimeLimitMinutes) {
      this._closePosition(currentCandle.close, 'TIME_LIMIT_EXCEEDED', candleTime);
      return;
    }

    const pipValue = position.direction === 'BUY' ? 0.0001 : -0.0001;
    const spreadAdjustment = this.spreadPips * pipValue;

    if (position.direction === 'BUY') {
      if (currentCandle.low <= position.stop_loss) {
        this._closePosition(position.stop_loss, 'SL_HIT', candleTime);
      } else if (currentCandle.high >= position.take_profit) {
        this._closePosition(position.take_profit, 'TP_HIT', candleTime);
      }
    } else { // SELL
      if (currentCandle.high + spreadAdjustment >= position.stop_loss) {
        this._closePosition(position.stop_loss, 'SL_HIT', candleTime);
      } else if (currentCandle.low + spreadAdjustment <= position.take_profit) {
        this._closePosition(position.take_profit, 'TP_HIT', candleTime);
      }
    }
  }

  /**
   * Memeriksa dan mengelola order yang tertunda di antrian.
   */
  _checkPendingOrders(currentCandle) {
    const candleTime = new Date(currentCandle.time);
    const remainingOrders = [];

    for (const order of this.pendingOrders) {
      if (differenceInMinutes(order.signalTime, candleTime) >= this.orderExpiryMinutes) {
        const message = `❌ *ORDER DIBATALKAN* (#${order.orderId})\n\n- Alasan: Kadaluwarsa (45 Menit)`;
        this._sendNotification(message, 2); // Level 2: Detail
        continue;
      }
      
      let triggered = false;
      const pipValue = order.signal === 'BUY_LIMIT' ? 0.0001 : -0.0001;
      const spreadAdjustment = this.spreadPips * pipValue;

      if (order.signal === 'BUY_LIMIT' && currentCandle.low <= order.entry_price) {
        triggered = true;
      } else if (order.signal === 'SELL_LIMIT' && currentCandle.high + spreadAdjustment >= order.entry_price) {
        triggered = true;
      }

      if (triggered) {
        this._openPosition(order, candleTime);
        const index = this.pendingOrders.indexOf(order);
        remainingOrders.push(...this.pendingOrders.slice(index + 1));
        break;
      } else {
        remainingOrders.push(order);
      }
    }
    this.pendingOrders = remainingOrders;
  }

  /**
   * Membuka posisi baru dari order yang terpicu.
   */
  _openPosition(order, entryTime) {
    this.activePosition = {
      tradeId: order.orderId,
      direction: order.signal.split('_')[0],
      entry_price: order.entry_price,
      stop_loss: order.stop_loss,
      take_profit: order.take_profit,
      entryTime: entryTime,
      analysisSnapshotRange: order.analysisSnapshotRange,
    };
    
    const message = `✅ *POSISI DIBUKA* (#${this.activePosition.tradeId})\n\n- Arah: ${this.activePosition.direction}\n- Harga Masuk: ${this.activePosition.entry_price}`;
    this._sendNotification(message, 1); // Level 1: Ringkas
    
    logger.info(`[Trade Manager] Posisi #${this.activePosition.tradeId} DIBUKA`);
  }

  /**
   * Menutup posisi yang aktif dan mencatat hasilnya.
   */
  _closePosition(exitPrice, exitReason, exitTime) {
    const position = this.activePosition;
    const contractSize = 100000;
    let pnl = (position.direction === 'BUY')
      ? (exitPrice - position.entry_price) * this.lotSize * contractSize
      : (position.entry_price - exitPrice) * this.lotSize * contractSize;

    this.balance += pnl;
    const closedTrade = {
      trade_id: position.tradeId,
      direction: position.direction,
      entry_price: position.entry_price,
      exit_price: exitPrice,
      stop_loss: position.stop_loss,
      take_profit: position.take_profit,
      entry_time: formatToWIB(position.entryTime),
      exit_time: formatToWIB(exitTime),
      profit_loss: parseFloat(pnl.toFixed(2)),
      exit_reason: exitReason,
      analysis_snapshot_range: {
        start_time: formatToWIB(position.analysisSnapshotRange.start_time),
        end_time: formatToWIB(position.analysisSnapshotRange.end_time),
      }
    };
    this.closedTrades.push(closedTrade);
    this.activePosition = null;

    const pnlText = closedTrade.profit_loss > 0 ? `+${closedTrade.profit_loss}` : `${closedTrade.profit_loss}`;
    const message = `🛑 *POSISI DITUTUP* (#${closedTrade.trade_id})\n\n- P/L: $${pnlText}\n- Alasan: ${exitReason}`;
    this._sendNotification(message, 1); // Level 1: Ringkas
    
    logger.info(`[Trade Manager] Posisi #${position.tradeId} DITUTUP. P/L: $${closedTrade.profit_loss}`);
  }

  hasActivePosition() { return this.activePosition !== null; }
  getResults() { return { finalBalance: this.balance, trades: this.closedTrades }; }
}

module.exports = TradeManager;
