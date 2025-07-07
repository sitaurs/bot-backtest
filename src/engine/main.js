/**
 * @file src/engine/main.js
 * @description Orchestrator utama untuk menjalankan proses backtest.
 * Versi ini memperbaiki logika lompatan agar M15 ikut melompat dengan benar.
 */

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const config = require('../../config/default.json');
const { getOhlcvData } = require('./data_manager');
const { getAnalysis, extractDataWithAI } = require('./ai_service'); 
const TradeManager = require('./trade_manager');
const { createChartImage } = require('./chart_generator');
const { generateBacktestReport, generateAnalysisLog } = require('./report_generator');

function parseExtractedText(text) {
  if (typeof text !== 'string' || text.toUpperCase() === 'NO_TRADE') {
    logger.info('[Parser] Tidak ada sinyal trade dari hasil ekstraksi.');
    return null;
  }
  const extractedData = {};
  const parts = text.split(',');
  parts.forEach(part => {
    const [key, value] = part.split(':').map(s => s.trim());
    if (key && value) {
      if (key.toLowerCase() === 'arah') extractedData.signal = value;
      if (key.toLowerCase() === 'harga masuk') extractedData.entry_price = parseFloat(value);
      if (key.toLowerCase() === 'stop loss') extractedData.stop_loss = parseFloat(value);
      if (key.toLowerCase() === 'take profit') extractedData.take_profit = parseFloat(value);
    }
  });
  const { signal, entry_price, stop_loss, take_profit } = extractedData;
  if (signal && entry_price && stop_loss && take_profit) {
    logger.info('[Parser] Data trade berhasil diekstrak dari teks ringkas.', extractedData);
    return extractedData;
  }
  logger.warn('[Parser] Teks hasil ekstraksi tidak dalam format yang diharapkan.', { text });
  return null;
}

