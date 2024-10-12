require('dotenv').config();

const express = require('express');
const { json } = require('body-parser');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');

let sock;
let server;
let qrCodeData;
let isConnected = false;

function checkApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(403).send('Forbidden: Invalid API Key');
    }
}

async function startServer() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    const app = express();
    const PORT = process.env.PORT || 3001; //PORT

    app.use(json());

    app.use((req, res, next) => {
        if (req.path === '/qr') {
            next();
        } else {
            checkApiKey(req, res, next);
        }
    });

    server = app.listen(PORT, () => {
        console.log(`Server berjalan di port ${PORT}`);
    });

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'warn' })
    });

    sock.ev.on('creds.update', saveCreds);

    app.get('/send-message', async (req, res) => {
        const { number, message } = req.query;
        const apiWhatsAppNumber = '6282126818120'; // Nomor WhatsApp API Anda

        if (!number || !message) {
            return res.status(400).send('Permintaan tidak valid: nomor atau pesan hilang');
        }

        try {
            await sock.sendMessage(`${apiWhatsAppNumber}@s.whatsapp.net`, { text: `Pesan dari nomor ${number}: ${message}` });
            // Kirim pesan balasan ke nomor pengirim
            await sock.sendMessage(`${number}@s.whatsapp.net`, { text: 'Ada yang bisa saya bantu?' });

            res.send('Pesan dikirim ke nomor WhatsApp API dan balasan dikirim ke pengirim');
        } catch (error) {
            console.error('Kesalahan saat mengirim pesan:', error);
            res.status(500).send('Gagal mengirim pesan');
        }
    });

    app.get('/qr', (req, res) => {
        if (isConnected) {
            res.status(403).send('QR Code tidak tersedia setelah koneksi berhasil.');
        } else if (qrCodeData) {
            res.send(`<img src="${qrCodeData}" alt="QR Code" />`);
        } else {
            res.send('QR Code belum tersedia. Silakan coba lagi.');
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                reconnect();
            }
        } else if (connection === 'open') {
            console.log('Koneksi terbuka');
            isConnected = true;
        }
    });
}

async function reconnect() {
    console.log('Mencoba untuk menyambung kembali...');
    if (server) {
        server.close(() => {
            startServer();
        });
    } else {
        startServer();
    }
}

startServer();
