import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export function jsonResponse(
	body: Record<string, unknown>,
	statusCode = 200
): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	};
}

export type ErrorResponse = {
	error: { message: string; detail?: Record<string, unknown> };
};

export function errorResponse(
	statusCode: number,
	error: ErrorResponse['error']
): APIGatewayProxyStructuredResultV2 {
	return jsonResponse({ error }, statusCode);
}

export function noResponse(): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode: 204,
	};
}
