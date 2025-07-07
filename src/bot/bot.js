/**
 * @file src/bot/bot.js
 * @description Titik masuk utama bot, koneksi Baileys, dan event listener.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); // <-- IMPORT BARU
const { handleCommand } = require('./command_handler');
const logger = require('../utils/logger');

const SESSION_FILE_PATH = path.resolve(__dirname, '../../session.json');

/**
 * Fungsi utama untuk memulai dan mengelola koneksi bot ke WhatsApp.
 */
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FILE_PATH);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`[Baileys] Menggunakan versi: ${version}, Terbaru: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state,
    // printQRInTerminal: true, // <-- OPSI INI DIHAPUS
    logger: pino({ level: 'silent' }),
  });

  // Listener untuk update koneksi
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    // --- BLOK PERBAIKAN ---
    if (qr) {
      logger.info('[Connection] QR diterima, menampilkannya di terminal...');
      qrcode.generate(qr, { small: true }); // Membuat QR code secara manual
      logger.info('[Connection] Silakan pindai QR code di atas.');
    }
    // --- AKHIR BLOK PERBAIKAN ---

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
      logger.error(`[Connection] Koneksi ditutup karena: ${lastDisconnect.error}, mencoba menghubungkan ulang: ${shouldReconnect}`);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      logger.info('[Connection] Bot berhasil terhubung ke WhatsApp!');
    }
  });

  // Simpan kredensial setiap kali diperbarui
  sock.ev.on('creds.update', saveCreds);

  // Listener untuk pesan baru yang masuk
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') {
      return;
    }

    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    if (text.startsWith('!')) {
      logger.info(`[Message] Perintah diterima dari ${jid}: "${text}"`);
      try {
        await handleCommand(sock, jid, text);
      } catch (error) {
        logger.error(`[Handler Error] Terjadi error saat menangani perintah dari ${jid}`, error);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan internal saat memproses perintah Anda.' });
      }
    }
  });

  return sock;
}

module.exports = {
  connectToWhatsApp,
};
