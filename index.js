const qrcode = require('qrcode')
const express = require('express')
const app = express()
const Pino = require("pino")
const {
    default: WASocket, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason, 
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@adiwajshing/baileys')

const logger = Pino({
    level: 'fatal', //fatal, atau debug
    timestamp: () => `,"time":"${new Date().toJSON()}"`
}).child({ class: 'baileys'})

qrwa = null

const startSock = async() => {
    const { state, saveCreds } = await useMultiFileAuthState('auth')
    const { version: WAVersion, isLatest } = await fetchLatestBaileysVersion()
    console.log(`using WA v${WAVersion.join('.')}, isLatest: ${isLatest}`)
    const sock = WASocket({
        browser: Browsers.macOS('Desktop'),  //ubuntu
        syncFullHistory: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        version: WAVersion,
        printQRInTerminal: true
    })
    sock.ev.process(
        async(events) => {
            if(events['connection.update']) {
                const update = events['connection.update']
                const { connection, lastDisconnect, qr } = update
                if (qr) {
                    let qrkode = await qrcode.toDataURL(qr, { scale: 20 })
                    qrwa = Buffer.from(qrkode.split`,`[1], 'base64')
                }

                if(connection === 'open') qrwa = null
                if(connection === 'close') {
                    qrwa = null
                    const code = (lastDisconnect.error)?.output?.statusCode || (lastDisconnect.error)?.output?.payload?.statusCode
                    if (code && code !== DisconnectReason.loggedOut && code !== DisconnectReason.badSession && code !== DisconnectReason.connectionReplaced) {
                        await startSock()
                    } else {
                        console.log('Connection closed. You are logged out.')
                    }
                }
                console.log('connection update', update)
            }
            if(events['messages.upsert']) {
              const upsert = events['messages.upsert']
              for (let msg of upsert.messages) {
                if (msg.key.remoteJid == 'status@broadcast' && !msg.key.fromMe && !msg.message?.protocolMessage) {
                    console.info(`Lihat status ${msg.pushName} ${msg.key.participant.split('@')[0]}\n`)
                    var tum = await sock.profilePictureUrl(msg.key.participant, "image").catch(_=> 'https://telegra.ph/file/344302140f05ad0e2e1af.png')
                    //ganti jadi no mu
                    sock.sendMessage('6281319868981@s.whatsapp.net', {
                        text: `Berhasil melihat story dari ${msg.pushName}`,
                        mentions: [msg.key.participant],
                        contextInfo: {
                        mentionedJid: [msg.key.participant],
                        externalAdReply: {
                            title: `AUTO READ STORY`,
                            thumbnailUrl: tum,
                            sourceUrl: `https://wa.me/${[msg.key.participant]}`
                                }
                            }
                        })
                    await sock.readMessages([msg.key])
                    await delay(1000)
                    return sock.readMessages([msg.key])
                }
              }
            }

            // kredensial diperbarui -- simpan
            if(events['creds.update']) {
                await saveCreds()
            }


        }
    )

    return sock
}

PORT = process.env.PORT || 80 || 8080 || 3000
app.enable('trust proxy')
app.set("json spaces",2)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.all('*', async (req, res) => {
    if (qrwa) return res.type('.jpg').send(qrwa)
    res.send('QRCODE BELUM TERSEDIA. SILAHKAN REFRESH TERUS MENERUS')
})
app.listen(PORT, async() => {
    console.log(`express listen on port ${PORT}`)
})

startSock()
process.on('uncaughtException', console.error)
