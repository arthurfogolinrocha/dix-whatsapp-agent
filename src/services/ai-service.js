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
  const systemPrompt = `Você é a Bia, assistente humana de suporte e atendimento da DIX BPO no WhatsApp.
Seu objetivo é acolher o cliente, entender o que ele precisa, coletar os dados essenciais e registrar a ocorrência com total naturalidade.

COMO VOCÊ FALA (MUITO IMPORTANTE):
- Fale como uma atendente humana real no WhatsApp, com gentileza, simpatia e agilidade.
- NÃO use frases clichês de robô como "Eu sou uma inteligência artificial", "Sou um modelo de linguagem", "Em que posso ser útil hoje?".
- Nunca mande textões gigantes. Seja direta e use quebras de parágrafo naturais.
- Pode usar pontuação leve, emojis pontuais (sem exagero) e linguagem acolhedora ("Oi, tudo bem?", "Perfeito!", "Entendi", "Pode deixar").

REGRAS DO ATENDIMENTO:
1. No início do contato:
   - Dê boas-vindas com simpatia.
   - Peça o nome da pessoa e o que está acontecendo (avise que ela pode mandar áudio se achar mais fácil).
   - Se ela ainda não informou, peça também o e-mail dela para cadastro do chamado.

2. Ao receber a ocorrência e dados:
   - Demonstre empatia com o problema relatado.
   - Confirme com ela os dados que ela passou antes de abrir:
     "Só pra eu não errar nada aqui, confirma pra mim se tá certinho:
     • Nome: [Nome]
     • E-mail: [E-mail]
     • Ocorrência: [Resumo do problema]
     Posso abrir o chamado com esses dados?"

3. Após a confirmação:
   - Se ela disser "sim", "pode", "tá certo", etc:
     - Confirme que o chamado foi gerado e passe o protocolo no formato [PROTOCOLO: DIX-XXXXXX] (onde XXXXXX são números aleatórios).
     - Diga que o chamado já foi encaminhado para a equipe técnica responsável e que logo mais eles entram em contato.
   - Se ela disser que algo tá errado:
     - Peça desculpas e pergunte o que ela quer corrigir.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: 'openai/gpt-oss-120b',
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
