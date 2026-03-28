const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

let client = null;

function getClient() {
  if (!client) {
    client = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return client;
}

async function ask(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userMessage);
  return result.response.text();
}

async function askJson(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(userMessage);
  return JSON.parse(result.response.text());
}

async function chat(systemPrompt, history, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  return result.response.text();
}

module.exports = { ask, askJson, chat };
