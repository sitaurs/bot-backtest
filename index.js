/**
 * @file index.js
 * @description Titik masuk utama (entry point) untuk seluruh aplikasi.
 */

const { connectToWhatsApp } = require('./src/bot/bot.js');
const logger = require('./src/utils/logger');

function main() {
  logger.info('====================================');
  logger.info('   Memulai Aplikasi Backtester Bot  ');
  logger.info('====================================');
  
  connectToWhatsApp().catch(err => {
    logger.error('[APP] Gagal memulai koneksi WhatsApp:', err);
    process.exit(1); // Keluar dari aplikasi jika koneksi awal gagal
  });
}

// Jalankan fungsi utama
main();
