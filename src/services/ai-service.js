const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const Groq = require('groq-sdk');

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.warn('⚠️ GROQ_API_KEY não configurada no .env!');
}
const groq = new Groq({
  apiKey: apiKey || 'dummy-key'
});

/**
 * Transcreve áudio base64 usando o modelo Whisper-large-v3 via Groq (tempo médio: ~300ms)
 * @param {string} base64Audio 
 * @param {string} mimeType 
 * @returns {Promise<string>}
 */
async function transcribeAudioBase64(base64Audio, mimeType = 'audio/ogg') {
  if (!base64Audio) return '';

  const cleanBase64 = base64Audio.replace(/^data:audio\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  
  // Determina extensão
  let ext = 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';
  else if (mimeType.includes('mp3')) ext = 'mp3';
  else if (mimeType.includes('wav')) ext = 'wav';

  const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
  
  try {
    fs.writeFileSync(tempFilePath, buffer);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'verbose_json'
    });

    return transcription.text ? transcription.text.trim() : '';
  } catch (error) {
    console.error('❌ Erro no Groq Whisper STT:', error);
    return '';
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

/**
 * Processamento conversacional e extração de intenções via Groq LLM (llama-3.3-70b-versatile)
 * @param {Array} conversationHistory 
 * @param {string} userMessage 
 * @param {object} sessionState 
 * @returns {Promise<{replyText: string, updatedState: object, ticketOpened: boolean, protocol: string|null}>}
 */
async function processAgentConversation(conversationHistory, userMessage, sessionState) {
  const systemPrompt = `Você é o Agente de Suporte e Atendimento Nível 1 da DIX BPO no WhatsApp.
Seu objetivo é fazer a triagem e recepção de chamados e ocorrências com cordialidade, profissionalismo e agilidade.

FLUXO DE NEGÓCIO OBRIGATÓRIO:
1. Se for o início do contato ou o usuário ainda não passou os dados:
   - Cumprimente cordialmente.
   - Solicite que o usuário informe: Nome Completo, E-mail e Celular (se ainda não tiver).
   - Peça para ele descrever com detalhes o problema ou a ocorrência (lembrando que ele pode mandar por texto ou áudio).

2. Quando o usuário enviar as informações da ocorrência e dados:
   - Extraia e organize as informações:
     • Nome do Cliente
     • E-mail
     • Celular
     • Resumo da Ocorrência
   - Peça a CONFIRMAÇÃO do usuário de forma clara: "Por favor, confirme se os dados acima estão corretos (responda SIM ou NÃO) para que eu possa gerar seu protocolo."

3. Quando o usuário responder à confirmação:
   - Se for SIM (ou confirmação afirmativa):
     - Avise que o chamado foi ABERTO com sucesso.
     - Forneça o protocolo gerado no formato [PROTOCOLO: DIX-XXXXXX] onde XXXXXX são números.
     - Oriente que o chamado foi encaminhado para a equipe de suporte humanizado e que ele deve aguardar o contato.
   - Se for NÃO (ou indicar que algo está errado):
     - Pergunte com educação qual informação precisa ser ajustada ou peça para reenviar.

DIRETRIZES DE ESTILO:
- Fale em português do Brasil impecável, tom corporativo porém acolhedor.
- NUNCA fuja do personagem.
- Seja objetivo e conciso (mensagens de WhatsApp não devem ser textos gigantes).
- Use formatação simples com asteriscos para negrito (*exemplo*).`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: 600
    });

    const replyText = chatCompletion.choices[0]?.message?.content || "Desculpe, tive uma instabilidade momentânea. Pode repetir por favor?";

    let ticketOpened = false;
    let protocol = null;

    // Detecta se abriu chamado
    if (replyText.includes('DIX-') || replyText.toLowerCase().includes('protocolo')) {
      const match = replyText.match(/DIX-\d+/);
      if (match) {
        protocol = match[0];
        ticketOpened = true;
      } else {
        protocol = 'DIX-' + Math.floor(100000 + Math.random() * 900000);
        ticketOpened = true;
      }
    }

    return {
      replyText,
      ticketOpened,
      protocol
    };
  } catch (error) {
    console.error('❌ Erro na LLM Groq:', error);
    return {
      replyText: "Olá! Recebi sua mensagem, mas nosso sistema de processamento teve um breve delay. Pode confirmar novamente o seu nome e ocorrência?",
      ticketOpened: false,
      protocol: null
    };
  }
}

module.exports = {
  transcribeAudioBase64,
  processAgentConversation
};
