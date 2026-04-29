/**
 * Schema validation for chat messages.
 *
 * These functions validate raw messages from external sources (Gateway API, local storage)
 * before they enter the application pipeline.
 */

import type { ContentBlock, RawMessage } from '../stores/chat/types';

const VALID_ROLES: RawMessage['role'][] = ['user', 'assistant', 'system', 'toolresult'];

/**
 * Check if a value is a valid ContentBlock object.
 */
function isValidContentBlock(block: unknown): block is ContentBlock {
  if (typeof block !== 'object' || block === null) return false;
  const b = block as Record<string, unknown>;
  if (typeof b.type !== 'string') return false;

  const validTypes = ['text', 'image', 'thinking', 'tool_use', 'tool_result', 'toolCall', 'toolResult'];
  if (!validTypes.includes(b.type)) return false;

  return true;
}

/**
 * Validate that a value is a valid message content.
 * Content can be: string, ContentBlock[], or null/undefined.
 */
function isValidMessageContent(content: unknown): content is string | ContentBlock[] | null {
  if (content === null || content === undefined) return true;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    return content.every(isValidContentBlock);
  }
  return false;
}

/**
 * Validate a single raw message has the expected schema.
 *
 * @returns true if valid, false otherwise
 */
export function validateRawMessage(msg: unknown): msg is RawMessage {
  if (typeof msg !== 'object' || msg === null) return false;

  const m = msg as Record<string, unknown>;

  // Required: role must be a valid role string
  if (!VALID_ROLES.includes(m.role as RawMessage['role'])) return false;

  // Required: content must be valid
  if (!isValidMessageContent(m.content)) return false;

  // Optional: timestamp must be a number if present
  if (m.timestamp !== undefined && typeof m.timestamp !== 'number') return false;

  return true;
}

/**
 * Validate an array of messages, returning only valid ones.
 *
 * @param data - The data to validate
 * @returns Array of valid RawMessage objects
 */
export function validateMessageArray(data: unknown): RawMessage[] {
  if (!Array.isArray(data)) return [];
  return data.filter(validateRawMessage);
}
