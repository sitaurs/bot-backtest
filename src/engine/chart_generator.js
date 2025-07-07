/**
 * @file src/engine/chart_generator.js
 * @description Modul untuk mengambil gambar chart dari API chart-img.com
 * dengan sistem rotasi API key yang persisten.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
require('dotenv').config();

const API_URL = "https://api.chart-img.com/v2/tradingview/advanced-chart";
const STATE_FILE_PATH = path.resolve(__dirname, '../../data/api_key_state.json');

let apiKeys = [];

function loadApiKeys() {
  if (apiKeys.length > 0) return;
  for (const key in process.env) {
    if (key.startsWith('CHART_IMG_KEY_')) {
      apiKeys.push(process.env[key]);
    }
  }
  apiKeys.sort();
  logger.info(`[Chart Generator] Berhasil memuat ${apiKeys.length} API keys.`);
}

function getNextApiKey() {
  loadApiKeys();
  if (apiKeys.length === 0) {
    logger.error('[Chart Generator] Tidak ada API key yang ditemukan!');
    return null;
  }

  let state = { nextKeyIndex: 0 };
  if (fs.existsSync(STATE_FILE_PATH)) {
    try {
      const fileContent = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      if (fileContent) state = JSON.parse(fileContent);
    } catch (e) {
      state.nextKeyIndex = 0;
    }
  }

  const currentIndex = state.nextKeyIndex || 0;
  const currentKey = apiKeys[currentIndex];
  const nextIndex = (currentIndex + 1) % apiKeys.length;

  const dataDir = path.dirname(STATE_FILE_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(STATE_FILE_PATH, JSON.stringify({ nextKeyIndex: nextIndex }, null, 2));
  
  logger.debug(`[Chart Generator] Menggunakan API Key #${currentIndex + 1}`);
  return currentKey;
}

async function createChartImage(symbol, interval, startTimeISO, endTimeISO, outputPath) {
  const apiKey = getNextApiKey();
  if (!apiKey) return null;

  const payload = {
    symbol: `OANDA:${symbol}`,
    interval: interval,
    from: startTimeISO,
    to: endTimeISO,
    // --- PERBAIKAN: Mengubah resolusi agar sesuai batas API ---
    width: 800,
    height: 450, // Rasio 16:9 yang aman di bawah 800x600
    theme: "light",
  };

  try {
    const response = await axios.post(API_URL, payload, {
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
    });

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, response.data);
    logger.info(`[Chart Generator] Chart untuk ${symbol} (${interval}) berhasil disimpan.`);
    return outputPath;

  } catch (error) {
    logger.error(`[Chart Generator] Gagal mengambil gambar chart dari API`, {
        message: error.message,
        response: error.response ? error.response.data.toString() : 'No response data'
    });
    return null;
  }
}

module.exports = {
  createChartImage,
};