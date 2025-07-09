/**
 * @file index.js
 * @description Titik masuk utama (entry point) untuk seluruh aplikasi.
 */

const { connectToWhatsApp } = require('./src/bot/bot.js');
const { runBacktest } = require('./src/engine/main');
const logger = require('./src/utils/logger');

function parseCliArgs(args) {
  const cfg = {};
  args.forEach(arg => {
    const [key, value] = arg.split('=');
    if (key && value) {
      cfg[key.replace(/^--?/, '')] = value;
    }
  });
  return cfg;
}

async function runCliMode(cliCfg) {
  const required = ['pair', 'prompt', 'start', 'end'];
  const missing = required.filter(k => !cliCfg[k]);
  if (missing.length) {
    logger.error(`[CLI] Argumen tidak lengkap: ${missing.join(', ')}`);
    return;
  }
  const backtestCfg = {
    pair: cliCfg.pair,
    promptFile: cliCfg.prompt,
    startDate: cliCfg.start,
    endDate: cliCfg.end,
    notificationMode: parseInt(cliCfg.notify || '0', 10),
  };
  logger.warn('[CLI] Menjalankan backtest tanpa WhatsApp.');
  await runBacktest(backtestCfg, null, null);
}

async function main() {
  const cliCfg = parseCliArgs(process.argv.slice(2));

  logger.info('====================================');
  logger.info('   Memulai Aplikasi Backtester Bot  ');
  logger.info('====================================');

  if (cliCfg.offline === '1' || cliCfg.offline === 'true') {
    await runCliMode(cliCfg);
    return;
  }

  try {
    await connectToWhatsApp();
  } catch (err) {
    logger.error('[APP] Gagal memulai koneksi WhatsApp:', err);
    await runCliMode(cliCfg);
  }
}

// Jalankan fungsi utama
main();
