require('dotenv').config();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'ph_estoque_secret_token_2026';
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || 'dix-suporte';

/**
 * Cria a instância na Evolution API se ela ainda não existir
 */
async function ensureInstance() {
  try {
    const checkRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    const instances = await checkRes.json();
    const exists = Array.isArray(instances) && instances.some(i => i.name === INSTANCE_NAME);

    if (!exists) {
      console.log(`📦 Criando instância Evolution API: ${INSTANCE_NAME}...`);
      const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
        method: 'POST',
        headers: {
          'apikey': EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instanceName: INSTANCE_NAME,
          token: EVOLUTION_API_KEY,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });
      const data = await createRes.json();
      console.log(`✅ Instância ${INSTANCE_NAME} criada!`);
      return data;
    } else {
      console.log(`ℹ️ Instância ${INSTANCE_NAME} já existe na Evolution API.`);
    }
  } catch (err) {
    console.error('❌ Erro ao verificar/criar instância na Evolution API:', err.message);
  }
}

/**
 * Obtém o QR Code em base64 da instância para conexão do WhatsApp
 */
async function getQrCode() {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${INSTANCE_NAME}`, {
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('❌ Erro ao buscar QR Code:', err.message);
    return null;
  }
}

/**
 * Envia mensagem de texto para um número no WhatsApp
 * @param {string} remoteJid 
 * @param {string} text 
 */
async function sendTextMessage(remoteJid, text) {
  try {
    const number = remoteJid.replace('@s.whatsapp.net', '');
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        number: number,
        text: text
      })
    });
    return await res.json();
  } catch (err) {
    console.error(`❌ Erro ao enviar mensagem para ${remoteJid}:`, err.message);
  }
}

/**
 * Baixa o áudio em base64 da mensagem na Evolution API
 * @param {object} messageKey 
 */
async function getBase64FromMediaMessage(messageKey) {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: { key: messageKey },
        convertToMp4: false
      })
    });
    const data = await res.json();
    return data.base64 || null;
  } catch (err) {
    console.error('❌ Erro ao buscar áudio em base64 da Evolution API:', err.message);
    return null;
  }
}

/**
 * Configura o Webhook da instância para apontar para o nosso servidor
 * @param {string} webhookUrl 
 */
async function setWebhook(webhookUrl) {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/webhook/set/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: true,
        events: ['MESSAGES_UPSERT']
      })
    });
    return await res.json();
  } catch (err) {
    console.error('❌ Erro ao configurar webhook:', err.message);
  }
}

module.exports = {
  ensureInstance,
  getQrCode,
  sendTextMessage,
  getBase64FromMediaMessage,
  setWebhook,
  INSTANCE_NAME
};
