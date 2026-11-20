// Limits and the hosted model id that more than one package uses. One home
// each, so the companion, the hosted functions and the Worker cannot drift.

// The longest topic (an interest's headline). The schema's interests.topic
// check holds the same number.
export const MAX_TOPIC_CHARS = 200;

// The longest setup chat message, on the companion and the Worker alike.
export const MAX_CHAT_MESSAGE_CHARS = 4000;

// Every hosted Claude call (research, the setup chat, the publish check and
// picks) runs on this model.
export const HAIKU_MODEL = "claude-haiku-5-5";
