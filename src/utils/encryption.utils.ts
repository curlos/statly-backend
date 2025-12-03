import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get encryption key from environment variable
 * Key should be 32 bytes (64 hex characters) for AES-256
 */
function getEncryptionKey(): Buffer {
	const key = process.env.ENCRYPTION_KEY;

	if (!key) {
		throw new Error('ENCRYPTION_KEY environment variable is not set');
	}

	if (key.length !== 64) {
		throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
	}

	return Buffer.from(key, 'hex');
}

/**
 * Encrypts a string using AES-256-GCM
 * @param text - Plain text to encrypt
 * @returns Encrypted string in hex format
 */
export function encrypt(text: string): string {
	if (!text) {
		return text;
	}

	const key = getEncryptionKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const salt = crypto.randomBytes(SALT_LENGTH);

	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	const encrypted = Buffer.concat([
		cipher.update(text, 'utf8'),
		cipher.final()
	]);

	const tag = cipher.getAuthTag();

	// Combine salt + iv + tag + encrypted data
	const result = Buffer.concat([salt, iv, tag, encrypted]);

	return result.toString('hex');
}

/**
 * Decrypts a string that was encrypted with the encrypt function
 * @param encryptedHex - Encrypted string in hex format
 * @returns Decrypted plain text
 */
export function decrypt(encryptedHex: string): string {
	if (!encryptedHex) {
		return encryptedHex;
	}

	const key = getEncryptionKey();
	const data = Buffer.from(encryptedHex, 'hex');

	// Extract components
	const iv = data.subarray(SALT_LENGTH, TAG_POSITION);
	const tag = data.subarray(TAG_POSITION, ENCRYPTED_POSITION);
	const encrypted = data.subarray(ENCRYPTED_POSITION);

	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);

	const decrypted = Buffer.concat([
		decipher.update(encrypted),
		decipher.final()
	]);

	return decrypted.toString('utf8');
}
