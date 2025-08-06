export class AuthService {
	constructor(private readonly _encryptionKey: string) {}
	verifyApiKey(_apiKey: string): Promise<{ id: string; name: string }> {
		return Promise.resolve({ id: '1', name: 'John Doe' });
	}
}