async function runBacktest(backtestConfig, sock, jid) {
  const { pair, promptFile, startDate, endDate, notificationMode } = backtestConfig;
  logger.info(`[Engine] Memulai backtest baru untuk ${pair}...`);
  
  try {
    const promptPath = path.resolve(__dirname, '../../prompts', promptFile);
    if (!fs.existsSync(promptPath)) throw new Error(`File prompt tidak ditemukan: ${promptFile}`);
    const prompt = fs.readFileSync(promptPath, 'utf-8');

    const [m1Data, m15Data] = await Promise.all([
      getOhlcvData(pair, 'M1', startDate, endDate),
      getOhlcvData(pair, 'M15', startDate, endDate),
    ]);
    if (!m1Data || !m15Data) throw new Error('Gagal mengambil data OHLCV.');

    const tradeManager = new TradeManager({ ...config.backtest_defaults, sock, jid, notificationMode });
    const analysisLog = [];
    let aiFailures = 0;

    let i = m1Data.findIndex(d => new Date(d.time).getTime() >= moment.tz(startDate, 'YYYY-MM-DD', 'Asia/Jakarta').valueOf());
    if (i === -1) throw new Error(`Tidak ditemukan data M1 untuk tanggal mulai: ${startDate}`);

    logger.info('[Engine] Memulai loop simulasi...');
    while (i < m1Data.length) {
      const currentCandle = m1Data[i];
      if (!currentCandle) { // Pengaman jika 'i' melompat melebihi panjang array
          break;
      }
      tradeManager.update(currentCandle);

      if (!tradeManager.hasActivePosition()) {
        // --- PERBAIKAN UTAMA LOGIKA SINKRONISASI M15 ---
        const currentCandleTime = new Date(currentCandle.time).getTime();
        // Temukan indeks candle M15 terakhir yang waktunya <= waktu M1 saat ini.
        const m15EndIndex = m15Data.map(d => new Date(d.time).getTime()).findLastIndex(time => time <= currentCandleTime);
        
        // Buat irisan data berdasarkan indeks yang benar
        const m1Slice = m1Data.slice(0, i + 1);
        const m15Slice = m15Data.slice(0, m15EndIndex + 1);
        // --- AKHIR PERBAIKAN ---

        if (m1Slice.length < config.candle_counts.m1_for_analysis || m15Slice.length < config.candle_counts.m15_for_analysis) {
            i++;
            continue;
        }

        const timestamp = Date.now();
        const chartPaths = {
          m1_chart_file: path.resolve(__dirname, `../../data/charts/m1_${timestamp}.png`),
          m15_chart_file: path.resolve(__dirname, `../../data/charts/m15_${timestamp}.png`),
        };
        
        try {
          const ohlcForAI = {
            m1: m1Slice.slice(-config.candle_counts.m1_for_analysis),
            m15: m15Slice.slice(-config.candle_counts.m15_for_analysis),
          };
          const m1ForChart = m1Slice.slice(-config.candle_counts.m1_for_chart);
          const m15ForChart = m15Slice.slice(-config.candle_counts.m15_for_chart);
          
          const m1ChartStartTime = m1ForChart[0].time;
          const m1ChartEndTime = m1ForChart[m1ForChart.length - 1].time;
          const m15ChartStartTime = m15ForChart[0].time;
          const m15ChartEndTime = m15ForChart[m15ForChart.length - 1].time;

          const m1ImagePath = await createChartImage(pair, '1m', m1ChartStartTime, m1ChartEndTime, chartPaths.m1_chart_file);
          const m15ImagePath = await createChartImage(pair, '15m', m15ChartStartTime, m15ChartEndTime, chartPaths.m15_chart_file);
          
          if (notificationMode === 3) {
            logger.info(`[Engine] Mencoba mengirim pesan DEBUG (Tahap 1) ke ${jid}`);
            try {
              await sock.sendMessage(jid, { text: `[DEBUG MODE] 🐞\n\nPesan ini dikirim SEBELUM memanggil AI.\n\n*PROMPT:*\n${prompt.substring(0, 500)}...` });
              if (m1ImagePath) await sock.sendMessage(jid, { image: fs.readFileSync(m1ImagePath), caption: 'Chart M1 untuk Analisis' });
              if (m15ImagePath) await sock.sendMessage(jid, { image: fs.readFileSync(m15ImagePath), caption: 'Chart M15 untuk Analisis' });
              logger.info(`[Engine] Pesan DEBUG (Tahap 1) berhasil dikirim.`);
            } catch (e) {
              logger.error(`[Engine] GAGAL mengirim pesan DEBUG (Tahap 1).`, e);
            }
          }

          const rawAnalysisResult = await getAnalysis(prompt, ohlcForAI, chartPaths);
          let tradeSignal = null;
          if (rawAnalysisResult) {
            const extractedText = await extractDataWithAI(rawAnalysisResult);
            tradeSignal = parseExtractedText(extractedText);
          }
          
          if (notificationMode === 3 && rawAnalysisResult) {
            logger.info(`[Engine] Mencoba mengirim pesan DEBUG (Tahap 2) ke ${jid}`);
            try {
              await sock.sendMessage(jid, { text: `[DEBUG MODE] 💡\n\nRespons Mentah (Tahap 1):\n\n\`\`\`${rawAnalysisResult}\`\`\`` });
              logger.info(`[Engine] Pesan DEBUG (Tahap 2) berhasil dikirim.`);
            } catch(e) {
              logger.error(`[Engine] GAGAL mengirim pesan DEBUG (Tahap 2).`, e);
            }
          }
          
          analysisLog.push({ analysis_id: `ai-${timestamp}`, timestamp: currentCandle.time, context: { ...chartPaths }, ai_response: rawAnalysisResult, status: rawAnalysisResult ? 'SUCCESS' : 'FAILURE' });

          if (tradeSignal) {
            tradeManager.addPendingOrder(tradeSignal, currentCandle.time, { start_time: ohlcForAI.m1[0].time, end_time: currentCandle.time });
          } else {
            logger.info('[Engine] NO_TRADE, melompat 90 candle M1 berikutnya...');
            i += 90;
            continue;
          }
        } finally {
          if (fs.existsSync(chartPaths.m1_chart_file)) fs.unlinkSync(chartPaths.m1_chart_file);
          if (fs.existsSync(chartPaths.m15_chart_file)) fs.unlinkSync(chartPaths.m15_chart_file);
        }
      }
      i++;
    }

    const tradeResults = tradeManager.getResults();
    const [reportPath, logPath] = await Promise.all([
      generateBacktestReport({ ...backtestConfig, initialBalance: config.backtest_defaults.initial_balance }, tradeResults, aiFailures),
      generateAnalysisLog(analysisLog)
    ]);
    
    logger.info('[Engine] Backtest selesai dengan sukses!');
    return { reportPath, logPath };

  } catch (error) {
    logger.error('[Engine] Terjadi error fatal selama proses backtest.', error);
    if (sock && jid) {
      logger.info(`[Engine] Mencoba mengirim pesan GAGAL ke ${jid}`);
      try {
        await sock.sendMessage(jid, { text: `❌ **Backtest Gagal!**\n\n- Alasan: ${error.message}` });
        logger.info(`[Engine] Pesan GAGAL berhasil dikirim.`);
      } catch(e) {
        logger.error(`[Engine] GAGAL mengirim pesan GAGAL.`, e);
      }
    }
    return null;
  }
}

module.exports = { runBacktest };