/**
 * @file src/engine/report_generator.js
 * @description Modul untuk menghitung metrik performa dan menulis laporan akhir dalam format JSON.
 */

const fs = require('fs');
const path = require('path');
const { formatToWIB } = require('../utils/time_helper');
const logger = require('../utils/logger');

const REPORTS_DIR = path.resolve(__dirname, '../../data/reports');
const LOGS_DIR = path.resolve(__dirname, '../../data/logs');

/**
 * Menghitung metrik performa berdasarkan hasil trade.
 * @param {number} initialBalance - Saldo awal.
 * @param {number} finalBalance - Saldo akhir.
 * @param {Array} trades - Array berisi semua trade yang telah ditutup.
 * @returns {object} Objek berisi metrik performa.
 */
function calculatePerformanceMetrics(initialBalance, finalBalance, trades) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      end_balance: finalBalance,
      net_profit_loss: 0,
      net_profit_loss_percent: 0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate_percent: 0,
      profit_factor: 0,
      max_drawdown_percent: 0, // Perhitungan drawdown memerlukan logika lebih kompleks
    };
  }

  const winningTrades = trades.filter(t => t.profit_loss > 0);
  const losingTrades = trades.filter(t => t.profit_loss <= 0);

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit_loss, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit_loss, 0));

  const netProfit = finalBalance - initialBalance;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity; // Hindari pembagian dengan nol

  return {
    end_balance: parseFloat(finalBalance.toFixed(2)),
    net_profit_loss: parseFloat(netProfit.toFixed(2)),
    net_profit_loss_percent: parseFloat(((netProfit / initialBalance) * 100).toFixed(2)),
    total_trades: totalTrades,
    winning_trades: winningTrades.length,
    losing_trades: losingTrades.length,
    win_rate_percent: parseFloat(((winningTrades.length / totalTrades) * 100).toFixed(2)),
    profit_factor: parseFloat(profitFactor.toFixed(2)),
    // TODO: Implement max drawdown calculation if needed
  };
}

/**
 * Membuat file laporan hasil backtest.
 * @param {object} backtestMetadata - Metadata sesi backtest (pair, prompt, tanggal, dll).
 * @param {object} tradeResults - Hasil dari TradeManager.
 * @param {number} aiFailures - Jumlah kegagalan analisis AI.
 * @returns {Promise<string>} Path ke file laporan yang telah dibuat.
 */
async function generateBacktestReport(backtestMetadata, tradeResults, aiFailures) {
  logger.info('[Report Generator] Membuat laporan hasil backtest...');

  const { initialBalance, pair, promptFile, startDate, endDate } = backtestMetadata;
  const { finalBalance, trades } = tradeResults;

  const performanceSummary = calculatePerformanceMetrics(initialBalance, finalBalance, trades);
  performanceSummary.ai_analysis_failures = aiFailures;

  const report = {
    metadata: {
      test_id: `run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      pair: pair,
      prompt_file: promptFile,
      start_date: formatToWIB(startDate),
      end_date: formatToWIB(endDate),
      initial_balance: initialBalance,
    },
    performance_summary: performanceSummary,
    trades: trades,
  };

  // Pastikan direktori ada
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const reportPath = path.join(REPORTS_DIR, `report_${report.metadata.test_id}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  logger.info(`[Report Generator] Laporan hasil backtest berhasil disimpan di: ${reportPath}`);
  return reportPath;
}

/**
 * Membuat file log analisis AI.
 * @param {Array} analysisLog - Array berisi semua log analisis dari AI.
 * @returns {Promise<string>} Path ke file log yang telah dibuat.
 */
async function generateAnalysisLog(analysisLog) {
    logger.info('[Report Generator] Membuat log analisis AI...');
    
    const logId = `log-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    // Pastikan direktori ada
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    const logPath = path.join(LOGS_DIR, `${logId}.json`);
    fs.writeFileSync(logPath, JSON.stringify(analysisLog, null, 2));

    logger.info(`[Report Generator] Log analisis AI berhasil disimpan di: ${logPath}`);
    return logPath;
}

module.exports = {
  generateBacktestReport,
  generateAnalysisLog,
};
