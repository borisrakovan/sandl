import { BaseError } from '@/errors.js';
import { jsonParse } from '@/utils/json.js';
import { isDefined } from '@/utils/object.js';
import {
	GetSecretValueCommand,
	ResourceNotFoundException,
	SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod/v4';

export class SecretsManagerError extends BaseError {}

export class SecretNotFoundError extends SecretsManagerError {}

/**
 * Retrieves a secret value from AWS Secrets Manager and parses it using a Zod schema if provided.
 * @param secretId - The ID of the secret to retrieve.
 * @param schema - An optional Zod schema to parse the secret data. If provided, the secret data is parsed using the schema.
 * If the parsing fails, a SecretsManagerError is thrown. If no schema is provided, the secret data is returned as is, casted to the expected type.
 * @returns The parsed secret data.
 */
export async function getSecretValue<T>(
	secretId: string,
	schema?: z.ZodType<T>
): Promise<T> {
	const client = new SecretsManagerClient();

	const getSecretValueCommand = new GetSecretValueCommand({
		SecretId: secretId,
	});

	console.log(`Retrieving secret: ${secretId}`);

	let secretValue;
	try {
		secretValue = await client.send(getSecretValueCommand);
	} catch (err: unknown) {
		if (err instanceof ResourceNotFoundException) {
			throw new SecretNotFoundError(
				`Secret ${secretId} not found in Secrets Manager.`
			);
		}
		throw new SecretsManagerError(
			`Error retrieving secret ${secretId} from Secrets Manager: ${err}`,
			{ cause: err }
		);
	}

	const secretString = secretValue.SecretString;

	if (!isDefined(secretString)) {
		throw new SecretsManagerError(
			`Secret value is undefined for secret ${secretId}.`
		);
	}

	// Try to parse the value as a JSON object
	let secretData;
	try {
		secretData = jsonParse(secretString);
	} catch {
		// If the parsing fails, the secret is likely a plain string
		secretData = secretString;
	}

	// If a schema is provided, parse the secret data using the schema
	if (schema !== undefined) {
		try {
			return schema.parse(secretData);
		} catch (err) {
			throw new SecretsManagerError(
				`Error parsing secret ${secretId} with schema: ${err}`,
				{ cause: err }
			);
		}
	}

	// If no schema is provided, return the secret data as is, casted to the expected type
	return secretData as T;
}
