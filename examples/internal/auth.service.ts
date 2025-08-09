import { Tag } from '@/di/tag.js';

export class AuthService extends Tag.Class('AuthService') {
	constructor(private readonly _encryptionKey: string) {
		super();
	}

	verifyApiKey(_apiKey: string): Promise<{ id: string; name: string }> {
		return Promise.resolve({ id: '1', name: 'John Doe' });
	}
}
